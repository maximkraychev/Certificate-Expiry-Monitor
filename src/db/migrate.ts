import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { MIGRATIONS_DIR } from '../paths';
import type { Database } from './connection';

export interface Migration {
  version: number;
  name: string;
  file: string;
}

const MIGRATION_FILE = /^(\d{3})_.+\.sql$/;

export function listMigrations(dir = MIGRATIONS_DIR): Migration[] {
  const migrations = readdirSync(dir)
    .map((name) => ({ name, match: MIGRATION_FILE.exec(name) }))
    .filter(({ match }) => match !== null)
    .map(({ name, match }) => ({ version: Number(match![1]), name, file: path.join(dir, name) }))
    .sort((a, b) => a.version - b.version);

  for (let i = 1; i < migrations.length; i++) {
    if (migrations[i].version === migrations[i - 1].version) {
      throw new Error(`Duplicate migration number: ${migrations[i - 1].name} and ${migrations[i].name}`);
    }
  }
  return migrations;
}

export function getSchemaVersion(db: Database): number {
  return db.pragma('user_version', { simple: true }) as number;
}

/** Applies every migration newer than `PRAGMA user_version`, one transaction per file. Returns the new version. */
export function runMigrations(db: Database, dir = MIGRATIONS_DIR): number {
  const current = getSchemaVersion(db);

  for (const migration of listMigrations(dir)) {
    if (migration.version <= current) continue;

    const sql = readFileSync(migration.file, 'utf8');
    const apply = db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${migration.version}`);
    });

    try {
      apply();
    } catch (err) {
      throw new Error(`Migration ${migration.name} failed: ${(err as Error).message}`, { cause: err });
    }
  }

  return getSchemaVersion(db);
}
