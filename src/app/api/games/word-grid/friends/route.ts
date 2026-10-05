import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { consumeReadRateLimit, tooManyAttemptsResponse } from '@/server/auth/auth-rate-limit';
import { getAccountsByIds } from '@/server/accounts';
import { query, queryOne } from '@/server/db/client';
import { listAcceptedFriendIds } from '@/server/arcade/multiplayer';
import { getUtcDateKey } from '@/server/arcade/word-grid';

export const dynamic = 'force-dynamic';

const MAX_FRIENDS = 24;

// The page asks once after a finish and once per reload. 20 a minute leaves
// room for a few tabs.
const LIMIT = 20;
const WINDOW_MS = 60_000;

type ScoreRow = { od_user_id: string; guesses: number; solved: boolean };

/**
 * Today's word grid results for the signed-in player's accepted friends.
 *
 * Read-only, and only the score line: a name, whether they solved it and on
 * which guess. Never a guess or a letter.
 *
 * No spoilers: the route answers only once the caller has a saved result of
 * their own for today's puzzle, so a player who has not finished gets a 403
 * and nothing about anyone else. Friends are accepted friendships only, and
 * a block in either direction hides the friend.
 */
export async function GET() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const limited = consumeReadRateLimit(`word-grid-friends:${identity.userId}`, LIMIT, WINDOW_MS);
  if (limited.limited) return tooManyAttemptsResponse(limited.retryAfterSeconds);

  const headers = { 'Cache-Control': 'no-store' };
  const puzzleDate = getUtcDateKey();

  try {
    const mine = await queryOne<{ id: string }>(
      `SELECT id FROM word_grid_scores WHERE od_user_id = $1 AND puzzle_date = $2 LIMIT 1`,
      [identity.userId, puzzleDate],
    );
    if (!mine) {
      return NextResponse.json(
        { error: "Finish today's puzzle to see your friends' results." },
        { status: 403, headers },
      );
    }

    const friendIds = await listAcceptedFriendIds(identity.userId);
    if (friendIds.length === 0) {
      return NextResponse.json({ puzzleDate, friends: [] }, { headers });
    }

    const rows = (
      await query<ScoreRow>(
        `SELECT s.od_user_id, s.guesses, s.solved
           FROM word_grid_scores s
          WHERE s.puzzle_date = $1
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
        solved: Boolean(row.solved),
        // The guess it was solved on (1 to 6). A miss has no number.
        guesses: row.solved ? row.guesses : null,
      }))
      .sort(
        (a, b) =>
          Number(b.solved) - Number(a.solved) ||
          (a.guesses ?? 99) - (b.guesses ?? 99) ||
          a.name.localeCompare(b.name),
      )
      .slice(0, MAX_FRIENDS);

    return NextResponse.json({ puzzleDate, friends }, { headers });
  } catch (error) {
    console.error('Failed to load word-grid friends:', error);
    return NextResponse.json({ error: 'Unable to load friends right now.' }, { status: 500, headers });
  }
}
