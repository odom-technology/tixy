-- ───────────────────────────────────────────────────────────────────────────
-- Account levels — a permanent, uncapped account-wide level fed from every game
-- run (separate from the per-season battlepass XP, which resets each season).
--
-- The curve + tier bands live in code (src/server/arcade/levels/index.ts); the
-- DB only tracks each user's lifetime account XP. Levels are purely cosmetic for
-- now (Phase D rewards can hang off this later).
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_account_xp (
  user_id    TEXT PRIMARY KEY,
  xp         BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);

-- Backs the overall account-level leaderboard (rank by lifetime XP).
CREATE INDEX IF NOT EXISTS idx_user_account_xp_xp ON user_account_xp (xp DESC);
