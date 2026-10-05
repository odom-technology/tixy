import { NextResponse } from 'next/server';

import { heartbeatDerby, tickRace } from '@/server/arcade/derby-race/service';

import { derbyUser, noStore } from '../../../_derby-route';

export const dynamic = 'force-dynamic';

/** POST: the race page is open. Also the clock sample a phone syncs to. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const who = await derbyUser('heartbeat', { count: 60, windowMs: 60_000 });
  if ('response' in who) return who.response;
  await heartbeatDerby(id, who.user.userId);
  void tickRace(id).catch(() => undefined);
  return NextResponse.json({ serverNow: Date.now() }, { headers: noStore });
}
