import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { clearRecentMatchesForUser } from '@/server/arcade/chess-match';

export const dynamic = 'force-dynamic';

export async function POST() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const clearedAt = await clearRecentMatchesForUser(identity.userId);
  return NextResponse.json({ clearedAt });
}
