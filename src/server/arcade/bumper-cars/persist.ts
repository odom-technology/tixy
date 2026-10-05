/* Bumper cars in the database: the round row when the power comes on, and
   the one settle at the horn. Settling is a compare-and-swap from live to
   settled inside a transaction with the players' rows; only the request
   that wins the swap pays, and each payout is keyed by round and player in
   the ledger, so neither a retry nor a second server can pay twice. */

import { roundScore } from '@/features/arcade/lib/bumper-cars/rules';
import { query, withTransaction } from '@/server/db/client';
import { addAntiCheatLog } from '@/server/arcade/anti-cheat-logs';
import { recordMatchRunResult } from '@/server/arcade/match-run-results';
import { awardGameRunCredits } from '@/server/arcade/rewards/wallet';
import type { BumperReward, BumperRoom, SettleOutcome, SettleRequest } from './rooms';

export const BUMPER_GAME_TYPE = 'bumper-cars' as const;

export async function writeRoundStart(room: BumperRoom): Promise<void> {
  if (!room.roundId) return;
  const humans = room.seats.filter((s) => s.kind === 'human');
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO bumper_car_rounds (id, room_id, room_code, status, seed, cars, humans, started_at)
       VALUES ($1, $2, $3, 'live', $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [room.roundId, room.id, room.code, room.seed, room.seats.filter((s) => s.kind !== 'empty').length, humans.length, room.startedAt],
    );
    for (let i = 0; i < room.seats.length; i += 1) {
      const seat = room.seats[i]!;
      if (seat.kind !== 'human' || !seat.userId) continue;
      await client.query(
        `INSERT INTO bumper_car_players (round_id, seat, user_id, user_name, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [room.roundId, i, seat.userId, seat.name, room.startedAt],
      );
    }
  });
}

/** Rounds left live by a server that stopped: void, unpaid. */
export async function voidStaleRounds(before: number): Promise<number> {
  const result = await query(`UPDATE bumper_car_rounds SET status = 'void', ended_at = $1 WHERE status = 'live' AND started_at < $1`, [before]);
  return result.rowCount ?? 0;
}

export async function settleRound(req: SettleRequest): Promise<SettleOutcome> {
  const now = Date.now();
  const won = await withTransaction(async (client) => {
    // The round row may be missing if its start write failed: make it now.
    await client.query(
      `INSERT INTO bumper_car_rounds (id, room_id, room_code, status, seed, cars, humans, started_at)
       VALUES ($1, $2, $3, 'live', $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [req.roundId, req.roomId, req.code, req.seed, req.cars, req.players.length, req.startedAt],
    );
    const swap = await client.query(
      `UPDATE bumper_car_rounds
          SET status = 'settled', ended_at = $2, settled_at = $2, final_tick = $3, standings_json = $4
        WHERE id = $1 AND status = 'live'
        RETURNING id`,
      [req.roundId, now, req.finalTick, JSON.stringify(req.standings)],
    );
    if (swap.rowCount === 0) return false;
    for (const p of req.players) {
      const score = p.result === 'forfeit' ? 0 : roundScore(p.points, p.place, req.cars);
      await client.query(
        `INSERT INTO bumper_car_players (round_id, seat, user_id, user_name, points, bumps, place, result, score, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (round_id, seat) DO UPDATE
           SET points = EXCLUDED.points, bumps = EXCLUDED.bumps, place = EXCLUDED.place,
               result = EXCLUDED.result, score = EXCLUDED.score`,
        [req.roundId, p.seat, p.userId, p.name, p.points, p.bumps, p.place, p.result, score, req.startedAt],
      );
    }
    return true;
  });

  const rewards = new Map<string, BumperReward>();
  if (!won) return { settled: false, rewards };

  // Pay after the commit. A forfeit pays nothing; a player who was gone at
  // the horn is paid for what they scored while they drove.
  for (const p of req.players) {
    if (p.result === 'forfeit') {
      rewards.set(p.userId, { tickets: 0, wanted: 0, balanceAfter: null, score: 0 });
      continue;
    }
    const score = roundScore(p.points, p.place, req.cars);
    try {
      const context = { gameType: 'bumper-cars' as const, score, points: p.points, bumps: p.bumps, place: p.place, cars: req.cars };
      const reward = await awardGameRunCredits({
        userId: p.userId,
        context,
        sourceId: `bumper-cars:${req.roundId}:${p.userId}`,
        meta: { roundId: req.roundId, roomId: req.roomId, points: p.points, place: p.place, result: p.result },
      });
      const tickets = reward.awardedTickets ?? reward.awardedCredits ?? 0;
      await query(`UPDATE bumper_car_players SET tickets = $3 WHERE round_id = $1 AND user_id = $2`, [req.roundId, p.userId, tickets]);
      let achievements: unknown[] = [];
      try {
        const run = await recordMatchRunResult({ matchId: req.roundId, userId: p.userId, context, reward, durationMs: 90_000 });
        achievements = run.achievements;
      } catch (error) {
        console.error('[bumper-cars] run stats failed', req.roundId, p.userId, error);
      }
      rewards.set(p.userId, {
        tickets,
        wanted: reward.wantedTickets ?? reward.wantedCredits ?? 0,
        balanceAfter: typeof reward.balanceAfter === 'number' ? reward.balanceAfter : null,
        score,
        account: reward.account,
        achievements,
      });
    } catch (error) {
      console.error('[bumper-cars] payout failed', req.roundId, p.userId, error);
    }
  }
  return { settled: true, rewards };
}

export function logBumperCheat(userId: string, reason: string): void {
  void addAntiCheatLog({
    ts: Date.now(),
    gameType: BUMPER_GAME_TYPE,
    userId,
    score: 0,
    result: 'flag',
    reason,
    stage: 'bumper-cars-socket',
    checks: [],
  }).catch(() => undefined);
}
