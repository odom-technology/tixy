/* Shared by derby's race routes: an account (guests race bots on their own
   device), the ban check, the floor switch and a per-route rate limit like
   trick shot's. */
import { NextResponse } from 'next/server';

import { checkNewGameAvailability } from '@/server/arcade/game-availability';
import { ensureDerbySweeper, type DerbyUser } from '@/server/arcade/derby-race/service';
import { requireIdentity } from '@/server/auth';
import { consumeReadRateLimit, tooManyAttemptsResponse } from '@/server/auth/auth-rate-limit';
import { isGuestIdentity } from '@/server/auth/guest';

import { ensureNotGameBanned } from '../_shared/ban-helpers';

export const noStore = { 'Cache-Control': 'no-store' };

export async function derbyUser(
  route: string,
  limit: { count: number; windowMs: number },
  options: { newRace?: boolean } = {},
): Promise<{ user: DerbyUser } | { response: Response }> {
  ensureDerbySweeper();
  if (options.newRace) {
    const unavailable = await checkNewGameAvailability('derby');
    if (unavailable) return { response: unavailable };
  }
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return { response: NextResponse.json({ error: 'Sign in to race.' }, { status: 401, headers: noStore }) };
  }
  if (isGuestIdentity(identity)) {
    return { response: NextResponse.json({ error: 'Sign in to race.' }, { status: 401, headers: noStore }) };
  }
  const limited = consumeReadRateLimit(`derby-${route}:${identity.userId}`, limit.count, limit.windowMs);
  if (limited.limited) return { response: tooManyAttemptsResponse(limited.retryAfterSeconds) };
  const banned = await ensureNotGameBanned(identity.userId);
  if (banned) return { response: banned };
  return { user: { userId: identity.userId, userName: identity.name || 'Player' } };
}

export async function readJson<T>(request: Request): Promise<Partial<T>> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === 'object' ? (body as Partial<T>) : {};
  } catch {
    return {};
  }
}
