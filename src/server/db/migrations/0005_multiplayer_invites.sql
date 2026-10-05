CREATE TABLE IF NOT EXISTS arcade_friendships (
  id TEXT PRIMARY KEY,
  requester_user_id TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL,
  user_a_id TEXT NOT NULL,
  user_b_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  accepted_at BIGINT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_arcade_friendships_pair
  ON arcade_friendships(user_a_id, user_b_id);

CREATE INDEX IF NOT EXISTS idx_arcade_friendships_requester
  ON arcade_friendships(requester_user_id, status);

CREATE INDEX IF NOT EXISTS idx_arcade_friendships_recipient
  ON arcade_friendships(recipient_user_id, status);

CREATE TABLE IF NOT EXISTS arcade_game_invites (
  code TEXT PRIMARY KEY,
  game_type TEXT NOT NULL,
  match_id TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  expires_at BIGINT,
  claimed_by_user_id TEXT,
  claimed_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_arcade_game_invites_match
  ON arcade_game_invites(game_type, match_id);

CREATE INDEX IF NOT EXISTS idx_arcade_game_invites_creator
  ON arcade_game_invites(created_by_user_id, created_at);
