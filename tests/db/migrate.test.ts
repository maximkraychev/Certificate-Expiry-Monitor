import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '../../src/db/connection';
import { getSchemaVersion, listMigrations, runMigrations } from '../../src/db/migrate';
import { createTestDb } from '../helpers';

function tableNames(db: Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}

describe('runMigrations (real migrations)', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('creates the four tables and the check_results index', () => {
    expect(tableNames(db)).toEqual(['check_results', 'notification_recipients', 'notifications', 'targets']);
    const index = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'check_results' AND sql IS NOT NULL")
      .all();
    expect(index).toEqual([{ name: 'idx_check_results_target_checked' }]);
  });

  it('sets user_version to the latest migration number', () => {
    const latest = listMigrations().at(-1)!.version;
    expect(latest).toBeGreaterThanOrEqual(1);
    expect(getSchemaVersion(db)).toBe(latest);
  });

  it('is idempotent', () => {
    const before = getSchemaVersion(db);
    expect(() => runMigrations(db)).not.toThrow();
    expect(runMigrations(db)).toBe(before);
    expect(tableNames(db)).toHaveLength(4);
  });

  it('cascades deleting a target to its check_results', () => {
    const { lastInsertRowid: targetId } = db
      .prepare("INSERT INTO targets (host, port) VALUES ('example.com', 443)")
      .run();
    const insertResult = db.prepare("INSERT INTO check_results (target_id, status) VALUES (?, 'OK')");
    insertResult.run(targetId);
    insertResult.run(targetId);

    db.prepare('DELETE FROM targets WHERE id = ?').run(targetId);

    expect(db.prepare('SELECT COUNT(*) AS n FROM check_results').get()).toEqual({ n: 0 });
  });

  it('rejects a check_result for a target that does not exist', () => {
    expect(() => db.prepare("INSERT INTO check_results (target_id, status) VALUES (999, 'OK')").run()).toThrow(
      /FOREIGN KEY/,
    );
  });

  it('enforces UNIQUE(host, port) but allows the same host on another port', () => {
    const insert = db.prepare('INSERT INTO targets (host, port) VALUES (?, ?)');
    insert.run('example.com', 443);
    expect(() => insert.run('example.com', 443)).toThrow(/UNIQUE/);
    expect(() => insert.run('example.com', 8443)).not.toThrow();
  });

  it('enforces UNIQUE(email) on recipients', () => {
    const insert = db.prepare('INSERT INTO notification_recipients (email) VALUES (?)');
    insert.run('ops@example.com');
    expect(() => insert.run('ops@example.com')).toThrow(/UNIQUE/);
  });

  it('rejects an unknown status', () => {
    const { lastInsertRowid: targetId } = db
      .prepare("INSERT INTO targets (host, port) VALUES ('example.com', 443)")
      .run();
    expect(() =>
      db.prepare("INSERT INTO check_results (target_id, status) VALUES (?, 'BROKEN')").run(targetId),
    ).toThrow(/CHECK/);
    expect(() => db.prepare("UPDATE targets SET last_notified_status = 'ERROR'").run()).toThrow(/CHECK/);
  });

  it('stores the extra authorized / authorization_error columns (decision 3)', () => {
    const { lastInsertRowid: targetId } = db
      .prepare("INSERT INTO targets (host, port) VALUES ('example.com', 443)")
      .run();
    db.prepare(
      "INSERT INTO check_results (target_id, status, authorized, authorization_error) VALUES (?, 'OK', 0, 'DEPTH_ZERO_SELF_SIGNED_CERT')",
    ).run(targetId);

    const row = db.prepare('SELECT authorized, authorization_error, checked_at FROM check_results').get() as {
      authorized: number;
      authorization_error: string;
      checked_at: string;
    };
    expect(row.authorized).toBe(0);
    expect(row.authorization_error).toBe('DEPTH_ZERO_SELF_SIGNED_CERT');
    expect(row.checked_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('runMigrations (custom migration folders)', () => {
  let dir: string;
  let db: Database;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'cert-monitor-migrations-'));
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('applies only migrations newer than user_version, in numeric order', () => {
    writeFileSync(path.join(dir, '001_a.sql'), 'CREATE TABLE a (id INTEGER);');
    expect(runMigrations(db, dir)).toBe(1);

    writeFileSync(path.join(dir, '002_b.sql'), 'CREATE TABLE b (a_id INTEGER);');
    writeFileSync(path.join(dir, '010_c.sql'), 'CREATE TABLE c (id INTEGER);');
    writeFileSync(path.join(dir, 'README.md'), 'not a migration');

    expect(runMigrations(db, dir)).toBe(10);
    expect(tableNames(db)).toEqual(['a', 'b', 'c']);
  });

  it('rolls back a failing migration and keeps the previous user_version', () => {
    writeFileSync(path.join(dir, '001_ok.sql'), 'CREATE TABLE ok (id INTEGER);');
    writeFileSync(path.join(dir, '002_bad.sql'), 'CREATE TABLE half (id INTEGER);\nTHIS IS NOT SQL;');

    expect(() => runMigrations(db, dir)).toThrow(/002_bad\.sql/);
    expect(getSchemaVersion(db)).toBe(1);
    expect(tableNames(db)).toEqual(['ok']);
  });

  it('refuses two migrations with the same number', () => {
    writeFileSync(path.join(dir, '001_a.sql'), 'SELECT 1;');
    writeFileSync(path.join(dir, '001_b.sql'), 'SELECT 1;');
    expect(() => runMigrations(db, dir)).toThrow(/Duplicate migration number/);
  });
});
