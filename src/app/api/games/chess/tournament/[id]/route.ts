import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { checkRole } from '@/server/auth/check-role';
import {
  getTournament,
  getParticipants,
  getTournamentBracket,
  getActiveChessMatchForTournamentMatch,
  completeTournament,
} from '@/server/arcade/chess-tournament';
import { broadcast } from '@/server/events';
import { getWagersForTournament } from '@/server/arcade/chess-tournament-wagers';

export const dynamic = 'force-dynamic';

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
  const tournament = await getTournament(tournamentId);
  if (!tournament) return NextResponse.json({ error: 'Tournament not found.' }, { status: 404 });

  const participants = await getParticipants(tournamentId);
  const bracket = tournament.status !== 'registration' ? await getTournamentBracket(tournamentId) : null;
  const isAdmin = await checkRole('admin', identity);

  const activeChessMatches: Record<string, string | null> = {};
  if (bracket) {
    const allMatches = [...bracket.winners.flat(), ...bracket.losers.flat(), ...bracket.grandFinal];
    for (const m of allMatches) {
      if (m.status === 'active') {
        activeChessMatches[m.id] = await getActiveChessMatchForTournamentMatch(m.id);
      }
    }
  }

  const isRegistered = participants.some((p) => p.userId === identity.userId);
  const wagerData = tournament.bettingEnabled
    ? await getWagersForTournament(tournamentId, identity.userId)
    : null;

  return NextResponse.json({
    tournament,
    participants,
    bracket,
    activeChessMatches,
    isAdmin,
    isRegistered,
    userId: identity.userId,
    wagerPools: wagerData?.matchPools ?? null,
    userWagers: wagerData?.userWagers ?? [],
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const isAdmin = await checkRole('admin', identity);
  if (!isAdmin) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });

  const { id: tournamentId } = await params;
  const tournament = await getTournament(tournamentId);
  if (!tournament) return NextResponse.json({ error: 'Tournament not found.' }, { status: 404 });

  const { searchParams } = new URL(request.url);
  if (searchParams.get('action') === 'delete') {
    if (tournament.status !== 'completed') {
      return NextResponse.json({ error: 'Only completed tournaments can be deleted.' }, { status: 409 });
    }
    try {
      const { deleteTournament } = await import('@/server/arcade/chess-tournament');
      await deleteTournament(tournamentId);
      broadcast('chessTournament', { tournamentId, action: 'deleted' });
      return NextResponse.json({ success: true, deleted: true });
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
  }

  if (tournament.status === 'completed') {
    return NextResponse.json({ error: 'Tournament is already completed.' }, { status: 409 });
  }

  let body: { winnerId?: string; winnerName?: string } = {};
  try {
    body = await request.json();
  } catch { /* empty body allowed */ }

  let winnerId = body.winnerId;
  let winnerName = body.winnerName;
  if (!winnerId) {
    const bracket = await getTournamentBracket(tournamentId);
    const allMatches = [...bracket.winners.flat(), ...bracket.losers.flat(), ...bracket.grandFinal];
    const completedMatches = allMatches.filter((m) => m.winnerId);
    const lastCompleted = completedMatches[completedMatches.length - 1];
    if (lastCompleted?.winnerId) {
      winnerId = lastCompleted.winnerId;
      winnerName = lastCompleted.winnerId === lastCompleted.player1Id
        ? lastCompleted.player1Name ?? 'Player 1'
        : lastCompleted.player2Name ?? 'Player 2';
    }
  }

  if (!winnerId || !winnerName) {
    return NextResponse.json({ error: 'Could not determine winner. Provide winnerId and winnerName.' }, { status: 400 });
  }

  try {
    await completeTournament(tournamentId, winnerId, winnerName);
    broadcast('chessTournament', { tournamentId, action: 'completed' });
    return NextResponse.json({ success: true, winnerId, winnerName });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
