import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.join(import.meta.dirname, '..', '..');
const STARTUP_TIMEOUT_MS = 15_000;

/** Only what Node needs, so nothing from this process or the test runner reaches the release. */
const cleanEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot };

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

function waitForListening(server: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Server did not start:\n${output}`)), STARTUP_TIMEOUT_MS);
    const onData = (chunk: Buffer) => {
      output += chunk;
      if (output.includes('Listening on')) {
        clearTimeout(timer);
        resolve();
      }
    };
    server.stdout!.on('data', onData);
    server.stderr!.on('data', onData);
    server.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited with ${code}:\n${output}`));
    });
  });
}

describe('npm run build', () => {
  let outDir: string;

  beforeAll(() => {
    // Outside the project, so the release can't lean on the project's node_modules.
    outDir = mkdtempSync(path.join(tmpdir(), 'cert-monitor-release-'));
    execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'scripts/build.ts', outDir], {
      cwd: ROOT,
      stdio: 'pipe',
    });
  }, 60_000);

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  it('ships the sample .env, never the local one', () => {
    expect(readFileSync(path.join(outDir, '.env'), 'utf8')).toBe(readFileSync(path.join(ROOT, '.env.example'), 'utf8'));
  });

  it('refuses to start until the sample .env is edited, and says what to fix', () => {
    const result = spawnSync(process.execPath, ['server.mjs'], { cwd: outDir, env: cleanEnv, encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ADMIN_PASSWORD');
    expect(result.stderr).toContain('SESSION_SECRET');
    expect(result.stderr).toContain('SMTP_HOST');
    expect(existsSync(path.join(outDir, 'data'))).toBe(false);
  }, 30_000);

  it('runs from an edited .env: login, pages, database and static files', async () => {
    const port = await freePort();
    const closedPort = await freePort();
    writeFileSync(
      path.join(outDir, '.env'),
      [`PORT=${port}`, 'SESSION_SECRET=a-real-secret', 'ADMIN_USERNAME=ops', 'ADMIN_PASSWORD=a-real-password', 'SMTP_HOST=127.0.0.1'].join('\n'),
    );

    // Started from another directory, as a service manager would.
    const server = spawn(process.execPath, [path.join(outDir, 'server.mjs')], { cwd: tmpdir(), env: cleanEnv });
    const exited = new Promise((resolve) => server.once('exit', resolve));
    const base = `http://127.0.0.1:${port}`;
    let cookie = '';

    const send = async (url: string, form?: Record<string, string>) => {
      const res = await fetch(base + url, {
        redirect: 'manual',
        method: form ? 'POST' : 'GET',
        headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form ? new URLSearchParams(form) : undefined,
      });
      const setCookie = res.headers.getSetCookie()[0];
      if (setCookie) cookie = setCookie.split(';')[0];
      return { status: res.status, text: await res.text() };
    };
    const csrfFrom = (html: string) => /name="_csrf" value="([^"]+)"/.exec(html)![1];

    try {
      await waitForListening(server);

      const loginPage = await send('/login');
      expect(loginPage.status).toBe(200);
      const login = await send('/login', { _csrf: csrfFrom(loginPage.text), username: 'ops', password: 'a-real-password' });
      expect(login.status).toBe(302);

      const dashboard = await send('/');
      expect(dashboard.status).toBe(200);
      // A closed local port: the check fails fast, without leaving this machine.
      const added = await send('/targets', { _csrf: csrfFrom(dashboard.text), host: '127.0.0.1', port: String(closedPort) });
      expect(added.status).toBe(302);
      expect((await send('/')).text).toContain(`127.0.0.1:${closedPort}`);

      expect((await send('/style.css')).status).toBe(200);
      expect(existsSync(path.join(outDir, 'data', 'certs.db'))).toBe(true);
    } finally {
      server.kill();
      await exited;
    }
  }, 30_000);
});
