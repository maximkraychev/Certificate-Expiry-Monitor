import type { Database } from '../connection';

export interface NotificationLog {
  id: number;
  /** ISO-8601 UTC. */
  sentAt: string;
  recipientsCount: number;
  summary: string;
}

export type NewNotificationLog = Omit<NotificationLog, 'id'>;

interface NotificationRow {
  id: number;
  sent_at: string;
  recipients_count: number;
  summary: string;
}

const COLUMNS = 'id, sent_at, recipients_count, summary';

export function insertNotification(db: Database, log: NewNotificationLog): NotificationLog {
  const row = db
    .prepare(
      `INSERT INTO notifications (sent_at, recipients_count, summary) VALUES (?, ?, ?) RETURNING ${COLUMNS}`,
    )
    .get(log.sentAt, log.recipientsCount, log.summary) as NotificationRow;
  return toNotification(row);
}

/** The run log, newest first. */
export function listNotifications(db: Database, limit: number): NotificationLog[] {
  const rows = db
    .prepare(`SELECT ${COLUMNS} FROM notifications ORDER BY sent_at DESC, id DESC LIMIT ?`)
    .all(limit) as NotificationRow[];
  return rows.map(toNotification);
}

function toNotification(row: NotificationRow): NotificationLog {
  return { id: row.id, sentAt: row.sent_at, recipientsCount: row.recipients_count, summary: row.summary };
}
