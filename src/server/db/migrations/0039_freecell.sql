-- FreeCell Sprint (2026-07 wave 3): seeded solitaire time-attack skill board.
-- Per-user best (fastest recorded clear) per (mode, deal). `mode` is 'daily' or
-- 'free'; `deal_key` scopes a board: the UTC day number for daily deals (so the
-- daily leaderboard is that day's shared shuffle) or 'free' for the single
-- fastest-clear-ever free-play board. move_count is the leaderboard tiebreak
-- (fewer moves wins on equal time). Mirrors sudoku_scores / punch_card_scores
-- (a mode/scope column + solve_time_ms; the score route upserts the MIN time).
CREATE TABLE IF NOT EXISTS freecell_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  mode TEXT NOT NULL,
  deal_key TEXT NOT NULL,
  solve_time_ms INTEGER NOT NULL,
  move_count INTEGER NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_freecell_scores_user_mode_deal
  ON freecell_scores(od_user_id, mode, deal_key);
CREATE INDEX IF NOT EXISTS idx_freecell_scores_board_time
  ON freecell_scores(mode, deal_key, solve_time_ms, move_count);
