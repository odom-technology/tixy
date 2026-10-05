import { checkNewGameAvailability } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { checkRole } from '@/server/auth/check-role';
import { startTournament } from '@/server/arcade/pool-tournament';

export const dynamic = 'force-dynamic';

/** POST — Start the tournament (admin only). */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await checkNewGameAvailability('8-ball');
  if (unavailable) return unavailable;

  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const isAdmin = await checkRole('admin', identity);
  if (!isAdmin) {
    return NextResponse.json({ error: 'Insufficient permissions.' }, { status: 403 });
  }

  const { id: tournamentId } = await params;

  try {
    const tournament = await startTournament(tournamentId);
    return NextResponse.json({ tournament });
  } catch (error) {
    const message = (error as Error).message;
    const status = message.includes('not found') ? 404 : 409;
    return NextResponse.json({ error: message }, { status });
  }
}
