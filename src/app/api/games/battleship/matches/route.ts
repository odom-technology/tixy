import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import {
  getMatchesForUser,
  getOpenMatches,
  getActiveSpectatableMatches,
  maybeRunBattleshipDataRetentionCleanup,
  resumeOrphanedBotTurns,
} from '@/server/arcade/battleship-match';
import { redactMatchForViewer } from '@/server/arcade/battleship-engine';

export const dynamic = 'force-dynamic';

export async function GET() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  try {
    await maybeRunBattleshipDataRetentionCleanup();
    // Recover bot work dropped by a crash / dev-server restart (throttled).
    await resumeOrphanedBotTurns();

    const uid = identity.userId;
    // Every match is redacted per-viewer — list payloads NEVER carry an
    // opponent's hidden fleet.
    const myMatches = (await getMatchesForUser(uid)).map((m) => redactMatchForViewer(m, uid));
    const openMatches = (await getOpenMatches(uid)).map((m) => redactMatchForViewer(m, uid));
    const liveMatches = (await getActiveSpectatableMatches())
      .filter((m) => m.player1Id !== uid && m.player2Id !== uid)
      .map((m) => ({ ...redactMatchForViewer(m, uid, { isSpectator: true }), spectatorCount: m.spectatorCount }));

    return NextResponse.json({ userId: uid, myMatches, openMatches, liveMatches });
  } catch (error) {
    console.error('Failed to list battleship matches:', error);
    return NextResponse.json({ error: 'Failed to load matches.' }, { status: 500 });
  }
}
