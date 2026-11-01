import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/connection';
import { insertCheckResult } from '../../src/db/repositories/checkResults';
import { insertTarget, listTargets } from '../../src/db/repositories/targets';
import { getHistory } from '../../src/services/checks';
import { createTestApp, getCsrfToken, loginAgent, okCertCheck, TEST_NOW } from '../helpers';

type TestApp = ReturnType<typeof createTestApp>;
type Agent = Awaited<ReturnType<typeof loginAgent>>;

describe('dashboard and target pages', () => {
  let app: TestApp['app'];
  let db: Database;
  let deps: TestApp['deps'];
  let agent: Agent;

  beforeEach(async () => {
    ({ app, db, deps } = createTestApp());
    agent = await loginAgent(app);
  });

  afterEach(() => {
    db.close();
  });

  function seedTarget(host = 'example.com', port = 443) {
    return insertTarget(db, { host, port, createdAt: TEST_NOW.toISOString() });
  }

  async function post(path: string, fields: Record<string, string> = {}) {
    const _csrf = await getCsrfToken(agent, '/');
    return agent.post(path).type('form').send({ _csrf, ...fields });
  }

  it('shows the add form and an empty state when there are no targets', async () => {
    const res = await agent.get('/');

    expect(res.status).toBe(200);
    expect(res.text).toContain('action="/targets"');
    expect(res.text).toContain('name="host"');
    expect(res.text).toContain('No targets yet.');
  });

  describe('POST /targets', () => {
    it('adds the target, runs the first check and lists it on the dashboard', async () => {
      const res = await post('/targets', { host: '  HTTPS://Example.com/some/path ', port: '' });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/');
      expect(deps.fetchCertificate).toHaveBeenCalledExactlyOnceWith('example.com', 443, { now: deps.now });

      const [target] = listTargets(db);
      expect(target).toMatchObject({ host: 'example.com', port: 443 });
      expect(getHistory(db, target.id)).toHaveLength(1);

      const dashboard = await agent.get('/');
      expect(dashboard.text).toContain('Added example.com:443.');
      expect(dashboard.text).toContain(`href="/targets/${target.id}">example.com:443</a>`);
      expect(dashboard.text).toContain('<span class="badge status-ok">OK</span>');
      expect(dashboard.text).toContain('>90<');
      expect(dashboard.text).toContain('29 Jan 2027');
      // Checked at TEST_NOW (08:00 UTC), shown in Sofia time.
      expect(dashboard.text).toContain('31 Oct 2026, 10:00');
      expect(dashboard.text).toContain(`action="/targets/${target.id}/check"`);
      expect(dashboard.text).toContain(`action="/targets/${target.id}/delete"`);
      expect(dashboard.text).not.toContain('No targets yet.');
    });

    it('uses the port from the Port field', async () => {
      await post('/targets', { host: 'example.com', port: '8443' });

      expect(listTargets(db)).toMatchObject([{ host: 'example.com', port: 8443 }]);
      expect((await agent.get('/')).text).toContain('example.com:8443');
    });

    it('shows a validation error as a flash and stores nothing', async () => {
      const res = await post('/targets', { host: 'not a host!', port: '' });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/');
      expect(listTargets(db)).toEqual([]);
      expect(deps.fetchCertificate).not.toHaveBeenCalled();

      const dashboard = await agent.get('/');
      expect(dashboard.text).toContain('flash-error');
      expect(dashboard.text).toContain('is not a valid host name or IP address.');
    });

    it('shows a bad port as a flash', async () => {
      await post('/targets', { host: 'example.com', port: '70000' });

      expect(listTargets(db)).toEqual([]);
      expect((await agent.get('/')).text).toContain('Port must be a whole number from 1 to 65535.');
    });

    it('shows a duplicate as a friendly flash instead of a 500', async () => {
      seedTarget();

      const res = await post('/targets', { host: 'example.com', port: '443' });

      expect(res.status).toBe(302);
      expect(listTargets(db)).toHaveLength(1);
      expect((await agent.get('/')).text).toContain('example.com:443 is already being monitored.');
    });

    it('escapes user input echoed in the flash', async () => {
      await post('/targets', { host: '<script>alert(1)</script>', port: '' });

      const dashboard = await agent.get('/');
      expect(dashboard.text).not.toContain('<script>alert(1)</script>');
      expect(dashboard.text).toContain('&lt;script&gt;');
    });

    it('keeps the target when the first check fails and shows the error', async () => {
      deps.fetchCertificate.mockResolvedValueOnce({
        ...okCertCheck(),
        status: 'ERROR',
        daysLeft: null,
        validFrom: null,
        validTo: null,
        authorized: null,
        error: 'connect ECONNREFUSED 127.0.0.1:443',
      });

      await post('/targets', { host: '127.0.0.1', port: '' });

      const dashboard = await agent.get('/');
      expect(listTargets(db)).toHaveLength(1);
      expect(dashboard.text).toContain('<span class="badge status-error">ERROR</span>');
      expect(dashboard.text).toContain('connect ECONNREFUSED 127.0.0.1:443');
    });
  });

  it('marks an untrusted certificate on the dashboard', async () => {
    deps.fetchCertificate.mockResolvedValueOnce(
      okCertCheck({ authorized: false, authorizationError: 'DEPTH_ZERO_SELF_SIGNED_CERT' }),
    );

    await post('/targets', { host: 'self-signed.example', port: '' });

    expect((await agent.get('/')).text).toContain('untrusted (self-signed)');
  });

  it.each([
    ['OK', 90, 'status-ok'],
    ['WARNING', 20, 'status-warning'],
    ['CRITICAL', 3, 'status-critical'],
    ['EXPIRED', -2, 'status-expired'],
  ] as const)('colors a %s row with .%s', async (status, daysLeft, cssClass) => {
    deps.fetchCertificate.mockResolvedValueOnce(okCertCheck({ status, daysLeft }));

    await post('/targets', { host: 'example.com', port: '' });

    expect((await agent.get('/')).text).toContain(`<span class="badge ${cssClass}">${status}</span>`);
  });

  it('lists the most urgent target first and leads the page with it', async () => {
    const urgent = [
      ['healthy.example.com', okCertCheck({ status: 'OK', daysLeft: 80 })],
      ['failing.example.com', okCertCheck({ status: 'ERROR', daysLeft: null, validTo: null, error: 'Timed out' })],
      ['soon.example.com', okCertCheck({ status: 'CRITICAL', daysLeft: 5 })],
    ] as const;
    for (const [host, check] of urgent) {
      deps.fetchCertificate.mockResolvedValueOnce(check);
      await post('/targets', { host, port: '' });
    }

    const { text } = await agent.get('/');

    expect(text).toContain('<h1>soon.example.com:443 expires in 5 days.</h1>');
    expect(text).toContain('1 more needs attention.');
    const rows = ['soon', 'failing', 'healthy'].map((name) => text.indexOf(`>${name}.example.com:443</a>`));
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
    expect(rows[0]).toBeGreaterThan(-1);
  });

  it('places a checked target on the runway, and shows the failure instead when a check fails', async () => {
    deps.fetchCertificate.mockResolvedValueOnce(okCertCheck({ status: 'WARNING', daysLeft: 30 }));
    await post('/targets', { host: 'dated.example.com', port: '' });
    expect((await agent.get('/')).text).toContain('class="runway-marker status-warning" style="left: 58%"');

    deps.fetchCertificate.mockResolvedValueOnce(
      okCertCheck({ status: 'ERROR', daysLeft: null, validTo: null, error: 'Timed out' }),
    );
    await post('/targets', { host: 'failing.example.com', port: '' });
    const { text } = await agent.get('/');
    expect(text.match(/runway-marker/g)).toHaveLength(1);
    expect(text).toContain('Timed out');
  });

  it('marks only the current page in the navigation', async () => {
    const dashboard = (await agent.get('/')).text;
    expect(dashboard).toContain('<a href="/" aria-current="page">Dashboard</a>');
    expect(dashboard).toContain('<a href="/recipients">Recipients</a>');
    expect((await agent.get('/recipients')).text).toContain('<a href="/recipients" aria-current="page">Recipients</a>');
  });

  it('offers the theme toggle signed in and out, with the saved theme applied before the stylesheet', async () => {
    for (const res of [await agent.get('/'), await request(app).get('/login')]) {
      expect(res.text).toContain('id="theme-toggle"');
      expect(res.text.indexOf('src="/theme.js"')).toBeGreaterThan(-1);
      expect(res.text.indexOf('src="/theme.js"')).toBeLessThan(res.text.indexOf('href="/style.css"'));
    }
  });

  it('asks for confirmation before deleting a target, on both pages that offer it', async () => {
    const target = seedTarget('example.com', 8443);

    for (const path of ['/', `/targets/${target.id}`]) {
      const { text } = await agent.get(path);
      expect(text).toContain('id="confirm-dialog"');
      expect(text).toContain(
        `action="/targets/${target.id}/delete" data-confirm-title="Delete example.com:8443?"`,
      );
      expect(text).toContain('data-confirm-action="Delete target"');
    }
  });

  it('has no confirmation dialog on the login page', async () => {
    expect((await request(app).get('/login')).text).not.toContain('confirm-dialog');
  });

  describe('POST /targets/:id/check', () => {
    it('adds a history row, sends no mail and returns to the dashboard', async () => {
      const target = seedTarget();

      const res = await post(`/targets/${target.id}/check`);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/');
      expect(deps.fetchCertificate).toHaveBeenCalledExactlyOnceWith('example.com', 443, { now: deps.now });
      expect(getHistory(db, target.id)).toHaveLength(1);
      expect(deps.sendMail).not.toHaveBeenCalled();
      expect((await agent.get('/')).text).toContain('example.com:443: Status OK, 90 days left.');

      await post(`/targets/${target.id}/check`);
      expect(getHistory(db, target.id)).toHaveLength(2);
      expect(deps.sendMail).not.toHaveBeenCalled();
    });

    it('returns to the details page when sent from there', async () => {
      const target = seedTarget();

      const res = await post(`/targets/${target.id}/check`, { from: 'details' });

      expect(res.headers.location).toBe(`/targets/${target.id}`);
    });

    it('ignores any other return value', async () => {
      const target = seedTarget();

      const res = await post(`/targets/${target.id}/check`, { from: 'https://evil.example' });

      expect(res.headers.location).toBe('/');
    });
  });

  describe('POST /targets/:id/delete', () => {
    it('deletes the target and its history', async () => {
      const target = seedTarget();
      await post(`/targets/${target.id}/check`);

      const res = await post(`/targets/${target.id}/delete`);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/');
      expect(listTargets(db)).toEqual([]);
      expect(getHistory(db, target.id)).toEqual([]);

      const dashboard = await agent.get('/');
      expect(dashboard.text).toContain('Stopped monitoring example.com:443.');
      expect(dashboard.text).not.toContain(`href="/targets/${target.id}"`);
    });
  });

  describe('GET /targets/:id', () => {
    it('shows the details and the check history, newest first', async () => {
      const target = seedTarget('example.com', 8443);
      insertCheckResult(db, {
        targetId: target.id,
        status: 'WARNING',
        daysLeft: 20,
        validTo: '2026-11-20T08:00:00.000Z',
        error: null,
        authorized: true,
        authorizationError: null,
        checkedAt: '2026-10-30T08:00:00.000Z',
      });
      insertCheckResult(db, {
        targetId: target.id,
        status: 'ERROR',
        daysLeft: null,
        validTo: null,
        error: 'Timed out after 10000 ms',
        authorized: null,
        authorizationError: null,
        checkedAt: '2026-10-31T08:00:00.000Z',
      });

      const res = await agent.get(`/targets/${target.id}`);

      expect(res.status).toBe(200);
      expect(res.text).toContain('<h1>example.com:8443</h1>');
      expect(res.text).toContain('Check history');
      expect(res.text).toContain('Timed out after 10000 ms');
      expect(res.text).toContain('name="from" value="details"');
      expect(res.text).toContain(`action="/targets/${target.id}/delete"`);
      const newest = res.text.lastIndexOf('31 Oct 2026, 10:00');
      const older = res.text.lastIndexOf('30 Oct 2026, 10:00');
      expect(newest).toBeGreaterThan(-1);
      expect(older).toBeGreaterThan(newest);
      expect(res.text).toContain('<span class="badge status-warning">WARNING</span>');
    });

    it('shows a target with no checks yet', async () => {
      const target = seedTarget();

      const res = await agent.get(`/targets/${target.id}`);

      expect(res.status).toBe(200);
      expect(res.text).toContain('No checks yet.');
    });
  });

  describe('unknown or malformed ids', () => {
    it.each(['999', 'abc', '0', '-1', '1.5', '1e3', '99999999999999999999'])('GET /targets/%s is 404', async (id) => {
      seedTarget();
      const res = await agent.get(`/targets/${id}`);
      expect(res.status).toBe(404);
      expect(res.text).toContain('Not found');
    });

    it.each(['check', 'delete'])('POST /targets/999/%s is 404 and fetches nothing', async (action) => {
      seedTarget();

      const res = await post(`/targets/999/${action}`);

      expect(res.status).toBe(404);
      expect(res.text).toContain('Not found');
      expect(deps.fetchCertificate).not.toHaveBeenCalled();
      expect(listTargets(db)).toHaveLength(1);
    });

    it('POST /targets/abc/delete is 404', async () => {
      expect((await post('/targets/abc/delete')).status).toBe(404);
    });
  });

  describe('CSRF', () => {
    it.each([
      ['/targets', { host: 'example.org', port: '' }],
      ['/targets/1/check', {}],
      ['/targets/1/delete', {}],
    ])('POST %s without a token is 403 and changes nothing', async (path, fields) => {
      const target = seedTarget();
      expect(target.id).toBe(1);

      const res = await agent.post(path).type('form').send(fields);

      expect(res.status).toBe(403);
      expect(res.text).toContain('security token');
      expect(listTargets(db)).toMatchObject([{ host: 'example.com' }]);
      expect(getHistory(db, target.id)).toEqual([]);
      expect(deps.fetchCertificate).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['GET', '/targets/1'],
    ['POST', '/targets'],
  ])('%s %s redirects to /login when signed out', async (method, path) => {
    seedTarget();
    const anonymous = request.agent(app);
    const _csrf = await getCsrfToken(anonymous, '/login');

    const res =
      method === 'GET' ? await anonymous.get(path) : await anonymous.post(path).type('form').send({ _csrf, host: 'a.com' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
    expect(listTargets(db)).toHaveLength(1);
  });
});
