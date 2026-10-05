-- Per-day battlepass "participation XP" counter. Battlepass XP from credits
-- stops once a player hits their daily ticket cap (creditsEarned → 0), but we
-- still want every game to nudge season progress a little, tapering off with
-- more plays. This tracks how many games a user has played today and how much
-- participation XP they've been granted, so the taper + daily participation cap
-- can be applied. See recordGameRunForSeason in server/arcade/battlepass.
CREATE TABLE IF NOT EXISTS user_season_xp_day (
  user_id          TEXT NOT NULL,
  date_key         TEXT NOT NULL,
  games            INTEGER NOT NULL DEFAULT 0,
  participation_xp INTEGER NOT NULL DEFAULT 0,
  updated_at       BIGINT NOT NULL,
  PRIMARY KEY (user_id, date_key)
);
