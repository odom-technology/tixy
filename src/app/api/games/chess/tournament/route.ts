import { checkNewGameAvailability } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { checkRole } from '@/server/auth/check-role';
import {
  createTournament,
  getTournaments,
  type TournamentFormat,
} from '@/server/arcade/chess-tournament';
import {
  CHESS_TOURNAMENT_DEFAULT_MAX_BET,
  CHESS_TOURNAMENT_DEFAULT_MIN_BET,
} from '@/server/arcade/chess-wager-constants';
import { isValidTimeFormatId } from '@/features/arcade/lib/chess/types';

export const dynamic = 'force-dynamic';

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

export async function POST(request: Request) {
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

  let body: {
    name?: string;
    format?: string;
    timeFormatId?: string;
    hasLosersBracket?: boolean;
    bettingEnabled?: boolean;
    minBet?: number;
    maxBet?: number;
  };
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
  const timeFormatId = isValidTimeFormatId(body.timeFormatId) ? body.timeFormatId : 'blitz';
  const hasLosersBracket = body.hasLosersBracket === true;
  const bettingEnabled = body.bettingEnabled === true;
  const minBet = bettingEnabled && typeof body.minBet === 'number'
    ? Math.max(CHESS_TOURNAMENT_DEFAULT_MIN_BET, Math.trunc(body.minBet))
    : CHESS_TOURNAMENT_DEFAULT_MIN_BET;
  const maxBet = bettingEnabled && typeof body.maxBet === 'number'
    ? Math.max(minBet, Math.trunc(body.maxBet))
    : CHESS_TOURNAMENT_DEFAULT_MAX_BET;

  try {
    const tournament = await createTournament({
      name,
      format: format as TournamentFormat,
      timeFormatId,
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
