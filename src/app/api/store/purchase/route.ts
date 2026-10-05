import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { getStoreStateForUser, purchaseStoreItemForUser } from '@/server/arcade/rewards';
import { recordStats } from '@/server/arcade/stats';
import { secretStat, set } from '@/server/arcade/stats/stat-keys';
import { attachSetLabelsToStoreState } from '../_set-labels';

type PurchasePayload = {
  itemId?: string;
};

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  let payload: PurchasePayload;
  try {
    payload = (await request.json()) as PurchasePayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const itemId = payload.itemId?.trim();
  if (!itemId) {
    return NextResponse.json({ error: 'itemId is required.' }, { status: 400 });
  }

  try {
    const purchase = await purchaseStoreItemForUser({ userId: identity.userId, itemId });
    // A purchase resets Window Shopper's count of store visits without buying.
    await recordStats(identity.userId, [set(secretStat('window_shopper'), 0)]);
    const state = await attachSetLabelsToStoreState(
      await getStoreStateForUser(identity.userId),
    );
    return NextResponse.json({
      success: true,
      purchase,
      state,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to complete purchase.' },
      { status: 400 },
    );
  }
}
