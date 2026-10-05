import { NextResponse } from 'next/server';

import { withAdmin } from '@/server/admin/guard';
import { AdminQueryError, listAdminUsers } from '@/server/admin/users';

export const dynamic = 'force-dynamic';

export const GET = withAdmin(async (request) => {
  const params = new URL(request.url).searchParams;
  const limitRaw = params.get('limit');
  const limit = limitRaw === null || limitRaw === '' ? null : Number(limitRaw);
  if (limit !== null && !Number.isInteger(limit)) {
    return NextResponse.json({ error: 'Invalid limit.' }, { status: 400 });
  }
  try {
    return NextResponse.json(
      await listAdminUsers({
        q: params.get('q'),
        status: params.get('status'),
        role: params.get('role'),
        sort: params.get('sort'),
        dir: params.get('dir'),
        cursor: params.get('cursor') || null,
        limit,
      }),
    );
  } catch (error) {
    if (error instanceof AdminQueryError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[admin-users] list failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Unable to load users.' }, { status: 500 });
  }
});
