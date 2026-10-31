import path from 'node:path';
import { csrfSync } from 'csrf-sync';
import express, { type ErrorRequestHandler, type Express } from 'express';
import session from 'express-session';
import helmet from 'helmet';
import type { Config } from '../config';
import type { FetchCertificate } from '../core/certFetcher';
import type { Database } from '../db/connection';
import { renderNotFound } from './errors';
import { viewHelpers } from './format';
import { requireAuth } from './middleware/requireAuth';
import { authRoutes } from './routes/auth';
import { targetRoutes } from './routes/targets';
import { createSessionStore, takeFlash } from './session';

export interface AppDeps {
  fetchCertificate: FetchCertificate;
  now: () => Date;
}

export interface CreateAppOptions {
  db: Database;
  config: Config;
  deps: AppDeps;
  /** Run the session store's periodic cleanup of expired sessions. Tests turn it off. */
  clearExpiredSessions?: boolean;
}

const PUBLIC_DIR = path.join(import.meta.dirname, '..', '..', 'public');
const VIEWS_DIR = path.join(import.meta.dirname, 'views');

export function createApp({ db, config, deps, clearExpiredSessions = true }: CreateAppOptions): Express {
  const app = express();
  app.set('views', VIEWS_DIR);
  app.set('view engine', 'ejs');
  Object.assign(app.locals, viewHelpers);

  app.use(
    helmet({
      contentSecurityPolicy: {
        // Over plain http (dev), this directive would upgrade form posts to https and break them.
        directives: { upgradeInsecureRequests: config.isProduction ? [] : null },
      },
    }),
  );
  app.use(express.static(PUBLIC_DIR));
  app.use(express.urlencoded({ extended: false }));
  app.use(
    session({
      store: createSessionStore(db, clearExpiredSessions),
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProduction },
    }),
  );

  const { generateToken, csrfSynchronisedProtection } = csrfSync({
    getTokenFromRequest: (req) => {
      const token: unknown = req.body?._csrf;
      return typeof token === 'string' ? token : undefined;
    },
  });

  // Locals are set before the CSRF check so the 403 page can still render the layout.
  app.use((req, res, next) => {
    res.locals.csrfToken = generateToken(req);
    res.locals.flash = takeFlash(req);
    res.locals.isAuthenticated = req.session.authenticated === true;
    next();
  });
  app.use(csrfSynchronisedProtection);

  app.use(authRoutes(config));

  app.use(requireAuth);
  app.use(targetRoutes(db, deps));

  app.use((_req, res) => {
    renderNotFound(res);
  });

  const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (err?.code === 'EBADCSRFTOKEN') {
      res.status(403).render('error', {
        title: 'Forbidden',
        message: 'The form was missing a valid security token. Go back, reload the page and try again.',
      });
      return;
    }
    const status = Number(err?.status);
    if (status >= 400 && status < 500) {
      res.status(status).render('error', { title: 'Bad request', message: 'The request could not be processed.' });
      return;
    }
    console.error(err);
    res.status(500).render('error', { title: 'Server error', message: 'Something went wrong. Please try again.' });
  };
  app.use(errorHandler);

  return app;
}
