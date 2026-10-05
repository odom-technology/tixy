-- Solo arcade games (Stack, Sequence Memory, Breakout) — per-user best-score tables.
-- Score-only shape (matches scoreTable helper). UNIQUE(od_user_id) for the
-- onConflictDoUpdate upsert target used by each game's score route.

CREATE TABLE IF NOT EXISTS stack_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_stack_scores_user ON stack_scores(od_user_id);

CREATE TABLE IF NOT EXISTS sequence_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sequence_scores_user ON sequence_scores(od_user_id);

CREATE TABLE IF NOT EXISTS breakout_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_breakout_scores_user ON breakout_scores(od_user_id);
