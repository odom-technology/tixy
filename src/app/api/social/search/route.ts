import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { searchSocialPlayers } from '@/server/social/friends';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  const query = new URL(request.url).searchParams.get('q') ?? '';
  try {
    return NextResponse.json({ players: await searchSocialPlayers(identity.userId, query) });
  } catch (error) {
    console.error('Failed to search social players:', error);
    return NextResponse.json({ error: 'Unable to search players.' }, { status: 500 });
  }
}
