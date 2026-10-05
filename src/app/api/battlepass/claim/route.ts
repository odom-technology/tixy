import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import {
  claimTierReward,
  getBattlepassState,
} from '@/server/arcade/battlepass';

export const dynamic = 'force-dynamic';

// POST { tier: number, track: 'free' | 'premium' } → claims a tier reward.
export async function POST(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  let body: { tier?: unknown; track?: unknown };
  try {
    body = (await request.json()) as { tier?: unknown; track?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }
  const tier = Number(body.tier);
  const track = body.track === 'premium' ? 'premium' : 'free';
  if (!Number.isInteger(tier) || tier < 1) {
    return NextResponse.json({ error: 'Invalid tier.' }, { status: 400 });
  }
  try {
    const reward = await claimTierReward(identity.userId, tier, track);
    const state = await getBattlepassState(identity.userId);
    return NextResponse.json({ success: true, reward, state });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to claim.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
