import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { forfeitMatch } from '@/server/arcade/pool-match';

export const dynamic = 'force-dynamic';

/** POST — Forfeit a match. */
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

  try {
    const { match, eloChange } = await forfeitMatch(matchId, identity.userId);

    // Tournament bracket progression
    if (match.tournamentMatchId) {
      try {
        const { onPoolMatchCompleted } = await import('@/server/arcade/pool-tournament');
        await onPoolMatchCompleted(matchId);
      } catch { /* tournament progression error should not fail the forfeit */ }
    }

    return NextResponse.json({ match, eloChange: eloChange ?? undefined });
  } catch (error) {
    const message = (error as Error).message ?? '';
    // Only the known refusals keep their message and status. Anything else
    // (the settle transaction failed twice, the database is down) is a real
    // error: nothing was saved, and the player can try again.
    if (message.includes('not found')) return NextResponse.json({ error: message }, { status: 404 });
    if (message.includes('not in progress') || message.includes('Use cancel')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    if (message.includes('Not a player')) return NextResponse.json({ error: message }, { status: 403 });
    console.error(`8-ball forfeit failed on match ${matchId}`, error);
    return NextResponse.json({ error: 'The forfeit could not be saved. Try again.' }, { status: 500 });
  }
}
