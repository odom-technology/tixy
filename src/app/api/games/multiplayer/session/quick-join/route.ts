import { gameUnavailableResponse } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';

import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import { isMultiplayerGameType } from '@/server/arcade/multiplayer';
import {
  cancelOwnWaitingSession,
  quickJoinSession,
} from '@/server/arcade/session-quick-join';

export const dynamic = 'force-dynamic';

const VALID_MODE_SECS = new Set([15, 30, 60]);

function normalizeModeSec(value: unknown): number {
  const parsed = Number(value);
  return VALID_MODE_SECS.has(parsed) ? parsed : 30;
}

type QuickJoinPayload = {
  gameType?: string;
  metadata?: { modeSec?: unknown } | null;
};

type CancelPayload = {
  sessionId?: string;
};

/** POST — quick-join: seat into a compatible open public session, else queue. */
export async function POST(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  const banResponse = await ensureNotGameBanned(identity.userId);
  if (banResponse) return banResponse;

  let body: QuickJoinPayload = {};
  try {
    body = (await request.json()) as QuickJoinPayload;
  } catch {
    // Body optional — defaults below.
  }

  const rawGameType = body.gameType?.trim();
  if (!rawGameType || !isMultiplayerGameType(rawGameType) || rawGameType === 'blackjack' || rawGameType === 'derby') {
    return NextResponse.json({ error: 'Valid gameType is required.' }, { status: 400 });
  }
  const modeSec = normalizeModeSec(body.metadata?.modeSec);

  try {
    const result = await quickJoinSession({
      gameType: rawGameType,
      modeSec,
      user: { userId: identity.userId, userName: identity.name || 'Anonymous' },
    });

    // On a pairing, nudge the queued owner's lobby to re-check immediately
    // rather than waiting on its poll tick. typing-duel's realtime is polled;
    // `typingLobby` is allowlisted in topic-access.ts, so this is a safe hint.
    if (result.status === 'matched' && rawGameType === 'typing-test') {
      broadcast('typingLobby', { type: 'session_joined', sessionId: result.sessionId });
    }

    return NextResponse.json({
      status: result.status,
      sessionId: result.sessionId,
      // Alias for the shared lobby's `LobbyQueueAdapter` (expects `matchId`).
      matchId: result.sessionId,
    });
  } catch (error) {
    const unavailable = gameUnavailableResponse(error);
    if (unavailable) return unavailable;
    console.error('Failed to quick-join session:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to find a duel.' },
      { status: 500 },
    );
  }
}

/** DELETE — cancel the caller's still-waiting quick-join session cleanly. */
export async function DELETE(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  let body: CancelPayload = {};
  try {
    body = (await request.json()) as CancelPayload;
  } catch {
    // Body optional.
  }

  const sessionId = body.sessionId?.trim();
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required.' }, { status: 400 });
  }

  try {
    await cancelOwnWaitingSession({ sessionId, userId: identity.userId });
    broadcast('typingLobby', { type: 'session_cancelled', sessionId });
    return NextResponse.json({ cancelled: true });
  } catch (error) {
    const unavailable = gameUnavailableResponse(error);
    if (unavailable) return unavailable;
    const message = (error as Error).message;
    const status =
      message.includes('not found') ? 404 :
      message.includes('already has an opponent') ? 409 :
      message.includes('Only the owner') ? 403 :
      500;
    return NextResponse.json({ error: message }, { status });
  }
}
