import { cookies } from 'next/headers';

import {
  ACCOUNT_SESSION_COOKIE,
  getIdentityForSessionToken,
} from '@/server/accounts';

export function getFirstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function sanitizeAuthNextPath(value: string | string[] | undefined) {
  const nextPath = getFirstSearchParam(value)?.trim() || '/';
  if (!nextPath.startsWith('/') || nextPath.startsWith('//')) return '/';
  if (
    nextPath.startsWith('/signin') ||
    nextPath.startsWith('/signup') ||
    nextPath.startsWith('/signout')
  ) {
    return '/';
  }
  return nextPath;
}

export async function hasActiveAccountSession() {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(ACCOUNT_SESSION_COOKIE)?.value;
    if (!sessionToken) return false;
    return Boolean(await getIdentityForSessionToken(sessionToken));
  } catch {
    return false;
  }
}
