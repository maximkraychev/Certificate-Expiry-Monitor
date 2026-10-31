import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, type Config } from './config';
import { openDatabase } from './db/connection';
import { runMigrations } from './db/migrate';

const projectRoot = path.join(import.meta.dirname, '..');
const envFile = path.join(projectRoot, '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

let config: Config;
try {
  config = loadConfig();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

// A relative DATABASE_PATH is relative to the project root, not the current directory.
const databasePath = path.resolve(projectRoot, config.databasePath);
const db = openDatabase(databasePath);
const schemaVersion = runMigrations(db);
console.log(`Database ready: ${databasePath} (schema version ${schemaVersion})`);

// The web server and scheduler get wired in here by later tasks.
