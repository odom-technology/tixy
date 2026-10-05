CREATE TABLE IF NOT EXISTS game_bans (
  user_id TEXT PRIMARY KEY,
  banned_at BIGINT NOT NULL,
  banned_until BIGINT,
  is_indefinite BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  banned_by TEXT
);

CREATE TABLE IF NOT EXISTS game_rate_events (
  user_id TEXT NOT NULL,
  game_type TEXT NOT NULL,
  event_type TEXT NOT NULL,
  ts BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_game_rate_events_lookup
  ON game_rate_events(user_id, game_type, event_type, ts);

CREATE TABLE IF NOT EXISTS game_sessions (
  id TEXT PRIMARY KEY,
  od_user_id TEXT NOT NULL,
  game_type TEXT NOT NULL,
  started_at BIGINT NOT NULL,
  last_action_at BIGINT NOT NULL,
  action_count INTEGER NOT NULL DEFAULT 0,
  mode_sec INTEGER,
  action_counts_json TEXT,
  reaction_times_json TEXT,
  snake_seed BIGINT,
  flappy_seed BIGINT,
  typing_seed BIGINT,
  coin_flip_seed BIGINT,
  pow_challenge_json TEXT,
  arcade_seed BIGINT,
  arcade_wager INTEGER,
  arcade_payout INTEGER,
  arcade_game_config TEXT,
  arcade_choices_json TEXT,
  arcade_settled_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_game_sessions_user
  ON game_sessions(od_user_id, game_type, started_at);

CREATE INDEX IF NOT EXISTS idx_game_sessions_started
  ON game_sessions(started_at);

CREATE TABLE IF NOT EXISTS game_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  od_user_id TEXT NOT NULL,
  game_type TEXT NOT NULL,
  event_type TEXT NOT NULL,
  ts BIGINT NOT NULL,
  data_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_game_events_session_type
  ON game_events(session_id, event_type, ts);

CREATE INDEX IF NOT EXISTS idx_game_events_user
  ON game_events(od_user_id, game_type, ts);

CREATE TABLE IF NOT EXISTS anti_cheat_logs (
  id TEXT PRIMARY KEY,
  date_key TEXT NOT NULL,
  ts BIGINT NOT NULL,
  game_type TEXT NOT NULL,
  user_id TEXT,
  user_name TEXT,
  score DOUBLE PRECISION NOT NULL,
  mode_sec INTEGER,
  result TEXT NOT NULL,
  severity TEXT,
  reason TEXT,
  stage TEXT,
  checks_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_anti_cheat_logs_date
  ON anti_cheat_logs(date_key, ts DESC);

CREATE INDEX IF NOT EXISTS idx_anti_cheat_logs_user_flags
  ON anti_cheat_logs(user_id, result, ts);

CREATE TABLE IF NOT EXISTS arcade_round_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL DEFAULT 'Anonymous',
  game_type TEXT NOT NULL,
  wager_amount INTEGER NOT NULL,
  payout_amount INTEGER NOT NULL,
  multiplier DOUBLE PRECISION NOT NULL,
  seed BIGINT NOT NULL,
  choices_json TEXT,
  outcome_json TEXT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_arcade_history_user
  ON arcade_round_history(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_arcade_history_game
  ON arcade_round_history(game_type, created_at);
