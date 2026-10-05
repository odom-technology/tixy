import { checkNewGameAvailability } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';

import { getOrCreateRouteIdentity } from '@/server/auth/route-identity';
import { getGameBanStatus } from '@/server/arcade/game-bans';
import { DerbyBetError, placeDerbyBet } from '@/server/arcade/derby/bets';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Per-user rate limit: 5 bets / second, in-memory (single long-lived process).
// ---------------------------------------------------------------------------
const RATE_LIMIT = 5;
// Freshly minted guest ids would bypass a per-user limit, so anonymous bursts
// are also throttled per source IP (higher ceiling: NATs share IPs).
const IP_RATE_LIMIT = 20;
const RATE_WINDOW_MS = 1_000;
const SWEEP_INTERVAL_MS = 60_000;

declare global {

  var __derbyBetRate__: Map<string, number[]> | undefined;

  var __derbyBetRateSweepAt__: number | undefined;
}
const rateBuckets: Map<string, number[]> = (globalThis.__derbyBetRate__ ??=
  new Map<string, number[]>());

function sweepBuckets(now: number) {
  const last = globalThis.__derbyBetRateSweepAt__ ?? 0;
  if (now - last < SWEEP_INTERVAL_MS) return;
  globalThis.__derbyBetRateSweepAt__ = now;
  const cutoff = now - RATE_WINDOW_MS;
  for (const [key, stamps] of rateBuckets) {
    if (!stamps.some((ts) => ts > cutoff)) rateBuckets.delete(key);
  }
}

function isRateLimited(key: string, limit: number, now = Date.now()): boolean {
  sweepBuckets(now);
  const cutoff = now - RATE_WINDOW_MS;
  const recent = (rateBuckets.get(key) ?? []).filter((ts) => ts > cutoff);
  if (recent.length >= limit) {
    rateBuckets.set(key, recent);
    return true;
  }
  recent.push(now);
  rateBuckets.set(key, recent);
  return false;
}

function clientIpOf(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  return (fwd?.split(',')[0] ?? request.headers.get('x-real-ip') ?? 'local').trim();
}

type BetPayload = { roundId?: string; horseIdx?: number; amount?: number };

export async function POST(request: Request) {
  const unavailable = await checkNewGameAvailability('derby');
  if (unavailable) return unavailable;

  const { identity, attachCookie } = await getOrCreateRouteIdentity();

  const banStatus = await getGameBanStatus(identity.userId);
  if (banStatus.isBanned) {
    return NextResponse.json(
      { error: 'You are currently banned from games.' },
      { status: 403 },
    );
  }

  if (
    isRateLimited(`u:${identity.userId}`, RATE_LIMIT) ||
    isRateLimited(`ip:${clientIpOf(request)}`, IP_RATE_LIMIT)
  ) {
    return NextResponse.json(
      { error: 'Slow down — too many bets.' },
      { status: 429 },
    );
  }

  let payload: BetPayload;
  try {
    payload = (await request.json()) as BetPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const { roundId, horseIdx, amount } = payload;
  if (typeof roundId !== 'string' || !roundId) {
    return NextResponse.json({ error: 'roundId is required.' }, { status: 400 });
  }
  if (typeof horseIdx !== 'number' || typeof amount !== 'number') {
    return NextResponse.json(
      { error: 'horseIdx and amount are required.' },
      { status: 400 },
    );
  }

  try {
    const result = await placeDerbyBet({
      userId: identity.userId,
      userName: identity.name ?? null,
      roundId,
      horseIdx,
      amount,
    });
    const response = NextResponse.json({
      ok: true,
      betId: result.betId,
      horseIdx: result.horseIdx,
      amount: result.amount,
      multiplier: result.multiplier,
      balanceAfter: result.balanceAfter,
      betTotals: result.betTotals,
      betCounts: result.betCounts,
    });
    attachCookie(response);
    return response;
  } catch (error) {
    if (error instanceof DerbyBetError) {
      const response = NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
      attachCookie(response);
      return response;
    }
    const message = error instanceof Error ? error.message : 'Bet failed.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
