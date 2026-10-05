-- ───────────────────────────────────────────────────────────────────────────
-- Admin metrics (tixy rev. 2, ADMIN.md).
--
-- Some of what the metrics need is pruned (game_time_metrics_daily keeps this
-- and last month, anti_cheat_logs keeps 14 days, game_sessions 6 hours) and
-- some is big (currency_ledger, arcade_round_history). A nightly rollup copies
-- what the metrics need into small per-day tables that nothing prunes. Days are
-- UTC calendar days. Everything here is additive and idempotent: new tables,
-- new indexes, nothing changed or dropped.
-- ───────────────────────────────────────────────────────────────────────────

-- One row per player per game per day. runs from scored runs, machine rounds
-- and completed friends matches; play_ms is 0 where time is not recorded.
CREATE TABLE IF NOT EXISTS admin_play_days (
  day      DATE NOT NULL,
  game_key TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  is_guest BOOLEAN NOT NULL DEFAULT FALSE,
  runs     INTEGER NOT NULL DEFAULT 0,
  play_ms  BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, game_key, user_id)
);
-- Serves "first day this player appeared" and per-player activity joins.
CREATE INDEX IF NOT EXISTS idx_admin_play_days_user_day
  ON admin_play_days (user_id, day);

-- Tickets in and out by bucket. ledger is 'earned' (currency_ledger credits)
-- or 'bought' (store_credit_ledger). amount is signed.
CREATE TABLE IF NOT EXISTS admin_ledger_days (
  day     DATE NOT NULL,
  ledger  TEXT NOT NULL,
  bucket  TEXT NOT NULL,
  amount  BIGINT NOT NULL DEFAULT 0,
  entries INTEGER NOT NULL DEFAULT 0,
  users   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, ledger, bucket)
);

-- One row per machine per day, with the sums the RTP z-score needs.
CREATE TABLE IF NOT EXISTS admin_machine_days (
  day         DATE NOT NULL,
  game_key    TEXT NOT NULL,
  rounds      INTEGER NOT NULL DEFAULT 0,
  players     INTEGER NOT NULL DEFAULT 0,
  wagered     BIGINT NOT NULL DEFAULT 0,
  paid        BIGINT NOT NULL DEFAULT 0,
  sum_w2      DOUBLE PRECISION NOT NULL DEFAULT 0,
  sum_p2      DOUBLE PRECISION NOT NULL DEFAULT 0,
  sum_wp      DOUBLE PRECISION NOT NULL DEFAULT 0,
  biggest_win BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, game_key)
);

-- Anti-cheat results per game per day (pass rows exist only when
-- ANTI_CHEAT_LOG_PASSES is on).
CREATE TABLE IF NOT EXISTS admin_trust_days (
  day      DATE NOT NULL,
  game_key TEXT NOT NULL,
  result   TEXT NOT NULL,
  n        INTEGER NOT NULL DEFAULT 0,
  players  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, game_key, result)
);

-- Browser sessions that started and finished each game, from product analytics.
CREATE TABLE IF NOT EXISTS admin_funnel_days (
  day      DATE NOT NULL,
  game_key TEXT NOT NULL,
  starts   INTEGER NOT NULL DEFAULT 0,
  finishes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, game_key)
);

-- Which days have been rolled up, and when.
CREATE TABLE IF NOT EXISTS admin_rollup_days (
  day         DATE PRIMARY KEY,
  rolled_at   BIGINT NOT NULL,
  duration_ms INTEGER NOT NULL
);

-- ── Indexes the rollup and the reads need ───────────────────────────────────
-- Each one serves a time-bounded read that had no index leading on the time
-- column. Existing indexes are not repeated: arcade_round_history already has
-- (game_type, created_at) as idx_arcade_history_game, and
-- product_analytics_events has (event_name, created_at) for the funnel.

-- Rollup of rounds and machine sums per day; biggest wins in the window.
CREATE INDEX IF NOT EXISTS idx_arcade_history_created
  ON arcade_round_history (created_at);
-- Rollup of earned tickets per day; live tickets minted in the last 15 minutes.
CREATE INDEX IF NOT EXISTS idx_currency_ledger_created
  ON currency_ledger (created_at);
-- Rollup of bought tickets per day.
CREATE INDEX IF NOT EXISTS idx_store_credit_ledger_created
  ON store_credit_ledger (created_at);
-- Achievements unlocked per day and per achievement in the window.
CREATE INDEX IF NOT EXISTS idx_user_achievements_unlocked
  ON user_achievements (unlocked_at);
-- Signups per day and the signup cohorts.
CREATE INDEX IF NOT EXISTS idx_arcade_accounts_created
  ON arcade_accounts (created_at);
-- Revenue, packs and the checkout funnel in the window.
CREATE INDEX IF NOT EXISTS idx_ticket_purchases_created
  ON ticket_purchases (created_at);
-- Anti-cheat rollup per day and the latest flags. The existing indexes lead on
-- date_key or user_id.
CREATE INDEX IF NOT EXISTS idx_anti_cheat_logs_ts
  ON anti_cheat_logs (ts);
-- Bans issued in the window.
CREATE INDEX IF NOT EXISTS idx_game_bans_banned_at
  ON game_bans (banned_at);
-- Completed friends matches per day (the rollup's run count for these games).
CREATE INDEX IF NOT EXISTS idx_chess_matches_completed
  ON chess_matches (completed_at) WHERE completed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_connect_four_matches_completed
  ON connect_four_matches (completed_at) WHERE completed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pool_matches_completed
  ON pool_matches (completed_at) WHERE completed_at IS NOT NULL;

-- Beyond the list in the brief. The primary keys of these tables lead on
-- user_id, so a read by day would scan them.
-- Rollup of play time per day (the table keeps two months).
CREATE INDEX IF NOT EXISTS idx_game_time_metrics_daily_date
  ON game_time_metrics_daily (date_key);
-- Daily cap reads by date_key (one row per player, game and day).
CREATE INDEX IF NOT EXISTS idx_game_daily_earnings_date
  ON game_daily_earnings (date_key);
-- Live runs in the last 15 minutes.
CREATE INDEX IF NOT EXISTS idx_gse_created
  ON game_score_events (created_at);
-- Quest reads over the window.
CREATE INDEX IF NOT EXISTS idx_user_daily_quests_date
  ON user_daily_quests (date_key);
CREATE INDEX IF NOT EXISTS idx_user_quest_day_date
  ON user_quest_day (date_key);
CREATE INDEX IF NOT EXISTS idx_user_weekly_quests_created
  ON user_weekly_quests (created_at);
CREATE INDEX IF NOT EXISTS idx_user_weekly_cards_created
  ON user_weekly_cards (created_at);
