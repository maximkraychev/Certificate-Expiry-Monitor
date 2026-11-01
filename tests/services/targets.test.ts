import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Status } from '../../src/core/status';
import type { Database } from '../../src/db/connection';
import { insertCheckResult } from '../../src/db/repositories/checkResults';
import type { TargetWithLatestCheck } from '../../src/db/repositories/targets';
import {
  addTarget,
  deleteTarget,
  formatHostPort,
  getTarget,
  listTargetsWithLatestCheck,
  parseTargetInput,
  sortByUrgency,
} from '../../src/services/targets';
import { createTestDb, TEST_NOW } from '../helpers';

const deps = { now: () => new Date(TEST_NOW) };

describe('parseTargetInput', () => {
  it.each([
    ['example.com', '', 'example.com', 443],
    ['  Example.COM  ', ' 8443 ', 'example.com', 8443],
    ['https://example.com', '', 'example.com', 443],
    ['HTTPS://Example.com/some/path?q=1#top', '', 'example.com', 443],
    ['example.com/path', '', 'example.com', 443],
    ['example.com.', '', 'example.com', 443],
    ['https://example.com:8443/', '', 'example.com', 8443],
    ['example.com:8443', '8443', 'example.com', 8443],
    ['example.com:', '', 'example.com', 443],
    ['sub-domain.example.co.uk', '', 'sub-domain.example.co.uk', 443],
    ['localhost', '3000', 'localhost', 3000],
    ['192.168.1.10', '', '192.168.1.10', 443],
    ['10.0.0.1:993', '', '10.0.0.1', 993],
    ['::1', '', '::1', 443],
    ['[2001:DB8::1]:8443', '', '2001:db8::1', 8443],
    ['https://[::1]/', '', '::1', 443],
    ['пример.бг', '', 'xn--e1afmkfd.xn--90ae', 443],
    ['example.com', '1', 'example.com', 1],
    ['example.com', '65535', 'example.com', 65535],
  ])('%j port %j gives %s:%i', (host, port, expectedHost, expectedPort) => {
    expect(parseTargetInput({ host, port })).toEqual({ ok: true, value: { host: expectedHost, port: expectedPort } });
  });

  it.each([
    [''],
    ['   '],
    ['https://'],
    ['exa mple.com'],
    ['example..com'],
    ['-example.com'],
    ['example-.com'],
    ['under_score.com'],
    ['user@example.com'],
    ['999.1.1.1'],
    ['1.2.3'],
    ['[example.com]'],
    ['[::1'],
    ['2001:db8::zz'],
    ['a.b:1:2'],
    [`${'a'.repeat(64)}.com`],
    [`${'a.'.repeat(127)}com`],
  ])('rejects host %j', (host) => {
    const result = parseTargetInput({ host, port: '' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/host/i);
  });

  it.each(['0', '65536', '-1', 'abc', '44.3', '1e3', '443 444', '000000443'])('rejects port %j', (port) => {
    expect(parseTargetInput({ host: 'example.com', port })).toEqual({
      ok: false,
      error: 'Port must be a whole number from 1 to 65535.',
    });
  });

  it('rejects an invalid port inside the host', () => {
    expect(parseTargetInput({ host: 'example.com:99999', port: '' })).toMatchObject({ ok: false, error: /Port/ });
    expect(parseTargetInput({ host: 'example.com:abc', port: '443' })).toMatchObject({ ok: false, error: /Port/ });
  });

  it('rejects a host port that disagrees with the Port field', () => {
    expect(parseTargetInput({ host: 'example.com:8443', port: '443' })).toEqual({
      ok: false,
      error: 'The host says port 8443 but the Port field says 443. Use one of them.',
    });
  });

  it('accepts a 253-character host name', () => {
    const host = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`;
    expect(host).toHaveLength(253);
    expect(parseTargetInput({ host, port: '' })).toMatchObject({ ok: true });
  });
});

describe('formatHostPort', () => {
  it('brackets IPv6 addresses only', () => {
    expect(formatHostPort({ host: 'example.com', port: 443 })).toBe('example.com:443');
    expect(formatHostPort({ host: '10.0.0.1', port: 8443 })).toBe('10.0.0.1:8443');
    expect(formatHostPort({ host: '::1', port: 443 })).toBe('[::1]:443');
  });
});

describe('target service', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('adds a normalized target with the injected clock', () => {
    const result = addTarget(db, { host: 'https://Example.com/', port: '' }, deps);

    expect(result).toEqual({
      ok: true,
      target: {
        id: expect.any(Number),
        host: 'example.com',
        port: 443,
        lastNotifiedStatus: null,
        createdAt: TEST_NOW.toISOString(),
      },
    });
    expect(result.ok && getTarget(db, result.target.id)).toEqual(result.ok && result.target);
  });

  it('returns a validation error and stores nothing for bad input', () => {
    expect(addTarget(db, { host: 'not a host', port: '' }, deps)).toMatchObject({ ok: false });
    expect(addTarget(db, { host: 'example.com', port: '0' }, deps)).toMatchObject({ ok: false });
    expect(listTargetsWithLatestCheck(db)).toEqual([]);
  });

  it('returns a friendly error for a duplicate, even when written differently', () => {
    expect(addTarget(db, { host: 'example.com', port: '443' }, deps).ok).toBe(true);

    expect(addTarget(db, { host: 'HTTPS://EXAMPLE.COM/login', port: '' }, deps)).toEqual({
      ok: false,
      error: 'example.com:443 is already being monitored.',
    });
    expect(addTarget(db, { host: 'example.com', port: '8443' }, deps).ok).toBe(true);
    expect(listTargetsWithLatestCheck(db)).toHaveLength(2);
  });

  it('returns undefined for an unknown target', () => {
    expect(getTarget(db, 999)).toBeUndefined();
  });

  it('deletes a target and cascades to its check results', () => {
    const added = addTarget(db, { host: 'example.com', port: '' }, deps);
    if (!added.ok) throw new Error(added.error);
    insertCheckResult(db, {
      targetId: added.target.id,
      status: 'OK',
      daysLeft: 90,
      validTo: '2027-01-29T08:00:00.000Z',
      error: null,
      authorized: true,
      authorizationError: null,
      checkedAt: TEST_NOW.toISOString(),
    });

    expect(deleteTarget(db, added.target.id)).toBe(true);

    expect(getTarget(db, added.target.id)).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS n FROM check_results').get()).toEqual({ n: 0 });
    expect(deleteTarget(db, added.target.id)).toBe(false);
  });

  it('lists targets by host and port with their newest check', () => {
    const add = (host: string, port = '') => {
      const result = addTarget(db, { host, port }, deps);
      if (!result.ok) throw new Error(result.error);
      return result.target.id;
    };
    const zebra = add('zebra.example');
    const alpha8443 = add('alpha.example', '8443');
    const alpha = add('alpha.example');
    const record = (targetId: number, status: 'OK' | 'WARNING' | 'ERROR', checkedAt: string) =>
      insertCheckResult(db, {
        targetId,
        status,
        daysLeft: status === 'ERROR' ? null : 20,
        validTo: null,
        error: status === 'ERROR' ? 'boom' : null,
        authorized: status === 'ERROR' ? null : false,
        authorizationError: status === 'ERROR' ? null : 'DEPTH_ZERO_SELF_SIGNED_CERT',
        checkedAt,
      });
    record(zebra, 'OK', '2026-10-30T08:00:00.000Z');
    record(zebra, 'WARNING', '2026-10-31T08:00:00.000Z');
    record(zebra, 'ERROR', '2026-10-29T08:00:00.000Z');
    record(alpha, 'ERROR', '2026-10-31T08:00:00.000Z');

    const list = listTargetsWithLatestCheck(db);

    expect(list.map((t) => [t.host, t.port])).toEqual([
      ['alpha.example', 443],
      ['alpha.example', 8443],
      ['zebra.example', 443],
    ]);
    expect(list[0].latestCheck).toMatchObject({ targetId: alpha, status: 'ERROR', error: 'boom', authorized: null });
    expect(list[1]).toMatchObject({ id: alpha8443, latestCheck: null });
    expect(list[2].latestCheck).toMatchObject({
      targetId: zebra,
      status: 'WARNING',
      authorized: false,
      authorizationError: 'DEPTH_ZERO_SELF_SIGNED_CERT',
    });
  });
});

describe('sortByUrgency', () => {
  function target(host: string, status: Status | null, daysLeft: number | null = null): TargetWithLatestCheck {
    return {
      id: 1,
      host,
      port: 443,
      lastNotifiedStatus: null,
      createdAt: TEST_NOW.toISOString(),
      latestCheck:
        status === null
          ? null
          : {
              id: 1,
              targetId: 1,
              status,
              daysLeft,
              validTo: null,
              error: null,
              authorized: true,
              authorizationError: null,
              checkedAt: TEST_NOW.toISOString(),
            },
    };
  }

  it('puts known problems first, then failures, then healthy, then unchecked', () => {
    const sorted = sortByUrgency([
      target('never', null),
      target('ok', 'OK', 80),
      target('error', 'ERROR'),
      target('warning', 'WARNING', 20),
      target('critical', 'CRITICAL', 5),
      target('expired', 'EXPIRED', -2),
    ]);
    expect(sorted.map((t) => t.host)).toEqual(['expired', 'critical', 'warning', 'error', 'ok', 'never']);
  });

  it('orders by days left within a status and keeps the order of ties', () => {
    const sorted = sortByUrgency([target('b', 'OK', 80), target('later', 'OK', 90), target('a', 'OK', 80), target('soon', 'OK', 40)]);
    expect(sorted.map((t) => t.host)).toEqual(['soon', 'b', 'a', 'later']);
  });

  it('does not change the list it was given', () => {
    const list = [target('ok', 'OK', 80), target('expired', 'EXPIRED', -2)];
    sortByUrgency(list);
    expect(list.map((t) => t.host)).toEqual(['ok', 'expired']);
  });
});
