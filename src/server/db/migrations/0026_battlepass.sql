-- ───────────────────────────────────────────────────────────────────────────
-- Season 0 battlepass + daily quests.
--
-- Season config + the tier reward ladder live in code
-- (src/server/arcade/battlepass/season-0.ts); the DB only tracks per-user
-- progress, which rewards have been claimed, and the rotating daily quests.
-- ───────────────────────────────────────────────────────────────────────────

-- Per-user season XP + premium ownership. (Season 0 grants premium to everyone,
-- but the column lets future paid seasons gate the premium track.)
CREATE TABLE IF NOT EXISTS user_season_progress (
  user_id     TEXT NOT NULL,
  season_key  TEXT NOT NULL,
  xp          INTEGER NOT NULL DEFAULT 0,
  premium     BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at  BIGINT NOT NULL,
  PRIMARY KEY (user_id, season_key)
);

-- One row per claimed tier reward (track = 'free' | 'premium').
CREATE TABLE IF NOT EXISTS user_season_claims (
  user_id     TEXT NOT NULL,
  season_key  TEXT NOT NULL,
  tier        INTEGER NOT NULL,
  track       TEXT NOT NULL,
  claimed_at  BIGINT NOT NULL,
  PRIMARY KEY (user_id, season_key, tier, track)
);

-- Rotating daily quests, generated per user per UTC day. slot_index 0..N-1.
CREATE TABLE IF NOT EXISTS user_daily_quests (
  user_id      TEXT NOT NULL,
  date_key     TEXT NOT NULL,
  slot_index   INTEGER NOT NULL,
  quest_key    TEXT NOT NULL,      -- pool template id
  kind         TEXT NOT NULL,      -- play_any | play_game | earn_tickets | score_game
  target_game  TEXT,               -- RewardGameType for play_game/score_game
  goal         INTEGER NOT NULL,
  progress     INTEGER NOT NULL DEFAULT 0,
  reward_xp    INTEGER NOT NULL,
  claimed      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   BIGINT NOT NULL,
  PRIMARY KEY (user_id, date_key, slot_index)
);

CREATE INDEX IF NOT EXISTS idx_user_daily_quests_user_date
  ON user_daily_quests (user_id, date_key);

-- Per-user-per-day quest metadata (reroll budget).
CREATE TABLE IF NOT EXISTS user_quest_day (
  user_id       TEXT NOT NULL,
  date_key      TEXT NOT NULL,
  rerolls_used  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date_key)
);
