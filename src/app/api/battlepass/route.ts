import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { getBattlepassState } from '@/server/arcade/battlepass';

export const dynamic = 'force-dynamic';

export async function GET() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  try {
    const state = await getBattlepassState(identity.userId);
    return NextResponse.json(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load season.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
