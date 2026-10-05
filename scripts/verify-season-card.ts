/**
 * The live season ("Season 0", key season-0-r2) and its weekly card.
 *
 *   npx tsx scripts/verify-season-card.ts
 *
 * Pure checks run anywhere:
 * 1. The card is 30 tiers at 800 XP over 8 weeks, one track, and its tiers pay
 *    9,050 tickets and 6 prizes (tier 30 pays tickets and a prize), the ladder
 *    in PROGRESSION.md.
 * 2. Every prize is an art kit file under 2 KB, and every item the ladder names
 *    is in SEASON_CARD_ITEMS.
 * 3. The season is the only live one, under its own key and shown as "Season 0".
 *    It starts at SEASON_START, a Monday at 00:00 UTC, and the old season 0 is
 *    not in the live registry.
 * 4. A weekly card is three distinct floor games plus "play 15" and "earn 600",
 *    330 tickets and 950 XP, for every week of the season. Picks never name a
 *    game that is off the floor, for any floor, and are stable.
 * 5. The card week turns over every 7 days from the season's start, so every
 *    week starts on a Monday at 00:00 UTC, when the floor changes.
 *
 * With SEASON_CARD_DATABASE_URL set (an empty database whose name ends in
 * _scard; the deploy migration is run on it) it also checks, with the clock
 * inside week 2:
 * 6. Runs advance this week's card and nothing else: next week's rows are
 *    separate, the old season 0's weekly and season quest tables take nothing.
 * 7. A card quest pays once. A second claim fails and pays nothing.
 * 8. Claiming every tier pays 9,050 tickets and the 6 prizes, once.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { getFloorGames, isOnFloor } from '../src/features/arcade/components/arcade-game-registry';
import {
  SEASON_CARD_ITEMS,
  SEASON_CARD_KEY,
  SEASON_CARD_MAX_TIER,
  SEASON_CARD_NAME,
  SEASON_CARD_TIERS,
  SEASON_CARD_WEEKS,
  SEASON_CARD_XP_PER_TIER,
  SEASON_END_MS,
  SEASON_START,
  SEASON_START_MS,
  seasonTicketTotal,
} from '../src/server/arcade/battlepass/season-card';
import { LEGACY_SEASON_0, LIVE_SEASON, SEASONS, currentSeason, seasonByKey } from '../src/server/arcade/battlepass/seasons';
import {
  WEEKLY_CARD_POOL,
  WEEK_MS,
  pickWeeklyCardGames,
  weeklyCardQuests,
  weeklyCardTotals,
  weeklyCardWeek,
} from '../src/server/arcade/battlepass/weekly-card';

let checks = 0;
const ok = (label: string) => {
  checks += 1;
  console.log(`  ok  ${label}`);
};

// 1. The card.
assert.equal(SEASON_CARD_TIERS.length, 30);
assert.equal(SEASON_CARD_MAX_TIER, 30);
assert.equal(SEASON_CARD_XP_PER_TIER, 800);
assert.equal(SEASON_CARD_MAX_TIER * SEASON_CARD_XP_PER_TIER, 24_000);
assert.equal(SEASON_CARD_WEEKS, 8);
assert.equal(SEASON_END_MS - SEASON_START_MS, 8 * WEEK_MS);
assert.equal(seasonTicketTotal(SEASON_CARD_TIERS), 9_050, 'the card pays 9,050 tickets');
const prizeTiers = SEASON_CARD_TIERS.filter((t) => t.free.kind === 'item' || t.premium?.kind === 'item');
assert.deepEqual(prizeTiers.map((t) => t.tier), [5, 10, 15, 20, 25, 30], 'six prize tiers');
const ticketTiers = SEASON_CARD_TIERS.filter((t) => t.free.kind === 'tickets');
assert.equal(ticketTiers.length, 25, '25 tiers pay tickets');
const paid = (tier: number) => SEASON_CARD_TIERS[tier - 1]!;
assert.deepEqual(paid(30).free, { kind: 'tickets', amount: 750 });
assert.deepEqual(paid(30).premium, { kind: 'item', itemId: 's1-stub-crown' });
const bands: [number[], number][] = [
  [[1, 2, 3, 4], 175],
  [[6, 7, 8, 9], 225],
  [[11, 12, 13, 14], 300],
  [[16, 17, 18, 19], 375],
  [[21, 22, 23, 24], 450],
  [[26, 27, 28, 29], 550],
];
for (const [tiers, amount] of bands) {
  for (const tier of tiers) assert.deepEqual(paid(tier).free, { kind: 'tickets', amount }, `tier ${tier}`);
}
for (const t of SEASON_CARD_TIERS) if (t.tier !== 30) assert.equal(t.premium, null, `tier ${t.tier} has one reward`);
assert.deepEqual(LIVE_SEASON.tiers, SEASON_CARD_TIERS);
ok('the card: 30 tiers at 800 XP, 8 weeks, 25 ticket tiers, 6 prize tiers, 9,050 tickets');

// 2. The prizes.
const itemIds = new Set(SEASON_CARD_ITEMS.map((i) => i.id));
assert.equal(itemIds.size, SEASON_CARD_ITEMS.length, 'prize ids are distinct');
for (const t of SEASON_CARD_TIERS) {
  for (const reward of [t.free, t.premium]) {
    if (reward?.kind === 'item') assert.ok(itemIds.has(reward.itemId), `${reward.itemId} is a season item`);
  }
}
for (const item of SEASON_CARD_ITEMS) {
  assert.ok(item.id.startsWith('s1-'), `${item.id} carries the season prefix`);
  assert.ok(!/legendary|epic|rare/i.test(item.name), `${item.name} has no rarity word`);
  if (item.art) {
    const file = path.join(process.cwd(), 'public', item.art);
    const bytes = statSync(file).size;
    assert.ok(bytes < 2048, `${item.art} is ${bytes} bytes`);
    assert.match(readFileSync(file, 'utf8'), /^<svg /, `${item.art} is an SVG`);
    assert.equal(item.assetRef.imageUrl, item.art);
  }
}
assert.equal(SEASON_CARD_ITEMS.filter((i) => !i.art).length, 1, 'one prize is a game skin');
ok(`${SEASON_CARD_ITEMS.length} prizes: every art kit file is an SVG under 2 KB, none sold, no rarity word`);

// 3. When it starts, and which season is live.
assert.equal(SEASON_START.toISOString(), '2026-10-05T00:00:00.000Z');
assert.equal(SEASON_START.getUTCDay(), 1, 'the season starts on a Monday');
assert.equal(SEASON_START_MS % (24 * 60 * 60 * 1000), 0, 'the season starts at 00:00 UTC');
assert.equal(LIVE_SEASON.startMs, SEASON_START_MS);
assert.equal(LIVE_SEASON.endMs, SEASON_END_MS);
assert.equal(LIVE_SEASON.key, 'season-0-r2');
assert.equal(LIVE_SEASON.name, 'Season 0');
assert.equal(SEASON_CARD_NAME, 'Season 0');
assert.notEqual(LIVE_SEASON.key, LEGACY_SEASON_0.key, 'the restart does not reuse the old key');
assert.deepEqual(SEASONS.map((s) => s.key), ['season-0-r2'], 'the old season 0 is not live');
for (const at of [SEASON_START_MS - 1, SEASON_START_MS, SEASON_END_MS, SEASON_END_MS + 400 * 24 * 3600_000, LEGACY_SEASON_0.startMs, LEGACY_SEASON_0.endMs!]) {
  assert.equal(currentSeason(at).key, 'season-0-r2', `the live season is the same at ${new Date(at).toISOString()}`);
}
assert.equal(seasonByKey('season-0').maxTier, 32, 'the old season is still readable by its key');
assert.equal(seasonByKey('season-0-r2'), LIVE_SEASON);
ok('the season is live under season-0-r2 as "Season 0", from Monday 5 October 2026 00:00 UTC; season-0 is not live');

// 4. The weekly card.
const floorSlugs = new Set(getFloorGames().map((g) => g.slug));
for (const g of WEEKLY_CARD_POOL) assert.ok(isOnFloor(g.slug), `${g.slug} in the card pool is on the floor`);
for (let week = 1; week <= SEASON_CARD_WEEKS; week += 1) {
  const quests = weeklyCardQuests(SEASON_CARD_KEY, week);
  assert.equal(quests.length, 5, `week ${week} has 5 quests`);
  const games = quests.filter((q) => q.targetGame).map((q) => q.targetGame!);
  assert.equal(games.length, 3);
  assert.equal(new Set(games).size, 3, `week ${week} picks 3 distinct games`);
  for (const game of games) assert.ok(floorSlugs.has(game), `week ${week} picks floor game ${game}`);
  assert.deepEqual(quests.slice(3).map((q) => q.key), ['wc-play-15', 'wc-earn-600']);
  assert.deepEqual(weeklyCardTotals(quests), { tickets: 330, xp: 950 }, `week ${week} pays 330 tickets and 950 XP`);
  assert.deepEqual(pickWeeklyCardGames(SEASON_CARD_KEY, week), games, 'a week picks the same games every time');
}
// A game off the floor is never picked, whichever it is.
for (const off of WEEKLY_CARD_POOL) {
  for (let week = 1; week <= 52; week += 1) {
    const picked = pickWeeklyCardGames(SEASON_CARD_KEY, week, (slug) => slug !== off.slug);
    assert.equal(picked.length, 3);
    assert.ok(!picked.includes(off.slug), `${off.slug} off the floor is never picked`);
  }
}
const spread = new Set(Array.from({ length: 52 }, (_, i) => pickWeeklyCardGames(SEASON_CARD_KEY, i + 1)).flat());
assert.equal(spread.size, WEEKLY_CARD_POOL.length, 'over a year every pool game comes up');
ok('weekly card: 3 distinct floor games, play 15, earn 600, 330 tickets and 950 XP, 8 weeks and 52');

// 5. Week turnover.
assert.equal(weeklyCardWeek(LIVE_SEASON, SEASON_START_MS - 1), null);
assert.equal(weeklyCardWeek(LIVE_SEASON, SEASON_START_MS), 1);
assert.equal(weeklyCardWeek(LIVE_SEASON, SEASON_START_MS + WEEK_MS - 1), 1);
assert.equal(weeklyCardWeek(LIVE_SEASON, SEASON_START_MS + WEEK_MS), 2);
assert.equal(weeklyCardWeek(LIVE_SEASON, SEASON_END_MS - 1), 8);
assert.equal(weeklyCardWeek(LIVE_SEASON, SEASON_END_MS), null, 'no card after the last week');
for (let week = 1; week <= SEASON_CARD_WEEKS; week += 1) {
  const startsAt = new Date(SEASON_START_MS + (week - 1) * WEEK_MS);
  assert.equal(startsAt.getUTCDay(), 1, `week ${week} starts on a Monday`);
  assert.equal(startsAt.getUTCHours() + startsAt.getUTCMinutes() + startsAt.getUTCSeconds(), 0, `week ${week} starts at 00:00 UTC`);
}
assert.equal(weeklyCardWeek({ ...LIVE_SEASON, weeklyCard: false }, SEASON_START_MS), null, 'a season with no card has no weeks');
ok('card weeks turn over every 7 days from the start, every one on a Monday at 00:00 UTC, and stop after week 8');

// 6 to 8. The database.
const databaseUrl = process.env.SEASON_CARD_DATABASE_URL;
if (!databaseUrl) {
  console.log('\nSkipping the database checks: set SEASON_CARD_DATABASE_URL (an empty database ending in _scard).');
  console.log(`\n${checks} checks passed.`);
  process.exit(0);
}
process.env.DATABASE_URL = databaseUrl;
const { Pool } = await import('pg');
const pool = new Pool({ connectionString: databaseUrl });
globalThis.__arcadePgPool = pool;
const database = (await pool.query<{ db: string }>('SELECT current_database() AS db')).rows[0]!.db;
if (!database.endsWith('_scard')) {
  await pool.end();
  throw new Error(`Refusing to run against "${database}": the database name must end in _scard.`);
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

const { claimTierReward, claimWeeklyCard, getBattlepassState, recordGameRunForSeason } = await import(
  '../src/server/arcade/battlepass'
);
const NOW = Date.now();
const realNow = Date.now;
const week2 = SEASON_START_MS + WEEK_MS + 3_600_000;
Date.now = () => week2;
const money = async (id: string) =>
  Number(
    (await pool.query<{ total: string | null }>(`SELECT COALESCE(SUM(amount), 0) AS total FROM currency_ledger WHERE user_id = $1 AND source_type = 'battlepass'`, [id])).rows[0]!.total,
  );
try {
  const players = ['s1c-a', 's1c-b'];
  for (const id of players) {
    await pool.query(
      `INSERT INTO arcade_accounts (id, email, email_normalized, username, username_normalized, image_url, created_at, updated_at)
       VALUES ($1, $1 || '@example.test', $1 || '@example.test', $1, $1, '/avatars/default.png', $2, $2)`,
      [id, NOW],
    );
  }

  // 6. A run advances this week's card only.
  const week2Games = weeklyCardQuests(SEASON_CARD_KEY, 2).filter((q) => q.targetGame).map((q) => q.targetGame!);
  const other = WEEKLY_CARD_POOL.map((g) => g.slug).find((slug) => !week2Games.includes(slug))!;
  for (let run = 0; run < 5; run += 1) {
    await recordGameRunForSeason('s1c-a', { gameType: week2Games[0]!, creditsEarned: 100, score: 100 });
  }
  await recordGameRunForSeason('s1c-a', { gameType: other, creditsEarned: 0, score: 1 });
  const rows = (
    await pool.query<{ week: number; slot_index: number; quest_key: string; progress: number; goal: number }>(
      `SELECT week, slot_index, quest_key, progress, goal FROM user_weekly_cards WHERE user_id = 's1c-a' AND season_key = $1 ORDER BY week, slot_index`,
      [SEASON_CARD_KEY],
    )
  ).rows;
  assert.equal(rows.length, 5, 'one card of 5 rows, for this week only');
  assert.ok(rows.every((r) => r.week === 2));
  const bySlot = new Map(rows.map((r) => [r.slot_index, r]));
  assert.equal(bySlot.get(0)!.progress, 5, 'the first game quest finished after 5 rounds');
  assert.equal(bySlot.get(1)!.progress, 0);
  assert.equal(bySlot.get(3)!.progress, 6, 'play 15 counts every run');
  assert.equal(bySlot.get(4)!.progress, 500, 'earn 600 counts tickets earned');
  const legacy = Number((await pool.query<{ n: string }>(`SELECT COUNT(*) AS n FROM user_weekly_quests WHERE user_id = 's1c-a'`)).rows[0]!.n);
  const legacySeason = Number((await pool.query<{ n: string }>(`SELECT COUNT(*) AS n FROM user_season_quests WHERE user_id = 's1c-a'`)).rows[0]!.n);
  assert.equal(legacy + legacySeason, 0, "the old season 0's weekly and season quests take nothing");
  // Next week is a separate card on the same table.
  Date.now = () => SEASON_START_MS + 2 * WEEK_MS + 1;
  await recordGameRunForSeason('s1c-a', { gameType: week2Games[0]!, creditsEarned: 10, score: 1 });
  const weeks = (
    await pool.query<{ week: number; n: string }>(`SELECT week, COUNT(*) AS n FROM user_weekly_cards WHERE user_id = 's1c-a' GROUP BY week ORDER BY week`)
  ).rows;
  assert.deepEqual(weeks.map((w) => [w.week, Number(w.n)]), [[2, 5], [3, 5]]);
  const state = await getBattlepassState('s1c-a');
  assert.equal(state.weeklyCard!.week, 3);
  assert.equal(state.weeklyCard!.carryover.length, 1, 'last week\'s finished, unclaimed quest stays claimable');
  assert.equal(state.weeklyCard!.carryover[0]!.week, 2);
  assert.deepEqual(state.weeklyQuests, []);
  assert.deepEqual(state.seasonQuests, []);
  Date.now = () => week2;
  ok('a run advances this week\'s card only; next week is its own 5 rows; the old weekly tables take nothing');

  // 7. A card quest pays once.
  const before = await money('s1c-a');
  const first = await claimWeeklyCard('s1c-a', SEASON_CARD_KEY, 2, 0);
  assert.deepEqual(first, { rewardXp: 200, rewardTickets: 70 });
  await assert.rejects(() => claimWeeklyCard('s1c-a', SEASON_CARD_KEY, 2, 0), /Already claimed/);
  await assert.rejects(() => claimWeeklyCard('s1c-a', SEASON_CARD_KEY, 2, 1), /not complete/);
  assert.equal((await money('s1c-a')) - before, 70, 'paid 70 tickets once');
  const sources = (await pool.query<{ n: string }>(`SELECT COUNT(*) AS n FROM currency_ledger WHERE source_id = $1`, [`weekly-card:${SEASON_CARD_KEY}:2:0`])).rows[0]!;
  assert.equal(Number(sources.n), 1, 'one ledger row for the claim');
  ok('a card quest pays its 70 tickets once and a second claim fails');

  // 8. Every tier, once.
  await pool.query(
    `INSERT INTO user_season_progress (user_id, season_key, xp, premium, updated_at) VALUES ('s1c-b', $1, $2, FALSE, $3)`,
    [SEASON_CARD_KEY, SEASON_CARD_MAX_TIER * SEASON_CARD_XP_PER_TIER, NOW],
  );
  for (const tier of SEASON_CARD_TIERS) {
    await claimTierReward('s1c-b', tier.tier, 'free');
    if (tier.premium) await claimTierReward('s1c-b', tier.tier, 'premium');
  }
  assert.equal(await money('s1c-b'), 9_050, 'claiming every tier pays 9,050 tickets');
  const owned = (await pool.query<{ item_id: string }>(`SELECT item_id FROM user_owned_items WHERE user_id = 's1c-b' ORDER BY item_id`)).rows.map((r) => r.item_id);
  assert.deepEqual(owned, [...itemIds].sort(), 'all 6 prizes are owned');
  await assert.rejects(() => claimTierReward('s1c-b', 1, 'free'), /already claimed/);
  await assert.rejects(() => claimTierReward('s1c-b', 1, 'premium'), /Nothing to claim/);
  assert.equal(await money('s1c-b'), 9_050, 'a second claim pays nothing');
  ok('every tier claimed pays 9,050 tickets and the 6 prizes, and only once');
} finally {
  Date.now = realNow;
  await pool.end();
}
console.log(`\n${checks} checks passed.`);
