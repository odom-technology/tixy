import { NextResponse } from 'next/server';

import { withAdmin } from '@/server/admin/guard';
import { AdminQueryError, listUserLedger } from '@/server/admin/users';

export const dynamic = 'force-dynamic';

export const GET = withAdmin<{ id: string }>(async (request, { params }) => {
  const search = new URL(request.url).searchParams;
  const limitRaw = search.get('limit');
  const limit = limitRaw === null || limitRaw === '' ? null : Number(limitRaw);
  if (limit !== null && !Number.isInteger(limit)) {
    return NextResponse.json({ error: 'Invalid limit.' }, { status: 400 });
  }
  try {
    return NextResponse.json(
      await listUserLedger({
        userId: params.id,
        source: search.get('source'),
        ledger: search.get('ledger'),
        cursor: search.get('cursor') || null,
        limit,
      }),
    );
  } catch (error) {
    if (error instanceof AdminQueryError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[admin-users] ledger failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Unable to load the ledger.' }, { status: 500 });
  }
});
