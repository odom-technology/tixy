/**
 * Guest practice for 8-ball: a signed-out player can play the house bot.
 *
 * The flag is POOL_GUEST_PRACTICE. "true" turns it on, "false" turns it off.
 * Unset, it is on in development and off in production (NODE_ENV), so the
 * production deploy stays sign-in only until someone sets it in `.env`.
 *
 * What a guest gets, and nothing more:
 * - POST /api/games/8-ball/match/bot creates a bot match for the guest
 *   identity (cookie `arcade_guest`, server/auth/guest.ts).
 * - GET /api/games/8-ball/match/[id], POST …/shot and POST …/bot-turn accept
 *   the guest only for that guest's own bot match (`isGuestBotMatchFor`).
 *   Every other match is answered as if the guest were signed out (401).
 * - No rating, no tickets, no stats, no bot speed-run record, no play-time
 *   metric. The shot route skips each of those for a guest match.
 * - A guest has one bot match at a time: starting another deletes the old
 *   one. Guest matches are deleted 2 hours after they finish and 24 hours
 *   after they start (`cleanupGuestPoolMatches`).
 * - Per IP, a guest can start 20 matches in 10 minutes and take 120 shots
 *   and bot turns a minute (`guestRateLimit`). Guests write no anti-cheat
 *   rows.
 *
 * Online play, challenges, the queue and ranked stay sign-in only.
 */
import type { NextResponse } from 'next/server';

import {
  consumeReadRateLimit,
  getClientIp,
  tooManyAttemptsResponse,
} from '@/server/auth/auth-rate-limit';
import { isGuestUserId } from '@/server/auth/guest';
import { query } from '@/server/db/client';
import type { PoolMatch } from '@/server/arcade/pool-match';

export const POOL_GUEST_PRACTICE_ENV = 'POOL_GUEST_PRACTICE';

const GUEST_FINISHED_TTL_MS = 2 * 60 * 60 * 1000;
const GUEST_ANY_TTL_MS = 24 * 60 * 60 * 1000;
const GUEST_SWEEP_MIN_INTERVAL_MS = 5 * 60 * 1000;
const GUEST_SWEEP_BATCH = 500;
/** A sweep stops after this many batches and picks up on the next run. */
const GUEST_SWEEP_MAX_BATCHES = 40;

/* Per-IP limits for guests. A cookie can be thrown away, an address can't,
   and every guest shot runs the physics and often the bot. A match is 20
   to 60 shots and bot turns. */
const GUEST_LIMITS = {
  /** New practice matches. */
  match: { limit: 20, windowMs: 10 * 60 * 1000 },
  /** Shots and bot turns together. */
  turn: { limit: 120, windowMs: 60 * 1000 },
} as const;

/** 429 when this address has used up its guest allowance, else null. */
export function guestRateLimit(request: Request, kind: keyof typeof GUEST_LIMITS): NextResponse | null {
  const { limit, windowMs } = GUEST_LIMITS[kind];
  const result = consumeReadRateLimit(`pool-guest-${kind}:${getClientIp(request)}`, limit, windowMs);
  return result.limited ? tooManyAttemptsResponse(result.retryAfterSeconds) : null;
}

export function isPoolGuestPracticeEnabled(): boolean {
  const raw = process.env[POOL_GUEST_PRACTICE_ENV]?.trim().toLowerCase();
  if (raw === 'true' || raw === '1' || raw === 'on') return true;
  if (raw === 'false' || raw === '0' || raw === 'off') return false;
  return process.env.NODE_ENV !== 'production';
}

/** A guest's practice match: the guest is player 1 and the house bot is player 2. */
export function isGuestBotMatch(match: Pick<PoolMatch, 'player1Id' | 'player2Id'>): boolean {
  return isGuestUserId(match.player1Id) && Boolean(match.player2Id?.startsWith('bot:'));
}

/** True only when `userId` is the guest who owns this guest bot match. */
export function isGuestBotMatchFor(
  match: Pick<PoolMatch, 'player1Id' | 'player2Id'>,
  userId: string,
): boolean {
  return isGuestBotMatch(match) && match.player1Id === userId;
}

const deletePoolMatchRows = async (matchIds: string[]) => {
  if (matchIds.length === 0) return 0;
  await query('DELETE FROM pool_moves WHERE match_id = ANY($1)', [matchIds]);
  await query('DELETE FROM pool_match_chat WHERE match_id = ANY($1)', [matchIds]);
  const result = await query('DELETE FROM pool_matches WHERE id = ANY($1)', [matchIds]);
  return result.rowCount ?? 0;
};

/** Delete every match this guest has, before they start a new one. */
export async function deleteGuestPoolMatches(guestUserId: string): Promise<number> {
  if (!isGuestUserId(guestUserId)) return 0;
  const rows = await query<{ id: string }>(
    `SELECT id FROM pool_matches WHERE player1_id = $1 AND player2_id LIKE 'bot:%'`,
    [guestUserId],
  );
  return deletePoolMatchRows(rows.rows.map((row) => row.id));
}

let lastGuestSweepAt = 0;

/** Delete old guest matches, batch after batch until none are left. Cheap
 *  to call often; it runs at most every 5 minutes. */
export async function cleanupGuestPoolMatches(now = Date.now()): Promise<number> {
  if (now - lastGuestSweepAt < GUEST_SWEEP_MIN_INTERVAL_MS) return 0;
  lastGuestSweepAt = now;
  let deleted = 0;
  try {
    for (let batch = 0; batch < GUEST_SWEEP_MAX_BATCHES; batch++) {
      const rows = await query<{ id: string }>(
        `SELECT id FROM pool_matches
         WHERE player1_id LIKE 'guest:%'
           AND player2_id LIKE 'bot:%'
           AND (
             created_at < $1
             OR (status IN ('completed', 'forfeited') AND COALESCE(completed_at, updated_at) < $2)
           )
         LIMIT $3`,
        [now - GUEST_ANY_TTL_MS, now - GUEST_FINISHED_TTL_MS, GUEST_SWEEP_BATCH],
      );
      if (rows.rows.length === 0) break;
      deleted += await deletePoolMatchRows(rows.rows.map((row) => row.id));
      if (rows.rows.length < GUEST_SWEEP_BATCH) break;
    }
  } catch (error) {
    console.error('Guest pool match cleanup failed', error);
  }
  return deleted;
}
