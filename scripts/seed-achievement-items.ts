/**
 * Seed achievement-exclusive cosmetics + achievement unlock-count rows.
 *
 *   npx tsx scripts/seed-achievement-items.ts
 *
 * These store_items are seeded with active = FALSE so they never appear in the
 * shop or daily rotation — the only way to own one is to unlock the achievement
 * that grants it (grantStoreItem with acquired_source = 'achievement'). The id
 * of each item matches the `cosmeticId` referenced in the achievement registry.
 *
 * Idempotent UPSERT on id, like seed-cosmetics.ts. Also pre-creates a zeroed
 * achievement_unlock_counts row per achievement so rarity queries + the admin
 * view have a complete set to read.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { withTransaction } from '@/server/db/client';
import { ACHIEVEMENTS } from '@/server/arcade/achievements/registry';
import type { StoreRarity } from '@/features/arcade/lib/rewards';

for (const f of ['env/.env.local', 'env/.env', '.env.local', '.env']) {
  try {
    const text = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      if (i === -1) continue;
      const k = line.slice(0, i).trim();
      let v = line.slice(i + 1).trim();
      if (!k || process.env[k] !== undefined) continue;
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[k] = v;
    }
  } catch {
    /* file may not exist */
  }
}

type Slot = 'badge' | 'frame' | 'nameColor' | 'title' | 'background' | 'avatar';

type AchItem = {
  id: string;
  name: string;
  slot: Slot;
  rarity: StoreRarity;
  assetRef: Record<string, unknown>;
  /** Require this image file to exist before seeding (avatars/backgrounds). */
  requireAsset?: string;
};

const pv = (start: string, end: string) => ({ previewBgEnabled: true, previewBgStart: start, previewBgEnd: end });
const A = '/cosmetics/achievements';

// id -> cosmetic. Ids match `cosmeticId` in the registry. Badges keep an emoji
// fallback so a not-yet-generated PNG still renders a usable card; avatars and
// backgrounds are guarded on disk (skipped until their art lands).
const ITEMS: AchItem[] = [
  { id: 'ach-snake', name: 'Apex Serpent', slot: 'badge', rarity: 'legendary', assetRef: { emoji: '🐍', imageUrl: `${A}/badge-snake.png`, ...pv('#04140a', '#22c55e') } },
  { id: 'ach-2048', name: 'Tile Sage', slot: 'badge', rarity: 'legendary', assetRef: { emoji: '🔢', imageUrl: `${A}/badge-2048.png`, ...pv('#1a1004', '#f59e0b') } },
  { id: 'ach-tetris', name: 'Line Cook', slot: 'badge', rarity: 'legendary', assetRef: { emoji: '🧱', imageUrl: `${A}/badge-tetris.png`, ...pv('#0a0f1a', '#818cf8') } },
  { id: 'ach-typing', name: 'Wordsmith', slot: 'badge', rarity: 'legendary', assetRef: { emoji: '⌨️', imageUrl: `${A}/badge-typing.png`, ...pv('#03212b', '#22d3ee') } },
  { id: 'ach-reaction', name: 'Quick Draw', slot: 'badge', rarity: 'legendary', assetRef: { emoji: '⚡', imageUrl: `${A}/badge-reaction.png`, ...pv('#1a1407', '#facc15') } },
  { id: 'ach-daily', name: 'Streak Keeper', slot: 'badge', rarity: 'legendary', assetRef: { emoji: '📅', imageUrl: `${A}/badge-daily.png`, ...pv('#0a1a12', '#34d399') } },
  { id: 'ach-duelist', name: 'Duelist', slot: 'badge', rarity: 'legendary', assetRef: { emoji: '⚔️', imageUrl: `${A}/badge-duelist.png`, ...pv('#1a0606', '#f87171') } },
  { id: 'ach-devotion', name: 'Devotee', slot: 'badge', rarity: 'legendary', assetRef: { emoji: '🕯️', imageUrl: `${A}/badge-devotion.png`, ...pv('#120a1a', '#a855f7') } },
  { id: 'ach-achiever', name: 'Achiever', slot: 'badge', rarity: 'legendary', assetRef: { emoji: '🏅', imageUrl: `${A}/badge-achiever.png`, ...pv('#1a1004', '#fbbf24') } },
  { id: 'ach-tetris-deity', name: 'Tetris Deity', slot: 'badge', rarity: 'legendary', assetRef: { emoji: '🟪', imageUrl: `${A}/badge-tetris-deity.png`, ...pv('#150724', '#a855f7') } },
  { id: 'ach-secret-konami', name: 'Cheat Code', slot: 'badge', rarity: 'epic', assetRef: { emoji: '🎮', imageUrl: `${A}/badge-konami.png`, ...pv('#0a0f1a', '#60a5fa') } },
  { id: 'ach-secret-birthday', name: 'Birthday Cake', slot: 'badge', rarity: 'epic', assetRef: { emoji: '🎂', imageUrl: `${A}/badge-birthday.png`, ...pv('#1a060c', '#fb7185') } },
  // Title / color cosmetics need no generated art.
  { id: 'ach-regular', name: 'Arcade Regular', slot: 'title', rarity: 'legendary', assetRef: { text: 'Arcade Regular', ...pv('#0a0f1a', '#818cf8') } },
  { id: 'ach-tycoon', name: 'Ticket Tycoon', slot: 'title', rarity: 'legendary', assetRef: { text: 'Ticket Tycoon', ...pv('#1a1004', '#fbbf24') } },
  { id: 'ach-flawless', name: 'Flawless', slot: 'frame', rarity: 'legendary', assetRef: { color: '#fde047', ...pv('#1a1407', '#fde047') } },
  { id: 'ach-untouchable', name: 'Untouchable', slot: 'nameColor', rarity: 'legendary', assetRef: { color: '#f43f5e', ...pv('#1a060c', '#f43f5e') } },
  // Avatars / backgrounds guarded on disk.
  { id: 'ach-arcade-master', name: 'Arcade Master', slot: 'background', rarity: 'legendary', requireAsset: `${A}/bg-arcade-master.png`, assetRef: { imageUrl: `${A}/bg-arcade-master.png`, bgStart: '#0b1120', bgEnd: '#312e81', ...pv('#0b1120', '#6366f1') } },
  { id: 'ach-centurion', name: 'Centurion', slot: 'avatar', rarity: 'legendary', requireAsset: `${A}/avatar-centurion.png`, assetRef: { imageUrl: `${A}/avatar-centurion.png`, ...pv('#0b1120', '#1e293b') } },
  { id: 'ach-secret-completionist', name: 'The Completionist', slot: 'avatar', rarity: 'legendary', requireAsset: `${A}/avatar-completionist.png`, assetRef: { imageUrl: `${A}/avatar-completionist.png`, ...pv('#0b1120', '#1e293b') } },
];

const UPSERT_SQL = `
  INSERT INTO store_items (
    id, name, game_type, rarity, currency_type, price,
    slots_json, active, season_tag, asset_ref, created_at
  ) VALUES ($1, $2, 'profile', $3, 'credits', 0, $4, FALSE, 'achievement', $5, $6)
  -- An existing row keeps its price unless it is free (then it gets the seed
  -- price back), and a seed can take it off sale but never put it back on
  -- sale. Admin hides and prices survive a deploy.
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    rarity = excluded.rarity,
    slots_json = excluded.slots_json,
    price = CASE WHEN store_items.price <= 0 AND excluded.price > 0 THEN excluded.price ELSE store_items.price END,
    active = store_items.active AND excluded.active,
    season_tag = excluded.season_tag,
    asset_ref = excluded.asset_ref
`;

/** Idempotent. Seeds achievement cosmetics + zeroed unlock-count rows. */
export async function seedAchievementItems() {
  const now = Date.now();
  let seeded = 0;
  await withTransaction(async (client) => {
    for (const it of ITEMS) {
      if (it.requireAsset) {
        const abs = path.join(process.cwd(), 'public', it.requireAsset.replace(/^\//, ''));
        if (!fs.existsSync(abs)) {
          console.warn(`[seed-achievement-items] skipping ${it.id} — missing ${it.requireAsset}`);
          continue;
        }
      }
      await client.query(UPSERT_SQL, [
        it.id,
        it.name,
        it.rarity,
        JSON.stringify([it.slot]),
        JSON.stringify(it.assetRef),
        now,
      ]);
      seeded += 1;
    }
    // Pre-create a zeroed unlock-count row per achievement.
    for (const def of ACHIEVEMENTS) {
      await client.query(
        `INSERT INTO achievement_unlock_counts (achievement_id, count)
         VALUES ($1, 0) ON CONFLICT (achievement_id) DO NOTHING`,
        [def.id],
      );
    }
  });
  console.log(`[seed-achievement-items] upserted ${seeded} cosmetics, ${ACHIEVEMENTS.length} count rows`);
  return seeded;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seedAchievementItems()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[seed-achievement-items] failed:', err);
      process.exit(1);
    });
}
