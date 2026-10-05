import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { deleteRecentMatchHistoryForUser } from '@/server/arcade/pool-match';

export const dynamic = 'force-dynamic';

/** POST — Permanently delete completed/forfeited match history for this user. */
export async function POST() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const deleted = await deleteRecentMatchHistoryForUser(identity.userId);
  return NextResponse.json({
    success: true,
    deleted,
  });
}
