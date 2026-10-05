import { NextResponse } from 'next/server';

import { updateAccountPassword } from '@/server/accounts';
import { requireIdentity } from '@/server/auth';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  let body: {
    currentPassword?: string;
    newPassword?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  if (!body.currentPassword || !body.newPassword) {
    return NextResponse.json(
      { error: 'Current password and new password are required.' },
      { status: 400 },
    );
  }

  try {
    await updateAccountPassword({
      userId: identity.userId,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || 'Unable to update password.' },
      { status: 400 },
    );
  }
}
