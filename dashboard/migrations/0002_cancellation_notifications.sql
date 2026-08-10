CREATE TABLE notification_outbox_new (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN (
    'assignment_channel', 'assignment_dm', 'cancellation_channel', 'cancellation_dm',
    'report_request_dm', 'overdue_dm', 'report_channel'
  )),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  user_id TEXT,
  reference_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  discord_message_id TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);

INSERT INTO notification_outbox_new
SELECT id, dedupe_key, kind, task_id, user_id, reference_id, status, attempts,
  next_attempt_at, last_error, discord_message_id, created_at, sent_at
FROM notification_outbox;

DROP TABLE notification_outbox;
ALTER TABLE notification_outbox_new RENAME TO notification_outbox;
CREATE INDEX idx_outbox_pending ON notification_outbox(status, next_attempt_at);
