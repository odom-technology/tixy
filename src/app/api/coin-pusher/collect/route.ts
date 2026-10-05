import { NextResponse } from 'next/server';

import { collectCoinPusher } from '@/server/arcade/coin-pusher';

import { coinPusherError, coinPusherGate } from '../_shared';

export const dynamic = 'force-dynamic';

/** { requestId, step }: step the machine to a moment already drawn, and pay. */
export async function POST(request: Request) {
  const gate = await coinPusherGate('collect');
  if ('response' in gate) return gate.response;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }
  try {
    return NextResponse.json(await collectCoinPusher(gate.userId, gate.userName, { requestId: body.requestId, step: body.step }));
  } catch (error) {
    return coinPusherError(error);
  }
}
