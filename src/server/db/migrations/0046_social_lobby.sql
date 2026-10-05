-- Persistent Arcade Lobby channel plus the minimum moderation primitives
-- required for a site-wide chat surface.
INSERT INTO arcade_conversations (
  id, kind, context_ref, game_type, created_by, created_at, updated_at
)
VALUES ('arcade-lobby', 'channel', 'arcade-lobby', NULL, NULL, 0, 0)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE arcade_messages
  ADD COLUMN IF NOT EXISTS deleted_at BIGINT;

ALTER TABLE arcade_messages
  ADD COLUMN IF NOT EXISTS deleted_by TEXT;

CREATE TABLE IF NOT EXISTS arcade_message_reports (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  reporter_user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at BIGINT NOT NULL,
  resolved_at BIGINT,
  resolved_by TEXT,
  UNIQUE (message_id, reporter_user_id)
);

CREATE INDEX IF NOT EXISTS idx_arcade_message_reports_status_created
  ON arcade_message_reports(status, created_at DESC);
