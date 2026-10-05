import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { getAccountData, saveAccountData } from '@/server/accounts';
import { query } from '@/server/db/client';
import {
  ACCOUNT_PROFILE_DETAILS_KEY,
  MAX_FEATURED_ACHIEVEMENTS,
  readAccountProfileDetails,
  readAchievementIds,
} from '@/features/users/account-profile-details';

export const dynamic = 'force-dynamic';

/** Set the achievements a player pins on their profile. Only unlocked ids stick. */
export async function POST(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const requested = readAchievementIds((body as { ids?: unknown })?.ids).slice(
    0,
    MAX_FEATURED_ACHIEVEMENTS,
  );

  // Keep only ids the user has actually unlocked.
  let verified: string[] = [];
  if (requested.length > 0) {
    const rows = await query<{ achievement_id: string }>(
      `SELECT achievement_id FROM user_achievements WHERE user_id = $1 AND achievement_id = ANY($2)`,
      [identity.userId, requested],
    );
    const owned = new Set(rows.rows.map((r) => r.achievement_id));
    verified = requested.filter((id) => owned.has(id));
  }

  const record = await getAccountData(identity.userId, ACCOUNT_PROFILE_DETAILS_KEY);
  const details = readAccountProfileDetails(record?.value);
  await saveAccountData({
    userId: identity.userId,
    key: ACCOUNT_PROFILE_DETAILS_KEY,
    value: { ...details, featuredAchievementIds: verified },
  });

  return NextResponse.json({ featuredAchievementIds: verified });
}
