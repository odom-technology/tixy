-- Checkers / draughts PvP tables. Cloned from the chess_* block in 0015 with
-- `board text` instead of `fen`, no clock columns that ever run, and checkers-
-- specific stat columns. Raw SQL in src/server/arcade/checkers-*.ts is the
-- source of truth for these columns.

CREATE TABLE IF NOT EXISTS checkers_matches (
  id TEXT PRIMARY KEY,
  player1_id TEXT NOT NULL,
  player1_name TEXT NOT NULL,
  invited_user_id TEXT,
  player2_id TEXT,
  player2_name TEXT,
  red_id TEXT,
  white_id TEXT,
  status TEXT NOT NULL,
  current_turn TEXT NOT NULL,
  time_format TEXT NOT NULL,
  initial_time_ms BIGINT NOT NULL DEFAULT 0,
  increment_ms BIGINT NOT NULL DEFAULT 0,
  red_time_ms BIGINT NOT NULL DEFAULT 0,
  white_time_ms BIGINT NOT NULL DEFAULT 0,
  last_move_at BIGINT,
  board TEXT NOT NULL,
  ply INTEGER NOT NULL DEFAULT 0,
  move_count INTEGER NOT NULL DEFAULT 0,
  no_progress_plies INTEGER NOT NULL DEFAULT 0,
  last_move TEXT,
  draw_offered_by TEXT,
  draw_offered_at BIGINT,
  result TEXT,
  winner_id TEXT,
  loser_id TEXT,
  win_reason TEXT,
  tournament_match_id TEXT,
  wager_amount INTEGER,
  wager_status TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  completed_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_checkers_matches_player1
  ON checkers_matches(player1_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkers_matches_player2
  ON checkers_matches(player2_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkers_matches_status
  ON checkers_matches(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkers_matches_invited
  ON checkers_matches(invited_user_id)
  WHERE invited_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_checkers_matches_tournament_match
  ON checkers_matches(tournament_match_id)
  WHERE tournament_match_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS checkers_moves (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  move_number INTEGER NOT NULL,
  ply INTEGER NOT NULL,
  notation TEXT NOT NULL,
  board_after TEXT NOT NULL,
  move_duration_ms BIGINT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_checkers_moves_match
  ON checkers_moves(match_id, ply);

CREATE TABLE IF NOT EXISTS checkers_recent_match_clears (
  user_id TEXT PRIMARY KEY,
  cleared_before_ts BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS checkers_elo (
  user_id TEXT PRIMARY KEY,
  user_name TEXT NOT NULL,
  elo_rating INTEGER NOT NULL,
  total_wins INTEGER NOT NULL DEFAULT 0,
  total_losses INTEGER NOT NULL DEFAULT 0,
  total_draws INTEGER NOT NULL DEFAULT 0,
  total_games INTEGER NOT NULL DEFAULT 0,
  peak_elo INTEGER NOT NULL,
  last_played BIGINT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_checkers_elo_leaderboard
  ON checkers_elo(elo_rating DESC)
  WHERE total_games > 0;

CREATE TABLE IF NOT EXISTS checkers_elo_history (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  player_a_id TEXT NOT NULL,
  player_b_id TEXT NOT NULL,
  winner_id TEXT,
  outcome TEXT NOT NULL,
  player_a_elo_before INTEGER NOT NULL,
  player_b_elo_before INTEGER NOT NULL,
  player_a_elo_after INTEGER NOT NULL,
  player_b_elo_after INTEGER NOT NULL,
  player_a_elo_change INTEGER NOT NULL,
  player_b_elo_change INTEGER NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_checkers_elo_history_match
  ON checkers_elo_history(match_id);
CREATE INDEX IF NOT EXISTS idx_checkers_elo_history_player_a
  ON checkers_elo_history(player_a_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkers_elo_history_player_b
  ON checkers_elo_history(player_b_id, created_at DESC);

CREATE TABLE IF NOT EXISTS checkers_stats (
  user_id TEXT PRIMARY KEY,
  user_name TEXT NOT NULL,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  forfeits INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  total_moves INTEGER NOT NULL DEFAULT 0,
  kings_made INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS checkers_bot_records (
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  bot_difficulty TEXT NOT NULL,
  fewest_ply INTEGER,
  total_thinking_ms BIGINT,
  achieved_at BIGINT,
  PRIMARY KEY (user_id, bot_difficulty)
);

CREATE INDEX IF NOT EXISTS idx_checkers_bot_records_difficulty
  ON checkers_bot_records(bot_difficulty, fewest_ply);
