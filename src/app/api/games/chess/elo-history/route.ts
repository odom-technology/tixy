import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { getEloHistory, getTierName, getTierColor } from '@/server/arcade/chess-elo';

export const dynamic = 'force-dynamic';

/**
 * GET — Return the caller's chess ELO timeline for graphing. Each entry is a
 * match that moved the caller's rating, newest first from the DB, reversed to
 * chronological here so the chart can plot straight through. Capped at
 * `MAX_POINTS` so very active accounts don't blow up the payload.
 */
const MAX_POINTS = 200;

export async function GET() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const userId = identity.userId;
  const rows = await getEloHistory(userId, MAX_POINTS);
  const chronological = [...rows].reverse();

  const points = chronological.map((h) => {
    const isPlayerA = h.playerAId === userId;
    const ratingBefore = isPlayerA ? h.playerAEloBefore : h.playerBEloBefore;
    const ratingAfter = isPlayerA ? h.playerAEloAfter : h.playerBEloAfter;
    const change = isPlayerA ? h.playerAEloChange : h.playerBEloChange;
    const outcome: 'win' | 'loss' | 'draw' =
      h.outcome === 'draw' ? 'draw' : h.winnerId === userId ? 'win' : 'loss';
    return {
      matchId: h.matchId,
      opponentId: isPlayerA ? h.playerBId : h.playerAId,
      outcome,
      ratingBefore,
      ratingAfter,
      change,
      tier: getTierName(ratingAfter),
      tierColor: getTierColor(ratingAfter),
      timestamp: h.createdAt,
    };
  });

  return NextResponse.json({ userId, points });
}
