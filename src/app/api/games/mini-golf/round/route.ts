import crypto from 'node:crypto';
import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { queryOne } from '@/server/db/client';
import { getGameBanStatus } from '@/server/arcade/game-bans';
import { checkNewGameAvailability } from '@/server/arcade/game-availability';
import { checkSessionStartLimit } from '@/server/arcade/game-rate-limit';
import { MG_RULES_VERSION } from '@/server/arcade/mini-golf-engine';
import { mgDateKey } from '@/server/arcade/mini-golf-course';
import { mgCourseCached, mgParseStoredHoles, mgParseStoredPutts } from '@/server/arcade/mini-golf-round';

export const dynamic = 'force-dynamic';

type RoundRow = {
  id: string;
  round_date: string;
  holes_json: string;
  current_json: string;
  scores_json: string;
  holes_done: number;
  strokes: number;
  par: number;
  aces: number;
  started_at: string | number;
  finished_at: string | number | null;
};

const headers = { 'Cache-Control': 'no-store' };

/** The round as the page reads it: enough to resume, never anyone else's. */
function publicRound(row: RoundRow | null) {
  if (!row) return null;
  const holes = mgParseStoredHoles(row.holes_json);
  return {
    id: row.id,
    dateKey: row.round_date,
    holesDone: Number(row.holes_done),
    holes: holes.map((h) => ({ putts: h.putts, score: h.score })),
    // The hole being played: its putts so far, to put the ball back.
    current: mgParseStoredPutts(row.current_json),
    strokes: Number(row.strokes),
    par: Number(row.par),
    aces: Number(row.aces),
    startedAt: Number(row.started_at),
    finished: row.finished_at != null,
  };
}

async function todaysRound(userId: string, dateKey: string): Promise<RoundRow | null> {
  return queryOne<RoundRow>(
    `SELECT id, round_date, holes_json, current_json, scores_json, holes_done, strokes, par, aces, started_at, finished_at
       FROM mini_golf_rounds
      WHERE od_user_id = $1 AND round_date = $2
      LIMIT 1`,
    [userId, dateKey],
  );
}

/**
 * Today's counted round for the signed-in player: none yet, open (resume
 * at holesDone), or finished (later rounds are practice). Guests get 401
 * and play without saving.
 */
export async function GET() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Sign in to save your round.' }, { status: 401, headers });
  }
  const dateKey = mgDateKey(Date.now());
  try {
    const [row, best] = await Promise.all([
      todaysRound(identity.userId, dateKey),
      queryOne<{ strokes: number; par: number }>(
        `SELECT strokes, par FROM mini_golf_rounds
          WHERE od_user_id = $1 AND finished_at IS NOT NULL
          ORDER BY (strokes - par) ASC, finished_at ASC
          LIMIT 1`,
        [identity.userId],
      ),
    ]);
    return NextResponse.json(
      {
        dateKey,
        par: mgCourseCached(dateKey).par,
        round: publicRound(row),
        best: best ? { strokes: Number(best.strokes), toPar: Number(best.strokes) - Number(best.par) } : null,
      },
      { headers },
    );
  } catch (error) {
    console.error('Failed to load mini golf round:', error);
    return NextResponse.json({ error: 'Unable to load your round right now.' }, { status: 500, headers });
  }
}

/**
 * Start today's counted round, or return the one already started. The row
 * is the server's stamp of when the round began; it can't be restarted.
 */
export async function POST() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Sign in to save your round.' }, { status: 401, headers });
  }
  const ban = await getGameBanStatus(identity.userId);
  if (ban.isBanned) {
    return NextResponse.json(
      {
        error: ban.isIndefinite
          ? 'You are currently banned from playing games until an admin removes the ban.'
          : 'You are temporarily banned from playing games.',
        retryAfterSec: ban.isIndefinite || ban.remainingMs <= 0 ? undefined : Math.ceil(ban.remainingMs / 1000),
        isIndefinite: ban.isIndefinite,
      },
      { status: 403, headers },
    );
  }
  const unavailable = await checkNewGameAvailability('mini-golf');
  if (unavailable) return unavailable;
  const limit = await checkSessionStartLimit(identity.userId, 'mini-golf');
  if (!limit.ok) {
    return NextResponse.json(
      { error: limit.reason, retryAfterSec: Math.ceil((limit.retryAfterMs ?? 1000) / 1000) },
      { status: 429, headers },
    );
  }

  const now = Date.now();
  const dateKey = mgDateKey(now);
  const course = mgCourseCached(dateKey);
  try {
    await queryOne(
      `INSERT INTO mini_golf_rounds (id, od_user_id, user_name, round_date, rules, par, started_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       ON CONFLICT (od_user_id, round_date) DO NOTHING`,
      [crypto.randomUUID(), identity.userId, identity.name || 'Player', dateKey, MG_RULES_VERSION, course.par, now],
    );
    const row = await todaysRound(identity.userId, dateKey);
    return NextResponse.json({ dateKey, par: course.par, round: publicRound(row) }, { headers });
  } catch (error) {
    console.error('Failed to start mini golf round:', error);
    return NextResponse.json({ error: 'Unable to start your round right now.' }, { status: 500, headers });
  }
}
