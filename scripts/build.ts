import { copyFileSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.join(import.meta.dirname, '..');
const fromRoot = (...parts: string[]) => path.join(root, ...parts);

/** `npm run build [folder]` writes a ready-to-run copy of the app there, replacing whatever the folder held. */
const outDir = path.resolve(process.argv[2] ?? fromRoot('release', 'cert-monitor'));
const toRelease = (...parts: string[]) => path.join(outDir, ...parts);

rmSync(outDir, { recursive: true, force: true });

await build({
  entryPoints: [fromRoot('src', 'index.ts')],
  outfile: toRelease('server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // A native module can't go inside a bundle. It is copied next to it below.
  external: ['better-sqlite3'],
  define: { __BUNDLED__: 'true' },
  // CommonJS dependencies still call require() for Node's built-ins, and ESM has no require.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'warning',
});

cpSync(fromRoot('src', 'web', 'views'), toRelease('views'), { recursive: true });
cpSync(fromRoot('src', 'db', 'migrations'), toRelease('migrations'), { recursive: true });
cpSync(fromRoot('public'), toRelease('public'), { recursive: true });

// Binaries for every platform are included, so the same folder runs on Linux, macOS and Windows.
const sqliteFrom = fromRoot('node_modules', 'better-sqlite3');
const sqliteTo = toRelease('node_modules', 'better-sqlite3');
mkdirSync(sqliteTo, { recursive: true });
for (const name of ['lib', 'prebuilds', 'package.json', 'LICENSE']) {
  cpSync(path.join(sqliteFrom, name), path.join(sqliteTo, name), { recursive: true });
}

// Always the sample file, never the local .env, which holds real credentials.
copyFileSync(fromRoot('.env.example'), toRelease('.env'));
copyFileSync(fromRoot('scripts', 'release-README.md'), toRelease('README.md'));
copyFileSync(fromRoot('LICENSE'), toRelease('LICENSE'));

console.log(`Release ready: ${outDir}`);
