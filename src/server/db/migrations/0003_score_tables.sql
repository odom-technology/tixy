CREATE TABLE IF NOT EXISTS snake_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL UNIQUE,
  user_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snake_scores_leaderboard
  ON snake_scores(score DESC, created_at ASC);

CREATE TABLE IF NOT EXISTS flappy_bird_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL UNIQUE,
  user_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_flappy_bird_scores_leaderboard
  ON flappy_bird_scores(score DESC, created_at ASC);

CREATE TABLE IF NOT EXISTS reaction_time_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL UNIQUE,
  user_name TEXT NOT NULL,
  score DOUBLE PRECISION NOT NULL,
  average_time DOUBLE PRECISION NOT NULL,
  best_time DOUBLE PRECISION NOT NULL,
  attempts INTEGER NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reaction_time_scores_leaderboard
  ON reaction_time_scores(score DESC, average_time ASC, best_time ASC, created_at ASC);

CREATE TABLE IF NOT EXISTS typing_test_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  wpm DOUBLE PRECISION NOT NULL,
  raw_wpm DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION NOT NULL,
  mode INTEGER NOT NULL,
  correct_chars INTEGER NOT NULL,
  incorrect_chars INTEGER NOT NULL,
  total_chars INTEGER NOT NULL,
  words_completed INTEGER NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE (od_user_id, mode)
);

CREATE INDEX IF NOT EXISTS idx_typing_test_scores_leaderboard
  ON typing_test_scores(mode, wpm DESC, accuracy DESC, created_at ASC);

CREATE TABLE IF NOT EXISTS coin_flip_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL UNIQUE,
  user_name TEXT NOT NULL,
  streak INTEGER NOT NULL,
  chosen_side TEXT NOT NULL DEFAULT 'mixed',
  total_games_played INTEGER NOT NULL DEFAULT 0,
  total_correct_flips INTEGER NOT NULL DEFAULT 0,
  total_flips INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_coin_flip_scores_leaderboard
  ON coin_flip_scores(streak DESC, created_at ASC);

CREATE TABLE IF NOT EXISTS game_2048_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL UNIQUE,
  user_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  highest_tile INTEGER NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_game_2048_scores_leaderboard
  ON game_2048_scores(score DESC, created_at ASC);

CREATE TABLE IF NOT EXISTS tetris_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL UNIQUE,
  user_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  level INTEGER NOT NULL,
  lines INTEGER NOT NULL,
  best_lines INTEGER NOT NULL,
  best_lines_score INTEGER NOT NULL,
  best_lines_level INTEGER NOT NULL,
  best_lines_created_at BIGINT,
  total_games INTEGER NOT NULL DEFAULT 0,
  total_lines INTEGER NOT NULL DEFAULT 0,
  total_play_time_ms BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tetris_scores_score_leaderboard
  ON tetris_scores(score DESC, lines ASC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_tetris_scores_lines_leaderboard
  ON tetris_scores(best_lines DESC, best_lines_created_at ASC);

CREATE TABLE IF NOT EXISTS connections_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  puzzle_date TEXT NOT NULL,
  mistakes INTEGER NOT NULL,
  time_seconds DOUBLE PRECISION NOT NULL,
  solved BOOLEAN NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE (od_user_id, puzzle_date)
);

CREATE INDEX IF NOT EXISTS idx_connections_scores_daily
  ON connections_scores(puzzle_date, solved DESC, mistakes ASC, time_seconds ASC);

CREATE TABLE IF NOT EXISTS site_settings (
  id TEXT PRIMARY KEY,
  config_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  updated_by TEXT
);
