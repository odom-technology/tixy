import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { isRewardGameType } from '@/features/arcade/lib/rewards';
import { equipStoreItemForUser } from '@/server/arcade/rewards';
import { recordStats } from '@/server/arcade/stats';
import { add, secretStat } from '@/server/arcade/stats/stat-keys';
import { attachSetLabelsToInventoryState } from '../_set-labels';

type EquipPayload = {
  itemId?: string;
  gameType?: string;
};

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  let payload: EquipPayload;
  try {
    payload = (await request.json()) as EquipPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const itemId = payload.itemId?.trim();
  const gameType = payload.gameType?.trim();
  if (!itemId || !gameType) {
    return NextResponse.json(
      { error: 'itemId and gameType are required.' },
      { status: 400 },
    );
  }
  if (!isRewardGameType(gameType)) {
    return NextResponse.json({ error: 'Invalid gameType.' }, { status: 400 });
  }

  try {
    const state = await attachSetLabelsToInventoryState(
      await equipStoreItemForUser({
        userId: identity.userId,
        itemId,
        gameType,
      }),
    );
    // Fashionista counts every equip the server accepts.
    const achievements = await recordStats(identity.userId, [add(secretStat('fashionista'), 1)]);
    return NextResponse.json({ success: true, state, achievements });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to equip item.' },
      { status: 400 },
    );
  }
}
