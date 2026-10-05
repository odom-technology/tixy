import { NextResponse } from 'next/server';
import { asc } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { connectionsPuzzles } from '@/server/db/schema';
import {
  formatDateKey,
  checkPuzzleDayWithBlackouts,
  getPuzzleDayIndexWithBlackouts,
} from '@/server/arcade/connections-calendar';

export const dynamic = 'force-dynamic';

type ConnectionsGroup = {
  category: string;
  words: [string, string, string, string];
  color: '#f8d74e' | '#7ed66e' | '#6eb4f8' | '#c97ed6';
};

export async function GET() {
  try {
    const now = new Date();
    const todayKey = formatDateKey(now);
    const dayCheck = await checkPuzzleDayWithBlackouts(todayKey);

    if (!dayCheck.isPuzzleDay) {
      const message =
        dayCheck.reason === 'holiday'
          ? `No puzzle today — ${dayCheck.holiday}. Enjoy the day off!`
          : `No puzzle today — ${dayCheck.blackoutReason}`;

      return NextResponse.json(
        { puzzle: null, reason: dayCheck.reason, message },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const puzzleIndex = await getPuzzleDayIndexWithBlackouts(todayKey);
    if (puzzleIndex < 0) {
      return NextResponse.json(
        { puzzle: null, reason: 'no-puzzle' },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const allPuzzles = await db
      .select()
      .from(connectionsPuzzles)
      .orderBy(asc(connectionsPuzzles.sortOrder));

    if (allPuzzles.length === 0) {
      return NextResponse.json(
        { puzzle: null, reason: 'no-puzzles-in-db', message: 'No puzzles have been seeded yet. Run: npx tsx scripts/seed-connections.ts' },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const puzzleRow = allPuzzles[puzzleIndex % allPuzzles.length]!;
    const groups = JSON.parse(puzzleRow.groupsJson) as ConnectionsGroup[];

    return NextResponse.json(
      {
        puzzle: { groups },
        puzzleIndex,
        totalPuzzles: allPuzzles.length,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Failed to fetch connections puzzle:', error);
    return NextResponse.json(
      { error: 'Failed to fetch puzzle' },
      { status: 500 },
    );
  }
}
