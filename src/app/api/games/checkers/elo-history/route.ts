import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { getEloHistory } from '@/server/arcade/checkers-elo';

export const dynamic = 'force-dynamic';

/**
 * GET — Return the caller's checkers Elo timeline for graphing. Each entry is a
 * match that moved the caller's rating, reversed to chronological order so the
 * chart can plot straight through.
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
    const ratingAfter = isPlayerA ? h.playerAEloAfter : h.playerBEloAfter;
    const change = isPlayerA ? h.playerAEloChange : h.playerBEloChange;
    const outcome: 'win' | 'loss' | 'draw' =
      h.outcome === 'draw' ? 'draw' : h.winnerId === userId ? 'win' : 'loss';
    return {
      matchId: h.matchId,
      ratingAfter,
      change,
      outcome,
      timestamp: h.createdAt,
    };
  });

  return NextResponse.json({ points });
}
