import { checkNewGameAvailability } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import {
  registerForTournament,
  unregisterFromTournament,
} from '@/server/arcade/pool-tournament';
import { broadcast } from '@/server/events';

export const dynamic = 'force-dynamic';

/** POST — Register or unregister from a tournament. Body: { action: 'register' | 'unregister' } */
export async function POST(
  request: Request,
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

  const banResponse = await ensureNotGameBanned(identity.userId);
  if (banResponse) return banResponse;

  const { id: tournamentId } = await params;

  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const action = body.action;
  if (action !== 'register' && action !== 'unregister') {
    return NextResponse.json({ error: 'action must be "register" or "unregister".' }, { status: 400 });
  }

  try {
    if (action === 'register') {
      const userName = identity.name || 'Anonymous';
      await registerForTournament(tournamentId, identity.userId, userName);
    } else {
      await unregisterFromTournament(tournamentId, identity.userId);
    }
    broadcast('poolTournament', { tournamentId, action, userId: identity.userId });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = (error as Error).message;
    const status = message.includes('not found') ? 404 : 409;
    return NextResponse.json({ error: message }, { status });
  }
}
