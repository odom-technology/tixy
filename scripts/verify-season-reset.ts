/**
 * The season 0 restart, checked on a database seeded with the old season 0.
 *
 *   docker exec arcade-dev-postgres createdb -U arcade arcade_rssn_reset
 *   SEASON_RESET_DATABASE_URL=postgres://arcade:<password>@127.0.0.1:5433/arcade_rssn_reset \
 *     npx tsx scripts/verify-season-reset.ts
 *
 * Needs an empty database whose name ends in `_reset`; it refuses anything
 * else. It runs the deploy migration (which seeds the items), then seeds
 * players the way the old season 0 left them: season XP on `season-0`, claimed
 * and unclaimed tiers, finished weekly and season quests, owned and equipped
 * old season items, account XP and a ledger. Then it reads and plays through
 * the code as shipped, and checks:
 *
 * 1. The live season reads tier 0 and 0 XP for every one of those players, on
 *    the card (30 tiers at 800 XP) under `season-0-r2`, named "Season 0". The old weekly and season quests do not show, and no
 *    old tier is claimable.
 * 2. A run grants XP to `season-0-r2`: the season row is created, holds the
 *    run's XP and participation, and the result's season bar starts at tier 0.
 * 3. Every old row is byte-identical after all of that: season progress, claims,
 *    weekly quests and season quests, even where they name a game that is off
 *    the floor.
 * 4. Owned items, equipped items, achievements and avatars are unchanged
 *    (scripts/verify-ownership-unchanged.ts), an old season item still equips,
 *    and account XP only moved by what the run granted.
 * 5. Nothing old is paid: no ledger row appears for a `season-0` source.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { diffOwnershipSnapshots, takeOwnershipSnapshot } from './verify-ownership-unchanged';

const databaseUrl = process.env.SEASON_RESET_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('SEASON_RESET_DATABASE_URL is required: an empty database ending in _reset. See the header of this file.');
}
process.env.DATABASE_URL = databaseUrl;
const { Pool } = await import('pg');
const pool = new Pool({ connectionString: databaseUrl });
globalThis.__arcadePgPool = pool;
const database = (await pool.query<{ db: string }>('SELECT current_database() AS db')).rows[0]!.db;
if (!database.endsWith('_reset')) {
  await pool.end();
  throw new Error(`Refusing to run against "${database}": the database name must end in _reset.`);
}
const tables = Number(
  (await pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = 'public'`)).rows[0]!.count,
);
if (tables > 0) {
  await pool.end();
  throw new Error(`Refusing to run against "${database}": it already has ${tables} tables. Drop and recreate it.`);
}
const migrate = spawnSync(path.join(process.cwd(), 'node_modules', '.bin', 'tsx'), ['scripts/migrate.ts'], {
  env: { ...process.env, DATABASE_URL: databaseUrl },
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
if (migrate.status !== 0) {
  console.error(migrate.stdout, migrate.stderr);
  throw new Error('Deploy migration failed.');
}

const { getBattlepassState, claimTierReward } = await import('../src/server/arcade/battlepass');
const { SEASON_0_ITEMS, SEASON_0_TIERS, SEASON_KEY: OLD_KEY } = await import('../src/server/arcade/battlepass/season-0');
const { SEASON_CARD_KEY, SEASON_START_MS } = await import('../src/server/arcade/battlepass/season-card');
const { currentSeason } = await import('../src/server/arcade/battlepass/seasons');
const { awardGameRunCredits } = await import('../src/server/arcade/rewards/wallet');
const { equipStoreItemForUser } = await import('../src/server/arcade/rewards/store');
const { isOnFloor } = await import('../src/features/arcade/components/arcade-game-registry');

let checks = 0;
const ok = (label: string) => {
  checks += 1;
  console.log(`  ok  ${label}`);
};

const NOW = Date.now();
const realNow = Date.now;
// Inside week 1 of the season, whatever day this runs.
Date.now = () => SEASON_START_MS + 2 * 24 * 3600_000 + 3_600_000;
const offFloor = ['gopher', 'swerve', 'sky-climber'].find((slug) => !isOnFloor(slug))!;
assert.ok(offFloor, 'one of the test games is off the floor');

// ─── Seed the old season 0 ───────────────────────────────────────────────────
type Old = { id: string; xp: number; claimedTiers: number; accountXp: number };
const players: Old[] = [
  { id: 'rs-top', xp: 32 * 600 + 400, claimedTiers: 20, accountXp: 90_000 },
  { id: 'rs-mid', xp: 14 * 600 + 250, claimedTiers: 6, accountXp: 30_000 },
  { id: 'rs-low', xp: 90, claimedTiers: 0, accountXp: 900 },
];
const oldItems = SEASON_0_ITEMS.slice(0, 6).map((i) => i.id);
for (const p of players) {
  await pool.query(
    `INSERT INTO arcade_accounts (id, email, email_normalized, username, username_normalized, image_url, created_at, updated_at)
     VALUES ($1, $1 || '@example.test', $1 || '@example.test', $1, $1, '/cosmetics/avatars/s0-avatar-aurora.png', $2, $2)`,
    [p.id, NOW],
  );
  await pool.query(
    `INSERT INTO user_season_progress (user_id, season_key, xp, premium, updated_at) VALUES ($1, $2, $3, TRUE, $4)`,
    [p.id, OLD_KEY, p.xp, NOW - 86_400_000],
  );
  await pool.query(`INSERT INTO user_account_xp (user_id, xp, level_floor, updated_at) VALUES ($1, $2, 1, $3)`, [p.id, p.accountXp, NOW]);
  for (let tier = 1; tier <= p.claimedTiers; tier += 1) {
    await pool.query(`INSERT INTO user_season_claims (user_id, season_key, tier, track, claimed_at) VALUES ($1, $2, $3, 'free', $4)`, [p.id, OLD_KEY, tier, NOW - 86_400_000]);
  }
  // Finished, unclaimed quests from the old season: one on an off-floor game.
  const weekly = (week: number, slot: number, key: string, game: string | null, goal: number, progress: number) =>
    pool.query(
      `INSERT INTO user_weekly_quests (user_id, week, slot_index, quest_key, kind, target_game, goal, progress, reward_xp, reward_tickets, claimed, created_at)
       VALUES ($1, $2, $3, $4, 'play_game', $5, $6, $7, 110, 60, FALSE, $8)`,
      [p.id, week, slot, key, game, goal, progress, NOW - 86_400_000],
    );
  await weekly(1, 0, 'w1-a', 'snake', 5, 5);
  await weekly(2, 1, 'w2-b', offFloor, 6, 0);
  await weekly(3, 2, 'w3-c', '2048', 4, 2);
  await pool.query(
    `INSERT INTO user_season_quests (user_id, season_key, slot_index, quest_key, kind, target_game, goal, progress, reward_xp, reward_tickets, claimed, created_at)
     VALUES ($1, $2, 0, 'sq-a', 'play_game', 'snake', 20, 20, 300, 150, FALSE, $3), ($1, $2, 1, 'sq-b', 'play_game', $4, 20, 3, 300, 150, FALSE, $3)`,
    [p.id, OLD_KEY, NOW - 86_400_000, offFloor],
  );
  for (const itemId of oldItems) {
    await pool.query(`INSERT INTO user_owned_items (user_id, item_id, acquired_at, acquired_source) VALUES ($1, $2, $3, 'battlepass')`, [p.id, itemId, NOW - 86_400_000]);
  }
  const claimed = SEASON_0_TIERS.slice(0, p.claimedTiers).flatMap((t) => (t.free.kind === 'tickets' ? [t.free.amount] : []));
  for (const [index, amount] of claimed.entries()) {
    await pool.query(
      `INSERT INTO currency_ledger (id, user_id, currency_type, amount, balance_after, source_type, source_id, created_at)
       VALUES ($1, $2, 'credits', $3, 0, 'battlepass', $4, $5)`,
      [`${p.id}-led-${index}`, p.id, amount, `${OLD_KEY}:free:t${index + 1}`, NOW - 86_400_000],
    );
  }
}
const equipSlotItem = SEASON_0_ITEMS.find((i) => i.gameType === 'profile' && i.slot === 'badge')!;

// What must not move.
const oldTables = async () =>
  JSON.stringify(
    await Promise.all([
      pool.query(`SELECT t::text FROM user_season_progress t WHERE season_key = $1 ORDER BY user_id`, [OLD_KEY]),
      pool.query(`SELECT t::text FROM user_season_claims t WHERE season_key = $1 ORDER BY user_id, tier, track`, [OLD_KEY]),
      pool.query(`SELECT t::text FROM user_weekly_quests t ORDER BY user_id, week, slot_index`),
      pool.query(`SELECT t::text FROM user_season_quests t ORDER BY user_id, season_key, slot_index`),
    ].map(async (q) => (await q).rows.map((r) => r.t))),
  );
const oldBefore = await oldTables();
const ownershipBefore = await takeOwnershipSnapshot(pool);
const accountXp = async (id: string) => Number((await pool.query(`SELECT xp FROM user_account_xp WHERE user_id = $1`, [id])).rows[0]?.xp ?? 0);
const accountBefore = new Map<string, number>();
for (const p of players) accountBefore.set(p.id, await accountXp(p.id));
const oldLedger = async () =>
  Number((await pool.query(`SELECT COUNT(*) AS n FROM currency_ledger WHERE source_id LIKE $1 || '%'`, [OLD_KEY + ':'])).rows[0].n);
const oldLedgerBefore = await oldLedger();
assert.ok(oldBefore.length > 100, 'seeded old rows');

// ─── 1. The live season reads tier 0 ─────────────────────────────────────────
const live = currentSeason();
assert.equal(live.key, 'season-0-r2');
assert.equal(live.key, SEASON_CARD_KEY);
for (const p of players) {
  const state = await getBattlepassState(p.id);
  assert.equal(state.seasonKey, 'season-0-r2', 'the card is the live season');
  assert.equal(state.seasonName, 'Season 0');
  assert.equal(state.xp, 0, `${p.id} starts at 0 season XP`);
  assert.equal(state.tier, 0, `${p.id} starts at tier 0`);
  assert.equal(state.maxTier, 30);
  assert.equal(state.xpPerTier, 800);
  assert.equal(state.tiers.length, 30);
  assert.deepEqual(state.bar, { into: 0, need: 800, atMax: false });
  assert.ok(state.tiers.every((t) => !t.unlocked && !t.freeClaimed && (t.premium == null || !t.premiumClaimed)), 'nothing is unlocked or claimed');
  assert.deepEqual([state.weeklyQuests, state.seasonQuests, state.weeks], [[], [], []], 'the old season 0 quests do not show');
  assert.ok(state.weeklyCard && state.weeklyCard.week === 1 && state.weeklyCard.quests.length === 5, "this week's card shows");
  assert.deepEqual(state.weeklyCard.carryover, [], 'no old quest carries over');
  await assert.rejects(() => claimTierReward(p.id, 1, 'free'), /not unlocked/, 'an old tier is not claimable');
  await assert.rejects(() => claimTierReward(p.id, 32, 'free'), /Unknown tier/, 'tier 32 is gone');
}
ok('the live season shows tier 0 and 0 XP on the 30 tier card for every old season 0 player; no old quest shows; no old tier claims');

// ─── 2. A run grants XP to the new key ───────────────────────────────────────
const runner = players[0]!;
const run = await awardGameRunCredits({
  userId: runner.id,
  context: { gameType: 'snake', score: 400 },
  sourceId: `season-reset:${NOW}:run1`,
});
assert.ok(run.account && run.account.xpGained > 0, 'the run granted XP');
const rows = (await pool.query<{ season_key: string; xp: number }>(`SELECT season_key, xp FROM user_season_progress WHERE user_id = $1 ORDER BY season_key`, [runner.id])).rows;
assert.deepEqual(rows.map((r) => r.season_key), ['season-0', 'season-0-r2']);
const newXp = Number(rows.find((r) => r.season_key === 'season-0-r2')!.xp);
assert.equal(newXp, run.account!.xpGained, 'the new row holds exactly what the run granted');
assert.equal(Number(rows.find((r) => r.season_key === 'season-0')!.xp), runner.xp, 'the old row is where it was');
assert.equal(run.account!.season?.tierBefore, 0, "the result's season bar starts at tier 0");
assert.equal(run.account!.season?.tier, Math.floor(newXp / 800));
assert.equal(run.account!.season?.need, 800);
const after = await getBattlepassState(runner.id);
assert.equal(after.xp, newXp);
assert.equal(after.tier, Math.floor(newXp / 800));
const card = (await pool.query(`SELECT slot_index, progress FROM user_weekly_cards WHERE user_id = $1 AND season_key = 'season-0-r2' AND week = 1 ORDER BY slot_index`, [runner.id])).rows;
assert.equal(card.length, 5, "the run touched this week's card");
assert.equal(accountBefore.get(runner.id)! + run.account!.xpGained, await accountXp(runner.id), 'account XP moved only by what the run granted');
ok(`a run grants ${newXp} XP to season-0-r2 only; the result bar starts at tier 0; account XP moves by the run's XP and nothing else`);

// ─── 3 and 4. Old rows, owned items ──────────────────────────────────────────
assert.equal(await oldTables(), oldBefore, 'every old season 0 row is byte-identical');
ok('season progress, claims, weekly quests and season quests of season-0 are byte-identical, off-floor ones included');

for (const p of players.slice(1)) assert.equal(await accountXp(p.id), accountBefore.get(p.id), `${p.id} account XP untouched`);
await equipStoreItemForUser({ userId: runner.id, itemId: equipSlotItem.id, gameType: 'profile' });
const equipped = (await pool.query(`SELECT 1 FROM user_equipped_items WHERE user_id = $1 AND item_id = $2`, [runner.id, equipSlotItem.id])).rowCount;
assert.equal(equipped, 1, 'an old season item still equips');
await pool.query(`DELETE FROM user_equipped_items WHERE user_id = $1 AND item_id = $2`, [runner.id, equipSlotItem.id]);
const ownershipAfter = await takeOwnershipSnapshot(pool);
const diff = diffOwnershipSnapshots(ownershipBefore, ownershipAfter);
assert.deepEqual(diff, [], `ownership changed: ${JSON.stringify(diff)}`);
ok('owned items, equipped items, achievements and avatars are unchanged; an old season item still equips; other players keep their account XP');

// ─── 5. Nothing old is paid ──────────────────────────────────────────────────
assert.equal(await oldLedger(), oldLedgerBefore, 'no ledger row was added for season-0');
const paid = (await pool.query(`SELECT COUNT(*) AS n FROM currency_ledger WHERE source_type = 'battlepass' AND created_at >= $1`, [NOW])).rows[0].n;
assert.equal(Number(paid), 0, 'nothing from the old season was paid');
ok('no ledger row is paid for the old season 0');

Date.now = realNow;
await pool.end();
console.log(`\n${checks} checks passed.`);
