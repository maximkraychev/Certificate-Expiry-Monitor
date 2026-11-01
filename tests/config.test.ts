import { describe, expect, it } from 'vitest';
import {
  assertReadyForDeployment,
  DEFAULT_DATABASE_PATH,
  DEFAULT_PORT,
  loadConfig,
  SAMPLE_ADMIN_PASSWORD,
  SAMPLE_SESSION_SECRET,
} from '../src/config';

const required = {
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD: 'secret',
  SESSION_SECRET: 'session-secret',
};

describe('loadConfig', () => {
  it.each(Object.keys(required))('throws naming %s when it is missing', (name) => {
    const env: Record<string, string> = { ...required };
    delete env[name];
    expect(() => loadConfig(env)).toThrow(name);
  });

  it('treats a blank required variable as missing', () => {
    expect(() => loadConfig({ ...required, ADMIN_PASSWORD: '   ' })).toThrow('ADMIN_PASSWORD');
  });

  it('names every missing variable at once', () => {
    expect(() => loadConfig({})).toThrow(/ADMIN_USERNAME, ADMIN_PASSWORD, SESSION_SECRET/);
  });

  it('defaults PORT and DATABASE_PATH', () => {
    const config = loadConfig(required);
    expect(config.port).toBe(DEFAULT_PORT);
    expect(config.port).toBe(3000);
    expect(config.databasePath).toBe(DEFAULT_DATABASE_PATH);
    expect(config.databasePath).toBe('./data/certs.db');
  });

  it('reads all values from env', () => {
    const config = loadConfig({
      ...required,
      PORT: '8080',
      DATABASE_PATH: '/tmp/test.db',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '465',
      SMTP_USER: 'user',
      SMTP_PASS: 'pass',
      MAIL_FROM: 'alerts@example.com',
      NODE_ENV: 'production',
    });
    expect(config).toEqual({
      port: 8080,
      sessionSecret: 'session-secret',
      adminUsername: 'admin',
      adminPassword: 'secret',
      databasePath: '/tmp/test.db',
      smtp: { host: 'smtp.example.com', port: 465, user: 'user', pass: 'pass' },
      mailFrom: 'alerts@example.com',
      isProduction: true,
    });
  });

  it('leaves SMTP_HOST empty when unset (Ethereal fallback)', () => {
    expect(loadConfig(required).smtp.host).toBe('');
  });

  it.each(['abc', '0', '70000', '3.5'])('rejects invalid PORT %s', (port) => {
    expect(() => loadConfig({ ...required, PORT: port })).toThrow(/Invalid PORT/);
  });
});

describe('assertReadyForDeployment', () => {
  const ready = { ...required, SMTP_HOST: 'smtp.example.com' };

  it('accepts real values', () => {
    expect(() => assertReadyForDeployment(loadConfig(ready))).not.toThrow();
  });

  it.each([
    ['ADMIN_PASSWORD', { ...ready, ADMIN_PASSWORD: SAMPLE_ADMIN_PASSWORD }],
    ['SESSION_SECRET', { ...ready, SESSION_SECRET: SAMPLE_SESSION_SECRET }],
    ['SMTP_HOST', { ...ready, SMTP_HOST: '' }],
  ])('rejects a bad %s', (name, env) => {
    expect(() => assertReadyForDeployment(loadConfig(env))).toThrow(name);
  });

  it('lists every problem at once', () => {
    const config = loadConfig({
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: SAMPLE_ADMIN_PASSWORD,
      SESSION_SECRET: SAMPLE_SESSION_SECRET,
    });
    expect(() => assertReadyForDeployment(config)).toThrow(/ADMIN_PASSWORD[\s\S]*SESSION_SECRET[\s\S]*SMTP_HOST/);
  });
});
