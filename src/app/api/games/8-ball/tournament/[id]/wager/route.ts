import { checkNewGameAvailability } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { placeTournamentWager, getWagerPoolSummary } from '@/server/arcade/pool-tournament-wagers';

export const dynamic = 'force-dynamic';

/** POST — Place a wager on a tournament match. */
export async function POST(
  request: Request,
  { params: _params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await checkNewGameAvailability('8-ball');
  if (unavailable) return unavailable;

  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  let body: { tournamentMatchId?: string; backedPlayerId?: string; amount?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const { tournamentMatchId, backedPlayerId, amount } = body;
  if (!tournamentMatchId || !backedPlayerId || !amount) {
    return NextResponse.json({ error: 'tournamentMatchId, backedPlayerId, and amount are required.' }, { status: 400 });
  }

  const userName = identity.name || 'Anonymous';

  try {
    const wager = await placeTournamentWager({
      userId: identity.userId,
      userName,
      tournamentMatchId,
      backedPlayerId,
      amount,
    });

    const poolSummary = await getWagerPoolSummary(tournamentMatchId);

    return NextResponse.json({ wager, poolSummary });
  } catch (error) {
    const message = (error as Error).message || 'Failed to place wager.';
    const status = message.includes('Insufficient') ? 402 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
