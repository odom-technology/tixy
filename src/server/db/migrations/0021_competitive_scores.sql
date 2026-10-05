-- Competitive skill games (Mental Math Sprint, Sudoku) — best-score tables.

-- Math Sprint: best (max) correct-answer count per user.
CREATE TABLE IF NOT EXISTS math_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_math_scores_user ON math_scores(od_user_id);

-- Sudoku: best (min) solve time per user PER difficulty tier.
CREATE TABLE IF NOT EXISTS sudoku_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  solve_time_ms INTEGER NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sudoku_scores_user_diff ON sudoku_scores(od_user_id, difficulty);
CREATE INDEX IF NOT EXISTS idx_sudoku_scores_diff_time ON sudoku_scores(difficulty, solve_time_ms);
