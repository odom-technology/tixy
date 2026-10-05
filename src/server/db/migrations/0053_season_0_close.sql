-- ───────────────────────────────────────────────────────────────────────────
-- Closing season 0 (PROGRESSION.md, "Closing season 0").
--
-- scripts/close-season-0.ts grants every reached tier and every finished quest
-- through the normal claim paths, then closes the quests nobody finished. A
-- closed quest keeps its row, its progress and its reward columns; it is only
-- marked: `closed_at` is the time the job closed it, and `claimed` is set so no
-- claim or progress path touches it again. A closed quest paid nothing, so no
-- ledger row exists for it. Additive only: a nullable column on each table.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE user_daily_quests  ADD COLUMN IF NOT EXISTS closed_at BIGINT;
ALTER TABLE user_weekly_quests ADD COLUMN IF NOT EXISTS closed_at BIGINT;
ALTER TABLE user_season_quests ADD COLUMN IF NOT EXISTS closed_at BIGINT;
