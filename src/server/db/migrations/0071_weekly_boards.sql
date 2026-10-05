-- ───────────────────────────────────────────────────────────────────────────
-- Weekly paid boards (src/server/arcade/rewards/weekly-boards.ts).
--
-- Each week (Monday 00:00 UTC to Monday 00:00 UTC) three floor games pay
-- their top 3: 300, 200 and 100 tickets, and first place gets the first place
-- medal. One run row per week, one award row per week, game and player. The
-- tickets go through the wallet ledger keyed by week, game and player, so a
-- second run pays nothing. Additive: two new tables and one store item.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS weekly_board_runs (
  week_key      TEXT PRIMARY KEY,
  status        TEXT NOT NULL,
  games_json    TEXT NOT NULL,
  ran_at        BIGINT NOT NULL,
  summary_json  TEXT
);

CREATE TABLE IF NOT EXISTS weekly_board_awards (
  week_key    TEXT NOT NULL,
  game_slug   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  user_name   TEXT NOT NULL,
  rank        INTEGER NOT NULL,
  score       DOUBLE PRECISION NOT NULL,
  tickets     INTEGER NOT NULL,
  medal       BOOLEAN NOT NULL DEFAULT FALSE,
  awarded_at  BIGINT NOT NULL,
  PRIMARY KEY (week_key, game_slug, user_id)
);

CREATE INDEX IF NOT EXISTS idx_weekly_board_awards_user
  ON weekly_board_awards (user_id, rank);

-- The medal: a profile badge, never on sale. The award code upserts it too.
INSERT INTO store_items (
  id, name, game_type, rarity, currency_type, price,
  slots_json, active, season_tag, asset_ref, created_at
) VALUES (
  'board-medal-first', 'first place medal', 'profile', 'rare', 'credits', 0,
  '["badge"]', FALSE, NULL, '{"imageUrl":"/art/medals/medal-board-first.svg"}',
  (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
)
ON CONFLICT (id) DO NOTHING;
