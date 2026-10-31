import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, type Config } from './config';

const envFile = path.join(import.meta.dirname, '..', '.env');
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

// The database, web server and scheduler get wired in here by later tasks.
console.log(`Config loaded (port ${config.port}, database ${config.databasePath})`);
