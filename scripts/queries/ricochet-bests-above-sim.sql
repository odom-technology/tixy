-- Existing ricochet bests that the sim's best players don't reach. Read only:
-- run it with psql against production. Nothing is deleted or changed by it;
-- the bests stay on the leaderboards until a person decides. The score route
-- replays every run from this change on. Before it, the server tested the wall
-- events the client sent against the seed's gaps and never flew the bird, so a
-- best could have been forged from the seed.
--
--   psql "$DATABASE_URL" -f scripts/queries/ricochet-bests-above-sim.sql
--
-- scripts/sim-ricochet.ts plays the real engine with a bot per skill. The
-- expert's best of 100 runs is about 128 walls, and a flawless flight takes at
-- least the sum of its crossing times: 2.6 s a wall at the start, 1.07 s from
-- the 46th wall on. A row is listed from 100 walls (a strong player's best of
-- 100), with the least time that many walls need.
WITH rows AS (
  SELECT od_user_id, user_name, score, to_timestamp(created_at / 1000.0) AS saved_at,
         -- 412 px of span at (2.6 + 0.085 * (wall - 1)) px a step, 60 steps a
         -- second, the speed capped at 6.4 px a step.
         (SELECT SUM(412.0 / LEAST(6.4, 2.6 + 0.085 * (n - 1)) / 60.0) FROM generate_series(1, s.score) n) AS least_seconds
  FROM ricochet_scores s
  WHERE s.score >= 100
)
SELECT od_user_id, user_name, score, saved_at,
       round(least_seconds) AS least_seconds,
       round(least_seconds / 60.0, 1) AS least_minutes,
       concat_ws(', ',
         CASE WHEN score > 128 THEN 'over the expert best of 100' END,
         CASE WHEN score > 250 THEN 'over 250 walls' END) AS why
FROM rows
ORDER BY score DESC;
