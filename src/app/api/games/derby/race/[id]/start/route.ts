import { NextResponse } from 'next/server';

import { startDerbyRace } from '@/server/arcade/derby-race/service';

import { derbyUser, noStore } from '../../../_derby-route';

export const dynamic = 'force-dynamic';

/** POST: the host opens the gate (bots take the empty lanes). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const who = await derbyUser('start', { count: 20, windowMs: 60_000 });
  if ('response' in who) return who.response;
  const started = await startDerbyRace(id, who.user.userId);
  if (!started.ok) return NextResponse.json({ error: started.error }, { status: 409, headers: noStore });
  return NextResponse.json({ ok: true, serverNow: Date.now() }, { headers: noStore });
}
