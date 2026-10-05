import { checkNewGameAvailability } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { checkRole } from '@/server/auth/check-role';
import { startTournament } from '@/server/arcade/chess-tournament';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await checkNewGameAvailability('chess');
  if (unavailable) return unavailable;

  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const isAdmin = await checkRole('admin', identity);
  if (!isAdmin) return NextResponse.json({ error: 'Insufficient permissions.' }, { status: 403 });

  const { id: tournamentId } = await params;
  try {
    const tournament = await startTournament(tournamentId);
    return NextResponse.json({ tournament });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
