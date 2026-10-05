-- Account-level milestone rewards: one row per (user, level) that has been
-- granted, so milestone Ticket payouts are idempotent even though the XP hook
-- that triggers them is best-effort / retry-safe.
CREATE TABLE IF NOT EXISTS user_level_reward_claims (
  user_id    TEXT NOT NULL,
  level      INTEGER NOT NULL,
  tickets    INTEGER NOT NULL DEFAULT 0,
  claimed_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, level)
);
