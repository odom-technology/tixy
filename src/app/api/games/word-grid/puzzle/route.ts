import { NextResponse } from 'next/server';
import {
  getUtcDateKey,
  getDayNumber,
  WORD_GRID_LENGTH,
  WORD_GRID_MAX_GUESSES,
} from '@/server/arcade/word-grid';

export const dynamic = 'force-dynamic';

// Returns ONLY puzzle metadata — never the answer. The board length, the UTC
// date key, and the public day number are all the client needs; grading is done
// server-side via /validate.
export async function GET() {
  try {
    const dateKey = getUtcDateKey();
    return NextResponse.json(
      {
        dateKey,
        dayNumber: getDayNumber(dateKey),
        length: WORD_GRID_LENGTH,
        maxGuesses: WORD_GRID_MAX_GUESSES,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Failed to fetch word-grid puzzle:', error);
    return NextResponse.json({ error: 'Failed to fetch puzzle' }, { status: 500 });
  }
}
