import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/connection';
import { createTestApp, getCsrfToken, loginAgent, TEST_PASSWORD, TEST_USERNAME } from '../helpers';

type App = ReturnType<typeof createTestApp>['app'];

function sessionCookie(res: request.Response): string | undefined {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  return cookies.find((cookie) => cookie.startsWith('connect.sid='));
}

describe('in production', () => {
  let app: App;
  let db: Database;

  beforeEach(() => {
    ({ app, db } = createTestApp({ isProduction: true }));
  });

  afterEach(() => {
    db.close();
  });

  it('can log in through an HTTPS reverse proxy, with a secure cookie', async () => {
    const page = await request(app).get('/login').set('X-Forwarded-Proto', 'https');
    const cookie = sessionCookie(page);
    expect(cookie).toContain('Secure');

    const _csrf = /name="_csrf" value="([^"]+)"/.exec(page.text)![1];
    const login = await request(app)
      .post('/login')
      .set('X-Forwarded-Proto', 'https')
      .set('Cookie', cookie!.split(';')[0])
      .type('form')
      .send({ _csrf, username: TEST_USERNAME, password: TEST_PASSWORD });

    expect(login.status).toBe(302);
    expect(login.headers.location).toBe('/');
  });

  it('sets no session cookie over plain http', async () => {
    const page = await request(app).get('/login');
    expect(sessionCookie(page)).toBeUndefined();
  });
});

describe('login / logout', () => {
  let app: App;
  let db: Database;

  beforeEach(() => {
    ({ app, db } = createTestApp());
  });

  afterEach(() => {
    db.close();
  });

  it('renders the login form with a CSRF token and security headers', async () => {
    const res = await request(app).get('/login');

    expect(res.status).toBe(200);
    expect(res.text).toMatch(/name="_csrf" value="[0-9a-f]+"/);
    expect(res.text).toContain('name="username"');
    expect(res.text).not.toContain('/logout');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('serves the stylesheet without a login', async () => {
    const res = await request(app).get('/style.css');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/css/);
  });

  it('signs in with the correct credentials and shows the dashboard', async () => {
    const agent = request.agent(app);
    const _csrf = await getCsrfToken(agent, '/login');

    const login = await agent
      .post('/login')
      .type('form')
      .send({ _csrf, username: TEST_USERNAME, password: TEST_PASSWORD });
    expect(login.status).toBe(302);
    expect(login.headers.location).toBe('/');

    const dashboard = await agent.get('/');
    expect(dashboard.status).toBe(200);
    expect(dashboard.text).toContain('Dashboard');
    expect(dashboard.text).toContain('Signed in.');
    expect(dashboard.text).toContain('action="/logout"');

    // The flash is shown once.
    expect((await agent.get('/')).text).not.toContain('Signed in.');
  });

  it('issues a new session id on login and sets safe cookie flags', async () => {
    const agent = request.agent(app);
    const loginPage = await agent.get('/login');
    const before = sessionCookie(loginPage);
    const _csrf = /name="_csrf" value="([^"]+)"/.exec(loginPage.text)![1];

    const login = await agent
      .post('/login')
      .type('form')
      .send({ _csrf, username: TEST_USERNAME, password: TEST_PASSWORD });
    const after = sessionCookie(login);

    expect(before).toBeDefined();
    expect(after).toBeDefined();
    expect(after!.split(';')[0]).not.toBe(before!.split(';')[0]);
    expect(after).toMatch(/HttpOnly/i);
    expect(after).toMatch(/SameSite=Lax/i);
    expect(after).not.toMatch(/Secure/i);
  });

  it.each([
    ['wrong username', 'root', TEST_PASSWORD],
    ['wrong password', TEST_USERNAME, 'wrong'],
    ['empty fields', '', ''],
  ])('rejects a %s with 401 and a generic message', async (_label, username, password) => {
    const agent = request.agent(app);
    const _csrf = await getCsrfToken(agent, '/login');

    const res = await agent.post('/login').type('form').send({ _csrf, username, password });

    expect(res.status).toBe(401);
    expect(res.text).toContain('Invalid username or password.');
    expect(res.text).toContain('name="_csrf"');
    const dashboard = await agent.get('/');
    expect(dashboard.status).toBe(302);
    expect(dashboard.headers.location).toBe('/login');
  });

  it('keeps the submitted username but never echoes the password', async () => {
    const agent = request.agent(app);
    const _csrf = await getCsrfToken(agent, '/login');

    const res = await agent.post('/login').type('form').send({ _csrf, username: TEST_USERNAME, password: 'typo-pass' });

    expect(res.text).toContain(`value="${TEST_USERNAME}"`);
    expect(res.text).not.toContain('typo-pass');
  });

  it('escapes the echoed username', async () => {
    const agent = request.agent(app);
    const _csrf = await getCsrfToken(agent, '/login');

    const res = await agent.post('/login').type('form').send({ _csrf, username: '"><script>x</script>', password: 'x' });

    expect(res.text).not.toContain('<script>x</script>');
    expect(res.text).toContain('&lt;script&gt;');
  });

  it.each(['/', '/targets/1', '/does-not-exist'])('redirects an unauthenticated GET %s to /login', async (path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('sends a signed-in user from /login to the dashboard', async () => {
    const agent = await loginAgent(app);
    const res = await agent.get('/login');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });

  it('returns a 404 page for an unknown path once signed in', async () => {
    const agent = await loginAgent(app);
    const res = await agent.get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.text).toContain('Not found');
  });

  describe('CSRF', () => {
    it('rejects POST /login without a token', async () => {
      const agent = request.agent(app);
      await agent.get('/login');

      const res = await agent.post('/login').type('form').send({ username: TEST_USERNAME, password: TEST_PASSWORD });

      expect(res.status).toBe(403);
      expect(res.text).toContain('security token');
    });

    it('rejects POST /login with a wrong token', async () => {
      const agent = request.agent(app);
      await getCsrfToken(agent, '/login');

      const res = await agent
        .post('/login')
        .type('form')
        .send({ _csrf: 'not-the-token', username: TEST_USERNAME, password: TEST_PASSWORD });

      expect(res.status).toBe(403);
    });

    it('rejects a token taken from another session', async () => {
      const _csrf = await getCsrfToken(request.agent(app), '/login');
      const other = request.agent(app);
      await other.get('/login');

      const res = await other.post('/login').type('form').send({ _csrf, username: TEST_USERNAME, password: TEST_PASSWORD });

      expect(res.status).toBe(403);
    });

    it('rejects a token sent as a header instead of the _csrf field', async () => {
      const agent = request.agent(app);
      const token = await getCsrfToken(agent, '/login');

      const res = await agent
        .post('/login')
        .set('x-csrf-token', token)
        .type('form')
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD });

      expect(res.status).toBe(403);
    });

    it('rejects POST /logout without a token and keeps the user signed in', async () => {
      const agent = await loginAgent(app);

      const res = await agent.post('/logout').type('form').send({});

      expect(res.status).toBe(403);
      expect((await agent.get('/')).status).toBe(200);
    });
  });

  it('logout ends the session', async () => {
    const agent = await loginAgent(app);
    const _csrf = await getCsrfToken(agent, '/');

    const logout = await agent.post('/logout').type('form').send({ _csrf });
    expect(logout.status).toBe(302);
    expect(logout.headers.location).toBe('/login');

    const loginPage = await agent.get('/login');
    expect(loginPage.status).toBe(200);
    expect(loginPage.text).toContain('Signed out.');
    expect((await agent.get('/')).headers.location).toBe('/login');
  });

  it('a session cookie copied before logout no longer works afterwards', async () => {
    const agent = request.agent(app);
    const _csrfLogin = await getCsrfToken(agent, '/login');
    const login = await agent
      .post('/login')
      .type('form')
      .send({ _csrf: _csrfLogin, username: TEST_USERNAME, password: TEST_PASSWORD });
    const stolen = sessionCookie(login)!.split(';')[0];

    expect((await request(app).get('/').set('Cookie', stolen)).status).toBe(200);

    const _csrf = await getCsrfToken(agent, '/');
    await agent.post('/logout').type('form').send({ _csrf });

    const res = await request(app).get('/').set('Cookie', stolen);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });
});
