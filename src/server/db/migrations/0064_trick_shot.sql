-- Trick shot (tixy rev. 2, new games): one pool table a day, one scored
-- shot. One row per player per day. The row is made 'armed' with the
-- server's clock at the player's first touch on the table, and becomes
-- 'shot' once, when the server has replayed the shot on the day's table.
-- The shot is kept on the grids it was played on (aim in 0.01 degree steps,
-- power in whole percent, spin in hundredths), so it replays exactly.
-- Additive.
CREATE TABLE IF NOT EXISTS trick_shot_attempts (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  puzzle_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'armed',
  started_at BIGINT NOT NULL,
  shot_at BIGINT,
  angle_steps INTEGER,
  power_pct INTEGER,
  spin_x INTEGER,
  spin_y INTEGER,
  pots INTEGER,
  ball_count INTEGER,
  scratch BOOLEAN,
  clear BOOLEAN,
  score INTEGER,
  near_misses INTEGER,
  created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_trick_shot_attempts_user_day ON trick_shot_attempts(od_user_id, puzzle_date);
CREATE INDEX IF NOT EXISTS idx_trick_shot_attempts_day_board ON trick_shot_attempts(puzzle_date, status, score DESC, shot_at ASC);
