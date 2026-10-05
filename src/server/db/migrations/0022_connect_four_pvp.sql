-- Connect Four PvP tables. Cloned from the chess_* DDL in
-- 0015_pvp_and_reward_tables.sql, but UNTIMED (no clock columns) with a generic
-- `board text` column instead of `fen`. No tournament tables (deferred for v1).
-- Code SQL in src/server/arcade/connect-four-*.ts is the source of truth.

CREATE TABLE IF NOT EXISTS connect_four_matches (
  id TEXT PRIMARY KEY,
  player1_id TEXT NOT NULL,
  player1_name TEXT NOT NULL,
  invited_user_id TEXT,
  player2_id TEXT,
  player2_name TEXT,
  white_id TEXT,
  black_id TEXT,
  status TEXT NOT NULL,
  current_turn TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_connect_four_matches_player1
  ON connect_four_matches(player1_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_connect_four_matches_player2
  ON connect_four_matches(player2_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_connect_four_matches_status
  ON connect_four_matches(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_connect_four_matches_invited
  ON connect_four_matches(invited_user_id)
  WHERE invited_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_connect_four_matches_tournament_match
  ON connect_four_matches(tournament_match_id)
  WHERE tournament_match_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS connect_four_moves (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  move_number INTEGER NOT NULL,
  ply INTEGER NOT NULL,
  column_index INTEGER NOT NULL,
  board_after TEXT NOT NULL,
  move_duration_ms BIGINT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_connect_four_moves_match
  ON connect_four_moves(match_id, ply);

CREATE TABLE IF NOT EXISTS connect_four_recent_match_clears (
  user_id TEXT PRIMARY KEY,
  cleared_before_ts BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS connect_four_elo (
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
CREATE INDEX IF NOT EXISTS idx_connect_four_elo_leaderboard
  ON connect_four_elo(elo_rating DESC)
  WHERE total_games > 0;

CREATE TABLE IF NOT EXISTS connect_four_elo_history (
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
CREATE INDEX IF NOT EXISTS idx_connect_four_elo_history_match
  ON connect_four_elo_history(match_id);
CREATE INDEX IF NOT EXISTS idx_connect_four_elo_history_player_a
  ON connect_four_elo_history(player_a_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connect_four_elo_history_player_b
  ON connect_four_elo_history(player_b_id, created_at DESC);

CREATE TABLE IF NOT EXISTS connect_four_stats (
  user_id TEXT PRIMARY KEY,
  user_name TEXT NOT NULL,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  forfeits INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  total_moves INTEGER NOT NULL DEFAULT 0,
  fours_given INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS connect_four_bot_records (
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  bot_difficulty TEXT NOT NULL,
  fewest_ply INTEGER,
  total_thinking_ms BIGINT,
  achieved_at BIGINT,
  PRIMARY KEY (user_id, bot_difficulty)
);
CREATE INDEX IF NOT EXISTS idx_connect_four_bot_records_difficulty
  ON connect_four_bot_records(bot_difficulty, fewest_ply);
