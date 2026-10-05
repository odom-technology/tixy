import { checkNewGameAvailability, gameUnavailableResponse } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';

import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import { requireIdentity } from '@/server/auth';
import { createGameSession } from '@/server/arcade/game-session';
import { checkSessionStartLimit } from '@/server/arcade/game-rate-limit';
import {
  getTypingDuelModeSec,
  getTypingDuelSeed,
  getTypingDuelSnapshot,
} from '@/server/arcade/typing-duel';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = await checkNewGameAvailability('typing-test');
  if (unavailable) return unavailable;

  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const banResponse = await ensureNotGameBanned(identity.userId);
  if (banResponse) return banResponse;

  const { id } = await params;
  const snapshot = await getTypingDuelSnapshot(id);
  if (!snapshot) {
    return NextResponse.json({ error: 'Typing duel not found.' }, { status: 404 });
  }

  const isPlayer = snapshot.players.some((player) => player.userId === identity.userId);
  if (!isPlayer) {
    return NextResponse.json(
      { error: 'Join this typing duel before starting a run.' },
      { status: 403 },
    );
  }

  if (snapshot.session.status !== 'active') {
    return NextResponse.json(
      { error: 'This typing duel is not active yet.' },
      { status: 409 },
    );
  }

  if (snapshot.results.some((result) => result.userId === identity.userId)) {
    return NextResponse.json(
      { error: 'You already submitted a result for this duel.' },
      { status: 409 },
    );
  }

  const sessionLimit = await checkSessionStartLimit(identity.userId, 'typing-test');
  if (!sessionLimit.ok) {
    return NextResponse.json(
      {
        error: sessionLimit.reason,
        retryAfterSec: Math.ceil(sessionLimit.retryAfterMs / 1000),
      },
      { status: 429 },
    );
  }

  const modeSec = getTypingDuelModeSec(snapshot.session);
  const typingSeed = getTypingDuelSeed(snapshot.session);
  if (typingSeed === null) {
    return NextResponse.json(
      { error: 'Typing duel seed is missing.' },
      { status: 500 },
    );
  }

  let session;
  try {
    session = await createGameSession(identity.userId, 'typing-test', {
      modeSec,
      typingSeed,
    });
  } catch (error) {
    const response = gameUnavailableResponse(error);
    if (response) return response;
    throw error;
  }

  return NextResponse.json({
    success: true,
    sessionId: session.sessionId,
    token: session.token,
    modeSec: session.modeSec,
    typingSeed: session.typingSeed,
  });
}
