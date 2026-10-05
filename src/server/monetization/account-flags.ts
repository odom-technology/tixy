import { query } from '@/server/db/client';

type QueryClient = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: T[] }>;
};

export type MonetizationAccountFlag = {
  flagType: string;
  reason: string;
  sourceId: string | null;
};

type MonetizationAccountFlagRow = {
  flag_type: string;
  reason: string;
  source_id: string | null;
};

const normalizeFlag = (
  row: MonetizationAccountFlagRow,
): MonetizationAccountFlag => ({
  flagType: row.flag_type,
  reason: row.reason,
  sourceId: row.source_id,
});

export async function getActiveMonetizationAccountFlag(userId: string) {
  const result = await query<MonetizationAccountFlagRow>(
    `
      SELECT flag_type, reason, source_id
      FROM monetization_account_flags
      WHERE user_id = $1 AND resolved_at IS NULL
      LIMIT 1
    `,
    [userId],
  );
  const row = result.rows[0];
  return row ? normalizeFlag(row) : null;
}

export async function getActiveMonetizationAccountFlagForTransaction(
  client: QueryClient,
  userId: string,
) {
  const result = await client.query<MonetizationAccountFlagRow>(
    `
      SELECT flag_type, reason, source_id
      FROM monetization_account_flags
      WHERE user_id = $1 AND resolved_at IS NULL
      LIMIT 1
    `,
    [userId],
  );
  const row = result.rows[0];
  return row ? normalizeFlag(row) : null;
}

export async function assertNoActiveMonetizationAccountFlagForTransaction(
  client: QueryClient,
  userId: string,
) {
  const activeFlag = await getActiveMonetizationAccountFlagForTransaction(
    client,
    userId,
  );
  if (activeFlag) {
    throw new Error(
      'Store purchases are temporarily unavailable for this account.',
    );
  }
}

export async function flagMonetizationAccountForTransaction(
  client: QueryClient,
  {
    userId,
    reason,
    sourceId,
    meta,
  }: {
    userId: string;
    reason: string;
    sourceId: string;
    meta?: Record<string, unknown>;
  },
) {
  const now = Date.now();
  await client.query(
    `
      INSERT INTO monetization_account_flags (
        user_id,
        flag_type,
        reason,
        source_id,
        created_at,
        updated_at,
        meta_json
      ) VALUES ($1, 'reversal_pending', $2, $3, $4, $4, $5)
      ON CONFLICT(user_id) DO UPDATE SET
        flag_type = excluded.flag_type,
        reason = excluded.reason,
        source_id = excluded.source_id,
        updated_at = excluded.updated_at,
        resolved_at = NULL,
        meta_json = excluded.meta_json
    `,
    [userId, reason, sourceId, now, meta ? JSON.stringify(meta) : null],
  );
}
