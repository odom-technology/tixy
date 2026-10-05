import { NextResponse } from 'next/server';

import { consumeReadRateLimit, getClientIp, tooManyAttemptsResponse } from '@/server/auth/auth-rate-limit';
import { requireIdentity } from '@/server/auth';
import {
  getTrickShotAttempt,
  getTrickShotBest,
  getTrickShotStreak,
  getTrickShotTable,
  viewAttempt,
  type TrickShotAttemptView,
} from '@/server/arcade/trick-shot';
import {
  trickShotDateKey,
  trickShotDayNumber,
  trickShotWeekday,
  TRICK_SHOT_WEEKDAYS,
} from '@/features/arcade/lib/trick-shot/rules';

export const dynamic = 'force-dynamic';

const LIMIT = 60;
const WINDOW_MS = 60_000;

/** Today's table: the balls and how hard it is, never the solution. For a
 *  signed-in player, their day so far (tries taken and the best of them),
 *  their best before today and their streak of cleared days. */
export async function GET(request: Request) {
  const limited = consumeReadRateLimit(`trick-shot-day:${getClientIp(request)}`, LIMIT, WINDOW_MS);
  if (limited.limited) return tooManyAttemptsResponse(limited.retryAfterSeconds);

  const dateKey = trickShotDateKey();
  let userId: string | null = null;
  try {
    userId = (await requireIdentity({ allowExternal: true })).userId;
  } catch {
    // Guests get the table and practise it.
  }

  try {
    const table = getTrickShotTable(dateKey);
    let attempt: TrickShotAttemptView | null = null;
    let best = 0;
    let streak = 0;
    if (userId) {
      const row = await getTrickShotAttempt(userId, dateKey);
      attempt = row ? viewAttempt(row) : null;
      best = await getTrickShotBest(userId, dateKey);
      streak = await getTrickShotStreak(userId, dateKey);
    }
    return NextResponse.json(
      {
        dateKey,
        dayNumber: trickShotDayNumber(dateKey),
        weekday: TRICK_SHOT_WEEKDAYS[trickShotWeekday(dateKey)],
        table,
        signedIn: Boolean(userId),
        attempt,
        best,
        streak,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Failed to load the trick shot table:', error);
    return NextResponse.json({ error: 'The table could not be racked.' }, { status: 500 });
  }
}
