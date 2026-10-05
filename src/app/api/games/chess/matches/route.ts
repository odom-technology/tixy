import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import {
  getMatchesForUser,
  getOpenMatches,
  getActiveSpectatableMatches,
  maybeRunChessDataRetentionCleanup,
  processTimedOutMatches,
  resumeOrphanedBotTurns,
} from '@/server/arcade/chess-match';

export const dynamic = 'force-dynamic';

export async function GET() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  try {
    await maybeRunChessDataRetentionCleanup();
    // Opportunistic timeout watchdog — ensures flag-falls apply even on idle matches.
    await processTimedOutMatches();
    // Recover any bot turns that were dropped by a crash / dev-server
    // restart. Throttled internally so routine polls don't thrash the DB.
    await resumeOrphanedBotTurns();

    const myMatches = await getMatchesForUser(identity.userId);
    const openMatches = await getOpenMatches(identity.userId);
    const liveMatches = (await getActiveSpectatableMatches())
      .filter((m) => m.player1Id !== identity.userId && m.player2Id !== identity.userId);

    return NextResponse.json({ userId: identity.userId, myMatches, openMatches, liveMatches });
  } catch (error) {
    console.error('Failed to list chess matches:', error);
    return NextResponse.json({ error: 'Failed to load matches.' }, { status: 500 });
  }
}
