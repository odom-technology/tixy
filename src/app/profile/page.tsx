import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PlayerProfile } from '@/features/users/components/player-profile';
import { ProfileShare } from '@/features/users/components/profile-share';
import { getAccountById } from '@/server/accounts';
import { playerCardHash, playerCardModel } from '@/server/arcade/player-card';
import { cardPath, embedPath } from '@/server/arcade/player-card-access';
import { loadProfileView } from '@/server/arcade/player-profile-view';
import { getAppBaseUrl } from '@/server/arcade/shared-utils';
import { requireIdentity } from '@/server/auth';

export const metadata = {
  title: 'Profile | tixy.lol',
};

export default async function ProfilePage() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    redirect('/signin?next=/profile');
  }

  const account = await getAccountById(identity.userId);
  if (!account) redirect('/signin?next=/profile');

  const view = await loadProfileView(account);
  const model = playerCardModel(view, getAppBaseUrl());

  return (
    <PlayerProfile
      view={view}
      self
      actions={
        <>
          <Link href='/settings?tab=profile' className='tp-btn' data-size='sm'>
            <span>edit</span>
          </Link>
          <ProfileShare
            name={view.name}
            profilePath={view.href}
            cardPath={`${cardPath(view.href)}?v=${playerCardHash(model)}`}
            embedPath={embedPath(view.href)}
            isPublic={view.visibility === 'public'}
            self
          />
          <Link href={view.href} className='tp-btn' data-tone='quiet' data-size='sm'>
            <span>public view</span>
          </Link>
        </>
      }
    />
  );
}
