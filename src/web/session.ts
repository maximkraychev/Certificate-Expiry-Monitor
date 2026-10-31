import type { Request } from 'express';
import session from 'express-session';
import createSqliteStore from 'better-sqlite3-session-store';
import type { Database } from '../db/connection';

export interface Flash {
  type: 'success' | 'error';
  message: string;
}

declare module 'express-session' {
  interface SessionData {
    authenticated?: boolean;
    flash?: Flash;
  }
}

const SqliteStore = createSqliteStore(session);

/**
 * The upstream store ignores `expired.clear: false` (it ORs the option with `true`) and its cleanup
 * timer is never unref'd, so this subclass decides itself whether to start one (decision 10).
 */
export function createSessionStore(db: Database, clearExpired: boolean): session.Store {
  class SessionStore extends SqliteStore {
    startInterval(): void {
      if (clearExpired) {
        setInterval(() => this.clearExpiredSessions(), this.expired.intervalMs).unref();
      }
    }
  }
  return new SessionStore({ client: db, expired: { clear: clearExpired } });
}

export function setFlash(req: Request, type: Flash['type'], message: string): void {
  req.session.flash = { type, message };
}

/** Returns the pending flash message and removes it from the session. */
export function takeFlash(req: Request): Flash | null {
  const flash = req.session.flash ?? null;
  delete req.session.flash;
  return flash;
}

export function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
}

export function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())));
}
