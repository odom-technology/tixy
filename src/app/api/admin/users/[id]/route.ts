import { NextResponse } from 'next/server';

import { withAdmin } from '@/server/admin/guard';
import { getAdminUserProfile } from '@/server/admin/users';

export const dynamic = 'force-dynamic';

export const GET = withAdmin<{ id: string }>(async (_request, { params }) => {
  try {
    const profile = await getAdminUserProfile(params.id);
    if (!profile) return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
    return NextResponse.json(profile);
  } catch (error) {
    console.error('[admin-users] profile failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Unable to load this account.' }, { status: 500 });
  }
});
