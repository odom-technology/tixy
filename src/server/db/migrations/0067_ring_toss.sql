-- Ring toss (tixy rev. 2, a new boardwalk game). Additive only.
-- Numbered 0067: origin/tixy/rev2 has trick shot's 0064, mini golf has 0063
-- and coin pusher 0066 on their branches, so 0067 is the next one free.
-- Renumber at merge time if two collide.

-- The board: one personal best per player, the scoreTable shape (the score
-- route upserts on a higher score).
CREATE TABLE IF NOT EXISTS ring_toss_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ring_toss_scores_user ON ring_toss_scores(od_user_id);
CREATE INDEX IF NOT EXISTS idx_ring_toss_scores_score ON ring_toss_scores(score DESC, created_at ASC);

-- The last 50 rounds per player, for the play check (how tightly a player's
-- ringers sit on the ideal flick) and for review. One row per session.
CREATE TABLE IF NOT EXISTS ring_toss_runs (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  ringers INTEGER NOT NULL,
  golds INTEGER NOT NULL,
  rules INTEGER NOT NULL DEFAULT 1,
  -- Each ringer's distance from the ideal flick for its row: [power, metres].
  offsets_json TEXT NOT NULL DEFAULT '[]',
  throws_json TEXT NOT NULL DEFAULT '[]',
  created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ring_toss_runs_session ON ring_toss_runs(session_id);
CREATE INDEX IF NOT EXISTS idx_ring_toss_runs_user_created ON ring_toss_runs(od_user_id, created_at DESC);
