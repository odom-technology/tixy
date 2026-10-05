import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { isGuestIdentity } from '@/server/auth/guest';
import { queryOne } from '@/server/db/client';

import { noStore } from '../_derby-route';

export const dynamic = 'force-dynamic';

/** GET: your races, wins and top-three finishes, for the strip. */
export async function GET() {
  const identity = await requireIdentity({ allowExternal: true, allowGuest: true }).catch(() => null);
  if (!identity || isGuestIdentity(identity)) return NextResponse.json({ wins: null }, { headers: noStore });
  const row = await queryOne<{ races: number; wins: number; podiums: number }>(
    `SELECT races, wins, podiums FROM derby_stats WHERE od_user_id = $1`,
    [identity.userId],
  );
  return NextResponse.json({ races: row?.races ?? 0, wins: row?.wins ?? 0, podiums: row?.podiums ?? 0 }, { headers: noStore });
}
