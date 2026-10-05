import { cookies, headers } from 'next/headers';

import {
  ACCOUNT_SESSION_COOKIE,
  getIdentityForSessionToken,
} from '@/server/accounts';
import { getGuestIdentityFromCookies } from './guest';

export type ArcadeIdentity = {
  userId: string;
  email?: string | null;
  name?: string | null;
  imageUrl?: string | null;
  roles?: string[];
  isGuest?: boolean;
};

export type RequireIdentityOptions = {
  allowExternal?: boolean;
  allowGuest?: boolean;
};

export async function requireIdentity(options: RequireIdentityOptions = {}): Promise<ArcadeIdentity> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(ACCOUNT_SESSION_COOKIE)?.value;
  if (sessionToken) {
    const identity = await getIdentityForSessionToken(sessionToken);
    if (identity) return identity;
  }

  if (options.allowGuest) {
    const guestIdentity = await getGuestIdentityFromCookies();
    if (guestIdentity) return guestIdentity;
  }

  const headerIdentity = options.allowExternal
    ? await getTrustedHeaderIdentity()
    : null;
  if (headerIdentity) return headerIdentity;

  throw new Error('Authentication required.');
}

export function getPrimaryEmail(user: {
  emailAddresses?: Array<{ emailAddress?: string | null }>;
  primaryEmailAddress?: { emailAddress?: string | null } | null;
}) {
  return (
    user.primaryEmailAddress?.emailAddress ||
    user.emailAddresses?.find((email) => email.emailAddress)?.emailAddress ||
    null
  );
}

async function getTrustedHeaderIdentity(): Promise<ArcadeIdentity | null> {
  const trustProxyAuth = process.env.ARCADE_TRUST_PROXY_AUTH === 'true';
  if (!trustProxyAuth) return null;

  const headerStore = await headers();
  const userId = headerStore.get('x-arcade-user-id')?.trim();
  if (!userId) return null;

  const roles = (headerStore.get('x-arcade-roles') ?? 'player')
    .split(',')
    .map((role) => role.trim())
    .filter(Boolean);

  return {
    userId,
    email: headerStore.get('x-arcade-email')?.trim() || null,
    name: headerStore.get('x-arcade-name')?.trim() || null,
    imageUrl: headerStore.get('x-arcade-image-url')?.trim() || null,
    roles,
  };
}
