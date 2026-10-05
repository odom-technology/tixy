import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import {
  deriveSessionSeed,
  getActiveSessionFromToken,
} from '@/server/arcade/game-session';
import {
  MINESWEEPER_CONFIG,
  generateMinesweeper,
  isMinesweeperDifficulty,
} from '@/server/arcade/minesweeper-generator';

export const dynamic = 'force-dynamic';

/**
 * GET /api/games/minesweeper/puzzle?token=<sessionToken>&difficulty=<beginner|intermediate|expert>
 *
 * Validates the session token, derives the server-only seed from the session
 * id, and returns ONLY safe board metadata: dimensions, mine count, the
 * guaranteed-safe opening cell, and the seed. The client uses the SAME seed to
 * derive the identical board locally for play; the score route regenerates the
 * board server-side to verify the submitted full-clear proof + the solve time.
 *
 * The mine layout is intentionally NOT enumerated in the response shape — the
 * client computes it deterministically from the seed, exactly as the server
 * does, so there is nothing to "hide" and nothing to trust from the client.
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
  const difficulty = searchParams.get('difficulty');

  if (!token) {
    return NextResponse.json({ error: 'Session token required.' }, { status: 400 });
  }
  if (!isMinesweeperDifficulty(difficulty)) {
    return NextResponse.json(
      {
        error: 'Invalid difficulty. Must be beginner, intermediate, or expert.',
      },
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
  if (session.game_type !== 'minesweeper') {
    return NextResponse.json({ error: 'Game type mismatch.' }, { status: 403 });
  }
  if (session.od_user_id !== identity.userId) {
    return NextResponse.json({ error: 'Session user mismatch.' }, { status: 403 });
  }

  const seed = deriveSessionSeed(session.id);
  const generated = generateMinesweeper(seed, difficulty);
  const cfg = MINESWEEPER_CONFIG[difficulty];

  return NextResponse.json(
    {
      success: true,
      difficulty,
      seed,
      rows: cfg.rows,
      cols: cfg.cols,
      mineCount: cfg.mines,
      firstSafeCell: generated.firstSafeCell,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
