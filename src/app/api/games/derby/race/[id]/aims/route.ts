import { NextResponse } from 'next/server';

import { submitDerbyAims, type DerbyAimInput } from '@/server/arcade/derby-race/service';

import { derbyUser, noStore, readJson } from '../../../_derby-route';

export const dynamic = 'force-dynamic';

/**
 * POST { from, samples }: a batch of your aim, flat [x, y, squirt] integers
 * per tick from tick `from`. The server keeps the ticks it may still take,
 * stores and publishes them, and answers with what it kept and where to
 * send from next.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // A batch every 200 ms is 300 a minute: 420 leaves room for retries.
  const who = await derbyUser('aims', { count: 420, windowMs: 60_000 });
  if ('response' in who) return who.response;
  const body = await readJson<DerbyAimInput>(request);
  const result = await submitDerbyAims(id, who.user, { from: body.from, samples: body.samples });
  if (result.ok === false) {
    return NextResponse.json(
      { error: result.error, reason: result.reason, next: result.next, serverNow: result.serverNow },
      { status: result.status, headers: noStore },
    );
  }
  return NextResponse.json(
    { kept: result.kept, next: result.next, sealed: result.sealed, serverNow: result.serverNow },
    { headers: noStore },
  );
}
