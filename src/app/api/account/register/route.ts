import { NextResponse } from 'next/server';
import { isDefaultAvatarSrc } from '@/features/users/avatars';

import {
  ACCOUNT_SESSION_COOKIE,
  createAccount,
  createAccountSession,
  getSessionMaxAgeSeconds,
  shouldUseSecureSessionCookies,
} from '@/server/accounts';
import {
  consumeRegisterRateLimit,
  getClientIp,
  tooManyAttemptsResponse,
} from '@/server/auth/auth-rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: {
    email?: string;
    password?: string;
    username?: string;
    imageUrl?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  if (!body.email?.trim()) {
    return NextResponse.json({ error: 'email is required.' }, { status: 400 });
  }
  if (!body.password) {
    return NextResponse.json({ error: 'password is required.' }, { status: 400 });
  }
  if (!body.username?.trim()) {
    return NextResponse.json({ error: 'username is required.' }, { status: 400 });
  }

  const clientIp = getClientIp(request);
  const rateLimit = consumeRegisterRateLimit(clientIp);
  if (rateLimit.limited) {
    return tooManyAttemptsResponse(rateLimit.retryAfterSeconds);
  }

  try {
    const account = await createAccount({
      email: body.email,
      password: body.password,
      username: body.username,
      // Only a free default may be chosen at sign-up; everything else starts
      // as the house stub.
      imageUrl: body.imageUrl && isDefaultAvatarSrc(body.imageUrl) ? body.imageUrl : undefined,
    });
    const session = await createAccountSession({
      userId: account.id,
      userAgent: request.headers.get('user-agent'),
      ipAddress: clientIp,
    });
    const response = NextResponse.json({ account });
    response.cookies.set(ACCOUNT_SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: shouldUseSecureSessionCookies(),
      path: '/',
      maxAge: getSessionMaxAgeSeconds(session.expiresAt),
    });
    return response;
  } catch (error) {
    const message = (error as Error).message || 'Unable to create account.';
    // Do not reveal whether the email or username already exists.
    const duplicate = message.toLowerCase().includes('unique');
    return NextResponse.json(
      { error: duplicate ? 'Unable to create account.' : message },
      { status: 400 },
    );
  }
}
