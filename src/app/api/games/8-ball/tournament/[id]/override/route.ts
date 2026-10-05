import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { checkRole } from '@/server/auth/check-role';
import { overrideTournamentMatchResult } from '@/server/arcade/pool-tournament';

export const dynamic = 'force-dynamic';

/** POST — Override a tournament match result (admin only). */
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
    return NextResponse.json({ error: 'Insufficient permissions.' }, { status: 403 });
  }

  // tournamentId from the URL is available for validation but the override
  // function operates on tournamentMatchId directly
  await params;

  let body: { tournamentMatchId?: string; winnerId?: string; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  if (typeof body.tournamentMatchId !== 'string' || !body.tournamentMatchId) {
    return NextResponse.json({ error: 'tournamentMatchId is required.' }, { status: 400 });
  }
  if (typeof body.winnerId !== 'string' || !body.winnerId) {
    return NextResponse.json({ error: 'winnerId is required.' }, { status: 400 });
  }
  if (typeof body.reason !== 'string' || !body.reason.trim()) {
    return NextResponse.json({ error: 'reason is required.' }, { status: 400 });
  }

  try {
    await overrideTournamentMatchResult({
      tournamentMatchId: body.tournamentMatchId,
      winnerId: body.winnerId,
      modUserId: identity.userId,
      reason: body.reason.trim(),
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = (error as Error).message;
    const status = message.includes('not found') ? 404 : 409;
    return NextResponse.json({ error: message }, { status });
  }
}
