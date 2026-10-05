import { checkNewGameAvailability } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { checkRole } from '@/server/auth/check-role';
import {
  createTournament,
  getTournaments,
  type TournamentFormat,
} from '@/server/arcade/pool-tournament';
import {
  POOL_TOURNAMENT_DEFAULT_MAX_BET,
  POOL_TOURNAMENT_DEFAULT_MIN_BET,
} from '@/server/arcade/pool-wager-constants';

export const dynamic = 'force-dynamic';

/** GET — List tournaments. */
export async function GET() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const tournaments = await getTournaments();
  const isAdmin = await checkRole('admin', identity);
  return NextResponse.json({ tournaments, isAdmin });
}

/** POST — Create a new tournament (admin only). */
export async function POST(request: Request) {
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

  let body: { name?: string; format?: string; hasLosersBracket?: boolean; bettingEnabled?: boolean; minBet?: number; maxBet?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 100) {
    return NextResponse.json({ error: 'Name is required (max 100 chars).' }, { status: 400 });
  }

  const format = body.format === 'bo3' ? 'bo3' : 'bo1';
  const hasLosersBracket = body.hasLosersBracket === true;
  const bettingEnabled = body.bettingEnabled === true;
  const minBet =
    bettingEnabled && typeof body.minBet === 'number'
      ? Math.max(POOL_TOURNAMENT_DEFAULT_MIN_BET, Math.trunc(body.minBet))
      : POOL_TOURNAMENT_DEFAULT_MIN_BET;
  const maxBet =
    bettingEnabled && typeof body.maxBet === 'number'
      ? Math.max(minBet, Math.trunc(body.maxBet))
      : POOL_TOURNAMENT_DEFAULT_MAX_BET;

  try {
    const tournament = await createTournament({
      name,
      format: format as TournamentFormat,
      hasLosersBracket,
      bettingEnabled,
      minBet,
      maxBet,
      createdBy: identity.userId,
      createdByName: identity.name || 'Admin',
    });
    return NextResponse.json({ tournament });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to create tournament.' },
      { status: 500 },
    );
  }
}
