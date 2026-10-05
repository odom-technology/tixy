import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import {
  getMatchesForUser,
  getOpenMatches,
  getActiveSpectatableMatches,
  maybeRunPoolDataRetentionCleanup,
} from '@/server/arcade/pool-match';

export const dynamic = 'force-dynamic';

/** GET — List the user's matches and open matches they can join. */
export async function GET() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  try {
    await maybeRunPoolDataRetentionCleanup();
    const myMatches = await getMatchesForUser(identity.userId);
    const openMatches = await getOpenMatches(identity.userId);
    const liveMatches = (await getActiveSpectatableMatches())
      // Exclude matches the user is already a player in
      .filter((m) => m.player1Id !== identity.userId && m.player2Id !== identity.userId);

    return NextResponse.json({
      userId: identity.userId,
      myMatches,
      openMatches,
      liveMatches,
    });
  } catch (error) {
    console.error('Failed to list 8-ball matches:', error);
    return NextResponse.json({ error: 'Failed to load matches.' }, { status: 500 });
  }
}
