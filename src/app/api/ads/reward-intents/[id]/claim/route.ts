import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { claimRewardedAdIntent } from '@/server/monetization/rewarded-ads';

export const dynamic = 'force-dynamic';

type ClaimPayload = {
  clientGrantId?: string;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const { id } = await params;
  if (!id?.trim()) {
    return NextResponse.json({ error: 'Reward intent id is required.' }, { status: 400 });
  }

  let payload: ClaimPayload;
  try {
    payload = (await request.json()) as ClaimPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  try {
    const result = await claimRewardedAdIntent({
      userId: identity.userId,
      intentId: id,
      clientGrantId: payload.clientGrantId ?? '',
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to claim reward.' },
      { status: 400 },
    );
  }
}
