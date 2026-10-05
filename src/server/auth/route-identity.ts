import type { NextResponse } from 'next/server';

import { requireIdentity, type ArcadeIdentity } from '@/server/auth';

import {
  buildGuestCookie,
  createGuestSession,
  getGuestIdentityFromCookies,
  serializeGuestToken,
  setGuestCookie,
} from './guest';

export type RouteIdentityResult = {
  identity: ArcadeIdentity;
  attachCookie: (response: NextResponse) => void;
};

export async function getOrCreateRouteIdentity({
  allowExternal = true,
}: {
  allowExternal?: boolean;
} = {}): Promise<RouteIdentityResult> {
  try {
    return {
      identity: await requireIdentity({ allowExternal, allowGuest: true }),
      attachCookie: () => {},
    };
  } catch {
    const existing = await getGuestIdentityFromCookies();
    const session = existing
      ? {
          identity: existing,
          cookie: buildGuestCookie(serializeGuestToken(existing.userId)),
        }
      : createGuestSession();

    return {
      identity: session.identity,
      attachCookie: (response) => setGuestCookie(response, session.cookie),
    };
  }
}
