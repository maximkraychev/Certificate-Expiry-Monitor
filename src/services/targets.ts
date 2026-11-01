import net from 'node:net';
import { domainToASCII } from 'node:url';
import BetterSqlite3 from 'better-sqlite3';
import type { Status } from '../core/status';
import type { Database } from '../db/connection';
import * as targets from '../db/repositories/targets';
import type { Target, TargetWithLatestCheck } from '../db/repositories/targets';

export const DEFAULT_PORT = 443;

export interface TargetInput {
  host: string;
  port: number;
}

export type ParseTargetResult = { ok: true; value: TargetInput } | { ok: false; error: string };
export type AddTargetResult = { ok: true; target: Target } | { ok: false; error: string };

export interface TargetDeps {
  now: () => Date;
}

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const PORT_ERROR = 'Port must be a whole number from 1 to 65535.';
/** What to look at first. ERROR sits below the known problems: the certificate may well be fine. */
const URGENCY: Readonly<Record<Status, number>> = { EXPIRED: 0, CRITICAL: 1, WARNING: 2, ERROR: 3, OK: 4 };
const NEVER_CHECKED_URGENCY = 5;

/**
 * Normalizes the add-target form (decision 5). The host is trimmed and lowercased, and a pasted URL is cut
 * down to its host: `https://Example.com:8443/path` gives `example.com`, port 8443. A port in the host is
 * used only when the Port field is blank or says the same; an empty Port means 443.
 */
export function parseTargetInput(input: { host: string; port: string }): ParseTargetResult {
  const hostPart = input.host
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '');
  if (hostPart === '') {
    return { ok: false, error: 'Enter a host name or IP address.' };
  }

  const split = splitHostPort(hostPart);
  const host = split && normalizeHost(split.host);
  if (!split || !host) {
    return { ok: false, error: `"${input.host.trim()}" is not a valid host name or IP address.` };
  }

  const portField = input.port.trim();
  const hostPort = split.port ? parsePort(split.port) : undefined;
  const port = portField ? parsePort(portField) : (hostPort ?? DEFAULT_PORT);
  if (port === undefined || (split.port && hostPort === undefined)) {
    return { ok: false, error: PORT_ERROR };
  }
  if (hostPort !== undefined && hostPort !== port) {
    return { ok: false, error: `The host says port ${hostPort} but the Port field says ${port}. Use one of them.` };
  }

  return { ok: true, value: { host, port } };
}

/** Adds a target. Invalid input and a duplicate (host, port) come back as `{ ok: false, error }` (decision 5). */
export function addTarget(db: Database, input: { host: string; port: string }, deps: TargetDeps): AddTargetResult {
  const parsed = parseTargetInput(input);
  if (!parsed.ok) return parsed;

  try {
    const target = targets.insertTarget(db, { ...parsed.value, createdAt: deps.now().toISOString() });
    return { ok: true, target };
  } catch (err) {
    if (err instanceof BetterSqlite3.SqliteError && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { ok: false, error: `${formatHostPort(parsed.value)} is already being monitored.` };
    }
    throw err;
  }
}

/** Returns false when there was no such target. */
export function deleteTarget(db: Database, id: number): boolean {
  return targets.deleteTarget(db, id);
}

export function getTarget(db: Database, id: number): Target | undefined {
  return targets.getTargetById(db, id);
}

export function listTargetsWithLatestCheck(db: Database): TargetWithLatestCheck[] {
  return targets.listTargetsWithLatestCheck(db);
}

/** Most urgent first, and the soonest expiry first within a status. Ties keep their order. */
export function sortByUrgency(list: TargetWithLatestCheck[]): TargetWithLatestCheck[] {
  const urgency = ({ latestCheck }: TargetWithLatestCheck) =>
    latestCheck ? URGENCY[latestCheck.status] : NEVER_CHECKED_URGENCY;
  return [...list].sort(
    (a, b) => urgency(a) - urgency(b) || (a.latestCheck?.daysLeft ?? 0) - (b.latestCheck?.daysLeft ?? 0),
  );
}

/** `example.com:443`, or `[::1]:443` for IPv6. */
export function formatHostPort({ host, port }: TargetInput): string {
  return net.isIPv6(host) ? `[${host}]:${port}` : `${host}:${port}`;
}

function parsePort(value: string): number | undefined {
  if (!/^\d{1,5}$/.test(value)) return undefined;
  const port = Number(value);
  return port >= 1 && port <= 65535 ? port : undefined;
}

/** Splits `host`, `host:port`, `[v6]` or `[v6]:port`. A bare IPv6 address has no port. */
function splitHostPort(value: string): { host: string; port?: string } | undefined {
  if (net.isIPv6(value)) return { host: value };

  const bracketed = /^\[([^\]]+)\](?::(.*))?$/.exec(value);
  if (bracketed) {
    return net.isIPv6(bracketed[1]) ? { host: bracketed[1], port: bracketed[2] } : undefined;
  }

  const [host, port, ...rest] = value.split(':');
  return rest.length === 0 ? { host, port } : undefined;
}

/** The host as it is stored, or undefined when it is neither an IP address nor a valid DNS name. */
function normalizeHost(value: string): string | undefined {
  if (net.isIP(value)) return value;

  // Non-ASCII names are stored in punycode. ASCII names skip this: WHATWG parsing would turn `1.2.3` into an IPv4.
  let host = /[^\x00-\x7f]/.test(value) ? domainToASCII(value) : value;
  host = host.replace(/\.$/, '');
  if (host === '' || host.length > 253) return undefined;

  const labels = host.split('.');
  // An all-numeric last label is a malformed IPv4 address (`999.1.1.1`), not a name.
  if (!labels.every((label) => HOST_LABEL.test(label)) || /^\d+$/.test(labels.at(-1)!)) return undefined;
  return host;
}
