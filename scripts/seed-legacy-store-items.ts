/**
 * Seed the "legacy" admin-authored store catalogs that never had a code seed.
 *
 *   npx tsx scripts/seed-legacy-store-items.ts
 *
 * 8-ball and flappy-bird cosmetics were created through the admin skin-studio
 * UI and only ever lived in whichever database they were authored in (they have
 * generated UUID / hash ids, not curated slugs). Every other game's catalog is
 * produced by a code seed (seed-cosmetics / seed-*-items), so those games show
 * up in a freshly-migrated database while 8-ball + flappy-bird do not.
 *
 * This snapshots those rows (scripts/data/legacy-store-items.json) and UPSERTs
 * them by id. A new row gets its price from its rarity (see PRICE_BY_RARITY
 * below). An existing row keeps its price and can't be put back on sale by a
 * deploy, so an admin's price or hide survives it, like every other catalog
 * seed. Idempotent: re-running just
 * refreshes the same ids. To refresh the snapshot from a database that has the
 * latest skin-studio edits, re-export with:
 *
 *   psql "$DATABASE_URL" -At -c "SELECT json_agg(row ORDER BY row->>'game_type', row->>'id')
 *     FROM (SELECT json_build_object('id',id,'name',name,'gameType',game_type,
 *       'rarity',rarity,'currencyType',currency_type,'price',price,
 *       'slots',slots_json::json,'active',active,'seasonTag',season_tag,
 *       'assetRef',asset_ref::json) AS row FROM store_items
 *       WHERE game_type IN ('8-ball','flappy-bird') AND season_tag IS NULL) sub;"
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { withTransaction } from '@/server/db/client';
import { LEGACY_SEEDS_ON_SALE } from '@/server/arcade/rewards/legacy-catalog';

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
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      process.env[k] = v;
    }
  } catch {
    /* file may not exist */
  }
}

type LegacyItem = {
  id: string;
  name: string;
  gameType: string;
  rarity: string;
  currencyType: string;
  price: number;
  slots: string[];
  active: boolean;
  seasonTag: string | null;
  assetRef: Record<string, unknown>;
};

const DATA_PATH = path.join(process.cwd(), 'scripts', 'data', 'legacy-store-items.json');

// wave-d: all 37 snapshotted 8-ball + flappy-bird rows carry OLD-economy
// prices (the 9 legendaries sat at 10–15 tickets, e.g. "CHROME Cue" = 15).
// Now that legendaries are purchasable via the daily legendary marquee slots,
// those stale prices would let players buy a legendary for pocket change, so
// an inserted row maps rarity → the current economy price (matches PRICE_BY_RARITY
// in scripts/seed-cosmetics.ts; the JSON snapshot's price field is
// intentionally ignored). Idempotent: deterministic per rarity.
const PRICE_BY_RARITY: Record<string, number> = {
  common: 450,
  rare: 750,
  epic: 1200,
  legendary: 2000,
};

// An unmapped rarity must be a seed-time crash, not a silent fallback to the
// stale snapshot price — that fallback would quietly reintroduce the cheap
// purchasable legendary this normalization exists to fix.
const normalizedPrice = (it: LegacyItem): number => {
  const price = PRICE_BY_RARITY[it.rarity];
  if (price === undefined) {
    throw new Error(
      `[seed-legacy-store-items] unmapped rarity '${it.rarity}' on ${it.id} — add it to PRICE_BY_RARITY`,
    );
  }
  return price;
};

const UPSERT_SQL = `
  INSERT INTO store_items (
    id, name, game_type, rarity, currency_type, price,
    slots_json, active, season_tag, asset_ref, created_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  -- An existing row keeps its price unless it is free (then it gets the seed
  -- price back), and a seed can take it off sale but never put it back on
  -- sale. Admin hides and prices survive a deploy.
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    game_type = excluded.game_type,
    rarity = excluded.rarity,
    currency_type = excluded.currency_type,
    slots_json = excluded.slots_json,
    price = CASE WHEN store_items.price <= 0 AND excluded.price > 0 THEN excluded.price ELSE store_items.price END,
    active = store_items.active AND excluded.active,
    season_tag = excluded.season_tag,
    asset_ref = excluded.asset_ref
`;

/** Idempotent: UPSERTs the snapshotted 8-ball + flappy-bird catalogs by id. */
export async function seedLegacyStoreItems() {
  const items = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')) as LegacyItem[];
  const now = Date.now();
  await withTransaction(async (client) => {
    for (const it of items) {
      await client.query(UPSERT_SQL, [
        it.id,
        it.name,
        it.gameType,
        it.rarity,
        it.currencyType,
        normalizedPrice(it),
        JSON.stringify(it.slots),
        it.active && LEGACY_SEEDS_ON_SALE,
        it.seasonTag,
        JSON.stringify(it.assetRef),
        now,
      ]);
    }
  });
  const byGame = items.reduce<Record<string, number>>((acc, it) => {
    acc[it.gameType] = (acc[it.gameType] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`[seed-legacy-store-items] upserted ${items.length} items`, byGame);
  return items.length;
}

// Run standalone: `npx tsx scripts/seed-legacy-store-items.ts`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seedLegacyStoreItems()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[seed-legacy-store-items] failed:', err);
      process.exit(1);
    });
}
