-- Friend activity feed. Each row is a public-ish moment (high score, match win,
-- achievement, purchase, friend added). `visibility` snapshots the actor's
-- profileVisibility at write time so later toggles don't retroactively leak/hide.
CREATE TABLE IF NOT EXISTS arcade_activity_events (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES arcade_accounts(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,                     -- 'high_score'|'match_win'|'achievement'|'purchase'|'friend_added'
  payload_json TEXT NOT NULL DEFAULT '{}',
  visibility   TEXT NOT NULL DEFAULT 'public',    -- 'public'|'players'|'private'
  created_at   BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_arcade_activity_events_user
  ON arcade_activity_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_arcade_activity_events_recent
  ON arcade_activity_events(created_at DESC);
