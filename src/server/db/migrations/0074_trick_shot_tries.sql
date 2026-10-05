-- Trick shot, unlimited tries (rules 2). The day's row in
-- trick_shot_attempts stays one per player per day and now holds the day's
-- best try: pots, score, clear, scratch and the shot are the best's, and
-- shot_at is when it was first reached. Every try is kept in
-- trick_shot_tries, replayed by the server like the old single shot.
--   tries: tries taken today (a row from before this has none: it took one)
--   best_try: the try that first reached the best (none: try 1)
--   armed_at: the server's clock at the first touch of the try in hand,
--     cleared when that try is recorded, so one arm records one try
-- Additive.
ALTER TABLE trick_shot_attempts ADD COLUMN IF NOT EXISTS tries INTEGER;
ALTER TABLE trick_shot_attempts ADD COLUMN IF NOT EXISTS best_try INTEGER;
ALTER TABLE trick_shot_attempts ADD COLUMN IF NOT EXISTS armed_at BIGINT;

CREATE TABLE IF NOT EXISTS trick_shot_tries (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  od_user_id TEXT NOT NULL,
  puzzle_date TEXT NOT NULL,
  try_number INTEGER NOT NULL,
  armed_at BIGINT,
  shot_at BIGINT NOT NULL,
  angle_steps INTEGER NOT NULL,
  power_pct INTEGER NOT NULL,
  spin_x INTEGER NOT NULL,
  spin_y INTEGER NOT NULL,
  pots INTEGER NOT NULL,
  ball_count INTEGER NOT NULL,
  scratch BOOLEAN NOT NULL,
  clear BOOLEAN NOT NULL,
  score INTEGER NOT NULL,
  near_misses INTEGER NOT NULL DEFAULT 0,
  improved BOOLEAN NOT NULL DEFAULT FALSE,
  tickets_due INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_trick_shot_tries_user_day_try ON trick_shot_tries(od_user_id, puzzle_date, try_number);

-- The day's board: most balls, then the score (a clean clear over a
-- scratch), then fewest tries to the best, then the earliest.
CREATE INDEX IF NOT EXISTS idx_trick_shot_attempts_day_tries_board
  ON trick_shot_attempts(puzzle_date, status, pots DESC, score DESC, best_try ASC, shot_at ASC);
-- Streaks read a player's cleared days.
CREATE INDEX IF NOT EXISTS idx_trick_shot_attempts_user_clears
  ON trick_shot_attempts(od_user_id, puzzle_date) WHERE clear;
