import crypto from 'node:crypto';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const getAuthToken = (request: Request) => {
  const authHeader = request.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return '';
  return authHeader.slice('Bearer '.length).trim();
};

const verifyCronAuth = (request: Request) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return { ok: false as const, response: NextResponse.json({ error: 'Missing CRON_SECRET configuration.' }, { status: 500 }) };
  }

  const token = getAuthToken(request);
  const tokenBuffer = Buffer.from(token);
  const secretBuffer = Buffer.from(secret);
  if (
    tokenBuffer.length !== secretBuffer.length ||
    !crypto.timingSafeEqual(tokenBuffer, secretBuffer)
  ) {
    return { ok: false as const, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  return { ok: true as const };
};

/* Nightly: roll the last 3 days into the admin metrics tables, and any day
   missing from the last 31. */
const handleRequest = async (request: Request) => {
  const auth = verifyCronAuth(request);
  if (!auth.ok) return auth.response;

  const { runRollup } = await import('@/server/admin/metrics/rollup');
  try {
    const { days, durationMs } = await runRollup({ days: 3 });
    return NextResponse.json({ days, durationMs });
  } catch (error) {
    console.error('[admin-metrics] rollup failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Failed to roll up admin metrics.' }, { status: 500 });
  }
};

export async function GET(request: Request) {
  return handleRequest(request);
}

export async function POST(request: Request) {
  return handleRequest(request);
}
