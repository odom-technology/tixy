import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { consumeReadRateLimit, tooManyAttemptsResponse } from '@/server/auth/auth-rate-limit';
import { armTrickShotTry, viewAttempt } from '@/server/arcade/trick-shot';
import { isTrickShotDateKey, trickShotDateKey } from '@/features/arcade/lib/trick-shot/rules';
import { ensureNotGameBanned } from '../../_shared/ban-helpers';

export const dynamic = 'force-dynamic';

/** A try takes a few seconds at the quickest (aim, pull back, the balls
 *  roll, rematch); 40 arms a minute is above any hand. */
const LIMIT = 40;
const WINDOW_MS = 60_000;

/**
 * Arms the next try at today's table: the server's clock at the try's
 * first touch. The day's row is made on the first; a try already armed
 * keeps its clock, so a repeated call changes nothing. The shot route
 * consumes the arm when it records the try. Guests practise and never arm.
 */
export async function POST(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Sign in to keep your tries.' }, { status: 401 });
  }
  const limited = consumeReadRateLimit(`trick-shot-start:${identity.userId}`, LIMIT, WINDOW_MS);
  if (limited.limited) return tooManyAttemptsResponse(limited.retryAfterSeconds);
  const banned = await ensureNotGameBanned(identity.userId);
  if (banned) return banned;

  const body = (await request.json().catch(() => null)) as { dateKey?: unknown } | null;
  const today = trickShotDateKey();
  if (!isTrickShotDateKey(body?.dateKey) || body.dateKey !== today) {
    return NextResponse.json({ error: "That table has closed. Today's is up." }, { status: 409 });
  }

  try {
    const row = await armTrickShotTry(identity.userId, identity.name || 'Player', today, Date.now());
    return NextResponse.json({ attempt: viewAttempt(row) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Failed to arm the trick shot:', error);
    return NextResponse.json({ error: 'The try could not be set up.' }, { status: 500 });
  }
}
