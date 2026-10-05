import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import {
  getMatchesForUser,
  getOpenMatches,
  getActiveSpectatableMatches,
  maybeRunConnectFourDataRetentionCleanup,
  resumeOrphanedBotTurns,
} from '@/server/arcade/connect-four-match';

export const dynamic = 'force-dynamic';

export async function GET() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  try {
    await maybeRunConnectFourDataRetentionCleanup();
    // Recover any bot turns that were dropped by a crash / dev-server restart.
    // Throttled internally so routine polls don't thrash the DB. (Connect Four
    // is UNTIMED, so there is no flag-fall watchdog like chess.)
    await resumeOrphanedBotTurns();

    const myMatches = await getMatchesForUser(identity.userId);
    const openMatches = await getOpenMatches(identity.userId);
    const liveMatches = (await getActiveSpectatableMatches())
      .filter((m) => m.player1Id !== identity.userId && m.player2Id !== identity.userId);

    return NextResponse.json({ userId: identity.userId, myMatches, openMatches, liveMatches });
  } catch (error) {
    console.error('Failed to list connect-four matches:', error);
    return NextResponse.json({ error: 'Failed to load matches.' }, { status: 500 });
  }
}
