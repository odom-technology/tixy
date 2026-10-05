/**
 * Prints what a month's leaderboard award would pay, from the data in the
 * database now. Reads only: no wallet, ledger or award row is written.
 *
 *   npm run monthly-boards:dry-run                  last calendar month
 *   npm run monthly-boards:dry-run -- --month=2026-09
 *
 * The monthly award is retired from October 2026 (the weekly boards pay
 * instead, see npm run weekly-boards:dry-run), so a month from 2026-10 on
 * prints that it pays nothing. Earlier months run on season 0's 12 boards,
 * which rank all-time bests. Add `--json` for the awards as JSON. Exits 1 if
 * the total is over 41,250.
 */
import { query } from '../src/server/db/client';
import {
  MONTHLY_BOARDS_RETIRED_FROM,
  buildMonthlyAwards,
  getMonthlyBoards,
  maxMonthlyPayout,
  monthlyBoardsRetired,
} from '../src/server/arcade/rewards/monthly-boards';

const CEILING = 41_250;

const lastMonthKey = () => {
  const now = new Date();
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${last.getUTCFullYear()}-${String(last.getUTCMonth() + 1).padStart(2, '0')}`;
};

const fmt = (n: number) => n.toLocaleString('en-US');

async function main() {
  const monthKey = process.argv.find((arg) => arg.startsWith('--month='))?.slice('--month='.length) ?? lastMonthKey();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) throw new Error('Expected --month=YYYY-MM.');
  if (monthlyBoardsRetired(monthKey)) {
    console.log(
      `The monthly award is retired from ${MONTHLY_BOARDS_RETIRED_FROM}: ${monthKey} pays nothing. The weekly boards pay instead (npm run weekly-boards:dry-run).`,
    );
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL.');

  const boards = getMonthlyBoards(monthKey);
  const awards = await buildMonthlyAwards(monthKey);

  const names = new Map<string, string>();
  const ids = [...new Set(awards.map((award) => award.userId))];
  if (ids.length > 0) {
    const result = await query<{ id: string; name: string | null }>(
      `SELECT id, username AS name FROM arcade_accounts WHERE id = ANY($1)`,
      [ids],
    );
    for (const row of result.rows) if (row.name) names.set(row.id, row.name);
  }

  const done = await query<{ n: string }>(
    `SELECT count(*) AS n FROM monthly_reward_runs WHERE month_key = $1 AND status = 'completed'`,
    [monthKey],
  );

  const total = awards.reduce((sum, award) => sum + award.credits, 0);
  const players = new Set(awards.map((award) => award.userId)).size;

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ monthKey, total, ceiling: CEILING, awards }, null, 2));
  } else {
    console.log(`Monthly boards for ${monthKey} (season 0 boards, all-time bests). Dry run: nothing is granted.`);
    if (Number(done.rows[0]?.n) > 0) console.log(`Note: ${monthKey} has already been awarded; a real run would grant nothing.`);
    console.log('');
    for (const board of boards) {
      const rows = awards.filter((award) => award.leaderboardKey === board.key);
      const boardTotal = rows.reduce((sum, award) => sum + award.credits, 0);
      console.log(`${board.key}  (${board.label})  ${fmt(boardTotal)} of ${fmt(board.payouts.reduce((a, b) => a + b, 0))}`);
      for (const row of rows) {
        console.log(`  ${row.rank}. ${(names.get(row.userId) ?? row.userId).padEnd(24)} ${fmt(row.credits).padStart(6)}`);
      }
      if (rows.length === 0) console.log('  nobody on this board');
    }
    console.log('');
    console.log(`Total ${fmt(total)} tickets to ${players} players. Most this list can pay: ${fmt(maxMonthlyPayout(boards))}. Ceiling: ${fmt(CEILING)}.`);
  }

  if (total > CEILING) {
    console.error(`Over the ceiling: ${fmt(total)} > ${fmt(CEILING)}.`);
    process.exitCode = 1;
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
