-- Public display name. Existing accounts keep NULL until they choose one in
-- the account center; registration requires a nickname. The folded key is
-- computed by the Worker (NFKC + whitespace + case) so the unique index is
-- independent of SQLite's locale/collation behavior.
ALTER TABLE users ADD COLUMN nickname TEXT;
ALTER TABLE users ADD COLUMN nickname_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_nickname_key
  ON users(nickname_key)
  WHERE nickname_key IS NOT NULL;
