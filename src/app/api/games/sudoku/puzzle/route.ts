import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import {
  deriveSessionSeed,
  getActiveSessionFromToken,
} from '@/server/arcade/game-session';
import {
  generateSudoku,
  isSudokuDifficulty,
} from '@/server/arcade/sudoku-generator';

export const dynamic = 'force-dynamic';

/**
 * GET /api/games/sudoku/puzzle?token=<sessionToken>&difficulty=<easy|...|evil>
 *
 * Validates the session token, derives the server-only seed from the session
 * id, generates a uniquely-solvable puzzle for the difficulty, and returns
 * ONLY the givens (81-cell array, 0 = blank) + difficulty. The SOLUTION is
 * never sent — the score route regenerates it server-side to verify the
 * submitted solve.
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
  if (!isSudokuDifficulty(difficulty)) {
    return NextResponse.json(
      { error: 'Invalid difficulty. Must be easy, medium, hard, expert, or evil.' },
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
  if (session.game_type !== 'sudoku') {
    return NextResponse.json({ error: 'Game type mismatch.' }, { status: 403 });
  }
  if (session.od_user_id !== identity.userId) {
    return NextResponse.json({ error: 'Session user mismatch.' }, { status: 403 });
  }

  const seed = deriveSessionSeed(session.id);
  const { puzzle, blanks } = generateSudoku(seed, difficulty);

  // SOLUTION is intentionally omitted from the response.
  return NextResponse.json(
    {
      success: true,
      givens: puzzle,
      difficulty,
      blanks,
      givenCount: 81 - blanks,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
