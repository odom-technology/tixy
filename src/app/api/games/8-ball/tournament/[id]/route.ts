import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { checkRole } from '@/server/auth/check-role';
import {
  getTournament,
  getParticipants,
  getTournamentBracket,
  getActivePoolMatchForTournamentMatch,
  completeTournament,
} from '@/server/arcade/pool-tournament';
import { broadcast } from '@/server/events';
import { getWagersForTournament } from '@/server/arcade/pool-tournament-wagers';

export const dynamic = 'force-dynamic';

/** GET — Tournament detail with bracket, participants, and role info. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401 },
    );
  }

  const { id: tournamentId } = await params;
  const tournament = await getTournament(tournamentId);
  if (!tournament) {
    return NextResponse.json(
      { error: 'Tournament not found.' },
      { status: 404 },
    );
  }

  const participants = await getParticipants(tournamentId);
  const bracket =
    tournament.status !== 'registration'
      ? await getTournamentBracket(tournamentId)
      : null;
  const isAdmin = await checkRole(
    'admin',
    identity,
  );

  // Attach active pool match IDs to bracket matches for linking
  const activePoolMatches: Record<string, string | null> = {};
  if (bracket) {
    const allMatches = [
      ...bracket.winners.flat(),
      ...bracket.losers.flat(),
      ...bracket.grandFinal,
    ];
    for (const m of allMatches) {
      if (m.status === 'active') {
        activePoolMatches[m.id] = await getActivePoolMatchForTournamentMatch(m.id);
      }
    }
  }

  const isRegistered = participants.some((p) => p.userId === identity.userId);

  // Include wager pools for betting-enabled tournaments
  const wagerData = tournament.bettingEnabled
    ? await getWagersForTournament(tournamentId, identity.userId)
    : null;

  return NextResponse.json({
    tournament,
    participants,
    bracket,
    activePoolMatches,
    isAdmin,
    isRegistered,
    userId: identity.userId,
    wagerPools: wagerData?.matchPools ?? null,
    userWagers: wagerData?.userWagers ?? [],
  });
}

/** DELETE — Force-end a tournament (admin only). Body: { winnerId, winnerName } */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401 },
    );
  }

  const isAdmin = await checkRole(
    'admin',
    identity,
  );
  if (!isAdmin) {
    return NextResponse.json(
      { error: 'Admin access required.' },
      { status: 403 },
    );
  }

  const { id: tournamentId } = await params;
  const tournament = await getTournament(tournamentId);
  if (!tournament) {
    return NextResponse.json(
      { error: 'Tournament not found.' },
      { status: 404 },
    );
  }
  // If action=delete, permanently remove the tournament (any status)
  const { searchParams } = new URL(request.url);
  if (searchParams.get('action') === 'delete') {
    try {
      // Refund any active wagers before deleting
      if (tournament.bettingEnabled && tournament.status === 'active') {
        const { cancelTournamentMatchWagers } =
          await import('@/server/arcade/pool-tournament-wagers');
        const { getTournamentBracket: getBracket } =
          await import('@/server/arcade/pool-tournament');
        const bracket = await getBracket(tournamentId);
        const allMatches = [
          ...bracket.winners.flat(),
          ...bracket.losers.flat(),
          ...bracket.grandFinal,
        ];
        for (const m of allMatches) {
          await cancelTournamentMatchWagers(m.id);
        }
      }
      const { deleteTournament } = await import('@/server/arcade/pool-tournament');
      await deleteTournament(tournamentId);
      broadcast('poolTournament', { tournamentId, action: 'deleted' });
      return NextResponse.json({ success: true, deleted: true });
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 500 },
      );
    }
  }

  if (tournament.status === 'completed') {
    return NextResponse.json(
      { error: 'Tournament is already completed.' },
      { status: 409 },
    );
  }

  let body: { winnerId?: string; winnerName?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* empty body allowed */
  }

  // Try to determine the winner from bracket state if not provided
  let winnerId = body.winnerId;
  let winnerName = body.winnerName;
  if (!winnerId) {
    const bracket = await getTournamentBracket(tournamentId);
    const allMatches = [
      ...bracket.winners.flat(),
      ...bracket.losers.flat(),
      ...bracket.grandFinal,
    ];
    const completedMatches = allMatches.filter((m) => m.winnerId);
    const lastCompleted = completedMatches[completedMatches.length - 1];
    if (lastCompleted?.winnerId) {
      winnerId = lastCompleted.winnerId;
      winnerName =
        lastCompleted.winnerId === lastCompleted.player1Id
          ? (lastCompleted.player1Name ?? 'Player 1')
          : (lastCompleted.player2Name ?? 'Player 2');
    }
  }

  if (!winnerId || !winnerName) {
    return NextResponse.json(
      { error: 'Could not determine winner. Provide winnerId and winnerName.' },
      { status: 400 },
    );
  }

  try {
    await completeTournament(tournamentId, winnerId, winnerName);
    broadcast('poolTournament', { tournamentId, action: 'completed' });
    return NextResponse.json({ success: true, winnerId, winnerName });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
