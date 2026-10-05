/**
 * High striker's achievement reset (migration 0073_high_striker_endless.sql).
 *
 *   npm run test:high-striker-reset          static checks, no database
 *   npm run test:high-striker-reset -- --db  also runs it on a throwaway database
 *
 * Static: the migration only deletes; it deletes exactly the Strongman and
 * Bell Ringer ids the registry has (both retired, so nobody is shown them),
 * their global tallies and the two stats they read; it never names a wallet,
 * ledger, XP, cosmetic or score table; and the endless series it makes room
 * for are listed, on new ids and new stats.
 *
 * With --db: creates a scratch database on DATABASE_URL's server, applies
 * every migration before 0073, seeds two players (old high striker tiers, a
 * snake tier, a new endless tier, stats, XP, a wallet and a ledger row),
 * applies 0073 twice, and checks that only the old high striker rows went.
 * The scratch database is dropped afterwards. The shared database is never
 * touched.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

import { ACHIEVEMENTS, isRetiredAchievement } from '../src/server/arcade/achievements/registry';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(root, 'src/server/db/migrations');
const MIGRATION = '0073_high_striker_endless.sql';
const ok = (message: string) => console.log(`ok    ${message}`);

const sql = readFileSync(path.join(migrationsDir, MIGRATION), 'utf8');
const code = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

/* ------------------------------------------------------------------ */
/* Static                                                              */
/* ------------------------------------------------------------------ */

const statements = code
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);
for (const statement of statements) {
  assert.match(statement, /^DELETE FROM (user_achievements|achievement_unlock_counts|user_stats)\b/, `only deletes from the achievement tables: ${statement.slice(0, 60)}`);
}
ok(`0073 is ${statements.length} DELETEs on user_achievements, achievement_unlock_counts and user_stats`);

assert.doesNotMatch(code, /wallet|ledger|account_xp|store_|inventory|_scores|UPDATE|DROP|TRUNCATE|INSERT/i, 'touches nothing else');
ok('0073 never names a wallet, ledger, XP, cosmetic or score table, and never updates, drops or inserts');

const oldSeries = ['high-striker-score', 'high-striker-bell-ringer'];
const oldIds = ACHIEVEMENTS.filter((a) => a.seriesId && oldSeries.includes(a.seriesId)).map((a) => a.id).sort();
const listedIds = (pattern: RegExp) => [...new Set([...code.matchAll(pattern)].map((m) => m[1]))].sort();
const deletedIds = listedIds(/'(high-striker-[a-z-]+-\d)'/g);
assert.deepEqual(deletedIds, oldIds, 'deletes exactly the old series ids');
assert.equal(oldIds.length, 10);
for (const statement of statements.filter((s) => !s.includes('user_stats'))) {
  assert.deepEqual([...new Set([...statement.matchAll(/'(high-striker-[a-z-]+-\d)'/g)].map((m) => m[1]))].sort(), oldIds, 'each achievement DELETE lists all ten ids');
}
ok(`0073 deletes exactly Strongman's and Bell Ringer's ten ids: ${oldIds.join(', ')}`);

const oldStats = [...new Set(ACHIEVEMENTS.filter((a) => a.seriesId && oldSeries.includes(a.seriesId)).map((a) => (a.condition as { stat: string }).stat))].sort();
const deletedStats = listedIds(/'(high-striker\.[a-z_]+)'/g);
assert.deepEqual(deletedStats, oldStats, 'deletes exactly the stats the old series read');
ok(`0073 clears the stats the old series read (${oldStats.join(', ')}) and keeps high-striker.games`);

for (const id of oldIds) {
  const def = ACHIEVEMENTS.find((a) => a.id === id)!;
  assert.ok(isRetiredAchievement(def), `${id} is retired`);
  assert.equal(def.cosmeticId, undefined, `${id} granted no cosmetic`);
}
ok('both old series stay in the registry, retired (ids still resolve, shown to no one), and none granted a cosmetic');

const newSeries = ACHIEVEMENTS.filter((a) => a.seriesId === 'high-striker-depth' || a.seriesId === 'high-striker-bells');
assert.equal(newSeries.length, 10, 'two endless series of five');
for (const def of newSeries) {
  assert.ok(!isRetiredAchievement(def), `${def.id} is listed`);
  assert.ok(!deletedIds.includes(def.id), `${def.id} is not reset`);
  assert.ok(!deletedStats.includes((def.condition as { stat: string }).stat), `${def.id} reads a stat the reset keeps`);
}
ok('the endless series (Iron Arm, Dead Centre) are listed on new ids and stats the reset never touches');

const later = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql') && f > MIGRATION);
ok(`0073 is ${later.length === 0 ? 'the newest migration' : `followed by ${later.join(', ')}`}`);

/* ------------------------------------------------------------------ */
/* Database                                                            */
/* ------------------------------------------------------------------ */

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const file of ['env/.env.local', 'env/.env']) {
    try {
      const text = readFileSync(path.join(root, file), 'utf8');
      const line = text.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
      if (line) return line.slice('DATABASE_URL='.length).replace(/^["']|["']$/g, '');
    } catch {
      // next
    }
  }
  throw new Error('DATABASE_URL is required for --db');
}

async function runDb() {
  const base = new URL(databaseUrl());
  const scratch = `arcade_hs_reset_${process.pid}_${Date.now()}`;
  const admin = new Client({ connectionString: base.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${scratch}`);
  const url = new URL(base.toString());
  url.pathname = `/${scratch}`;
  const db = new Client({ connectionString: url.toString() });
  try {
    await db.connect();
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (file >= MIGRATION) break;
      await db.query(readFileSync(path.join(migrationsDir, file), 'utf8'));
    }
    ok(`scratch database ${scratch}: ${files.indexOf(MIGRATION)} migrations before 0073 applied`);

    const now = Date.now();
    const users = ['hs-reset-a', 'hs-reset-b'];
    const keep = ['snake-score-1', 'high-striker-depth-1'];
    for (const user of users) {
      for (const id of [...oldIds, ...keep]) {
        await db.query(
          `INSERT INTO user_achievements (user_id, achievement_id, tier, unlocked_at, xp_awarded, seen) VALUES ($1, $2, 1, $3, 120, TRUE)`,
          [user, id, now],
        );
      }
      for (const [key, value] of [['high-striker.best', 140], ['high-striker.best_five', 21], ['high-striker.games', 30], ['snake.best', 90], ['global.achievements_unlocked', 12], ['high-striker.endless_depth', 4]] as const) {
        await db.query(`INSERT INTO user_stats (user_id, stat_key, value, updated_at) VALUES ($1, $2, $3, $4)`, [user, key, value, now]);
      }
      await db.query(`INSERT INTO user_account_xp (user_id, xp, updated_at) VALUES ($1, 5000, $2)`, [user, now]);
      await db.query(`INSERT INTO wallets (user_id, credits, wupiupi, updated_at) VALUES ($1, 777, 0, $2)`, [user, now]);
      await db.query(
        `INSERT INTO currency_ledger (id, user_id, currency_type, amount, balance_after, source_type, source_id, created_at) VALUES ($1, $2, 'credits', 60, 777, 'game', 'high-striker:x', $3)`,
        [`${user}-ledger`, user, now],
      );
    }
    for (const id of [...oldIds, ...keep]) {
      await db.query(`INSERT INTO achievement_unlock_counts (achievement_id, count) VALUES ($1, 2)`, [id]);
    }
    const snapshot = async () => ({
      xp: (await db.query(`SELECT user_id, xp FROM user_account_xp ORDER BY user_id`)).rows,
      wallets: (await db.query(`SELECT user_id, credits FROM wallets ORDER BY user_id`)).rows,
      ledger: (await db.query(`SELECT id, amount, balance_after FROM currency_ledger ORDER BY id`)).rows,
    });
    const before = await snapshot();

    // Apply it twice: the runner applies it once, and a second run is a no-op.
    for (let i = 0; i < 2; i += 1) {
      await db.query('BEGIN');
      await db.query(sql);
      await db.query('COMMIT');
    }

    const achievements = (await db.query(`SELECT user_id, achievement_id FROM user_achievements ORDER BY 1, 2`)).rows;
    assert.deepEqual(
      achievements.map((r) => `${r.user_id}:${r.achievement_id}`),
      users.flatMap((u) => [...keep].sort().map((id) => `${u}:${id}`)),
      'only the old high striker tiers are gone',
    );
    ok('every player loses Strongman and Bell Ringer, and keeps every other achievement (a snake tier, an endless tier)');

    const counts = (await db.query(`SELECT achievement_id FROM achievement_unlock_counts ORDER BY 1`)).rows.map((r) => r.achievement_id);
    assert.deepEqual(counts, [...keep].sort());
    ok('the old ids\' global tallies are gone; the rest are untouched');

    const stats = (await db.query(`SELECT user_id, stat_key, value FROM user_stats ORDER BY 1, 2`)).rows;
    for (const user of users) {
      const mine = Object.fromEntries(stats.filter((r) => r.user_id === user).map((r) => [r.stat_key, Number(r.value)]));
      assert.deepEqual(mine, {
        'global.achievements_unlocked': 12,
        'high-striker.endless_depth': 4,
        'high-striker.games': 30,
        'snake.best': 90,
      });
    }
    ok('high-striker.best and best_five are cleared; the play count, the endless stats, other games and Achiever\'s count are kept');

    assert.deepEqual(await snapshot(), before, 'XP, wallets and ledger unchanged');
    ok('no XP, tickets or ledger rows are clawed back (account XP 5000, wallet 777 and the ledger row unchanged)');
    ok('applying 0073 a second time changes nothing');
  } finally {
    await db.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${scratch}`);
    await admin.end();
    ok(`scratch database ${scratch} dropped`);
  }
}

if (process.argv.includes('--db')) {
  await runDb();
}
console.log('\nhigh striker reset checks passed');
