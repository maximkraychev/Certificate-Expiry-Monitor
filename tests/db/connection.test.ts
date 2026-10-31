import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '../../src/db/connection';

describe('openDatabase', () => {
  let db: Database | undefined;
  let tempDir: string | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it('enables foreign keys on an in-memory database and leaves its journal mode alone', () => {
    db = openDatabase(':memory:');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('journal_mode', { simple: true })).toBe('memory');
  });

  it('creates the parent directory and uses WAL for a file database', () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'cert-monitor-'));
    const dbPath = path.join(tempDir, 'nested', 'dir', 'certs.db');

    db = openDatabase(dbPath);

    expect(existsSync(dbPath)).toBe(true);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
  });
});
