ALTER TABLE wallets
  ADD COLUMN IF NOT EXISTS store_credits INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS store_credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  meta_json TEXT,
  created_at BIGINT NOT NULL,
  created_by TEXT,
  UNIQUE (user_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_store_credit_ledger_user_created
  ON store_credit_ledger(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_store_credit_ledger_source
  ON store_credit_ledger(source_type, created_at DESC);

CREATE TABLE IF NOT EXISTS ad_reward_intents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES arcade_accounts(id) ON DELETE CASCADE,
  reward_type TEXT NOT NULL,
  game_type TEXT,
  amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  granted_at BIGINT,
  claimed_at BIGINT,
  client_grant_id TEXT,
  meta_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_ad_reward_intents_user_created
  ON ad_reward_intents(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_reward_intents_status_expiry
  ON ad_reward_intents(status, expires_at);

CREATE TABLE IF NOT EXISTS ad_reward_events (
  id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL REFERENCES ad_reward_intents(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES arcade_accounts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  meta_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_ad_reward_events_intent_created
  ON ad_reward_events(intent_id, created_at);

CREATE TABLE IF NOT EXISTS user_entitlements (
  user_id TEXT NOT NULL REFERENCES arcade_accounts(id) ON DELETE CASCADE,
  entitlement_type TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, entitlement_type)
);

CREATE TABLE IF NOT EXISTS user_entitlement_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES arcade_accounts(id) ON DELETE CASCADE,
  entitlement_type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  meta_json TEXT,
  created_at BIGINT NOT NULL,
  created_by TEXT,
  UNIQUE (user_id, entitlement_type, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_user_entitlement_ledger_user_created
  ON user_entitlement_ledger(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS continued_game_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES arcade_accounts(id) ON DELETE CASCADE,
  game_type TEXT NOT NULL,
  score INTEGER NOT NULL,
  session_id TEXT,
  entitlement_ledger_id TEXT,
  created_at BIGINT NOT NULL,
  meta_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_continued_game_runs_user_created
  ON continued_game_runs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_continued_game_runs_game_created
  ON continued_game_runs(game_type, created_at DESC);

CREATE TABLE IF NOT EXISTS ticket_purchases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES arcade_accounts(id) ON DELETE CASCADE,
  pack_id TEXT NOT NULL,
  tickets_granted INTEGER NOT NULL,
  amount_total INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  stripe_session_id TEXT,
  stripe_payment_intent_id TEXT,
  stripe_charge_id TEXT,
  stripe_event_id TEXT,
  checkout_url TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  fulfilled_at BIGINT,
  reversed_at BIGINT,
  reversal_status TEXT,
  meta_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_ticket_purchases_user_created
  ON ticket_purchases(user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_purchases_stripe_session
  ON ticket_purchases(stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_purchases_stripe_payment_intent
  ON ticket_purchases(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS monetization_account_flags (
  user_id TEXT PRIMARY KEY REFERENCES arcade_accounts(id) ON DELETE CASCADE,
  flag_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_id TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  resolved_at BIGINT,
  meta_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_monetization_account_flags_active
  ON monetization_account_flags(flag_type, created_at DESC)
  WHERE resolved_at IS NULL;
