-- Yukino account system, D1/SQLite schema.
-- All timestamps are Unix milliseconds UTC. Business dates are stored as
-- YYYY-MM-DD in Asia/Shanghai and are chosen only by the server.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  verified_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','locked','deleted')),
  security_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  password_changed_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  client TEXT NOT NULL CHECK (client IN ('desktop','web')),
  refresh_hash TEXT NOT NULL UNIQUE,
  family_id TEXT NOT NULL,
  parent_id TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  idle_expires_at INTEGER NOT NULL,
  absolute_expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  replaced_by TEXT,
  user_agent TEXT NOT NULL DEFAULT '',
  device_label TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id, revoked_at, absolute_expires_at);
CREATE INDEX IF NOT EXISTS sessions_family ON sessions(family_id);

CREATE TABLE IF NOT EXISTS email_challenges (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('register','reset')),
  code_hmac TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  resend_after INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at INTEGER,
  last_sent_at INTEGER,
  send_status TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS email_challenges_email ON email_challenges(email, purpose, created_at);
CREATE INDEX IF NOT EXISTS email_challenges_expiry ON email_challenges(expires_at);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  challenge_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE TABLE IF NOT EXISTS login_days (
  user_id TEXT NOT NULL REFERENCES users(id),
  business_date TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, business_date)
);

CREATE TABLE IF NOT EXISTS user_progress (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  affection INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  rules_version TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS progress_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  business_date TEXT NOT NULL,
  accepted INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, event_id)
);
CREATE INDEX IF NOT EXISTS progress_events_day ON progress_events(user_id, business_date, event_type);

CREATE TABLE IF NOT EXISTS reward_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  business_date TEXT NOT NULL,
  applied INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, event_id, event_type)
);
CREATE INDEX IF NOT EXISTS reward_ledger_day ON reward_ledger(user_id, business_date);

CREATE TABLE IF NOT EXISTS skin_unlocks (
  user_id TEXT NOT NULL REFERENCES users(id),
  skin_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, skin_id)
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mail_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  kind TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  text_body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mail_outbox_status ON mail_outbox(status, created_at);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_events_time ON audit_events(created_at);

-- Small cache used by the public download endpoint so a GitHub failure still
-- renders a recent, verified link instead of a fabricated URL.
CREATE TABLE IF NOT EXISTS app_cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
