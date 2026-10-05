import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { markAchievementsSeen } from '@/server/arcade/achievements';

export const dynamic = 'force-dynamic';

/** Clear the "new" badge on a player's freshly-unlocked achievements. */
export async function POST() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  await markAchievementsSeen(identity.userId);
  return NextResponse.json({ ok: true });
}
