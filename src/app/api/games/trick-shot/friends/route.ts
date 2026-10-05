import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { consumeReadRateLimit, tooManyAttemptsResponse } from '@/server/auth/auth-rate-limit';
import { getAccountsByIds } from '@/server/accounts';
import { query, queryOne } from '@/server/db/client';
import { listAcceptedFriendIds } from '@/server/arcade/multiplayer';
import { compareTrickShotStandings, trickShotDateKey } from '@/features/arcade/lib/trick-shot/rules';

export const dynamic = 'force-dynamic';

const MAX_FRIENDS = 24;
const LIMIT = 20;
const WINDOW_MS = 60_000;

type ShotRow = {
  od_user_id: string;
  pots: number;
  ball_count: number;
  clear: boolean;
  scratch: boolean;
  score: number;
  best_try: number;
  shot_at: string | number;
};

/**
 * Today's trick shot results for the signed-in player's accepted friends,
 * as word grid does them: a name, the best try's line ("2/3", "clear") and
 * the tries it took, never the shot itself. In the board's order: most
 * balls, then fewest tries, then the earliest.
 *
 * No spoilers: it answers only once the caller has a try in today, so
 * nobody reads a friend's result before shooting. Accepted
 * friendships only; a block either way hides the friend.
 */
export async function GET() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const limited = consumeReadRateLimit(`trick-shot-friends:${identity.userId}`, LIMIT, WINDOW_MS);
  if (limited.limited) return tooManyAttemptsResponse(limited.retryAfterSeconds);

  const headers = { 'Cache-Control': 'no-store' };
  const puzzleDate = trickShotDateKey();

  try {
    const mine = await queryOne<{ id: string }>(
      `SELECT id FROM trick_shot_attempts WHERE od_user_id = $1 AND puzzle_date = $2 AND status = 'shot' LIMIT 1`,
      [identity.userId, puzzleDate],
    );
    if (!mine) {
      return NextResponse.json(
        { error: "Take a try at today's table to see your friends' results." },
        { status: 403, headers },
      );
    }

    const friendIds = await listAcceptedFriendIds(identity.userId);
    if (friendIds.length === 0) return NextResponse.json({ puzzleDate, friends: [] }, { headers });

    const rows = (
      await query<ShotRow>(
        `SELECT s.od_user_id, s.pots, s.ball_count, s.clear, s.scratch, s.score,
                COALESCE(s.best_try, 1)::int AS best_try, s.shot_at
           FROM trick_shot_attempts s
          WHERE s.puzzle_date = $1
            AND s.status = 'shot'
            AND s.od_user_id = ANY($2::text[])
            AND NOT EXISTS (
              SELECT 1 FROM arcade_user_blocks b
               WHERE (b.blocker_user_id = $3 AND b.blocked_user_id = s.od_user_id)
                  OR (b.blocker_user_id = s.od_user_id AND b.blocked_user_id = $3)
            )`,
        [puzzleDate, friendIds, identity.userId],
      )
    ).rows;

    const accounts = await getAccountsByIds(rows.map((row) => row.od_user_id));
    const names = new Map(
      accounts
        .filter((account) => account.status === 'active')
        .map((account) => [account.id, account.username || 'Player']),
    );

    const friends = rows
      .filter((row) => names.has(row.od_user_id))
      .map((row) => ({
        userId: row.od_user_id,
        name: names.get(row.od_user_id)!,
        pots: row.pots,
        ballCount: row.ball_count,
        clear: Boolean(row.clear),
        scratch: Boolean(row.scratch),
        score: row.score,
        tries: row.best_try,
        reachedAt: Number(row.shot_at ?? 0),
      }))
      .sort(
        (a, b) =>
          compareTrickShotStandings(
            { pots: a.pots, score: a.score, bestTry: a.tries, reachedAt: a.reachedAt },
            { pots: b.pots, score: b.score, bestTry: b.tries, reachedAt: b.reachedAt },
          ) || a.name.localeCompare(b.name),
      )
      .map(({ reachedAt: _reachedAt, ...friend }) => friend)
      .slice(0, MAX_FRIENDS);

    return NextResponse.json({ puzzleDate, friends }, { headers });
  } catch (error) {
    console.error('Failed to load trick shot friends:', error);
    return NextResponse.json({ error: 'Unable to load friends right now.' }, { status: 500, headers });
  }
}
