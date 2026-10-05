ALTER TABLE arcade_notifications
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_arcade_notifications_user_dedupe
  ON arcade_notifications(user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
