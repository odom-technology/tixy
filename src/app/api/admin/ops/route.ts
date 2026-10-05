import { NextResponse } from 'next/server';

import { getArcadeGameBySlug, getGamePlacement } from '@/features/arcade/components/arcade-game-registry';
import { withAdmin } from '@/server/admin/guard';
import { completeQuestsForGame } from '@/server/arcade/battlepass/complete-on-redirect';
import {
  WEEKLY_BOARDS_MAX_PAYOUT,
  WEEKLY_BOARD_PRIZES,
  WEEKLY_BOARDS_START_MS,
  parseWeekKey,
  weekKeyOf,
  weekWindow,
  weeklyBoardPicks,
} from '@/features/arcade/lib/weekly-boards';
import {
  MONTHLY_BOARDS_RETIRED_FROM,
  buildMonthlyAwards,
  getMonthlyBoards,
  maxMonthlyPayout,
  monthlyBoardsRetired,
} from '@/server/arcade/rewards/monthly-boards';
import { boardGameLabel, buildWeeklyAwards } from '@/server/arcade/rewards/weekly-boards';
import { query } from '@/server/db/client';

export const dynamic = 'force-dynamic';

/* Operations the console can run. The weekly and monthly boards dry runs
   read only.
   complete-quests writes only when it is told to, with a reason and a typed
   confirmation. There is no season close here: season 0 restarts under a new
   key instead of closing (tixy/r-season-reset).

   One op at a time per process: a second one while one runs gets a 409. Ops
   count as writes for the rate limit, dry or not. */

const CEILING_OLD = 41_250;
const MAX_SLUGS = 20;

const OPS = new Set(['weekly-boards-dry-run', 'monthly-boards-dry-run', 'complete-quests']);

let busy = false;

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

type Body = {
  op?: unknown;
  month?: unknown;
  week?: unknown;
  slugs?: unknown;
  dryRun?: unknown;
  reason?: unknown;
  confirm?: unknown;
};

async function namesFor(ids: string[]) {
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const result = await query<{ id: string; name: string | null }>(
    `SELECT id, username AS name FROM arcade_accounts WHERE id = ANY($1::text[])`,
    [ids],
  );
  for (const row of result.rows) if (row.name) names.set(row.id, row.name);
  return names;
}

/* The week's standings as they would pay if it closed now, or a closed
   week's. Reads only. */
async function weeklyBoardsDryRun(body: Body) {
  const weekKey = body.week === undefined ? weekKeyOf(Math.max(Date.now(), WEEKLY_BOARDS_START_MS)) : body.week;
  if (typeof weekKey !== 'string' || parseWeekKey(weekKey) === null) {
    return bad('week must be a Monday, YYYY-MM-DD.');
  }
  const window = weekWindow(weekKey);
  const awards = await buildWeeklyAwards(weekKey);
  const done = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM weekly_board_runs WHERE week_key = $1 AND status = 'completed'`,
    [weekKey],
  );
  const total = awards.reduce((sum, award) => sum + award.tickets, 0);
  return NextResponse.json({
    op: 'weekly-boards-dry-run',
    week: weekKey,
    window: { start: window.start, end: window.end },
    closed: window.end <= Date.now(),
    alreadyAwarded: Number(done.rows[0]?.n ?? 0) > 0,
    boards: weeklyBoardPicks(weekKey).map((game) => {
      const rows = awards.filter((award) => award.game === game);
      return {
        key: game,
        label: boardGameLabel(game),
        game,
        total: rows.reduce((sum, award) => sum + award.tickets, 0),
        ceiling: WEEKLY_BOARD_PRIZES.reduce((sum, tickets) => sum + tickets, 0),
        rows: rows.map((row) => ({ rank: row.rank, userId: row.userId, username: row.userName, credits: row.tickets, score: row.score })),
      };
    }),
    total,
    players: new Set(awards.map((award) => award.userId)).size,
    maxPayout: WEEKLY_BOARDS_MAX_PAYOUT,
    ceiling: WEEKLY_BOARDS_MAX_PAYOUT,
    overCeiling: total > WEEKLY_BOARDS_MAX_PAYOUT,
  });
}

async function monthlyBoardsDryRun(body: Body) {
  const monthKey = body.month;
  if (typeof monthKey !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
    return bad('month must be YYYY-MM.');
  }
  if (monthlyBoardsRetired(monthKey)) {
    return bad(`The monthly award is retired from ${MONTHLY_BOARDS_RETIRED_FROM}; the weekly boards pay instead.`);
  }
  const boards = getMonthlyBoards(monthKey);
  const awards = await buildMonthlyAwards(monthKey);
  const names = await namesFor([...new Set(awards.map((award) => award.userId))]);
  const done = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM monthly_reward_runs WHERE month_key = $1 AND status = 'completed'`,
    [monthKey],
  );
  const ceiling = CEILING_OLD;
  const total = awards.reduce((sum, award) => sum + award.credits, 0);
  return NextResponse.json({
    op: 'monthly-boards-dry-run',
    month: monthKey,
    alreadyAwarded: Number(done.rows[0]?.n ?? 0) > 0,
    boards: boards.map((board) => {
      const rows = awards.filter((award) => award.leaderboardKey === board.key);
      return {
        key: board.key,
        label: board.label,
        game: board.game,
        total: rows.reduce((sum, award) => sum + award.credits, 0),
        ceiling: board.payouts.reduce((sum, credits) => sum + credits, 0),
        rows: rows.map((row) => ({
          rank: row.rank,
          userId: row.userId,
          username: names.get(row.userId) ?? null,
          credits: row.credits,
        })),
      };
    }),
    total,
    players: new Set(awards.map((award) => award.userId)).size,
    maxPayout: maxMonthlyPayout(boards),
    ceiling,
    overCeiling: total > ceiling,
  });
}

async function completeQuests(body: Body) {
  if (!Array.isArray(body.slugs) || body.slugs.length === 0 || body.slugs.length > MAX_SLUGS) {
    return bad(`slugs must be a list of 1 to ${MAX_SLUGS} game slugs.`);
  }
  const slugs: string[] = [];
  for (const raw of body.slugs) {
    if (typeof raw !== 'string' || !raw.trim()) return bad('slugs must be strings.');
    const slug = raw.trim();
    if (!getArcadeGameBySlug(slug)) return bad(`Unknown game "${slug}".`);
    if (getGamePlacement(slug)?.status === 'floor') {
      return bad(`"${slug}" is on the floor; its quests are live. Take it off the floor first.`);
    }
    if (!slugs.includes(slug)) slugs.push(slug);
  }
  if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') return bad('dryRun must be true or false.');
  const dryRun = body.dryRun !== false;
  if (!dryRun) {
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) return bad('A real run needs a reason.');
    if (reason.length > 500) return bad('reason must be 500 characters or fewer.');
    if (body.confirm !== slugs.join(',')) {
      return bad(`Type ${slugs.join(',')} in confirm to run this for real.`);
    }
  }
  const results = [];
  for (const slug of slugs) {
    results.push(await completeQuestsForGame(slug, { dryRun }));
  }
  return NextResponse.json({
    op: 'complete-quests',
    dryRun,
    results,
    total: results.reduce((sum, result) => sum + result.total, 0),
  });
}

export const POST = withAdmin(async (request) => {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad('Invalid JSON.');
  }
  if (!body || typeof body !== 'object') return bad('Invalid JSON.');
  const op = typeof body.op === 'string' ? body.op : '';
  if (!OPS.has(op)) return bad('Unknown op.');
  if (busy) return bad('Another operation is running. Try again in a moment.', 409);
  busy = true;
  try {
    if (op === 'weekly-boards-dry-run') return await weeklyBoardsDryRun(body);
    if (op === 'monthly-boards-dry-run') return await monthlyBoardsDryRun(body);
    return await completeQuests(body);
  } catch (error) {
    console.error(`[admin-ops] ${op} failed`, error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'The operation failed.' }, { status: 500 });
  } finally {
    busy = false;
  }
}, {
  audit: ({ body }) => {
    const input = (body ?? {}) as Body;
    const op = typeof input.op === 'string' && OPS.has(input.op) ? input.op : 'unknown';
    const slugs = Array.isArray(input.slugs) ? input.slugs : undefined;
    return {
      action: `ops.${op}`,
      targetType: 'ops',
      targetId: slugs ? slugs.filter((slug) => typeof slug === 'string').join(',') : op,
      reason: typeof input.reason === 'string' ? input.reason : null,
      details: { op, month: input.month, week: input.week, slugs, dryRun: op === 'complete-quests' ? input.dryRun !== false : undefined },
    };
  },
});
