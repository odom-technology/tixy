/**
 * Checks for the admin metrics (npm run test:admin-metrics).
 *
 * Pure checks always run: window parsing, densify, the machine z formula on a
 * hand-computed case, the ledger bucket mapping, game identity, the rollup
 * plan and the rate-limit counters. When DATABASE_URL is set in the
 * environment it also runs every section on that database (use a seeded
 * throwaway: npm run seed:admin-demo) and asserts invariants, then prints how
 * long each section took. It does not read env files, so it never reaches a
 * database you did not name.
 */
import assert from 'node:assert/strict';

import {
  ARCADE_GAMES,
  getFloorGames,
} from '../src/features/arcade/components/arcade-game-registry';
import {
  boughtBucket,
  boughtBucketSql,
  clearMetricsCache,
  canonicalGameKey,
  dayRange,
  densify,
  earnedBucket,
  earnedBucketSql,
  ensureRollups,
  floorGameKeys,
  floorMachineKeys,
  gameRef,
  getCounterMetrics,
  getEconomyMetrics,
  getGamesMetrics,
  getLiveMetrics,
  getMachinesMetrics,
  getOverviewMetrics,
  getPlayersMetrics,
  getProgressionMetrics,
  getTrustMetrics,
  machineZ,
  mondayOf,
  parseWindow,
  planRollups,
  rollupDay,
  windowShape,
  addDays,
  METRIC_WINDOWS,
  MACHINE_THEORETICAL_RTP,
  configuredRtp,
  type LedgerBucket,
} from '../src/server/admin/metrics';
import {
  fmtCompact,
  fmtFigure,
  fmtHours,
  fmtInt,
  fmtMoney,
  fmtPct,
  fmtSigned,
  fmtSignedFigure,
  noNegativeZero,
} from '../src/features/admin/ui/format';
import { ARCADE_RTP } from '../src/server/arcade/arcade-constants';
import { consumeReadRateLimit, consumeSigninRateLimit, getRateLimitHits } from '../src/server/auth/auth-rate-limit';

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`ok   ${name}`);
};

/* ── pure ─────────────────────────────────────────────────────────────── */

check('parseWindow: 7, 30, 90 pass; anything else is 30', () => {
  assert.equal(parseWindow(7), 7);
  assert.equal(parseWindow('90'), 90);
  assert.equal(parseWindow('30'), 30);
  for (const bad of [14, '14', 'abc', null, undefined, '', 0, -7, NaN]) assert.equal(parseWindow(bad), 30);
  assert.deepEqual([...METRIC_WINDOWS], [7, 30, 90]);
});

check('windowShape: last day is today, previous window is the same length just before', () => {
  const now = Date.UTC(2026, 9, 3, 15, 0, 0);
  for (const days of METRIC_WINDOWS) {
    const w = windowShape(days, now);
    assert.equal(w.to, '2026-10-03');
    assert.equal(dayRange(w.from, w.to).length, days);
    assert.equal(dayRange(w.previousFrom, w.previousTo).length, days);
    assert.equal(addDays(w.previousTo, 1), w.from);
  }
  assert.equal(mondayOf('2026-10-03'), '2026-09-28'); // a Saturday
  assert.equal(mondayOf('2026-09-28'), '2026-09-28');
  assert.equal(mondayOf('2026-10-04'), '2026-09-28'); // a Sunday
});

check('densify: one point per day, zeros where the source has none', () => {
  const days = dayRange('2026-09-27', '2026-10-03');
  const dense = densify(days, new Map([['2026-09-28', 4], ['2026-10-03', 9]]));
  assert.equal(dense.length, 7);
  assert.deepEqual(dense.map((p) => p.day), days);
  assert.deepEqual(dense.map((p) => p.value), [0, 4, 0, 0, 0, 0, 9]);
  assert.deepEqual(densify(days, [{ day: '2026-09-27', value: 2 }]).map((p) => p.value), [2, 0, 0, 0, 0, 0, 0]);
});

check('machineZ: hand-computed case, and the null cases', () => {
  // 30 rounds at wager 10: 15 pay 20, 15 pay 0. k = 0.9.
  // S = 300 - 0.9 * 300 = 30. Per round p - kw is 11 or -9: mean 1, variance 101 - 1 = 100.
  // z = 30 / sqrt(100 * 30) = 0.5477.
  const base = { rounds: 30, wagered: 300, paid: 300, sumW2: 3000, sumP2: 6000, sumWP: 3000, rtp: 0.9 };
  const z = machineZ(base);
  assert.ok(z !== null && Math.abs(z - 30 / Math.sqrt(3000)) < 1e-9, `z was ${z}`);
  assert.equal(machineZ({ ...base, rounds: 29 }), null, 'under 30 rounds');
  // Every payout exactly k * wager: no variance.
  assert.equal(machineZ({ rounds: 30, wagered: 300, paid: 270, sumW2: 3000, sumP2: 2430, sumWP: 2700, rtp: 0.9 }), null);
  const high = machineZ({ ...base, paid: 340, sumP2: 6800, sumWP: 3400 });
  assert.ok(high !== null && high > z!, 'more paid means a higher z');
});

check('formatters never print a negative zero', () => {
  for (const zero of [0, -0, -0.0001, -0.4]) {
    assert.equal(fmtInt(zero), '0', `fmtInt(${zero})`);
    assert.equal(fmtFigure(zero), '0', `fmtFigure(${zero})`);
    assert.equal(fmtCompact(zero), '0', `fmtCompact(${zero})`);
    assert.equal(fmtSigned(zero), '0', `fmtSigned(${zero})`);
    assert.equal(fmtSignedFigure(zero), '0', `fmtSignedFigure(${zero})`);
    assert.equal(fmtPct(zero / 1000), '0.0%', `fmtPct(${zero / 1000})`);
    assert.equal(fmtMoney(zero), '$0.00', `fmtMoney(${zero})`);
    assert.equal(fmtHours(zero), '0.0 h', `fmtHours(${zero})`);
  }
  // The bought panel's "spent" and "reversed" are negated sums: over nothing they are -0.
  assert.equal(fmtFigure(-[].reduce((sum: number, v: number) => sum + v, 0)), '0');
  assert.equal(noNegativeZero('-0'), '0');
  assert.equal(noNegativeZero('−0.0%'), '0.0%');
  assert.equal(noNegativeZero('-$0.00'), '$0.00');
  // Real negatives keep their sign.
  assert.equal(fmtInt(-500), '-500');
  assert.equal(fmtSigned(-500), '−500');
  assert.equal(fmtPct(-0.0123), '-1.2%');
  assert.equal(fmtMoney(-1250), '-$12.50');
  assert.equal(noNegativeZero('-0.5'), '-0.5');
  assert.equal(noNegativeZero('-10'), '-10');
});

const KNOWN_BUCKETS = new Set<LedgerBucket>([
  'game_rewards', 'daily_claim', 'quests', 'season', 'levels', 'achievements', 'monthly_boards',
  'weekly_boards', 'wager_payouts', 'admin', 'refunds', 'other_in', 'counter', 'wager_stakes', 'continues', 'other_out',
]);

const EARNED_EXPECTED: [string, string, number, LedgerBucket][] = [
  ['game_reward', 'game:snake:x', 10, 'game_rewards'],
  ['daily_claim', 'daily-claim:2026-10-01:tickets', 50, 'daily_claim'],
  ['battlepass', 'quest:2026-10-01:0', 40, 'quests'],
  ['battlepass', 'weekly-quest:4:1', 100, 'quests'],
  ['battlepass', 'season-quest:season-0:2', 150, 'quests'],
  ['battlepass', 'weekly-card:season-1:2:3', 60, 'quests'],
  ['battlepass', 'season-0:free:t5', 75, 'season'],
  ['level_reward', 'level:5', 150, 'levels'],
  ['achievement', 'achievement:x', 50, 'achievements'],
  ['monthly_reward', 'monthly-credits:2026-09:runs:u', 500, 'monthly_boards'],
  ['weekly_board', 'weekly-board:2026-10-05:snake:u', 300, 'weekly_boards'],
  ['wager_payout', 'arcade-payout:s', 40, 'wager_payouts'],
  ['wager_hold', 'arcade-hold:s', -20, 'wager_stakes'],
  ['wager_refund', 'arcade-refund:s', 20, 'wager_stakes'],
  ['purchase', 'purchase:p:earned', -450, 'counter'],
  ['game_continue', 'continue:x', -50, 'continues'],
  ['admin_adjust', 'a', 100, 'admin'],
  ['admin_adjust', 'a', -100, 'admin'],
  ['admin_grant', 'g', 250, 'admin'],
  ['refund', 'r', 30, 'refunds'],
  // Types that have no bucket of their own fall to other_in or other_out by sign.
  ['shift_reward', 's', 25, 'other_in'],
  ['shift_reward', 's', -25, 'other_out'],
  ['stripe_purchase', 'p', 1000, 'other_in'],
  ['stripe_reversal', 'p', -1000, 'other_out'],
  ['something_new', 'x', 5, 'other_in'],
  ['something_new', 'x', -5, 'other_out'],
];

check('ledger buckets: every LedgerSourceType lands in a known bucket as specified', () => {
  const SOURCE_TYPES = [
    'game_reward', 'shift_reward', 'monthly_reward', 'weekly_board', 'purchase', 'stripe_purchase', 'stripe_reversal',
    'admin_adjust', 'admin_grant', 'refund', 'wager_hold', 'wager_payout', 'wager_refund', 'daily_claim',
    'battlepass', 'level_reward', 'achievement', 'game_continue',
  ];
  const covered = new Set(EARNED_EXPECTED.map(([type]) => type));
  for (const type of SOURCE_TYPES) assert.ok(covered.has(type), `no expectation for ${type}`);
  for (const [type, id, amount, bucket] of EARNED_EXPECTED) {
    const got = earnedBucket(type, id, amount);
    assert.equal(got, bucket, `${type} ${id} ${amount}`);
    assert.ok(KNOWN_BUCKETS.has(got));
  }
  assert.equal(boughtBucket('stripe_purchase'), 'packs');
  assert.equal(boughtBucket('rewarded_ad'), 'ads');
  assert.equal(boughtBucket('store_purchase'), 'counter');
  assert.equal(boughtBucket('stripe_reversal'), 'reversals');
  assert.equal(boughtBucket('other'), 'other');
});

check('game identity: every floor slug and every arcadeHistoryType maps to its registry entry', () => {
  const floor = getFloorGames();
  assert.ok(floor.length > 0);
  for (const game of floor) {
    const ref = gameRef(game.slug);
    assert.equal(ref.slug, game.slug);
    assert.equal(ref.onFloor, true, `${game.slug} should be on the floor`);
    assert.ok(ref.group, `${game.slug} should have a group`);
    assert.equal(ref.title, game.title);
  }
  for (const game of ARCADE_GAMES.filter((g) => g.arcadeHistoryType)) {
    const key = game.arcadeHistoryType as string;
    const ref = gameRef(key);
    assert.equal(ref.slug, game.slug, key);
    assert.equal(ref.key, key);
    assert.equal(canonicalGameKey(game.slug), key, 'the slug folds into the history type');
  }
  assert.equal(gameRef('arcade-blackjack').slug, '21');
  assert.equal(gameRef('stack-cabinet').slug, 'stack');
  assert.equal(canonicalGameKey('stack-cabinet'), 'stack');
  const unknown = gameRef('nope-game');
  assert.deepEqual(unknown, { key: 'nope-game', slug: null, title: 'nope-game', onFloor: false, group: null });
  assert.deepEqual(floorGameKeys().length, floor.length);
  assert.ok(floorMachineKeys().every((key) => key.startsWith('arcade-')));
});

check('machine RTP: baked-in machines use the theoretical return, the rest ARCADE_RTP', () => {
  for (const [key, rtp] of Object.entries(ARCADE_RTP)) {
    if (rtp === 1) {
      assert.ok(MACHINE_THEORETICAL_RTP[key] !== undefined, `${key} needs a theoretical RTP`);
      assert.equal(configuredRtp(key), MACHINE_THEORETICAL_RTP[key]);
    } else {
      assert.equal(configuredRtp(key), rtp);
    }
  }
  assert.ok(Math.abs(configuredRtp('arcade-roulette') - 36 / 37) < 1e-12);
});

check('rollup plan: today when stale, yesterday until copied after close, then missing days newest first', () => {
  const day = (s: string, h = 0, m = 0) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), h, m);
  const now = day('2026-10-03', 10, 0);
  const full = new Map<string, number>();
  for (let i = 0; i <= 5; i += 1) full.set(addDays('2026-10-03', -i), day(addDays('2026-10-03', -i), 23, 59));
  // Everything fresh, yesterday copied after close.
  full.set('2026-10-03', now - 60_000);
  full.set('2026-10-02', day('2026-10-03', 0, 30));
  assert.deepEqual(planRollups(full, 5, now), []);
  // Today older than 5 minutes.
  full.set('2026-10-03', now - 6 * 60_000);
  assert.deepEqual(planRollups(full, 5, now), ['2026-10-03']);
  full.set('2026-10-03', now - 60_000);
  // Yesterday was copied before midnight + 15: redo it once the day has closed.
  full.set('2026-10-02', day('2026-10-02', 23, 58));
  assert.deepEqual(planRollups(full, 5, now), ['2026-10-02']);
  assert.deepEqual(planRollups(full, 5, day('2026-10-03', 0, 10)), [], 'not before midnight + 15 minutes');
  full.set('2026-10-02', day('2026-10-03', 0, 30));
  // Missing days, most recent first.
  full.delete('2026-09-30');
  full.delete('2026-10-01');
  assert.deepEqual(planRollups(full, 5, now), ['2026-10-01', '2026-09-30']);
  assert.deepEqual(planRollups(new Map(), 3, now), ['2026-10-03', '2026-10-02', '2026-10-01', '2026-09-30']);
});

check('rate limits: limited results are counted by rule family, with no identifiers', () => {
  const before = new Map(getRateLimitHits().rules.map((r) => [r.rule, r.hits]));
  consumeReadRateLimit('verify-metrics:abc', 1, 60_000);
  assert.equal(consumeReadRateLimit('verify-metrics:abc', 1, 60_000).limited, true);
  for (let i = 0; i < 12; i += 1) consumeSigninRateLimit('verify-user@example.test', '203.0.113.9');
  const hits = getRateLimitHits();
  assert.ok(hits.since > 0 && hits.since <= Date.now());
  const after = new Map(hits.rules.map((r) => [r.rule, r.hits]));
  assert.equal((after.get('read:verify-metrics') ?? 0) - (before.get('read:verify-metrics') ?? 0), 1);
  assert.ok((after.get('signin:id+ip') ?? 0) > (before.get('signin:id+ip') ?? 0));
  for (const rule of after.keys()) assert.ok(!rule.includes('@') && !rule.includes('203.0.113.9'), rule);
});

/* ── database ─────────────────────────────────────────────────────────── */

async function timed<T>(name: string, fn: () => Promise<T>, timings: [string, number][]): Promise<T> {
  const t0 = performance.now();
  const value = await fn();
  timings.push([name, performance.now() - t0]);
  return value;
}

async function database() {
  if (!process.env.DATABASE_URL) {
    console.log('skip database checks: DATABASE_URL is not set');
    return;
  }
  const { getPool, query } = await import('../src/server/db/client');
  const timings: [string, number][] = [];
  const noEmail = (name: string, payload: unknown) =>
    assert.ok(!JSON.stringify(payload).includes('@'), `${name} payload has an @`);
  try {
    await timed('rollup (ensureRollups)', () => ensureRollups(), timings);
    const span = await query<{ n: string }>(`SELECT COUNT(*) AS n FROM admin_rollup_days`);
    assert.ok(Number(span.rows[0]?.n) > 0, 'no rolled days: seed the database first');

    // The SQL bucket expressions agree with the TypeScript ones.
    const samples = EARNED_EXPECTED.map(([type, id, amount]) => [type, id, amount] as const);
    const sqlRows = await query<{ type: string; id: string; amount: number; bucket: string }>(
      `SELECT t.source_type AS type, t.source_id AS id, t.amount, ${earnedBucketSql()} AS bucket
       FROM unnest($1::text[], $2::text[], $3::int[]) AS t(source_type, source_id, amount)`,
      [samples.map((s) => s[0]), samples.map((s) => s[1]), samples.map((s) => s[2])],
    );
    for (const row of sqlRows.rows) {
      assert.equal(row.bucket, earnedBucket(row.type, row.id, Number(row.amount)), `SQL bucket for ${row.type}`);
    }
    const boughtTypes = ['stripe_purchase', 'rewarded_ad', 'store_purchase', 'stripe_reversal', 'zzz'];
    const boughtRows = await query<{ source_type: string; bucket: string }>(
      `SELECT t.source_type, ${boughtBucketSql()} AS bucket FROM unnest($1::text[]) AS t(source_type)`,
      [boughtTypes],
    );
    for (const row of boughtRows.rows) assert.equal(row.bucket, boughtBucket(row.source_type));
    console.log('ok   SQL bucket expressions match the TypeScript mapping');

    // Rolling a day twice leaves the same rows.
    const probe = addDays(windowShape(30).to, -3);
    const snapshot = async () => {
      const tables = ['admin_play_days', 'admin_ledger_days', 'admin_machine_days', 'admin_trust_days', 'admin_funnel_days'];
      const out: Record<string, unknown> = {};
      for (const table of tables) {
        const r = await query(`SELECT * FROM ${table} WHERE day = $1::date ORDER BY 1, 2, 3, 4`, [probe]);
        out[table] = JSON.stringify(r.rows);
      }
      return out;
    };
    await rollupDay(probe);
    const first = await snapshot();
    await rollupDay(probe);
    assert.deepEqual(await snapshot(), first, 'rollupDay is not idempotent');
    console.log('ok   rollupDay is idempotent');

    const live = await timed('live', async () => getLiveMetrics(), timings);
    noEmail('live', live);
    assert.ok(live.players.length <= 50);
    assert.ok(live.online >= live.inGame);
    assert.ok(live.activeSessions >= 0);
    for (const t of live.openTables) assert.ok(t.waiting >= 0 && t.playing >= 0);
    console.log('ok   live');

    for (const days of METRIC_WINDOWS) {
      clearMetricsCache();
      const overview = await timed(`overview ${days}d`, () => getOverviewMetrics(days), timings);
      clearMetricsCache();
      const players = await timed(`players ${days}d`, () => getPlayersMetrics(days), timings);
      clearMetricsCache();
      const games = await timed(`games ${days}d`, () => getGamesMetrics(days), timings);
      clearMetricsCache();
      const economy = await timed(`economy ${days}d`, () => getEconomyMetrics(days), timings);
      clearMetricsCache();
      const machines = await timed(`machines ${days}d`, () => getMachinesMetrics(days), timings);
      clearMetricsCache();
      const counter = await timed(`counter ${days}d`, () => getCounterMetrics(days), timings);
      clearMetricsCache();
      const progression = await timed(`progression ${days}d`, () => getProgressionMetrics(days), timings);
      clearMetricsCache();
      const trust = await timed(`trust ${days}d`, () => getTrustMetrics(days), timings);

      const all = { overview, players, games, economy, machines, counter, progression, trust };
      for (const [name, payload] of Object.entries(all)) {
        noEmail(name, payload);
        assert.equal(payload.window.days, days, `${name} window`);
        assert.equal(payload.window.to, windowShape(days).to);
        assert.equal(dayRange(payload.window.from, payload.window.to).length, days);
      }

      // Every day series has one point per day.
      assert.equal(overview.activeSeries.length, days);
      assert.equal(overview.runsSeries.length, days);
      assert.equal(players.daily.length, days);
      assert.equal(players.signups.length, days);
      assert.equal(economy.daily.length, days);
      assert.equal(machines.daily.length, days);
      assert.equal(counter.dailyRevenue.length, days);
      assert.equal(progression.achievements.daily.length, days);
      assert.equal(trust.daily.length, days);
      for (const row of [...games.floor, ...games.offFloor]) assert.equal(row.runsSeries.length, days, row.game.key);
      assert.deepEqual(overview.activeSeries.map((p) => p.day), dayRange(overview.window.from, overview.window.to));

      // Active players: today <= WAU <= MAU.
      assert.ok(overview.dauToday <= overview.wau.value, 'dau <= wau');
      assert.ok(overview.wau.value <= overview.mau.value, 'wau <= mau');
      assert.equal(overview.activeSeries[days - 1]?.value, overview.dauToday);
      assert.equal(overview.runs.value, overview.runsSeries.reduce((s, p) => s + p.value, 0));
      assert.ok(overview.topGames.length <= 5);

      // Players.
      assert.equal(players.cohorts.length, 12);
      for (const c of players.cohorts) {
        for (const v of [c.d1, c.d7, c.d30, ...c.weeks]) assert.ok(v === null || (v >= 0 && v <= 1));
        assert.equal(c.weeks.length, 8);
      }
      for (const d of players.daily) assert.equal(d.returning + d.newPlayers, d.active);
      for (const r of [players.retention.d1, players.retention.d7, players.retention.d30]) {
        assert.ok(r.retained <= r.eligible);
      }

      // Economy.
      assert.equal(economy.net.value, economy.minted.value - economy.spent.value, 'net = minted - spent');
      for (const d of economy.daily) assert.equal(d.net, d.minted - d.spent);
      const sourceTotal = economy.sources.reduce((s, r) => s + r.amount, 0);
      assert.equal(sourceTotal, economy.minted.value, 'sources add up to minted');
      const sinkTotal = economy.sinks.reduce((s, r) => s + r.amount, 0);
      assert.equal(sinkTotal, economy.spent.value, 'sinks add up to spent');
      const zero = economy.balances.buckets[0];
      assert.ok(zero && zero.min === 0 && zero.max === 0);
      const nonZero = economy.balances.buckets.slice(1).reduce((s, b) => s + b.players, 0);
      assert.equal(nonZero, economy.holders, 'balance buckets = holders + zero bucket');
      assert.equal(
        economy.balances.buckets.reduce((s, b) => s + b.players, 0),
        economy.holders + zero!.players,
      );
      assert.ok(economy.balances.median <= economy.balances.p90 && economy.balances.p90 <= economy.balances.p99);
      assert.ok(economy.balances.top1Share === null || (economy.balances.top1Share > 0 && economy.balances.top1Share <= 1));
      assert.ok(economy.dailyCap.cappedDays <= economy.dailyCap.earningDays);

      // Games: every floor game appears, in floor order, first.
      assert.deepEqual(games.floor.map((r) => canonicalGameKey(r.game.key)), floorGameKeys(), 'games.floor is the floor, in order');
      assert.ok(games.floor.every((r) => r.game.onFloor) && games.offFloor.every((r) => !r.game.onFloor));
      for (let i = 1; i < games.offFloor.length; i += 1) {
        assert.ok((games.offFloor[i - 1] as { runs: number }).runs >= (games.offFloor[i] as { runs: number }).runs);
      }
      const totalShare = [...games.floor, ...games.offFloor].reduce((s, r) => s + r.shareOfRuns, 0);
      assert.ok(games.totals.runs === 0 || Math.abs(totalShare - 1) < 1e-9, 'shares of runs add to 1');

      // Machines.
      assert.deepEqual(
        machines.floor.map((r) => canonicalGameKey(r.game.key)),
        floorMachineKeys(),
        'machines.floor is the floor machines, in order',
      );
      for (const row of [...machines.floor, ...machines.offFloor]) {
        if (row.rounds < 30) assert.equal(row.z, null, `${row.game.key} has ${row.rounds} rounds and a z`);
        if (row.wagered > 0) assert.ok(Math.abs((row.actualRtp as number) - row.paid / row.wagered) < 1e-12);
        assert.equal(row.houseNet, row.wagered - row.paid);
      }
      assert.ok(machines.biggestWins.length <= 10);
      for (let i = 1; i < machines.biggestWins.length; i += 1) {
        const a = machines.biggestWins[i - 1]!;
        const b = machines.biggestWins[i]!;
        assert.ok(a.payout - a.wager >= b.payout - b.wager);
      }

      // Counter, progression, trust.
      assert.ok(counter.checkoutFunnel.started >= counter.checkoutFunnel.fulfilled);
      assert.ok(counter.conversion.itemBuyers <= counter.conversion.activeAccounts);
      assert.ok(counter.conversion.packBuyers <= counter.conversion.activeAccounts);
      assert.equal(progression.levelBands.reduce((s, b) => s + b.players, 0), progression.levels.reduce((s, l) => s + l.players, 0));
      assert.ok(progression.season === null || progression.season.distribution.length === progression.season.tiers + 1);
      assert.ok(progression.achievements.top.length <= 10);
      assert.ok(trust.recent.length <= 50 && trust.bans.recent.length <= 20);
      assert.ok(trust.logRetentionDays >= 1);
      console.log(`ok   ${days}-day window: every section and invariant`);
    }
  } finally {
    await getPool().end();
  }

  console.log('\nsection timings (cold, ms):');
  for (const [name, ms] of timings) console.log(`  ${name.padEnd(26)} ${ms.toFixed(0).padStart(6)}`);
}

await database();
console.log(`\n${passed} pure checks passed.`);
