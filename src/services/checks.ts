import type { FetchCertificate } from '../core/certFetcher';
import type { Database } from '../db/connection';
import { insertCheckResult, listCheckResultsByTarget, type CheckResult } from '../db/repositories/checkResults';
import { getTargetById } from '../db/repositories/targets';

export interface CheckDeps {
  fetchCertificate: FetchCertificate;
  now: () => Date;
}

export const HISTORY_LIMIT = 100;

/**
 * Checks one target's certificate and stores the result. Never sends mail ("Check now" and the scheduler
 * both use it). Returns undefined when the target doesn't exist, or was deleted while the check ran.
 */
export async function checkTarget(db: Database, targetId: number, deps: CheckDeps): Promise<CheckResult | undefined> {
  const target = getTargetById(db, targetId);
  if (!target) return undefined;

  const cert = await deps.fetchCertificate(target.host, target.port, { now: deps.now });

  if (!getTargetById(db, targetId)) return undefined;
  return insertCheckResult(db, {
    targetId,
    status: cert.status,
    daysLeft: cert.daysLeft,
    validTo: cert.validTo,
    error: cert.error,
    authorized: cert.authorized,
    authorizationError: cert.authorizationError,
    checkedAt: deps.now().toISOString(),
  });
}

/** A target's checks, newest first. */
export function getHistory(db: Database, targetId: number, limit = HISTORY_LIMIT): CheckResult[] {
  return listCheckResultsByTarget(db, targetId, limit);
}
