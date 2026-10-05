import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { getMatch, sendTurnReminder } from '@/server/arcade/pool-match';

export const dynamic = 'force-dynamic';

/** POST — Send a turn reminder to the opponent. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const { id: matchId } = await params;

  // Only players in the match can send reminders
  const match = await getMatch(matchId);
  if (!match) {
    return NextResponse.json({ error: 'Match not found.' }, { status: 404 });
  }
  if (match.player1Id !== identity.userId && match.player2Id !== identity.userId) {
    return NextResponse.json({ error: 'Not a player in this match.' }, { status: 403 });
  }

  const result = await sendTurnReminder(matchId, identity.userId);

  if (!result.sent) {
    const retryAfterSec =
      typeof result.retryAfterMs === 'number'
        ? Math.max(1, Math.ceil(result.retryAfterMs / 1000))
        : undefined;
    const response = NextResponse.json(
      {
        error: result.reason,
        retryAfterSec,
      },
      { status: 429 },
    );
    if (retryAfterSec) {
      response.headers.set('Retry-After', String(retryAfterSec));
    }
    return response;
  }

  return NextResponse.json({ sent: true });
}
