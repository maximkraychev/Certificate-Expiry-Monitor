import path from 'node:path';

// Set to true by scripts/build.ts. Undefined when running from source.
declare const __BUNDLED__: boolean | undefined;

/** True in a release built by `npm run build`, where everything sits next to `server.mjs`. */
export const IS_BUNDLED = typeof __BUNDLED__ !== 'undefined';

const here = import.meta.dirname;

/** The folder that holds `.env`, `public/`, and a relative `DATABASE_PATH`. */
export const PROJECT_ROOT = IS_BUNDLED ? here : path.join(here, '..');
export const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
export const VIEWS_DIR = IS_BUNDLED ? path.join(here, 'views') : path.join(here, 'web', 'views');
export const MIGRATIONS_DIR = IS_BUNDLED ? path.join(here, 'migrations') : path.join(here, 'db', 'migrations');
