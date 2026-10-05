/**
 * Seed the art kit's frames and namecards as store items.
 *
 *   npx tsx scripts/seed-art-kit-items.ts
 *
 * The item ids are the kit's own ids (`frame-brass`, `namecard-awning`), so
 * the prize counter and the season card can seed the same rows. `counter`
 * items are on sale at the counter catalog's price;
 * `season` items are earned on the season card and never sold.
 * Idempotent, same upsert rules as seed-cosmetics.ts: a seed can take an item
 * off sale and never put it back, and an existing price stays.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { withTransaction } from '@/server/db/client';
import { SEASON_CARD_KEY } from '@/server/arcade/battlepass/season-card';
import { FRAMES, NAMECARDS, artPath, type ArtItem } from '@/features/brand/avatars/catalog';
import type { StoreRarity } from '@/features/arcade/lib/rewards';
import { SHELF_RARITY, getCounterItem } from '@/features/arcade/lib/skins/counter-catalog';

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

/* Counter items take their shelf from the prize counter's catalog
   (counter-catalog.ts), the one place prices are set; this seed runs first,
   so the price it inserts is the one that sticks. The season card's items
   are never sold, so their shelf is only stored. Stored rarity only picks
   the shelf; nothing shows a rarity word. */
const SEASON_SHELF: Record<string, { rarity: StoreRarity; price: number }> = {
  'frame-ticket': { rarity: 'epic', price: 1200 },
  'namecard-lights': { rarity: 'epic', price: 1200 },
};
const shelfFor = (id: string) => {
  const counter = getCounterItem(id);
  return counter ? { rarity: SHELF_RARITY[counter.price], price: counter.price } : SEASON_SHELF[id];
};

const UPSERT_SQL = `
  INSERT INTO store_items (
    id, name, game_type, rarity, currency_type, price,
    slots_json, active, season_tag, asset_ref, created_at
  ) VALUES ($1, $2, 'profile', $3, 'credits', $4, $5, $6, $7, $8, $9)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    game_type = excluded.game_type,
    rarity = excluded.rarity,
    slots_json = excluded.slots_json,
    price = CASE WHEN store_items.price <= 0 AND excluded.price > 0 THEN excluded.price ELSE store_items.price END,
    active = store_items.active AND excluded.active,
    season_tag = excluded.season_tag,
    asset_ref = excluded.asset_ref
`;

const rows = [...FRAMES, ...NAMECARDS].map((item) => {
  const shelf = shelfFor(item.id);
  if (!shelf) throw new Error(`No shelf for ${item.id}`);
  const slot = item.kind === 'frame' ? 'frame' : 'background';
  const assetRef =
    item.kind === 'frame'
      ? { frame: item.frame, imageUrl: artPath(item as ArtItem, 'svg') }
      : { namecard: item.card, imageUrl: artPath(item as ArtItem, 'svg') };
  return {
    id: item.id,
    name: item.name,
    slot,
    ...shelf,
    active: item.source === 'counter',
    seasonTag: item.source === 'season' ? SEASON_CARD_KEY : null,
    assetRef,
  };
});

export async function seedArtKitItems() {
  const now = Date.now();
  await withTransaction(async (client) => {
    for (const row of rows) {
      await client.query(UPSERT_SQL, [
        row.id,
        row.name,
        row.rarity,
        row.price,
        JSON.stringify([row.slot]),
        row.active,
        row.seasonTag,
        JSON.stringify(row.assetRef),
        now,
      ]);
    }
  });
  console.log(`[seed-art-kit-items] upserted ${rows.length} items`);
  return rows.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seedArtKitItems()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[seed-art-kit-items] failed:', err);
      process.exit(1);
    });
}
