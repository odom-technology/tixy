import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { getTypingDuelSnapshot } from '@/server/arcade/typing-duel';

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
  const snapshot = await getTypingDuelSnapshot(id);
  if (!snapshot) {
    return NextResponse.json({ error: 'Typing duel not found.' }, { status: 404 });
  }

  const viewerPlayer = snapshot.players.find(
    (player) => player.userId === identity.userId,
  );
  const isPlayer = Boolean(viewerPlayer);
  if (
    snapshot.session.visibility === 'private' &&
    !isPlayer &&
    snapshot.session.ownerUserId !== identity.userId
  ) {
    return NextResponse.json(
      { error: 'Not a player in this typing duel.' },
      { status: 403 },
    );
  }

  return NextResponse.json({
    ...snapshot,
    viewer: {
      userId: identity.userId,
      isPlayer,
      seatIndex: viewerPlayer?.seatIndex ?? null,
      hasResult: snapshot.results.some((result) => result.userId === identity.userId),
    },
  });
}
