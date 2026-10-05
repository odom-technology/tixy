-- Unified messaging: 1:1 DMs and per-match chat share one model.
-- (Replaces the two parallel chess_match_chat / pool_match_chat systems; the
--  kind column leaves room for 'group'/'global' later with no schema rewrite.)
CREATE TABLE IF NOT EXISTS arcade_conversations (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,       -- 'dm' | 'match'
  context_ref     TEXT,               -- dm: sorted "{a}__{b}" pair key; match: matchId
  game_type       TEXT,               -- match only: 'chess' | '8-ball'
  created_by      TEXT,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL,
  last_message_at BIGINT,
  last_message_id TEXT
);

-- One conversation per (kind, game_type, context_ref). context_ref is always
-- set in practice (dm pair key / matchId); the COALESCE lets DM rows (game_type
-- NULL) share the index, and the expression must match the ON CONFLICT target.
CREATE UNIQUE INDEX IF NOT EXISTS idx_arcade_conversations_identity
  ON arcade_conversations(kind, COALESCE(game_type, ''), context_ref);

CREATE TABLE IF NOT EXISTS arcade_conversation_members (
  conversation_id TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'member',
  joined_at       BIGINT NOT NULL,
  last_read_at    BIGINT NOT NULL DEFAULT 0,  -- unread = messages.created_at > last_read_at
  muted           BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_arcade_conversation_members_user
  ON arcade_conversation_members(user_id, conversation_id);

CREATE TABLE IF NOT EXISTS arcade_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_user_id  TEXT NOT NULL,       -- bot/spectator ids allowed; intentionally no FK
  sender_name     TEXT NOT NULL,
  type            TEXT NOT NULL,       -- 'text' | 'reaction' | 'system'
  content         TEXT NOT NULL,
  created_at      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_arcade_messages_conversation
  ON arcade_messages(conversation_id, created_at);

-- User-initiated blocks (symmetric gate for DMs, friend requests, challenges).
CREATE TABLE IF NOT EXISTS arcade_user_blocks (
  blocker_user_id TEXT NOT NULL,
  blocked_user_id TEXT NOT NULL,
  created_at      BIGINT NOT NULL,
  PRIMARY KEY (blocker_user_id, blocked_user_id)
);

CREATE INDEX IF NOT EXISTS idx_arcade_user_blocks_blocked
  ON arcade_user_blocks(blocked_user_id);

-- Generic challenge-denial soft block (replaces chess_/pool_challenge_denials).
CREATE TABLE IF NOT EXISTS arcade_challenge_denials (
  game_type      TEXT NOT NULL,
  sender_user_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  denial_count   INTEGER NOT NULL DEFAULT 0,
  last_denied_at BIGINT NOT NULL,
  blocked_until  BIGINT,
  PRIMARY KEY (game_type, sender_user_id, target_user_id)
);
