import { NextResponse } from 'next/server';

import { getStoreStateForUser } from '@/server/arcade/rewards';
import { setPinnedPrize } from '@/server/arcade/rewards/counter';
import { requireIdentity } from '@/server/auth';
import { attachSetLabelsToStoreState } from '../_set-labels';

export const dynamic = 'force-dynamic';

/* Pin a prize on the counter ({ itemId }), or clear the pin ({ itemId: null }). */
export async function POST(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Sign in to pin a prize.' }, { status: 401 });
  }

  let payload: { itemId?: unknown };
  try {
    payload = (await request.json()) as { itemId?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }
  const itemId = typeof payload.itemId === 'string' && payload.itemId.trim() ? payload.itemId.trim() : null;
  if (payload.itemId !== null && itemId === null) {
    return NextResponse.json({ error: 'itemId is required.' }, { status: 400 });
  }

  try {
    const before = await getStoreStateForUser(identity.userId);
    const onCounter = new Set(before.rotation.filter((entry) => !entry.owned).map((entry) => entry.item.id));
    await setPinnedPrize(identity.userId, itemId, onCounter);
    const state = await attachSetLabelsToStoreState(await getStoreStateForUser(identity.userId));
    return NextResponse.json({ success: true, state });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message || 'Could not pin that prize.' }, { status: 400 });
  }
}
