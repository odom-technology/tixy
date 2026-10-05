import { NextResponse } from 'next/server';

import { getAccountById } from '@/server/accounts';
import { requireIdentity } from '@/server/auth';
import { getFriendsPresence } from '@/server/realtime/presence';
import { listBlockedUsers } from '@/server/social/blocks';
import { listFriendSummaries } from '@/server/social/friends';
import {
  getArcadeLobbyUnreadCount,
  listConversationsForUser,
} from '@/server/social/messaging';

export const dynamic = 'force-dynamic';

export async function GET() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  try {
    const [account, relationships, presence, conversations, lobbyUnreadCount, blockedUserIds] =
      await Promise.all([
        getAccountById(identity.userId),
        listFriendSummaries(identity.userId),
        getFriendsPresence(identity.userId),
        listConversationsForUser(identity.userId),
        getArcadeLobbyUnreadCount(identity.userId),
        listBlockedUsers(identity.userId),
      ]);
    return NextResponse.json({
      currentUser: {
        userId: identity.userId,
        name: account?.username || identity.name || 'Player',
        imageUrl: account?.imageUrl ?? null,
        isAdmin: identity.roles?.includes('admin') ?? false,
      },
      ...relationships,
      presence,
      conversations,
      lobbyUnreadCount,
      blockedUserIds,
    });
  } catch (error) {
    console.error('Failed to load social bootstrap:', error);
    return NextResponse.json({ error: 'Unable to load social right now.' }, { status: 500 });
  }
}
