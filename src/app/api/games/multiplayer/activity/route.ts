import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { getMultiplayerActivitySnapshot } from '@/server/arcade/multiplayer-activity';
import { getFriendsPresence } from '@/server/realtime/presence';

export const dynamic = 'force-dynamic';

async function getFriendsOnlineCount(): Promise<number | null> {
  try {
    const identity = await requireIdentity({ allowExternal: true });
    const friends = await getFriendsPresence(identity.userId);
    return friends.filter((friend) => friend.status !== 'offline').length;
  } catch {
    // This endpoint remains useful for signed-out visitors, but friend presence
    // is never exposed without an authenticated identity.
    return null;
  }
}

export async function GET() {
  try {
    const [friendsOnline, snapshot] = await Promise.all([
      getFriendsOnlineCount(),
      getMultiplayerActivitySnapshot(),
    ]);
    return NextResponse.json({ ...snapshot, friendsOnline }, {
      headers: {
        'Cache-Control': 'private, no-store',
        Vary: 'Cookie',
      },
    });
  } catch (error) {
    console.error('Failed to load multiplayer activity:', error);
    return NextResponse.json(
      { error: 'Unable to load multiplayer activity.' },
      { status: 500 },
    );
  }
}
