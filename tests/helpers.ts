import type { Express } from 'express';
import request from 'supertest';
import { vi } from 'vitest';
import type { Config } from '../src/config';
import type { CertCheck } from '../src/core/certFetcher';
import { openDatabase, type Database } from '../src/db/connection';
import { runMigrations } from '../src/db/migrate';
import type { SendMail } from '../src/mail/digest';
import { createApp, type AppDeps } from '../src/web/app';

/** A fresh in-memory database with every migration applied. */
export function createTestDb(): Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

export const TEST_USERNAME = 'admin';
export const TEST_PASSWORD = 'correct horse battery staple';
export const TEST_NOW = new Date('2026-10-31T08:00:00.000Z');

export const testConfig: Config = {
  port: 0,
  sessionSecret: 'test-session-secret',
  adminUsername: TEST_USERNAME,
  adminPassword: TEST_PASSWORD,
  databasePath: ':memory:',
  smtp: { host: '', port: 587, user: '', pass: '' },
  mailFrom: 'Cert Monitor <certs@localhost>',
  isProduction: false,
};

export function okCertCheck(overrides: Partial<CertCheck> = {}): CertCheck {
  return {
    status: 'OK',
    daysLeft: 90,
    subject: 'CN=example.com',
    issuer: "CN=Let's Encrypt",
    sans: ['example.com'],
    validFrom: '2026-10-01T00:00:00.000Z',
    validTo: '2027-01-29T08:00:00.000Z',
    authorized: true,
    authorizationError: null,
    error: null,
    ...overrides,
  };
}

/** Deps with no network and a fixed clock. Each fake is a `vi.fn` so tests can inspect or override it. */
export function createFakeDeps() {
  return {
    fetchCertificate: vi.fn<AppDeps['fetchCertificate']>(async () => okCertCheck()),
    sendMail: vi.fn<SendMail>(async () => {}),
    now: vi.fn(() => new Date(TEST_NOW)),
  } satisfies AppDeps;
}

export function createTestApp(configOverrides: Partial<Config> = {}) {
  const db = createTestDb();
  const config = { ...testConfig, ...configOverrides };
  const deps = createFakeDeps();
  const app = createApp({ db, config, deps, clearExpiredSessions: false });
  return { app, db, config, deps };
}

type Agent = ReturnType<typeof request.agent>;

/** Loads `path` with the agent (so the session cookie is kept) and pulls the CSRF token out of the HTML. */
export async function getCsrfToken(agent: Agent, path: string): Promise<string> {
  const res = await agent.get(path);
  const match = /name="_csrf" value="([^"]+)"/.exec(res.text);
  if (!match) {
    throw new Error(`No _csrf field on ${path} (status ${res.status})`);
  }
  return match[1];
}

/** A supertest agent that is signed in. */
export async function loginAgent(app: Express): Promise<Agent> {
  const agent = request.agent(app);
  const _csrf = await getCsrfToken(agent, '/login');
  const res = await agent.post('/login').type('form').send({ _csrf, username: TEST_USERNAME, password: TEST_PASSWORD });
  if (res.status !== 302 || res.headers.location !== '/') {
    throw new Error(`Login failed with status ${res.status}`);
  }
  return agent;
}
