-- Trusted 2048 scores: one row per saved run that used its undo, so the score
-- route can hold a player to a few undo runs a day (the client's own rule is
-- one a day per device). Read as the rows from the last 24 hours. Additive.
CREATE TABLE IF NOT EXISTS game_2048_undo_runs (
  session_id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_2048_undo_runs_user_created ON game_2048_undo_runs(od_user_id, created_at DESC);
