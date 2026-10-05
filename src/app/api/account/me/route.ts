import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import {
  ACCOUNT_SESSION_COOKIE,
  getAccountById,
  revokeAllAccountSessions,
  setAccountStatus,
  updateAccountProfile,
  shouldUseSecureSessionCookies,
} from '@/server/accounts';

export const dynamic = 'force-dynamic';

export async function GET() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const account = await getAccountById(identity.userId);
  if (!account) {
    return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
  }
  return NextResponse.json({ account });
}

export async function PATCH(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  let body: {
    username?: string | null;
    imageUrl?: string | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  try {
    const account = await updateAccountProfile({
      userId: identity.userId,
      username: body.username,
      imageUrl: body.imageUrl,
    });
    return NextResponse.json({ account });
  } catch (error) {
    const message = (error as Error).message || 'Unable to update account.';
    const duplicate = message.toLowerCase().includes('unique');
    return NextResponse.json(
      { error: duplicate ? 'Username is already in use.' : message },
      { status: duplicate ? 409 : 400 },
    );
  }
}

export async function DELETE(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  let reason: string | null = null;
  try {
    const body = (await request.json()) as { reason?: string };
    reason = body.reason?.trim() || null;
  } catch {
    // Body optional
  }

  const account = await setAccountStatus({
    userId: identity.userId,
    status: 'deleted',
    actorUserId: identity.userId,
    reason,
  });
  await revokeAllAccountSessions(identity.userId);

  const response = NextResponse.json({ success: true, account });
  response.cookies.set(ACCOUNT_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureSessionCookies(),
    path: '/',
    maxAge: 0,
  });
  return response;
}
