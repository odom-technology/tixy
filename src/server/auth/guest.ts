import crypto from 'node:crypto';

import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';

export const GUEST_SESSION_COOKIE = 'arcade_guest';
const GUEST_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

export type GuestIdentity = {
  userId: string;
  email: null;
  name: string;
  imageUrl: null;
  roles: ['guest'];
  isGuest: true;
};

type GuestCookie = {
  name: typeof GUEST_SESSION_COOKIE;
  value: string;
  options: {
    httpOnly: true;
    sameSite: 'lax';
    secure: boolean;
    path: '/';
    maxAge: number;
  };
};

const getGuestCookieSecret = () => {
  const secret =
    process.env.GUEST_SESSION_SECRET?.trim() ||
    process.env.GAME_SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error('GAME_SESSION_SECRET is required for guest sessions.');
  }
  return secret;
};

const signGuestUserId = (userId: string) =>
  crypto
    .createHmac('sha256', getGuestCookieSecret())
    .update(userId)
    .digest('base64url');

const isValidGuestUserId = (userId: string) =>
  /^guest:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    userId,
  );

export const isGuestUserId = (userId: string | null | undefined) =>
  Boolean(userId?.startsWith('guest:'));

export const isGuestIdentity = (
  identity: { userId?: string | null; isGuest?: boolean } | null | undefined,
) => Boolean(identity?.isGuest || isGuestUserId(identity?.userId));

export const createGuestUserId = () => `guest:${crypto.randomUUID()}`;

export function serializeGuestToken(userId: string) {
  if (!isValidGuestUserId(userId)) {
    throw new Error('Invalid guest user id.');
  }
  return `${userId}.${signGuestUserId(userId)}`;
}

export function parseGuestToken(value: string | null | undefined) {
  if (!value) return null;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const userId = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  if (!isValidGuestUserId(userId)) return null;
  const expected = signGuestUserId(userId);
  const actual = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length) return null;
  if (!crypto.timingSafeEqual(actual, wanted)) return null;
  return toGuestIdentity(userId);
}

export function toGuestIdentity(userId: string): GuestIdentity {
  return {
    userId,
    email: null,
    name: 'Guest',
    imageUrl: null,
    roles: ['guest'],
    isGuest: true,
  };
}

export async function getGuestIdentityFromCookies() {
  const cookieStore = await cookies();
  return parseGuestToken(cookieStore.get(GUEST_SESSION_COOKIE)?.value);
}

export function createGuestSession() {
  const identity = toGuestIdentity(createGuestUserId());
  return {
    identity,
    cookie: buildGuestCookie(serializeGuestToken(identity.userId)),
  };
}

export function buildGuestCookie(value: string): GuestCookie {
  return {
    name: GUEST_SESSION_COOKIE,
    value,
    options: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: GUEST_COOKIE_MAX_AGE_SECONDS,
    },
  };
}

export function setGuestCookie(response: NextResponse, cookie: GuestCookie) {
  response.cookies.set(cookie.name, cookie.value, cookie.options);
}
