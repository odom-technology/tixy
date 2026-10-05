import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

declare global {
  var __arcadePgPool: Pool | undefined;
}

export function getDatabaseUrl() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for the standalone arcade database.');
  }
  return connectionString;
}

export function getPool() {
  if (!globalThis.__arcadePgPool) {
    globalThis.__arcadePgPool = new Pool({
      connectionString: getDatabaseUrl(),
    });
  }
  return globalThis.__arcadePgPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
) {
  return getPool().query<T>(text, values);
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
) {
  const result = await query<T>(text, values);
  return result.rows[0] ?? null;
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

let drizzleDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getDrizzleDb() {
  drizzleDb ??= drizzle(getPool(), { schema });
  return drizzleDb;
}

export const db = new Proxy(
  {},
  {
    get(_target, prop) {
      return getDrizzleDb()[prop as keyof ReturnType<typeof getDrizzleDb>];
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) as any;
