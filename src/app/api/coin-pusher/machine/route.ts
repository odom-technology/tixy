import { NextResponse } from 'next/server';

import { loadCoinPusher } from '@/server/arcade/coin-pusher';

import { coinPusherError, coinPusherGate } from '../_shared';

export const dynamic = 'force-dynamic';

/** The player's machine, stepped to now. Coins that fell since are paid. */
export async function GET() {
  const gate = await coinPusherGate('machine');
  if ('response' in gate) return gate.response;
  try {
    return NextResponse.json(await loadCoinPusher(gate.userId, gate.userName));
  } catch (error) {
    return coinPusherError(error);
  }
}
