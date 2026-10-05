-- Existing installations may already have applied 0043 before sharing events
-- were added. Keep its focused event-name constraint while extending the same
-- low-cardinality vocabulary.
ALTER TABLE product_analytics_events
  DROP CONSTRAINT IF EXISTS product_analytics_events_event_name_check;

ALTER TABLE product_analytics_events
  ADD CONSTRAINT product_analytics_events_event_name_check CHECK (
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
  );
