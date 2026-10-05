import { checkNewGameAvailability } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { createMatch } from '@/server/arcade/pool-match';
import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import {
  createGameInviteCode,
  getGameCodeJoinHref,
  withAbsoluteUrl,
} from '@/server/arcade/multiplayer';

export const dynamic = 'force-dynamic';

/** POST — Create a new 8-ball match with a shareable code/link. */
export async function POST(request: Request) {
  const unavailable = await checkNewGameAvailability('8-ball');
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
    const userName = identity.name || 'Anonymous';
    const match = await createMatch(identity.userId, userName);
    const code = await createGameInviteCode({
      gameType: '8-ball',
      matchId: match.id,
      createdByUserId: identity.userId,
    });
    const href = getGameCodeJoinHref('8-ball', code.code);
    return NextResponse.json({
      match,
      invite: {
        ...code,
        href,
        url: withAbsoluteUrl(href, request),
      },
    });
  } catch (error) {
    console.error('Failed to create 8-ball match:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to create match.' },
      { status: 500 },
    );
  }
}
