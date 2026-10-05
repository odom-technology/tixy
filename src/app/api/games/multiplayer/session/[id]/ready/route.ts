import { gameUnavailableResponse } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';

import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import { requireIdentity } from '@/server/auth';
import { setMultiplayerSessionPlayerReady } from '@/server/arcade/multiplayer';

export const dynamic = 'force-dynamic';

type ReadyPayload = {
  ready?: boolean;
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

  let body: ReadyPayload = {};
  try {
    body = (await request.json()) as ReadyPayload;
  } catch {
    // Body optional.
  }

  const { id } = await params;
  try {
    const snapshot = await setMultiplayerSessionPlayerReady({
      sessionId: id,
      userId: identity.userId,
      ready: body.ready !== false,
    });
    return NextResponse.json(snapshot);
  } catch (error) {
    const unavailable = gameUnavailableResponse(error);
    if (unavailable) return unavailable;
    const message = (error as Error).message;
    const status =
      message.includes('not found') || message.includes('not seated') ? 404 :
      message.includes('already started') || message.includes('not accepting') ? 409 :
      500;
    return NextResponse.json({ error: message }, { status });
  }
}
