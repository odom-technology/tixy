import { NextResponse } from 'next/server';

import { recoverAccountWithCode } from '@/server/account-recovery';
import {
  ACCOUNT_SESSION_COOKIE,
  createAccountSession,
  getSessionMaxAgeSeconds,
  shouldUseSecureSessionCookies,
} from '@/server/accounts';
import {
  consumeRecoverRateLimit,
  getClientIp,
  tooManyAttemptsResponse,
} from '@/server/auth/auth-rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: {
    email?: string;
    recoveryCode?: string;
    newPassword?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  if (!body.email?.trim() || !body.recoveryCode?.trim() || !body.newPassword) {
    return NextResponse.json(
      { error: 'Email, recovery code, and new password are required.' },
      { status: 400 },
    );
  }

  const clientIp = getClientIp(request);
  const rateLimit = consumeRecoverRateLimit(body.email, clientIp);
  if (rateLimit.limited) {
    return tooManyAttemptsResponse(rateLimit.retryAfterSeconds);
  }

  try {
    const { account, summary } = await recoverAccountWithCode({
      email: body.email,
      recoveryCode: body.recoveryCode,
      newPassword: body.newPassword,
    });
    const session = await createAccountSession({
      userId: account.id,
      userAgent: request.headers.get('user-agent'),
      ipAddress: clientIp,
    });
    const response = NextResponse.json({ account, summary });
    response.cookies.set(ACCOUNT_SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: shouldUseSecureSessionCookies(),
      path: '/',
      maxAge: getSessionMaxAgeSeconds(session.expiresAt),
    });
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || 'Unable to recover account.' },
      { status: 400 },
    );
  }
}
