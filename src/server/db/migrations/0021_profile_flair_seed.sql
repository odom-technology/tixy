-- Seed a small catalog of profile flair cosmetics (game_type='profile').
-- Stable ids so the milestone/earned path can grant specific items.
-- asset_ref carries the visual: nameColor/frame -> {color}, badge -> {emoji}, title -> {text}.
INSERT INTO store_items (id, name, game_type, rarity, currency_type, price, slots_json, active, season_tag, asset_ref, created_at)
VALUES
  ('profile-namecolor-gold',    'Gold Name',      'profile', 'rare',   'credits', 500,  '["nameColor"]', TRUE, NULL, '{"color":"#f5c518"}', (extract(epoch from now()) * 1000)::bigint),
  ('profile-namecolor-emerald', 'Emerald Name',   'profile', 'rare',   'credits', 500,  '["nameColor"]', TRUE, NULL, '{"color":"#10b981"}', (extract(epoch from now()) * 1000)::bigint),
  ('profile-frame-gold',        'Gold Frame',     'profile', 'epic',   'credits', 800,  '["frame"]',     TRUE, NULL, '{"color":"#f5c518"}', (extract(epoch from now()) * 1000)::bigint),
  ('profile-badge-crown',       'Crown Badge',    'profile', 'epic',   'credits', 1000, '["badge"]',     TRUE, NULL, '{"emoji":"👑"}',      (extract(epoch from now()) * 1000)::bigint),
  ('profile-badge-connector',   'Connector Badge','profile', 'rare',   'credits', 600,  '["badge"]',     TRUE, NULL, '{"emoji":"🤝"}',      (extract(epoch from now()) * 1000)::bigint),
  ('profile-title-strategist',  'Strategist',     'profile', 'epic',   'credits', 750,  '["title"]',     TRUE, NULL, '{"text":"Strategist"}', (extract(epoch from now()) * 1000)::bigint)
ON CONFLICT (id) DO NOTHING;
