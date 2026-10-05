import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { consumeReadRateLimit, tooManyAttemptsResponse } from '@/server/auth/auth-rate-limit';
import { getAccountsByIds } from '@/server/accounts';
import { query, queryOne } from '@/server/db/client';
import { listAcceptedFriendIds } from '@/server/arcade/multiplayer';
import { mgDateKey } from '@/server/arcade/mini-golf-course';
import { mgCourseCached } from '@/server/arcade/mini-golf-round';

export const dynamic = 'force-dynamic';

const MAX_FRIENDS = 24;
const LIMIT = 20;
const WINDOW_MS = 60_000;

type Row = { od_user_id: string; scores_json: string; holes_done: number; strokes: number; finished_at: string | number | null };

/**
 * Today's mini golf rounds for the signed-in player's accepted friends, for
 * the scorecard: each friend's strokes per hole, finished or how far along.
 * Like word grid's, it answers only once the caller has finished their own
 * counted round today (403 before), so nobody plays to someone's card.
 * Friends are accepted friendships only, and a block either way hides one.
 */
export async function GET() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  const limited = consumeReadRateLimit(`mini-golf-friends:${identity.userId}`, LIMIT, WINDOW_MS);
  if (limited.limited) return tooManyAttemptsResponse(limited.retryAfterSeconds);

  const headers = { 'Cache-Control': 'no-store' };
  const dateKey = mgDateKey(Date.now());
  try {
    const mine = await queryOne<{ id: string }>(
      `SELECT id FROM mini_golf_rounds WHERE od_user_id = $1 AND round_date = $2 AND finished_at IS NOT NULL LIMIT 1`,
      [identity.userId, dateKey],
    );
    if (!mine) {
      return NextResponse.json({ error: "Finish today's round to see your friends' cards." }, { status: 403, headers });
    }
    const friendIds = await listAcceptedFriendIds(identity.userId);
    if (friendIds.length === 0) return NextResponse.json({ dateKey, friends: [] }, { headers });

    const rows = (
      await query<Row>(
        `SELECT r.od_user_id, r.scores_json, r.holes_done, r.strokes, r.finished_at
           FROM mini_golf_rounds r
          WHERE r.round_date = $1
            AND r.holes_done > 0
            AND r.od_user_id = ANY($2::text[])
            AND NOT EXISTS (
              SELECT 1 FROM arcade_user_blocks b
               WHERE (b.blocker_user_id = $3 AND b.blocked_user_id = r.od_user_id)
                  OR (b.blocker_user_id = r.od_user_id AND b.blocked_user_id = $3)
            )`,
        [dateKey, friendIds, identity.userId],
      )
    ).rows;
    const accounts = await getAccountsByIds(rows.map((r) => r.od_user_id));
    const names = new Map(
      accounts.filter((a) => a.status === 'active').map((a) => [a.id, a.username || 'Player']),
    );
    const course = mgCourseCached(dateKey);
    const friends = rows
      .filter((r) => names.has(r.od_user_id))
      .map((r) => {
        let scores: number[] = [];
        try {
          scores = (JSON.parse(r.scores_json) as unknown[]).map(Number).filter(Number.isFinite);
        } catch {
          scores = [];
        }
        const holesDone = Number(r.holes_done);
        const parSoFar = course.holes.slice(0, holesDone).reduce((a, h) => a + h.hole.par, 0);
        return {
          userId: r.od_user_id,
          name: names.get(r.od_user_id)!,
          scores,
          holesDone,
          strokes: Number(r.strokes),
          toPar: Number(r.strokes) - parSoFar,
          finished: r.finished_at != null,
        };
      })
      .sort(
        (a, b) =>
          Number(b.finished) - Number(a.finished) ||
          a.toPar - b.toPar ||
          b.holesDone - a.holesDone ||
          a.name.localeCompare(b.name),
      )
      .slice(0, MAX_FRIENDS);
    return NextResponse.json({ dateKey, friends }, { headers });
  } catch (error) {
    console.error('Failed to load mini golf friends:', error);
    return NextResponse.json({ error: 'Unable to load friends right now.' }, { status: 500, headers });
  }
}
