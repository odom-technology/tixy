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

  const { generateStoreDailyRotation, getServerDateKey } = await import(
    '@/server/arcade/rewards'
  );
  const url = new URL(request.url);
  const dateKey = url.searchParams.get('date')?.trim() || getServerDateKey();
  const forceRefresh = url.searchParams.get('force') === '1';

  try {
    const rotation = await generateStoreDailyRotation(dateKey, forceRefresh);
    return NextResponse.json({
      dateKey,
      generated: rotation.length,
      forceRefresh,
    });
  } catch (error) {
    console.error('Failed to generate store rotation:', error);
    return NextResponse.json({ error: 'Failed to generate store rotation.' }, { status: 500 });
  }
};

export async function GET(request: Request) {
  return handleRequest(request);
}

export async function POST(request: Request) {
  return handleRequest(request);
}
