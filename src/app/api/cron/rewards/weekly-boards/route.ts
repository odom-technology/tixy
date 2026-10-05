import crypto from 'node:crypto';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/* Pays the weekly boards. With no week, every closed week that has no
   completed run (the catch-up); with ?week=YYYY-MM-DD (a Monday), that week.
   Idempotent: the server's own sweeper (server.ts) calls the same code every
   15 minutes, so this route is a manual nudge or a backup crontab. */

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
  const tokenBuffer = Buffer.from(getAuthToken(request));
  const secretBuffer = Buffer.from(secret);
  if (tokenBuffer.length !== secretBuffer.length || !crypto.timingSafeEqual(tokenBuffer, secretBuffer)) {
    return { ok: false as const, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return { ok: true as const };
};

const handleRequest = async (request: Request) => {
  const auth = verifyCronAuth(request);
  if (!auth.ok) return auth.response;

  const week = new URL(request.url).searchParams.get('week')?.trim() || undefined;
  try {
    const { runDueWeeklyBoardAwards, runWeeklyBoardAwards } = await import('@/server/arcade/rewards/weekly-boards');
    const results = week ? [await runWeeklyBoardAwards(week)] : await runDueWeeklyBoardAwards();
    return NextResponse.json({ results });
  } catch (error) {
    console.error('Failed to run the weekly boards:', error);
    return NextResponse.json({ error: (error as Error).message || 'Failed to run the weekly boards.' }, { status: 500 });
  }
};

export async function GET(request: Request) {
  return handleRequest(request);
}

export async function POST(request: Request) {
  return handleRequest(request);
}
