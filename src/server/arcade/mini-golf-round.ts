/**
 * Mini golf rounds on the server: replaying a posted hole, the round's
 * score and what it pays. Pure; the routes in app/api/games/mini-golf do
 * the I/O. MINI_GOLF.md, "Server".
 *
 * A round is the day's course (mini-golf-course.ts, from the UTC date the
 * round started on). Holes are posted one at a time as they finish: the
 * putts (t, dx, dy, power) of that hole only. The server replays them
 * through the shared engine from the tee; the client's own count of
 * strokes has to match the replay, or the hole is rejected and logged.
 */

import {
  MG_HOLES,
  MG_MAX_STROKES,
  MG_PICKUP_SCORE,
  mgHolePoints,
  mgReplayHole,
  mgSimulatePutt,
  type MgHoleResult,
  type MgPutt,
} from './mini-golf-engine';
import { mgCourseFor, type MgCourse } from './mini-golf-course';

/** Tickets: 75 x (1 - exp(-(s / divisor)^1.15)), where s is the round's
 *  points over MG_REWARD_BASE. A hole's points are 7 minus its score, so a
 *  round of nine fours is 27 points and pays nothing; each stroke saved on
 *  that is a point. Fitted in scripts/verify-mini-golf-replay.ts. */
export const MG_REWARD_BASE = 27;
export const MG_REWARD_DIVISOR = 11;

/** The longest a round may stay open after it starts, ms. */
export const MG_ROUND_OPEN_MS = 6 * 60 * 60 * 1000;
/** Slack on the server clock against the putts' own timeline, ms. */
export const MG_CLOCK_SLACK_MS = 3_000;

const courses = new Map<string, MgCourse>();

/** The course for a date, built once per process (a handful of days). */
export function mgCourseCached(dateKey: string): MgCourse {
  let course = courses.get(dateKey);
  if (!course) {
    course = mgCourseFor(dateKey);
    courses.set(dateKey, course);
    if (courses.size > 8) courses.delete(courses.keys().next().value as string);
  }
  return course;
}

/** Round points for tickets and achievements: the sum of every hole's. */
export function mgRoundPoints(scores: readonly number[]): number {
  return scores.reduce((sum, s) => sum + mgHolePoints(s), 0);
}

/** What a round's points are worth before the caps (the wallet applies the
 *  same curve; this copy is for the verifier and the PR). */
export function mgRoundTickets(points: number): number {
  const s = Math.max(0, points - MG_REWARD_BASE) / MG_REWARD_DIVISOR;
  // Floored, as the wallet does.
  return Math.floor(75 * (1 - Math.exp(-Math.pow(s, 1.15))));
}

/** Normalise posted putts: numbers only, at most the stroke limit. */
export function mgParsePutts(raw: unknown): MgPutt[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MG_MAX_STROKES) return null;
  const putts: MgPutt[] = [];
  for (const entry of raw) {
    const e = entry as Record<string, unknown> | null;
    const t = Number(e?.t);
    const dx = Number(e?.dx);
    const dy = Number(e?.dy);
    const power = Number(e?.power);
    if (![t, dx, dy, power].every(Number.isFinite)) return null;
    putts.push({ t, dx, dy, power });
  }
  return putts;
}

export type MgHoleCheck =
  | { ok: true; result: MgHoleResult; finished: boolean; strikeMs: number; playMs: number }
  | { ok: false; reason: string };

/**
 * Replay the putts of one hole so far. `claim` is what the client says
 * happened: still playing (null), or finished with that score. The replay
 * decides; a claim that differs is rejected. `strikeMs` is the last putt's
 * time on the hole clock, `playMs` that plus its roll: the least time the
 * hole has taken so far, and once finished, in all.
 */
export function mgCheckHole(
  course: MgCourse,
  holeIndex: number,
  putts: readonly MgPutt[],
  claim: number | null,
): MgHoleCheck {
  if (!Number.isInteger(holeIndex) || holeIndex < 0 || holeIndex >= MG_HOLES) {
    return { ok: false, reason: `Bad hole index ${holeIndex}` };
  }
  const hole = course.holes[holeIndex].hole;
  const result = mgReplayHole(hole, putts);
  if (result.stop === 'bounds') return { ok: false, reason: `Bad putt timeline on hole ${holeIndex + 1}` };
  const finished = result.stop === 'holed' || result.stop === 'pickup';
  if (finished !== (claim !== null)) {
    return {
      ok: false,
      reason: `Hole ${holeIndex + 1} ${finished ? 'finished' : 'not finished'} on the server, the client says ${claim === null ? 'not finished' : `finished in ${claim}`}`,
    };
  }
  if (finished && claim !== result.score) {
    return { ok: false, reason: `Score mismatch on hole ${holeIndex + 1} (server=${result.score}, client=${claim})` };
  }
  const last = putts[putts.length - 1];
  const from = result.rests.length > 1 ? result.rests[result.rests.length - 2] : hole.tee;
  const roll = mgSimulatePutt(hole, from, last.dx, last.dy, last.power, last.t);
  return { ok: true, result, finished, strikeMs: last.t, playMs: last.t + (roll?.durationMs ?? 0) };
}

/** True when `prefix` is the start of `putts`, field for field. */
export function mgSamePutts(prefix: readonly MgPutt[], putts: readonly MgPutt[]): boolean {
  if (prefix.length > putts.length) return false;
  return prefix.every(
    (p, i) => p.t === putts[i].t && p.dx === putts[i].dx && p.dy === putts[i].dy && p.power === putts[i].power,
  );
}

/** A stored hole's putts, parsed back. */
export function mgParseStoredPutts(json: string | null | undefined): MgPutt[] {
  try {
    const parsed = JSON.parse(json ?? '[]') as unknown;
    return mgParsePutts(parsed) ?? [];
  } catch {
    return [];
  }
}

/** A stored round's holes, parsed back. */
export type MgStoredHole = { putts: MgPutt[]; score: number; playMs: number };

export function mgParseStoredHoles(json: string | null | undefined): MgStoredHole[] {
  try {
    const parsed = JSON.parse(json ?? '[]') as unknown;
    return Array.isArray(parsed) ? (parsed as MgStoredHole[]) : [];
  } catch {
    return [];
  }
}

export { MG_HOLES, MG_PICKUP_SCORE };
