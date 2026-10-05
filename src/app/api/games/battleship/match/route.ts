import { checkNewGameAvailability } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { createMatch } from '@/server/arcade/battleship-match';
import { redactMatchForViewer } from '@/server/arcade/battleship-engine';
import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import {
  createGameInviteCode,
  getGameCodeJoinHref,
  withAbsoluteUrl,
} from '@/server/arcade/multiplayer';

export const dynamic = 'force-dynamic';

// Battleship IS registered in MULTIPLAYER_GAME_CONFIG, so the native invite-code
// path works (no fallback shim needed).
const BATTLESHIP_GAME_TYPE = 'battleship' as const;

/** POST — Create a new open Battleship match. */
export async function POST(request: Request) {
  const unavailable = await checkNewGameAvailability('battleship');
  if (unavailable) return unavailable;

  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  const banResponse = await ensureNotGameBanned(identity.userId);
  if (banResponse) return banResponse;

  try {
    const userName =
    identity.name && identity.name !== identity.email ? identity.name : 'Player';
    const match = await createMatch(identity.userId, userName);

    let invite: Record<string, unknown> | null = null;
    try {
      const code = await createGameInviteCode({
        gameType: BATTLESHIP_GAME_TYPE,
        matchId: match.id,
        createdByUserId: identity.userId,
      });
      const href = getGameCodeJoinHref(BATTLESHIP_GAME_TYPE, code.code);
      invite = { ...code, href, url: withAbsoluteUrl(href, request) };
    } catch {
      invite = null;
    }

    const joinHref = `/battleship?join=${encodeURIComponent(match.id)}`;
    return NextResponse.json({
      match: redactMatchForViewer(match, identity.userId),
      invite,
      joinHref,
      joinUrl: withAbsoluteUrl(joinHref, request),
    });
  } catch (error) {
    console.error('Failed to create battleship match:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to create match.' },
      { status: 500 },
    );
  }
}
