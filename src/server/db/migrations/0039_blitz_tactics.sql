-- Blitz Tactics (2026-07 wave 3): chess puzzle-rush competitive skill-replay
-- high-score table. scoreTable shape, one personal-best row per user
-- (UNIQUE(od_user_id); the score route upserts on a higher score). Score =
-- puzzles solved in the 5-minute rush. Mirrors math_scores / swerve_scores.
CREATE TABLE IF NOT EXISTS blitz_tactics_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_blitz_tactics_scores_user ON blitz_tactics_scores(od_user_id);
