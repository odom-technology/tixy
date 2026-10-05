/**
 * Prints what a week's paid boards would pay, from the data in the database
 * now, and the rotation ahead. Reads only: nothing is granted.
 *
 *   npm run weekly-boards:dry-run                         this week, standings so far
 *   npm run weekly-boards:dry-run -- --week=2026-10-05    that week (a Monday)
 *   npm run weekly-boards:dry-run -- --rotation=8         the next 8 weeks' games only
 *
 * Add `--json` for the awards as JSON.
 */
import {
  WEEKLY_BOARDS_MAX_PAYOUT,
  WEEKLY_BOARDS_START_MS,
  weekIndexOf,
  weekKeyAt,
  weekKeyOf,
  weekWindow,
  weeklyBoardGames,
  weeklyBoardPicks,
} from '../src/features/arcade/lib/weekly-boards';

const fmt = (n: number) => n.toLocaleString('en-US');

async function main() {
  const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const now = Date.now();
  const rotation = arg('rotation');
  if (rotation) {
    const from = Math.max(0, weekIndexOf(weekKeyOf(Math.max(now, WEEKLY_BOARDS_START_MS))));
    console.log(`Eligible games on the floor: ${weeklyBoardGames().join(', ')}.`);
    for (let i = from; i < from + Number(rotation); i += 1) {
      console.log(`${weekKeyAt(i)}  ${weeklyBoardPicks(weekKeyAt(i)).join(', ')}`);
    }
    return;
  }

  const weekKey = arg('week') ?? weekKeyOf(Math.max(now, WEEKLY_BOARDS_START_MS));
  const window = weekWindow(weekKey);
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL.');
  const { buildWeeklyAwards, boardGameLabel } = await import('../src/server/arcade/rewards/weekly-boards');
  const { query } = await import('../src/server/db/client');
  const awards = await buildWeeklyAwards(weekKey);
  const done = await query<{ n: string }>(
    `SELECT count(*) AS n FROM weekly_board_runs WHERE week_key = $1 AND status = 'completed'`,
    [weekKey],
  );
  const total = awards.reduce((sum, award) => sum + award.tickets, 0);

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ weekKey, total, awards }, null, 2));
    return;
  }
  console.log(
    `Weekly boards for the week of ${weekKey} (${new Date(window.start).toISOString()} to ${new Date(window.end).toISOString()}). Dry run: nothing is granted.`,
  );
  if (window.end > now) console.log(`Note: the week isn't over, so these are the standings so far.`);
  if (Number(done.rows[0]?.n) > 0) console.log(`Note: ${weekKey} has already been awarded; a real run would grant nothing.`);
  console.log('');
  for (const game of weeklyBoardPicks(weekKey)) {
    console.log(`${boardGameLabel(game)} (${game})`);
    const rows = awards.filter((award) => award.game === game);
    for (const row of rows) {
      console.log(`  ${row.rank}. ${row.userName.padEnd(24)} ${fmt(row.score).padStart(8)}  ${fmt(row.tickets).padStart(4)}${row.medal ? ' and the medal' : ''}`);
    }
    if (rows.length === 0) console.log('  nobody on this board');
  }
  console.log('');
  console.log(`Total ${fmt(total)} tickets. Most a week can pay: ${fmt(WEEKLY_BOARDS_MAX_PAYOUT)}.`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
