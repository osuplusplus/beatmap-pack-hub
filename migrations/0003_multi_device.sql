PRAGMA foreign_keys = ON;

CREATE TABLE user_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL UNIQUE,
  device_name TEXT NOT NULL CHECK (length(device_name) BETWEEN 1 AND 64),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
);

INSERT INTO user_devices (id, user_id, public_key, device_name, created_at, last_seen_at)
SELECT lower(hex(randomblob(16))), id, public_key, 'Migrated device', created_at, created_at
FROM users
WHERE public_key IS NOT NULL;

ALTER TABLE auth_challenges ADD COLUMN device_id TEXT REFERENCES user_devices(id) ON DELETE CASCADE;
ALTER TABLE auth_sessions ADD COLUMN device_id TEXT REFERENCES user_devices(id) ON DELETE CASCADE;

UPDATE auth_challenges
SET device_id = (SELECT id FROM user_devices WHERE user_devices.user_id = auth_challenges.user_id LIMIT 1)
WHERE device_id IS NULL;

UPDATE auth_sessions
SET device_id = (SELECT id FROM user_devices WHERE user_devices.user_id = auth_sessions.user_id LIMIT 1)
WHERE device_id IS NULL;

CREATE TABLE device_link_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issued_by_device_id TEXT NOT NULL REFERENCES user_devices(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_user_devices_user ON user_devices(user_id, revoked_at);
CREATE INDEX idx_device_link_tokens_user ON device_link_tokens(user_id, expires_at);
CREATE INDEX idx_auth_challenges_device ON auth_challenges(device_id, expires_at);
CREATE INDEX idx_auth_sessions_device ON auth_sessions(device_id, expires_at);
