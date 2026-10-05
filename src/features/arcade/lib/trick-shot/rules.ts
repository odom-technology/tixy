/* Trick shot's rules: the day, the score, the board, the streak and what it
   pays. Shared by the client, the server and the verifier, so the ? sheet,
   the result card and the route all quote the same numbers. Pure, no DOM or
   Node APIs. */

/** 2: unlimited tries a day, the best try stands (was 1: one scored shot). */
export const TRICK_SHOT_RULES = 2;

/** A clear is worth this on top of the pots. Pots share the rest of 100. */
export const TRICK_SHOT_CLEAR_BONUS = 30;
export const TRICK_SHOT_POT_POINTS = 100 - TRICK_SHOT_CLEAR_BONUS;
export const TRICK_SHOT_MAX_SCORE = 100;

/** Tickets: floor, then 75 × (1 − exp(−(s/k)^p)), inside the 75 cap.
 *  scripts/verify-trick-shot.ts prints the table and fails if it drifts. */
export const TRICK_SHOT_REWARD_FLOOR = 12;
export const TRICK_SHOT_REWARD_K = 45;
export const TRICK_SHOT_REWARD_P = 1.3;
export const TRICK_SHOT_REWARD_CAP = 75;

export type TrickShotOutcome = {
  /** Object balls potted on the shot. */
  pots: number;
  /** Object balls on the table. */
  ballCount: number;
  scratch: boolean;
};

/** Every object ball down and the cue ball still on the table. */
export const isClear = (outcome: TrickShotOutcome) =>
  !outcome.scratch && outcome.ballCount > 0 && outcome.pots >= outcome.ballCount;

/** Points out of 100: the pots' share of 70, plus 30 for a clear. */
export function trickShotScore(outcome: TrickShotOutcome): number {
  if (outcome.ballCount <= 0) return 0;
  const pots = Math.max(0, Math.min(outcome.ballCount, outcome.pots));
  const share = Math.round((TRICK_SHOT_POT_POINTS * pots) / outcome.ballCount);
  return share + (isClear(outcome) ? TRICK_SHOT_CLEAR_BONUS : 0);
}

/** What a day's best of `score` points is worth, before the daily cap. */
export function trickShotTickets(score: number): number {
  const s = Math.max(0, Math.min(TRICK_SHOT_MAX_SCORE, score));
  const curve =
    TRICK_SHOT_REWARD_CAP * (1 - Math.exp(-Math.pow(s / TRICK_SHOT_REWARD_K, TRICK_SHOT_REWARD_P)));
  return Math.max(TRICK_SHOT_REWARD_FLOOR, Math.min(TRICK_SHOT_REWARD_CAP, Math.round(curve)));
}

/**
 * Tickets one try pays. The day's first try pays its value. A later try that
 * beats the day's best pays the difference between the two values, so a
 * day's payments always add up to the value of its best. Any other try pays
 * nothing. `previousBest` is the day's best score before this try, or null
 * for the first try.
 */
export function trickShotTryTickets(score: number, previousBest: number | null): number {
  if (previousBest === null) return trickShotTickets(score);
  if (score <= previousBest) return 0;
  return Math.max(0, trickShotTickets(score) - trickShotTickets(previousBest));
}

// ── The day's best and the board ────────────────────────────────────────

export type TrickShotTryResult = {
  pots: number;
  score: number;
};

/** True when `next` beats `best`: more balls down, or as many with a clean
 *  clear over a scratch on the last ball (the score tells them apart). A
 *  repeat of the best is not better, so the earlier try keeps it. */
export function isBetterTrickShotTry(next: TrickShotTryResult, best: TrickShotTryResult | null): boolean {
  if (!best) return true;
  return next.pots > best.pots || (next.pots === best.pots && next.score > best.score);
}

export type TrickShotDayStanding = TrickShotTryResult & {
  /** The try that first reached the day's best, from 1. */
  bestTry: number;
  /** When it did, ms. */
  reachedAt: number;
};

/** The day's board order: most balls down (a clean clear over a scratch),
 *  then fewest tries to first reach that best, then the earliest to reach it. */
export function compareTrickShotStandings(a: TrickShotDayStanding, b: TrickShotDayStanding): number {
  return b.pots - a.pots || b.score - a.score || a.bestTry - b.bestTry || a.reachedAt - b.reachedAt;
}

/** The same order in SQL, over trick_shot_attempts' columns. Rows from
 *  before tries were counted have no best_try; they took one try. */
export const TRICK_SHOT_BOARD_ORDER = 'pots DESC, score DESC, COALESCE(best_try, 1) ASC, shot_at ASC';

// ── The day ─────────────────────────────────────────────────────────────

/** Today's UTC date key, YYYY-MM-DD. Word grid uses the same clock. */
export function trickShotDateKey(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export const isTrickShotDateKey = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** The UTC date key `days` days from `dateKey`. */
export function shiftTrickShotDateKey(dateKey: string, days: number): string {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The streak: days in a row the table was cleared, counting back from today.
 * A day counts when its best try is a clear, so a scratch on the last ball
 * doesn't (no clear bonus, no streak). Today not yet cleared doesn't break a
 * streak that ran to yesterday; a day missed does. Word grid counts the same
 * way. Days are UTC date keys, the table's own day.
 */
export function trickShotStreak(clearedDays: Iterable<string>, today: string): number {
  const days = new Set(clearedDays);
  let day = days.has(today) ? today : shiftTrickShotDateKey(today, -1);
  let streak = 0;
  while (days.has(day)) {
    streak += 1;
    day = shiftTrickShotDateKey(day, -1);
  }
  return streak;
}

/** The longest run of cleared days, ever. */
export function trickShotBestStreak(clearedDays: Iterable<string>): number {
  const sorted = [...new Set(clearedDays)].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const day of sorted) {
    run = prev !== null && shiftTrickShotDateKey(prev, 1) === day ? run + 1 : 1;
    best = Math.max(best, run);
    prev = day;
  }
  return best;
}

/** Table number for the strip: whole UTC days since 2026-10-04, from 1. */
export const TRICK_SHOT_FIRST_DAY = '2026-10-04';
export function trickShotDayNumber(dateKey: string): number {
  const day = Date.parse(`${dateKey}T00:00:00Z`);
  const first = Date.parse(`${TRICK_SHOT_FIRST_DAY}T00:00:00Z`);
  return Math.floor((day - first) / 86_400_000) + 1;
}

/** 0 Monday to 6 Sunday. The week climbs from easy to hard. */
export function trickShotWeekday(dateKey: string): number {
  const utcDay = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return (utcDay + 6) % 7;
}

export const TRICK_SHOT_WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export type TrickShotDifficulty = 'easy' | 'medium' | 'hard' | 'expert';

/** How a position is graded, from the width of its clearing window: the
 *  range of aim, in degrees, that clears at the solution's power and spin. */
export function gradeTrickShot(angleWindowDeg: number): TrickShotDifficulty {
  if (angleWindowDeg >= 0.4) return 'easy';
  if (angleWindowDeg >= 0.18) return 'medium';
  if (angleWindowDeg >= 0.08) return 'hard';
  return 'expert';
}
