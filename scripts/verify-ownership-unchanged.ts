/**
 * Read-only ownership snapshot. Counts what players own, so a change can be
 * checked against a copy of production before and after it runs: owned items,
 * equipped items, achievements and the avatar each account points at, plus a
 * hash of every (player, item) pair so a swap with equal counts still shows.
 *
 *   npx tsx scripts/verify-ownership-unchanged.ts snapshot /tmp/before.json
 *   # apply the change (deploy, migrate, seed, admin action) to the same database
 *   npx tsx scripts/verify-ownership-unchanged.ts compare /tmp/before.json
 *
 * Uses DATABASE_URL (env/.env.local is read the same way as scripts/migrate.ts).
 * Its sessions are read-only and it reads in one read-only transaction.
 * `compare` exits 1 and prints the differences if anything moved.
 * scripts/verify-store-hiding.ts uses the same snapshot.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Pool, PoolClient } from 'pg';

export type OwnershipSnapshot = {
  database: string;
  takenAt: string;
  ownedItems: number;
  ownedByItem: Record<string, number>;
  /** md5 over every (user_id, item_id) pair. */
  ownedPairsHash: string;
  equippedItems: number;
  equippedByItem: Record<string, number>;
  /** md5 over every (user_id, game_type, slot, item_id) row. */
  equippedPairsHash: string;
  achievements: number;
  imageUrls: Record<string, number>;
  /** md5 over every (account id, image_url) pair. */
  imageUrlPairsHash: string;
};

const countMap = async (client: PoolClient, sql: string) => {
  const rows = (await client.query<{ key: string | null; count: string }>(sql)).rows;
  return Object.fromEntries(rows.map((row) => [row.key ?? '(none)', Number(row.count)]));
};

const hashOf = async (client: PoolClient, sql: string) =>
  (await client.query<{ hash: string | null }>(sql)).rows[0]?.hash ?? 'empty';

/** Reads in one read-only, repeatable-read transaction: it can't write, and it sees one moment. */
export async function takeOwnershipSnapshot(pool: Pool): Promise<OwnershipSnapshot> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const database = (await client.query<{ db: string }>('SELECT current_database() AS db')).rows[0]!.db;
    const ownedByItem = await countMap(
      client,
      'SELECT item_id AS key, COUNT(*) AS count FROM user_owned_items GROUP BY 1 ORDER BY 1',
    );
    const ownedPairsHash = await hashOf(
      client,
      `SELECT md5(string_agg(user_id || ':' || item_id, ',' ORDER BY user_id, item_id)) AS hash
       FROM user_owned_items`,
    );
    const equippedByItem = await countMap(
      client,
      'SELECT item_id AS key, COUNT(*) AS count FROM user_equipped_items GROUP BY 1 ORDER BY 1',
    );
    const equippedPairsHash = await hashOf(
      client,
      `SELECT md5(string_agg(user_id || ':' || game_type || ':' || slot || ':' || item_id, ','
                             ORDER BY user_id, game_type, slot)) AS hash
       FROM user_equipped_items`,
    );
    const hasAchievements = Boolean(
      (await client.query(`SELECT to_regclass('public.user_achievements') AS name`)).rows[0]?.name,
    );
    const achievements = hasAchievements
      ? Number((await client.query<{ count: string }>('SELECT COUNT(*) AS count FROM user_achievements')).rows[0]!.count)
      : 0;
    const imageUrls = await countMap(
      client,
      'SELECT image_url AS key, COUNT(*) AS count FROM arcade_accounts GROUP BY 1 ORDER BY 1',
    );
    const imageUrlPairsHash = await hashOf(
      client,
      `SELECT md5(string_agg(id || ':' || coalesce(image_url, ''), ',' ORDER BY id)) AS hash
       FROM arcade_accounts`,
    );
    await client.query('COMMIT');
    const sum = (map: Record<string, number>) => Object.values(map).reduce((a, b) => a + b, 0);
    return {
      database,
      takenAt: new Date().toISOString(),
      ownedItems: sum(ownedByItem),
      ownedByItem,
      ownedPairsHash,
      equippedItems: sum(equippedByItem),
      equippedByItem,
      equippedPairsHash,
      achievements,
      imageUrls,
      imageUrlPairsHash,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Lists every difference between two snapshots; empty when ownership is unchanged. */
export function diffOwnershipSnapshots(before: OwnershipSnapshot, after: OwnershipSnapshot) {
  const diffs: string[] = [];
  const compareMaps = (label: string, a: Record<string, number>, b: Record<string, number>) => {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if ((a[key] ?? 0) !== (b[key] ?? 0)) diffs.push(`${label} ${key}: ${a[key] ?? 0} -> ${b[key] ?? 0}`);
    }
  };
  if (before.ownedItems !== after.ownedItems) diffs.push(`owned items: ${before.ownedItems} -> ${after.ownedItems}`);
  if (before.equippedItems !== after.equippedItems) diffs.push(`equipped items: ${before.equippedItems} -> ${after.equippedItems}`);
  if (before.achievements !== after.achievements) diffs.push(`achievements: ${before.achievements} -> ${after.achievements}`);
  compareMaps('owned', before.ownedByItem, after.ownedByItem);
  compareMaps('equipped', before.equippedByItem, after.equippedByItem);
  compareMaps('image_url', before.imageUrls, after.imageUrls);
  if (before.ownedPairsHash !== after.ownedPairsHash) diffs.push('owned pairs hash changed');
  if (before.equippedPairsHash !== after.equippedPairsHash) diffs.push('equipped pairs hash changed');
  if (before.imageUrlPairsHash !== after.imageUrlPairsHash) diffs.push('image_url pairs hash changed');
  return diffs;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, file] = process.argv.slice(2);
  if ((command !== 'snapshot' && command !== 'compare') || !file) {
    console.error('usage: verify-ownership-unchanged.ts snapshot|compare <file.json>');
    process.exit(2);
  }
  for (const f of ['env/.env.local', 'env/.env', '.env.local', '.env']) {
    try {
      for (const raw of fs.readFileSync(path.join(process.cwd(), f), 'utf8').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#') || !line.includes('=')) continue;
        const key = line.slice(0, line.indexOf('=')).trim();
        if (process.env[key] === undefined) {
          process.env[key] = line.slice(line.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
        }
      }
    } catch {
      // missing env file
    }
  }
  const { Pool: PgPool } = await import('pg');
  // Every session is read-only, on top of the read-only snapshot transaction.
  const pool = new PgPool({
    connectionString: process.env.DATABASE_URL,
    options: '-c default_transaction_read_only=on',
  });
  try {
    const now = await takeOwnershipSnapshot(pool);
    if (command === 'snapshot') {
      fs.writeFileSync(file, `${JSON.stringify(now, null, 2)}\n`);
      console.log(
        `Saved ${file}: ${now.ownedItems} owned, ${now.equippedItems} equipped, ${now.achievements} achievements, ${Object.keys(now.imageUrls).length} distinct avatars in ${now.database}.`,
      );
    } else {
      const before = JSON.parse(fs.readFileSync(file, 'utf8')) as OwnershipSnapshot;
      const diffs = diffOwnershipSnapshots(before, now);
      if (diffs.length > 0) {
        console.error(`Ownership changed since ${before.takenAt}:\n  ${diffs.join('\n  ')}`);
        process.exitCode = 1;
      } else {
        console.log(
          `Ownership unchanged since ${before.takenAt}: ${now.ownedItems} owned, ${now.equippedItems} equipped, ${now.achievements} achievements.`,
        );
      }
    }
  } finally {
    await pool.end();
  }
}
