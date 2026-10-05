-- Presence: who is online and what they're playing.
-- In-memory SSE connection state is the source of truth for "now"; this table
-- persists last-seen (and current status/game) for display and restart recovery.
CREATE TABLE IF NOT EXISTS arcade_user_presence (
  user_id TEXT PRIMARY KEY REFERENCES arcade_accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'offline',  -- 'online' | 'in_game' | 'away' | 'offline'
  game_slug TEXT,                          -- set when status = 'in_game'
  last_seen_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_arcade_user_presence_status
  ON arcade_user_presence(status, updated_at DESC);
