CREATE TABLE IF NOT EXISTS daily_credit_claims (
  user_id TEXT NOT NULL,
  date_key TEXT NOT NULL,
  streak INTEGER NOT NULL,
  credits_awarded INTEGER NOT NULL DEFAULT 0,
  beskar_awarded INTEGER NOT NULL DEFAULT 0,
  is_milestone BOOLEAN NOT NULL DEFAULT FALSE,
  claimed_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, date_key)
);

CREATE INDEX IF NOT EXISTS idx_daily_credit_claims_user_date
  ON daily_credit_claims(user_id, date_key DESC);

INSERT INTO site_settings (id, config_json, updated_at, updated_by)
VALUES (
  'games-store-visibility',
  '{"creditsEnabled":true,"beskarEnabled":false,"gameCreditsEnabled":true}',
  0,
  'migration:0007_tickets_economy'
)
ON CONFLICT(id) DO UPDATE SET
  config_json = '{"creditsEnabled":true,"beskarEnabled":false,"gameCreditsEnabled":true}',
  updated_at = 0,
  updated_by = 'migration:0007_tickets_economy';
