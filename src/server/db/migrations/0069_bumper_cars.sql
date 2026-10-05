-- ───────────────────────────────────────────────────────────────────────────
-- Bumper cars (docs/design/tixy-rebrand/BUMPER_CARS.md).
--
-- One row per round, written live when the power comes on and moved to
-- settled exactly once at the horn, under a compare-and-swap on status. A
-- round the server never finished (a restart mid-round) is marked void at
-- boot and pays nothing. One row per player in the round with their points,
-- place and how they finished; tickets are paid through the wallet keyed by
-- round and player, so a repeat can't pay twice. Additive: two new tables.
--
-- Numbered 0069: mini golf has 0063, trick shot 0064, coin pusher 0066 and
-- ring toss 0067, and derby has 0068 on its branch.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bumper_car_rounds (
  id              TEXT PRIMARY KEY,
  room_id         TEXT NOT NULL,
  room_code       TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('live', 'settled', 'void')),
  seed            BIGINT NOT NULL,
  cars            INTEGER NOT NULL,
  humans          INTEGER NOT NULL,
  started_at      BIGINT NOT NULL,
  ended_at        BIGINT,
  settled_at      BIGINT,
  final_tick      INTEGER,
  standings_json  TEXT
);

CREATE INDEX IF NOT EXISTS idx_bumper_car_rounds_status ON bumper_car_rounds (status, started_at);

CREATE TABLE IF NOT EXISTS bumper_car_players (
  round_id    TEXT NOT NULL REFERENCES bumper_car_rounds (id) ON DELETE CASCADE,
  seat        INTEGER NOT NULL,
  user_id     TEXT NOT NULL,
  user_name   TEXT NOT NULL,
  points      INTEGER NOT NULL DEFAULT 0,
  bumps       INTEGER NOT NULL DEFAULT 0,
  place       INTEGER,
  result      TEXT CHECK (result IN ('finished', 'forfeit', 'timeout')),
  score       INTEGER,
  tickets     INTEGER,
  created_at  BIGINT NOT NULL,
  PRIMARY KEY (round_id, seat),
  UNIQUE (round_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_bumper_car_players_user ON bumper_car_players (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bumper_car_players_score ON bumper_car_players (score DESC) WHERE result = 'finished';
