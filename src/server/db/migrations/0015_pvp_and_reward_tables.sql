-- Chess / 8-ball PvP tables + monthly reward bookkeeping.
-- These tables were lost in the breakout from the parent repo: the ported
-- Postgres code references them but no prior migration created them.
-- Column lists are derived from the SQL in src/server/arcade/* and the
-- chess / 8-ball API routes (code SQL is the source of truth).

-- ---------------------------------------------------------------------------
-- Chess matches
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chess_matches (
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
  time_format TEXT NOT NULL,
  initial_time_ms BIGINT NOT NULL,
  increment_ms BIGINT NOT NULL,
  white_time_ms BIGINT NOT NULL,
  black_time_ms BIGINT NOT NULL,
  last_move_at BIGINT,
  fen TEXT NOT NULL,
  ply INTEGER NOT NULL DEFAULT 0,
  move_count INTEGER NOT NULL DEFAULT 0,
  last_move_uci TEXT,
  last_move_san TEXT,
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

CREATE INDEX IF NOT EXISTS idx_chess_matches_player1
  ON chess_matches(player1_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_chess_matches_player2
  ON chess_matches(player2_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_chess_matches_status
  ON chess_matches(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_chess_matches_invited
  ON chess_matches(invited_user_id)
  WHERE invited_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chess_matches_tournament_match
  ON chess_matches(tournament_match_id)
  WHERE tournament_match_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS chess_moves (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  move_number INTEGER NOT NULL,
  ply INTEGER NOT NULL,
  uci TEXT NOT NULL,
  san TEXT NOT NULL,
  fen_after TEXT NOT NULL,
  clock_remaining_ms BIGINT,
  move_duration_ms BIGINT,
  eval_centipawns INTEGER,
  analysis_best_move_uci TEXT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chess_moves_match
  ON chess_moves(match_id, ply);

CREATE TABLE IF NOT EXISTS chess_match_chat (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chess_match_chat_match
  ON chess_match_chat(match_id, created_at);

CREATE TABLE IF NOT EXISTS chess_recent_match_clears (
  user_id TEXT PRIMARY KEY,
  cleared_before_ts BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Chess Elo, stats, bot speed-run records
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chess_elo (
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

CREATE INDEX IF NOT EXISTS idx_chess_elo_leaderboard
  ON chess_elo(elo_rating DESC)
  WHERE total_games > 0;

CREATE TABLE IF NOT EXISTS chess_elo_history (
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

CREATE INDEX IF NOT EXISTS idx_chess_elo_history_match
  ON chess_elo_history(match_id);

CREATE INDEX IF NOT EXISTS idx_chess_elo_history_player_a
  ON chess_elo_history(player_a_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chess_elo_history_player_b
  ON chess_elo_history(player_b_id, created_at DESC);

CREATE TABLE IF NOT EXISTS chess_stats (
  user_id TEXT PRIMARY KEY,
  user_name TEXT NOT NULL,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  forfeits INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  total_moves INTEGER NOT NULL DEFAULT 0,
  checkmates_given INTEGER NOT NULL DEFAULT 0,
  timeouts INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS chess_bot_records (
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  bot_difficulty TEXT NOT NULL,
  fewest_ply INTEGER,
  total_thinking_ms BIGINT,
  achieved_at BIGINT,
  PRIMARY KEY (user_id, bot_difficulty)
);

CREATE INDEX IF NOT EXISTS idx_chess_bot_records_difficulty
  ON chess_bot_records(bot_difficulty, fewest_ply);

CREATE TABLE IF NOT EXISTS chess_challenge_denials (
  sender_user_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  denial_count INTEGER NOT NULL DEFAULT 0,
  last_denied_at BIGINT NOT NULL,
  blocked_until BIGINT,
  PRIMARY KEY (sender_user_id, target_user_id)
);

-- ---------------------------------------------------------------------------
-- Chess tournaments
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chess_tournaments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  status TEXT NOT NULL,
  format TEXT NOT NULL,
  time_format TEXT NOT NULL,
  initial_time_ms BIGINT NOT NULL,
  increment_ms BIGINT NOT NULL,
  has_losers_bracket BOOLEAN NOT NULL DEFAULT false,
  betting_enabled BOOLEAN NOT NULL DEFAULT false,
  min_bet INTEGER,
  max_bet INTEGER,
  total_rounds INTEGER,
  current_round INTEGER,
  winner_id TEXT,
  winner_name TEXT,
  participant_count INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  started_at BIGINT,
  completed_at BIGINT
);

CREATE TABLE IF NOT EXISTS chess_tournament_participants (
  tournament_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  seed INTEGER,
  elo_at_registration INTEGER NOT NULL,
  eliminated_in_round INTEGER,
  eliminated_from TEXT,
  placement INTEGER,
  registered_at BIGINT NOT NULL,
  PRIMARY KEY (tournament_id, user_id)
);

CREATE TABLE IF NOT EXISTS chess_tournament_matches (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL,
  bracket TEXT NOT NULL,
  round INTEGER NOT NULL,
  position INTEGER NOT NULL,
  player1_id TEXT,
  player2_id TEXT,
  player1_name TEXT,
  player2_name TEXT,
  is_bye BOOLEAN NOT NULL DEFAULT false,
  series_match_ids TEXT,
  player1_wins INTEGER NOT NULL DEFAULT 0,
  player2_wins INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  winner_id TEXT,
  loser_id TEXT,
  status TEXT NOT NULL,
  overridden_by TEXT,
  override_reason TEXT,
  created_at BIGINT NOT NULL,
  completed_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_chess_tournament_matches_slot
  ON chess_tournament_matches(tournament_id, bracket, round, position);

CREATE TABLE IF NOT EXISTS chess_tournament_wagers (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL,
  tournament_match_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  backed_player_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  payout INTEGER,
  status TEXT NOT NULL,
  ledger_source_id_hold TEXT,
  ledger_source_id_payout TEXT,
  created_at BIGINT NOT NULL,
  settled_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_chess_tournament_wagers_match
  ON chess_tournament_wagers(tournament_match_id, status);

CREATE INDEX IF NOT EXISTS idx_chess_tournament_wagers_tournament
  ON chess_tournament_wagers(tournament_id);

-- ---------------------------------------------------------------------------
-- 8-ball pool matches
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pool_matches (
  id TEXT PRIMARY KEY,
  player1_id TEXT NOT NULL,
  player1_name TEXT NOT NULL,
  invited_user_id TEXT,
  player2_id TEXT,
  player2_name TEXT,
  status TEXT NOT NULL,
  current_turn TEXT NOT NULL,
  phase TEXT NOT NULL,
  player1_group TEXT,
  player2_group TEXT,
  balls_json TEXT NOT NULL,
  foul_state_json TEXT,
  winner_id TEXT,
  loser_id TEXT,
  win_reason TEXT,
  move_count INTEGER NOT NULL DEFAULT 0,
  turn_started_at BIGINT,
  last_reminder_at BIGINT,
  last_shot_input_json TEXT,
  balls_before_last_shot_json TEXT,
  tournament_match_id TEXT,
  wager_amount INTEGER,
  hardcore_mode BOOLEAN NOT NULL DEFAULT false,
  wager_status TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  completed_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_pool_matches_player1
  ON pool_matches(player1_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_pool_matches_player2
  ON pool_matches(player2_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_pool_matches_status
  ON pool_matches(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_pool_matches_invited
  ON pool_matches(invited_user_id)
  WHERE invited_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pool_matches_tournament_match
  ON pool_matches(tournament_match_id)
  WHERE tournament_match_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS pool_moves (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  move_number INTEGER NOT NULL,
  angle DOUBLE PRECISION NOT NULL,
  power DOUBLE PRECISION NOT NULL,
  cue_position_json TEXT,
  pocketed_balls_json TEXT NOT NULL,
  scratch INTEGER NOT NULL DEFAULT 0,
  first_contact_ball_id INTEGER,
  rail_contacts INTEGER NOT NULL DEFAULT 0,
  foul_type TEXT,
  result_json TEXT NOT NULL,
  turn_duration_ms BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pool_moves_match
  ON pool_moves(match_id, move_number);

CREATE TABLE IF NOT EXISTS pool_match_chat (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pool_match_chat_match
  ON pool_match_chat(match_id, created_at);

CREATE TABLE IF NOT EXISTS pool_recent_match_clears (
  user_id TEXT PRIMARY KEY,
  cleared_before_ts BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Pool Elo, stats, bot speed-run records
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pool_elo (
  user_id TEXT PRIMARY KEY,
  user_name TEXT NOT NULL,
  elo_rating INTEGER NOT NULL,
  total_wins INTEGER NOT NULL DEFAULT 0,
  total_losses INTEGER NOT NULL DEFAULT 0,
  total_games INTEGER NOT NULL DEFAULT 0,
  peak_elo INTEGER NOT NULL,
  last_played BIGINT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pool_elo_leaderboard
  ON pool_elo(elo_rating DESC)
  WHERE total_games > 0;

CREATE TABLE IF NOT EXISTS pool_elo_history (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  player_a_id TEXT NOT NULL,
  player_b_id TEXT NOT NULL,
  winner_id TEXT,
  player_a_elo_before INTEGER NOT NULL,
  player_b_elo_before INTEGER NOT NULL,
  player_a_elo_after INTEGER NOT NULL,
  player_b_elo_after INTEGER NOT NULL,
  player_a_elo_change INTEGER NOT NULL,
  player_b_elo_change INTEGER NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pool_elo_history_match
  ON pool_elo_history(match_id);

CREATE INDEX IF NOT EXISTS idx_pool_elo_history_player_a
  ON pool_elo_history(player_a_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pool_elo_history_player_b
  ON pool_elo_history(player_b_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pool_stats (
  user_id TEXT PRIMARY KEY,
  user_name TEXT NOT NULL,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  forfeits INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  total_shots INTEGER NOT NULL DEFAULT 0,
  total_balls_pocketed INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS pool_bot_records (
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  bot_difficulty TEXT NOT NULL,
  fewest_turns INTEGER,
  total_turn_duration_ms BIGINT,
  achieved_at BIGINT,
  PRIMARY KEY (user_id, bot_difficulty)
);

CREATE INDEX IF NOT EXISTS idx_pool_bot_records_difficulty
  ON pool_bot_records(bot_difficulty, fewest_turns);

CREATE TABLE IF NOT EXISTS pool_challenge_denials (
  sender_user_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  denial_count INTEGER NOT NULL DEFAULT 0,
  last_denied_at BIGINT NOT NULL,
  blocked_until BIGINT,
  PRIMARY KEY (sender_user_id, target_user_id)
);

-- ---------------------------------------------------------------------------
-- Pool tournaments
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pool_tournaments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  status TEXT NOT NULL,
  format TEXT NOT NULL,
  has_losers_bracket BOOLEAN NOT NULL DEFAULT false,
  betting_enabled BOOLEAN NOT NULL DEFAULT false,
  min_bet INTEGER,
  max_bet INTEGER,
  total_rounds INTEGER,
  current_round INTEGER,
  winner_id TEXT,
  winner_name TEXT,
  participant_count INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  started_at BIGINT,
  completed_at BIGINT
);

CREATE TABLE IF NOT EXISTS pool_tournament_participants (
  tournament_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  seed INTEGER,
  elo_at_registration INTEGER NOT NULL,
  eliminated_in_round INTEGER,
  eliminated_from TEXT,
  placement INTEGER,
  registered_at BIGINT NOT NULL,
  PRIMARY KEY (tournament_id, user_id)
);

CREATE TABLE IF NOT EXISTS pool_tournament_matches (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL,
  bracket TEXT NOT NULL,
  round INTEGER NOT NULL,
  position INTEGER NOT NULL,
  player1_id TEXT,
  player2_id TEXT,
  player1_name TEXT,
  player2_name TEXT,
  is_bye BOOLEAN NOT NULL DEFAULT false,
  series_match_ids TEXT,
  player1_wins INTEGER NOT NULL DEFAULT 0,
  player2_wins INTEGER NOT NULL DEFAULT 0,
  winner_id TEXT,
  loser_id TEXT,
  status TEXT NOT NULL,
  overridden_by TEXT,
  override_reason TEXT,
  created_at BIGINT NOT NULL,
  completed_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_pool_tournament_matches_slot
  ON pool_tournament_matches(tournament_id, bracket, round, position);

CREATE TABLE IF NOT EXISTS pool_tournament_wagers (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL,
  tournament_match_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  backed_player_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  payout INTEGER,
  status TEXT NOT NULL,
  ledger_source_id_hold TEXT,
  ledger_source_id_payout TEXT,
  created_at BIGINT NOT NULL,
  settled_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_pool_tournament_wagers_match
  ON pool_tournament_wagers(tournament_match_id, status);

CREATE INDEX IF NOT EXISTS idx_pool_tournament_wagers_tournament
  ON pool_tournament_wagers(tournament_id);

-- ---------------------------------------------------------------------------
-- Monthly reward runs + awards
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS monthly_reward_runs (
  month_key TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  ran_at BIGINT NOT NULL,
  summary_json TEXT
);

CREATE TABLE IF NOT EXISTS monthly_reward_awards (
  id TEXT PRIMARY KEY,
  month_key TEXT NOT NULL,
  leaderboard_key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  credits_awarded INTEGER NOT NULL,
  wupiupi_awarded INTEGER NOT NULL DEFAULT 0,
  awarded_at BIGINT NOT NULL
);

-- The awards insert relies on `ON CONFLICT DO NOTHING` for idempotent
-- re-runs; this unique index is the constraint that makes it a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_reward_awards_unique
  ON monthly_reward_awards(month_key, leaderboard_key, user_id);

CREATE INDEX IF NOT EXISTS idx_monthly_reward_awards_user
  ON monthly_reward_awards(user_id, awarded_at DESC);
