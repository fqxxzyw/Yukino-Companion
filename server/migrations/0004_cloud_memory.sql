-- Opt-in, text-only long-term memory. Existing users and tables are untouched.
-- Text is stored as plain UTF-8 in D1; this is not end-to-end encrypted.
CREATE TABLE IF NOT EXISTS cloud_memories (
  user_id TEXT NOT NULL REFERENCES users(id),
  character_id TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (user_id, character_id)
);

CREATE TABLE IF NOT EXISTS cloud_memory_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  sync_memory INTEGER NOT NULL DEFAULT 0,
  sync_chat INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cloud_chat_messages (
  user_id TEXT NOT NULL REFERENCES users(id),
  id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS cloud_chat_user_character_time
  ON cloud_chat_messages(user_id, character_id, created_at);
CREATE INDEX IF NOT EXISTS cloud_chat_user_conversation_time
  ON cloud_chat_messages(user_id, conversation_id, created_at);
