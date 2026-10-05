/**
 * Seed the prize counter's catalog (src/features/arcade/lib/skins/counter-catalog.ts).
 *
 *   npx tsx scripts/seed-counter.ts
 *
 * Runs on every deploy from scripts/migrate.ts, after the older seeds. Same
 * rules as every catalog seed since #50: an existing row keeps its price and
 * a seed never puts a hidden item back on sale, so an admin's hide sticks.
 *
 * Only prizes that are on sale are written. A skin for a game that doesn't
 * draw skin sets yet is left out entirely, not seeded hidden: a hidden seed
 * row could never come back on sale, so the game's follow-up turns it on by
 * drawing the skins and flipping `renders` in SKIN_GAMES.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { withTransaction } from '@/server/db/client';
import { COUNTER_CATALOG, SHELF_RARITY } from '@/features/arcade/lib/skins/counter-catalog';

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

const UPSERT_SQL = `
  INSERT INTO store_items (
    id, name, game_type, rarity, currency_type, price,
    slots_json, active, season_tag, asset_ref, created_at
  ) VALUES ($1, $2, $3, $4, 'credits', $5, $6, TRUE, NULL, $7, $8)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    game_type = excluded.game_type,
    rarity = excluded.rarity,
    slots_json = excluded.slots_json,
    price = CASE WHEN store_items.price <= 0 AND excluded.price > 0 THEN excluded.price ELSE store_items.price END,
    active = store_items.active AND excluded.active,
    asset_ref = excluded.asset_ref
`;

export async function seedCounter() {
  const items = COUNTER_CATALOG.filter((item) => item.onSale);
  const now = Date.now();
  await withTransaction(async (client) => {
    for (const item of items) {
      await client.query(UPSERT_SQL, [
        item.id,
        item.name,
        item.gameType,
        SHELF_RARITY[item.price],
        item.price,
        JSON.stringify(item.slots),
        JSON.stringify(item.assetRef),
        now,
      ]);
    }
  });
  const byKind = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.kind] = (acc[item.kind] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`[seed-counter] upserted ${items.length} prizes`, byKind);
  return items.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seedCounter()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[seed-counter] failed:', err);
      process.exit(1);
    });
}
