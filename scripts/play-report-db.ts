/**
 * The read-only database layer for scripts/play-report.ts.
 *
 * Every call to `run` is one short transaction: BEGIN, SET TRANSACTION READ
 * ONLY, a statement timeout and a low lock timeout, a check that Postgres
 * reports the transaction as read only, the caller's SELECTs, ROLLBACK. The
 * report uses one transaction per source, so no transaction holds read locks on
 * many tables or stays open for long, and a failure in one source does not stop
 * the others.
 *
 * `query` accepts SELECT, WITH and SHOW only, as a single statement, and
 * refuses anything else before it reaches the database.
 */
import type { Client } from 'pg';

export type Row = Record<string, unknown>;
export type NamedParams = Record<string, unknown>;
export type ReadQuery = <T extends Row = Row>(text: string, params?: NamedParams) => Promise<T[]>;

const READ_ONLY_SQL = /^\s*(select|with|show)\b/i;
const CONTROL_SQL =
  /^(BEGIN|ROLLBACK|SET TRANSACTION READ ONLY|SET TRANSACTION ISOLATION LEVEL REPEATABLE READ|SET LOCAL (statement_timeout|lock_timeout|idle_in_transaction_session_timeout) = \d+)$/;

/** Throws unless the text is one SELECT, WITH or SHOW statement. */
export function assertReadStatement(text: string): void {
  const body = text.trim().replace(/;+\s*$/, '');
  if (!READ_ONLY_SQL.test(body) || body.includes(';')) {
    throw new Error(`Refusing statement that is not a single SELECT, WITH or SHOW: ${text.slice(0, 40)}`);
  }
}

/** Replaces $name placeholders with $1, $2 and so on, in order of first use. */
export function bindNamed(text: string, params: NamedParams): { text: string; values: unknown[] } {
  const order: string[] = [];
  const bound = text.replace(/\$([A-Za-z][A-Za-z0-9]*)\b/g, (_match, name: string) => {
    if (!(name in params)) throw new Error(`Unknown query parameter $${name}`);
    let index = order.indexOf(name);
    if (index === -1) {
      order.push(name);
      index = order.length - 1;
    }
    return `$${index + 1}`;
  });
  return { text: bound, values: order.map((name) => params[name]) };
}

export type ReadOnlyOptions = { statementTimeoutMs: number; lockTimeoutMs: number };

export function createReadOnlyRunner(client: Client, options: ReadOnlyOptions) {
  let transactions = 0;
  let verified = 0;

  const control = (text: string) => {
    if (!CONTROL_SQL.test(text)) throw new Error(`Refusing control statement: ${text}`);
    return client.query(text);
  };

  const query: ReadQuery = async <T extends Row = Row>(text: string, params: NamedParams = {}) => {
    assertReadStatement(text);
    const bound = bindNamed(text, params);
    return (await client.query<T>(bound.text, bound.values)).rows;
  };

  async function run<T>(fn: (q: ReadQuery) => Promise<T>): Promise<T> {
    transactions += 1;
    await control('BEGIN');
    try {
      await control('SET TRANSACTION READ ONLY');
      await control('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await control(`SET LOCAL statement_timeout = ${Math.floor(options.statementTimeoutMs)}`);
      await control(`SET LOCAL lock_timeout = ${Math.floor(options.lockTimeoutMs)}`);
      await control('SET LOCAL idle_in_transaction_session_timeout = 60000');
      const check = await client.query<{ transaction_read_only: string }>('SHOW transaction_read_only');
      if (check.rows[0]?.transaction_read_only !== 'on') throw new Error('Transaction is not read only. Stopping.');
      verified += 1;
      return await fn(query);
    } finally {
      await control('ROLLBACK').catch(() => undefined);
    }
  }

  return {
    run,
    /** True when at least one transaction ran and Postgres confirmed every one as read only. */
    stats: () => ({ transactions, verifiedReadOnly: transactions > 0 && verified === transactions }),
  };
}
