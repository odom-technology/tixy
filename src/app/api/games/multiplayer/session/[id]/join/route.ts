import { gameUnavailableResponse } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';

import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import { requireIdentity } from '@/server/auth';
import { joinMultiplayerSession } from '@/server/arcade/multiplayer';

export const dynamic = 'force-dynamic';

type JoinPayload = {
  inviteCode?: string;
};

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
  const banResponse = await ensureNotGameBanned(identity.userId);
  if (banResponse) return banResponse;

  let body: JoinPayload = {};
  try {
    body = (await request.json()) as JoinPayload;
  } catch {
    // Body optional.
  }

  const { id } = await params;
  try {
    const userName = identity.name || 'Anonymous';
    const snapshot = await joinMultiplayerSession({
      sessionId: id,
      userId: identity.userId,
      userName,
      inviteCode: body.inviteCode,
    });
    return NextResponse.json(snapshot);
  } catch (error) {
    const unavailable = gameUnavailableResponse(error);
    if (unavailable) return unavailable;
    const message = (error as Error).message;
    const status =
      message.includes('not found') ? 404 :
      message.includes('full') || message.includes('not accepting') ? 409 :
      500;
    return NextResponse.json({ error: message }, { status });
  }
}
