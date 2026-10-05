import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import {
  claimDailyCredits,
  getDailyClaimStatus,
} from '@/server/arcade/rewards/daily-claim';

export const dynamic = 'force-dynamic';

// -----------------------------------------------------------------------------
// GET — returns DailyClaimStatus for the authenticated user
// -----------------------------------------------------------------------------
export async function GET() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  try {
    const status = await getDailyClaimStatus(identity.userId);
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load claim status.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// -----------------------------------------------------------------------------
// POST — executes the claim. 400 for already-claimed;
// 500 for unexpected failures.
// -----------------------------------------------------------------------------
export async function POST() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  try {
    const result = await claimDailyCredits(identity.userId);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to claim.';
    if (message === 'Already claimed today.') {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
