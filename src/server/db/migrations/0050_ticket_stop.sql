-- Ticket stop (tixy rev. 2, phase 3): the new quick-play timing game.
-- scoreTable shape, one personal-best row per user (UNIQUE(od_user_id); the
-- score route upserts on a higher score). Mirrors gunrush_scores. Additive.
CREATE TABLE IF NOT EXISTS ticket_stop_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ticket_stop_scores_user ON ticket_stop_scores(od_user_id);

-- One row per saved run, for the play check in the score route: whether
-- all three stops hit the center, and where in its bulb each stop landed.
-- Read back as the player's last 50 runs. Additive.
CREATE TABLE IF NOT EXISTS ticket_stop_runs (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  perfects INTEGER NOT NULL,
  phases_json TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ticket_stop_runs_user_created ON ticket_stop_runs(od_user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ticket_stop_runs_session ON ticket_stop_runs(session_id);
