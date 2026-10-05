-- Derby Royale — continuous shared horse-race betting game.
-- One site-wide round loop (betting -> locked -> racing -> results -> repeat)
-- persisted for crash-safe boot recovery. Outcome is fully determined by the
-- committed per-round seed, so nothing is ever re-rolled on restart.
--
-- Idempotent: every object guarded with IF NOT EXISTS.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Rounds — one row per race. Written at creation, updated at every phase
-- transition. `phase` includes a terminal 'settled' state not exposed to
-- clients (DerbyPhase is betting|locked|racing|results); settlement is guarded
-- by `settled_at IS NULL`.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS derby_rounds (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_number     bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  seed             text NOT NULL,
  seed_hash        text NOT NULL,
  odds_json        jsonb NOT NULL,
  phase            text NOT NULL CHECK (phase IN ('betting','locked','racing','results','settled')),
  betting_ends_at  timestamptz,
  race_starts_at   timestamptz,
  race_ends_at     timestamptz,
  results_end_at   timestamptz,
  winner_idx       int,
  finish_order_json jsonb,
  bet_count        int NOT NULL DEFAULT 0,
  total_wagered    bigint NOT NULL DEFAULT 0,
  total_paid       bigint NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  settled_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_derby_rounds_phase ON derby_rounds(phase);
CREATE INDEX IF NOT EXISTS idx_derby_rounds_number_desc ON derby_rounds(round_number DESC);

-- ---------------------------------------------------------------------------
-- Bets — one row per (round, user, horse). `multiplier` is the published `m`
-- captured at bet time and is the source of truth for the payout.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS derby_bets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id    uuid NOT NULL REFERENCES derby_rounds(id),
  user_id     text NOT NULL,
  user_name   text,
  horse_idx   int NOT NULL,
  amount      bigint NOT NULL,
  multiplier  numeric(8,2) NOT NULL,
  payout      bigint,
  settled_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, user_id, horse_idx)
);

CREATE INDEX IF NOT EXISTS idx_derby_bets_round ON derby_bets(round_id);
CREATE INDEX IF NOT EXISTS idx_derby_bets_user ON derby_bets(user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Chat — live rail during the round loop. (Owned by Agent B's chat route; the
-- table ships here so the schema is complete in one migration.)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS derby_chat (
  id          bigserial PRIMARY KEY,
  user_id     text,
  user_name   text NOT NULL,
  body        text NOT NULL CHECK (char_length(body) <= 280),
  round_id    uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_derby_chat_id_desc ON derby_chat(id DESC);
