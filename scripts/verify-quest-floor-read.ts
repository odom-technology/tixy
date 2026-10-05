/**
 * The quest read path (tixy/r-quests-floor-fix).
 *
 *   docker exec arcade-dev-postgres createdb -U arcade arcade_qfix_qread
 *   QUEST_READ_DATABASE_URL=postgres://arcade:<password>@127.0.0.1:5433/arcade_qfix_qread \
 *     npx tsx scripts/verify-quest-floor-read.ts
 *
 * Needs an empty database whose name ends in `_qread`; it runs the deploy
 * migration on it. Checks, through getBattlepassState and the claim paths:
 *
 * 1. Today's dailies are created on read, from the floor pool: a player with
 *    no rows gets 3, and none names a game that is off the floor.
 * 2. Yesterday's dailies never show: a player whose only rows are yesterday's
 *    reads today's three, and yesterday's rows are not touched.
 * 3. An unclaimed quest on a game that is off the floor reads as complete and
 *    flagged offFloor, for a daily and a weekly card quest, and a quest on a
 *    floor game does not. The old season 0's weekly and season quests are not
 *    shown and not touched.
 * 4. Each pays once: the claim pays the stored reward, a second claim fails,
 *    and the ledger has one row per quest.
 * 5. Reading again changes nothing (idempotent), and a claimed quest is never
 *    set complete again.
 * 6. The floor is read at runtime: with the game back on the floor the same
 *    quest is left alone, which is what flappy bird and ricochet need.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { getFloorGames, isOnFloor } from '../src/features/arcade/components/arcade-game-registry';

const databaseUrl = process.env.QUEST_READ_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('QUEST_READ_DATABASE_URL is required: an empty database ending in _qread. See the header of this file.');
}
process.env.DATABASE_URL = databaseUrl;
const { Pool } = await import('pg');
const pool = new Pool({ connectionString: databaseUrl });
globalThis.__arcadePgPool = pool;
const database = (await pool.query<{ db: string }>('SELECT current_database() AS db')).rows[0]!.db;
if (!database.endsWith('_qread')) {
  await pool.end();
  throw new Error(`Refusing to run against "${database}": the database name must end in _qread.`);
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

const { claimQuest, claimWeeklyCard, getBattlepassState } = await import('../src/server/arcade/battlepass');
const { completeOffFloorQuestsForUser } = await import('../src/server/arcade/battlepass/complete-on-redirect');
const { SEASON_KEY: OLD_SEASON_KEY } = await import('../src/server/arcade/battlepass/season-0');
const { SEASON_CARD_KEY: SEASON_KEY, SEASON_START_MS } = await import('../src/server/arcade/battlepass/season-card');
const { getServerDateKey } = await import('../src/server/arcade/rewards/helpers');

let checks = 0;
const ok = (label: string) => {
  checks += 1;
  console.log(`  ok  ${label}`);
};

// Pin the clock inside week 1 of the season so the card has a current week
// whatever day this runs.
const realNow = Date.now;
Date.now = () => SEASON_START_MS + 2 * 24 * 3600_000;

const NOW = realNow();
const today = getServerDateKey(new Date());
const yesterday = getServerDateKey(new Date(NOW - 24 * 3600_000));
const offFloor = ['gopher', 'swerve'].find((slug) => !isOnFloor(slug))!;
const offFloor2 = ['breakout', 'tetris'].find((slug) => !isOnFloor(slug))!;
const floorSkill = getFloorGames().map((g) => g.slug).find((slug) => ['snake', '2048', 'stack'].includes(slug))!;
assert.ok(offFloor && offFloor2 && floorSkill);

const addPlayer = (id: string) =>
  pool.query(
    `INSERT INTO arcade_accounts (id, email, email_normalized, username, username_normalized, image_url, created_at, updated_at)
     VALUES ($1, $1 || '@example.test', $1 || '@example.test', $1, $1, '/avatars/default.png', $2, $2)`,
    [id, NOW],
  );
const ledger = async (id: string) =>
  Number(
    (await pool.query<{ total: string | null }>(`SELECT COALESCE(SUM(amount), 0) AS total FROM currency_ledger WHERE user_id = $1 AND source_type = 'battlepass'`, [id])).rows[0]!.total,
  );
const quest = (table: string, id: string, keyCols: string, keyVals: unknown[], key: string, game: string | null, goal: number, progress: number, tickets: number) =>
  pool.query(
    `INSERT INTO ${table} (user_id, ${keyCols}, quest_key, kind, target_game, goal, progress, reward_xp, reward_tickets, claimed, created_at)
     VALUES ($1, ${keyVals.map((_, i) => `$${i + 2}`).join(', ')}, $${keyVals.length + 2}, 'play_game', $${keyVals.length + 3}, $${keyVals.length + 4}, $${keyVals.length + 5}, 100, $${keyVals.length + 6}, FALSE, $${keyVals.length + 7})`,
    [id, ...keyVals, key, game, goal, progress, tickets, NOW],
  );

try {
  // 1. Today's dailies are created on read, from the floor.
  await addPlayer('qr-new');
  assert.equal(Number((await pool.query(`SELECT COUNT(*) AS n FROM user_daily_quests WHERE user_id = 'qr-new'`)).rows[0].n), 0);
  const fresh = await getBattlepassState('qr-new');
  assert.equal(fresh.quests.length, 3, 'three dailies');
  const rows = (await pool.query<{ date_key: string; target_game: string | null }>(`SELECT date_key, target_game FROM user_daily_quests WHERE user_id = 'qr-new'`)).rows;
  assert.equal(rows.length, 3, 'three rows were written');
  assert.ok(rows.every((r) => r.date_key === today), "today's date key");
  for (const r of rows) assert.ok(!r.target_game || isOnFloor(r.target_game), `${r.target_game} is on the floor`);
  ok("today's three dailies are created on read, from the floor pool");

  // 2. Yesterday's never show.
  await addPlayer('qr-old');
  await quest('user_daily_quests', 'qr-old', 'date_key, slot_index', [yesterday, 0], 'gopher-3', 'gopher', 3, 0, 50);
  await quest('user_daily_quests', 'qr-old', 'date_key, slot_index', [yesterday, 1], 'flappy-2', 'flappy-bird', 2, 0, 50);
  await quest('user_daily_quests', 'qr-old', 'date_key, slot_index', [yesterday, 2], '2048-score-2000', '2048', 2000, 0, 60);
  const old = await getBattlepassState('qr-old');
  assert.equal(old.quests.length, 3);
  assert.ok(!old.quests.some((q) => ['gopher-3', 'flappy-2'].includes(q.key)), "yesterday's quests are not shown");
  const todays = (await pool.query(`SELECT 1 FROM user_daily_quests WHERE user_id = 'qr-old' AND date_key = $1`, [today])).rowCount;
  assert.equal(todays, 3, "today's three were created beside yesterday's");
  const untouched = (
    await pool.query<{ progress: number; claimed: boolean }>(`SELECT progress, claimed FROM user_daily_quests WHERE user_id = 'qr-old' AND date_key = $1`, [yesterday])
  ).rows;
  assert.equal(untouched.length, 3);
  assert.ok(untouched.every((r) => r.progress === 0 && !r.claimed), "yesterday's rows are left as they were");
  ok("yesterday's dailies never show; today's are created beside them and yesterday's are left alone");

  // 3. Off-floor quests read as complete, floor ones do not.
  await addPlayer('qr-off');
  await quest('user_daily_quests', 'qr-off', 'date_key, slot_index', [today, 0], 'gopher-3', offFloor, 3, 0, 50);
  await quest('user_daily_quests', 'qr-off', 'date_key, slot_index', [today, 1], 'snake-2', floorSkill, 2, 0, 50);
  await quest('user_daily_quests', 'qr-off', 'date_key, slot_index', [today, 2], 'play-any-3', null, 3, 0, 40);
  // A card for week 1 already written, with one quest on an off-floor game and
  // one on a floor game. The card's other slots are filled in on read.
  await quest('user_weekly_cards', 'qr-off', 'season_key, week, slot_index', [SEASON_KEY, 1, 0], 'wc-play-gopher', offFloor, 6, 0, 110);
  await quest('user_weekly_cards', 'qr-off', 'season_key, week, slot_index', [SEASON_KEY, 1, 1], 'wc-play-snake', floorSkill, 6, 0, 70);
  // The old season 0's rows: an off-floor weekly and season quest, unclaimed.
  await quest('user_weekly_quests', 'qr-off', 'week, slot_index', [2, 1], 'w2-gopher-6', offFloor, 6, 0, 110);
  await quest('user_season_quests', 'qr-off', 'season_key, slot_index', [OLD_SEASON_KEY, 7], 'sq-gemswap-play-20', offFloor2, 20, 3, 300);
  const oldRows = async () =>
    JSON.stringify([
      (await pool.query(`SELECT * FROM user_weekly_quests WHERE user_id = 'qr-off' ORDER BY week, slot_index`)).rows,
      (await pool.query(`SELECT * FROM user_season_quests WHERE user_id = 'qr-off' ORDER BY season_key, slot_index`)).rows,
    ]);
  const oldBefore = await oldRows();
  const state = await getBattlepassState('qr-off');
  const daily = new Map(state.quests.map((q) => [q.slotIndex, q]));
  assert.ok(daily.get(0)!.complete && daily.get(0)!.offFloor && !daily.get(0)!.claimed, 'off-floor daily is complete and flagged');
  assert.ok(!daily.get(1)!.complete && !daily.get(1)!.offFloor, 'a floor game quest is left as it was');
  assert.ok(!daily.get(2)!.complete && !daily.get(2)!.offFloor, 'a generic quest is left as it was');
  const card = new Map(state.weeklyCard!.quests.map((q) => [q.key, q]));
  const cardOff = card.get('wc-play-gopher')!;
  assert.ok(cardOff.complete && cardOff.offFloor, 'off-floor card quest is complete and flagged');
  assert.ok(!card.get('wc-play-snake')!.complete && !card.get('wc-play-snake')!.offFloor, 'a card quest on a floor game is left as it was');
  assert.deepEqual([state.weeklyQuests, state.seasonQuests], [[], []], "the old season 0's weekly and season quests are not shown");
  assert.equal(await oldRows(), oldBefore, "the old season 0's weekly and season quest rows are untouched, even off the floor");
  ok('off-floor daily and card quests read as complete and flagged; floor and generic quests do not; the old quest tables are not shown or touched');

  // 4. Each pays once.
  const before = await ledger('qr-off');
  assert.deepEqual(await claimQuest('qr-off', 0), { rewardXp: 100, rewardTickets: 50 });
  assert.deepEqual(await claimWeeklyCard('qr-off', SEASON_KEY, 1, 0), { rewardXp: 100, rewardTickets: 110 });
  assert.equal((await ledger('qr-off')) - before, 160, 'paid 50 + 110 tickets');
  await assert.rejects(() => claimQuest('qr-off', 0), /Already claimed/);
  await assert.rejects(() => claimWeeklyCard('qr-off', SEASON_KEY, 1, 0), /Already claimed/);
  await assert.rejects(() => claimQuest('qr-off', 1), /not complete/);
  assert.equal((await ledger('qr-off')) - before, 160, 'second claims paid nothing');
  ok('each off-floor daily and card quest pays its stored reward once; a second claim fails; a floor quest cannot be claimed early');

  // 5. Idempotent, and claimed rows stay claimed.
  const again = await getBattlepassState('qr-off');
  assert.ok(again.quests.find((q) => q.slotIndex === 0)!.claimed);
  assert.ok(!again.quests.find((q) => q.slotIndex === 0)!.offFloor, 'a claimed quest is not flagged');
  assert.equal(await completeOffFloorQuestsForUser('qr-off', { dateKey: today, seasonKey: SEASON_KEY }), 0, 'a second pass changes nothing');
  ok('reading again changes nothing, and claimed quests stay claimed');

  // 6. The floor is read at runtime.
  await addPlayer('qr-back');
  await quest('user_daily_quests', 'qr-back', 'date_key, slot_index', [today, 0], 'flappy-2', 'flappy-bird', 2, 0, 50);
  const stillOpen = await completeOffFloorQuestsForUser('qr-back', { dateKey: today, seasonKey: SEASON_KEY, onFloor: () => true });
  assert.equal(stillOpen, 0, 'a game on the floor is left alone');
  const closed = await completeOffFloorQuestsForUser('qr-back', { dateKey: today, seasonKey: SEASON_KEY, onFloor: (slug) => slug !== 'flappy-bird' });
  assert.equal(closed, 1, 'the same quest is completed once the game is off the floor');
  ok('the floor is read at call time: a game back on the floor keeps its quests normal');
} finally {
  Date.now = realNow;
  await pool.end();
}
console.log(`\n${checks} checks passed.`);
