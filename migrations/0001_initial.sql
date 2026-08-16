PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  public_key TEXT UNIQUE,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 64),
  created_at TEXT NOT NULL
);

CREATE TABLE packs (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  manifest_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE pack_items (
  pack_id TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
  beatmapset_id INTEGER NOT NULL CHECK (beatmapset_id > 0),
  position INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (pack_id, beatmapset_id),
  UNIQUE (pack_id, position)
);

CREATE TABLE ratings (
  pack_id TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (pack_id, user_id)
);

CREATE TABLE favorites (
  pack_id TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (pack_id, user_id)
);

CREATE INDEX idx_packs_owner_id ON packs(owner_id);
CREATE INDEX idx_pack_items_order ON pack_items(pack_id, position);
CREATE INDEX idx_ratings_pack_id ON ratings(pack_id);
CREATE INDEX idx_favorites_user_id ON favorites(user_id);

-- Phase 1 development identity. Replace this with Ed25519 registration/session auth.
INSERT INTO users (id, public_key, display_name, created_at)
VALUES ('dev-user', NULL, 'Local Developer', '2025-01-01T00:00:00.000Z');
