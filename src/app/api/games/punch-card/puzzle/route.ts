import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import {
  deriveSessionSeed,
  getActiveSessionFromToken,
} from '@/server/arcade/game-session';
import {
  generatePunchCard,
  isPunchCardSize,
} from '@/server/arcade/punch-card-replay';

export const dynamic = 'force-dynamic';

/**
 * GET /api/games/punch-card/puzzle?token=<sessionToken>&size=<5x5|10x10|15x15>
 *
 * Validates the session token, derives the server-only seed from the session
 * id, generates a uniquely-line-solvable nonogram for the size, and returns
 * ONLY the row/column clues + size. The SOLUTION bitmap is never sent — the
 * client detects a solve by matching the clues, and the score route regenerates
 * the solution server-side to verify the submitted run.
 */
export async function GET(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');
  const size = searchParams.get('size');

  if (!token) {
    return NextResponse.json({ error: 'Session token required.' }, { status: 400 });
  }
  if (!isPunchCardSize(size)) {
    return NextResponse.json(
      { error: 'Invalid size. Must be 5x5, 10x10, or 15x15.' },
      { status: 400 },
    );
  }

  const active = await getActiveSessionFromToken(token);
  if (!active.valid || !active.session) {
    return NextResponse.json(
      { error: active.error ?? 'Invalid game session.' },
      { status: 403 },
    );
  }

  const session = active.session;
  if (session.game_type !== 'punch-card') {
    return NextResponse.json({ error: 'Game type mismatch.' }, { status: 403 });
  }
  if (session.od_user_id !== identity.userId) {
    return NextResponse.json({ error: 'Session user mismatch.' }, { status: 403 });
  }

  const seed = deriveSessionSeed(session.id);
  const { n, rowClues, colClues } = generatePunchCard(seed, size);

  // SOLUTION is intentionally omitted from the response.
  return NextResponse.json(
    {
      success: true,
      size,
      n,
      rowClues,
      colClues,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
