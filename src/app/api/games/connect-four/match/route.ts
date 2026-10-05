import { checkNewGameAvailability } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { createMatch } from '@/server/arcade/connect-four-match';
import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import {
  createGameInviteCode,
  getGameCodeJoinHref,
  withAbsoluteUrl,
} from '@/server/arcade/multiplayer';

export const dynamic = 'force-dynamic';

type CreatePayload = {
  preferredColor?: 'red' | 'yellow' | 'random';
};

/** POST — Create a new open Connect Four match. */
export async function POST(request: Request) {
  const unavailable = await checkNewGameAvailability('connect-four');
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
    const userName = identity.name || 'Anonymous';
    const match = await createMatch(identity.userId, userName, {
      preferredColor,
    });
    const code = await createGameInviteCode({
      gameType: 'connect-four',
      matchId: match.id,
      createdByUserId: identity.userId,
    });
    const href = getGameCodeJoinHref('connect-four', code.code);
    return NextResponse.json({
      match,
      invite: {
        ...code,
        href,
        url: withAbsoluteUrl(href, request),
      },
    });
  } catch (error) {
    console.error('Failed to create connect-four match:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to create match.' },
      { status: 500 },
    );
  }
}
