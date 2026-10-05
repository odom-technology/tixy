import { assertGameAvailable } from '@/server/arcade/game-availability';
// ---------------------------------------------------------------------------
// tixy — Session lifecycle: create (hold wager) → play → settle (payout)
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import { query, queryOne, withTransaction } from "@/server/db/client";
import { isGuestUserId } from "@/server/auth/guest";
import type { UnlockResult } from "@/server/arcade/achievements/types";
import { getWalletForUser, mutateWalletAndLedgerForTransaction } from "@/server/arcade/rewards/wallet";
import { recordWagerSettlementStats } from "@/server/arcade/stats/pipeline";
import {
  capRoundPayout,
  invalidBetMessage,
  isArcadeGameType,
  type ArcadeGameType,
} from "./arcade-constants";
import { generateArcadeSeed } from "./arcade-rng";
import { recordGameTimeMetric } from "./game-time-metrics";
import { addAntiCheatLog } from "./anti-cheat-logs";

// ---------------------------------------------------------------------------
// Token signing (reuse pattern from game-session.ts)
// ---------------------------------------------------------------------------

function getSecretKey(): string {
  const key = process.env.GAME_SESSION_SECRET;
  if (!key) {
    throw new Error("GAME_SESSION_SECRET environment variable is required.");
  }
  return key;
}

function generateHmac(data: string): string {
  return crypto.createHmac("sha256", getSecretKey()).update(data).digest("hex");
}

function signArcadeToken(
  sessionId: string,
  userId: string,
  gameType: string,
  startedAt: number,
): string {
  const tokenData = `${sessionId}:${userId}:${gameType}:${startedAt}`;
  const signature = generateHmac(tokenData);
  return `${tokenData}:${signature}`;
}

export function validateArcadeToken(token: string): {
  valid: boolean;
  sessionId?: string;
  userId?: string;
  gameType?: string;
  startedAt?: number;
} {
  const parts = token.split(":");
  if (parts.length !== 5) return { valid: false };
  const [sessionId, userId, gameType, startedAtStr, signature] = parts;
  const tokenData = `${sessionId}:${userId}:${gameType}:${startedAtStr}`;
  const expected = generateHmac(tokenData);
  if (signature !== expected) return { valid: false };
  return {
    valid: true,
    sessionId: sessionId!,
    userId: userId!,
    gameType: gameType!,
    startedAt: Number(startedAtStr),
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ArcadeSession = {
  sessionId: string;
  userId: string;
  gameType: ArcadeGameType;
  startedAt: number;
  seed: number;
  wager: number;
  payout: number | null;
  config: Record<string, unknown>;
  choices: unknown[];
  settledAt: number | null;
};

export type CreateArcadeSessionResult = {
  sessionId: string;
  token: string;
  config: Record<string, unknown>;
};

type ArcadeSessionRow = {
  id: string;
  od_user_id: string;
  game_type: string;
  started_at: string | number;
  arcade_seed: string | number | null;
  arcade_wager: string | number | null;
  arcade_payout: string | number | null;
  arcade_game_config: string | null;
  arcade_choices_json: string | null;
  arcade_settled_at: string | number | null;
};

const toNumber = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const SETTLE_SESSION_SQL = `
  UPDATE game_sessions
  SET arcade_payout = $1, arcade_settled_at = $2
  WHERE id = $3 AND od_user_id = $4 AND arcade_settled_at IS NULL
`;

const INSERT_HISTORY_SQL = `
  INSERT INTO arcade_round_history
    (id, user_id, user_name, game_type, wager_amount, payout_amount, multiplier, seed, choices_json, outcome_json, created_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
`;

/** A hold the player's tickets can't cover. The message is the one plain
 *  sentence the player reads; routes answer it with a 402. */
export class TicketsShortError extends Error {
  readonly status = 402;
}

/** Run a hold, and when the wallet can't cover it say what the wallet has.
 *  The wallet debit stays the one check: it locks the row and refuses to go
 *  under zero, so two requests at once can't spend the same tickets. */
async function holdOrExplain<T>(userId: string, run: () => Promise<T>, takes?: number): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes("insufficient")) {
      const { credits } = await getWalletForUser(userId);
      const have = `${credits.toLocaleString("en-US")} ${credits === 1 ? "ticket" : "tickets"}`;
      throw new TicketsShortError(
        takes == null ? `You have ${have}.` : `You have ${have} and this takes ${takes.toLocaleString("en-US")}.`,
      );
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Session operations
// ---------------------------------------------------------------------------

/** Create a new arcade session, holding the wager from the player's wallet. */
export async function createArcadeSession(
  userId: string,
  gameType: ArcadeGameType,
  wagerAmount: number,
  config: Record<string, unknown> = {},
): Promise<CreateArcadeSessionResult> {
  await assertGameAvailable(gameType);
  if (!isArcadeGameType(gameType)) {
    throw new Error(`Invalid arcade game type: ${gameType}`);
  }

  // Any whole number from ARCADE_MIN_BET to MAX_TICKET_BET (the bet sheet's
  // custom amount); the wallet debit below refuses anything over the
  // player's tickets. Checked before the hold, so a bad bet costs nothing.
  const invalid = invalidBetMessage(wagerAmount);
  if (invalid) throw new Error(invalid);

  const sessionId = crypto.randomUUID();
  const startedAt = Date.now();
  // The seed is fixed here (and persisted below) but is NEVER sent to the
  // client until the round ends — see settle/reveal. Exposing it (or its
  // brute-forceable hash) up front would let players pre-compute outcomes.
  const seed = generateArcadeSeed();

  // Atomic: debit wallet (throws on insufficient balance) + insert session row
  await holdOrExplain(userId, () => withTransaction(async (client) => {
    await mutateWalletAndLedgerForTransaction(client, {
      userId,
      currencyType: "credits",
      amount: -wagerAmount,
      sourceType: "wager_hold",
      sourceId: `arcade-hold:${sessionId}`,
      meta: { arcadeGameType: gameType, sessionId },
    });

    await client.query(
      `
        INSERT INTO game_sessions
          (id, od_user_id, game_type, started_at, last_action_at, action_count,
           pow_challenge_json, arcade_seed, arcade_wager, arcade_game_config, arcade_choices_json)
        VALUES ($1, $2, $3, $4, $5, 0, '{}', $6, $7, $8, '[]')
      `,
      [
        sessionId,
        userId,
        gameType,
        startedAt,
        startedAt,
        seed,
        wagerAmount,
        JSON.stringify(config),
      ],
    );
  }));

  const token = signArcadeToken(sessionId, userId, gameType, startedAt);
  return { sessionId, token, config };
}

/** Load an arcade session. */
export async function getArcadeSession(
  sessionId: string,
  userId: string,
): Promise<ArcadeSession | null> {
  const row = await queryOne<ArcadeSessionRow>(
    `
      SELECT id, od_user_id, game_type, started_at, arcade_seed, arcade_wager,
             arcade_payout, arcade_game_config, arcade_choices_json, arcade_settled_at
      FROM game_sessions
      WHERE id = $1 AND od_user_id = $2
    `,
    [sessionId, userId],
  );
  if (!row) return null;

  // Use explicit null checks instead of truthiness (seed 0 is valid)
  const seed = toNumber(row.arcade_seed);
  const wager = toNumber(row.arcade_wager);
  if (seed == null || wager == null) return null;
  if (!isArcadeGameType(row.game_type)) return null;

  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(row.arcade_game_config ?? "{}");
  } catch {
    /* empty */
  }

  let choices: unknown[] = [];
  try {
    choices = JSON.parse(row.arcade_choices_json ?? "[]");
  } catch {
    /* empty */
  }

  return {
    sessionId: row.id,
    userId: row.od_user_id,
    gameType: row.game_type,
    startedAt: toNumber(row.started_at) ?? 0,
    seed,
    wager,
    payout: toNumber(row.arcade_payout),
    config,
    choices,
    settledAt: toNumber(row.arcade_settled_at),
  };
}

/** Append a player choice to the session's choices array. */
export async function recordArcadeChoice(
  sessionId: string,
  userId: string,
  choice: unknown,
): Promise<boolean> {
  const session = await getArcadeSession(sessionId, userId);
  if (!session || session.settledAt) return false;

  const newChoices = [...session.choices, choice];
  const result = await query(
    `
      UPDATE game_sessions
      SET arcade_choices_json = $1, last_action_at = $2
      WHERE id = $3 AND od_user_id = $4 AND arcade_settled_at IS NULL
    `,
    [JSON.stringify(newChoices), Date.now(), sessionId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Record the first and only choice for a single-action game.
 *
 * Unlike recordArcadeChoice's read/append flow, the empty-array predicate is
 * part of the UPDATE so concurrent requests cannot commit two different
 * choices. A false result means the caller must reload and replay the stored
 * choice; it must never use its newly supplied choice.
 */
export async function recordFirstArcadeChoice(
  sessionId: string,
  userId: string,
  choice: unknown,
): Promise<boolean> {
  const result = await query(
    `
      UPDATE game_sessions
      SET arcade_choices_json = $1, last_action_at = $2
      WHERE id = $3 AND od_user_id = $4
        AND arcade_settled_at IS NULL
        AND COALESCE(arcade_choices_json, '[]') = '[]'
    `,
    [JSON.stringify([choice]), Date.now(), sessionId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Atomically debit an additional wager amount from the player's wallet and
 * increase the session's `arcade_wager`. Used by blackjack doubles / splits
 * where the committed stake grows mid-round. The extra debit flows through
 * the same `wager_hold` ledger path as the initial hold so anti-hack audits
 * and "total wagered" leaderboards remain accurate.
 */
export async function addArcadeWagerHold(
  sessionId: string,
  userId: string,
  additional: number,
  reason: string,
): Promise<void> {
  if (!Number.isInteger(additional) || additional <= 0) {
    throw new Error("Invalid additional wager amount.");
  }
  const session = await getArcadeSession(sessionId, userId);
  if (!session) throw new Error("Session not found.");
  if (session.settledAt) throw new Error("Session already settled.");

  await holdOrExplain(userId, () => withTransaction(async (client) => {
    await mutateWalletAndLedgerForTransaction(client, {
      userId,
      currencyType: "credits",
      amount: -additional,
      sourceType: "wager_hold",
      sourceId: `arcade-hold:${sessionId}:${reason}`,
      meta: {
        arcadeGameType: session.gameType,
        sessionId,
        reason,
      },
    });
    const result = await client.query(
      `
        UPDATE game_sessions
        SET arcade_wager = arcade_wager + $1, last_action_at = $2
        WHERE id = $3 AND od_user_id = $4 AND arcade_settled_at IS NULL
      `,
      [additional, Date.now(), sessionId, userId],
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new Error("Session missing or already settled.");
    }
  }), additional);
}

/** Check if a session has had gameplay actions (tiles revealed, etc.).
 *  Crash sessions are always considered "in play" since the multiplier
 *  starts climbing the moment the session is created. */
function sessionHasGameplay(session: ArcadeSession): boolean {
  if (session.gameType === "arcade-crash") return true;
  return Array.isArray(session.choices) && session.choices.length > 0;
}

/** Settle an arcade session with a computed payout. Atomic: settle + payout + history. */
export async function settleArcadeSession(
  sessionId: string,
  userId: string,
  payout: number,
  multiplier: number,
  outcomeJson?: string,
  userName?: string,
): Promise<{
  payout: number;
  seed: number;
  roundId: string;
  achievements: UnlockResult[];
}> {
  const session = await getArcadeSession(sessionId, userId);
  if (!session) throw new Error("Session not found.");
  if (session.settledAt) throw new Error("Session already settled.");

  const now = Date.now();
  const result = await withTransaction(async (client) => {
    // Held under MAX_ROUND_PAYOUT so the integer columns can take it.
    const roundPayout = capRoundPayout(Math.max(0, Math.floor(payout)));

    // Mark session as settled — idempotent: only one caller can win this
    // UPDATE because of the `arcade_settled_at IS NULL` guard.
    const settle = await client.query(SETTLE_SESSION_SQL, [
      roundPayout,
      now,
      sessionId,
      userId,
    ]);
    if ((settle.rowCount ?? 0) === 0) {
      throw new Error("Failed to settle — already settled or missing.");
    }

    // Ticket payout to wallet (only if > 0)
    if (roundPayout > 0) {
      await mutateWalletAndLedgerForTransaction(client, {
        userId,
        currencyType: "credits",
        amount: roundPayout,
        sourceType: "wager_payout",
        sourceId: `arcade-payout:${sessionId}`,
        meta: {
          arcadeGameType: session.gameType,
          sessionId,
          multiplier,
        },
      });
    }

    // Record to history
    const roundId = crypto.randomUUID();
    await client.query(INSERT_HISTORY_SQL, [
      roundId,
      userId,
      userName ?? "Anonymous",
      session.gameType,
      session.wager,
      roundPayout,
      multiplier,
      session.seed,
      JSON.stringify(session.choices),
      outcomeJson ?? null,
      now,
    ]);

    return { payout: roundPayout, seed: session.seed, roundId };
  });

  // Record game time under the 'arcade' umbrella (not per sub-game)
  const durationMs = Math.max(0, now - session.startedAt);
  void recordGameTimeMetric({
    userId,
    gameType: "arcade",
    durationMs,
    playedAtMs: now,
  }).catch((error) => {
    console.error("Failed to record arcade game time:", error);
  });

  // Log to anti-cheat for audit trail
  void addAntiCheatLog({
    ts: now,
    gameType: session.gameType,
    userId,
    score: result.payout,
    result: "pass",
    reason: `tixy round settled: wager=${session.wager} payout=${result.payout} mult=${multiplier}`,
    stage: "arcade-settle",
    checks: [],
  });

  const achievements = isGuestUserId(userId)
    ? []
    : await recordWagerSettlementStats(userId, {
        gameType: session.gameType,
        durationMs,
        netProfit: Math.max(0, result.payout - session.wager),
      });

  return { ...result, achievements };
}

/**
 * Refund an arcade session. Only allowed if NO gameplay actions have occurred.
 * Once the player has revealed a tile, spun, or started a crash round,
 * the wager is committed — they must cash out or lose.
 */
export async function refundArcadeSession(
  sessionId: string,
  userId: string,
): Promise<void> {
  const session = await getArcadeSession(sessionId, userId);
  if (!session) throw new Error("Session not found.");
  if (session.settledAt) throw new Error("Session already settled.");

  if (sessionHasGameplay(session)) {
    throw new Error(
      "Cannot forfeit after gameplay has started. Cash out or finish the round.",
    );
  }

  const now = Date.now();

  await withTransaction(async (client) => {
    // Mark the session settled with 0 payout first — the IS NULL guard makes
    // the refund idempotent under concurrent settle/refund calls.
    const settle = await client.query(SETTLE_SESSION_SQL, [
      0,
      now,
      sessionId,
      userId,
    ]);
    if ((settle.rowCount ?? 0) === 0) {
      throw new Error("Session already settled.");
    }

    // Refund the held wager. We deliberately do NOT insert a row into
    // arcade_round_history: a refund means no real play happened, so it must
    // not show up as a loss in recent history nor inflate the total-wagered
    // leaderboard. The wallet ledger already has an audit trail.
    await mutateWalletAndLedgerForTransaction(client, {
      userId,
      currencyType: "credits",
      amount: session.wager,
      sourceType: "wager_refund",
      sourceId: `arcade-refund:${sessionId}`,
      meta: { arcadeGameType: session.gameType, sessionId },
    });
  });
}

/** Get a player's recent arcade round history. */
export async function getArcadeHistory(
  userId: string,
  limit = 20,
): Promise<
  Array<{
    id: string;
    gameType: string;
    wagerAmount: number;
    payoutAmount: number;
    multiplier: number;
    seed: number;
    createdAt: number;
  }>
> {
  // Refunds are no longer inserted into arcade_round_history, but pre-existing
  // dev/staging rows may still be tagged `{"refunded":true}`. Filter them out
  // defensively so they don't show up in a player's recent rounds.
  const result = await query<{
    id: string;
    user_id: string;
    game_type: string;
    wager_amount: string | number;
    payout_amount: string | number;
    multiplier: string | number;
    seed: string | number;
    choices_json: string | null;
    outcome_json: string | null;
    created_at: string | number;
  }>(
    `
      SELECT id, user_id, game_type, wager_amount, payout_amount, multiplier, seed, choices_json, outcome_json, created_at
      FROM arcade_round_history
      WHERE user_id = $1
        AND (outcome_json IS NULL OR outcome_json NOT LIKE '%"refunded":true%')
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [userId, limit],
  );

  return result.rows.map((r) => ({
    id: r.id,
    gameType: r.game_type,
    wagerAmount: Number(r.wager_amount ?? 0),
    payoutAmount: Number(r.payout_amount ?? 0),
    multiplier: Number(r.multiplier ?? 0),
    seed: Number(r.seed ?? 0),
    createdAt: Number(r.created_at ?? 0),
  }));
}

// ---------------------------------------------------------------------------
// Stale session cleanup — settle abandoned arcade sessions as LOSSES
// (not refunds — the player abandoned an active game).
// Sessions with no gameplay actions are refunded.
// ---------------------------------------------------------------------------

export async function cleanupStaleArcadeSessions(): Promise<number> {
  const cutoff = Date.now() - 30 * 60 * 1000; // 30 minutes
  const stale = await query<{
    id: string;
    od_user_id: string;
    game_type: string;
    arcade_seed: string | number;
    arcade_wager: string | number;
    arcade_choices_json: string | null;
    arcade_game_config: string | null;
    started_at: string | number;
  }>(
    `
      SELECT id, od_user_id, game_type, arcade_seed, arcade_wager, arcade_choices_json, arcade_game_config, started_at
      FROM game_sessions
      WHERE game_type LIKE 'arcade-%'
        AND arcade_settled_at IS NULL
        AND started_at < $1
    `,
    [cutoff],
  );

  let cleaned = 0;
  const now = Date.now();

  for (const row of stale.rows) {
    try {
      let choices: unknown[] = [];
      try {
        choices = JSON.parse(row.arcade_choices_json ?? "[]");
      } catch {
        /* empty */
      }

      const isCrash = row.game_type === "arcade-crash";
      const hasGameplay =
        isCrash || (Array.isArray(choices) && choices.length > 0);

      await withTransaction(async (client) => {
        const settle = await client.query(SETTLE_SESSION_SQL, [
          0,
          now,
          row.id,
          row.od_user_id,
        ]);

        if ((settle.rowCount ?? 0) > 0) {
          if (hasGameplay) {
            // Player started gameplay then abandoned — settle as loss
            // (house keeps wager)
            const roundId = crypto.randomUUID();
            await client.query(INSERT_HISTORY_SQL, [
              roundId,
              row.od_user_id,
              "Anonymous",
              row.game_type,
              Number(row.arcade_wager ?? 0),
              0,
              0,
              Number(row.arcade_seed ?? 0),
              row.arcade_choices_json,
              JSON.stringify({ abandoned: true }),
              now,
            ]);
          } else {
            // No gameplay — refund the wager. As with manual forfeits, we do
            // NOT insert a history row: a refund is not a real play and must
            // not appear in leaderboards or recent rounds. The wallet ledger
            // entry created here is the audit trail.
            await mutateWalletAndLedgerForTransaction(client, {
              userId: row.od_user_id,
              currencyType: "credits",
              amount: Number(row.arcade_wager ?? 0),
              sourceType: "wager_refund",
              sourceId: `arcade-refund:${row.id}`,
              meta: { reason: "stale_session_cleanup" },
            });
          }
        }

        await client.query("DELETE FROM game_sessions WHERE id = $1", [row.id]);
      });
      cleaned++;
    } catch {
      // Ledger dedup will catch double operations; ignore.
    }
  }
  return cleaned;
}
