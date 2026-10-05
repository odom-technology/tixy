import { checkNewGameAvailability } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import { registerForTournament, unregisterFromTournament } from '@/server/arcade/chess-tournament';

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
  // Banned users shouldn't be able to register for tournaments.
  const banResponse = await ensureNotGameBanned(identity.userId);
  if (banResponse) return banResponse;

  const { id: tournamentId } = await params;
  try {
    await registerForTournament(
      tournamentId,
      identity.userId,
      identity.name || 'Anonymous',
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = (error as Error).message;
    const status = message.includes('not found') ? 404
      : message.includes('Already registered') ? 409
      : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
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
  try {
    await unregisterFromTournament(tournamentId, identity.userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = (error as Error).message;
    const status = message.includes('not found') ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
