import type { NotifiedStatus } from '../../core/status';
import type { Database } from '../connection';
import { listLatestCheckResults, type CheckResult } from './checkResults';

export interface Target {
  id: number;
  host: string;
  port: number;
  lastNotifiedStatus: NotifiedStatus | null;
  /** ISO-8601 UTC. */
  createdAt: string;
}

export interface TargetWithLatestCheck extends Target {
  latestCheck: CheckResult | null;
}

export interface NewTarget {
  host: string;
  port: number;
  createdAt: string;
}

interface TargetRow {
  id: number;
  host: string;
  port: number;
  last_notified_status: NotifiedStatus | null;
  created_at: string;
}

const COLUMNS = 'id, host, port, last_notified_status, created_at';

/** Throws a SqliteError with code `SQLITE_CONSTRAINT_UNIQUE` when (host, port) already exists. */
export function insertTarget(db: Database, target: NewTarget): Target {
  const row = db
    .prepare(`INSERT INTO targets (host, port, created_at) VALUES (?, ?, ?) RETURNING ${COLUMNS}`)
    .get(target.host, target.port, target.createdAt) as TargetRow;
  return toTarget(row);
}

export function getTargetById(db: Database, id: number): Target | undefined {
  const row = db.prepare(`SELECT ${COLUMNS} FROM targets WHERE id = ?`).get(id) as TargetRow | undefined;
  return row && toTarget(row);
}

/** Every target, ordered by host then port. */
export function listTargets(db: Database): Target[] {
  const rows = db.prepare(`SELECT ${COLUMNS} FROM targets ORDER BY host, port`).all() as TargetRow[];
  return rows.map(toTarget);
}

export function listTargetsWithLatestCheck(db: Database): TargetWithLatestCheck[] {
  const latestByTarget = new Map(listLatestCheckResults(db).map((check) => [check.targetId, check]));
  return listTargets(db).map((target) => ({ ...target, latestCheck: latestByTarget.get(target.id) ?? null }));
}

/** Returns false when there was no such target. Its check_results go with it (ON DELETE CASCADE). */
export function deleteTarget(db: Database, id: number): boolean {
  return db.prepare('DELETE FROM targets WHERE id = ?').run(id).changes > 0;
}

export function updateLastNotifiedStatus(db: Database, id: number, status: NotifiedStatus | null): void {
  db.prepare('UPDATE targets SET last_notified_status = ? WHERE id = ?').run(status, id);
}

function toTarget(row: TargetRow): Target {
  return {
    id: row.id,
    host: row.host,
    port: row.port,
    lastNotifiedStatus: row.last_notified_status,
    createdAt: row.created_at,
  };
}
