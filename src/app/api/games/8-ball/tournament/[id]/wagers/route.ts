import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { getWagersForTournament } from '@/server/arcade/pool-tournament-wagers';

export const dynamic = 'force-dynamic';

/** GET — Get all wager pool summaries + the current user's bets for a tournament. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const { id: tournamentId } = await params;
  const data = await getWagersForTournament(tournamentId, identity.userId);

  return NextResponse.json(data);
}
