-- Boardwalk Hop (2026-07 wave 3): quick-play discrete-step grid road-hopper
-- skill-replay high-score table. scoreTable shape, one personal-best row per
-- user (UNIQUE(od_user_id); the score route upserts on a higher score). Mirrors
-- gopher_scores / swerve_scores.
CREATE TABLE IF NOT EXISTS boardwalk_hop_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_boardwalk_hop_scores_user ON boardwalk_hop_scores(od_user_id);
