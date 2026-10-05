-- Knife Booth (2026-07 wave 1): quick-play skill-replay high-score table.
-- scoreTable shape, one personal-best row per user (UNIQUE(od_user_id); the
-- score route upserts on a higher score). Mirrors tumbler_scores / gopher_scores.
CREATE TABLE IF NOT EXISTS knife_booth_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_knife_booth_scores_user ON knife_booth_scores(od_user_id);
