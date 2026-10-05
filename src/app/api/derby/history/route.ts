import { NextResponse } from 'next/server';

import { query } from '@/server/db/client';
import type { RoundOdds } from '@/server/arcade/derby/derby-shared';

export const dynamic = 'force-dynamic';

/**
 * Recent settled rounds with the seed revealed, for the provably-fair
 * verification page. Anyone can recompute the outcome from `seed`:
 *   odds   = computeRoundOdds(mulberry32(uint32(seed,'form')))
 *   winner = drawWinner(float52(seed,'winner'), odds.m)
 * (see derby/engine.ts computeDerbyOutcome for the exact derivation).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(100, Math.floor(rawLimit)))
    : 20;

  const rows = await query<{
    round_number: string | number;
    seed: string;
    seed_hash: string;
    odds_json: RoundOdds;
    winner_idx: number;
    finish_order_json: number[] | null;
    total_wagered: string | number;
    total_paid: string | number;
    created_at: string | number;
  }>(
    `
      SELECT round_number, seed, seed_hash, odds_json, winner_idx, finish_order_json,
             total_wagered, total_paid,
             (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS created_at
      FROM derby_rounds
      WHERE winner_idx IS NOT NULL AND settled_at IS NOT NULL
      ORDER BY round_number DESC
      LIMIT $1
    `,
    [limit],
  );

  const rounds = rows.rows.map((r) => {
    const winnerIdx = Number(r.winner_idx);
    return {
      roundNumber: Number(r.round_number),
      seedHash: r.seed_hash,
      seed: r.seed,
      odds: r.odds_json,
      winnerIdx,
      winnerMultiplier: r.odds_json?.m?.[winnerIdx] ?? 0,
      finishOrder: r.finish_order_json ?? [],
      totalWagered: Number(r.total_wagered),
      totalPaid: Number(r.total_paid),
      createdAt: Number(r.created_at),
    };
  });

  return NextResponse.json({ rounds });
}
