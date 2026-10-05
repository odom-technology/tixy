ALTER TABLE IF EXISTS arcade_game_invites
  ADD COLUMN IF NOT EXISTS target_kind TEXT NOT NULL DEFAULT 'match',
  ADD COLUMN IF NOT EXISTS target_id TEXT,
  ADD COLUMN IF NOT EXISTS max_claims INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS claim_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_claimed_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS last_claimed_at BIGINT;

UPDATE arcade_game_invites
SET target_kind = COALESCE(target_kind, 'match'),
    target_id = COALESCE(target_id, match_id),
    claim_count = CASE
      WHEN claimed_at IS NOT NULL THEN GREATEST(COALESCE(claim_count, 0), 1)
      ELSE COALESCE(claim_count, 0)
    END,
    last_claimed_by_user_id = COALESCE(last_claimed_by_user_id, claimed_by_user_id),
    last_claimed_at = COALESCE(last_claimed_at, claimed_at);

ALTER TABLE IF EXISTS arcade_game_invites
  ALTER COLUMN target_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_arcade_game_invites_target
  ON arcade_game_invites(game_type, target_kind, target_id);

CREATE TABLE IF NOT EXISTS arcade_multiplayer_sessions (
  id TEXT PRIMARY KEY,
  game_type TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  owner_user_name TEXT NOT NULL,
  min_players INTEGER NOT NULL,
  max_players INTEGER NOT NULL,
  current_player_count INTEGER NOT NULL DEFAULT 0,
  visibility TEXT NOT NULL DEFAULT 'invite',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  started_at BIGINT,
  completed_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_arcade_multiplayer_sessions_game_status
  ON arcade_multiplayer_sessions(game_type, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_arcade_multiplayer_sessions_owner
  ON arcade_multiplayer_sessions(owner_user_id, updated_at);

CREATE TABLE IF NOT EXISTS arcade_multiplayer_session_players (
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  seat_index INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'player',
  status TEXT NOT NULL,
  joined_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  left_at BIGINT,
  PRIMARY KEY (session_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_arcade_multiplayer_session_players_seat
  ON arcade_multiplayer_session_players(session_id, seat_index)
  WHERE status <> 'left';

CREATE INDEX IF NOT EXISTS idx_arcade_multiplayer_session_players_user
  ON arcade_multiplayer_session_players(user_id, updated_at);
