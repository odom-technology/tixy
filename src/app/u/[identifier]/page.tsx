import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { PlayerProfile } from '@/features/users/components/player-profile';
import { ProfileShare } from '@/features/users/components/profile-share';
import { recordProfileView } from '@/server/arcade/stats';
import {
  canViewProfile,
  getAccountByIdentifier,
  loadProfileView,
  readProfileVisibility,
} from '@/server/arcade/player-profile-view';
import { cardPath, embedPath } from '@/server/arcade/player-card-access';
import { playerCardHash, playerCardModel, CARD_HEIGHT, CARD_WIDTH } from '@/server/arcade/player-card';
import { getAppBaseUrl } from '@/server/arcade/shared-utils';
import { requireIdentity, type ArcadeIdentity } from '@/server/auth';
import { isGuestIdentity } from '@/server/auth/guest';
import {
  getOtherFriendshipUserId,
  listFriendshipsForUser,
} from '@/server/arcade/multiplayer';
import {
  FriendActionBar,
  type FriendRelationship,
} from '@/features/social/friend-action-bar';

import '@/features/social/tixy-people.css';

export const dynamic = 'force-dynamic';

type PublicProfilePageProps = {
  params: Promise<{ identifier: string }>;
};

async function getOptionalIdentity() {
  try {
    return await requireIdentity({ allowExternal: true, allowGuest: true });
  } catch {
    return null;
  }
}

/* generateMetadata and the page read the same account and profile once. */
const readAccount = cache(getAccountByIdentifier);
const readView = cache(async (identifier: string) => {
  const account = await readAccount(identifier);
  return account ? loadProfileView(account) : null;
});

async function getFriendRelationship(
  identity: ArcadeIdentity | null,
  targetUserId: string,
): Promise<FriendRelationship> {
  if (!identity || isGuestIdentity(identity)) return { status: 'none' };
  if (identity.userId === targetUserId) return { status: 'self' };

  const friendships = await listFriendshipsForUser(identity.userId);
  for (const friendship of friendships.friends) {
    if (getOtherFriendshipUserId(friendship, identity.userId) === targetUserId) {
      return { status: 'friends', friendshipId: friendship.id };
    }
  }
  for (const friendship of friendships.incoming) {
    if (getOtherFriendshipUserId(friendship, identity.userId) === targetUserId) {
      return { status: 'incoming', friendshipId: friendship.id };
    }
  }
  for (const friendship of friendships.outgoing) {
    if (getOtherFriendshipUserId(friendship, identity.userId) === targetUserId) {
      return { status: 'outgoing', friendshipId: friendship.id };
    }
  }
  return { status: 'none' };
}

/* Only a public profile gets a card in its link preview: a players-only or
   private profile shares a title and nothing else. */
export async function generateMetadata({ params }: PublicProfilePageProps): Promise<Metadata> {
  const { identifier } = await params;
  const account = await readAccount(identifier);
  const name = account?.username ?? 'player';
  const title = `${name} | tixy.lol`;
  if (!account || account.status !== 'active') return { title };
  const visibility = await readProfileVisibility(account.id);
  if (visibility !== 'public') return { title, robots: { index: false } };
  const view = await readView(identifier);
  if (!view) return { title };
  const model = playerCardModel(view, getAppBaseUrl());
  const image = {
    url: `${cardPath(view.href)}?v=${playerCardHash(model)}`,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    alt: `${name}'s player card on tixy.lol`,
  };
  const description = [
    `Level ${model.level}.`,
    model.featured ? `${model.featured.value.toLocaleString('en-US')} ${model.featured.label} in ${model.featured.game}.` : null,
    `${model.achievements.unlocked} of ${model.achievements.total} achievements.`,
  ]
    .filter(Boolean)
    .join(' ');
  return {
    title,
    description,
    openGraph: { title: `${name} on tixy.lol`, description, url: view.href, type: 'profile', images: [image] },
    twitter: { card: 'summary_large_image', title: `${name} on tixy.lol`, description, images: [image] },
  };
}

export default async function PublicProfilePage({ params }: PublicProfilePageProps) {
  const [{ identifier }, identity] = await Promise.all([
    params,
    getOptionalIdentity(),
  ]);
  const account = await readAccount(identifier);
  if (!account || account.status === 'deleted') notFound();
  const accountIdentity = identity && !isGuestIdentity(identity) ? identity : null;
  const viewerKind = accountIdentity ? 'account' : identity ? 'guest' : 'visitor';

  const [visibility, relationship] = await Promise.all([
    readProfileVisibility(account.id),
    getFriendRelationship(accountIdentity, account.id),
  ]);
  const profileHref = `/u/${encodeURIComponent(account.username ?? account.id)}`;

  if (!canViewProfile({ account, viewer: accountIdentity, visibility })) {
    return (
      <div className='tp tp-page'>
        <section className='tp-locked'>
          <h1>{account.username ?? 'player'}</h1>
          <p>This profile is private.</p>
          {!accountIdentity && visibility === 'players' ? (
            <Link href={`/signin?next=${encodeURIComponent(profileHref)}`} className='tp-btn'>
              <span>sign in to see it</span>
            </Link>
          ) : null}
        </section>
      </div>
    );
  }

  // Lurker: a signed-in player viewing someone else's profile.
  if (accountIdentity && accountIdentity.userId !== account.id) {
    void recordProfileView(accountIdentity.userId, account.id);
  }

  const view = await readView(identifier);
  if (!view) notFound();
  const self = relationship.status === 'self';
  const model = playerCardModel(view, getAppBaseUrl());
  const share = (
    <ProfileShare
      name={view.name}
      profilePath={view.href}
      cardPath={`${cardPath(view.href)}?v=${playerCardHash(model)}`}
      embedPath={embedPath(view.href)}
      isPublic={view.visibility === 'public'}
      self={self}
    />
  );

  return (
    <PlayerProfile
      view={view}
      self={self}
      actions={
        self ? (
          <>
            <Link href='/settings?tab=profile' className='tp-btn' data-size='sm'>
              <span>edit</span>
            </Link>
            {share}
          </>
        ) : (
          <>
            <FriendActionBar
              currentUserId={accountIdentity?.userId ?? null}
              targetUserId={account.id}
              targetName={view.name}
              viewerKind={viewerKind}
              initialRelationship={relationship}
              profileHref={profileHref}
            />
            {share}
          </>
        )
      }
    />
  );
}
