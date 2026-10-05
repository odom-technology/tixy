-- Skee-Ball (2026-07 three.js quick-play wave): skill-replay high-score table.
-- scoreTable shape, one personal-best row per user (UNIQUE(od_user_id); the
-- score route upserts on a higher score). Mirrors high_striker_scores.
CREATE TABLE IF NOT EXISTS skee_ball_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_skee_ball_scores_user ON skee_ball_scores(od_user_id);
