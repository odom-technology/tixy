-- Mini golf (tixy rev. 2, new games). Additive only.
--
-- One row per player per UTC day: the day's counted round. It is created
-- when the round starts and fills in putt by putt, so a player who leaves
-- comes back to the same ball on the same hole, and a round or a hole can't
-- be restarted for a better score. Later rounds that day are practice and
-- never reach the server. `holes_json` holds every finished hole's putts
-- (t, dx, dy, power), which the server replays; `current_json` the putts of
-- the hole being played; `scores_json` the strokes per hole (7 for a
-- pickup).
CREATE TABLE IF NOT EXISTS mini_golf_rounds (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  round_date TEXT NOT NULL,
  rules INTEGER NOT NULL DEFAULT 1,
  holes_json TEXT NOT NULL DEFAULT '[]',
  current_json TEXT NOT NULL DEFAULT '[]',
  scores_json TEXT NOT NULL DEFAULT '[]',
  holes_done INTEGER NOT NULL DEFAULT 0,
  strokes INTEGER NOT NULL DEFAULT 0,
  par INTEGER NOT NULL,
  aces INTEGER NOT NULL DEFAULT 0,
  started_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  finished_at BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_mini_golf_rounds_user_date ON mini_golf_rounds(od_user_id, round_date);
-- The day's board: finished rounds by strokes, then who finished first.
CREATE INDEX IF NOT EXISTS idx_mini_golf_rounds_date_board ON mini_golf_rounds(round_date, strokes, finished_at) WHERE finished_at IS NOT NULL;
