-- Existing 2048 and snake bests that a replayed run could not plausibly have
-- produced. Read only: run it with psql against production. Nothing is
-- deleted or changed by it; the bests stay on the leaderboards until a person
-- decides. Trusted scores shipped with tixy/2-trusted-scores; before it, 2048
-- saved any score up to 10 million and snake trusted the apples a client
-- reported, so these are the rows it could have saved.
--
--   psql "$DATABASE_URL" -f scripts/queries/bests-above-replay.sql
--
-- 2048. A move deals a 2 or a 4 (2.2 on average), and every unit of tile value
-- is merged at most log2(tile) - 1 times on the way to the highest tile, so a
-- best of `score` with highest tile `tile` took at least
--   moves = score / (log2(tile) - 1) / 2.3
-- moves. At a fast human's 5 moves a second (200 ms), that is minutes_at_5ps.
-- A row is listed when the tile is not a power of two, the score is below what
-- the tile alone takes to build, the run would have needed over two hours of
-- play, or the score is over 100000 (a 8192 tile is about 100000).
WITH tuning AS (
  SELECT 2.3::numeric AS mass_per_move, 0.2::numeric AS fast_human_s_per_move,
         120::numeric AS max_minutes, 100000 AS max_plausible_score
), rows AS (
  SELECT s.od_user_id, s.user_name, s.score, s.highest_tile,
         to_timestamp(s.created_at / 1000.0) AS saved_at,
         CASE WHEN s.highest_tile >= 4 THEN s.score::numeric / (log(2, s.highest_tile::numeric) - 1) / t.mass_per_move END AS min_moves,
         t.fast_human_s_per_move, t.max_minutes, t.max_plausible_score
  FROM game_2048_scores s CROSS JOIN tuning t
)
SELECT od_user_id, user_name, score, highest_tile, saved_at,
       round(min_moves) AS min_moves,
       round(min_moves * fast_human_s_per_move / 60) AS minutes_at_5ps,
       concat_ws(', ',
         CASE WHEN highest_tile < 2 OR (highest_tile & (highest_tile - 1)) <> 0 THEN 'tile not a power of two' END,
         CASE WHEN highest_tile >= 4 AND score < highest_tile / 2 THEN 'score below the tile' END,
         CASE WHEN min_moves * fast_human_s_per_move / 60 > max_minutes THEN 'over the time limit' END,
         CASE WHEN score > max_plausible_score THEN 'score over the limit' END) AS why
FROM rows
WHERE highest_tile < 2 OR (highest_tile & (highest_tile - 1)) <> 0
   OR (highest_tile >= 4 AND score < highest_tile / 2)
   OR min_moves * fast_human_s_per_move / 60 > max_minutes
   OR score > max_plausible_score
ORDER BY score DESC;

-- Snake. The board holds 324 cells, a snake of 3 can eat at most 321 apples,
-- so no run scores over 3210, and every apple is 10. Over 1500 (150 apples)
-- is possible and rare; it is listed to be looked at.
SELECT od_user_id, user_name, score, to_timestamp(created_at / 1000.0) AS saved_at,
       concat_ws(', ',
         CASE WHEN score > 3210 THEN 'over the 3210 a full board scores' END,
         CASE WHEN score % 10 <> 0 THEN 'not a multiple of 10' END,
         CASE WHEN score BETWEEN 1500 AND 3210 THEN 'over 150 apples' END) AS why
FROM snake_scores
WHERE score > 3210 OR score % 10 <> 0 OR score >= 1500
ORDER BY score DESC;
