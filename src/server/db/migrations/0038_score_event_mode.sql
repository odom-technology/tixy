-- Mode/difficulty dimension for the rolling-window score event log.
--
-- typing-test (15/30/60), sudoku (5 difficulty tiers) and minesweeper (3 tiers)
-- keep a SEPARATE personal best per mode in their *_scores tables, but the
-- windowed event log (game_score_events) previously stored no mode, so windowed
-- boards merged every mode into one wall. This adds a nullable `mode` column so
-- each event carries its typing duration / puzzle difficulty and windowed boards
-- can filter to a single mode.
--
-- NULLABLE on purpose: events recorded before this migration have no mode. Those
-- rows are EXCLUDED from any mode-filtered windowed view (a NULL never equals a
-- selected mode). All-time boards for mode-split games are unaffected — they read
-- the per-(user,mode) best tables, which have always been complete.
ALTER TABLE game_score_events ADD COLUMN IF NOT EXISTS mode TEXT;

-- Windowed mode scan: filter by game + mode + time, group by user.
CREATE INDEX IF NOT EXISTS idx_gse_game_mode_time
  ON game_score_events (game_slug, mode, created_at);
