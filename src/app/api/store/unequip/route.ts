import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { isRewardGameType } from '@/features/arcade/lib/rewards';
import { unequipStoreItemForUser } from '@/server/arcade/rewards';
import { attachSetLabelsToInventoryState } from '../_set-labels';

type UnequipPayload = {
  gameType?: string;
  slot?: string;
};

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  let payload: UnequipPayload;
  try {
    payload = (await request.json()) as UnequipPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const gameType = payload.gameType?.trim();
  const slot = payload.slot?.trim();
  if (!gameType || !slot) {
    return NextResponse.json(
      { error: 'gameType and slot are required.' },
      { status: 400 },
    );
  }
  if (!isRewardGameType(gameType)) {
    return NextResponse.json({ error: 'Invalid gameType.' }, { status: 400 });
  }

  try {
    const state = await attachSetLabelsToInventoryState(
      await unequipStoreItemForUser({
        userId: identity.userId,
        gameType,
        slot,
      }),
    );
    return NextResponse.json({ success: true, state });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to unequip item.' },
      { status: 400 },
    );
  }
}
