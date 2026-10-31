import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CertCheck } from '../../src/core/certFetcher';
import type { Database } from '../../src/db/connection';
import { getTargetById, insertTarget, updateLastNotifiedStatus } from '../../src/db/repositories/targets';
import { checkTarget, getHistory } from '../../src/services/checks';
import { deleteTarget } from '../../src/services/targets';
import { createFakeDeps, createTestDb, okCertCheck, TEST_NOW } from '../helpers';

describe('checks service', () => {
  let db: Database;
  let deps: ReturnType<typeof createFakeDeps>;
  let targetId: number;

  beforeEach(() => {
    db = createTestDb();
    deps = createFakeDeps();
    targetId = insertTarget(db, { host: 'example.com', port: 8443, createdAt: TEST_NOW.toISOString() }).id;
  });

  afterEach(() => {
    db.close();
  });

  it('fetches the target, stores the result and returns it', async () => {
    const result = await checkTarget(db, targetId, deps);

    expect(deps.fetchCertificate).toHaveBeenCalledExactlyOnceWith('example.com', 8443, { now: deps.now });
    expect(result).toEqual({
      id: expect.any(Number),
      targetId,
      status: 'OK',
      daysLeft: 90,
      validTo: '2027-01-29T08:00:00.000Z',
      error: null,
      authorized: true,
      authorizationError: null,
      checkedAt: TEST_NOW.toISOString(),
    });
    expect(getHistory(db, targetId)).toEqual([result]);
  });

  it('stores an ERROR result with its message', async () => {
    const failed: CertCheck = {
      ...okCertCheck(),
      status: 'ERROR',
      daysLeft: null,
      validFrom: null,
      validTo: null,
      authorized: null,
      error: 'connect ECONNREFUSED 127.0.0.1:8443',
    };
    deps.fetchCertificate.mockResolvedValueOnce(failed);

    const result = await checkTarget(db, targetId, deps);

    expect(result).toMatchObject({
      status: 'ERROR',
      daysLeft: null,
      validTo: null,
      authorized: null,
      error: 'connect ECONNREFUSED 127.0.0.1:8443',
    });
    expect(getHistory(db, targetId)).toHaveLength(1);
  });

  it('stores an untrusted certificate as authorized = false', async () => {
    deps.fetchCertificate.mockResolvedValueOnce(
      okCertCheck({ authorized: false, authorizationError: 'DEPTH_ZERO_SELF_SIGNED_CERT' }),
    );

    expect(await checkTarget(db, targetId, deps)).toMatchObject({
      status: 'OK',
      authorized: false,
      authorizationError: 'DEPTH_ZERO_SELF_SIGNED_CERT',
    });
  });

  it('does not touch last_notified_status', async () => {
    updateLastNotifiedStatus(db, targetId, 'CRITICAL');
    await checkTarget(db, targetId, deps);
    expect(getTargetById(db, targetId)?.lastNotifiedStatus).toBe('CRITICAL');
  });

  it('returns undefined for an unknown target without fetching', async () => {
    expect(await checkTarget(db, 999, deps)).toBeUndefined();
    expect(deps.fetchCertificate).not.toHaveBeenCalled();
  });

  it('stores nothing when the target is deleted while the check runs', async () => {
    deps.fetchCertificate.mockImplementationOnce(async () => {
      deleteTarget(db, targetId);
      return okCertCheck();
    });

    expect(await checkTarget(db, targetId, deps)).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS n FROM check_results').get()).toEqual({ n: 0 });
  });

  it('returns history newest first, limited, and only for that target', async () => {
    const otherId = insertTarget(db, { host: 'other.example', port: 443, createdAt: TEST_NOW.toISOString() }).id;
    const days = ['2026-10-29', '2026-10-31', '2026-10-30'];
    for (const day of days) {
      deps.now.mockReturnValue(new Date(`${day}T08:00:00.000Z`));
      await checkTarget(db, targetId, deps);
    }
    await checkTarget(db, otherId, deps);

    expect(getHistory(db, targetId).map((check) => check.checkedAt)).toEqual([
      '2026-10-31T08:00:00.000Z',
      '2026-10-30T08:00:00.000Z',
      '2026-10-29T08:00:00.000Z',
    ]);
    expect(getHistory(db, targetId, 2)).toHaveLength(2);
    expect(getHistory(db, otherId)).toHaveLength(1);
    expect(getHistory(db, 999)).toEqual([]);
  });

  it('breaks a checked_at tie by insertion order', async () => {
    const first = await checkTarget(db, targetId, deps);
    deps.fetchCertificate.mockResolvedValueOnce(okCertCheck({ status: 'WARNING', daysLeft: 20 }));
    const second = await checkTarget(db, targetId, deps);

    expect(getHistory(db, targetId).map((check) => check.id)).toEqual([second!.id, first!.id]);
  });
});

describe('updateLastNotifiedStatus', () => {
  it('sets and clears the status', () => {
    const db = createTestDb();
    const { id } = insertTarget(db, { host: 'example.com', port: 443, createdAt: TEST_NOW.toISOString() });

    updateLastNotifiedStatus(db, id, 'WARNING');
    expect(getTargetById(db, id)?.lastNotifiedStatus).toBe('WARNING');
    updateLastNotifiedStatus(db, id, null);
    expect(getTargetById(db, id)?.lastNotifiedStatus).toBeNull();
    db.close();
  });
});
