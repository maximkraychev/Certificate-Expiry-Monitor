import type { Status } from '../../core/status';
import type { Database } from '../connection';

export interface CheckResult {
  id: number;
  targetId: number;
  status: Status;
  daysLeft: number | null;
  /** ISO-8601 UTC. */
  validTo: string | null;
  error: string | null;
  authorized: boolean | null;
  authorizationError: string | null;
  /** ISO-8601 UTC. */
  checkedAt: string;
}

export type NewCheckResult = Omit<CheckResult, 'id'>;

interface CheckResultRow {
  id: number;
  target_id: number;
  status: Status;
  days_left: number | null;
  valid_to: string | null;
  error: string | null;
  authorized: 0 | 1 | null;
  authorization_error: string | null;
  checked_at: string;
}

const COLUMNS = 'id, target_id, status, days_left, valid_to, error, authorized, authorization_error, checked_at';

export function insertCheckResult(db: Database, result: NewCheckResult): CheckResult {
  const row = db
    .prepare(
      `INSERT INTO check_results (target_id, status, days_left, valid_to, error, authorized, authorization_error, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING ${COLUMNS}`,
    )
    .get(
      result.targetId,
      result.status,
      result.daysLeft,
      result.validTo,
      result.error,
      result.authorized === null ? null : Number(result.authorized),
      result.authorizationError,
      result.checkedAt,
    ) as CheckResultRow;
  return toCheckResult(row);
}

/** A target's checks, newest first. */
export function listCheckResultsByTarget(db: Database, targetId: number, limit: number): CheckResult[] {
  const rows = db
    .prepare(
      `SELECT ${COLUMNS} FROM check_results
       WHERE target_id = ?
       ORDER BY checked_at DESC, id DESC
       LIMIT ?`,
    )
    .all(targetId, limit) as CheckResultRow[];
  return rows.map(toCheckResult);
}

/** The newest check of every target that has one. */
export function listLatestCheckResults(db: Database): CheckResult[] {
  const rows = db
    .prepare(
      `SELECT c.id, c.target_id, c.status, c.days_left, c.valid_to, c.error, c.authorized, c.authorization_error, c.checked_at
       FROM targets t
       JOIN check_results c ON c.id = (
         SELECT id FROM check_results WHERE target_id = t.id ORDER BY checked_at DESC, id DESC LIMIT 1
       )`,
    )
    .all() as CheckResultRow[];
  return rows.map(toCheckResult);
}

function toCheckResult(row: CheckResultRow): CheckResult {
  return {
    id: row.id,
    targetId: row.target_id,
    status: row.status,
    daysLeft: row.days_left,
    validTo: row.valid_to,
    error: row.error,
    authorized: row.authorized === null ? null : row.authorized === 1,
    authorizationError: row.authorization_error,
    checkedAt: row.checked_at,
  };
}
