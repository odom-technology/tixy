import { query } from '@/server/db/client';
import { mgDateKey } from '@/server/arcade/mini-golf-course';
import { LEADERBOARD_QUERY_LIMIT } from '../../_shared/constants';
import { leaderboardServerError, noStoreJson, resolveLeaderboardLimit } from '../../_shared/leaderboard-helpers';

export const dynamic = 'force-dynamic';

type Row = {
  id: string;
  od_user_id: string;
  user_name: string;
  strokes: number;
  par: number;
  aces: number;
  finished_at: string | number;
  round_date: string;
};

const toEntry = (row: Row) => {
  const strokes = Number(row.strokes);
  const toPar = strokes - Number(row.par);
  return {
    id: row.id,
    userId: row.od_user_id,
    userName: row.user_name,
    // The board ranks low to high; `score` is strokes against par.
    score: toPar,
    toPar,
    strokes,
    aces: Number(row.aces),
    roundDate: row.round_date,
  };
};

/**
 * Mini golf's boards. `daily` (the default): today's counted rounds, best
 * against par first, then whoever finished first. `alltime`: each player's
 * best round on any day, by the same order. Practice rounds never reach the
 * server, so they are never here.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') === 'alltime' ? 'alltime' : 'daily';
  const limit = resolveLeaderboardLimit(searchParams) || LEADERBOARD_QUERY_LIMIT;
  try {
    if (mode === 'alltime') {
      const rows = (
        await query<Row>(
          `SELECT DISTINCT ON (od_user_id) id, od_user_id, user_name, strokes, par, aces, finished_at, round_date
             FROM mini_golf_rounds
            WHERE finished_at IS NOT NULL
            ORDER BY od_user_id, (strokes - par) ASC, finished_at ASC`,
          [],
        )
      ).rows
        .sort((a, b) => Number(a.strokes) - Number(a.par) - (Number(b.strokes) - Number(b.par)) || Number(a.finished_at) - Number(b.finished_at))
        .slice(0, limit);
      return noStoreJson({ leaderboard: rows.map(toEntry), mode });
    }
    const dateParam = searchParams.get('date');
    const dateKey = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : mgDateKey(Date.now());
    const rows = (
      await query<Row>(
        `SELECT id, od_user_id, user_name, strokes, par, aces, finished_at, round_date
           FROM mini_golf_rounds
          WHERE round_date = $1 AND finished_at IS NOT NULL
          ORDER BY (strokes - par) ASC, finished_at ASC
          LIMIT $2`,
        [dateKey, limit],
      )
    ).rows;
    return noStoreJson({ leaderboard: rows.map(toEntry), mode, dateKey });
  } catch (error) {
    return leaderboardServerError(error);
  }
}
