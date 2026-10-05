-- Append-only score event log powering rolling 7d / 30d leaderboards.
--
-- The per-game *_scores tables only keep each user's PERSONAL BEST (UPSERT on
-- od_user_id), so they cannot answer "best in the last 7 days". This table
-- records every accepted score submission, so windowed boards can take each
-- user's best within a time window. All-time boards keep reading the existing
-- best-score tables (full history); windowed boards read this table.
CREATE TABLE IF NOT EXISTS game_score_events (
  id          TEXT PRIMARY KEY,
  game_slug   TEXT NOT NULL,
  od_user_id  TEXT NOT NULL,
  user_name   TEXT NOT NULL,
  score       DOUBLE PRECISION NOT NULL,
  created_at  BIGINT NOT NULL
);

-- Window scan: filter by game + time, group by user.
CREATE INDEX IF NOT EXISTS idx_gse_game_time
  ON game_score_events (game_slug, created_at);
-- Per-user history within a game.
CREATE INDEX IF NOT EXISTS idx_gse_game_user
  ON game_score_events (game_slug, od_user_id);
