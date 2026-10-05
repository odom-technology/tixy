import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { checkRole } from '@/server/auth/check-role';
import { overrideTournamentMatchResult } from '@/server/arcade/chess-tournament';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const isAdmin = await checkRole('admin', identity);
  if (!isAdmin) return NextResponse.json({ error: 'Insufficient permissions.' }, { status: 403 });

  let body: { tournamentMatchId?: string; winnerId?: string; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  if (!body.tournamentMatchId || !body.winnerId || !body.reason) {
    return NextResponse.json({ error: 'tournamentMatchId, winnerId, and reason are required.' }, { status: 400 });
  }

  try {
    await overrideTournamentMatchResult({
      tournamentMatchId: body.tournamentMatchId,
      winnerId: body.winnerId,
      modUserId: identity.userId,
      reason: body.reason,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
