import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { getArcadeFriendUserSummaries } from '@/server/arcade/friend-users';

export const dynamic = 'force-dynamic';

const normalizeSearch = (value: string | null) => (value ?? '').trim().toLowerCase();

export async function GET(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const query = normalizeSearch(new URL(request.url).searchParams.get('q'));

  try {
    const friends = await getArcadeFriendUserSummaries(identity.userId);
    const users = query
      ? friends.filter((friend) => friend.name.toLowerCase().includes(query))
      : friends;
    return NextResponse.json({ users: users.slice(0, 100) });
  } catch (error) {
    console.error('Failed to load challenge friends:', error);
    return NextResponse.json({ error: 'Unable to load friends right now.' }, { status: 500 });
  }
}
