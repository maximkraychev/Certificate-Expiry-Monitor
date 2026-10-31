import { mkdirSync } from 'node:fs';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';

export type Database = BetterSqlite3.Database;

export function isFileDatabase(dbPath: string): boolean {
  return dbPath !== '' && dbPath !== ':memory:';
}

export function openDatabase(dbPath: string): Database {
  if (isFileDatabase(dbPath)) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new BetterSqlite3(dbPath);
  db.pragma('foreign_keys = ON');
  if (isFileDatabase(dbPath)) {
    db.pragma('journal_mode = WAL');
  }
  return db;
}
