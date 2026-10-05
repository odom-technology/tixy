import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { getAccountById } from '@/server/accounts';

export const dynamic = 'force-dynamic';

export async function GET() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const account = await getAccountById(identity.userId);
  return NextResponse.json({
    userId: identity.userId,
    email: identity.email ?? account?.email ?? null,
    name: identity.name ?? account?.username ?? null,
    imageUrl: identity.imageUrl ?? account?.imageUrl ?? null,
    roles: identity.roles ?? account?.roles ?? [],
    account,
  });
}
