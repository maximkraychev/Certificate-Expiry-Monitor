import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/connection';
import {
  addRecipient,
  hasRecipients,
  listRecipients,
  parseEmail,
  removeRecipient,
} from '../../src/services/recipients';
import { createTestDb, TEST_NOW } from '../helpers';

const deps = { now: () => new Date(TEST_NOW) };

describe('parseEmail', () => {
  it.each([
    ['ops@example.com', 'ops@example.com'],
    ['  Ops.Team+Certs@Example.COM  ', 'ops.team+certs@example.com'],
    ['a@b.co', 'a@b.co'],
    ['first.last@sub.example.co.uk', 'first.last@sub.example.co.uk'],
  ])('%j gives %s', (input, expected) => {
    expect(parseEmail(input)).toEqual({ ok: true, value: expected });
  });

  it.each(['', '   '])('asks for an address when given %j', (input) => {
    expect(parseEmail(input)).toEqual({ ok: false, error: 'Enter an email address.' });
  });

  it.each([
    'plainaddress',
    '@example.com',
    'ops@',
    'ops@example',
    'ops@@example.com',
    'ops@exa@mple.com',
    'o ps@example.com',
    'ops@example..com',
    'ops@.example.com',
    'ops@example.com.',
    `${'a'.repeat(250)}@example.com`,
  ])('rejects %j', (input) => {
    expect(parseEmail(input)).toEqual({ ok: false, error: `"${input}" is not a valid email address.` });
  });
});

describe('recipient service', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('adds a normalized recipient with the injected clock', () => {
    expect(addRecipient(db, ' Ops@Example.com ', deps)).toEqual({
      ok: true,
      recipient: { id: expect.any(Number), email: 'ops@example.com', createdAt: TEST_NOW.toISOString() },
    });
    expect(listRecipients(db)).toMatchObject([{ email: 'ops@example.com' }]);
  });

  it('returns a validation error and stores nothing for a bad address', () => {
    expect(addRecipient(db, 'not an email', deps)).toMatchObject({ ok: false });
    expect(listRecipients(db)).toEqual([]);
  });

  it('returns a friendly error for a duplicate, even with different case', () => {
    expect(addRecipient(db, 'ops@example.com', deps).ok).toBe(true);

    expect(addRecipient(db, 'OPS@example.com', deps)).toEqual({
      ok: false,
      error: 'ops@example.com is already a recipient.',
    });
    expect(listRecipients(db)).toHaveLength(1);
  });

  it('lists recipients by email', () => {
    addRecipient(db, 'zed@example.com', deps);
    addRecipient(db, 'amy@example.com', deps);

    expect(listRecipients(db).map((r) => r.email)).toEqual(['amy@example.com', 'zed@example.com']);
  });

  it('removes a recipient and returns it', () => {
    const added = addRecipient(db, 'ops@example.com', deps);
    if (!added.ok) throw new Error(added.error);

    expect(removeRecipient(db, added.recipient.id)).toEqual(added.recipient);
    expect(listRecipients(db)).toEqual([]);
    expect(removeRecipient(db, added.recipient.id)).toBeUndefined();
  });

  it('knows whether there are any recipients', () => {
    expect(hasRecipients(db)).toBe(false);
    addRecipient(db, 'ops@example.com', deps);
    expect(hasRecipients(db)).toBe(true);
  });
});
