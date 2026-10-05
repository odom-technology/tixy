-- Stacker's cabinet mode (tixy rev. 2, phase 2): the 15-row cabinet beside
-- endless stack. Endless keeps stack_scores; nothing there changes.
-- scoreTable shape, one personal-best row per user: the most rows placed,
-- 0 to 15. The score route upserts on a higher score. Additive.
CREATE TABLE IF NOT EXISTS stack_cabinet_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_stack_cabinet_scores_user ON stack_cabinet_scores(od_user_id);

-- One row per saved run, for the play check in the score route: rows placed,
-- and where in its step each fast-row stop landed. Read back as the player's
-- last 50 runs. Additive.
CREATE TABLE IF NOT EXISTS stack_cabinet_runs (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  rows_placed INTEGER NOT NULL,
  phases_json TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stack_cabinet_runs_user_created ON stack_cabinet_runs(od_user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_stack_cabinet_runs_session ON stack_cabinet_runs(session_id);
