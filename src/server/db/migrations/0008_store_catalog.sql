CREATE TABLE IF NOT EXISTS store_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  game_type TEXT NOT NULL,
  rarity TEXT NOT NULL,
  currency_type TEXT NOT NULL,
  price INTEGER NOT NULL,
  slots_json TEXT NOT NULL DEFAULT '[]',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  season_tag TEXT,
  asset_ref TEXT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_store_items_active_currency
  ON store_items(active, currency_type, game_type);

CREATE TABLE IF NOT EXISTS store_daily_rotation (
  date_key TEXT NOT NULL,
  slot_index INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  PRIMARY KEY (date_key, slot_index)
);

CREATE INDEX IF NOT EXISTS idx_store_daily_rotation_item
  ON store_daily_rotation(item_id);

CREATE TABLE IF NOT EXISTS store_daily_beskar (
  date_key TEXT NOT NULL,
  slot_index INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  PRIMARY KEY (date_key, slot_index)
);

CREATE INDEX IF NOT EXISTS idx_store_daily_beskar_item
  ON store_daily_beskar(item_id);

CREATE TABLE IF NOT EXISTS user_owned_items (
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  acquired_at BIGINT NOT NULL,
  acquired_source TEXT NOT NULL,
  PRIMARY KEY (user_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_user_owned_items_item
  ON user_owned_items(item_id);

CREATE TABLE IF NOT EXISTS user_equipped_items (
  user_id TEXT NOT NULL,
  game_type TEXT NOT NULL,
  slot TEXT NOT NULL,
  item_id TEXT NOT NULL,
  equipped_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, game_type, slot)
);

CREATE INDEX IF NOT EXISTS idx_user_equipped_items_item
  ON user_equipped_items(item_id);

CREATE TABLE IF NOT EXISTS skin_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  game_type TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  created_by TEXT,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS skin_group_items (
  group_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (group_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_skin_group_items_item
  ON skin_group_items(item_id);
