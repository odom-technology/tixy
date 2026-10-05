/**
 * Lists every store item whose art is an image-model image, so the prize
 * counter can take them off sale. Read-only.
 *
 *   npx tsx scripts/list-generated-cosmetics.ts [--json]
 *
 * Uses DATABASE_URL (env/.env.local is read like scripts/migrate.ts).
 */
import fs from 'node:fs';
import path from 'node:path';

import pg from 'pg';

import { isGeneratedProfileAsset } from '../src/features/users/generated-cosmetics';

for (const f of ['env/.env.local', 'env/.env']) {
  try {
    for (const raw of fs.readFileSync(path.join(process.cwd(), f), 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      const i = line.indexOf('=');
      if (!line || line.startsWith('#') || i === -1) continue;
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch {
    /* no file */
  }
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const rows = (
  await pool.query<{ id: string; name: string; game_type: string; slots_json: string; active: boolean; price: number; asset_ref: string | null; owners: string }>(
    `SELECT i.id, i.name, i.game_type, i.slots_json, i.active, i.price, i.asset_ref,
            (SELECT COUNT(*) FROM user_owned_items o WHERE o.item_id = i.id) AS owners
       FROM store_items i
      WHERE i.game_type = 'profile'
      ORDER BY i.id`,
  )
).rows.filter((row) => {
  try {
    return isGeneratedProfileAsset(row.asset_ref ? JSON.parse(row.asset_ref) : null);
  } catch {
    return false;
  }
});
await pool.end();

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows.map((r) => r.id), null, 2));
} else {
  for (const r of rows) console.log(`${r.id}\t${r.slots_json}\t${r.active ? 'on sale' : 'off sale'}\t${r.price}\t${r.owners} owners`);
  console.log(`${rows.length} items, ${rows.filter((r) => r.active).length} on sale`);
}
