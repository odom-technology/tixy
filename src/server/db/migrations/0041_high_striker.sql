-- High Striker (2026-07 three.js quick-play wave): skill-replay high-score table.
-- scoreTable shape, one personal-best row per user (UNIQUE(od_user_id); the
-- score route upserts on a higher score). Mirrors tumbler_scores / knife_booth_scores.
CREATE TABLE IF NOT EXISTS high_striker_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_high_striker_scores_user ON high_striker_scores(od_user_id);
