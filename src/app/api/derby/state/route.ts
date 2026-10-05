import { NextResponse } from 'next/server';

import { getOrCreateRouteIdentity } from '@/server/auth/route-identity';
import { query } from '@/server/db/client';
import { getDerbyEngine } from '@/server/arcade/derby/engine';
import type {
  DerbyMyBet,
  DerbyRecentRound,
  DerbySnapshot,
  RoundOdds,
} from '@/server/arcade/derby/derby-shared';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { identity, attachCookie } = await getOrCreateRouteIdentity();

  const engine = getDerbyEngine();
  await engine.whenReady();

  const round = engine.getPublicRound();
  if (!round) {
    return NextResponse.json({ error: 'Derby is starting up.' }, { status: 503 });
  }
  const script = engine.getCurrentScript();

  const [myBetRows, recentRows] = await Promise.all([
    query<{
      horse_idx: number;
      amount: string | number;
      multiplier: string | number;
      payout: string | number | null;
    }>(
      `
        SELECT horse_idx, amount, multiplier, payout
        FROM derby_bets
        WHERE round_id = $1 AND user_id = $2
        ORDER BY horse_idx ASC
      `,
      [round.id, identity.userId],
    ),
    query<{
      round_number: string | number;
      winner_idx: number;
      seed: string;
      seed_hash: string;
      odds_json: RoundOdds;
    }>(
      `
        SELECT round_number, winner_idx, seed, seed_hash, odds_json
        FROM derby_rounds
        WHERE winner_idx IS NOT NULL AND settled_at IS NOT NULL AND id <> $1
        ORDER BY round_number DESC
        LIMIT 10
      `,
      [round.id],
    ),
  ]);

  const myBets: DerbyMyBet[] = myBetRows.rows.map((r) => ({
    horseIdx: Number(r.horse_idx),
    amount: Number(r.amount),
    multiplier: Number(r.multiplier),
    payout: r.payout === null ? null : Number(r.payout),
  }));

  const recentRounds: DerbyRecentRound[] = recentRows.rows.map((r) => {
    const winnerIdx = Number(r.winner_idx);
    return {
      roundNumber: Number(r.round_number),
      winnerIdx,
      winnerMultiplier: r.odds_json?.m?.[winnerIdx] ?? 0,
      seed: r.seed,
      seedHash: r.seed_hash,
    };
  });

  const snapshot: DerbySnapshot = {
    serverNow: Date.now(),
    round,
    script,
    myBets,
    recentRounds,
    // Chat is owned by Agent B (chat route + table usage). Return empty for now.
    // TODO(agent-b): populate last 30 messages from derby_chat.
    chat: [],
  };

  const response = NextResponse.json(snapshot);
  attachCookie(response);
  return response;
}
