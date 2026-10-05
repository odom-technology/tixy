import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { getEloHistory, getTierName, getTierColor } from '@/server/arcade/reversi-elo';

export const dynamic = 'force-dynamic';

/**
 * GET — Return the caller's Reversi Elo timeline for graphing. Newest first
 * from the DB, reversed to chronological here. Capped at MAX_POINTS.
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
