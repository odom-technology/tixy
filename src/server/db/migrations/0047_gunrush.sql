-- Gunrush (2026-08 three.js quick-play wave): seed-deterministic squad-runner
-- high-score table. scoreTable shape, one personal-best row per user
-- (UNIQUE(od_user_id); the score route upserts on a higher score). Mirrors
-- skee_ball_scores.
CREATE TABLE IF NOT EXISTS gunrush_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_gunrush_scores_user ON gunrush_scores(od_user_id);
