import net from 'node:net';
import tls from 'node:tls';
import { generate } from 'selfsigned';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fetchCertificate, parseSubjectAltNames } from '../../src/core/certFetcher';

const now = () => new Date('2026-10-31T00:00:00.000Z');

interface Pems {
  key: string;
  cert: string;
}

async function makeCert(notBeforeDate: Date, notAfterDate: Date): Promise<Pems> {
  const pems = await generate([{ name: 'commonName', value: 'localhost' }], {
    keyType: 'ec',
    algorithm: 'sha256',
    notBeforeDate,
    notAfterDate,
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
        ],
      },
    ],
  });
  return { key: pems.private, cert: pems.cert };
}

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function listen(server: net.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as net.AddressInfo).port;
}

/** Starts a TLS server on a random port. `servernames` collects the SNI of every client that sent one. */
async function startTlsServer(pems: Pems) {
  const servernames: string[] = [];
  const server = tls.createServer(
    {
      ...pems,
      SNICallback: (servername, callback) => {
        servernames.push(servername);
        callback(null);
      },
    },
    (socket) => socket.end(),
  );
  server.on('tlsClientError', () => {});
  const port = await listen(server);
  cleanups.push(() => new Promise((resolve) => server.close(() => resolve())));
  return { port, servernames };
}

/** A TCP server that accepts connections and never says anything back. */
async function startSilentServer(): Promise<number> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
  });
  const port = await listen(server);
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return port;
}

async function closedPort(): Promise<number> {
  const server = net.createServer();
  const port = await listen(server);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe('fetchCertificate', () => {
  let valid: Pems;
  let expired: Pems;

  beforeAll(async () => {
    valid = await makeCert(new Date('2026-01-01T00:00:00Z'), new Date('2027-01-01T00:00:00Z'));
    expired = await makeCert(new Date('2025-01-01T00:00:00Z'), new Date('2025-06-01T00:00:00Z'));
  });

  it('reads a valid self-signed certificate', async () => {
    const { port } = await startTlsServer(valid);

    const result = await fetchCertificate('127.0.0.1', port, { now });

    expect(result).toMatchObject({
      status: 'OK',
      daysLeft: 62,
      subject: 'CN=localhost',
      issuer: 'CN=localhost',
      sans: ['localhost', '127.0.0.1'],
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: '2027-01-01T00:00:00.000Z',
      authorized: false,
      error: null,
    });
    expect(result.authorizationError).toMatch(/SELF_SIGNED/);
  });

  it('classifies an expired certificate as EXPIRED', async () => {
    const { port } = await startTlsServer(expired);

    const result = await fetchCertificate('127.0.0.1', port, { now });

    expect(result.status).toBe('EXPIRED');
    expect(result.daysLeft).toBe(-517);
    expect(result.validTo).toBe('2025-06-01T00:00:00.000Z');
    expect(result.authorized).toBe(false);
    expect(result.error).toBeNull();
  });

  it('uses the real clock when no `now` is given', async () => {
    const { port } = await startTlsServer(expired);
    const result = await fetchCertificate('127.0.0.1', port);
    expect(result.status).toBe('EXPIRED');
  });

  it('sends SNI for a hostname but not for an IP (decision 2)', async () => {
    const { port, servernames } = await startTlsServer(valid);

    await fetchCertificate('localhost', port, { now });
    await fetchCertificate('127.0.0.1', port, { now });

    expect(servernames).toEqual(['localhost']);
  });

  it('returns ERROR for a closed port', async () => {
    const port = await closedPort();

    const result = await fetchCertificate('127.0.0.1', port, { now });

    expect(result).toMatchObject({ status: 'ERROR', daysLeft: null, validTo: null, authorized: null });
    expect(result.error).toMatch(/ECONNREFUSED/);
  });

  it('returns ERROR within the timeout when the server never answers', async () => {
    const port = await startSilentServer();
    const started = Date.now();

    const result = await fetchCertificate('127.0.0.1', port, { timeoutMs: 200, now });

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result.status).toBe('ERROR');
    expect(result.error).toMatch(/Timed out after 200 ms/);
  });

  it('returns ERROR instead of throwing for an invalid port', async () => {
    const result = await fetchCertificate('127.0.0.1', 70_000, { now });
    expect(result.status).toBe('ERROR');
    expect(result.error).toBeTruthy();
  });
});

describe('parseSubjectAltNames', () => {
  it('returns the values of every entry', () => {
    expect(parseSubjectAltNames('DNS:example.com, DNS:*.example.com, IP Address:10.0.0.1')).toEqual([
      'example.com',
      '*.example.com',
      '10.0.0.1',
    ]);
  });

  it('unquotes values that Node JSON-quoted', () => {
    expect(parseSubjectAltNames('DNS:"a, b.example.com", DNS:c.example.com')).toEqual([
      'a, b.example.com',
      'c.example.com',
    ]);
  });

  it('returns an empty list when there are no SANs', () => {
    expect(parseSubjectAltNames(undefined)).toEqual([]);
    expect(parseSubjectAltNames('')).toEqual([]);
  });
});
