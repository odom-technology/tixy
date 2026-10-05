import { NextResponse } from 'next/server';
import { getUtcDateKey, gradeGuess } from '@/server/arcade/pangram';
import { applyDailyPangramOverride } from '@/server/arcade/daily-puzzle-pool';

export const dynamic = 'force-dynamic';

type GuessPayload = {
  dateKey?: string;
  word?: string;
};

// Server-authoritative single-word grading. Never returns the solution list —
// only a yes/no plus the points for THIS word.
export async function POST(request: Request) {
  let payload: GuessPayload | null = null;
  try {
    payload = (await request.json()) as GuessPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const dateKey = payload?.dateKey;
  const word = payload?.word;

  if (typeof dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return NextResponse.json({ error: 'Invalid puzzle date.' }, { status: 400 });
  }
  if (typeof word !== 'string' || word.length === 0 || word.length > 24) {
    return NextResponse.json({ error: 'Invalid word.' }, { status: 400 });
  }

  // Only grade against today's UTC puzzle.
  const todayKey = getUtcDateKey();
  if (dateKey !== todayKey) {
    return NextResponse.json(
      { error: 'Guesses are only accepted for today\'s puzzle.' },
      { status: 400 },
    );
  }

  // INVARIANT: keep this override apply adjacent to the synchronous grade below —
  // never insert an `await` between them. The override is a per-process Map; an
  // interleaved request for another day could swap it out mid-grade.
  await applyDailyPangramOverride(todayKey);
  const result = gradeGuess(todayKey, word);
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
