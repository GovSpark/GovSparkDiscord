PRAGMA foreign_keys = ON;

CREATE TABLE discord_members (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  role_ids TEXT NOT NULL DEFAULT '[]',
  eligible INTEGER NOT NULL DEFAULT 0 CHECK (eligible IN (0, 1)),
  synced_at TEXT NOT NULL
);

CREATE TABLE web_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  avatar_url TEXT,
  csrf_token TEXT NOT NULL,
  last_role_checked_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  due_at TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  related_url TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'awaiting_report', 'awaiting_next_due', 'completed', 'cancelled', 'archived')),
  created_by TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  cancelled_at TEXT
);

CREATE TABLE task_assignees (
  task_id TEXT NOT NULL REFERENCES tasks(id),
  user_id TEXT NOT NULL REFERENCES discord_members(id),
  assigned_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (task_id, user_id)
);

CREATE TABLE report_rounds (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  due_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE task_reports (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES report_rounds(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  user_id TEXT NOT NULL REFERENCES discord_members(id),
  status TEXT NOT NULL CHECK (status IN ('not_started', 'in_progress', 'completed')),
  details TEXT NOT NULL,
  revision INTEGER NOT NULL,
  submitted_at TEXT NOT NULL,
  UNIQUE (round_id, user_id, revision)
);

CREATE TABLE notification_outbox (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('assignment_channel', 'assignment_dm', 'report_request_dm', 'overdue_dm', 'report_channel')),
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

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE cron_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_members_eligible ON discord_members(eligible, display_name);
CREATE INDEX idx_tasks_status_due ON tasks(status, due_at);
CREATE INDEX idx_assignees_user ON task_assignees(user_id, task_id);
CREATE INDEX idx_rounds_due ON report_rounds(due_at, task_id);
CREATE INDEX idx_reports_latest ON task_reports(round_id, user_id, revision DESC);
CREATE INDEX idx_outbox_pending ON notification_outbox(status, next_attempt_at);
