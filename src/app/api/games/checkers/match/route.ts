import { checkNewGameAvailability } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { createMatch } from '@/server/arcade/checkers-match';
import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import { isValidTimeFormatId } from '@/features/arcade/lib/checkers/types';
import {
  createGameInviteCode,
  getGameCodeJoinHref,
  withAbsoluteUrl,
} from '@/server/arcade/multiplayer';

export const dynamic = 'force-dynamic';

type CreatePayload = {
  timeFormatId?: string;
  preferredColor?: 'red' | 'white' | 'random';
};

/** POST — Create a new open checkers match. */
export async function POST(request: Request) {
  const unavailable = await checkNewGameAvailability('checkers');
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

  const timeFormatId = isValidTimeFormatId(body.timeFormatId) ? body.timeFormatId : 'untimed';
  const preferredColor = body.preferredColor ?? 'random';

  try {
    const userName = identity.name || 'Anonymous';
    const match = await createMatch(identity.userId, userName, {
      timeFormatId,
      preferredColor,
    });
    const code = await createGameInviteCode({
      gameType: 'checkers',
      matchId: match.id,
      createdByUserId: identity.userId,
    });
    const href = getGameCodeJoinHref('checkers', code.code);
    return NextResponse.json({
      match,
      invite: {
        ...code,
        href,
        url: withAbsoluteUrl(href, request),
      },
    });
  } catch (error) {
    console.error('Failed to create checkers match:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to create match.' },
      { status: 500 },
    );
  }
}
