-- ───────────────────────────────────────────────────────────────────────────
-- Coin pusher (docs/design/tixy-rebrand/COIN_PUSHER.md).
--
-- The server owns each player's machine. One row per player holds the
-- engine's state (features/arcade/lib/coin-pusher/engine.ts) as of `step`, the
-- machine clock's integer step, plus the hundredths of a ticket it owes
-- (`carry`: a coin in the tray pays 4.85) and lifetime counts for audit.
--
-- coin_pusher_requests keeps every drop and collect by the client's request
-- id with the answer it got, so a repeated request returns the same answer
-- and never pays or charges twice. Additive: two new tables, nothing else.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS coin_pusher_machines (
  user_id        TEXT PRIMARY KEY,
  state_json     TEXT NOT NULL,
  step           BIGINT NOT NULL,
  carry          INTEGER NOT NULL DEFAULT 0,
  coins_dropped  BIGINT NOT NULL DEFAULT 0,
  coins_won      BIGINT NOT NULL DEFAULT 0,
  tickets_staked BIGINT NOT NULL DEFAULT 0,
  tickets_paid   BIGINT NOT NULL DEFAULT 0,
  created_at     BIGINT NOT NULL,
  updated_at     BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS coin_pusher_requests (
  user_id        TEXT NOT NULL,
  request_id     TEXT NOT NULL,
  kind           TEXT NOT NULL,        -- drop | collect
  bet            INTEGER NOT NULL DEFAULT 0,
  coins          INTEGER NOT NULL DEFAULT 0,
  aim_x          DOUBLE PRECISION,
  claimed_step   BIGINT,
  entry_step     BIGINT,
  committed_step BIGINT NOT NULL,
  coins_won      INTEGER NOT NULL DEFAULT 0,
  payout         INTEGER NOT NULL DEFAULT 0,
  response_json  TEXT NOT NULL,
  created_at     BIGINT NOT NULL,
  PRIMARY KEY (user_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_coin_pusher_requests_user_created
  ON coin_pusher_requests (user_id, created_at DESC);
