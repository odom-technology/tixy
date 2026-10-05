-- ───────────────────────────────────────────────────────────────────────────
-- Season 0 SEASON quests.
--
-- Mirrors user_weekly_quests but keyed by (user_id, season_key, slot_index) —
-- season quests are a small fixed set per season (defined in
-- src/server/arcade/battlepass/season-0.ts, SEASON_0_SEASON_QUESTS), the same
-- for every user, ALL unlocked at season start, with no sampling, no rerolls,
-- and no expiry within the season. season_key scopes rows so a future season
-- gets a fresh ladder without colliding with (or clobbering) season-0 rows.
-- Rows are seeded lazily and never deleted. Progress is advanced by the exact
-- same gameplay hook as dailies/weeklies (recordGameRunForSeason).
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_season_quests (
  user_id        TEXT NOT NULL,
  season_key     TEXT NOT NULL,      -- e.g. 'season-0' (SEASON_KEY)
  slot_index     INTEGER NOT NULL,   -- 0..N-1 stable slot for the fixed ladder
  quest_key      TEXT NOT NULL,      -- SEASON_0_SEASON_QUESTS template id
  kind           TEXT NOT NULL,      -- play_any | play_game | earn_tickets | score_game
  target_game    TEXT,               -- RewardGameType for play_game/score_game
  goal           INTEGER NOT NULL,
  progress       INTEGER NOT NULL DEFAULT 0,
  reward_xp      INTEGER NOT NULL,
  reward_tickets INTEGER NOT NULL DEFAULT 0,
  claimed        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     BIGINT NOT NULL,
  PRIMARY KEY (user_id, season_key, slot_index)
);

CREATE INDEX IF NOT EXISTS idx_user_season_quests_user
  ON user_season_quests (user_id);
