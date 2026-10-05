import type { PoolClient } from 'pg';

import { getPool, withTransaction } from '@/server/db/client';

/** Something that runs SQL: the pool, or a client inside a transaction.
 *  The 8-ball settle helpers take one so a match's result, stats, Elo and
 *  wager can commit together (forfeitMatch, the shot route's game over). */
export type PoolSql = Pick<PoolClient, 'query'>;

export const poolSql = (sql?: PoolSql): PoolSql => sql ?? getPool();

/** Deadlock detected, or a serialization failure: safe to run again. */
const RETRYABLE = new Set(['40P01', '40001']);

/**
 * A settle transaction, run once more if Postgres aborts it for a deadlock
 * or a serialization failure. The whole transaction runs again from the
 * start, so it re-reads the match and settles only if it still can. Any
 * other error, or a second abort, is thrown to the caller as it is.
 */
export async function withSettleTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  try {
    return await withTransaction(fn);
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (!code || !RETRYABLE.has(code)) throw error;
    return withTransaction(fn);
  }
}

/** Sort two user ids so every settle locks rows in the same order. */
export const inUserIdOrder = <T extends { id: string }>(a: T, b: T): [T, T] =>
  a.id <= b.id ? [a, b] : [b, a];
