-- Timestamps are ISO-8601 UTC strings, the same format as Date.prototype.toISOString().

CREATE TABLE notification_recipients (
  id         INTEGER PRIMARY KEY,
  email      TEXT    NOT NULL UNIQUE,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE targets (
  id                   INTEGER PRIMARY KEY,
  host                 TEXT    NOT NULL,
  port                 INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
  -- NULL means "OK / nothing notified yet". ERROR never changes it (decision 6).
  last_notified_status TEXT    NULL CHECK (last_notified_status IN ('WARNING', 'CRITICAL', 'EXPIRED')),
  created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (host, port)
);

CREATE TABLE check_results (
  id                  INTEGER PRIMARY KEY,
  target_id           INTEGER NOT NULL REFERENCES targets (id) ON DELETE CASCADE,
  status              TEXT    NOT NULL CHECK (status IN ('OK', 'WARNING', 'CRITICAL', 'EXPIRED', 'ERROR')),
  days_left           INTEGER NULL,
  valid_to            TEXT    NULL,
  error               TEXT    NULL,
  authorized          INTEGER NULL CHECK (authorized IN (0, 1)),
  authorization_error TEXT    NULL,
  checked_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_check_results_target_checked ON check_results (target_id, checked_at DESC);

-- Log only: one row per scheduler run (decision 8).
CREATE TABLE notifications (
  id               INTEGER PRIMARY KEY,
  sent_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  recipients_count INTEGER NOT NULL DEFAULT 0,
  summary          TEXT    NOT NULL
);
