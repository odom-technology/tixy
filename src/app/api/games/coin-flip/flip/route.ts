import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { getActiveSessionFromToken, recordGameAction } from '@/server/arcade/game-session';
import { getGameEvents, recordGameEvent } from '@/server/arcade/game-events';

export const dynamic = 'force-dynamic';

type CoinFace = 'heads' | 'tails';

type FlipPayload = {
  sessionToken?: string;
  flipIndex?: number;
  side?: CoinFace;
};

const COIN_FLIP_MIN_INTERVAL_MS = 1000;
const MAX_FLIPS_PER_RUN = 10000;

function mulberry32(seed: number) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getFlipResult(seed: number, flipIndex: number): CoinFace {
  const rng = mulberry32(seed);
  let result: CoinFace = 'heads';
  for (let i = 0; i < flipIndex; i++) {
    result = rng() < 0.5 ? 'heads' : 'tails';
  }
  return result;
}

function parseFlipCount(raw: string | null): number {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const flipCount = parsed.flip;
    return typeof flipCount === 'number' && Number.isFinite(flipCount)
      ? Math.max(0, Math.floor(flipCount))
      : 0;
  } catch {
    return 0;
  }
}

export async function POST(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  let payload: FlipPayload | null = null;
  try {
    payload = (await request.json()) as FlipPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  if (
    typeof payload?.sessionToken !== 'string'
    || typeof payload.flipIndex !== 'number'
    || !Number.isInteger(payload.flipIndex)
    || (payload.side !== 'heads' && payload.side !== 'tails')
  ) {
    return NextResponse.json(
      { error: 'sessionToken, flipIndex, and side are required.' },
      { status: 400 },
    );
  }

  const flipIndex = payload.flipIndex;
  const side = payload.side;
  if (flipIndex < 1 || flipIndex > MAX_FLIPS_PER_RUN) {
    return NextResponse.json({ error: 'Invalid flip index.' }, { status: 400 });
  }

  const sessionState = await getActiveSessionFromToken(payload.sessionToken);
  if (!sessionState.valid || !sessionState.session) {
    return NextResponse.json(
      { error: sessionState.error ?? 'Invalid game session.' },
      { status: 400 },
    );
  }

  const session = sessionState.session;
  if (session.od_user_id !== identity.userId || session.game_type !== 'coin-flip') {
    return NextResponse.json({ error: 'Invalid game session.' }, { status: 400 });
  }
  if (session.coin_flip_seed === null || session.coin_flip_seed === undefined) {
    return NextResponse.json({ error: 'Coin flip session seed missing.' }, { status: 400 });
  }

  const existingFlipEvent = (await getGameEvents(session.id, 'coin_flip_pick'))
    .find((event) => {
      const data = event.data as { flipIndex?: unknown } | undefined;
      return typeof data?.flipIndex === 'number' && data.flipIndex === flipIndex;
    });

  const resolvedFlipCount = parseFlipCount(session.action_counts_json);
  if (flipIndex <= resolvedFlipCount) {
    const existingResult = (existingFlipEvent?.data as { result?: unknown } | undefined)?.result;
    return NextResponse.json({
      success: true,
      result:
        existingResult === 'heads' || existingResult === 'tails'
          ? existingResult
          : getFlipResult(session.coin_flip_seed, flipIndex),
      flipIndex,
      replayed: true,
    });
  }

  if (flipIndex !== resolvedFlipCount + 1) {
    return NextResponse.json(
      { error: 'Flip index out of sequence. Please refresh and try again.' },
      { status: 409 },
    );
  }

  if (
    resolvedFlipCount > 0
    && Date.now() - session.last_action_at < COIN_FLIP_MIN_INTERVAL_MS
  ) {
    return NextResponse.json(
      { error: 'Flip requested too quickly.' },
      { status: 429 },
    );
  }

  const recorded = await recordGameAction(session.id, identity.userId, { action: 'flip' });
  if (!recorded) {
    return NextResponse.json({ error: 'Invalid or expired session.' }, { status: 400 });
  }

  const result = getFlipResult(session.coin_flip_seed, flipIndex);
  await recordGameEvent({
    sessionId: session.id,
    odUserId: identity.userId,
    gameType: 'coin-flip',
    eventType: 'coin_flip_pick',
    ts: Date.now(),
    data: { flipIndex, side, result },
  });

  return NextResponse.json({
    success: true,
    result,
    flipIndex,
    replayed: false,
  });
}
