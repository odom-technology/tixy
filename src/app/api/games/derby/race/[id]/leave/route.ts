import { NextResponse } from 'next/server';

import { leaveDerbyRace } from '@/server/arcade/derby-race/service';

import { derbyUser, noStore } from '../../../_derby-route';

export const dynamic = 'force-dynamic';

/** POST: leave a lobby, or forfeit a race (no tickets). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const who = await derbyUser('leave', { count: 30, windowMs: 60_000 });
  if ('response' in who) return who.response;
  await leaveDerbyRace(id, who.user.userId);
  return NextResponse.json({ ok: true }, { headers: noStore });
}
