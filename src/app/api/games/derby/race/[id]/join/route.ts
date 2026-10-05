import { NextResponse } from 'next/server';

import { getDerbySnapshot, joinDerbyRace } from '@/server/arcade/derby-race/service';

import { derbyUser, noStore } from '../../../_derby-route';

export const dynamic = 'force-dynamic';

/** POST: take a lane in a lobby, or come back to your lane in a race. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const who = await derbyUser('join', { count: 30, windowMs: 60_000 });
  if ('response' in who) return who.response;
  const joined = await joinDerbyRace(id, who.user);
  if (joined.ok === false) return NextResponse.json({ error: joined.error }, { status: joined.status, headers: noStore });
  return NextResponse.json({ snapshot: await getDerbySnapshot(id, who.user.userId) }, { headers: noStore });
}
