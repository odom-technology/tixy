-- Derby (tixy rev. 2, new games): the roll-ball race. Up to eight lanes, bots
-- in the rest. The race is a pure function of its seed, its lanes and its
-- roll log (src/features/arcade/lib/derby), so the server keeps the log and
-- judges the race from it. A race goes lobby -> running -> finished once,
-- under a compare-and-swap that also writes every lane's place; tickets are
-- keyed by race and player. Derby royale's tables (0040) are untouched.
-- Additive.
CREATE TABLE IF NOT EXISTS derby_races (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'lobby',
  seed BIGINT NOT NULL,
  rules INTEGER NOT NULL,
  host_user_id TEXT NOT NULL,
  rematch_of TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  fill_at BIGINT,
  start_at BIGINT,
  end_t DOUBLE PRECISION,
  winner_lane INTEGER,
  timed_out BOOLEAN,
  settled_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_derby_races_open ON derby_races(kind, status, created_at);
CREATE INDEX IF NOT EXISTS idx_derby_races_running ON derby_races(status, start_at);

CREATE TABLE IF NOT EXISTS derby_race_lanes (
  race_id TEXT NOT NULL REFERENCES derby_races(id) ON DELETE CASCADE,
  lane INTEGER NOT NULL,
  kind TEXT NOT NULL,
  od_user_id TEXT,
  user_name TEXT NOT NULL,
  bot_skill INTEGER,
  joined_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL,
  left_at BIGINT,
  rolls INTEGER NOT NULL DEFAULT 0,
  last_t INTEGER,
  place INTEGER,
  forfeit TEXT,
  tickets INTEGER,
  paid_at BIGINT,
  PRIMARY KEY (race_id, lane)
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_derby_race_lanes_user ON derby_race_lanes(race_id, od_user_id) WHERE od_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_derby_race_lanes_user ON derby_race_lanes(od_user_id, race_id);

CREATE TABLE IF NOT EXISTS derby_rolls (
  race_id TEXT NOT NULL REFERENCES derby_races(id) ON DELETE CASCADE,
  lane INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  t INTEGER NOT NULL,
  claimed_t INTEGER NOT NULL,
  aim DOUBLE PRECISION NOT NULL,
  power DOUBLE PRECISION NOT NULL,
  ring INTEGER,
  steps INTEGER NOT NULL,
  drop_t DOUBLE PRECISION NOT NULL,
  received_at BIGINT NOT NULL,
  PRIMARY KEY (race_id, lane, seq)
);

-- One row per player: what the board, the profile and the achievements read.
-- Written in the settle transaction, so a race counts once.
CREATE TABLE IF NOT EXISTS derby_stats (
  od_user_id TEXT PRIMARY KEY,
  user_name TEXT NOT NULL,
  races INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  podiums INTEGER NOT NULL DEFAULT 0,
  human_wins INTEGER NOT NULL DEFAULT 0,
  best_win_ms DOUBLE PRECISION,
  reds INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_derby_stats_wins ON derby_stats(wins DESC, updated_at ASC);
