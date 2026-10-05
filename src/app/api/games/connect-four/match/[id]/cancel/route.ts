import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { cancelWaitingMatch } from '@/server/arcade/connect-four-match';
import { resolveMultiplayerWaitingNotifications } from '@/server/arcade/multiplayer-waiting-notifications';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const { id: matchId } = await params;
  try {
    await cancelWaitingMatch(matchId, identity.userId);
    await resolveMultiplayerWaitingNotifications({ gameType: 'connect-four', matchId });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = (error as Error).message;
    const status = message.includes('not found') ? 404
      : message.includes('Only the creator') ? 403
      : 409;
    return NextResponse.json({ error: message }, { status });
  }
}
