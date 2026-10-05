import { NextResponse } from 'next/server';
import { getGameBanStatus } from '@/server/arcade/game-bans';

export async function ensureNotGameBanned(userId: string): Promise<NextResponse | null> {
  const gameBan = await getGameBanStatus(userId);
  if (!gameBan.isBanned) return null;

  return NextResponse.json(
    {
      error: gameBan.isIndefinite
        ? 'You are currently banned from playing games until an admin removes the ban.'
        : 'You are temporarily banned from playing games.',
      retryAfterSec:
        gameBan.isIndefinite || gameBan.remainingMs <= 0
          ? undefined
          : Math.ceil(gameBan.remainingMs / 1000),
      isIndefinite: gameBan.isIndefinite,
    },
    { status: 403 },
  );
}
