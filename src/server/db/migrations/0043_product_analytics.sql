-- Small, first-party product funnel log. Intentionally excludes IP addresses,
-- user agents, referrers, query strings, account IDs, and arbitrary JSON.
CREATE TABLE IF NOT EXISTS product_analytics_events (
  id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL CHECK (
    event_name IN (
      'landing_view',
      'game_started',
      'game_completed',
      'auth_nudge_shown',
      'auth_nudge_clicked',
      'auth_nudge_dismissed',
      'signup_success',
      'signin_success',
      'result_shared',
      'challenge_opened'
    )
  ),
  session_hash TEXT NOT NULL,
  is_authenticated BOOLEAN NOT NULL DEFAULT FALSE,
  path TEXT,
  game_slug TEXT,
  source TEXT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_product_analytics_event_created
  ON product_analytics_events(event_name, created_at);

CREATE INDEX IF NOT EXISTS idx_product_analytics_session_created
  ON product_analytics_events(session_hash, created_at);
