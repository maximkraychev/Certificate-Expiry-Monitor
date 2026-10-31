declare module 'better-sqlite3-session-store' {
  import type { Database } from 'better-sqlite3';
  import type session from 'express-session';

  interface SqliteStoreOptions {
    client: Database;
    expired?: { clear?: boolean; intervalMs?: number };
  }

  class SqliteStore extends session.Store {
    constructor(options: SqliteStoreOptions);
    expired: { clear: boolean; intervalMs: number };
    startInterval(): void;
    clearExpiredSessions(): void;
    get(sid: string, callback: (err: unknown, session?: session.SessionData | null) => void): void;
    set(sid: string, session: session.SessionData, callback?: (err?: unknown) => void): void;
    destroy(sid: string, callback?: (err?: unknown) => void): void;
  }

  export default function createSqliteStore(expressSession: typeof session): typeof SqliteStore;
}
