import { NextResponse } from 'next/server';

import { isRewardGameType } from '@/features/arcade/lib/rewards';
import { getAccountLevelState } from '@/server/arcade/levels';
import { getStoreStateForUser } from '@/server/arcade/rewards';
import { getOrCreateRouteIdentity } from '@/server/auth/route-identity';
import { isGuestIdentity } from '@/server/auth/guest';
import { attachSetLabelsToStoreState } from './_set-labels';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { identity, attachCookie } = await getOrCreateRouteIdentity();

  const { searchParams } = new URL(request.url);
  const gameTypeParam = searchParams.get('gameType');
  const gameType =
    gameTypeParam && isRewardGameType(gameTypeParam) ? gameTypeParam : null;

  try {
    const isGuest = isGuestIdentity(identity);
    /* The counter's preview puts a prize on your own namecard, which shows
       your level. */
    const [storeState, level] = await Promise.all([
      getStoreStateForUser(identity.userId),
      isGuest ? null : getAccountLevelState(identity.userId).catch(() => null),
    ]);
    const state = await attachSetLabelsToStoreState(storeState);
    const response = NextResponse.json({
      ...state,
      isGuest,
      level: level ? level.level : null,
      rotation: gameType
        ? state.rotation.filter((entry) => entry.item.gameType === gameType)
        : state.rotation,
      ownedItems: gameType
        ? state.ownedItems.filter((entry) => entry.item.gameType === gameType)
        : state.ownedItems,
      equipped: gameType
        ? state.equipped.filter((entry) => entry.item.gameType === gameType)
        : state.equipped,
    });
    attachCookie(response);
    return response;
  } catch (error) {
    console.error('Failed to load store state:', error);
    return NextResponse.json({ error: 'Failed to load store state.' }, { status: 500 });
  }
}
