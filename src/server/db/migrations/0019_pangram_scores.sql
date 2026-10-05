-- Pangram (daily seven-letter word builder) — per-user-per-day scores + lock.
CREATE TABLE IF NOT EXISTS pangram_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  puzzle_date TEXT NOT NULL,
  score INTEGER NOT NULL,
  words_found INTEGER NOT NULL,
  pangrams INTEGER NOT NULL,
  time_seconds DOUBLE PRECISION NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);

-- The hard one-play-per-day lock (score route relies on ON CONFLICT DO NOTHING).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pangram_user_date
  ON pangram_scores(od_user_id, puzzle_date);
CREATE INDEX IF NOT EXISTS idx_pangram_puzzle_date
  ON pangram_scores(puzzle_date);
