export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
}

export interface Config {
  port: number;
  sessionSecret: string;
  adminUsername: string;
  adminPassword: string;
  databasePath: string;
  smtp: SmtpConfig;
  mailFrom: string;
  isProduction: boolean;
}

export const DEFAULT_PORT = 3000;
export const DEFAULT_DATABASE_PATH = './data/certs.db';
export const DEFAULT_SMTP_PORT = 587;
export const DEFAULT_MAIL_FROM = 'Cert Monitor <certs@localhost>';

const REQUIRED_VARS = ['ADMIN_USERNAME', 'ADMIN_PASSWORD', 'SESSION_SECRET'] as const;

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env): Config {
  const missing = REQUIRED_VARS.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }

  return {
    port: parsePort('PORT', env.PORT, DEFAULT_PORT),
    sessionSecret: env.SESSION_SECRET!,
    adminUsername: env.ADMIN_USERNAME!,
    adminPassword: env.ADMIN_PASSWORD!,
    databasePath: valueOr(env.DATABASE_PATH, DEFAULT_DATABASE_PATH),
    smtp: {
      host: env.SMTP_HOST?.trim() ?? '',
      port: parsePort('SMTP_PORT', env.SMTP_PORT, DEFAULT_SMTP_PORT),
      user: env.SMTP_USER ?? '',
      pass: env.SMTP_PASS ?? '',
    },
    mailFrom: valueOr(env.MAIL_FROM, DEFAULT_MAIL_FROM),
    isProduction: env.NODE_ENV === 'production',
  };
}

function valueOr(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

function parsePort(name: string, value: string | undefined, fallback: number): number {
  const raw = value?.trim();
  if (!raw) return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid ${name}: "${raw}" (expected an integer from 1 to 65535)`);
  }
  return port;
}
