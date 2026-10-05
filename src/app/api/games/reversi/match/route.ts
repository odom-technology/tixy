import { checkNewGameAvailability } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { createMatch } from '@/server/arcade/reversi-match';
import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import {
  createGameInviteCode,
  getGameCodeJoinHref,
  withAbsoluteUrl,
  type MultiplayerGameType,
} from '@/server/arcade/multiplayer';

export const dynamic = 'force-dynamic';

// Reversi is not (yet) registered in MULTIPLAYER_GAME_CONFIG / MultiplayerGameType
// (a foundation gap in multiplayer.ts, which this builder must not edit). The
// invite-code subsystem is therefore best-effort: we attempt to mint a code, but
// matches are primarily shared via the open-match lobby + `?join=<id>` deep links.
const REVERSI_GAME_TYPE = 'reversi' as unknown as MultiplayerGameType;

type CreatePayload = {
  preferredColor?: 'black' | 'white' | 'random';
};

/** POST — Create a new open Reversi match. */
export async function POST(request: Request) {
  const unavailable = await checkNewGameAvailability('reversi');
  if (unavailable) return unavailable;

  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  const banResponse = await ensureNotGameBanned(identity.userId);
  if (banResponse) return banResponse;

  let body: CreatePayload = {};
  try {
    body = (await request.json()) as CreatePayload;
  } catch {
    // Body optional
  }

  const preferredColor = body.preferredColor ?? 'random';

  try {
    const userName =
    identity.name && identity.name !== identity.email ? identity.name : 'Player';
    const match = await createMatch(identity.userId, userName, {
      preferredColor,
    });

    // Best-effort invite code (see note above). On any failure (e.g. reversi not
    // configured for the invite subsystem) we return invite:null — the lobby /
    // match page surface a `?join=<id>` deep-link as the share mechanism instead.
    let invite: Record<string, unknown> | null = null;
    try {
      const code = await createGameInviteCode({
        gameType: REVERSI_GAME_TYPE,
        matchId: match.id,
        createdByUserId: identity.userId,
      });
      const href = getGameCodeJoinHref(REVERSI_GAME_TYPE, code.code);
      invite = { ...code, href, url: withAbsoluteUrl(href, request) };
    } catch {
      invite = null;
    }

    const joinHref = `/reversi?join=${encodeURIComponent(match.id)}`;
    return NextResponse.json({
      match,
      invite,
      joinHref,
      joinUrl: withAbsoluteUrl(joinHref, request),
    });
  } catch (error) {
    console.error('Failed to create reversi match:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to create match.' },
      { status: 500 },
    );
  }
}
