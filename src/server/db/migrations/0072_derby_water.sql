-- Derby, reworked into the water race (tixy rev. 2). Each lane holds a water
-- stream on a seeded moving target; the race is a pure function of its
-- seed, its lanes and every lane's aim samples (src/features/arcade/lib/derby),
-- so the server keeps the samples and judges the race from them. A race goes
-- lobby -> running -> finished once, under a compare-and-swap that also
-- writes every lane's place; tickets are keyed by race and player.
--
-- New tables, not new columns on 0068's: a roll race and a water race don't
-- share a log, and a server still running the roll race (another branch on
-- the shared dev database) never sweeps a water race. derby_stats (0068) is
-- shared: wins are wins. 0068's and 0040's tables are untouched. Additive.
-- (0070 is the daily wheel's and 0071 the weekly boards'.)
CREATE TABLE IF NOT EXISTS derby_water_races (
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
CREATE INDEX IF NOT EXISTS idx_derby_water_races_open ON derby_water_races(kind, status, created_at);
CREATE INDEX IF NOT EXISTS idx_derby_water_races_running ON derby_water_races(status, start_at);
CREATE INDEX IF NOT EXISTS idx_derby_water_races_rematch ON derby_water_races(rematch_of) WHERE rematch_of IS NOT NULL;

CREATE TABLE IF NOT EXISTS derby_water_lanes (
  race_id TEXT NOT NULL REFERENCES derby_water_races(id) ON DELETE CASCADE,
  lane INTEGER NOT NULL,
  kind TEXT NOT NULL,
  od_user_id TEXT,
  user_name TEXT NOT NULL,
  bot_skill INTEGER,
  joined_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL,
  left_at BIGINT,
  -- Every tick before this is held (stored, or dry).
  next_tick INTEGER NOT NULL DEFAULT 0,
  -- The last stored sample, for the next batch's speed check.
  last_x INTEGER,
  last_y INTEGER,
  last_s INTEGER,
  batches INTEGER NOT NULL DEFAULT 0,
  wet_ticks INTEGER NOT NULL DEFAULT 0,
  place INTEGER,
  forfeit TEXT,
  tickets INTEGER,
  paid_at BIGINT,
  PRIMARY KEY (race_id, lane)
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_derby_water_lanes_user ON derby_water_lanes(race_id, od_user_id) WHERE od_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_derby_water_lanes_user ON derby_water_lanes(od_user_id, race_id);

-- One row per kept batch: ticks [prev_tick, from_tick) were dry, then the
-- samples, flat [x, y, squirt] integers per tick from from_tick.
CREATE TABLE IF NOT EXISTS derby_water_aims (
  race_id TEXT NOT NULL REFERENCES derby_water_races(id) ON DELETE CASCADE,
  lane INTEGER NOT NULL,
  prev_tick INTEGER NOT NULL,
  from_tick INTEGER NOT NULL,
  to_tick INTEGER NOT NULL,
  samples INTEGER[] NOT NULL,
  received_at BIGINT NOT NULL,
  PRIMARY KEY (race_id, lane, prev_tick)
);
CREATE INDEX IF NOT EXISTS idx_derby_water_aims_to ON derby_water_aims(race_id, to_tick);
