import { NextResponse } from 'next/server';

import { dropCoinPusher } from '@/server/arcade/coin-pusher';

import { coinPusherError, coinPusherGate } from '../_shared';

export const dynamic = 'force-dynamic';

/** { requestId, bet, x, step }: pour bet / 5 coins. A repeat returns the first answer. */
export async function POST(request: Request) {
  const gate = await coinPusherGate('drop');
  if ('response' in gate) return gate.response;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }
  try {
    return NextResponse.json(
      await dropCoinPusher(gate.userId, gate.userName, {
        requestId: body.requestId,
        bet: body.bet,
        x: body.x,
        step: body.step,
      }),
    );
  } catch (error) {
    return coinPusherError(error);
  }
}
