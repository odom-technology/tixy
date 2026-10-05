/**
 * Seed the battlepass EXCLUSIVE cosmetics: the old season 0's and the live season's.
 *
 *   npx tsx scripts/seed-season-0.ts
 *
 * These live in store_items so the equip/preview/ownership plumbing works, but
 * are inserted with active = FALSE and season_tag = 'season-0' so they never
 * appear in the purchasable daily rotation — they're only obtainable by claiming
 * battlepass tiers. Idempotent (UPSERT by id).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { withTransaction } from '@/server/db/client';
import { SEASON_0_ITEMS, SEASON_KEY } from '@/server/arcade/battlepass/season-0';
import { SEASON_CARD_ITEMS, SEASON_CARD_KEY } from '@/server/arcade/battlepass/season-card';

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

const UPSERT_SQL = `
  INSERT INTO store_items (
    id, name, game_type, rarity, currency_type, price,
    slots_json, active, season_tag, asset_ref, created_at
  ) VALUES ($1, $2, $3, $4, 'credits', 0, $5, FALSE, $6, $7, $8)
  -- An existing row keeps its price unless it is free (then it gets the seed
  -- price back), and a seed can take it off sale but never put it back on
  -- sale. Admin hides and prices survive a deploy.
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

/** Idempotent: UPSERTs the battlepass-exclusive items. Safe to re-run on deploy. */
export async function seedSeason0() {
  const now = Date.now();
  await withTransaction(async (client) => {
    const items = [
      ...SEASON_0_ITEMS.map((it) => ({ it, seasonKey: SEASON_KEY })),
      ...SEASON_CARD_ITEMS.map((it) => ({ it, seasonKey: SEASON_CARD_KEY })),
    ];
    for (const { it, seasonKey } of items) {
      await client.query(UPSERT_SQL, [
        it.id,
        it.name,
        it.gameType,
        it.rarity,
        JSON.stringify([it.slot]),
        seasonKey,
        JSON.stringify(it.assetRef),
        now,
      ]);
    }
  });
  const count = SEASON_0_ITEMS.length + SEASON_CARD_ITEMS.length;
  console.log(`[seed-season-0] upserted ${count} exclusive items (the old season 0 and the live season)`);
  return count;
}

// Run standalone: `npx tsx scripts/seed-season-0.ts`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seedSeason0()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[seed-season-0] failed:', err);
      process.exit(1);
    });
}
