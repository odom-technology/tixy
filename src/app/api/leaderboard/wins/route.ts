import { NextResponse } from 'next/server';

import { getArcadeGameBySlug } from '@/features/arcade/components/arcade-game-registry';
import { getMachineWins } from '@/server/arcade/leaderboard-overview';
import { withCurrentLeaderboardNames } from '@/server/arcade/leaderboard-identities';
import { requireIdentity } from '@/server/auth';

export const dynamic = 'force-dynamic';

/* A ticket machine's biggest wins this week, one per player:
     GET /api/leaderboard/wins?game=<slug>
   With a session, also the caller's rank and the rows around it. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const game = getArcadeGameBySlug((searchParams.get('game') ?? '').trim());
  if (!game?.arcadeHistoryType) {
    return NextResponse.json({ error: 'Unknown machine.' }, { status: 400 });
  }

  let viewerId: string | null = null;
  try {
    const identity = await requireIdentity({ allowExternal: true, allowGuest: true });
    viewerId = identity.userId;
  } catch {
    // Signed out: the board without a viewer.
  }

  try {
    const wins = await getMachineWins(game.arcadeHistoryType, viewerId);
    const namedRows = await withCurrentLeaderboardNames([...wins.rows, ...wins.around]);
    return NextResponse.json({
      ...wins,
      rows: namedRows.slice(0, wins.rows.length),
      around: namedRows.slice(wins.rows.length),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('machine wins failed:', error);
    return NextResponse.json({ error: 'Failed to load the board.' }, { status: 500 });
  }
}
