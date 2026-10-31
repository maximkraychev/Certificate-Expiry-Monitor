import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/connection';
import { insertRecipient, listRecipients } from '../../src/db/repositories/recipients';
import { createTestApp, getCsrfToken, loginAgent, TEST_NOW } from '../helpers';

type TestApp = ReturnType<typeof createTestApp>;
type Agent = Awaited<ReturnType<typeof loginAgent>>;

describe('recipients page', () => {
  let app: TestApp['app'];
  let db: Database;
  let agent: Agent;

  beforeEach(async () => {
    ({ app, db } = createTestApp());
    agent = await loginAgent(app);
  });

  afterEach(() => {
    db.close();
  });

  function seedRecipient(email = 'ops@example.com') {
    return insertRecipient(db, { email, createdAt: TEST_NOW.toISOString() });
  }

  async function post(path: string, fields: Record<string, string> = {}) {
    const _csrf = await getCsrfToken(agent, '/recipients');
    return agent.post(path).type('form').send({ _csrf, ...fields });
  }

  it('shows the add form and an empty state when there are no recipients', async () => {
    const res = await agent.get('/recipients');

    expect(res.status).toBe(200);
    expect(res.text).toContain('<h1>Recipients</h1>');
    expect(res.text).toContain('action="/recipients"');
    expect(res.text).toContain('name="email"');
    expect(res.text).toContain('No recipients yet.');
  });

  it('has a nav link to the page', async () => {
    expect((await agent.get('/')).text).toContain('<a href="/recipients">Recipients</a>');
  });

  describe('POST /recipients', () => {
    it('adds the normalized address and lists it', async () => {
      const res = await post('/recipients', { email: '  Ops@Example.COM ' });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/recipients');
      const [recipient] = listRecipients(db);
      expect(recipient).toMatchObject({ email: 'ops@example.com', createdAt: TEST_NOW.toISOString() });

      const page = await agent.get('/recipients');
      expect(page.text).toContain('Added ops@example.com.');
      expect(page.text).toContain('<td>ops@example.com</td>');
      // Added at TEST_NOW (08:00 UTC), shown in Sofia time.
      expect(page.text).toContain('31 Oct 2026, 10:00');
      expect(page.text).toContain(`action="/recipients/${recipient.id}/delete"`);
      expect(page.text).not.toContain('No recipients yet.');
    });

    it('rejects an invalid address with a flash and stores nothing', async () => {
      const res = await post('/recipients', { email: 'not-an-email' });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/recipients');
      expect(listRecipients(db)).toEqual([]);

      const page = await agent.get('/recipients');
      expect(page.text).toContain('flash-error');
      expect(page.text).toContain('is not a valid email address.');
    });

    it('rejects a missing address', async () => {
      await post('/recipients');

      expect(listRecipients(db)).toEqual([]);
      expect((await agent.get('/recipients')).text).toContain('Enter an email address.');
    });

    it('rejects a duplicate with a friendly flash instead of a 500', async () => {
      seedRecipient();

      const res = await post('/recipients', { email: 'OPS@example.com' });

      expect(res.status).toBe(302);
      expect(listRecipients(db)).toHaveLength(1);
      expect((await agent.get('/recipients')).text).toContain('ops@example.com is already a recipient.');
    });

    it('escapes user input echoed in the flash', async () => {
      await post('/recipients', { email: '<script>alert(1)</script>' });

      const page = await agent.get('/recipients');
      expect(page.text).not.toContain('<script>alert(1)</script>');
      expect(page.text).toContain('&lt;script&gt;');
    });
  });

  describe('POST /recipients/:id/delete', () => {
    it('removes the recipient', async () => {
      const recipient = seedRecipient();
      seedRecipient('other@example.com');

      const res = await post(`/recipients/${recipient.id}/delete`);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/recipients');
      expect(listRecipients(db)).toMatchObject([{ email: 'other@example.com' }]);
      expect((await agent.get('/recipients')).text).toContain('Removed ops@example.com.');
    });

    it.each(['999', 'abc', '0', '-1'])('is 404 for id %s and removes nothing', async (id) => {
      seedRecipient();

      const res = await post(`/recipients/${id}/delete`);

      expect(res.status).toBe(404);
      expect(res.text).toContain('Not found');
      expect(listRecipients(db)).toHaveLength(1);
    });
  });

  describe('dashboard hint', () => {
    it('shows a link to /recipients while the list is empty', async () => {
      const res = await agent.get('/');

      expect(res.text).toContain('id="no-recipients"');
      expect(res.text).toContain('<a href="/recipients">Add at least one recipient</a>');
    });

    it('is hidden once there is a recipient, and back when the last one is removed', async () => {
      const recipient = seedRecipient();
      expect((await agent.get('/')).text).not.toContain('id="no-recipients"');

      await post(`/recipients/${recipient.id}/delete`);
      expect((await agent.get('/')).text).toContain('id="no-recipients"');
    });
  });

  describe('CSRF', () => {
    it('POST /recipients without a token is 403 and adds nothing', async () => {
      const res = await agent.post('/recipients').type('form').send({ email: 'ops@example.com' });

      expect(res.status).toBe(403);
      expect(res.text).toContain('security token');
      expect(listRecipients(db)).toEqual([]);
    });

    it('POST /recipients/:id/delete without a token is 403 and removes nothing', async () => {
      const recipient = seedRecipient();

      const res = await agent.post(`/recipients/${recipient.id}/delete`).type('form').send({});

      expect(res.status).toBe(403);
      expect(listRecipients(db)).toHaveLength(1);
    });
  });

  it.each([
    ['GET', '/recipients'],
    ['POST', '/recipients'],
    ['POST', '/recipients/1/delete'],
  ])('%s %s redirects to /login when signed out', async (method, path) => {
    seedRecipient();
    const anonymous = request.agent(app);
    const _csrf = await getCsrfToken(anonymous, '/login');

    const res =
      method === 'GET'
        ? await anonymous.get(path)
        : await anonymous.post(path).type('form').send({ _csrf, email: 'new@example.com' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
    expect(listRecipients(db)).toMatchObject([{ email: 'ops@example.com' }]);
  });
});
