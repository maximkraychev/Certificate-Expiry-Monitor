import { describe, expect, it } from 'vitest';
import { fetchCertificate } from '../../src/core/certFetcher';

// Real network. Run with RUN_NETWORK_TESTS=1.
describe.skipIf(!process.env.RUN_NETWORK_TESTS)('fetchCertificate against badssl.com', { timeout: 20_000 }, () => {
  it('expired.badssl.com is EXPIRED', async () => {
    const result = await fetchCertificate('expired.badssl.com');
    expect(result.status).toBe('EXPIRED');
    expect(result.daysLeft).toBeLessThan(0);
    expect(result.authorized).toBe(false);
  });

  it('self-signed.badssl.com is read but untrusted', async () => {
    const result = await fetchCertificate('self-signed.badssl.com');
    expect(result.status).not.toBe('ERROR');
    expect(result.authorized).toBe(false);
    expect(result.authorizationError).toMatch(/SELF_SIGNED/);
  });

  it('wrong.host.badssl.com is read but fails the hostname check', async () => {
    const result = await fetchCertificate('wrong.host.badssl.com');
    expect(result.status).not.toBe('ERROR');
    expect(result.authorized).toBe(false);
    expect(result.authorizationError).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
  });
});
