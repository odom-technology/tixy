import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { getAchievementsForUser } from '@/server/arcade/achievements';
import { getAccountData } from '@/server/accounts';
import {
  ACCOUNT_PROFILE_DETAILS_KEY,
  readAccountProfileDetails,
} from '@/features/users/account-profile-details';

export const dynamic = 'force-dynamic';

export async function GET() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  try {
    const [data, detailsRecord] = await Promise.all([
      getAchievementsForUser(identity.userId),
      getAccountData(identity.userId, ACCOUNT_PROFILE_DETAILS_KEY),
    ]);
    const details = readAccountProfileDetails(detailsRecord?.value);
    return NextResponse.json({
      ...data,
      featuredAchievementIds: details.featuredAchievementIds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load achievements.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
