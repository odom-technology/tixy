import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { checkRole } from '@/server/auth/check-role';
import { startTournamentRound } from '@/server/arcade/chess-tournament';

export const dynamic = 'force-dynamic';

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
  if (!isAdmin) return NextResponse.json({ error: 'Insufficient permissions.' }, { status: 403 });

  let body: { round?: number; bracket?: 'winners' | 'losers' | 'grand_final' } = {};
  try {
    body = await request.json();
  } catch { /* empty body */ }

  if (typeof body.round !== 'number' || body.round < 1) {
    return NextResponse.json({ error: 'round is required (>= 1).' }, { status: 400 });
  }

  const { id: tournamentId } = await params;
  try {
    const result = await startTournamentRound(tournamentId, body.round, body.bracket);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
