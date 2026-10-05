import { NextResponse } from 'next/server';

import { isRewardGameType } from '@/features/arcade/lib/rewards';
import { getUserInventoryAndEquipped } from '@/server/arcade/rewards';
import { getOrCreateRouteIdentity } from '@/server/auth/route-identity';
import { isGuestIdentity } from '@/server/auth/guest';
import { attachSetLabelsToInventoryState } from '@/app/api/store/_set-labels';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { identity, attachCookie } = await getOrCreateRouteIdentity();

  const { searchParams } = new URL(request.url);
  const gameTypeParam = searchParams.get('gameType');
  if (gameTypeParam && !isRewardGameType(gameTypeParam)) {
    return NextResponse.json({ error: 'Invalid game type.' }, { status: 400 });
  }
  const gameType = gameTypeParam && isRewardGameType(gameTypeParam)
    ? gameTypeParam
    : undefined;

  try {
    const data = await attachSetLabelsToInventoryState(
      await getUserInventoryAndEquipped(identity.userId, gameType),
    );
    const response = NextResponse.json({
      ...data,
      isGuest: isGuestIdentity(identity),
    });
    attachCookie(response);
    return response;
  } catch (error) {
    console.error('Failed to load inventory:', error);
    return NextResponse.json({ error: 'Failed to load inventory.' }, { status: 500 });
  }
}
