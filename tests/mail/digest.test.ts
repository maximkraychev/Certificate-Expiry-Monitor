import { describe, expect, it } from 'vitest';
import { buildDigest, type DigestItem } from '../../src/mail/digest';
import { TEST_NOW } from '../helpers';

function item(overrides: Partial<DigestItem>): DigestItem {
  return {
    host: 'example.com',
    port: 443,
    status: 'WARNING',
    daysLeft: 20,
    validTo: '2026-11-20T12:00:00.000Z',
    error: null,
    ...overrides,
  };
}

describe('buildDigest', () => {
  const items = [
    item({ host: 'warn.example', status: 'WARNING', daysLeft: 20 }),
    item({ host: 'down.example', status: 'ERROR', daysLeft: null, validTo: null, error: 'connect ECONNREFUSED' }),
    item({ host: 'old.example', port: 8443, status: 'EXPIRED', daysLeft: -3, validTo: '2026-10-28T12:00:00.000Z' }),
    item({ host: 'soon.example', status: 'CRITICAL', daysLeft: 2, validTo: '2026-11-02T12:00:00.000Z' }),
  ];

  it('counts the statuses in the subject, worst first', () => {
    expect(buildDigest(items, TEST_NOW).subject).toBe('Certificate alert: 1 EXPIRED, 1 CRITICAL, 1 WARNING, 1 ERROR');
  });

  it('lists every target in the text, worst first, with days left and expiry date', () => {
    const { text } = buildDigest(items, TEST_NOW);
    const lines = text.split('\n');

    expect(lines[0]).toBe('Certificate check of 31 Oct 2026, 10:00 (Europe/Sofia).');
    expect(lines.slice(2, 6)).toEqual([
      'old.example:8443  EXPIRED  -3 days left  expires 28 Oct 2026',
      'soon.example:443  CRITICAL  2 days left  expires 2 Nov 2026',
      'warn.example:443  WARNING  20 days left  expires 20 Nov 2026',
      'down.example:443  ERROR  connect ECONNREFUSED',
    ]);
  });

  it('renders an HTML table with one row per target and the error for ERROR rows', () => {
    const { html } = buildDigest(items, TEST_NOW);

    expect(html).toContain('<table');
    expect(html.match(/<tr>/g)).toHaveLength(items.length + 1);
    expect(html).toMatch(/old\.example:8443<\/td><td[^>]*>EXPIRED<\/td><td[^>]*>-3<\/td><td[^>]*>28 Oct 2026<\/td>/);
    expect(html).toMatch(/down\.example:443<\/td><td[^>]*>ERROR<\/td><td[^>]* colspan="2">connect ECONNREFUSED<\/td>/);
  });

  it('escapes HTML in values', () => {
    const { html } = buildDigest([item({ status: 'ERROR', error: '<script>alert("x")</script> & co' })], TEST_NOW);

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co');
  });

  it('brackets IPv6 hosts', () => {
    expect(buildDigest([item({ host: '::1', port: 8443 })], TEST_NOW).text).toContain('[::1]:8443  WARNING');
  });
});
