import { redirect } from 'next/navigation';

import { AppPageFrame } from '@/features/arcade/components/shell/page-frame';
import { requireIdentity } from '@/server/auth';
import { getAchievementsForUser } from '@/server/arcade/achievements';
import { getAccountData } from '@/server/accounts';
import {
  ACCOUNT_PROFILE_DETAILS_KEY,
  readAccountProfileDetails,
} from '@/features/users/account-profile-details';

import { AchievementsClient } from './_achievements-client';

export const metadata = {
  title: 'Achievements | tixy.lol',
};

export const dynamic = 'force-dynamic';

export default async function AchievementsPage() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    redirect('/signin?next=/achievements');
  }

  const [data, detailsRecord] = await Promise.all([
    getAchievementsForUser(identity.userId),
    getAccountData(identity.userId, ACCOUNT_PROFILE_DETAILS_KEY),
  ]);
  const details = readAccountProfileDetails(detailsRecord?.value);

  return (
    <AppPageFrame
      title='achievements'
      subtitle='Tiers fill the rim of a badge. Secrets show a hint until you find them.'
      contentClassName='space-y-6'
    >
      <AchievementsClient
        initial={data}
        initialFeatured={details.featuredAchievementIds}
      />
    </AppPageFrame>
  );
}
