import { NextResponse } from 'next/server';

import {
  ACCOUNT_SESSION_COOKIE,
  authenticateAccount,
  createAccountSession,
  getSessionMaxAgeSeconds,
  revokeAccountSession,
  shouldUseSecureSessionCookies,
} from '@/server/accounts';
import {
  consumeSigninRateLimit,
  getClientIp,
  resetSigninRateLimit,
  tooManyAttemptsResponse,
} from '@/server/auth/auth-rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: { emailOrUsername?: string; email?: string; password?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const emailOrUsername = body.emailOrUsername?.trim() || body.email?.trim();
  if (!emailOrUsername || !body.password) {
    return NextResponse.json(
      { error: 'emailOrUsername and password are required.' },
      { status: 400 },
    );
  }

  const clientIp = getClientIp(request);
  const rateLimit = consumeSigninRateLimit(emailOrUsername, clientIp);
  if (rateLimit.limited) {
    return tooManyAttemptsResponse(rateLimit.retryAfterSeconds);
  }

  try {
    const account = await authenticateAccount({
      emailOrUsername,
      password: body.password,
    });
    resetSigninRateLimit(emailOrUsername, clientIp);
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
    const message = (error as Error).message || 'Unable to sign in.';
    const suspended = message.toLowerCase().includes('suspended');
    return NextResponse.json(
      { error: message },
      { status: suspended ? 403 : 401 },
    );
  }
}

export async function DELETE(request: Request) {
  const token = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ACCOUNT_SESSION_COOKIE}=`))
    ?.slice(ACCOUNT_SESSION_COOKIE.length + 1);
  if (token) await revokeAccountSession(decodeURIComponent(token));

  const response = NextResponse.json({ success: true });
  response.cookies.set(ACCOUNT_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureSessionCookies(),
    path: '/',
    maxAge: 0,
  });
  return response;
}
