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

const handleRequest = async (request: Request) => {
  const auth = verifyCronAuth(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const monthKey = url.searchParams.get('month')?.trim() || undefined;
  // Resets are disabled for now: default OFF, only honor an explicit ?reset=1
  // (still hard-gated behind ENABLE_LEADERBOARD_RESETS in payouts.ts). The
  // external monthly crontab passes no reset param, so it never wipes scores.
  const resetLeaderboards = url.searchParams.get('reset') === '1';

  try {
    const { runMonthlyLeaderboardRewards } = await import('@/server/arcade/rewards');
    const result = await runMonthlyLeaderboardRewards(monthKey, {
      resetLeaderboards,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to run monthly leaderboard rewards:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to run monthly leaderboard rewards.' },
      { status: 500 },
    );
  }
};

export async function GET(request: Request) {
  return handleRequest(request);
}

export async function POST(request: Request) {
  return handleRequest(request);
}
