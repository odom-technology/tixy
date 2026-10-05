-- One XP (tixy rev. 2, phase 4). Additive only.
--
-- 1. user_account_xp.level_floor: the highest level an account has shown. The
--    level curve is now one continuous power curve, and the displayed level is
--    the larger of this floor and the curve, so no account's level goes down.
--    The floor starts at the level the old two-part curve showed for the
--    account's XP (fast ramp to level 10 at 7,020 XP, then
--    round(6.1 * level^1.55) from there). XP totals are not touched.
ALTER TABLE user_account_xp
  ADD COLUMN IF NOT EXISTS level_floor INTEGER NOT NULL DEFAULT 1;

WITH steps AS (
  SELECT l,
         SUM(CASE WHEN l < 10 THEN 300 + 120 * (l - 1)
                  ELSE floor(6.1 * power(l, 1.55) + 0.5)::int END)
           OVER (ORDER BY l) AS cum_to_next
    FROM generate_series(1, 1000) AS l
), old_levels AS (
  SELECT u.user_id,
         1 + (SELECT count(*) FROM steps s WHERE s.cum_to_next <= u.xp) AS lvl
    FROM user_account_xp u
)
UPDATE user_account_xp u
   SET level_floor = GREATEST(u.level_floor, o.lvl)
  FROM old_levels o
 WHERE o.user_id = u.user_id;

-- 2. user_season_xp_day.run_xp: skill-run XP granted today, for the 2,500 a day
--    cap. Same date_key as the ticket cap (the server's local day).
ALTER TABLE user_season_xp_day
  ADD COLUMN IF NOT EXISTS run_xp INTEGER NOT NULL DEFAULT 0;

-- 3. daily_credit_claims: the daily claim moves to a 7-day ladder every day of
--    the week. `ladder` marks rows written under the new rules (older rows are
--    work-day claims). `hold_tickets` is the amount a player on a streak from
--    before the change keeps until the streak breaks; 0 means no hold.
ALTER TABLE daily_credit_claims
  ADD COLUMN IF NOT EXISTS ladder BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE daily_credit_claims
  ADD COLUMN IF NOT EXISTS hold_tickets INTEGER NOT NULL DEFAULT 0;
