import { NextResponse } from 'next/server';

import { findActiveDerbyRace } from '@/server/arcade/derby-race/service';

import { derbyUser, noStore } from '../../_derby-route';

export const dynamic = 'force-dynamic';

/** GET: the race you are in, so a reopened page rejoins it. */
export async function GET() {
  const who = await derbyUser('active', { count: 60, windowMs: 60_000 });
  if ('response' in who) return who.response;
  return NextResponse.json({ raceId: await findActiveDerbyRace(who.user.userId), serverNow: Date.now() }, { headers: noStore });
}
