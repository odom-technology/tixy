import { readAccountSettings } from '@/features/account/account-settings';
import { getArcadeGameBySlug } from '@/features/arcade/components/arcade-game-registry';
import { getGameDisplayName } from '@/features/arcade/lib/game-renames';
import {
  ACCOUNT_PROFILE_DETAILS_KEY,
  readAccountProfileDetails,
} from '@/features/users/account-profile-details';
import {
  listAccountDataForUsers,
  listAccounts,
  searchAccountsByUsername,
  type AccountPublicProfile,
} from '@/server/accounts';
import { getAccountLevelsForUsers } from '@/server/arcade/levels';
import { getMostPlayedGamesForUsers } from '@/server/arcade/profile-overview';
import { requireIdentity, type ArcadeIdentity } from '@/server/auth';
import { isGuestIdentity } from '@/server/auth/guest';
import { listFriendSummaries } from '@/server/social/friends';

import { PlayerDirectory, type DirectoryPlayer } from './_player-directory-client';

type PlayersPageProps = {
  searchParams?: Promise<{
    q?: string | string[];
  }>;
};

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Players | tixy.lol',
};

async function getOptionalIdentity() {
  try {
    return await requireIdentity({ allowExternal: true, allowGuest: true });
  } catch {
    return null;
  }
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function canListProfile(input: {
  account: AccountPublicProfile;
  identity: ArcadeIdentity | null;
  visibility: 'public' | 'players' | 'private';
}) {
  const isOwner = input.identity?.userId === input.account.id;
  const isAdmin = input.identity?.roles?.includes('admin') ?? false;
  if (isOwner || isAdmin) return true;
  if (input.account.status !== 'active') return false;
  if (input.visibility === 'public') return true;
  if (input.visibility === 'players') return Boolean(input.identity);
  return false;
}

function profileHref(person: { id: string; username: string | null }) {
  return `/u/${encodeURIComponent(person.username ?? person.id)}`;
}

/* Friends, requests and sent requests come first and always show (search
   narrows them by name); everyone else is the newest 80, or the search's
   matches, minus private profiles. */
export default async function PlayersPage({ searchParams }: PlayersPageProps) {
  const params = searchParams ? await searchParams : {};
  const query = firstParam(params.q)?.trim().slice(0, 80) ?? '';
  const [identity, accounts] = await Promise.all([
    getOptionalIdentity(),
    query ? searchAccountsByUsername(query, 80) : listAccounts({ status: 'active', limit: 80 }),
  ]);
  const accountIdentity = identity && !isGuestIdentity(identity) ? identity : null;
  const viewerKind = accountIdentity ? 'account' : identity ? 'guest' : 'visitor';
  const relationships = accountIdentity
    ? await listFriendSummaries(accountIdentity.userId)
    : { friends: [], incoming: [], outgoing: [] };

  const needle = query.toLowerCase();
  const matches = (name: string) => !needle || name.toLowerCase().includes(needle);
  const people = new Map<string, Omit<DirectoryPlayer, 'level' | 'game'>>();
  for (const [list, status] of [
    [relationships.incoming, 'incoming'],
    [relationships.friends, 'friends'],
    [relationships.outgoing, 'outgoing'],
  ] as const) {
    for (const friend of list) {
      if (!matches(friend.name) || people.has(friend.userId)) continue;
      people.set(friend.userId, {
        id: friend.userId,
        name: friend.name,
        imageUrl: friend.imageUrl,
        href: `/u/${encodeURIComponent(friend.userId)}`,
        relationship: { status, friendshipId: friend.friendshipId },
      });
    }
  }

  const others = accounts.filter(
    (account) => !people.has(account.id) && account.id !== accountIdentity?.userId,
  );
  const settingsByUser = await listAccountDataForUsers(others.map((account) => account.id), 'settings');
  for (const account of others) {
    const visibility = readAccountSettings(settingsByUser.get(account.id)?.value).profileVisibility;
    if (!canListProfile({ account, identity: accountIdentity, visibility })) continue;
    people.set(account.id, {
      id: account.id,
      name: account.username ?? 'player',
      imageUrl: account.imageUrl,
      href: profileHref(account),
      relationship: { status: 'none' },
    });
  }

  const ids = [...people.keys()];
  const [detailsByUser, levelByUser, mostPlayedByUser] = await Promise.all([
    listAccountDataForUsers(ids, ACCOUNT_PROFILE_DETAILS_KEY),
    getAccountLevelsForUsers(ids),
    getMostPlayedGamesForUsers(ids),
  ]);

  const players: DirectoryPlayer[] = [...people.values()].map((person) => {
    // The player's own pick first, then what they play most.
    const favorite = readAccountProfileDetails(detailsByUser.get(person.id)?.value).favoriteGameSlugs[0];
    const game = (favorite ? getArcadeGameBySlug(favorite) : null) ?? getArcadeGameBySlug(mostPlayedByUser.get(person.id)?.slug ?? '');
    return {
      ...person,
      level: levelByUser.get(person.id)?.level ?? 1,
      game: game ? getGameDisplayName(game.slug, game.title).toLowerCase() : null,
    };
  });

  return (
    <PlayerDirectory
      players={players}
      query={query}
      currentUserId={accountIdentity?.userId ?? null}
      viewerKind={viewerKind}
    />
  );
}
