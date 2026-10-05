import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { consumeReadRateLimit, getClientIp, tooManyAttemptsResponse } from '@/server/auth/auth-rate-limit';
import { isGuestIdentity } from '@/server/auth/guest';
import { getTixyHomeLive } from '@/server/arcade/tixy-home';

export const dynamic = 'force-dynamic';

/* The page refreshes every 30 s while visible, and at most every 5 s on a
   notification. 20 a minute leaves room for a few tabs. */
const LIMIT = 20;
const WINDOW_MS = 60_000;

/* The tixy home's live parts: who is waiting for you, whose move it is,
   friends on now, and tables open. Signed-out players get the tables only,
   which come from a 20 s in-memory cache. */
export async function GET(request: Request) {
  let userId: string | null = null;
  try {
    const identity = await requireIdentity({ allowExternal: true, allowGuest: true });
    userId = isGuestIdentity(identity) ? null : identity.userId;
  } catch {
    userId = null;
  }
  const limited = consumeReadRateLimit(`home-live:${userId ?? getClientIp(request)}`, LIMIT, WINDOW_MS);
  if (limited.limited) return tooManyAttemptsResponse(limited.retryAfterSeconds);
  const live = await getTixyHomeLive(userId);
  return NextResponse.json(live, {
    headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' },
  });
}
