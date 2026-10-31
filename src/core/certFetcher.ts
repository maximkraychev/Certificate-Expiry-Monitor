import net from 'node:net';
import tls from 'node:tls';
import { calculateDaysLeft, calculateStatus, type Status } from './status';

/** Overall deadline for connect + TLS handshake (decision 2). */
export const CONNECT_TIMEOUT_MS = 10_000;

export interface CertCheck {
  status: Status;
  daysLeft: number | null;
  subject: string | null;
  issuer: string | null;
  sans: string[];
  /** ISO-8601 UTC. */
  validFrom: string | null;
  /** ISO-8601 UTC. */
  validTo: string | null;
  /** Whether the chain and hostname verified. Null when no handshake happened. */
  authorized: boolean | null;
  /** OpenSSL / Node code such as `DEPTH_ZERO_SELF_SIGNED_CERT` or `ERR_TLS_CERT_ALTNAME_INVALID`. */
  authorizationError: string | null;
  /** Set only when status is ERROR. */
  error: string | null;
}

export interface FetchCertificateOptions {
  timeoutMs?: number;
  now?: () => Date;
}

export type FetchCertificate = (host: string, port?: number, options?: FetchCertificateOptions) => Promise<CertCheck>;

/** Connects to host:port, reads the peer certificate and classifies it. Never throws: failures come back as ERROR. */
export function fetchCertificate(
  host: string,
  port = 443,
  { timeoutMs = CONNECT_TIMEOUT_MS, now = () => new Date() }: FetchCertificateOptions = {},
): Promise<CertCheck> {
  return new Promise((resolve) => {
    let socket: tls.TLSSocket | undefined;
    let settled = false;

    const finish = (result: CertCheck) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket?.destroy();
      resolve(result);
    };

    const timer = setTimeout(
      () => finish(errorCheck(`Timed out after ${timeoutMs} ms connecting to ${host}:${port}`)),
      timeoutMs,
    );

    try {
      socket = tls.connect({
        host,
        port,
        servername: net.isIP(host) ? undefined : host,
        rejectUnauthorized: false,
      });
    } catch (err) {
      finish(errorCheck(messageOf(err)));
      return;
    }

    // `on`, not `once`: a late error after destroy() must still have a listener.
    socket.on('secureConnect', () => {
      try {
        finish(readCertificate(socket!, now()));
      } catch (err) {
        finish(errorCheck(`Could not read the certificate: ${messageOf(err)}`));
      }
    });
    socket.on('error', (err) => finish(errorCheck(err.message)));
    socket.on('close', () => finish(errorCheck('Connection closed before the TLS handshake finished')));
  });
}

function readCertificate(socket: tls.TLSSocket, now: Date): CertCheck {
  const cert = socket.getPeerCertificate();
  if (!cert || Object.keys(cert).length === 0) {
    return errorCheck('The server did not present a certificate');
  }

  const details = {
    subject: formatName(cert.subject),
    issuer: formatName(cert.issuer),
    sans: parseSubjectAltNames(cert.subjectaltname),
    authorized: socket.authorized,
    authorizationError: authorizationErrorOf(socket),
  };

  const validFrom = new Date(cert.valid_from);
  const validTo = new Date(cert.valid_to);
  if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validTo.getTime())) {
    return {
      ...errorCheck(`Could not parse the certificate dates ("${cert.valid_from}", "${cert.valid_to}")`),
      ...details,
    };
  }

  const daysLeft = calculateDaysLeft(validTo, now);
  return {
    status: calculateStatus(daysLeft),
    daysLeft,
    ...details,
    validFrom: validFrom.toISOString(),
    validTo: validTo.toISOString(),
    error: null,
  };
}

/**
 * Splits Node's `subjectaltname` string (`DNS:a.com, IP Address:1.2.3.4`) into its values.
 * Node JSON-quotes values that contain commas or quotes, e.g. `DNS:"a, b"`.
 */
export function parseSubjectAltNames(subjectAltName: string | undefined): string[] {
  if (!subjectAltName) return [];
  const entry = /(?:^|, )[^:,]+:("(?:[^"\\]|\\.)*"|[^,]*)/g;
  return [...subjectAltName.matchAll(entry)].map(([, value]) =>
    value.startsWith('"') ? (JSON.parse(value) as string) : value,
  );
}

function formatName(name: object | undefined): string | null {
  if (!name) return null;
  const parts = Object.entries(name).flatMap(([key, value]) =>
    (Array.isArray(value) ? value : [value]).map((v) => `${key}=${String(v)}`),
  );
  return parts.length > 0 ? parts.join(', ') : null;
}

function authorizationErrorOf(socket: tls.TLSSocket): string | null {
  // Typed as Error, but at runtime Node stores the error code (a string).
  const value = socket.authorizationError as unknown;
  if (!value) return null;
  return value instanceof Error ? value.message : String(value);
}

function errorCheck(error: string): CertCheck {
  return {
    status: 'ERROR',
    daysLeft: null,
    subject: null,
    issuer: null,
    sans: [],
    validFrom: null,
    validTo: null,
    authorized: null,
    authorizationError: null,
    error,
  };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
