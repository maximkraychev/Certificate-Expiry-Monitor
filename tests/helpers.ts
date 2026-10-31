import { openDatabase, type Database } from '../src/db/connection';
import { runMigrations } from '../src/db/migrate';

/** A fresh in-memory database with every migration applied. */
export function createTestDb(): Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}
