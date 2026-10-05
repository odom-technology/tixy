/* The day's trick shot table on the server.

   Tables come from the bank (trick-shot-bank.json), which
   scripts/build-trick-shot-bank.ts writes from the seeded generator and
   scripts/verify-trick-shot.ts checks: every banked day's solution clears
   when replayed, and a sample of days regenerates byte for byte. A day past
   the bank's end is generated here once and kept in memory; that costs a
   few seconds of one request, so the bank is refreshed well ahead. */

import crypto from 'node:crypto';

import { query, queryOne, withTransaction } from '@/server/db/client';
import {
  generateTrickShotPosition,
  publicTable,
  TRICK_SHOT_GENERATOR_VERSION,
  type TrickShotPosition,
  type TrickShotTable,
} from '@/features/arcade/lib/trick-shot/generator';
import {
  gradeTrickShot,
  isBetterTrickShotTry,
  shiftTrickShotDateKey,
  trickShotStreak,
  trickShotTryTickets,
  type TrickShotDifficulty,
} from '@/features/arcade/lib/trick-shot/rules';
import { TRICK_SHOT_ANGLE_STEP } from '@/features/arcade/lib/trick-shot/shot';

import bankJson from './trick-shot-bank.json';

/** One banked day, compact: balls as [id, x, y], the solution's aim as a
 *  count of 0.01 degree steps and its power in whole percent. */
export type BankedDay = {
  b: Array<[number, number, number]>;
  s: [number, number, number, number];
  w: [number, number];
};

export type TrickShotBank = { version: number; days: Record<string, BankedDay> };

const bank = bankJson as unknown as TrickShotBank;

export function toBankedDay(position: TrickShotPosition): BankedDay {
  return {
    b: position.balls.map((ball) => [ball.id, ball.x, ball.y]),
    s: [
      Math.round(position.solution.angle / TRICK_SHOT_ANGLE_STEP),
      Math.round(position.solution.power * 100),
      position.solution.spinX,
      position.solution.spinY,
    ],
    w: [position.window.angleDeg, position.window.powerPct],
  };
}

export function fromBankedDay(dateKey: string, day: BankedDay, version: number): TrickShotPosition {
  const balls = day.b.map(([id, x, y]) => ({ id, x, y }));
  const difficulty: TrickShotDifficulty = gradeTrickShot(day.w[0]);
  return {
    dateKey,
    version,
    balls,
    ballCount: balls.length - 1,
    difficulty,
    solution: {
      angle: day.s[0] * TRICK_SHOT_ANGLE_STEP,
      power: day.s[1] / 100,
      spinX: day.s[2],
      spinY: day.s[3],
    },
    window: { angleDeg: day.w[0], powerPct: day.w[1] },
  };
}

const generated = new Map<string, TrickShotPosition>();

/** The full position, solution included. Server only. */
export function getTrickShotPosition(dateKey: string): TrickShotPosition {
  const banked = bank.version === TRICK_SHOT_GENERATOR_VERSION ? bank.days[dateKey] : undefined;
  if (banked) return fromBankedDay(dateKey, banked, bank.version);
  let position = generated.get(dateKey);
  if (!position) {
    position = generateTrickShotPosition(dateKey);
    generated.set(dateKey, position);
    // Keep the memory small: a day only matters near today.
    if (generated.size > 8) generated.delete(generated.keys().next().value!);
  }
  return position;
}

/** What the client is sent. */
export function getTrickShotTable(dateKey: string): TrickShotTable {
  return publicTable(getTrickShotPosition(dateKey));
}

/** The last banked day, for the verifier and the bank script. */
export function lastBankedDay(): string | null {
  const keys = Object.keys(bank.days).sort();
  return keys.length > 0 ? keys[keys.length - 1]! : null;
}

// ── The day's tries ─────────────────────────────────────────────────────
//
// One row a player a day in trick_shot_attempts, holding the day's best try
// and the count of tries; every try in trick_shot_tries. A try is armed with
// the server's clock at its first touch (armTrickShotTry) and recorded once,
// when the server has replayed it (recordTrickShotTry). Recording consumes the
// arm under a row lock, so one arm records one try, and the best, the try
// count and the tickets a try is owed are decided in the same transaction.

export type TrickShotAttemptRow = {
  id: string;
  od_user_id: string;
  user_name: string;
  puzzle_date: string;
  /** 'armed' until the first try is recorded, then 'shot'. */
  status: 'armed' | 'shot';
  started_at: string | number;
  /** When the best was first reached. */
  shot_at: string | number | null;
  angle_steps: number | null;
  power_pct: number | null;
  spin_x: number | null;
  spin_y: number | null;
  pots: number | null;
  ball_count: number | null;
  scratch: boolean | null;
  clear: boolean | null;
  score: number | null;
  near_misses: number | null;
  tries: number | null;
  best_try: number | null;
  armed_at: string | number | null;
};

export type TrickShotAttemptView = {
  id: string;
  status: 'armed' | 'shot';
  startedAt: number;
  /** Tries recorded today. */
  tries: number;
  /** The day's best try, or null before the first. */
  result: {
    pots: number;
    ballCount: number;
    scratch: boolean;
    clear: boolean;
    score: number;
    bestTry: number;
    shot: { angle: number; power: number; spinX: number; spinY: number };
  } | null;
};

/** Tries on a day row. A row shot before tries were counted took one. */
export function triesOf(row: Pick<TrickShotAttemptRow, 'status' | 'tries'>): number {
  if (row.status !== 'shot') return 0;
  return Math.max(1, Number(row.tries ?? 1));
}

export function viewAttempt(row: TrickShotAttemptRow): TrickShotAttemptView {
  const shot = row.status === 'shot';
  return {
    id: row.id,
    status: row.status,
    startedAt: Number(row.started_at),
    tries: triesOf(row),
    result: shot
      ? {
          pots: row.pots ?? 0,
          ballCount: row.ball_count ?? 0,
          scratch: Boolean(row.scratch),
          clear: Boolean(row.clear),
          score: row.score ?? 0,
          bestTry: Math.max(1, Number(row.best_try ?? 1)),
          shot: {
            angle: (row.angle_steps ?? 0) * TRICK_SHOT_ANGLE_STEP,
            power: (row.power_pct ?? 0) / 100,
            spinX: (row.spin_x ?? 0) / 100,
            spinY: (row.spin_y ?? 0) / 100,
          },
        }
      : null,
  };
}

export async function getTrickShotAttempt(userId: string, dateKey: string): Promise<TrickShotAttemptRow | null> {
  return queryOne<TrickShotAttemptRow>(
    `SELECT * FROM trick_shot_attempts WHERE od_user_id = $1 AND puzzle_date = $2 LIMIT 1`,
    [userId, dateKey],
  );
}

/** Arms the next try with the server's clock at its first touch. Makes the
 *  day's row on the first; a try already armed keeps its clock. */
export async function armTrickShotTry(
  userId: string,
  userName: string,
  dateKey: string,
  now: number,
): Promise<TrickShotAttemptRow> {
  const row = await queryOne<TrickShotAttemptRow>(
    `INSERT INTO trick_shot_attempts (id, od_user_id, user_name, puzzle_date, status, started_at, armed_at, tries, created_at)
     VALUES ($1, $2, $3, $4, 'armed', $5, $5, 0, $5)
     ON CONFLICT (od_user_id, puzzle_date)
       DO UPDATE SET armed_at = COALESCE(trick_shot_attempts.armed_at, EXCLUDED.armed_at)
     RETURNING *`,
    [crypto.randomUUID(), userId, userName, dateKey, now],
  );
  if (!row) throw new Error('trick shot: the day row vanished');
  return row;
}

export type TrickShotTryFields = {
  angleSteps: number;
  powerPct: number;
  spinX: number;
  spinY: number;
  pots: number;
  ballCount: number;
  scratch: boolean;
  clear: boolean;
  score: number;
  nearMisses: number;
  userName: string;
};

export type RecordedTrickShotTry =
  | { kind: 'missing' }
  /** No try armed: a repeated or concurrent post of a try already in. */
  | { kind: 'unarmed' }
  | {
      kind: 'recorded';
      tryNumber: number;
      armedAt: number;
      /** This try is the day's new best. */
      improved: boolean;
      /** The day's best score before this try, null on the first. */
      previousBest: number | null;
      /** Tickets this try is owed, before the daily cap (rules.ts). */
      ticketsDue: number;
      row: TrickShotAttemptRow;
    };

/**
 * Records one replayed try on the day's row. In one transaction, with the
 * row locked: the arm is consumed, the try is numbered, it replaces the best
 * if it beats it, and the tickets it is owed are fixed against the best
 * before it. Two posts racing for one arm record one try.
 */
export async function recordTrickShotTry(
  attemptId: string,
  userId: string,
  fields: TrickShotTryFields,
  now: number,
): Promise<RecordedTrickShotTry> {
  return withTransaction<RecordedTrickShotTry>(async (client) => {
    const locked = await client.query<TrickShotAttemptRow>(
      `SELECT * FROM trick_shot_attempts WHERE id = $1 AND od_user_id = $2 FOR UPDATE`,
      [attemptId, userId],
    );
    const row = locked.rows[0];
    if (!row) return { kind: 'missing' };
    if (row.armed_at === null || row.armed_at === undefined) return { kind: 'unarmed' };

    const hadBest = row.status === 'shot';
    const tryNumber = triesOf(row) + 1;
    const previousBest = hadBest ? Number(row.score ?? 0) : null;
    const improved = isBetterTrickShotTry(
      { pots: fields.pots, score: fields.score },
      hadBest ? { pots: Number(row.pots ?? 0), score: Number(row.score ?? 0) } : null,
    );
    const ticketsDue = improved ? trickShotTryTickets(fields.score, previousBest) : 0;
    const spinX = Math.round(fields.spinX * 100);
    const spinY = Math.round(fields.spinY * 100);

    await client.query(
      `INSERT INTO trick_shot_tries (id, attempt_id, od_user_id, puzzle_date, try_number, armed_at, shot_at,
         angle_steps, power_pct, spin_x, spin_y, pots, ball_count, scratch, clear, score, near_misses, improved, tickets_due)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [
        crypto.randomUUID(),
        row.id,
        userId,
        row.puzzle_date,
        tryNumber,
        row.armed_at,
        now,
        fields.angleSteps,
        fields.powerPct,
        spinX,
        spinY,
        fields.pots,
        fields.ballCount,
        fields.scratch,
        fields.clear,
        fields.score,
        fields.nearMisses,
        improved,
        ticketsDue,
      ],
    );

    const updated = improved
      ? await client.query<TrickShotAttemptRow>(
          `UPDATE trick_shot_attempts
              SET status = 'shot', tries = $3, armed_at = NULL, best_try = $3, shot_at = $4,
                  angle_steps = $5, power_pct = $6, spin_x = $7, spin_y = $8, pots = $9, ball_count = $10,
                  scratch = $11, clear = $12, score = $13, near_misses = $14, user_name = $15
            WHERE id = $1 AND od_user_id = $2
            RETURNING *`,
          [
            row.id,
            userId,
            tryNumber,
            now,
            fields.angleSteps,
            fields.powerPct,
            spinX,
            spinY,
            fields.pots,
            fields.ballCount,
            fields.scratch,
            fields.clear,
            fields.score,
            fields.nearMisses,
            fields.userName,
          ],
        )
      : await client.query<TrickShotAttemptRow>(
          `UPDATE trick_shot_attempts
              SET tries = $3, armed_at = NULL, best_try = COALESCE(best_try, 1), user_name = $4
            WHERE id = $1 AND od_user_id = $2
            RETURNING *`,
          [row.id, userId, tryNumber, fields.userName],
        );

    return {
      kind: 'recorded',
      tryNumber,
      armedAt: Number(row.armed_at),
      improved,
      previousBest,
      ticketsDue,
      row: updated.rows[0]!,
    };
  });
}

/** Where a try's tickets are keyed in the ledger: the day for its first
 *  payment (the key the single shot used), the day and the new best's score
 *  for each improvement. A best is reached once a day, so each key pays once. */
export function trickShotRewardSourceId(dateKey: string, previousBest: number | null, score: number): string {
  return previousBest === null ? `trick-shot:${dateKey}` : `trick-shot:${dateKey}:${score}`;
}

/** The player's best day before `beforeDate`, for the new-best moment. */
export async function getTrickShotBest(userId: string, beforeDate: string): Promise<number> {
  const row = await queryOne<{ best: number | null }>(
    `SELECT MAX(score)::int AS best FROM trick_shot_attempts
      WHERE od_user_id = $1 AND status = 'shot' AND puzzle_date < $2`,
    [userId, beforeDate],
  );
  return row?.best ?? 0;
}

/** Days cleared, all time, for the achievement series. */
export async function countTrickShotClears(userId: string): Promise<number> {
  const row = await queryOne<{ clears: number }>(
    `SELECT COUNT(*)::int AS clears FROM trick_shot_attempts
      WHERE od_user_id = $1 AND status = 'shot' AND clear = TRUE`,
    [userId],
  );
  return row?.clears ?? 0;
}

/** How far back a streak is read. */
const STREAK_WINDOW_DAYS = 400;

/** The player's streak of cleared days, as of `today` (rules.ts). */
export async function getTrickShotStreak(userId: string, today: string): Promise<number> {
  const streaks = await getTrickShotStreaks([userId], today);
  return streaks.get(userId) ?? 0;
}

/** Streaks for many players at once, for the boards. */
export async function getTrickShotStreaks(userIds: string[], today: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (userIds.length === 0) return out;
  const rows = (
    await query<{ od_user_id: string; puzzle_date: string }>(
      `SELECT od_user_id, puzzle_date FROM trick_shot_attempts
        WHERE od_user_id = ANY($1::text[]) AND clear AND status = 'shot'
          AND puzzle_date > $2 AND puzzle_date <= $3`,
      [userIds, shiftTrickShotDateKey(today, -STREAK_WINDOW_DAYS), today],
    )
  ).rows;
  const days = new Map<string, string[]>();
  for (const row of rows) {
    const list = days.get(row.od_user_id) ?? [];
    list.push(row.puzzle_date);
    days.set(row.od_user_id, list);
  }
  for (const userId of userIds) out.set(userId, trickShotStreak(days.get(userId) ?? [], today));
  return out;
}
