/**
 * Verifies the monthly leaderboard award, now retired from October 2026.
 *
 *   npm run test:monthly-boards
 *   DATABASE_URL=postgres://.../arcade_monthly npm run test:monthly-boards
 *   (MONTHLY_BOARDS_KEEP_SEED=1 keeps the seeded scores for npm run monthly-boards:dry-run)
 *
 * Without a database it checks the lists:
 * - every month before 2026-10 runs on the season 0 list: the 12 boards that
 *   paid, up to 41,250 a month, unchanged
 * - from 2026-10 (MONTHLY_BOARDS_RETIRED_FROM) a month has no boards: the
 *   weekly boards pay instead (scripts/verify-weekly-boards.ts)
 * - the list in force is picked by the month key, never the day it runs
 *
 * With DATABASE_URL (the database name must end in _monthly; migrated, and
 * the script seeds and deletes its own rows) it also awards:
 * - 2026-09 pays season 0's boards on all-time bests, as before
 * - a second run grants 0, and so does a run after the run row is deleted
 *   (the ledger's one row per month, board and user holds)
 * - 2026-10 and 2026-11 return 'retired' and write nothing: no ledger row,
 *   no award row, no run row
 */
import assert from 'node:assert/strict';

import { Pool } from 'pg';

import {
  MONTHLY_BOARDS_RETIRED_FROM,
  buildMonthlyAwards,
  getMonthlyBoards,
  maxMonthlyPayout,
  monthlyBoardsRetired,
  rulesForMonth,
} from '../src/server/arcade/rewards/monthly-boards';

const OLD_MAX = 41_250;
const LEGACY_KEYS = [
  'snake', 'flappy-bird', 'reaction-time', 'coin-flip', 'connections', 'typing-15', 'typing-30', 'typing-60',
  '8ball-bot-easy', '8ball-bot-medium', '8ball-bot-hard', '8ball-elo',
];
const LAST_MONTH = '2026-09';
const RETIRED_MONTHS = ['2026-10', '2026-11', '2026-12', '2027-01', '2030-06'];

async function checkLists() {
  assert.equal(MONTHLY_BOARDS_RETIRED_FROM, '2026-10');
  const old = getMonthlyBoards(LAST_MONTH);
  assert.deepEqual(old.map((b) => b.key), LEGACY_KEYS, 'season 0 boards are unchanged, in order');
  assert.equal(maxMonthlyPayout(old), OLD_MAX, 'season 0 boards pay up to 41,250');
  for (const month of ['2025-12', '2026-01', '2026-08', LAST_MONTH]) {
    assert.equal(getMonthlyBoards(month), old, `${month} runs on the season 0 boards`);
    assert.equal(rulesForMonth(month), 'season0');
    assert.ok(!monthlyBoardsRetired(month));
  }
  for (const month of RETIRED_MONTHS) {
    assert.deepEqual(getMonthlyBoards(month), [], `${month} pays no monthly board`);
    assert.equal(rulesForMonth(month), 'retired');
    assert.ok(monthlyBoardsRetired(month));
    assert.deepEqual(await buildMonthlyAwards(month), [], `${month} builds no award without reading a table`);
  }
  console.log('boards: season 0 list unchanged before 2026-10; 2026-10 on retired');
}

const now = Date.now();
const SEP = Date.UTC(2026, 8, 10);
const users = Array.from({ length: 8 }, (_, i) => `mb-user-${i + 1}`);
const LEADER = 'mb-last-month-leader';

const SEEDED = [
  ['od_user_id', ['snake_scores', 'flappy_bird_scores', 'reaction_time_scores', 'coin_flip_scores', 'connections_scores', 'typing_test_scores']],
  ['user_id', ['pool_bot_records', 'pool_elo', 'wallets']],
] as const;

async function clearSeed(pool: Pool) {
  const ids = [...users, LEADER];
  for (const [column, tables] of SEEDED) {
    for (const table of tables) await pool.query(`DELETE FROM ${table} WHERE ${column} = ANY($1)`, [ids]);
  }
  await pool.query(`DELETE FROM currency_ledger WHERE source_type = 'monthly_reward'`);
  await pool.query(`DELETE FROM monthly_reward_awards`);
  await pool.query(`DELETE FROM monthly_reward_runs`);
}

async function seed(pool: Pool) {
  // All-time bests, which season 0's boards read. The leader holds every one.
  for (const table of ['snake_scores', 'flappy_bird_scores']) {
    for (const [i, user] of [...users, LEADER].entries()) {
      await pool.query(
        `INSERT INTO ${table} (id, od_user_id, user_name, score, created_at) VALUES ($1, $2, $2, $3, $4)`,
        [`${table}-${user}`, user, user === LEADER ? 99999 : 1000 - i * 10, SEP + i],
      );
    }
  }
  for (const [i, user] of users.entries()) {
    await pool.query(
      `INSERT INTO reaction_time_scores (id, od_user_id, user_name, score, average_time, best_time, attempts, created_at)
       VALUES ($1, $2, $2, 1, $3, $3, 5, $4)`,
      [`rt-${user}`, user, 200 + i, now],
    );
    await pool.query(
      `INSERT INTO coin_flip_scores (id, od_user_id, user_name, streak, chosen_side, total_games_played, total_correct_flips, total_flips, created_at)
       VALUES ($1, $2, $2, $3, 'heads', 1, 1, 1, $4)`,
      [`cf-${user}`, user, 20 - i, now],
    );
    await pool.query(
      `INSERT INTO connections_scores (id, od_user_id, user_name, puzzle_date, mistakes, time_seconds, solved, created_at)
       VALUES ($1, $2, $2, '2026-09-01', 0, 30, true, $3)`,
      [`cn-${user}`, user, now],
    );
    for (const mode of [15, 30, 60]) {
      await pool.query(
        `INSERT INTO typing_test_scores (id, od_user_id, user_name, wpm, raw_wpm, accuracy, mode, correct_chars, incorrect_chars, total_chars, words_completed, created_at)
         VALUES ($1, $2, $2, $3, $3, 99, $4, 50, 1, 51, 10, $5)`,
        [`ty-${mode}-${user}`, user, 100 - i - (mode === 30 ? 1 : 0), mode, now],
      );
    }
    for (const difficulty of ['easy', 'medium', 'hard']) {
      await pool.query(
        `INSERT INTO pool_bot_records (user_id, user_name, bot_difficulty, fewest_turns, total_turn_duration_ms, achieved_at)
         VALUES ($1, $1, $2, $3, 1000, $4)`,
        [user, difficulty, 10 + i, SEP],
      );
    }
    await pool.query(
      `INSERT INTO pool_elo (user_id, user_name, elo_rating, total_games, peak_elo, created_at) VALUES ($1, $1, $2, 10, $2, $3)`,
      [user, 1500 - i * 10, now],
    );
  }
}

async function ledger(pool: Pool, monthKey: string) {
  const r = await pool.query<{ n: string; total: string | null }>(
    `SELECT count(*) AS n, sum(amount) AS total FROM currency_ledger
     WHERE source_type = 'monthly_reward' AND source_id LIKE $1`,
    [`monthly-credits:${monthKey}:%`],
  );
  const wallets = await pool.query<{ total: string | null }>(`SELECT sum(credits) AS total FROM wallets`);
  return { rows: Number(r.rows[0]!.n), total: Number(r.rows[0]!.total ?? 0), wallets: Number(wallets.rows[0]!.total ?? 0) };
}

type Award = { leaderboardKey: string; userId: string; rank: number; credits: number };
const ranked = (awards: Award[], key: string) =>
  awards.filter((a) => a.leaderboardKey === key).sort((a, b) => a.rank - b.rank).map((a) => a.userId);

async function checkAwards(url: string) {
  const dbName = new URL(url).pathname.slice(1);
  assert.ok(dbName.endsWith('_monthly'), `Refusing to seed ${dbName}: the database name must end in _monthly.`);
  const pool = new Pool({ connectionString: url });
  const { runMonthlyLeaderboardRewards } = await import('../src/server/arcade/rewards');
  try {
    await clearSeed(pool);
    await seed(pool);

    // September's award, on season 0's rules: all-time bests, so the all-time leader is paid.
    const sep = await runMonthlyLeaderboardRewards(LAST_MONTH, { resetLeaderboards: false });
    assert.equal(sep.status, 'completed');
    const sepKeys = new Set(sep.awards.map((a) => a.leaderboardKey));
    // typing-30 and typing-60 pay no one here: the same players top typing-15,
    // and a player takes only the highest of their typing boards.
    for (const key of LEGACY_KEYS.filter((k) => k !== 'typing-30' && k !== 'typing-60')) {
      assert.ok(sepKeys.has(key), `${LAST_MONTH} still pays ${key}`);
    }
    assert.equal(ranked(sep.awards, 'snake')[0], LEADER, `${LAST_MONTH} still ranks all-time bests`);
    assert.deepEqual(
      [1, 2, 3, 4, 5].map((r) => sep.awards.find((a) => a.leaderboardKey === '8ball-elo' && a.rank === r)?.credits),
      [2400, 1800, 1200, 800, 400],
    );
    // A player takes only the highest of their typing boards.
    const typing = sep.awards.filter((a) => a.leaderboardKey.startsWith('typing-'));
    assert.equal(new Set(typing.map((a) => a.userId)).size, typing.length, 'one typing board per player');
    assert.ok(sep.totalCreditsAwarded > 0 && sep.totalCreditsAwarded <= OLD_MAX, `${LAST_MONTH} total ${sep.totalCreditsAwarded}`);
    const before = await ledger(pool, LAST_MONTH);
    assert.equal(before.total, sep.totalCreditsAwarded, `${LAST_MONTH} ledger matches the result`);
    assert.equal(before.rows, sep.awards.length, 'one ledger row per award');

    // A second run grants nothing.
    const again = await runMonthlyLeaderboardRewards(LAST_MONTH, { resetLeaderboards: false });
    assert.equal(again.status, 'already-ran');
    assert.deepEqual(await ledger(pool, LAST_MONTH), before, 'second run changes no ledger row or wallet');

    // And so does a run with the run row gone: the ledger source ids dedupe.
    await pool.query(`DELETE FROM monthly_reward_runs WHERE month_key = $1`, [LAST_MONTH]);
    const rerun = await runMonthlyLeaderboardRewards(LAST_MONTH, { resetLeaderboards: false });
    assert.equal(rerun.status, 'completed');
    assert.equal(rerun.totalCreditsAwarded, 0, 'a re-run after the run row is lost grants 0');
    assert.deepEqual(await ledger(pool, LAST_MONTH), before, 'ledger and wallets unchanged after the re-run');

    // Retired months pay nothing and write nothing, run row included.
    for (const month of ['2026-10', '2026-11']) {
      const result = await runMonthlyLeaderboardRewards(month, { resetLeaderboards: false });
      assert.equal(result.status, 'retired', `${month} is retired`);
      assert.equal(result.totalCreditsAwarded, 0);
      assert.deepEqual(result.awards, []);
      assert.equal((await ledger(pool, month)).rows, 0, `${month} wrote no ledger row`);
      const rows = await pool.query(`SELECT 1 FROM monthly_reward_runs WHERE month_key = $1`, [month]);
      assert.equal(rows.rowCount, 0, `${month} wrote no run row`);
      const awards = await pool.query(`SELECT 1 FROM monthly_reward_awards WHERE month_key = $1`, [month]);
      assert.equal(awards.rowCount, 0, `${month} wrote no award row`);
    }
    assert.equal((await ledger(pool, LAST_MONTH)).wallets, before.wallets, 'the retired runs moved no wallet');
    console.log(`awards: ${LAST_MONTH} paid ${sep.totalCreditsAwarded} on season 0 rules; second run and re-run granted 0; 2026-10 and 2026-11 retired, nothing written`);
  } finally {
    if (process.env.MONTHLY_BOARDS_KEEP_SEED !== '1') await clearSeed(pool).catch(() => undefined);
    await pool.end();
  }
}

async function main() {
  await checkLists();
  const url = process.env.DATABASE_URL;
  if (url) await checkAwards(url);
  else console.log('awards: skipped, DATABASE_URL not set');
  console.log('monthly boards verified');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
