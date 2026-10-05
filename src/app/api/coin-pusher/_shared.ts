// Shared plumbing for the coin pusher routes: identity, bans, availability
// and the per-player rate limits (in memory, like the derby bet route; the
// server is one long-lived process).
import { NextResponse } from 'next/server';

import { checkNewGameAvailability } from '@/server/arcade/game-availability';
import { getGameBanStatus } from '@/server/arcade/game-bans';
import { CoinPusherError } from '@/server/arcade/coin-pusher';
import { requireIdentity } from '@/server/auth';
import { isGuestUserId } from '@/server/auth/guest';
import { addAntiCheatLog } from '@/server/arcade/anti-cheat-logs';

declare global {
  var __coinPusherRate__: Map<string, number[]> | undefined;
  var __coinPusherRateSweepAt__: number | undefined;
}
const buckets: Map<string, number[]> = (globalThis.__coinPusherRate__ ??= new Map<string, number[]>());

/** Requests a player may make in a window, per route. A pour is one drop. */
export const COIN_PUSHER_LIMITS = {
  drop: { limit: 8, windowMs: 1_000 },
  collect: { limit: 6, windowMs: 1_000 },
  machine: { limit: 20, windowMs: 10_000 },
} as const;

function limited(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const last = globalThis.__coinPusherRateSweepAt__ ?? 0;
  if (now - last > 60_000) {
    globalThis.__coinPusherRateSweepAt__ = now;
    for (const [k, stamps] of buckets) if (!stamps.some((t) => t > now - 60_000)) buckets.delete(k);
  }
  const recent = (buckets.get(key) ?? []).filter((t) => t > now - windowMs);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return true;
  }
  recent.push(now);
  buckets.set(key, recent);
  return false;
}

type Gate = { userId: string; userName: string } | { response: Response };

/** Who is asking, and whether they may. Guests play the practice machine. */
export async function coinPusherGate(route: keyof typeof COIN_PUSHER_LIMITS): Promise<Gate> {
  const unavailable = await checkNewGameAvailability('arcade-coin-pusher');
  if (unavailable) return { response: unavailable };
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true, allowGuest: true });
  } catch {
    return { response: NextResponse.json({ error: 'Sign in to play for tickets.' }, { status: 401 }) };
  }
  if (isGuestUserId(identity.userId)) {
    return { response: NextResponse.json({ error: 'Sign in to play for tickets.' }, { status: 401 }) };
  }
  const ban = await getGameBanStatus(identity.userId);
  if (ban.isBanned) {
    return { response: NextResponse.json({ error: 'You are currently banned from games.' }, { status: 403 }) };
  }
  const { limit, windowMs } = COIN_PUSHER_LIMITS[route];
  if (limited(`${route}:${identity.userId}`, limit, windowMs)) {
    void addAntiCheatLog({
      ts: Date.now(),
      gameType: 'arcade-coin-pusher',
      userId: identity.userId,
      score: 0,
      result: 'flag',
      reason: `${route}: over ${limit} requests in ${windowMs} ms`,
      stage: 'coin-pusher',
      checks: [],
    });
    return { response: NextResponse.json({ error: 'Slow down, the chute needs a moment.' }, { status: 429 }) };
  }
  return { userId: identity.userId, userName: identity.name || 'Anonymous' };
}

export function coinPusherError(error: unknown): Response {
  if (error instanceof CoinPusherError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error('[coin-pusher]', error);
  return NextResponse.json({ error: 'The machine jammed. Try again.' }, { status: 500 });
}
