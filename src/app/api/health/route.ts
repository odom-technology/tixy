// ---------------------------------------------------------------------------
// Health check endpoint for uptime monitoring and load balancers.
//
// Unauthenticated by design: it returns only a boolean and never leaks
// configuration or error details. Verifies the database is reachable with a
// short timeout so a hung Postgres connection cannot stall the probe.
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { query } from '@/server/db/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DB_CHECK_TIMEOUT_MS = 2000;

export async function GET() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      query('SELECT 1'),
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Database health check timed out')),
          DB_CHECK_TIMEOUT_MS,
        );
      }),
    ]);
    return NextResponse.json({ ok: true });
  } catch {
    // Intentionally swallow the error: health responses must not leak
    // connection strings, stack traces, or driver details.
    return NextResponse.json({ ok: false }, { status: 503 });
  } finally {
    clearTimeout(timer);
  }
}
