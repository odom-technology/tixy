import { getAccountById } from '@/server/accounts';
import {
  getOtherFriendshipUserId,
  listFriendshipsForUser,
} from '@/server/arcade/multiplayer';

export type ArcadeFriendUserSummary = {
  userId: string;
  name: string;
  imageUrl: string | null;
};

export async function getArcadeFriendUserSummaries(userId: string) {
  const friendList = await listFriendshipsForUser(userId);
  const summaries = await Promise.all(
    friendList.friends.map(async (friendship) => {
      const friendId = getOtherFriendshipUserId(friendship, userId);
      const account = await getAccountById(friendId);
      if (!account || account.status !== 'active') return null;
      // Email is intentionally never surfaced here — players must not be
      // searchable or identifiable by email. Fall back to a neutral label
      // rather than leaking the address when a username is somehow unset.
      return {
        userId: friendId,
        name: account.username || 'Player',
        imageUrl: account.imageUrl,
      };
    }),
  );
  return summaries
    .filter((summary): summary is ArcadeFriendUserSummary => summary !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}
