import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { checkRole } from '@/server/auth/check-role';
import { startTournamentRound, type TournamentBracketType } from '@/server/arcade/pool-tournament';

export const dynamic = 'force-dynamic';

/** POST — Start a tournament round (close betting, create pool matches). Admin only. */
export async function POST(
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
  if (!isAdmin) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
  }

  let body: { round?: number; bracket?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const { round, bracket } = body;
  if (!round || !Number.isInteger(round) || round < 1) {
    return NextResponse.json({ error: 'Valid round number is required.' }, { status: 400 });
  }

  const { id: tournamentId } = await params;

  try {
    const result = await startTournamentRound(
      tournamentId,
      round,
      bracket as TournamentBracketType | undefined,
    );
    return NextResponse.json({ success: true, activated: result.activated });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to start round.' },
      { status: 400 },
    );
  }
}
