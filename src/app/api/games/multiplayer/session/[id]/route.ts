import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import {
  getMultiplayerSessionSnapshot,
  leaveMultiplayerSession,
} from '@/server/arcade/multiplayer';

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

  const { id } = await params;
  const snapshot = await getMultiplayerSessionSnapshot(id);
  if (!snapshot) {
    return NextResponse.json({ error: 'Table not found.' }, { status: 404 });
  }

  const isPlayer = snapshot.players.some((player) => player.userId === identity.userId);
  if (
    snapshot.session.visibility === 'private' &&
    !isPlayer &&
    snapshot.session.ownerUserId !== identity.userId
  ) {
    return NextResponse.json({ error: 'Not a player at this table.' }, { status: 403 });
  }

  return NextResponse.json({
    ...snapshot,
    viewer: {
      userId: identity.userId,
      isPlayer,
      seatIndex:
        snapshot.players.find((player) => player.userId === identity.userId)?.seatIndex ??
        null,
    },
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const { id } = await params;
  try {
    const snapshot = await leaveMultiplayerSession({
      sessionId: id,
      userId: identity.userId,
    });
    return NextResponse.json(snapshot);
  } catch (error) {
    const message = (error as Error).message;
    return NextResponse.json(
      { error: message },
      { status: message.includes('not found') ? 404 : 500 },
    );
  }
}
