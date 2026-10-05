import { NextResponse } from 'next/server';

import { ensureDerbySweeper, getDerbySnapshot } from '@/server/arcade/derby-race/service';
import { requireIdentity } from '@/server/auth';
import { consumeReadRateLimit, tooManyAttemptsResponse } from '@/server/auth/auth-rate-limit';
import { isGuestIdentity } from '@/server/auth/guest';

import { noStore } from '../../_derby-route';

export const dynamic = 'force-dynamic';

/** GET ?since=tick: the race and the aim batches past that tick, for a phone to draw it (and rejoin it). Anyone signed in may watch. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  ensureDerbySweeper();
  const { id } = await params;
  const identity = await requireIdentity({ allowExternal: true, allowGuest: true }).catch(() => null);
  const viewer = identity && !isGuestIdentity(identity) ? identity.userId : null;
  const limited = consumeReadRateLimit(`derby-snapshot:${viewer ?? 'anon'}:${id}`, 90, 60_000);
  if (limited.limited) return tooManyAttemptsResponse(limited.retryAfterSeconds);
  const since = Number(new URL(request.url).searchParams.get('since') ?? 0);
  const snapshot = await getDerbySnapshot(id, viewer, Number.isFinite(since) ? since : 0);
  if (!snapshot) return NextResponse.json({ error: 'That race is gone.' }, { status: 404, headers: noStore });
  return NextResponse.json(snapshot, { headers: noStore });
}
