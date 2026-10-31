import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, statusClass, untrustedLabel } from '../../src/web/format';

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
