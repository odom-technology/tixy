-- New games batch (2026-06): 3 quick-play high-score tables, Minesweeper
-- per-(user,difficulty) best-time table, and Reversi + Battleship PvP tables
-- (cloned from the connect_four_* DDL in 0022). Code SQL in
-- src/server/arcade/*.ts is the source of truth for the PvP tables.

-- ===== Quick-play high-score tables (scoreTable shape, UNIQUE(od_user_id)) =====
CREATE TABLE IF NOT EXISTS bubble_shooter_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_bubble_shooter_scores_user ON bubble_shooter_scores(od_user_id);

CREATE TABLE IF NOT EXISTS gem_swap_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_gem_swap_scores_user ON gem_swap_scores(od_user_id);

CREATE TABLE IF NOT EXISTS sky_climber_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sky_climber_scores_user ON sky_climber_scores(od_user_id);

-- ===== Minesweeper: per-(user,difficulty) best solve time (lower is better) =====
CREATE TABLE IF NOT EXISTS minesweeper_scores (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  solve_time_ms INTEGER NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_minesweeper_scores_user_difficulty
  ON minesweeper_scores(od_user_id, difficulty);

-- ===== Reversi/Othello PvP (cloned from connect_four_*) =====
CREATE TABLE IF NOT EXISTS reversi_matches (
  id TEXT PRIMARY KEY,
  player1_id TEXT NOT NULL,
  player1_name TEXT NOT NULL,
  invited_user_id TEXT,
  player2_id TEXT,
  player2_name TEXT,
  black_id TEXT,
  white_id TEXT,
  status TEXT NOT NULL,
  current_turn TEXT,
  board TEXT NOT NULL,
  ply INTEGER NOT NULL DEFAULT 0,
  move_count INTEGER NOT NULL DEFAULT 0,
  last_move TEXT,
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
CREATE INDEX IF NOT EXISTS idx_reversi_matches_player1 ON reversi_matches(player1_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_reversi_matches_player2 ON reversi_matches(player2_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_reversi_matches_status ON reversi_matches(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_reversi_matches_invited ON reversi_matches(invited_user_id) WHERE invited_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS reversi_moves (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  move_number INTEGER NOT NULL,
  ply INTEGER NOT NULL,
  cell_index INTEGER NOT NULL,
  board_after TEXT NOT NULL,
  move_duration_ms BIGINT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reversi_moves_match ON reversi_moves(match_id, ply);

CREATE TABLE IF NOT EXISTS reversi_recent_match_clears (
  user_id TEXT PRIMARY KEY,
  cleared_before_ts BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS reversi_elo (
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
CREATE INDEX IF NOT EXISTS idx_reversi_elo_leaderboard ON reversi_elo(elo_rating DESC) WHERE total_games > 0;

CREATE TABLE IF NOT EXISTS reversi_elo_history (
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
CREATE INDEX IF NOT EXISTS idx_reversi_elo_history_match ON reversi_elo_history(match_id);
CREATE INDEX IF NOT EXISTS idx_reversi_elo_history_player_a ON reversi_elo_history(player_a_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reversi_elo_history_player_b ON reversi_elo_history(player_b_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reversi_stats (
  user_id TEXT PRIMARY KEY,
  user_name TEXT NOT NULL,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  forfeits INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  total_moves INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS reversi_bot_records (
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  bot_difficulty TEXT NOT NULL,
  fewest_ply INTEGER,
  total_thinking_ms BIGINT,
  achieved_at BIGINT,
  PRIMARY KEY (user_id, bot_difficulty)
);
CREATE INDEX IF NOT EXISTS idx_reversi_bot_records_difficulty ON reversi_bot_records(bot_difficulty, fewest_ply);

-- ===== Battleship PvP (hidden-board; server holds both fleet grids) =====
CREATE TABLE IF NOT EXISTS battleship_matches (
  id TEXT PRIMARY KEY,
  player1_id TEXT NOT NULL,
  player1_name TEXT NOT NULL,
  invited_user_id TEXT,
  player2_id TEXT,
  player2_name TEXT,
  status TEXT NOT NULL,
  phase TEXT NOT NULL,
  current_turn TEXT,
  player1_board TEXT,
  player2_board TEXT,
  player1_shots TEXT,
  player2_shots TEXT,
  player1_ready BOOLEAN NOT NULL DEFAULT FALSE,
  player2_ready BOOLEAN NOT NULL DEFAULT FALSE,
  ply INTEGER NOT NULL DEFAULT 0,
  move_count INTEGER NOT NULL DEFAULT 0,
  last_move TEXT,
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
CREATE INDEX IF NOT EXISTS idx_battleship_matches_player1 ON battleship_matches(player1_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_battleship_matches_player2 ON battleship_matches(player2_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_battleship_matches_status ON battleship_matches(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_battleship_matches_invited ON battleship_matches(invited_user_id) WHERE invited_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS battleship_moves (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  ply INTEGER NOT NULL,
  kind TEXT NOT NULL,
  cell INTEGER NOT NULL,
  outcome TEXT,
  move_duration_ms BIGINT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_battleship_moves_match ON battleship_moves(match_id, ply);

CREATE TABLE IF NOT EXISTS battleship_recent_match_clears (
  user_id TEXT PRIMARY KEY,
  cleared_before_ts BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS battleship_elo (
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
CREATE INDEX IF NOT EXISTS idx_battleship_elo_leaderboard ON battleship_elo(elo_rating DESC) WHERE total_games > 0;

CREATE TABLE IF NOT EXISTS battleship_elo_history (
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
CREATE INDEX IF NOT EXISTS idx_battleship_elo_history_match ON battleship_elo_history(match_id);
CREATE INDEX IF NOT EXISTS idx_battleship_elo_history_player_a ON battleship_elo_history(player_a_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_battleship_elo_history_player_b ON battleship_elo_history(player_b_id, created_at DESC);

CREATE TABLE IF NOT EXISTS battleship_stats (
  user_id TEXT PRIMARY KEY,
  user_name TEXT NOT NULL,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  forfeits INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  total_shots INTEGER NOT NULL DEFAULT 0,
  total_hits INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS battleship_bot_records (
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  bot_difficulty TEXT NOT NULL,
  fewest_ply INTEGER,
  total_thinking_ms BIGINT,
  achieved_at BIGINT,
  PRIMARY KEY (user_id, bot_difficulty)
);
CREATE INDEX IF NOT EXISTS idx_battleship_bot_records_difficulty ON battleship_bot_records(bot_difficulty, fewest_ply);
