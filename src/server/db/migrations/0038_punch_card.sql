-- Punch Card (2026-07 wave 2): nonogram skill board. Per-user best (fastest
-- recorded time) per board size, mirroring sudoku_scores / minesweeper_scores
-- (a difficulty/size column + solve_time_ms; the score route upserts the MIN).
CREATE TABLE IF NOT EXISTS punch_card_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  size TEXT NOT NULL,
  solve_time_ms INTEGER NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_punch_card_scores_user_size
  ON punch_card_scores(od_user_id, size);
CREATE INDEX IF NOT EXISTS idx_punch_card_scores_size_time
  ON punch_card_scores(size, solve_time_ms);
