-- Melon Chop (2026-07 wave 2): quick-play swipe-slice skill-replay high-score
-- table. scoreTable shape, one personal-best row per user (UNIQUE(od_user_id);
-- the score route upserts on a higher score). Mirrors knife_booth_scores.
CREATE TABLE IF NOT EXISTS melon_chop_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_melon_chop_scores_user ON melon_chop_scores(od_user_id);
