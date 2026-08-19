PRAGMA foreign_keys = ON;

-- Existing packs remain public. New clients can explicitly opt into private visibility.
ALTER TABLE packs ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0 CHECK (is_private IN (0, 1));
CREATE INDEX idx_packs_public_updated ON packs(is_private, updated_at DESC);

-- Reserved social tables. Endpoints can be added without changing the pack contract.
CREATE TABLE pack_likes (
  pack_id TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (pack_id, user_id)
);

CREATE TABLE pack_comments (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 2000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX idx_pack_likes_pack_id ON pack_likes(pack_id);
CREATE INDEX idx_pack_comments_pack_id_created ON pack_comments(pack_id, created_at);
