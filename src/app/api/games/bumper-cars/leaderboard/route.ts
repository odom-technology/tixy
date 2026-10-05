import { query } from '@/server/db/client';
import { leaderboardServerError, noStoreJson, resolveLeaderboardLimit } from '../../_shared/leaderboard-helpers';

export const dynamic = 'force-dynamic';

type Row = {
  user_id: string;
  user_name: string;
  best: number;
  points: number;
  rounds: number;
  wins: number;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Bumper cars' board: each player's best round score (points plus the
 *  podium) in settled rounds they finished or timed out of, this week or all
 *  time, the earlier round first on a tie. Forfeits don't count. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') === 'alltime' ? 'alltime' : 'week';
  const limit = resolveLeaderboardLimit(searchParams);
  const since = mode === 'week' ? Date.now() - WEEK_MS : 0;
  try {
    const rows = (
      await query<Row>(
        `SELECT p.user_id,
                (ARRAY_AGG(p.user_name ORDER BY p.created_at DESC))[1] AS user_name,
                MAX(p.score)::int AS best,
                (ARRAY_AGG(p.points ORDER BY p.score DESC, p.created_at ASC))[1]::int AS points,
                COUNT(*)::int AS rounds,
                SUM(CASE WHEN p.place = 1 AND p.points > 0 THEN 1 ELSE 0 END)::int AS wins
           FROM bumper_car_players p
           JOIN bumper_car_rounds r ON r.id = p.round_id
          WHERE r.status = 'settled'
            AND p.result IN ('finished', 'timeout')
            AND p.created_at >= $1
          GROUP BY p.user_id
          ORDER BY best DESC, MIN(p.created_at) ASC
          LIMIT $2`,
        [since, limit],
      )
    ).rows;
    return noStoreJson({
      mode,
      leaderboard: rows.map((row) => ({
        id: `${mode}-${row.user_id}`,
        userId: row.user_id,
        userName: row.user_name,
        score: row.best,
        points: row.points,
        rounds: row.rounds,
        wins: row.wins,
      })),
    });
  } catch (error) {
    return leaderboardServerError(error);
  }
}
