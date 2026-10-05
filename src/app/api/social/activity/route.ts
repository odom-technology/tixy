import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { listFriendActivityForUser } from '@/server/services/activity-events';

export const dynamic = 'force-dynamic';

// GET — recent activity from the caller's friends (public/players events only).
export async function GET() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  try {
    const events = await listFriendActivityForUser(identity.userId, 40);
    return NextResponse.json({ events });
  } catch (error) {
    console.error('Failed to load activity:', error);
    return NextResponse.json({ error: 'Unable to load activity.' }, { status: 500 });
  }
}
