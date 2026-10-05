-- Unified player stats + achievement system.
--
-- Three concerns, three tables:
--
--   user_stats              A generic per-(user, key) counter store. The per-game
--                           *_scores tables only keep a personal best for ONE
--                           metric; achievements and the richer profile display
--                           need many lifetime aggregates (total games, longest
--                           snake, tetrises, distinct games played, play streak,
--                           secret-trigger counters, ...). Keys are namespaced
--                           strings ("snake.best", "global.games", "secret.konami").
--                           Values are BIGINT; dates are encoded as YYYYMMDD ints.
--
--   user_achievements       One row per (user, achievement) that has been
--                           unlocked. Each tier of a tiered series is its own
--                           achievement_id ("snake-score-3"), so this doubles as
--                           the progress + "feature on profile" source of truth.
--
--   achievement_unlock_counts  Incrementally-maintained global unlock tally per
--                           achievement, used to show rarity ("0.4% of players").
--
-- Featured achievements are stored in the existing account_data profile.details
-- JSON blob (no table needed).

CREATE TABLE IF NOT EXISTS user_stats (
  user_id    TEXT   NOT NULL,
  stat_key   TEXT   NOT NULL,
  value      BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, stat_key)
);

-- "Top players by a single stat" / engine candidate scans by key.
CREATE INDEX IF NOT EXISTS idx_user_stats_key_value
  ON user_stats (stat_key, value DESC);

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id        TEXT    NOT NULL,
  achievement_id TEXT    NOT NULL,
  tier           INTEGER NOT NULL DEFAULT 0,
  unlocked_at    BIGINT  NOT NULL,
  xp_awarded     INTEGER NOT NULL DEFAULT 0,
  seen           BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (user_id, achievement_id)
);

-- Profile / page reads: a user's unlocks, newest first.
CREATE INDEX IF NOT EXISTS idx_user_achievements_user_time
  ON user_achievements (user_id, unlocked_at DESC);
-- "New since last visit" badge.
CREATE INDEX IF NOT EXISTS idx_user_achievements_unseen
  ON user_achievements (user_id) WHERE seen = FALSE;

CREATE TABLE IF NOT EXISTS achievement_unlock_counts (
  achievement_id TEXT   PRIMARY KEY,
  count          BIGINT NOT NULL DEFAULT 0
);
