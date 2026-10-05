/**
 * Verifies the weekly paid boards (src/server/arcade/rewards/weekly-boards.ts).
 *
 *   npm run test:weekly-boards
 *   DATABASE_URL=postgres://.../arcade_x_weekly npm run test:weekly-boards
 *
 * Without a database it checks the rotation and the rules:
 * - weeks run Monday 00:00 UTC to Monday 00:00 UTC, the first is 2026-10-05
 * - the picks are pinned for the first 8 weeks (the same everywhere), and the
 *   same whatever order weeks are asked in
 * - every week has 3 distinct games, none from the week before, and every
 *   eligible game comes round within ceil(n / 3) weeks, over 5 years
 * - a game off the floor is never picked; every candidate is a floor score
 *   game, ranked high to low, whose score route replays the run on the server
 * - prizes are 300 / 200 / 100, at most 1,800 a week
 * - the monthly award pays nothing from 2026-10 and is unchanged before
 *
 * With DATABASE_URL (the name must end in _weekly; migrated; the script seeds
 * and deletes its own rows, all prefixed wb-) it also ranks and awards:
 * - best run per player in the week, ties to the earlier run, the week's
 *   edges right, bots, guests, other weeks, other games and old rules out
 * - 300 / 200 / 100 and the medal for first, once per week even if the award
 *   runs twice, concurrently, or after its run row is lost
 * - an open week and a week before the start pay nothing; the catch-up pays
 *   every closed week once
 * - the monthly path writes nothing for 2026-10
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { Pool } from 'pg';

import { isOnFloor } from '../src/features/arcade/components/arcade-game-registry';
import {
  WEEKLY_BOARD_CANDIDATES,
  WEEKLY_BOARD_MEDAL,
  WEEKLY_BOARD_PRIZES,
  WEEKLY_BOARDS_MAX_PAYOUT,
  WEEKLY_BOARDS_START_MS,
  WEEK_MS,
  parseWeekKey,
  weekIndexOf,
  weekKeyAt,
  weekKeyOf,
  weekWindow,
  weeklyBoardGames,
  weeklyBoardPicks,
} from '../src/features/arcade/lib/weekly-boards';
import { getMonthlyBoards } from '../src/server/arcade/rewards/monthly-boards';
import { SCORE_LEADERBOARD_GAMES, resolveGameMode } from '../src/server/arcade/score-events';

let passed = 0;
const ok = (message: string) => {
  passed += 1;
  console.log(`ok - ${message}`);
};

/* The rotation's first 8 weeks. A change here changes what players were told. */
const PINNED: Record<string, string[]> = {
  '2026-10-05': ['ring-toss', 'flappy-bird', 'ricochet'],
  '2026-10-12': ['high-striker', 'ticket-stop', 'skee-ball'],
  '2026-10-19': ['tin-duck', 'snake', 'stack'],
  '2026-10-26': ['2048', 'ricochet', 'ring-toss'],
  '2026-11-02': ['flappy-bird', 'high-striker', 'skee-ball'],
  '2026-11-09': ['ticket-stop', 'snake', 'tin-duck'],
  '2026-11-16': ['stack', '2048', 'ricochet'],
  '2026-11-23': ['ring-toss', 'high-striker', 'flappy-bird'],
};

function checkWeeks() {
  assert.equal(WEEKLY_BOARDS_START_MS, Date.UTC(2026, 9, 5));
  assert.equal(new Date(WEEKLY_BOARDS_START_MS).getUTCDay(), 1, 'the first week starts on a Monday');
  assert.equal(weekKeyOf(Date.UTC(2026, 9, 5)), '2026-10-05');
  assert.equal(weekKeyOf(Date.UTC(2026, 9, 11, 23, 59, 59, 999)), '2026-10-05', 'Sunday 23:59 UTC is still the week');
  assert.equal(weekKeyOf(Date.UTC(2026, 9, 12)), '2026-10-12', 'Monday 00:00 UTC starts the next');
  assert.equal(weekKeyOf(Date.UTC(2026, 9, 4, 12)), '2026-09-28');
  assert.equal(parseWeekKey('2026-10-06'), null, 'a Tuesday is not a week key');
  assert.equal(parseWeekKey('2026-13-05'), null);
  assert.equal(weekWindow('2026-10-05').end - weekWindow('2026-10-05').start, WEEK_MS);
  assert.equal(weekIndexOf('2026-10-05'), 0);
  assert.equal(weekKeyAt(52), '2027-10-04');
  assert.deepEqual(weeklyBoardPicks('2026-09-28'), [], 'no board pays before the first week');
  ok('weeks: Monday 00:00 UTC to Monday 00:00 UTC, from 2026-10-05');
}

function checkRotation() {
  const games = weeklyBoardGames();
  // Asked out of order first: memoised state must not change an answer.
  const late = weeklyBoardPicks(weekKeyAt(40), [...games]);
  for (const [week, picks] of Object.entries(PINNED)) {
    assert.deepEqual(weeklyBoardPicks(week), picks, `${week} picks are pinned`);
  }
  assert.deepEqual(weeklyBoardPicks(weekKeyAt(40)), late, 'the same answer in any order');
  ok('rotation: the first 8 weeks match the pinned picks, in any order of asking');

  const weeks = 260;
  const window = Math.ceil(games.length / 3);
  const seen: string[][] = [];
  const counts = new Map(games.map((game) => [game, 0]));
  for (let w = 0; w < weeks; w += 1) {
    const picks = weeklyBoardPicks(weekKeyAt(w));
    assert.equal(picks.length, 3, `week ${w} has 3 boards`);
    assert.equal(new Set(picks).size, 3, `week ${w}'s games are distinct`);
    for (const game of picks) {
      assert.ok(games.includes(game), `${game} is eligible`);
      counts.set(game, counts.get(game)! + 1);
    }
    if (w > 0) {
      const repeat = picks.filter((game) => seen[w - 1]!.includes(game));
      assert.deepEqual(repeat, [], `week ${w} repeats nothing from week ${w - 1}`);
    }
    seen.push(picks);
  }
  for (let w = 0; w + window <= weeks; w += 1) {
    const span = new Set(seen.slice(w, w + window).flat());
    assert.equal(span.size, games.length, `weeks ${w} to ${w + window - 1} cover every game`);
  }
  const spread = Math.max(...counts.values()) - Math.min(...counts.values());
  assert.ok(spread <= 2, `every game is picked about as often (spread ${spread})`);
  ok(`rotation: 3 distinct games a week, no back-to-back repeat, every game within ${window} weeks, over ${weeks} weeks`);

  // A game that leaves the floor drops out on its own.
  const without = games.filter((game) => game !== 'snake');
  for (let w = 0; w < 60; w += 1) {
    const picks = weeklyBoardPicks(weekKeyAt(w), without);
    assert.ok(!picks.includes('snake'), 'an off-floor game is never picked');
    if (w > 0) assert.deepEqual(picks.filter((g) => weeklyBoardPicks(weekKeyAt(w - 1), without).includes(g)), []);
  }
  // Six games still never repeat; fewer than 3 picks what there is.
  const six = games.slice(0, 6);
  for (let w = 1; w < 60; w += 1) {
    const prev = weeklyBoardPicks(weekKeyAt(w - 1), six);
    assert.deepEqual(weeklyBoardPicks(weekKeyAt(w), six).filter((g) => prev.includes(g)), []);
  }
  assert.deepEqual(weeklyBoardPicks('2026-10-05', ['snake', 'stack']).sort(), ['snake', 'stack']);
  ok('rotation: an off-floor game drops out; 6 games still never repeat');
}

function checkEligible() {
  assert.deepEqual(weeklyBoardGames(), WEEKLY_BOARD_CANDIDATES.filter((slug) => isOnFloor(slug)));
  for (const slug of WEEKLY_BOARD_CANDIDATES) {
    assert.ok(isOnFloor(slug), `${slug} is on the floor today`);
    const game = SCORE_LEADERBOARD_GAMES[slug];
    assert.ok(game, `${slug} has a score board`);
    assert.equal(game.direction, 'high', `${slug} ranks high scores first`);
    const route = fs.readFileSync(`src/app/api/games/${slug}/score/route.ts`, 'utf8');
    assert.ok(route.includes("'server-replay'"), `${slug}'s score route replays the run on the server`);
    assert.ok(route.includes('recordScoreEvent'), `${slug}'s score route writes the event log the board reads`);
  }
  // Games with a rules split rank their current rules only.
  assert.equal(resolveGameMode('stack', null), '2');
  assert.equal(resolveGameMode('high-striker', null), '3');
  assert.equal(resolveGameMode('tin-duck', null), '2');
  assert.equal(resolveGameMode('snake', null), null);
  ok(`eligible: ${WEEKLY_BOARD_CANDIDATES.length} floor score games, every one replayed on the server`);

  assert.deepEqual([...WEEKLY_BOARD_PRIZES], [300, 200, 100]);
  assert.equal(WEEKLY_BOARDS_MAX_PAYOUT, 1800);
  assert.equal(WEEKLY_BOARD_MEDAL.itemId, 'board-medal-first');
  assert.ok(fs.existsSync(`public${WEEKLY_BOARD_MEDAL.art}`), 'the medal art is in the kit');
  ok('prizes: 300 / 200 / 100 and the medal, at most 1,800 a week');

  for (const month of ['2026-10', '2026-11', '2027-03']) assert.deepEqual(getMonthlyBoards(month), [], `${month} has no monthly board`);
  assert.equal(getMonthlyBoards('2026-09').length, 12, 'September 2026 keeps its 12 season 0 boards');
  ok('monthly: retired from 2026-10, unchanged before');
}

// ── With a database ──────────────────────────────────────────────────────────

const W0 = '2026-10-05';
const W1 = '2026-10-12';
const W2 = '2026-10-19';
const START = Date.UTC(2026, 9, 5);
const CHAMP = 'wb-champ';

async function clearSeed(pool: Pool) {
  await pool.query(`DELETE FROM game_score_events WHERE id LIKE 'wb-%'`);
  await pool.query(`DELETE FROM currency_ledger WHERE source_type = 'weekly_board'`);
  await pool.query(`DELETE FROM currency_ledger WHERE user_id LIKE 'wb-%'`);
  await pool.query(`DELETE FROM wallets WHERE user_id LIKE 'wb-%'`);
  await pool.query(`DELETE FROM user_owned_items WHERE user_id LIKE 'wb-%'`);
  await pool.query(`DELETE FROM weekly_board_awards`);
  await pool.query(`DELETE FROM weekly_board_runs`);
  await pool.query(`DELETE FROM monthly_reward_runs WHERE month_key >= '2026-10'`);
  await pool.query(`DELETE FROM arcade_notifications WHERE user_id LIKE 'wb-%'`);
  await pool.query(`DELETE FROM arcade_accounts WHERE id LIKE 'wb-%'`);
}

const accounts = new Set<string>();

let eventId = 0;
async function event(pool: Pool, slug: string, user: string, score: number, at: number, mode?: string | null) {
  eventId += 1;
  if (user.startsWith('wb-') && !accounts.has(user)) {
    accounts.add(user);
    await pool.query(
      `INSERT INTO arcade_accounts (id, email, email_normalized, username, username_normalized, created_at, updated_at)
       VALUES ($1, $1 || '@wb.test', $1 || '@wb.test', $1, $1, $2, $2) ON CONFLICT DO NOTHING`,
      [user, Date.now()],
    );
  }
  await pool.query(
    `INSERT INTO game_score_events (id, game_slug, od_user_id, user_name, score, created_at, mode) VALUES ($1, $2, $3, $3, $4, $5, $6)`,
    [`wb-${String(eventId).padStart(5, '0')}`, slug, user, score, at, mode === undefined ? resolveGameMode(slug, null) : mode],
  );
}

/* Per board b in a week: player a scores 500 first, b 500 later (the tie goes
   to a), c 400, d 300 twice (counts once), e 100 in the week and 900 the week
   before. Week 0's and week 2's first boards are won by the champ. */
const player = (week: string, game: string, tag: string) => `wb-${week}-${game}-${tag}`;

async function seedWeek(pool: Pool, week: string, firstWinner?: string) {
  const { start, end } = weekWindow(week);
  for (const [b, game] of weeklyBoardPicks(week).entries()) {
    const a = b === 0 && firstWinner ? firstWinner : player(week, game, 'a');
    await event(pool, game, a, 500, start + 1000);
    await event(pool, game, a, 10, start + 9000); // a worse run changes nothing
    await event(pool, game, player(week, game, 'b'), 500, start + 2000);
    await event(pool, game, player(week, game, 'c'), 400, start); // the first instant counts
    await event(pool, game, player(week, game, 'd'), 300, start + 3000);
    await event(pool, game, player(week, game, 'd'), 300, start + 4000);
    await event(pool, game, player(week, game, 'e'), 100, end - 1); // the last instant counts
    await event(pool, game, player(week, game, 'e'), 900, start - 1); // last week
    await event(pool, game, player(week, game, 'late'), 9000, end); // next week
    await event(pool, game, 'bot:hard', 9999, start + 5000);
    await event(pool, game, 'guest:wb', 9999, start + 5000);
    if (resolveGameMode(game, null) !== null) await event(pool, game, player(week, game, 'old'), 8000, start + 5000, '1');
  }
  // A game that isn't paid this week.
  const other = weeklyBoardGames().find((game) => !weeklyBoardPicks(week).includes(game))!;
  await event(pool, other, player(week, other, 'x'), 99999, start + 5000);
}

async function ledger(pool: Pool, week: string) {
  const r = await pool.query<{ n: string; total: string | null }>(
    `SELECT count(*) AS n, sum(amount) AS total FROM currency_ledger WHERE source_type = 'weekly_board' AND source_id LIKE $1`,
    [`weekly-board:${week}:%`],
  );
  const wallets = await pool.query<{ total: string | null }>(`SELECT sum(credits) AS total FROM wallets WHERE user_id LIKE 'wb-%'`);
  const awards = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM weekly_board_awards WHERE week_key = $1`, [week]);
  const medals = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM user_owned_items WHERE item_id = $1 AND user_id LIKE 'wb-%'`, [WEEKLY_BOARD_MEDAL.itemId]);
  return {
    rows: Number(r.rows[0]!.n),
    total: Number(r.rows[0]!.total ?? 0),
    wallets: Number(wallets.rows[0]!.total ?? 0),
    awards: Number(awards.rows[0]!.n),
    medals: Number(medals.rows[0]!.n),
  };
}

async function checkDatabase(url: string) {
  const dbName = new URL(url).pathname.slice(1);
  assert.ok(dbName.endsWith('_weekly'), `Refusing to seed ${dbName}: the database name must end in _weekly.`);
  const pool = new Pool({ connectionString: url });
  const weekly = await import('../src/server/arcade/rewards/weekly-boards');
  const { runMonthlyLeaderboardRewards } = await import('../src/server/arcade/rewards');
  try {
    await clearSeed(pool);
    await seedWeek(pool, W0, CHAMP);
    await seedWeek(pool, W1);
    await seedWeek(pool, W2, CHAMP);

    // Ranking.
    for (const game of weeklyBoardPicks(W0)) {
      const rows = await weekly.readWeeklyBoard(game, weekWindow(W0), { limit: 10 });
      const a = game === weeklyBoardPicks(W0)[0] ? CHAMP : player(W0, game, 'a');
      assert.deepEqual(
        rows.map((row) => [row.rank, row.userId, row.score]),
        [
          [1, a, 500],
          [2, player(W0, game, 'b'), 500],
          [3, player(W0, game, 'c'), 400],
          [4, player(W0, game, 'd'), 300],
          [5, player(W0, game, 'e'), 100],
        ],
        `${game}: best run per player, the tie to the earlier run, the week's edges, no bot, guest or old-rules run`,
      );
      const mine = await weekly.readWeeklyBoard(game, weekWindow(W0), { limit: 1, viewerId: player(W0, game, 'd') });
      assert.deepEqual(mine.map((row) => row.rank), [1, 4], `${game}: the top row and the viewer's own`);
    }
    for (const game of weeklyBoardPicks(W2).filter((g) => resolveGameMode(g, null) !== null)) {
      const rows = await weekly.readWeeklyBoard(game, weekWindow(W2), { limit: 10 });
      assert.ok(!rows.some((row) => row.userId.endsWith('-old')), `${game}: a last-season-rules run never counts`);
    }
    ok('ranking: best run in the week, ties to the earlier run, edges, bots, guests and old rules right');

    // Nothing for an open week or one before the start.
    const during = START + 3 * 86_400_000;
    const open = await weekly.runWeeklyBoardAwards(W0, during);
    assert.equal(open.status, 'not-closed');
    const before = await weekly.runWeeklyBoardAwards('2026-09-28', during);
    assert.equal(before.status, 'before-start');
    assert.equal((await ledger(pool, W0)).rows, 0, 'an open week pays nothing');
    await assert.rejects(() => weekly.runWeeklyBoardAwards('2026-10-06', during), /week key/);
    ok('award: an open week, a week before the start and a bad key pay nothing');

    // Week 0's award.
    const after = weekWindow(W0).end + 60_000;
    const first = await weekly.runWeeklyBoardAwards(W0, after);
    assert.equal(first.status, 'completed');
    assert.deepEqual(first.games, weeklyBoardPicks(W0));
    assert.equal(first.ticketsAwarded, WEEKLY_BOARDS_MAX_PAYOUT, 'week 0 pays 1,800');
    assert.equal(first.medalsAwarded, 3, 'three first places, three medals');
    for (const game of first.games) {
      const paid = first.awards.filter((a) => a.game === game).sort((x, y) => x.rank - y.rank);
      assert.deepEqual(paid.map((a) => a.tickets), [300, 200, 100], `${game} pays 300 / 200 / 100`);
      assert.deepEqual(paid.map((a) => a.medal), [true, false, false], `${game}: the medal goes to first`);
    }
    const paid0 = await ledger(pool, W0);
    assert.deepEqual(paid0, { rows: 9, total: 1800, wallets: 1800, awards: 9, medals: 3 });
    const champWallet = await pool.query<{ credits: number }>(`SELECT credits FROM wallets WHERE user_id = $1`, [CHAMP]);
    assert.equal(Number(champWallet.rows[0]!.credits), 300);
    const ledgerRow = await pool.query<{ source_id: string }>(
      `SELECT source_id FROM currency_ledger WHERE user_id = $1 AND source_type = 'weekly_board'`,
      [CHAMP],
    );
    assert.deepEqual(ledgerRow.rows.map((r) => r.source_id), [`weekly-board:${W0}:${first.games[0]}:${CHAMP}`]);
    ok('award: 300 / 200 / 100 on each of 3 boards (1,800) and a medal for each first place');

    await new Promise((resolve) => setTimeout(resolve, 300)); // the notifications are sent after the commit

    // Twice, then with the run row lost: nothing more.
    const again = await weekly.runWeeklyBoardAwards(W0, after);
    assert.equal(again.status, 'already-ran');
    assert.equal(again.ticketsAwarded, 1800, 'already-ran reports what was paid');
    assert.deepEqual(await ledger(pool, W0), paid0);
    await pool.query(`DELETE FROM weekly_board_runs WHERE week_key = $1`, [W0]);
    const rerun = await weekly.runWeeklyBoardAwards(W0, after);
    assert.equal(rerun.status, 'completed');
    assert.equal(rerun.ticketsAwarded, 0, 'a re-run after the run row is lost pays 0');
    assert.equal(rerun.medalsAwarded, 0, 'and grants no medal');
    assert.deepEqual(await ledger(pool, W0), paid0, 'ledger, wallets, awards and medals unchanged');
    const notes = await pool.query<{ title: string; body: string }>(
      `SELECT title, body FROM arcade_notifications WHERE dedupe_key LIKE $1 ORDER BY title`,
      [`weekly-board:${W0}:%`],
    );
    assert.equal(notes.rowCount, 9, 'one notification per prize, even after three runs');
    assert.ok(notes.rows.some((n) => /^1st on .+ last week$/.test(n.title) && n.body === '300 tickets and the first place medal.'));
    assert.ok(notes.rows.some((n) => /^3rd on .+ last week$/.test(n.title) && n.body === '100 tickets.'));
    ok('award: a second run and a run after the run row is lost pay nothing, and notify once');

    // Two at once: one pays, one finds it paid.
    const after2 = weekWindow(W2).end + 60_000;
    const both = await Promise.all([weekly.runWeeklyBoardAwards(W2, after2), weekly.runWeeklyBoardAwards(W2, after2)]);
    assert.deepEqual(both.map((r) => r.status).sort(), ['already-ran', 'completed']);
    const paid2 = await ledger(pool, W2);
    assert.equal(paid2.rows, 9);
    assert.equal(paid2.total, 1800);
    assert.equal(paid2.awards, 9);
    ok('award: two runs at once pay once');

    // The champ won twice and owns one medal; the count is in the awards.
    assert.equal(await weekly.getBoardMedalCount(CHAMP), 2);
    const owned = await pool.query(`SELECT 1 FROM user_owned_items WHERE user_id = $1 AND item_id = $2`, [CHAMP, WEEKLY_BOARD_MEDAL.itemId]);
    assert.equal(owned.rowCount, 1);
    const item = await pool.query<{ active: boolean; game_type: string }>(`SELECT active, game_type FROM store_items WHERE id = $1`, [WEEKLY_BOARD_MEDAL.itemId]);
    assert.equal(item.rows[0]?.active, false, 'the medal is never on sale');
    assert.equal(item.rows[0]?.game_type, 'profile');
    ok('medal: one item per player, the count of first places in the awards');

    // The catch-up pays the one week left (week 1) and then nothing.
    const due = await weekly.runDueWeeklyBoardAwards(weekWindow(W2).end + 60_000);
    assert.deepEqual(due.map((r) => [r.weekKey, r.status]), [[W1, 'completed']]);
    assert.equal(due[0]!.ticketsAwarded, 1800);
    assert.deepEqual(await weekly.runDueWeeklyBoardAwards(weekWindow(W2).end + 120_000), []);
    assert.deepEqual(weekly.closedWeekKeys(START + WEEK_MS - 1), []);
    assert.deepEqual(weekly.closedWeekKeys(START + WEEK_MS), [W0]);
    ok('catch-up: every closed week once, then nothing');

    // What the page reads in week 3, for a player 4th on a board.
    const viewer = player(W0, weeklyBoardPicks(W0)[1]!, 'd');
    const view = await weekly.getWeeklyBoardsView(viewer, weekWindow(W1).start + 1000);
    assert.equal(view.weekKey, W1);
    assert.equal(view.upcoming, false);
    assert.equal(view.last?.weekKey, W0);
    assert.equal(view.last?.paid, true);
    assert.deepEqual(view.last?.boards.map((b) => b.winners.map((w) => w.tickets)), [[300, 200, 100], [300, 200, 100], [300, 200, 100]]);
    const early = await weekly.getWeeklyBoardsView(viewer, START - 1000);
    assert.equal(early.upcoming, true);
    assert.deepEqual(early.boards.map((b) => b.game), weeklyBoardPicks(W0));
    assert.equal(early.last, null);
    ok('page: this week, last week paid, and the first week shown before it starts');

    // The monthly path writes nothing for October 2026.
    const oct = await runMonthlyLeaderboardRewards('2026-10', { resetLeaderboards: false });
    assert.equal(oct.status, 'retired');
    const monthRows = await pool.query(`SELECT 1 FROM currency_ledger WHERE source_type = 'monthly_reward' AND source_id LIKE 'monthly-credits:2026-10:%'`);
    assert.equal(monthRows.rowCount, 0);
    ok('monthly: 2026-10 is retired and writes nothing');
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 300)); // let the last award's notifications land
    await clearSeed(pool).catch(() => undefined);
    await pool.end();
  }
}

async function main() {
  checkWeeks();
  checkRotation();
  checkEligible();
  const url = process.env.DATABASE_URL;
  if (url) await checkDatabase(url);
  else console.log('database: skipped, DATABASE_URL not set');
  console.log(`weekly boards verified (${passed} checks)`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
