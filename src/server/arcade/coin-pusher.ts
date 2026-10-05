// ---------------------------------------------------------------------------
// Coin pusher — the server's machine (docs/design/tixy-rebrand/COIN_PUSHER.md).
//
// Each player has one machine, stored as the shared engine's state at an
// integer step of the machine clock. Every request locks the row, steps the
// machine to the moment it names with the same engine the browser runs, pays
// for the coins that reached the tray, and saves it. So:
//
//   - a reconnect loads the same machine, stepped to now;
//   - a drop is charged and recorded with its answer under the client's
//     request id in one transaction, so a repeat returns that answer and
//     never charges or pays twice; the ledger's source ids are unique too;
//   - a coin pays 4.85 tickets in the tray, with the hundredths carried on
//     the machine, so the return is exactly ARCADE_RTP.
//
// The client never sends a payout, a coin position or a state: only a bet,
// an aim and the machine step it tapped on, which is clamped to the last
// 3 s.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import type { PoolClient } from 'pg';

import bedJson from '@/features/arcade/lib/coin-pusher/bed.json';
import {
  CP_AIM_MAX,
  CP_MAX_PENDING,
  cpAdvance,
  cpHash,
  cpParse,
  cpPour,
  cpRebase,
  cpStepAt,
  type CpEvent,
  type CpMachine,
} from '@/features/arcade/lib/coin-pusher/engine';
import { CP_BET_RULE, CP_GAME_TYPE, cpCoinsForBet, cpPayCoins } from '@/features/arcade/lib/coin-pusher/economy';
import { withTransaction } from '@/server/db/client';
import { isGuestUserId } from '@/server/auth/guest';
import type { UnlockResult } from '@/server/arcade/achievements/types';
import { mutateWalletAndLedgerForTransaction } from '@/server/arcade/rewards/wallet';
import { recordWagerSettlementStats } from '@/server/arcade/stats/pipeline';

import { addAntiCheatLog } from './anti-cheat-logs';

/** A drop may claim a step this far before the server's now (network lag and
    the page's queue of drops)… */
export const CP_LAG_STEPS = 180;
/** …and this far after it (clock skew). Outside that, it is clamped. */
export const CP_SKEW_STEPS = 15;
/** A claim further off than this is logged as suspicious, not just late. */
const CP_FLAG_STEPS = 300;

export class CoinPusherError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type CpMachineView = {
  machine: CpMachine;
  hash: string;
  serverNow: number;
  committedStep: number;
  carry: number;
  balance: number;
  coinsWon: number;
  paid: number;
};

export type CpRequestAnswer = {
  requestId: string;
  kind: 'drop' | 'collect';
  /** The step the drop's first coin leaves the chute (drops only). */
  entryStep: number | null;
  claimedStep: number | null;
  /** The machine's step after this request: its hash is `hash`. */
  committedStep: number;
  hash: string;
  coinsWon: number;
  paid: number;
  carry: number;
  balance: number;
  bet: number;
  coins: number;
  achievements: UnlockResult[];
  replayed: boolean;
  serverNow: number;
};

type MachineRow = {
  state_json: string;
  carry: number | string;
};

const freshMachine = (step: number): CpMachine => {
  const bed = cpParse(bedJson);
  if (!bed) throw new Error('The coin pusher bed is malformed.');
  return cpRebase(bed, step);
};

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Lock the player's machine, creating it on first use. */
async function lockMachine(client: PoolClient, userId: string, now: number) {
  const step = cpStepAt(now);
  const fresh = freshMachine(step);
  await client.query(
    `INSERT INTO coin_pusher_machines (user_id, state_json, step, carry, created_at, updated_at)
     VALUES ($1, $2, $3, 0, $4, $4)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, JSON.stringify(fresh), fresh.step, now],
  );
  const row = await client.query<MachineRow>(
    'SELECT state_json, carry FROM coin_pusher_machines WHERE user_id = $1 FOR UPDATE',
    [userId],
  );
  const stored = row.rows[0];
  const machine = stored ? cpParse(JSON.parse(stored.state_json)) : null;
  if (!machine) throw new CoinPusherError('This machine could not be read. Ask for help on the feedback page.', 500);
  return { machine, carry: Number(stored.carry ?? 0) };
}

/** Step the machine to `target` and count the coins that reached the tray. */
function stepTo(machine: CpMachine, target: number): number {
  if (target <= machine.step) return 0;
  const events: CpEvent[] = [];
  cpAdvance(machine, target, events);
  let won = 0;
  for (const e of events) if (e.k === 'tray') won += 1;
  return won;
}

async function walletBalance(client: PoolClient, userId: string): Promise<number> {
  const row = await client.query<{ credits: string | number }>(
    'SELECT credits FROM wallets WHERE user_id = $1',
    [userId],
  );
  return Number(row.rows[0]?.credits ?? 0);
}

/** Pay for coins in the tray and save the machine. Returns tickets paid and the carry. */
async function settle(
  client: PoolClient,
  userId: string,
  machine: CpMachine,
  carry: number,
  coinsWon: number,
  staked: { bet: number; coins: number },
  now: number,
) {
  const pay = cpPayCoins(coinsWon, carry);
  let balance: number | null = null;
  if (pay.tickets > 0) {
    const result = await mutateWalletAndLedgerForTransaction(client, {
      userId,
      currencyType: 'credits',
      amount: pay.tickets,
      sourceType: 'wager_payout',
      // One payout per committed step: the step only moves forward.
      sourceId: `coin-pusher:pay:${machine.step}`,
      meta: { arcadeGameType: CP_GAME_TYPE, coins: coinsWon, step: machine.step },
    });
    balance = result.balanceAfter;
  }
  await client.query(
    `UPDATE coin_pusher_machines
        SET state_json = $2, step = $3, carry = $4,
            coins_dropped = coins_dropped + $5, coins_won = coins_won + $6,
            tickets_staked = tickets_staked + $7, tickets_paid = tickets_paid + $8,
            updated_at = $9
      WHERE user_id = $1`,
    [userId, JSON.stringify(machine), machine.step, pay.carry, staked.coins, coinsWon, staked.bet, pay.tickets, now],
  );
  return { paid: pay.tickets, carry: pay.carry, balance };
}

async function recordHistory(
  client: PoolClient,
  userId: string,
  userName: string,
  bet: number,
  paid: number,
  outcome: Record<string, unknown>,
  now: number,
) {
  if (bet <= 0 && paid <= 0) return;
  await client.query(
    `INSERT INTO arcade_round_history
       (id, user_id, user_name, game_type, wager_amount, payout_amount, multiplier, seed, choices_json, outcome_json, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      crypto.randomUUID(),
      userId,
      userName,
      CP_GAME_TYPE,
      bet,
      paid,
      bet > 0 ? Math.round((paid / bet) * 10000) / 10000 : 0,
      0,
      '[]',
      JSON.stringify(outcome),
      now,
    ],
  );
}

function assertPlayer(userId: string) {
  if (isGuestUserId(userId)) throw new CoinPusherError('Sign in to play for tickets.', 401);
}

/** Load the machine, stepped to now, paying for anything that fell since. */
export async function loadCoinPusher(userId: string, userName: string): Promise<CpMachineView> {
  assertPlayer(userId);
  const now = Date.now();
  return withTransaction(async (client) => {
    const { machine, carry } = await lockMachine(client, userId, now);
    const won = stepTo(machine, cpStepAt(now));
    const settled = await settle(client, userId, machine, carry, won, { bet: 0, coins: 0 }, now);
    await recordHistory(client, userId, userName, 0, settled.paid, { coinsWon: won, step: machine.step, kind: 'load' }, now);
    return {
      machine,
      hash: cpHash(machine),
      serverNow: Date.now(),
      committedStep: machine.step,
      carry: settled.carry,
      balance: settled.balance ?? (await walletBalance(client, userId)),
      coinsWon: won,
      paid: settled.paid,
    };
  });
}

type DropInput = { requestId: unknown; bet: unknown; x: unknown; step: unknown };
type CollectInput = { requestId: unknown; step: unknown };

function reject(userId: string, reason: string, status = 400): never {
  void addAntiCheatLog({
    ts: Date.now(),
    gameType: CP_GAME_TYPE,
    userId,
    score: 0,
    result: 'reject',
    reason,
    stage: 'coin-pusher',
    checks: [],
  });
  throw new CoinPusherError(status === 400 ? 'The machine could not read that request.' : reason, status);
}

function flag(userId: string, reason: string) {
  void addAntiCheatLog({
    ts: Date.now(),
    gameType: CP_GAME_TYPE,
    userId,
    score: 0,
    result: 'flag',
    reason,
    stage: 'coin-pusher',
    checks: [],
  });
}

async function storedAnswer(client: PoolClient, userId: string, requestId: string) {
  const row = await client.query<{ kind: string; bet: number; aim_x: number | null; claimed_step: string | number | null; response_json: string }>(
    'SELECT kind, bet, aim_x, claimed_step, response_json FROM coin_pusher_requests WHERE user_id = $1 AND request_id = $2',
    [userId, requestId],
  );
  return row.rows[0] ?? null;
}

/** Drop `bet / 5` coins aimed at `x`, the first leaving the chute at the
    step the player tapped on (clamped to the last 3 s). */
export async function dropCoinPusher(userId: string, userName: string, input: DropInput): Promise<CpRequestAnswer> {
  assertPlayer(userId);
  const { requestId, bet, x, step } = input;
  if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) reject(userId, 'drop: malformed request id');
  const coins = cpCoinsForBet(bet);
  if (coins == null) {
    // The page only sends fives from 5 to 250, so anything else is logged,
    // but the answer is still the rule in words.
    if (typeof bet === 'number' && Number.isInteger(bet) && bet > 0) {
      void addAntiCheatLog({ ts: Date.now(), gameType: CP_GAME_TYPE, userId, score: 0, result: 'reject', reason: `drop: bet ${bet} is off the grid`, stage: 'coin-pusher', checks: [] });
      throw new CoinPusherError(CP_BET_RULE, 400);
    }
    reject(userId, `drop: bet ${String(bet)} is not a number of tickets`);
  }
  if (typeof x !== 'number' || !Number.isFinite(x) || Math.abs(x) > CP_AIM_MAX + 1e-9) reject(userId, `drop: aim ${String(x)} is off the chute`);
  if (typeof step !== 'number' || !Number.isSafeInteger(step)) reject(userId, `drop: step ${String(step)} is not a step`);
  const betTickets = bet as number;

  const now = Date.now();
  const answer = await withTransaction(async (client) => {
    // The machine lock serialises everything for this player, including the
    // repeat check below, so two copies of one request can't both run.
    const { machine, carry } = await lockMachine(client, userId, now);
    const prior = await storedAnswer(client, userId, requestId);
    if (prior) {
      if (prior.kind !== 'drop' || prior.bet !== betTickets || prior.aim_x !== x || Number(prior.claimed_step) !== step) {
        reject(userId, 'drop: a request id was reused for a different drop', 409);
      }
      const stored = JSON.parse(prior.response_json) as CpRequestAnswer;
      return { ...stored, replayed: true, achievements: [] };
    }

    const nowStep = cpStepAt(now);
    const lo = Math.max(machine.step + 1, nowStep - CP_LAG_STEPS);
    const hi = nowStep + CP_SKEW_STEPS;
    const entry = Math.min(hi, Math.max(lo, step));
    if (Math.abs(entry - step) > CP_FLAG_STEPS) {
      flag(userId, `drop: claimed step ${step} is ${step - nowStep} steps from now; clamped to ${entry}`);
    }

    // Charge first: an unaffordable drop changes nothing.
    try {
      await mutateWalletAndLedgerForTransaction(client, {
        userId,
        currencyType: 'credits',
        amount: -betTickets,
        sourceType: 'wager_hold',
        sourceId: `coin-pusher:drop:${requestId}`,
        meta: { arcadeGameType: CP_GAME_TYPE, coins, requestId },
      });
    } catch (error) {
      if (error instanceof Error && /insufficient/i.test(error.message)) {
        throw new CoinPusherError(`You need ${betTickets} tickets for this drop.`, 402);
      }
      throw error;
    }

    const won = stepTo(machine, entry - 1);
    if (machine.pending.length + coins! > CP_MAX_PENDING) {
      throw new CoinPusherError('The chute is full. Let it empty first.', 429);
    }
    cpPour(machine, entry, x as number, coins!);
    const settled = await settle(client, userId, machine, carry, won, { bet: betTickets, coins: coins! }, now);
    const balance = settled.balance ?? (await walletBalance(client, userId));
    const result: CpRequestAnswer = {
      requestId,
      kind: 'drop',
      entryStep: entry,
      claimedStep: step as number,
      committedStep: machine.step,
      hash: cpHash(machine),
      coinsWon: won,
      paid: settled.paid,
      carry: settled.carry,
      balance,
      bet: betTickets,
      coins: coins!,
      achievements: [],
      replayed: false,
      serverNow: 0,
    };
    await client.query(
      `INSERT INTO coin_pusher_requests
         (user_id, request_id, kind, bet, coins, aim_x, claimed_step, entry_step, committed_step, coins_won, payout, response_json, created_at)
       VALUES ($1, $2, 'drop', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [userId, requestId, betTickets, coins, x, step, entry, machine.step, won, settled.paid, JSON.stringify(result), now],
    );
    await recordHistory(client, userId, userName, betTickets, settled.paid, { coins, coinsWon: won, entryStep: entry, x }, now);
    return result;
  });

  if (!answer.replayed) {
    answer.achievements = await recordWagerSettlementStats(userId, {
      gameType: CP_GAME_TYPE,
      durationMs: 0,
      netProfit: Math.max(0, answer.paid - answer.bet),
    });
  }
  return { ...answer, serverNow: Date.now() };
}

/** Step the machine to a moment the client has already drawn, and pay. */
export async function collectCoinPusher(userId: string, userName: string, input: CollectInput): Promise<CpRequestAnswer> {
  assertPlayer(userId);
  const { requestId, step } = input;
  if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) reject(userId, 'collect: malformed request id');
  if (typeof step !== 'number' || !Number.isSafeInteger(step)) reject(userId, `collect: step ${String(step)} is not a step`);

  const now = Date.now();
  const answer = await withTransaction(async (client) => {
    const { machine, carry } = await lockMachine(client, userId, now);
    const prior = await storedAnswer(client, userId, requestId);
    if (prior) {
      if (prior.kind !== 'collect' || Number(prior.claimed_step) !== step) {
        reject(userId, 'collect: a request id was reused for a different request', 409);
      }
      return { ...(JSON.parse(prior.response_json) as CpRequestAnswer), replayed: true, achievements: [] };
    }
    // Never past now: the future isn't decided yet.
    const target = Math.min(step as number, cpStepAt(now) + CP_SKEW_STEPS);
    if ((step as number) - cpStepAt(now) > CP_FLAG_STEPS) flag(userId, `collect: step ${step} is in the future`);
    const won = stepTo(machine, target);
    const settled = await settle(client, userId, machine, carry, won, { bet: 0, coins: 0 }, now);
    const result: CpRequestAnswer = {
      requestId,
      kind: 'collect',
      entryStep: null,
      claimedStep: step as number,
      committedStep: machine.step,
      hash: cpHash(machine),
      coinsWon: won,
      paid: settled.paid,
      carry: settled.carry,
      balance: settled.balance ?? (await walletBalance(client, userId)),
      bet: 0,
      coins: 0,
      achievements: [],
      replayed: false,
      serverNow: 0,
    };
    await client.query(
      `INSERT INTO coin_pusher_requests
         (user_id, request_id, kind, claimed_step, committed_step, coins_won, payout, response_json, created_at)
       VALUES ($1, $2, 'collect', $3, $4, $5, $6, $7, $8)`,
      [userId, requestId, step, machine.step, won, settled.paid, JSON.stringify(result), now],
    );
    await recordHistory(client, userId, userName, 0, settled.paid, { coinsWon: won, step: machine.step, kind: 'collect' }, now);
    return result;
  });
  return { ...answer, serverNow: Date.now() };
}
