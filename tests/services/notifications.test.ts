import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CertCheck } from '../../src/core/certFetcher';
import type { NotifiedStatus, Status } from '../../src/core/status';
import type { Database } from '../../src/db/connection';
import { listNotifications } from '../../src/db/repositories/notifications';
import { getTargetById, insertTarget, updateLastNotifiedStatus } from '../../src/db/repositories/targets';
import { getHistory } from '../../src/services/checks';
import { runNotificationJob } from '../../src/services/notifications';
import { addRecipient } from '../../src/services/recipients';
import { createFakeDeps, createTestDb, okCertCheck, TEST_NOW } from '../helpers';

const DAYS: Record<Exclude<Status, 'ERROR'>, number> = { OK: 90, WARNING: 20, CRITICAL: 3, EXPIRED: -2 };

function certWith(status: Status): CertCheck {
  if (status === 'ERROR') {
    return okCertCheck({
      status,
      daysLeft: null,
      validFrom: null,
      validTo: null,
      authorized: null,
      error: 'connect ECONNREFUSED',
    });
  }
  return okCertCheck({ status, daysLeft: DAYS[status] });
}

describe('runNotificationJob', () => {
  let db: Database;
  let deps: ReturnType<typeof createFakeDeps>;
  /** The status the fake fetcher reports for each host. Hosts not listed are OK. */
  let statusByHost: Map<string, Status>;

  beforeEach(() => {
    db = createTestDb();
    deps = createFakeDeps();
    statusByHost = new Map();
    deps.fetchCertificate.mockImplementation(async (host) => certWith(statusByHost.get(host) ?? 'OK'));
  });

  afterEach(() => {
    db.close();
  });

  function addTarget(host: string, lastNotified: NotifiedStatus | null = null): number {
    const { id } = insertTarget(db, { host, port: 443, createdAt: TEST_NOW.toISOString() });
    if (lastNotified) updateLastNotifiedStatus(db, id, lastNotified);
    return id;
  }

  function addRecipients(...emails: string[]) {
    for (const email of emails) addRecipient(db, email, deps);
  }

  const lastNotified = (id: number) => getTargetById(db, id)?.lastNotifiedStatus;
  const run = () => runNotificationJob(db, deps);

  it('checks every target and stores a result for each', async () => {
    const a = addTarget('a.example');
    const b = addTarget('b.example');

    const result = await run();

    expect(result.checked).toBe(2);
    expect(deps.fetchCertificate).toHaveBeenCalledTimes(2);
    expect(getHistory(db, a)).toHaveLength(1);
    expect(getHistory(db, b)).toHaveLength(1);
  });

  it('checks targets one at a time', async () => {
    addTarget('a.example');
    addTarget('b.example');
    let inFlight = 0;
    let maxInFlight = 0;
    deps.fetchCertificate.mockImplementation(async () => {
      maxInFlight = Math.max(maxInFlight, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return okCertCheck();
    });

    await run();

    expect(maxInFlight).toBe(1);
  });

  it('escalation WARNING → CRITICAL triggers a digest and raises last_notified_status', async () => {
    addRecipients('ops@example.com');
    const id = addTarget('site.example', 'WARNING');
    statusByHost.set('site.example', 'CRITICAL');

    const result = await run();

    expect(deps.sendMail).toHaveBeenCalledOnce();
    const [to, digest] = deps.sendMail.mock.calls[0];
    expect(to).toBe('ops@example.com');
    expect(digest.subject).toBe('Certificate alert: 1 CRITICAL');
    expect(digest.text).toContain('site.example:443  CRITICAL  3 days left');
    expect(lastNotified(id)).toBe('CRITICAL');
    expect(result.log).toMatchObject({
      sentAt: TEST_NOW.toISOString(),
      recipientsCount: 1,
      summary: 'triggered: site.example:443 CRITICAL',
    });
  });

  it('the same status twice alerts only once', async () => {
    addRecipients('ops@example.com');
    const id = addTarget('site.example');
    statusByHost.set('site.example', 'WARNING');

    await run();
    await run();

    expect(deps.sendMail).toHaveBeenCalledOnce();
    expect(lastNotified(id)).toBe('WARNING');
    expect(listNotifications(db, 10).map((log) => log.summary)).toEqual([
      'nothing triggered (1 checked)',
      'triggered: site.example:443 WARNING',
    ]);
  });

  it('OK resets last_notified_status to NULL and sends no mail', async () => {
    addRecipients('ops@example.com');
    const id = addTarget('site.example', 'CRITICAL');

    const result = await run();

    expect(deps.sendMail).not.toHaveBeenCalled();
    expect(lastNotified(id)).toBeNull();
    expect(result.log).toMatchObject({ recipientsCount: 0, summary: 'nothing triggered (1 checked)' });
  });

  it('a better but not OK status lowers last_notified_status silently, so a later escalation alerts again', async () => {
    addRecipients('ops@example.com');
    const id = addTarget('site.example', 'EXPIRED');
    statusByHost.set('site.example', 'WARNING');

    await run();
    expect(deps.sendMail).not.toHaveBeenCalled();
    expect(lastNotified(id)).toBe('WARNING');

    statusByHost.set('site.example', 'CRITICAL');
    await run();
    expect(deps.sendMail).toHaveBeenCalledOnce();
    expect(lastNotified(id)).toBe('CRITICAL');
  });

  it('ERROR triggers on every run and leaves last_notified_status unchanged', async () => {
    addRecipients('ops@example.com');
    const id = addTarget('down.example', 'WARNING');
    statusByHost.set('down.example', 'ERROR');

    await run();
    await run();

    expect(deps.sendMail).toHaveBeenCalledTimes(2);
    expect(deps.sendMail.mock.calls[0][1].text).toContain('down.example:443  ERROR  connect ECONNREFUSED');
    expect(lastNotified(id)).toBe('WARNING');
  });

  it('sends one digest listing every triggered target to each recipient', async () => {
    addRecipients('a@example.com', 'b@example.com');
    addTarget('fine.example');
    addTarget('warn.example');
    addTarget('gone.example');
    addTarget('down.example');
    statusByHost.set('warn.example', 'WARNING').set('gone.example', 'EXPIRED').set('down.example', 'ERROR');

    const result = await run();

    expect(deps.sendMail).toHaveBeenCalledTimes(2);
    expect(deps.sendMail.mock.calls.map(([to]) => to).sort()).toEqual(['a@example.com', 'b@example.com']);
    const [[, first], [, second]] = deps.sendMail.mock.calls;
    expect(second).toBe(first);
    expect(first.subject).toBe('Certificate alert: 1 EXPIRED, 1 WARNING, 1 ERROR');
    expect(first.text).not.toContain('fine.example');
    expect(result.triggered.map((item) => item.host).sort()).toEqual(['down.example', 'gone.example', 'warn.example']);
    expect(result.log.recipientsCount).toBe(2);
  });

  it('with no recipients sends nothing, logs the run with 0 and leaves last_notified_status for next time', async () => {
    const id = addTarget('warn.example');
    statusByHost.set('warn.example', 'WARNING');

    const result = await run();

    expect(deps.sendMail).not.toHaveBeenCalled();
    expect(lastNotified(id)).toBeNull();
    expect(result.log).toMatchObject({ recipientsCount: 0, summary: 'no recipients; triggered: warn.example:443 WARNING' });
  });

  it('still applies an OK reset when there are no recipients', async () => {
    const id = addTarget('renewed.example', 'CRITICAL');

    await run();

    expect(lastNotified(id)).toBeNull();
  });

  it('one failing recipient does not block the others', async () => {
    addRecipients('a@example.com', 'bad@example.com', 'c@example.com');
    const id = addTarget('warn.example');
    statusByHost.set('warn.example', 'WARNING');
    deps.sendMail.mockImplementation(async (to) => {
      if (to === 'bad@example.com') throw new Error('550 mailbox unavailable');
    });

    const result = await run();

    expect(deps.sendMail).toHaveBeenCalledTimes(3);
    expect(result.sent).toEqual(['a@example.com', 'c@example.com']);
    expect(result.failed).toEqual([{ email: 'bad@example.com', error: '550 mailbox unavailable' }]);
    expect(lastNotified(id)).toBe('WARNING');
    expect(result.log).toMatchObject({
      recipientsCount: 2,
      summary: 'triggered: warn.example:443 WARNING; failed: bad@example.com (550 mailbox unavailable)',
    });
  });

  it('when every send fails, keeps last_notified_status so the next run tries again', async () => {
    addRecipients('a@example.com', 'b@example.com');
    const id = addTarget('warn.example');
    statusByHost.set('warn.example', 'WARNING');
    deps.sendMail.mockRejectedValue(new Error('ECONNREFUSED'));

    const first = await run();
    expect(lastNotified(id)).toBeNull();
    expect(first.log.recipientsCount).toBe(0);
    expect(first.log.summary).toContain('failed: a@example.com (ECONNREFUSED), b@example.com (ECONNREFUSED)');

    deps.sendMail.mockResolvedValue();
    await run();
    expect(deps.sendMail).toHaveBeenCalledTimes(4);
    expect(lastNotified(id)).toBe('WARNING');
  });

  it('logs a run with no targets', async () => {
    const result = await run();

    expect(result.checked).toBe(0);
    expect(listNotifications(db, 10)).toEqual([
      { id: expect.any(Number), sentAt: TEST_NOW.toISOString(), recipientsCount: 0, summary: 'nothing triggered (0 checked)' },
    ]);
  });
});
