import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { createRewardedAdIntent } from '@/server/monetization/rewarded-ads';

export const dynamic = 'force-dynamic';

type RewardIntentPayload = {
  rewardType?: string;
  gameType?: string | null;
};

export async function POST(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  let payload: RewardIntentPayload;
  try {
    payload = (await request.json()) as RewardIntentPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  try {
    const result = await createRewardedAdIntent({
      userId: identity.userId,
      rewardType: payload.rewardType,
      gameType: payload.gameType,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to create reward intent.' },
      { status: 400 },
    );
  }
}
