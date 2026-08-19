ALTER TABLE packs ADD COLUMN source_type TEXT;
ALTER TABLE packs ADD COLUMN source_id TEXT;
CREATE UNIQUE INDEX idx_packs_source ON packs(source_type, source_id);
