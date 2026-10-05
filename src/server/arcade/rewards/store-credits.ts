import crypto from 'node:crypto';

import { withTransaction } from '@/server/db/client';

type QueryClient = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: T[] }>;
};

export type StoreCreditSourceType =
  | 'stripe_purchase'
  | 'stripe_reversal'
  | 'rewarded_ad'
  | 'store_purchase'
  | 'admin_adjust';

type WalletBalanceRow = {
  user_id: string;
  credits: number | string;
  store_credits: number | string;
  updated_at: number | string;
};

export type CombinedWalletBalance = {
  userId: string;
  credits: number;
  storeCredits: number;
  spendableCredits: number;
  updatedAt: number;
};

export const normalizeCombinedWalletRow = (
  row: WalletBalanceRow,
): CombinedWalletBalance => {
  const credits = Number(row.credits ?? 0);
  const storeCredits = Number(row.store_credits ?? 0);
  return {
    userId: row.user_id,
    credits,
    storeCredits,
    spendableCredits: credits + storeCredits,
    updatedAt: Number(row.updated_at ?? 0),
  };
};

export async function getCombinedWalletForTransaction(
  client: QueryClient,
  userId: string,
  forUpdate = false,
): Promise<CombinedWalletBalance> {
  const now = Date.now();
  await client.query(
    `
      INSERT INTO wallets (user_id, credits, wupiupi, store_credits, updated_at)
      VALUES ($1, 0, 0, 0, $2)
      ON CONFLICT(user_id) DO NOTHING
    `,
    [userId, now],
  );

  const result = await client.query<WalletBalanceRow>(
    `
      SELECT user_id, credits, store_credits, updated_at
      FROM wallets
      WHERE user_id = $1
      ${forUpdate ? 'FOR UPDATE' : ''}
    `,
    [userId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Failed to load wallet.');
  return normalizeCombinedWalletRow(row);
}

export async function mutateStoreCreditsForTransaction(
  client: QueryClient,
  {
    userId,
    amount,
    sourceType,
    sourceId,
    meta,
    createdBy,
  }: {
    userId: string;
    amount: number;
    sourceType: StoreCreditSourceType;
    sourceId: string;
    meta?: Record<string, unknown>;
    createdBy?: string | null;
  },
) {
  if (!Number.isInteger(amount) || amount === 0) {
    throw new Error('Store Ticket amount must be a non-zero integer.');
  }

  const existing = await client.query(
    `
      SELECT id, balance_after
      FROM store_credit_ledger
      WHERE user_id = $1
        AND source_type = $2
        AND source_id = $3
      LIMIT 1
    `,
    [userId, sourceType, sourceId],
  );
  if (existing.rows[0]) {
    return {
      deduped: true,
      ledgerId: existing.rows[0].id as string,
      balanceAfter: Number(existing.rows[0].balance_after ?? 0),
    };
  }

  const now = Date.now();
  const wallet = await getCombinedWalletForTransaction(client, userId, true);
  const nextBalance = wallet.storeCredits + amount;
  if (nextBalance < 0) {
    throw new Error('Insufficient store-only Ticket balance.');
  }

  await client.query(
    `UPDATE wallets SET store_credits = $1, updated_at = $2 WHERE user_id = $3`,
    [nextBalance, now, userId],
  );

  const ledgerId = crypto.randomUUID();
  await client.query(
    `
      INSERT INTO store_credit_ledger (
        id,
        user_id,
        amount,
        balance_after,
        source_type,
        source_id,
        meta_json,
        created_at,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      ledgerId,
      userId,
      amount,
      nextBalance,
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
    balanceAfter: nextBalance,
  };
}

export async function awardStoreCredits(input: {
  userId: string;
  amount: number;
  sourceType: StoreCreditSourceType;
  sourceId: string;
  meta?: Record<string, unknown>;
  createdBy?: string | null;
}) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error('Store Ticket award must be a positive integer.');
  }
  return withTransaction((client) =>
    mutateStoreCreditsForTransaction(client, input),
  );
}
