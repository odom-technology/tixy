CREATE TABLE IF NOT EXISTS arcade_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES arcade_accounts(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  href TEXT,
  preference_key TEXT,
  read_at BIGINT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_arcade_notifications_user_created
  ON arcade_notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_arcade_notifications_user_unread
  ON arcade_notifications(user_id, read_at, created_at DESC);
