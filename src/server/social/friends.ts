import { readAccountSettings } from '@/features/account/account-settings';
import {
  getAccountsByIds,
  listAccountDataForUsers,
  searchAccountsByUsername,
  type AccountPublicProfile,
} from '@/server/accounts';
import {
  getOtherFriendshipUserId,
  listFriendshipsForUser,
  type ArcadeFriendship,
} from '@/server/arcade/multiplayer';
import { listBlockedUsers } from '@/server/social/blocks';

export type FriendSummary = {
  friendshipId: string;
  userId: string;
  name: string;
  imageUrl: string | null;
  requestedAt: number;
};

export type FriendListPayload = {
  friends: FriendSummary[];
  incoming: FriendSummary[];
  outgoing: FriendSummary[];
};

function summarizeAccount(
  account: AccountPublicProfile | undefined,
  friendship: ArcadeFriendship,
  viewerUserId: string,
): FriendSummary | null {
  if (!account || account.status !== 'active') return null;
  return {
    friendshipId: friendship.id,
    userId: getOtherFriendshipUserId(friendship, viewerUserId),
    name: account.username || 'Player',
    imageUrl: account.imageUrl,
    requestedAt: friendship.createdAt,
  };
}

export async function listFriendSummaries(userId: string): Promise<FriendListPayload> {
  const list = await listFriendshipsForUser(userId);
  const all = [...list.friends, ...list.incoming, ...list.outgoing];
  const accounts = await getAccountsByIds(
    all.map((friendship) => getOtherFriendshipUserId(friendship, userId)),
  );
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const hydrate = (rows: ArcadeFriendship[]) =>
    rows
      .map((friendship) =>
        summarizeAccount(
          byId.get(getOtherFriendshipUserId(friendship, userId)),
          friendship,
          userId,
        ),
      )
      .filter((item): item is FriendSummary => item !== null);

  return {
    friends: hydrate(list.friends).sort((a, b) => a.name.localeCompare(b.name)),
    incoming: hydrate(list.incoming),
    outgoing: hydrate(list.outgoing),
  };
}

export type SocialSearchResult = {
  userId: string;
  name: string;
  imageUrl: string | null;
  profileHref: string;
  relationship:
    | { status: 'none' }
    | { status: 'self' }
    | { status: 'friends' | 'incoming' | 'outgoing'; friendshipId: string };
};

export async function searchSocialPlayers(userId: string, rawQuery: string) {
  const query = rawQuery.trim().slice(0, 40);
  if (query.length < 2) return [] as SocialSearchResult[];

  const [accounts, friendships, blockedUserIds] = await Promise.all([
    searchAccountsByUsername(query, 12),
    listFriendshipsForUser(userId),
    listBlockedUsers(userId),
  ]);
  const blocked = new Set(blockedUserIds);
  const settings = await listAccountDataForUsers(accounts.map((account) => account.id), 'settings');
  const relationshipById = new Map<string, SocialSearchResult['relationship']>();
  relationshipById.set(userId, { status: 'self' });
  for (const friendship of friendships.friends) {
    relationshipById.set(getOtherFriendshipUserId(friendship, userId), {
      status: 'friends',
      friendshipId: friendship.id,
    });
  }
  for (const friendship of friendships.incoming) {
    relationshipById.set(getOtherFriendshipUserId(friendship, userId), {
      status: 'incoming',
      friendshipId: friendship.id,
    });
  }
  for (const friendship of friendships.outgoing) {
    relationshipById.set(getOtherFriendshipUserId(friendship, userId), {
      status: 'outgoing',
      friendshipId: friendship.id,
    });
  }

  return accounts
    .filter((account) => {
      if (account.id === userId) return true;
      if (blocked.has(account.id)) return false;
      const visibility = readAccountSettings(settings.get(account.id)?.value).profileVisibility;
      return visibility === 'public' || visibility === 'players';
    })
    .map((account) => ({
      userId: account.id,
      name: account.username || 'Player',
      imageUrl: account.imageUrl,
      profileHref: `/u/${encodeURIComponent(account.username || account.id)}`,
      relationship: relationshipById.get(account.id) ?? { status: 'none' as const },
    }));
}
