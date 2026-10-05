import crypto from 'node:crypto';

import { consumeEntitlement } from '@/server/arcade/rewards';
import { query } from '@/server/db/client';

export async function recordContinuedGameRun({
  userId,
  gameType,
  score,
  sessionId,
  entitlementLedgerId,
  meta,
}: {
  userId: string;
  gameType: string;
  score: number;
  sessionId?: string | null;
  entitlementLedgerId?: string | null;
  meta?: Record<string, unknown>;
}) {
  await query(
    `
      INSERT INTO continued_game_runs (
        id,
        user_id,
        game_type,
        score,
        session_id,
        entitlement_ledger_id,
        created_at,
        meta_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      crypto.randomUUID(),
      userId,
      gameType,
      score,
      sessionId ?? null,
      entitlementLedgerId ?? null,
      Date.now(),
      meta ? JSON.stringify(meta) : null,
    ],
  );
}

export async function consumeContinueForGameRun({
  userId,
  gameType,
  score,
  sessionId,
  meta,
}: {
  userId: string;
  gameType: string;
  score: number;
  sessionId?: string | null;
  meta?: Record<string, unknown>;
}) {
  const sourceId = `continue:${gameType}:${sessionId ?? crypto.randomUUID()}`;
  let entitlement;
  try {
    entitlement = await consumeEntitlement({
      userId,
      entitlementType: 'continue',
      sourceType: 'game_continue',
      sourceId,
      meta: {
        gameType,
        score,
        sessionId: sessionId ?? null,
        ...meta,
      },
    });
  } catch (error) {
    if ((error as Error).message === 'Insufficient entitlement balance.') {
      throw Object.assign(new Error('A continue token is required.'), {
        status: 403,
      });
    }
    throw error;
  }

  await recordContinuedGameRun({
    userId,
    gameType,
    score,
    sessionId,
    entitlementLedgerId: entitlement.ledgerId,
    meta: {
      entitlementBalanceAfter: entitlement.balanceAfter,
      ...meta,
    },
  });

  return entitlement;
}
