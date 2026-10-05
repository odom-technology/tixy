import { NextResponse } from 'next/server';

import {
  ACCOUNT_SESSION_COOKIE,
  listAccountSessions,
  revokeOtherAccountSessions,
} from '@/server/accounts';
import { requireIdentity } from '@/server/auth';

export const dynamic = 'force-dynamic';

function getSessionToken(request: Request) {
  const rawToken = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ACCOUNT_SESSION_COOKIE}=`))
    ?.slice(ACCOUNT_SESSION_COOKIE.length + 1);
  return rawToken ? decodeURIComponent(rawToken) : null;
}

async function readSessions(userId: string, currentToken: string | null) {
  return {
    sessions: await listAccountSessions({
      userId,
      currentToken,
    }),
  };
}

export async function GET(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  return NextResponse.json(
    await readSessions(identity.userId, getSessionToken(request)),
  );
}

export async function PATCH(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  let body: { action?: 'revoke-other-sessions' };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const currentToken = getSessionToken(request);
  if (body.action !== 'revoke-other-sessions') {
    return NextResponse.json({ error: 'Invalid session action.' }, { status: 400 });
  }
  if (!currentToken) {
    return NextResponse.json(
      { error: 'Current session token is required.' },
      { status: 400 },
    );
  }

  await revokeOtherAccountSessions({
    userId: identity.userId,
    currentToken,
  });

  return NextResponse.json(await readSessions(identity.userId, currentToken));
}
