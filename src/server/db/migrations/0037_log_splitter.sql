-- Log Splitter (quick-play, two-button panic rhythm) — per-user best-score table.
-- Score-only shape (matches the scoreTable helper). UNIQUE(od_user_id) backs the
-- onConflictDoUpdate upsert target used by the score route.

CREATE TABLE IF NOT EXISTS log_splitter_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_log_splitter_scores_user ON log_splitter_scores(od_user_id);
