CREATE TABLE IF NOT EXISTS arcade_accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE,
  username TEXT,
  username_normalized TEXT UNIQUE,
  gamertag TEXT,
  display_name TEXT NOT NULL,
  image_url TEXT,
  password_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  metadata_json TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  last_login_at BIGINT,
  deleted_at BIGINT
);

CREATE TABLE IF NOT EXISTS arcade_account_roles (
  user_id TEXT NOT NULL REFERENCES arcade_accounts(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  granted_at BIGINT NOT NULL,
  granted_by TEXT,
  PRIMARY KEY (user_id, role)
);

CREATE TABLE IF NOT EXISTS arcade_account_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES arcade_accounts(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  revoked_at BIGINT,
  user_agent TEXT,
  ip_address TEXT
);

CREATE INDEX IF NOT EXISTS idx_arcade_account_sessions_user
  ON arcade_account_sessions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS arcade_account_data (
  user_id TEXT NOT NULL REFERENCES arcade_accounts(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS arcade_account_moderation_actions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES arcade_accounts(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  reason TEXT,
  actor_user_id TEXT,
  created_at BIGINT NOT NULL,
  expires_at BIGINT,
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_arcade_account_moderation_user
  ON arcade_account_moderation_actions(user_id, created_at);
