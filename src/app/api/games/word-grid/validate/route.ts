import { NextResponse } from 'next/server';
import {
  getUtcDateKey,
  isValidDateKey,
  isValidGuess,
  getDailyAnswer,
  gradeWordGrid,
  isWinningGrade,
  WORD_GRID_LENGTH,
} from '@/server/arcade/word-grid';
import { applyDailyWordGridOverride } from '@/server/arcade/daily-puzzle-pool';

export const dynamic = 'force-dynamic';

type ValidatePayload = {
  dateKey?: string;
  guess?: string;
};

// Server-authoritative grading for a single guess.
//   • { valid:false }                          → not a real dictionary word
//   • { valid:true, result:[...5], won:bool }  → graded per-letter, no answer
//
// The answer is NEVER returned here (game may still be in progress). The score
// route is the only place that may reveal it (after the game is over).
export async function POST(request: Request) {
  let payload: ValidatePayload | null = null;
  try {
    payload = (await request.json()) as ValidatePayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const guessRaw = payload?.guess;
  if (typeof guessRaw !== 'string') {
    return NextResponse.json({ error: 'Missing guess.' }, { status: 400 });
  }
  const guess = guessRaw.trim().toLowerCase();

  if (!/^[a-z]{5}$/.test(guess)) {
    return NextResponse.json(
      { error: `Guess must be ${WORD_GRID_LENGTH} letters.` },
      { status: 400 },
    );
  }

  // Use the submitted date key only if it's today's; otherwise grade against
  // today's answer (prevents probing past/future answers).
  const todayKey = getUtcDateKey();
  const dateKey = isValidDateKey(payload?.dateKey) && payload!.dateKey === todayKey
    ? payload!.dateKey!
    : todayKey;

  if (!isValidGuess(guess)) {
    return NextResponse.json(
      { valid: false },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // INVARIANT: keep this override apply adjacent to the synchronous grade below —
  // never insert an `await` between them. The override is a per-process Map; an
  // interleaved request for another day could swap it out mid-grade.
  await applyDailyWordGridOverride(dateKey);
  const answer = getDailyAnswer(dateKey);
  const result = gradeWordGrid(guess, answer);

  return NextResponse.json(
    { valid: true, result, won: isWinningGrade(result) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
