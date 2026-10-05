-- A keyed, one-way actor pseudonym allows aggregate D1/D7 retention without
-- storing or exposing account IDs. Anonymous and guest events remain unlinkable.
ALTER TABLE product_analytics_events
  ADD COLUMN IF NOT EXISTS actor_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_product_analytics_actor_created
  ON product_analytics_events(actor_hash, created_at)
  WHERE actor_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_analytics_game_event_created
  ON product_analytics_events(game_slug, event_name, created_at)
  WHERE game_slug IS NOT NULL;
