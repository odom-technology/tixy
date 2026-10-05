// ─────────────────────────────────────────────────────────────────────────────
// Weekly paid boards: the standings and the award (PROGRESSION.md "Decided").
//
// Three games a week (weeklyBoardPicks in features/arcade/lib/weekly-boards.ts)
// pay their top 3 when the week closes: 300 / 200 / 100 tickets, and the first
// place medal for first. They replace the monthly boards from October 2026.
//
// What a board ranks: each player's best run in the week (Monday 00:00 UTC to
// Monday 00:00 UTC), from game_score_events, which every accepted run appends
// to. Every eligible game's score is the server's replay of the run, so the log
// holds nothing a client chose. A game with a rules split (stack, high striker,
// tin duck) ranks only its current rules, the board's default mode. Ties: the
// earlier run wins, then the lower event id. Bots and guests are never on a
// board, and a player with no run that week isn't either.
//
// The award is idempotent. One ledger row per week, game and player
// (`weekly-board:<week>:<game>:<user>`), one award row per week, game and
// player, one run row per week, and the run takes an advisory lock on its week
// so two callers (the sweeper and the cron route) can't race. The medal is
// one store item per player; how many a player has won is the count of their
// rank 1 award rows.
//
// Scheduling: ensureWeeklyBoardsSweeper (started by server.ts) awards every
// closed week that has no completed run, at boot and every 15 minutes, so a
// missed week catches up on its own. /api/cron/rewards/weekly-boards does the
// same on demand.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';

import {
  WEEKLY_BOARD_MEDAL,
  WEEKLY_BOARD_PRIZES,
  WEEKLY_BOARDS_START_MS,
  WEEK_MS,
  ordinal,
  parseWeekKey,
  weekKeyAt,
  weekKeyOf,
  weekWindow,
  weeklyBoardPicks,
  type WeekWindow,
} from '@/features/arcade/lib/weekly-boards';
import { getArcadeGameBySlug } from '@/features/arcade/components/arcade-game-registry';
import { getGameDisplayName } from '@/features/arcade/lib/game-renames';
import { query, withTransaction } from '@/server/db/client';
import { resolveGameMode } from '@/server/arcade/score-events';
import { withCurrentLeaderboardNames } from '@/server/arcade/leaderboard-identities';
import { createNotification } from '@/server/services/notifications';

import { mutateWalletAndLedgerForTransaction } from './wallet';

export const WEEKLY_BOARD_SOURCE_TYPE = 'weekly_board' as const;

/** For tests and screenshots off production: WEEKLY_BOARDS_NOW=2026-10-08T12:00:00Z. */
export function weeklyBoardsNow(): number {
  const override = process.env.NODE_ENV !== 'production' ? process.env.WEEKLY_BOARDS_NOW : undefined;
  const parsed = override ? Date.parse(override) : NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

/** "skee-ball", "stacker", as the floor names a game. */
export function boardGameLabel(slug: string): string {
  const game = getArcadeGameBySlug(slug);
  return getGameDisplayName(slug, game?.title ?? slug).toLowerCase();
}

type Runner = Pick<PoolClient, 'query'>;
const pool: Runner = { query: ((text: string, values?: unknown[]) => query(text, values)) as Runner['query'] };

export type WeeklyBoardRow = {
  rank: number;
  userId: string;
  userName: string;
  score: number;
  at: number;
};

/**
 * One board's standings for a week: the top `limit`, and the viewer's own row
 * if they have one further down. Ranks are positions: ties are broken, never shared.
 */
export async function readWeeklyBoard(
  game: string,
  window: Pick<WeekWindow, 'start' | 'end'>,
  options: { limit?: number; viewerId?: string | null; runner?: Runner } = {},
): Promise<WeeklyBoardRow[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 3, 100));
  const mode = resolveGameMode(game, null);
  const params: unknown[] = [game, window.start, window.end, limit, options.viewerId ?? ''];
  if (mode !== null) params.push(mode);
  const result = await (options.runner ?? pool).query<{
    rank: string;
    user_id: string;
    user_name: string | null;
    score: string | number;
    created_at: string | number;
  }>(
    `WITH best AS (
       SELECT DISTINCT ON (e.od_user_id) e.id, e.od_user_id, e.user_name, e.score, e.created_at
       FROM game_score_events e
       WHERE e.game_slug = $1 AND e.created_at >= $2 AND e.created_at < $3
         AND e.od_user_id NOT LIKE 'bot:%' AND e.od_user_id NOT LIKE 'guest:%'
         ${mode === null ? '' : 'AND e.mode = $6'}
       ORDER BY e.od_user_id, e.score DESC, e.created_at ASC, e.id ASC
     ), ranked AS (
       SELECT b.*, ROW_NUMBER() OVER (ORDER BY b.score DESC, b.created_at ASC, b.id ASC) AS rank
       FROM best b
     )
     SELECT r.rank, r.od_user_id AS user_id, COALESCE(a.username, r.user_name) AS user_name, r.score, r.created_at
     FROM ranked r
     LEFT JOIN arcade_accounts a ON a.id = r.od_user_id
     WHERE r.rank <= $4 OR r.od_user_id = $5
     ORDER BY r.rank`,
    params,
  );
  return result.rows.map((row) => ({
    rank: Number(row.rank),
    userId: row.user_id,
    userName: row.user_name || 'player',
    score: Number(row.score),
    at: Number(row.created_at),
  }));
}

export type WeeklyAward = {
  game: string;
  userId: string;
  userName: string;
  rank: number;
  score: number;
  tickets: number;
  medal: boolean;
};

/** Who wins what for a week, from its picks. Reads only. */
export async function buildWeeklyAwards(weekKey: string, runner?: Runner): Promise<WeeklyAward[]> {
  const window = weekWindow(weekKey);
  const games = weeklyBoardPicks(weekKey);
  // One at a time: inside the award they share the transaction's client.
  const boards: WeeklyBoardRow[][] = [];
  for (const game of games) {
    boards.push(await readWeeklyBoard(game, window, { limit: WEEKLY_BOARD_PRIZES.length, runner }));
  }
  return games.flatMap((game, index) =>
    boards[index]!.filter((row) => row.rank <= WEEKLY_BOARD_PRIZES.length).map((row) => ({
      game,
      userId: row.userId,
      userName: row.userName,
      rank: row.rank,
      score: row.score,
      tickets: WEEKLY_BOARD_PRIZES[row.rank - 1] ?? 0,
      medal: row.rank === 1,
    })),
  );
}

export type WeeklyRunResult = {
  weekKey: string;
  status: 'completed' | 'already-ran' | 'not-closed' | 'before-start';
  games: string[];
  ticketsAwarded: number;
  medalsAwarded: number;
  awards: WeeklyAward[];
};

const MEDAL_UPSERT = `
  INSERT INTO store_items (
    id, name, game_type, rarity, currency_type, price,
    slots_json, active, season_tag, asset_ref, created_at
  ) VALUES ($1, $2, 'profile', 'rare', 'credits', 0, '["badge"]', FALSE, NULL, $3, $4)
  ON CONFLICT (id) DO NOTHING`;

/**
 * Pay a closed week's boards. Safe to call any number of times: a completed
 * week returns 'already-ran', and even with its run row gone the ledger, award
 * and medal rows each hold one per week, game and player.
 */
export async function runWeeklyBoardAwards(weekKey: string, now = weeklyBoardsNow()): Promise<WeeklyRunResult> {
  const start = parseWeekKey(weekKey);
  if (start === null) throw new Error('Invalid week key. Expected the Monday, YYYY-MM-DD.');
  const empty = { weekKey, games: [] as string[], ticketsAwarded: 0, medalsAwarded: 0, awards: [] as WeeklyAward[] };
  if (start < WEEKLY_BOARDS_START_MS) return { ...empty, status: 'before-start' };
  if (start + WEEK_MS > now) return { ...empty, games: weeklyBoardPicks(weekKey), status: 'not-closed' };

  const result = await withTransaction(async (client): Promise<WeeklyRunResult> => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`weekly-boards:${weekKey}`]);
    const done = await client.query<{ games_json: string; summary_json: string | null }>(
      `SELECT games_json, summary_json FROM weekly_board_runs WHERE week_key = $1 AND status = 'completed'`,
      [weekKey],
    );
    if (done.rows[0]) {
      const summary = done.rows[0].summary_json
        ? (JSON.parse(done.rows[0].summary_json) as Partial<WeeklyRunResult>)
        : {};
      return {
        weekKey,
        status: 'already-ran',
        games: JSON.parse(done.rows[0].games_json) as string[],
        ticketsAwarded: summary.ticketsAwarded ?? 0,
        medalsAwarded: summary.medalsAwarded ?? 0,
        awards: summary.awards ?? [],
      };
    }

    const games = weeklyBoardPicks(weekKey);
    const awards = await buildWeeklyAwards(weekKey, client);
    let ticketsAwarded = 0;
    let medalsAwarded = 0;
    const at = Date.now();
    if (awards.some((award) => award.medal)) {
      await client.query(MEDAL_UPSERT, [
        WEEKLY_BOARD_MEDAL.itemId,
        WEEKLY_BOARD_MEDAL.name,
        JSON.stringify({ imageUrl: WEEKLY_BOARD_MEDAL.art }),
        at,
      ]);
    }
    for (const award of awards) {
      const granted = await mutateWalletAndLedgerForTransaction(client, {
        userId: award.userId,
        currencyType: 'credits',
        amount: award.tickets,
        sourceType: WEEKLY_BOARD_SOURCE_TYPE,
        sourceId: `weekly-board:${weekKey}:${award.game}:${award.userId}`,
        meta: { weekKey, game: award.game, rank: award.rank, score: award.score },
      });
      if (!granted.deduped) ticketsAwarded += award.tickets;
      if (award.medal) {
        const owned = await client.query(
          `INSERT INTO user_owned_items (user_id, item_id, acquired_at, acquired_source)
           VALUES ($1, $2, $3, 'reward')
           ON CONFLICT (user_id, item_id) DO NOTHING`,
          [award.userId, WEEKLY_BOARD_MEDAL.itemId, at],
        );
        if ((owned.rowCount ?? 0) > 0) medalsAwarded += 1;
      }
      await client.query(
        `INSERT INTO weekly_board_awards (week_key, game_slug, user_id, user_name, rank, score, tickets, medal, awarded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT DO NOTHING`,
        [weekKey, award.game, award.userId, award.userName, award.rank, award.score, award.tickets, award.medal, at],
      );
    }
    const summary = { ticketsAwarded, medalsAwarded, awards };
    await client.query(
      `INSERT INTO weekly_board_runs (week_key, status, games_json, ran_at, summary_json)
       VALUES ($1, 'completed', $2, $3, $4)
       ON CONFLICT (week_key) DO UPDATE SET
         status = excluded.status, games_json = excluded.games_json,
         ran_at = excluded.ran_at, summary_json = excluded.summary_json`,
      [weekKey, JSON.stringify(games), at, JSON.stringify(summary)],
    );
    return { weekKey, status: 'completed', games, ...summary };
  });

  if (result.status === 'completed') {
    for (const award of result.awards) {
      const game = boardGameLabel(award.game);
      void createNotification({
        userId: award.userId,
        type: 'weekly_board',
        title: `${ordinal(award.rank)} on ${game} last week`,
        body: award.medal
          ? `${award.tickets} tickets and the first place medal.`
          : `${award.tickets} tickets.`,
        href: '/leaderboard',
        preferenceKey: 'game_notifications',
        dedupeKey: `weekly-board:${weekKey}:${award.game}:${award.userId}`,
      }).catch(() => undefined);
    }
  }
  return result;
}

/** Closed weeks from the first one up to `now`, oldest first. */
export function closedWeekKeys(now = weeklyBoardsNow()): string[] {
  const keys: string[] = [];
  for (let index = 0; WEEKLY_BOARDS_START_MS + (index + 1) * WEEK_MS <= now; index += 1) {
    keys.push(weekKeyAt(index));
  }
  return keys;
}

/** Award every closed week that has no completed run. The catch-up for a missed week. */
export async function runDueWeeklyBoardAwards(now = weeklyBoardsNow()): Promise<WeeklyRunResult[]> {
  const closed = closedWeekKeys(now);
  if (closed.length === 0) return [];
  const done = await query<{ week_key: string }>(
    `SELECT week_key FROM weekly_board_runs WHERE status = 'completed' AND week_key = ANY($1::text[])`,
    [closed],
  );
  const finished = new Set(done.rows.map((row) => row.week_key));
  const results: WeeklyRunResult[] = [];
  for (const weekKey of closed) {
    if (!finished.has(weekKey)) results.push(await runWeeklyBoardAwards(weekKey, now));
  }
  return results;
}

const SWEEP_MS = 15 * 60 * 1000;
type SweeperRuntime = { timer: ReturnType<typeof setInterval> | null };
const runtime = (): SweeperRuntime => {
  const holder = globalThis as typeof globalThis & { __tixyWeeklyBoards?: SweeperRuntime };
  holder.__tixyWeeklyBoards ??= { timer: null };
  return holder.__tixyWeeklyBoards;
};

/**
 * Start the weekly award sweeper once per process (server.ts calls this). It
 * runs in production only, or with WEEKLY_BOARDS_SWEEPER=1: a dev server on a
 * shared database must not pay anyone.
 */
export function ensureWeeklyBoardsSweeper(): void {
  const rt = runtime();
  if (rt.timer) return;
  if (process.env.NODE_ENV !== 'production' && process.env.WEEKLY_BOARDS_SWEEPER !== '1') return;
  const sweep = () => {
    void runDueWeeklyBoardAwards()
      .then((results) => {
        for (const r of results) {
          console.log(`[weekly-boards] ${r.weekKey}: ${r.status}, ${r.ticketsAwarded} tickets, ${r.medalsAwarded} medals`);
        }
      })
      .catch((error) => console.error('[weekly-boards] sweep failed:', error));
  };
  rt.timer = setInterval(sweep, SWEEP_MS);
  rt.timer.unref?.();
  setTimeout(sweep, 30_000).unref?.();
}

// ── What the pages read ──────────────────────────────────────────────────────

export type WeeklyBoardView = {
  game: string;
  name: string;
  top: WeeklyBoardRow[];
  /** The viewer's row, when they have a run this week. */
  you: WeeklyBoardRow | null;
};

export type WeeklyBoardsView = {
  weekKey: string;
  /** Monday 00:00 UTC of this week, and of the next. */
  start: number;
  end: number;
  /** The server's clock when this was read, for the time left. */
  now: number;
  /** True before the first paid week: `boards` are its games, with nobody on them yet. */
  upcoming: boolean;
  boards: WeeklyBoardView[];
  last: {
    weekKey: string;
    /** False while the week is closed but not yet paid: the standings are final either way. */
    paid: boolean;
    boards: { game: string; name: string; winners: (WeeklyBoardRow & { tickets: number })[] }[];
  } | null;
};

/* Standings are the same for everyone, so the top rows are read at most once
   a minute for the site. The viewer's own row is read per request. */
const TOP_TTL_MS = 60_000;
const topCache = new Map<string, { at: number; rows: Promise<WeeklyBoardRow[]> }>();

function topCached(game: string, window: WeekWindow) {
  const key = `${window.weekKey}:${game}`;
  const now = Date.now();
  const hit = topCache.get(key);
  if (hit && now - hit.at < TOP_TTL_MS) return hit.rows;
  const rows = readWeeklyBoard(game, window, { limit: 3 }).catch((error) => {
    console.error(`[weekly-boards] ${game} standings failed:`, error);
    return [] as WeeklyBoardRow[];
  });
  topCache.set(key, { at: now, rows });
  if (topCache.size > 64) topCache.delete(topCache.keys().next().value!);
  return rows;
}

async function readLastWeek(weekKey: string): Promise<WeeklyBoardsView['last']> {
  const paid = await query<{ game_slug: string; user_id: string; user_name: string; rank: number; score: number; tickets: number; awarded_at: string }>(
    `SELECT w.game_slug, w.user_id, COALESCE(a.username, w.user_name) AS user_name, w.rank, w.score, w.tickets, w.awarded_at
     FROM weekly_board_awards w LEFT JOIN arcade_accounts a ON a.id = w.user_id
     WHERE w.week_key = $1 ORDER BY w.rank`,
    [weekKey],
  );
  const run = await query<{ games_json: string }>(
    `SELECT games_json FROM weekly_board_runs WHERE week_key = $1 AND status = 'completed'`,
    [weekKey],
  );
  if (run.rows[0]) {
    const games = JSON.parse(run.rows[0].games_json) as string[];
    return {
      weekKey,
      paid: true,
      boards: games.map((game) => ({
        game,
        name: boardGameLabel(game),
        winners: paid.rows
          .filter((row) => row.game_slug === game)
          .map((row) => ({
            rank: Number(row.rank),
            userId: row.user_id,
            userName: row.user_name,
            score: Number(row.score),
            at: Number(row.awarded_at),
            tickets: Number(row.tickets),
          })),
      })),
    };
  }
  const window = weekWindow(weekKey);
  const games = weeklyBoardPicks(weekKey);
  const boards = await Promise.all(games.map((game) => topCached(game, window)));
  return {
    weekKey,
    paid: false,
    boards: games.map((game, index) => ({
      game,
      name: boardGameLabel(game),
      winners: boards[index]!.map((row) => ({ ...row, tickets: WEEKLY_BOARD_PRIZES[row.rank - 1] ?? 0 })),
    })),
  };
}

/** This week's paid boards with the viewer's place, and last week's winners. */
export async function getWeeklyBoardsView(viewerId: string | null, now = weeklyBoardsNow()): Promise<WeeklyBoardsView> {
  const upcoming = now < WEEKLY_BOARDS_START_MS;
  const weekKey = upcoming ? weekKeyAt(0) : weekKeyOf(now);
  const window = weekWindow(weekKey);
  const games = weeklyBoardPicks(weekKey);
  const boards = await Promise.all(
    games.map(async (game): Promise<WeeklyBoardView> => {
      if (upcoming) return { game, name: boardGameLabel(game), top: [], you: null };
      const [top, mine] = await Promise.all([
        topCached(game, window),
        viewerId
          ? readWeeklyBoard(game, window, { limit: 1, viewerId }).then(
              (rows) => rows.find((row) => row.userId === viewerId) ?? null,
              () => null,
            )
          : Promise.resolve(null),
      ]);
      return { game, name: boardGameLabel(game), top, you: mine };
    }),
  );
  const lastKey = upcoming || window.start === WEEKLY_BOARDS_START_MS ? null : weekKeyOf(window.start - 1);
  const last = lastKey ? await readLastWeek(lastKey).catch(() => null) : null;
  // Ranking rows can stay cached, but resolve names after the cache so a
  // profile rename applies to this week, the viewer row, and last week's wins.
  const displayRows = [
    ...boards.flatMap((board) => [...board.top, ...(board.you ? [board.you] : [])]),
    ...(last?.boards.flatMap((board) => board.winners) ?? []),
  ];
  const currentRows = await withCurrentLeaderboardNames(displayRows);
  const namesByRow = new Map(displayRows.map((row, index) => [row, currentRows[index]!.userName]));
  const hydrate = <T extends WeeklyBoardRow>(row: T): T => ({
    ...row,
    userName: namesByRow.get(row) ?? row.userName,
  });
  return {
    weekKey,
    start: window.start,
    end: window.end,
    now,
    upcoming,
    boards: boards.map((board) => ({
      ...board,
      top: board.top.map(hydrate),
      you: board.you ? hydrate(board.you) : null,
    })),
    last: last ? {
      ...last,
      boards: last.boards.map((board) => ({
        ...board,
        winners: board.winners.map(hydrate),
      })),
    } : null,
  };
}

/** How many weekly boards a player has won: their first place medals. */
export async function getBoardMedalCount(userId: string): Promise<number> {
  const result = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM weekly_board_awards WHERE user_id = $1 AND rank = 1`,
    [userId],
  );
  return Number(result.rows[0]?.n ?? 0);
}

/** This week's paid games, for the home tiles. Reads nothing. */
export function currentWeeklyBoardGames(now = weeklyBoardsNow()): string[] {
  if (now < WEEKLY_BOARDS_START_MS) return [];
  return weeklyBoardPicks(weekKeyOf(now));
}
