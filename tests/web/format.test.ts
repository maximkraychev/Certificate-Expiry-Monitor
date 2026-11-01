import { describe, expect, it } from 'vitest';
import type { Status } from '../../src/core/status';
import type { TargetWithLatestCheck } from '../../src/db/repositories/targets';
import {
  dashboardSummary,
  describeExpiry,
  formatDate,
  formatDateTime,
  runwayPosition,
  runwayScale,
  statusClass,
  untrustedLabel,
} from '../../src/web/format';

describe('web/format', () => {
  it('shows times in Europe/Sofia, summer (UTC+3) and winter (UTC+2)', () => {
    expect(formatDateTime('2026-07-01T09:30:00.000Z')).toBe('1 Jul 2026, 12:30');
    expect(formatDateTime('2026-10-31T08:00:00.000Z')).toBe('31 Oct 2026, 10:00');
  });

  it('shows the Sofia date, which can be a day after the UTC date', () => {
    expect(formatDate('2026-12-31T23:30:00.000Z')).toBe('1 Jan 2027');
  });

  it('shows a dash for a missing value and the raw string for an unparseable one', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDate(null)).toBe('—');
    expect(formatDate('garbage')).toBe('garbage');
  });

  it('builds the status badge class', () => {
    expect(statusClass('OK')).toBe('status-ok');
    expect(statusClass('CRITICAL')).toBe('status-critical');
    expect(statusClass('ERROR')).toBe('status-error');
  });

  it('labels an untrusted certificate with a readable reason', () => {
    expect(untrustedLabel({ authorized: true, authorizationError: null })).toBeNull();
    expect(untrustedLabel({ authorized: null, authorizationError: null })).toBeNull();
    expect(untrustedLabel({ authorized: false, authorizationError: 'DEPTH_ZERO_SELF_SIGNED_CERT' })).toBe(
      'untrusted (self-signed)',
    );
    expect(untrustedLabel({ authorized: false, authorizationError: 'ERR_TLS_CERT_ALTNAME_INVALID' })).toBe(
      'untrusted (wrong host name)',
    );
    expect(untrustedLabel({ authorized: false, authorizationError: 'SOME_NEW_CODE' })).toBe('untrusted (SOME_NEW_CODE)');
    expect(untrustedLabel({ authorized: false, authorizationError: null })).toBe('untrusted');
  });
});

describe('runwayPosition', () => {
  it.each([
    [0, 8],
    [7, 28],
    [30, 58],
    [90, 100],
  ])('puts day %i on its axis tick', (days, percent) => {
    expect(runwayPosition(days)).toBe(percent);
    expect(runwayScale.ticks.map((tick) => tick.position)).toContain(percent);
  });

  it('moves evenly between ticks', () => {
    expect(runwayPosition(60)).toBeCloseTo(79);
  });

  it('keeps every expired certificate inside the first zone', () => {
    expect(runwayPosition(-1)).toBe(4);
    expect(runwayPosition(-4000)).toBe(4);
    expect(runwayPosition(-1)).toBeLessThan(runwayScale.zones[0].width);
  });

  it('stops at the far end past 90 days, and has no place without dates', () => {
    expect(runwayPosition(91)).toBe(100);
    expect(runwayPosition(4000)).toBe(100);
    expect(runwayPosition(null)).toBeNull();
  });

  it('has zones that fill the whole axis and end on the ticks', () => {
    let end = 0;
    const ends = runwayScale.zones.map((zone) => (end += zone.width));
    expect(ends).toEqual(runwayScale.ticks.map((tick) => tick.position));
  });
});

describe('describeExpiry', () => {
  const validTo = '2026-11-23T10:00:00.000Z';

  it.each([
    [22, 'Expires in 22 days, on 23 Nov 2026.'],
    [1, 'Expires in 1 day, on 23 Nov 2026.'],
    [0, 'Expires within a day, on 23 Nov 2026.'],
    [-1, 'Expired within the last day, on 23 Nov 2026.'],
    [-41, 'Expired 41 days ago, on 23 Nov 2026.'],
  ])('describes %i days left', (daysLeft, sentence) => {
    expect(describeExpiry({ daysLeft, validTo })).toBe(sentence);
  });

  it('says so when there are no dates to describe', () => {
    expect(describeExpiry({ daysLeft: null, validTo: null })).toBe('The last check failed.');
    expect(describeExpiry(null)).toBe('Waiting for the first check.');
  });
});

describe('dashboardSummary', () => {
  function target(host: string, status: Status | null, daysLeft: number | null = null): TargetWithLatestCheck {
    return {
      id: 1,
      host,
      port: 443,
      lastNotifiedStatus: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      latestCheck:
        status === null
          ? null
          : {
              id: 1,
              targetId: 1,
              status,
              daysLeft,
              validTo: daysLeft === null ? null : '2027-01-29T08:00:00.000Z',
              error: null,
              authorized: true,
              authorizationError: null,
              checkedAt: '2026-10-31T08:00:00.000Z',
            },
    };
  }

  it('invites the first target when there are none', () => {
    expect(dashboardSummary([])).toEqual({ headline: 'Add your first host.', detail: null });
  });

  it('leads with the most urgent target and counts the other problems', () => {
    const summary = dashboardSummary([
      target('a.example', 'EXPIRED', -3),
      target('b.example', 'WARNING', 20),
      target('c.example', 'ERROR'),
      target('d.example', 'OK', 80),
    ]);
    expect(summary).toEqual({ headline: 'a.example:443 expired 3 days ago.', detail: '2 more need attention.' });
  });

  it('uses the singular for one more, and no detail for none', () => {
    const b = target('b.example', 'OK', 80);
    expect(dashboardSummary([target('a.example', 'CRITICAL', 5), target('c.example', 'WARNING', 9)]).detail).toBe(
      '1 more needs attention.',
    );
    expect(dashboardSummary([target('a.example', 'CRITICAL', 5), b])).toEqual({
      headline: 'a.example:443 expires in 5 days.',
      detail: null,
    });
  });

  it('says a failing host cannot be checked', () => {
    expect(dashboardSummary([target('a.example', 'ERROR')]).headline).toBe("a.example:443 can't be checked.");
  });

  it('gives the all-clear with the next expiry when everything is OK', () => {
    expect(dashboardSummary([target('a.example', 'OK', 80), target('b.example', 'OK', 90)])).toEqual({
      headline: 'Nothing expires in the next 30 days.',
      detail: 'Next: a.example:443 on 29 Jan 2027.',
    });
  });

  it('waits when nothing has been checked yet', () => {
    expect(dashboardSummary([target('a.example', null)]).headline).toBe('Waiting for the first check.');
  });
});
