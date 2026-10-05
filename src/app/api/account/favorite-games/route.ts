import { NextResponse } from 'next/server';

import {
  ACCOUNT_PROFILE_DETAILS_KEY,
  MAX_FAVORITE_GAMES,
  readAccountProfileDetails,
  readFavoriteGameSlugs,
} from '@/features/users/account-profile-details';
import { getAccountData, saveAccountData } from '@/server/accounts';
import { requireIdentity } from '@/server/auth';

export const dynamic = 'force-dynamic';

/** Replace the ordered set of homepage/profile favorite games. */
export async function PUT(request: Request) {
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

  const rawSlugs = (body as { gameSlugs?: unknown })?.gameSlugs;
  if (!Array.isArray(rawSlugs)) {
    return NextResponse.json({ error: 'gameSlugs must be an array.' }, { status: 400 });
  }
  if (rawSlugs.length > MAX_FAVORITE_GAMES) {
    return NextResponse.json(
      { error: `Choose up to ${MAX_FAVORITE_GAMES} favorite games.` },
      { status: 400 },
    );
  }

  const favoriteGameSlugs = readFavoriteGameSlugs(rawSlugs);
  if (favoriteGameSlugs.length !== rawSlugs.length) {
    return NextResponse.json(
      { error: 'Favorites must be unique games from the arcade floor.' },
      { status: 400 },
    );
  }

  const record = await getAccountData(identity.userId, ACCOUNT_PROFILE_DETAILS_KEY);
  const details = readAccountProfileDetails(record?.value);
  await saveAccountData({
    userId: identity.userId,
    key: ACCOUNT_PROFILE_DETAILS_KEY,
    value: {
      ...details,
      favoriteGameSlugs,
      favoriteGameSlug: favoriteGameSlugs[0] ?? '',
    },
  });

  return NextResponse.json({ favoriteGameSlugs });
}
