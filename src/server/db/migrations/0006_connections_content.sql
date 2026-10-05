CREATE TABLE IF NOT EXISTS connections_blackout_dates (
  date TEXT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT 'Blackout',
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at BIGINT NOT NULL DEFAULT 0
);

ALTER TABLE connections_blackout_dates
  ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT 'Blackout';

ALTER TABLE connections_blackout_dates
  ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';

ALTER TABLE connections_blackout_dates
  ADD COLUMN IF NOT EXISTS created_at BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS connections_puzzles (
  id TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL,
  puzzle_date TEXT,
  groups_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_connections_puzzles_sort_order
  ON connections_puzzles(sort_order);
