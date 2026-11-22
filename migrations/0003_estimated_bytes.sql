ALTER TABLE jobs ADD COLUMN estimated_bytes INTEGER NOT NULL DEFAULT 0;
-- Rows from before this column reserved estimated_tiles * avg_tile_bytes (85).
UPDATE jobs SET estimated_bytes = estimated_tiles * 85;
