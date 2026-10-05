import crypto from 'node:crypto';

import { withTransaction } from '@/server/db/client';

type QueryClient = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: T[] }>;
};

export type EntitlementType = 'free_play' | 'continue';
export type EntitlementSourceType =
  | 'rewarded_ad'
  | 'admin_adjust'
  | 'game_continue'
  | 'free_play_spend';

export async function mutateEntitlementForTransaction(
  client: QueryClient,
  {
    userId,
    entitlementType,
    amount,
    sourceType,
    sourceId,
    meta,
    createdBy,
  }: {
    userId: string;
    entitlementType: EntitlementType;
    amount: number;
    sourceType: EntitlementSourceType;
    sourceId: string;
    meta?: Record<string, unknown>;
    createdBy?: string | null;
  },
) {
  if (!Number.isInteger(amount) || amount === 0) {
    throw new Error('Entitlement amount must be a non-zero integer.');
  }

  const existing = await client.query(
    `
      SELECT id, balance_after
      FROM user_entitlement_ledger
      WHERE user_id = $1
        AND entitlement_type = $2
        AND source_type = $3
        AND source_id = $4
      LIMIT 1
    `,
    [userId, entitlementType, sourceType, sourceId],
  );
  if (existing.rows[0]) {
    return {
      deduped: true,
      ledgerId: existing.rows[0].id as string,
      balanceAfter: Number(existing.rows[0].balance_after ?? 0),
    };
  }

  const now = Date.now();
  await client.query(
    `
      INSERT INTO user_entitlements (user_id, entitlement_type, quantity, updated_at)
      VALUES ($1, $2, 0, $3)
      ON CONFLICT(user_id, entitlement_type) DO NOTHING
    `,
    [userId, entitlementType, now],
  );

  const currentResult = await client.query<{ quantity: number | string }>(
    `
      SELECT quantity
      FROM user_entitlements
      WHERE user_id = $1 AND entitlement_type = $2
      FOR UPDATE
    `,
    [userId, entitlementType],
  );
  const current = Number(currentResult.rows[0]?.quantity ?? 0);
  const next = current + amount;
  if (next < 0) {
    throw new Error('Insufficient entitlement balance.');
  }

  await client.query(
    `
      UPDATE user_entitlements
      SET quantity = $1, updated_at = $2
      WHERE user_id = $3 AND entitlement_type = $4
    `,
    [next, now, userId, entitlementType],
  );

  const ledgerId = crypto.randomUUID();
  await client.query(
    `
      INSERT INTO user_entitlement_ledger (
        id,
        user_id,
        entitlement_type,
        amount,
        balance_after,
        source_type,
        source_id,
        meta_json,
        created_at,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
    [
      ledgerId,
      userId,
      entitlementType,
      amount,
      next,
      sourceType,
      sourceId,
      meta ? JSON.stringify(meta) : null,
      now,
      createdBy ?? null,
    ],
  );

  return {
    deduped: false,
    ledgerId,
    balanceAfter: next,
  };
}

export async function grantEntitlement(input: {
  userId: string;
  entitlementType: EntitlementType;
  amount: number;
  sourceType: EntitlementSourceType;
  sourceId: string;
  meta?: Record<string, unknown>;
  createdBy?: string | null;
}) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error('Entitlement grant must be a positive integer.');
  }
  return withTransaction((client) =>
    mutateEntitlementForTransaction(client, input),
  );
}

export async function consumeEntitlement(input: {
  userId: string;
  entitlementType: EntitlementType;
  sourceType: Extract<EntitlementSourceType, 'game_continue' | 'free_play_spend'>;
  sourceId: string;
  meta?: Record<string, unknown>;
  createdBy?: string | null;
}) {
  return withTransaction((client) =>
    mutateEntitlementForTransaction(client, {
      ...input,
      amount: -1,
    }),
  );
}
