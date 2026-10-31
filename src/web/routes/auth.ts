import { Router } from 'express';
import type { Config } from '../../config';
import { checkCredentials } from '../../services/auth';
import { bodyString } from '../request';
import { regenerateSession, saveSession, setFlash } from '../session';

export function authRoutes(config: Config): Router {
  const router = Router();

  router.get('/login', (req, res) => {
    if (req.session.authenticated) {
      res.redirect('/');
      return;
    }
    res.render('login', { title: 'Sign in', error: null, username: '' });
  });

  router.post('/login', async (req, res) => {
    const username = bodyString(req, 'username');
    const password = bodyString(req, 'password');

    if (!checkCredentials(config, username, password)) {
      res.status(401).render('login', { title: 'Sign in', error: 'Invalid username or password.', username });
      return;
    }

    // A fresh session id on login prevents session fixation (decision 10).
    await regenerateSession(req);
    req.session.authenticated = true;
    setFlash(req, 'success', 'Signed in.');
    await saveSession(req);
    res.redirect('/');
  });

  // regenerate() destroys the old session in the store and leaves an empty one that can carry the flash.
  router.post('/logout', async (req, res) => {
    await regenerateSession(req);
    setFlash(req, 'success', 'Signed out.');
    await saveSession(req);
    res.redirect('/login');
  });

  return router;
}
