import { NextResponse } from 'next/server';
import {
  getUtcDateKey,
  getDayNumber,
  getDailySet,
  getDailySolutions,
} from '@/server/arcade/pangram';
import { applyDailyPangramOverride } from '@/server/arcade/daily-puzzle-pool';

export const dynamic = 'force-dynamic';

// Ships ONLY public puzzle metadata: the 7 letters, the center, the total word
// count, and the max score (needed for client rank-tier %). NEVER the word list.
export async function GET() {
  try {
    const dateKey = getUtcDateKey();
    // INVARIANT: keep this override apply adjacent to the synchronous reads below
    // — never insert an `await` between them. The override is a per-process Map;
    // an interleaved request for another day could swap it out mid-read.
    await applyDailyPangramOverride(dateKey);
    const set = getDailySet(dateKey);
    const solutions = getDailySolutions(dateKey);

    return NextResponse.json(
      {
        dateKey,
        dayNumber: getDayNumber(dateKey),
        letters: set.letters,
        center: set.center,
        totalWords: solutions.words.length,
        totalPangrams: solutions.pangrams.length,
        maxScore: solutions.maxScore,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Failed to fetch pangram puzzle:', error);
    return NextResponse.json(
      { error: 'Failed to fetch puzzle' },
      { status: 500 },
    );
  }
}
