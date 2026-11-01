import { existsSync } from 'node:fs';
import path from 'node:path';
import { assertReadyForDeployment, loadConfig, type Config } from './config';
import { fetchCertificate } from './core/certFetcher';
import { openDatabase } from './db/connection';
import { runMigrations } from './db/migrate';
import { createMailer } from './mail/transport';
import { IS_BUNDLED, PROJECT_ROOT } from './paths';
import { startScheduler } from './scheduler';
import { runNotificationJob } from './services/notifications';
import { createApp } from './web/app';

/** How long a shutdown may wait for a running job and open connections before the process just exits. */
const SHUTDOWN_TIMEOUT_MS = 30_000;

const envFile = path.join(PROJECT_ROOT, '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

let config: Config;
try {
  config = loadConfig();
  if (config.isProduction || IS_BUNDLED) {
    assertReadyForDeployment(config);
  }
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

if (config.isProduction) {
  console.log('NODE_ENV=production: serve this through an HTTPS reverse proxy. Over plain HTTP, login will not work.');
}

// A relative DATABASE_PATH is relative to the project root, not the current directory.
const databasePath = path.resolve(PROJECT_ROOT, config.databasePath);
const db = openDatabase(databasePath);
const schemaVersion = runMigrations(db);
console.log(`Database ready: ${databasePath} (schema version ${schemaVersion})`);

const mailer = createMailer(config);
if (config.smtp.host === '') {
  console.log('SMTP_HOST is empty: mail goes to an Ethereal test account and preview URLs are logged.');
}
const deps = { fetchCertificate, sendMail: mailer.sendMail, now: () => new Date() };

const app = createApp({ db, config, deps });
const server = app.listen(config.port, () => {
  console.log(`Listening on http://localhost:${config.port}`);
});

const scheduler = startScheduler(async () => {
  const result = await runNotificationJob(db, deps);
  console.log(`Notification job: ${result.log.summary} (${result.log.recipientsCount} sent)`);
});

/** Stops cron, waits for a run in progress, then closes the server, the mailer and the DB. */
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) {
    console.log(`${signal} again: exiting now`);
    process.exit(1);
  }
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);
  setTimeout(() => {
    console.error('Shutdown took too long, exiting');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  await scheduler.stop();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
  mailer.close();
  db.close();
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void shutdown(signal));
}
