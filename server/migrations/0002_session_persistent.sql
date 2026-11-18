-- "保持登录" off uses a browser-session cookie and a non-persistent session
-- record. Existing sessions created before this migration default to persistent.
ALTER TABLE sessions ADD COLUMN persistent INTEGER NOT NULL DEFAULT 1;
