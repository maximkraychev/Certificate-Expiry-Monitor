import type { Database } from '../connection';

export interface Recipient {
  id: number;
  email: string;
  /** ISO-8601 UTC. */
  createdAt: string;
}

export interface NewRecipient {
  email: string;
  createdAt: string;
}

interface RecipientRow {
  id: number;
  email: string;
  created_at: string;
}

const COLUMNS = 'id, email, created_at';

/** Throws a SqliteError with code `SQLITE_CONSTRAINT_UNIQUE` when the email already exists. */
export function insertRecipient(db: Database, recipient: NewRecipient): Recipient {
  const row = db
    .prepare(`INSERT INTO notification_recipients (email, created_at) VALUES (?, ?) RETURNING ${COLUMNS}`)
    .get(recipient.email, recipient.createdAt) as RecipientRow;
  return toRecipient(row);
}

export function getRecipientById(db: Database, id: number): Recipient | undefined {
  const row = db.prepare(`SELECT ${COLUMNS} FROM notification_recipients WHERE id = ?`).get(id) as
    | RecipientRow
    | undefined;
  return row && toRecipient(row);
}

/** Every recipient, ordered by email. */
export function listRecipients(db: Database): Recipient[] {
  const rows = db.prepare(`SELECT ${COLUMNS} FROM notification_recipients ORDER BY email`).all() as RecipientRow[];
  return rows.map(toRecipient);
}

export function countRecipients(db: Database): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM notification_recipients').get() as { n: number }).n;
}

/** Returns false when there was no such recipient. */
export function deleteRecipient(db: Database, id: number): boolean {
  return db.prepare('DELETE FROM notification_recipients WHERE id = ?').run(id).changes > 0;
}

function toRecipient(row: RecipientRow): Recipient {
  return { id: row.id, email: row.email, createdAt: row.created_at };
}
