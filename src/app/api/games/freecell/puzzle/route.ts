import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import {
  deriveSessionSeed,
  getActiveSessionFromToken,
} from '@/server/arcade/game-session';
import {
  resolveDeal,
  dailySeedForDay,
  dayNumberFromMs,
} from '@/server/arcade/freecell-replay';

export const dynamic = 'force-dynamic';

type FreecellMode = 'daily' | 'free';
const isMode = (v: unknown): v is FreecellMode => v === 'daily' || v === 'free';

/**
 * GET /api/games/freecell/puzzle?token=<sessionToken>&mode=<daily|free>
 *
 * Validates the session token, derives the deal seed (free → the server-only
 * session seed; daily → the shared UTC-day seed fixed at session start so
 * everyone playing the daily on the same day gets the identical shuffle), runs
 * the SAME `resolveDeal` solvability re-derivation the score route runs, and
 * returns the proven-solvable deal (all cards are face-up, so the deal is
 * public) plus the deal key that scopes the leaderboard.
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
  const mode = searchParams.get('mode');

  if (!token) {
    return NextResponse.json({ error: 'Session token required.' }, { status: 400 });
  }
  if (!isMode(mode)) {
    return NextResponse.json(
      { error: 'Invalid mode. Must be daily or free.' },
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
  if (session.game_type !== 'freecell') {
    return NextResponse.json({ error: 'Game type mismatch.' }, { status: 403 });
  }
  if (session.od_user_id !== identity.userId) {
    return NextResponse.json({ error: 'Session user mismatch.' }, { status: 403 });
  }

  const dayNumber = dayNumberFromMs(session.started_at);
  const baseSeed =
    mode === 'daily' ? dailySeedForDay(dayNumber) : deriveSessionSeed(session.id);
  const dealKey = mode === 'daily' ? String(dayNumber) : 'free';

  const { deal } = resolveDeal(baseSeed);

  return NextResponse.json(
    {
      success: true,
      mode,
      dealKey,
      deal,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
