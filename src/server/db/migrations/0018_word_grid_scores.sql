-- Word Grid (daily 5-letter word game) — per-user-per-day scores + lock.
CREATE TABLE IF NOT EXISTS word_grid_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  puzzle_date TEXT NOT NULL,
  guesses INTEGER NOT NULL,
  solved BOOLEAN NOT NULL,
  time_seconds DOUBLE PRECISION NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);

-- The hard one-play-per-day lock (score route relies on ON CONFLICT DO NOTHING).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_word_grid_user_date
  ON word_grid_scores(od_user_id, puzzle_date);
CREATE INDEX IF NOT EXISTS idx_word_grid_puzzle_date
  ON word_grid_scores(puzzle_date);
