import { query } from '@/server/db/client';
import {
  isTrickShotDateKey,
  trickShotDateKey,
  TRICK_SHOT_BOARD_ORDER,
} from '@/features/arcade/lib/trick-shot/rules';
import { leaderboardServerError, noStoreJson, resolveLeaderboardLimit } from '../../_shared/leaderboard-helpers';

export const dynamic = 'force-dynamic';

type DailyRow = {
  id: string;
  od_user_id: string;
  user_name: string;
  pots: number;
  ball_count: number;
  clear: boolean;
  scratch: boolean;
  score: number;
  best_try: number;
};

type AlltimeRow = {
  od_user_id: string;
  user_name: string;
  played: number;
  clears: number;
  total: number;
  best: number;
};

/** Trick shot's board. Daily: each player's best try of the day, by most
 *  balls down (a clean clear over a scratch), then fewest tries to reach it,
 *  then the earliest (rules.ts compareTrickShotStandings). Past days by
 *  `?date=`. All time: days cleared, then points over every day's best. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') === 'alltime' ? 'alltime' : 'daily';
  const limit = resolveLeaderboardLimit(searchParams);

  try {
    if (mode === 'alltime') {
      const rows = (
        await query<AlltimeRow>(
          `SELECT od_user_id,
                  (ARRAY_AGG(user_name ORDER BY shot_at DESC))[1] AS user_name,
                  COUNT(*)::int AS played,
                  SUM(CASE WHEN clear THEN 1 ELSE 0 END)::int AS clears,
                  SUM(score)::int AS total,
                  MAX(score)::int AS best
             FROM trick_shot_attempts
            WHERE status = 'shot'
            GROUP BY od_user_id
            ORDER BY clears DESC, total DESC, MIN(shot_at) ASC
            LIMIT $1`,
          [limit],
        )
      ).rows;
      return noStoreJson({
        mode,
        leaderboard: rows.map((row) => ({
          id: `alltime-${row.od_user_id}`,
          userId: row.od_user_id,
          userName: row.user_name,
          score: row.clears,
          clears: row.clears,
          played: row.played,
          total: row.total,
          best: row.best,
        })),
      });
    }

    const dateParam = searchParams.get('date');
    const puzzleDate = isTrickShotDateKey(dateParam) ? dateParam : trickShotDateKey();
    const rows = (
      await query<DailyRow>(
        `SELECT id, od_user_id, user_name, pots, ball_count, clear, scratch, score,
                COALESCE(best_try, 1)::int AS best_try
           FROM trick_shot_attempts
          WHERE puzzle_date = $1 AND status = 'shot'
          ORDER BY ${TRICK_SHOT_BOARD_ORDER}
          LIMIT $2`,
        [puzzleDate, limit],
      )
    ).rows;
    return noStoreJson({
      mode,
      puzzleDate,
      leaderboard: rows.map((row) => ({
        id: row.id,
        userId: row.od_user_id,
        userName: row.user_name,
        score: row.score,
        pots: row.pots,
        ballCount: row.ball_count,
        clear: Boolean(row.clear),
        scratch: Boolean(row.scratch),
        tries: row.best_try,
      })),
    });
  } catch (error) {
    return leaderboardServerError(error);
  }
}
