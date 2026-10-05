/* Weekly paid boards: which three games pay this week, and what they pay.
   Pure and client-safe: the server, the leaderboards page and the verifier
   all read the same picks from here.

   A week runs from Monday 00:00 UTC to the next Monday 00:00 UTC, the same
   weeks as the floor and the season card. The first is the week of Monday
   5 October 2026 (SEASON_START). Each week's 3 boards pay 300, 200 and 100
   tickets to ranks 1 to 3, and first place also gets the first place medal.

   The rotation (weeklyBoardPicks) is a fixed-seed walk over the eligible
   games: each week takes the 3 games picked longest ago, and ties are broken
   by a hash of the seed, the week and the game. So:
     - the picks are the same on every server and every page,
     - no game is picked two weeks running (with 6 or more games),
     - every game comes round within ceil(n / 3) weeks (4 for 10 games):
       a game picked in week w has at most n - 1 picks ahead of it after.
   It runs from the first week each time it is asked (memoised), so a game
   leaving the floor reshapes the picks from the week that change ships. The
   award stores the games it paid, so a past week never changes. */

import { isOnFloor } from '@/features/arcade/components/arcade-game-registry';

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Monday 5 October 2026, 00:00 UTC: the first week that pays. */
export const WEEKLY_BOARDS_START_MS = Date.UTC(2026, 9, 5);

/** Ranks 1 to 3. */
export const WEEKLY_BOARD_PRIZES = [300, 200, 100] as const;

export const WEEKLY_BOARDS_PER_WEEK = 3;

/** The most a week can pay: 3 boards at 600. */
export const WEEKLY_BOARDS_MAX_PAYOUT =
  WEEKLY_BOARDS_PER_WEEK * WEEKLY_BOARD_PRIZES.reduce((sum, tickets) => sum + tickets, 0);

/** First place's medal: a store item that is never sold. One per player; the count is in the awards. */
export const WEEKLY_BOARD_MEDAL = {
  itemId: 'board-medal-first',
  name: 'first place medal',
  art: '/art/medals/medal-board-first.svg',
} as const;

/** Changing the seed reshuffles every week, past ones included. Never change it. */
export const WEEKLY_BOARDS_SEED = 'tixy-weekly-boards-1';

/**
 * Games whose weekly board can pay, in a fixed order (append only). Floor skill
 * games whose every score is the server's own replay of the run, read from
 * game_score_events. A game off the floor is skipped by weeklyBoardGames().
 */
export const WEEKLY_BOARD_CANDIDATES = [
  'snake',
  '2048',
  'stack',
  'ricochet',
  'ticket-stop',
  'flappy-bird',
  'skee-ball',
  'high-striker',
  'tin-duck',
  'ring-toss',
] as const;

/** The candidates on the floor today, in the fixed order. */
export function weeklyBoardGames(): string[] {
  return WEEKLY_BOARD_CANDIDATES.filter((slug) => isOnFloor(slug));
}

// ── Weeks ────────────────────────────────────────────────────────────────────

/** Monday 00:00 UTC of the week holding `ms`. */
export function weekStartOf(ms: number): number {
  const date = new Date(ms);
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const sinceMonday = (date.getUTCDay() + 6) % 7;
  return day - sinceMonday * 86_400_000;
}

/** A week's key is its Monday, 'YYYY-MM-DD'. */
export function weekKeyOf(ms: number): string {
  return new Date(weekStartOf(ms)).toISOString().slice(0, 10);
}

/** The Monday of a week key, or null if the key isn't a Monday. */
export function parseWeekKey(weekKey: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekKey)) return null;
  const ms = Date.parse(`${weekKey}T00:00:00.000Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== weekKey) return null;
  return weekStartOf(ms) === ms ? ms : null;
}

export type WeekWindow = { weekKey: string; start: number; end: number };

export function weekWindow(weekKey: string): WeekWindow {
  const start = parseWeekKey(weekKey);
  if (start === null) throw new Error(`Not a week key: ${weekKey}`);
  return { weekKey, start, end: start + WEEK_MS };
}

/** Weeks since the first paid week: 0 for the week of 5 October 2026, negative before it. */
export function weekIndexOf(weekKey: string): number {
  const start = parseWeekKey(weekKey);
  if (start === null) throw new Error(`Not a week key: ${weekKey}`);
  return Math.round((start - WEEKLY_BOARDS_START_MS) / WEEK_MS);
}

export function weekKeyAt(index: number): string {
  return new Date(WEEKLY_BOARDS_START_MS + index * WEEK_MS).toISOString().slice(0, 10);
}

// ── The rotation ─────────────────────────────────────────────────────────────

/* FNV-1a, 32 bit. Small, and the same in every runtime. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const memo = new Map<string, string[][]>();

/**
 * The games that pay in a week, in pick order. Empty before the first week.
 * `games` is for tests; it defaults to the eligible games on the floor.
 */
export function weeklyBoardPicks(weekKey: string, games: readonly string[] = weeklyBoardGames()): string[] {
  const index = weekIndexOf(weekKey);
  if (index < 0 || games.length === 0) return [];
  const id = games.join(',');
  let weeks = memo.get(id);
  if (!weeks) {
    weeks = [];
    memo.set(id, weeks);
  }
  if (weeks.length <= index) {
    const last = new Map<string, number>(games.map((game) => [game, -1]));
    for (let w = 0; w < weeks.length; w += 1) for (const game of weeks[w]!) last.set(game, w);
    const count = Math.min(WEEKLY_BOARDS_PER_WEEK, games.length);
    for (let w = weeks.length; w <= index; w += 1) {
      const order = [...games].sort(
        (a, b) =>
          last.get(a)! - last.get(b)! ||
          hash(`${WEEKLY_BOARDS_SEED}:${w}:${a}`) - hash(`${WEEKLY_BOARDS_SEED}:${w}:${b}`) ||
          (a < b ? -1 : 1),
      );
      const picks = order.slice(0, count);
      for (const game of picks) last.set(game, w);
      weeks.push(picks);
    }
  }
  return [...weeks[index]!];
}

/** Ordinal for a rank: 1st, 2nd, 3rd, 4th, 11th. */
export function ordinal(rank: number): string {
  const teen = rank % 100;
  if (teen >= 11 && teen <= 13) return `${rank}th`;
  return `${rank}${['th', 'st', 'nd', 'rd'][rank % 10] ?? 'th'}`;
}
