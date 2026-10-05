CREATE TABLE IF NOT EXISTS wallets (
  user_id TEXT PRIMARY KEY,
  credits INTEGER NOT NULL DEFAULT 0,
  wupiupi INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS currency_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  currency_type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  meta_json TEXT,
  created_at BIGINT NOT NULL,
  created_by TEXT,
  UNIQUE (user_id, currency_type, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_currency_ledger_user_created
  ON currency_ledger(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_currency_ledger_source
  ON currency_ledger(source_type, created_at DESC);

CREATE TABLE IF NOT EXISTS game_daily_earnings (
  user_id TEXT NOT NULL,
  game_type TEXT NOT NULL,
  date_key TEXT NOT NULL,
  earned_credits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, game_type, date_key)
);

CREATE INDEX IF NOT EXISTS idx_game_daily_earnings_user_date
  ON game_daily_earnings(user_id, date_key);

CREATE TABLE IF NOT EXISTS game_time_metrics_daily (
  user_id TEXT NOT NULL,
  game_type TEXT NOT NULL,
  date_key TEXT NOT NULL,
  duration_ms BIGINT NOT NULL DEFAULT 0,
  run_count INTEGER NOT NULL DEFAULT 0,
  first_played_at BIGINT,
  last_played_at BIGINT,
  PRIMARY KEY (user_id, game_type, date_key)
);

CREATE INDEX IF NOT EXISTS idx_game_time_metrics_daily_user
  ON game_time_metrics_daily(user_id, date_key);

CREATE TABLE IF NOT EXISTS game_time_metrics_totals (
  user_id TEXT NOT NULL,
  game_type TEXT NOT NULL,
  total_duration_ms BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, game_type)
);
