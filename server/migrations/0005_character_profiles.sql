-- Give each unnamed account a persistent nickname. Preserve every chosen name.
UPDATE users SET nickname = '旅人·' || lower(hex(randomblob(8)))
  WHERE nickname IS NULL OR trim(nickname) = '';
UPDATE users SET nickname_key = lower(nickname) WHERE nickname_key IS NULL;

CREATE TABLE character_profiles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL,
  name TEXT NOT NULL,
  persona TEXT NOT NULL,
  PRIMARY KEY (user_id, character_id)
);
