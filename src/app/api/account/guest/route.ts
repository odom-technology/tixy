import { NextResponse } from 'next/server';

import {
  createGuestSession,
  getGuestIdentityFromCookies,
  serializeGuestToken,
  buildGuestCookie,
  setGuestCookie,
} from '@/server/auth/guest';

export const dynamic = 'force-dynamic';

export async function POST() {
  const existing = await getGuestIdentityFromCookies();
  const session = existing
    ? {
        identity: existing,
        cookie: buildGuestCookie(serializeGuestToken(existing.userId)),
      }
    : createGuestSession();

  const response = NextResponse.json({
    guest: true,
    userId: session.identity.userId,
  });
  setGuestCookie(response, session.cookie);
  return response;
}
