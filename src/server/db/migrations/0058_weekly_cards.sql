-- ───────────────────────────────────────────────────────────────────────────
-- The weekly card (tixy rev. 2, PROGRESSION.md "The season card").
--
-- From season 1 a week's quests are a card of five: three floor games picked
-- for the week, "play 15" and "earn 600". user_weekly_quests is keyed by week
-- with no season, so season 1's week 1 would collide with season 0's week 1.
-- The card gets its own table, keyed by season and week. The shape mirrors
-- user_weekly_quests so the claim path is the same. Additive: season 0's
-- table is untouched and still serves season 0's weeks.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_weekly_cards (
  user_id        TEXT NOT NULL,
  season_key     TEXT NOT NULL,
  week           INTEGER NOT NULL,   -- 1-based week of the season
  slot_index     INTEGER NOT NULL,   -- 0..4 within the card
  quest_key      TEXT NOT NULL,      -- weekly-card.ts template id
  kind           TEXT NOT NULL,      -- play_any | play_game | earn_tickets
  target_game    TEXT,               -- the floor game for play_game
  goal           INTEGER NOT NULL,
  progress       INTEGER NOT NULL DEFAULT 0,
  reward_xp      INTEGER NOT NULL,
  reward_tickets INTEGER NOT NULL DEFAULT 0,
  claimed        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     BIGINT NOT NULL,
  PRIMARY KEY (user_id, season_key, week, slot_index)
);

CREATE INDEX IF NOT EXISTS idx_user_weekly_cards_user_season
  ON user_weekly_cards (user_id, season_key);
