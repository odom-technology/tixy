-- Quick-play pack (Tumbler, Gopher Pop, Ricochet, Swerve) — per-user best-score tables.
-- Score-only shape (matches scoreTable helper). UNIQUE(od_user_id) for the
-- onConflictDoUpdate upsert target used by each game's score route.

CREATE TABLE IF NOT EXISTS tumbler_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_tumbler_scores_user ON tumbler_scores(od_user_id);

CREATE TABLE IF NOT EXISTS gopher_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_gopher_scores_user ON gopher_scores(od_user_id);

CREATE TABLE IF NOT EXISTS ricochet_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ricochet_scores_user ON ricochet_scores(od_user_id);

CREATE TABLE IF NOT EXISTS swerve_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_swerve_scores_user ON swerve_scores(od_user_id);
