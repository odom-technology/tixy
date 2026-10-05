-- Ticket stop rules 2, the lock (tixy rev. 2, phase 3). Additive only: v1's
-- ticket_stop_scores and every v1 row in ticket_stop_runs stay as they are,
-- readable as last season's.

-- Rules 2 scores a different thing (hits, not points), so it gets its own
-- board. scoreTable shape, one personal-best row per user (UNIQUE(od_user_id);
-- the score route upserts on a higher score).
CREATE TABLE IF NOT EXISTS ticket_stop_lock_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ticket_stop_lock_scores_user ON ticket_stop_lock_scores(od_user_id);

-- Which rules a saved run was played under: 1 is the bulb ring, 2 the lock.
-- Existing rows are 1 by the default. For rules 2, `perfects` holds the
-- longest run of near-perfect hits and `phases_json` the hits' offsets from
-- the dot's centre in ms (the timing-spread check).
ALTER TABLE ticket_stop_runs ADD COLUMN IF NOT EXISTS rules INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_ticket_stop_runs_rules_user_created ON ticket_stop_runs(rules, od_user_id, created_at DESC);
