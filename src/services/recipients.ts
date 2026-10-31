import BetterSqlite3 from 'better-sqlite3';
import type { Database } from '../db/connection';
import * as recipients from '../db/repositories/recipients';
import type { Recipient } from '../db/repositories/recipients';

export type ParseEmailResult = { ok: true; value: string } | { ok: false; error: string };
export type AddRecipientResult = { ok: true; recipient: Recipient } | { ok: false; error: string };

export interface RecipientDeps {
  now: () => Date;
}

/** One `@`, no whitespace, and a dot in the domain. Deliberately loose: there is no verification step (spec). */
const EMAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const MAX_EMAIL_LENGTH = 254;

/** Trims and lowercases the address, then runs a simple shape check. */
export function parseEmail(input: string): ParseEmailResult {
  const email = input.trim().toLowerCase();
  if (email === '') {
    return { ok: false, error: 'Enter an email address.' };
  }
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL.test(email)) {
    return { ok: false, error: `"${input.trim()}" is not a valid email address.` };
  }
  return { ok: true, value: email };
}

/** Adds a recipient. Invalid input and a duplicate address come back as `{ ok: false, error }`. */
export function addRecipient(db: Database, input: string, deps: RecipientDeps): AddRecipientResult {
  const parsed = parseEmail(input);
  if (!parsed.ok) return parsed;

  try {
    const recipient = recipients.insertRecipient(db, { email: parsed.value, createdAt: deps.now().toISOString() });
    return { ok: true, recipient };
  } catch (err) {
    if (err instanceof BetterSqlite3.SqliteError && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { ok: false, error: `${parsed.value} is already a recipient.` };
    }
    throw err;
  }
}

/** Returns the removed recipient, or undefined when there was no such recipient. */
export function removeRecipient(db: Database, id: number): Recipient | undefined {
  const recipient = recipients.getRecipientById(db, id);
  return recipient && recipients.deleteRecipient(db, id) ? recipient : undefined;
}

export function listRecipients(db: Database): Recipient[] {
  return recipients.listRecipients(db);
}

export function hasRecipients(db: Database): boolean {
  return recipients.countRecipients(db) > 0;
}
