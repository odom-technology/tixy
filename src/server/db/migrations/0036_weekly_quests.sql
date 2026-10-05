-- ───────────────────────────────────────────────────────────────────────────
-- Season 0 WEEKLY quests.
--
-- Mirrors user_daily_quests but keyed by (user_id, week) instead of a date_key:
-- the weekly ladder is fixed per week (defined in
-- src/server/arcade/battlepass/season-0.ts, SEASON_0_WEEKLY_QUESTS), the same
-- for every user, with no sampling and no rerolls. Weeks unlock over the season
-- but previously-unlocked weeks stay open forever, so rows are seeded lazily for
-- every week 1..currentWeek and never deleted. Progress is advanced by the exact
-- same gameplay hook as dailies (recordGameRunForSeason).
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_weekly_quests (
  user_id        TEXT NOT NULL,
  week           INTEGER NOT NULL,   -- 1-based season week
  slot_index     INTEGER NOT NULL,   -- 0..N-1 within the week
  quest_key      TEXT NOT NULL,      -- SEASON_0_WEEKLY_QUESTS template id
  kind           TEXT NOT NULL,      -- play_any | play_game | earn_tickets | score_game
  target_game    TEXT,               -- RewardGameType for play_game/score_game
  goal           INTEGER NOT NULL,
  progress       INTEGER NOT NULL DEFAULT 0,
  reward_xp      INTEGER NOT NULL,
  reward_tickets INTEGER NOT NULL DEFAULT 0,
  claimed        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     BIGINT NOT NULL,
  PRIMARY KEY (user_id, week, slot_index)
);

CREATE INDEX IF NOT EXISTS idx_user_weekly_quests_user
  ON user_weekly_quests (user_id);
