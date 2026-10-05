import fs from 'node:fs/promises';
import path from 'node:path';

import { Client } from 'pg';

async function loadEnvFile(filePath: string) {
  let text: string;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return;
    }
    throw error;
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

for (const envFile of ['env/.env.local', 'env/.env', '.env.local', '.env']) {
  await loadEnvFile(path.join(process.cwd(), envFile));
}

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required to run migrations. Copy env/.env.example to env/.env.local and set DATABASE_URL.',
  );
}

const migrationsDir = path.join(process.cwd(), 'src', 'server', 'db', 'migrations');
const client = new Client({ connectionString: databaseUrl });

try {
  await client.connect();
} catch (error) {
  const cause =
    error instanceof Error && error.message ? ` ${error.message}` : '';
  throw new Error(
    `Could not connect to Postgres using DATABASE_URL.${cause} Start Postgres and verify the host, port, user, password, and database name.`,
  );
}

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS arcade_schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const id = file.replace(/\.sql$/, '');
    const applied = await client.query(
      'SELECT 1 FROM arcade_schema_migrations WHERE id = $1',
      [id],
    );
    if (applied.rowCount) continue;

    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO arcade_schema_migrations (id) VALUES ($1)', [
        id,
      ]);
      await client.query('COMMIT');
      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  await client.end();
}

// Seed the full store catalog after migrations so every deploy ships the
// per-game cosmetics, not just the handful of profile-flair items a SQL
// migration seeds. All seeds here are idempotent UPSERTs (no deletes), so
// re-running on each deploy is safe. On an existing item they refresh name,
// rarity, slots and art, keep the price (a price of 0 gets the seed price
// back), and can take the item off sale but
// never put it back, so an admin's hide or price survives every deploy
// (scripts/verify-store-hiding.ts checks this). seed-connections is intentionally
// excluded — it deletes + re-inserts and would clobber admin-edited puzzles.
try {
  // Newer solo/PvP games (gopher, ricochet, swerve, breakout, …) + profile.
  const { seedCosmetics } = await import('./seed-cosmetics');
  // Battlepass-exclusive items (active = FALSE; not in the store rotation).
  const { seedSeason0 } = await import('./seed-season-0');
  // Original-game starter catalogs. These were written to run "on server
  // startup" but were never wired to any caller, so prod never got them —
  // run them here. Each is idempotent (count-guarded UPSERT).
  const { seedChessStarterItems } = await import('@/server/arcade/rewards/seed-chess-items');
  const { seedTetrisStarterItems } = await import('@/server/arcade/rewards/seed-tetris-items');
  const { seed2048StarterItems } = await import('@/server/arcade/rewards/seed-2048-items');
  const { seedCoinFlipStarterItems } = await import('@/server/arcade/rewards/seed-coin-flip-items');
  // 8-ball + flappy-bird catalogs were authored via the admin skin-studio UI
  // and never had a code seed, so they only existed in whatever DB created
  // them. Snapshotted to scripts/data/legacy-store-items.json and UPSERTed here.
  const { seedLegacyStoreItems } = await import('./seed-legacy-store-items');
  // Achievement-exclusive cosmetics (active = FALSE; granted only on unlock) +
  // zeroed achievement unlock-count rows.
  const { seedAchievementItems } = await import('./seed-achievement-items');
  // The prize counter's catalog. Everything above is off sale since the
  // shop reset (src/server/arcade/rewards/legacy-catalog.ts).
  const { seedCounter } = await import('./seed-counter');

  const { seedArtKitItems } = await import('./seed-art-kit-items');

  await seedCosmetics();
  await seedAchievementItems();
  await seedSeason0();
  await seedChessStarterItems();
  await seedTetrisStarterItems();
  await seed2048StarterItems();
  await seedCoinFlipStarterItems();
  await seedLegacyStoreItems();
  await seedArtKitItems();
  await seedCounter();
  console.log(
    'Seeded store catalog (cosmetics + season-0 + chess/tetris/2048/coin-flip + 8-ball/flappy-bird + the counter).',
  );

  // The storefront shows a deterministic DAILY ROTATION, not the full catalog,
  // and generateStoreDailyRotation() returns an already-generated day as-is.
  // A deploy that adds items therefore wouldn't surface them until the next
  // date key — and worse, the very first deploy that seeds the per-game
  // catalog leaves today's rotation frozen on whatever tiny pool existed
  // before (e.g. profile-only). Force a refresh so newly-seeded items appear
  // immediately. The pick is deterministic per date key, so a same-day re-run
  // with an unchanged pool reproduces the same rotation.
  const { generateStoreDailyRotation } = await import('@/server/arcade/rewards');
  const rotation = await generateStoreDailyRotation(undefined, true);
  console.log(`Refreshed store daily rotation (${rotation.length} slots).`);
} catch (error) {
  const cause = error instanceof Error && error.message ? ` ${error.message}` : '';
  console.error(`Catalog seeding failed after migrations.${cause}`);
  process.exit(1);
}

process.exit(0);
