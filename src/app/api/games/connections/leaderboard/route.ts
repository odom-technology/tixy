import { asc, eq, desc } from 'drizzle-orm';
import { db, query } from '@/server/db/client';
import { connectionsScores } from '@/server/db/schema';
import {
  resolveLeaderboardLimit,
  noStoreJson,
  leaderboardServerError,
} from '../../_shared/leaderboard-helpers';
import { LEADERBOARD_QUERY_LIMIT } from '../../_shared/constants';
import {
  formatDateKey,
  getRecentPuzzleDaysWithBlackouts,
} from '@/server/arcade/connections-calendar';

export const dynamic = 'force-dynamic';

const getTodayDateKey = () => formatDateKey(new Date());

// ─── Streak calculation (batch) ─────────────────────────────────────────────
// Uses getRecentPuzzleDays which skips holidays and blackout dates.

type SolvedDateRow = { od_user_id: string; puzzle_date: string };

async function computeStreaksForUsers(
  userIds: string[],
  todayKey: string,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (userIds.length === 0) return result;

  // Get recent puzzle days (skipping holidays and blackouts)
  const puzzleDays = await getRecentPuzzleDaysWithBlackouts(todayKey, 200);
  if (puzzleDays.length === 0) return result;

  const oldestDate = puzzleDays[puzzleDays.length - 1]!;
  const rows = (
    await query<SolvedDateRow>(
      `SELECT od_user_id, puzzle_date
       FROM connections_scores
       WHERE od_user_id = ANY($1::text[])
         AND solved = TRUE
         AND puzzle_date >= $2
       ORDER BY puzzle_date DESC`,
      [userIds, oldestDate],
    )
  ).rows;

  // Build solved-date sets per user
  const userSolvedDates = new Map<string, Set<string>>();
  for (const row of rows) {
    let dates = userSolvedDates.get(row.od_user_id);
    if (!dates) {
      dates = new Set();
      userSolvedDates.set(row.od_user_id, dates);
    }
    dates.add(row.puzzle_date);
  }

  // Walk through puzzle days (which already exclude holidays/blackouts)
  for (const userId of userIds) {
    const solvedDates = userSolvedDates.get(userId);
    if (!solvedDates || solvedDates.size === 0) {
      result.set(userId, 0);
      continue;
    }

    let streak = 0;
    for (const dateKey of puzzleDays) {
      if (solvedDates.has(dateKey)) {
        streak++;
      } else {
        break;
      }
    }
    result.set(userId, streak);
  }

  return result;
}

// ─── Daily leaderboard (default) ────────────────────────────────────────────

async function getDailyLeaderboard(puzzleDate: string, limit: number) {
  const scores = await db
    .select({
      id: connectionsScores.id,
      odUserId: connectionsScores.odUserId,
      userName: connectionsScores.userName,
      mistakes: connectionsScores.mistakes,
      timeSeconds: connectionsScores.timeSeconds,
      solved: connectionsScores.solved,
    })
    .from(connectionsScores)
    .where(eq(connectionsScores.puzzleDate, puzzleDate))
    .orderBy(
      desc(connectionsScores.solved),
      asc(connectionsScores.mistakes),
      asc(connectionsScores.timeSeconds),
    )
    .limit(limit);

  const userIds = [...new Set(scores.map((s) => s.odUserId))];
  const streaks = await computeStreaksForUsers(userIds as string[], getTodayDateKey());

  return scores.map((score) => ({
    id: score.id,
    userId: score.odUserId,
    userName: score.userName,
    score: score.solved ? (4 - score.mistakes) * 100 : 0,
    mistakes: score.mistakes,
    timeSeconds: score.timeSeconds,
    solved: Boolean(score.solved),
    streak: streaks.get(score.odUserId) ?? 0,
  }));
}

// ─── All-time leaderboard ───────────────────────────────────────────────────

type AlltimeRow = {
  od_user_id: string;
  user_name: string;
  total_played: number;
  total_solved: number;
  solve_rate: number;
  total_mistakes: number;
};

async function getAlltimeLeaderboard(limit: number) {
  const rows = (
    await query<AlltimeRow>(
      `SELECT
         od_user_id,
         user_name,
         COUNT(*)::int as total_played,
         SUM(CASE WHEN solved = TRUE THEN 1 ELSE 0 END)::int as total_solved,
         ROUND((SUM(CASE WHEN solved = TRUE THEN 1 ELSE 0 END)::numeric / COUNT(*)::numeric) * 100, 1)::float as solve_rate,
         SUM(mistakes)::int as total_mistakes
       FROM connections_scores
       GROUP BY od_user_id
       ORDER BY total_solved DESC, solve_rate DESC, total_mistakes ASC, MIN(created_at) ASC
       LIMIT $1`,
      [limit],
    )
  ).rows;

  const todayKey = getTodayDateKey();
  const userIds = rows.map((r) => r.od_user_id);
  const streaks = await computeStreaksForUsers(userIds, todayKey);

  return rows.map((row) => ({
    id: `alltime-${row.od_user_id}`,
    userId: row.od_user_id,
    userName: row.user_name,
    score: row.total_solved,
    totalPlayed: row.total_played,
    totalSolved: row.total_solved,
    solveRate: row.solve_rate,
    totalMistakes: row.total_mistakes,
    streak: streaks.get(row.od_user_id) ?? 0,
  }));
}

// ─── Route handler ──────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') || 'daily';
  const limit = resolveLeaderboardLimit(searchParams) || LEADERBOARD_QUERY_LIMIT;

  try {
    if (mode === 'alltime') {
      const leaderboard = await getAlltimeLeaderboard(limit);
      return noStoreJson({ leaderboard, mode });
    }

    // Default: daily
    const dateParam = searchParams.get('date');
    const puzzleDate =
      dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
        ? dateParam
        : getTodayDateKey();

    const leaderboard = await getDailyLeaderboard(puzzleDate, limit);
    return noStoreJson({ leaderboard, mode: 'daily' });
  } catch (error) {
    return leaderboardServerError(error);
  }
}
