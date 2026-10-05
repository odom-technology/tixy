import { asc, eq, desc } from 'drizzle-orm';
import { db, query } from '@/server/db/client';
import { wordGridScores } from '@/server/db/schema';
import {
  resolveLeaderboardLimit,
  noStoreJson,
  leaderboardServerError,
} from '../../_shared/leaderboard-helpers';
import { LEADERBOARD_QUERY_LIMIT } from '../../_shared/constants';
import { getUtcDateKey } from '@/server/arcade/word-grid';

export const dynamic = 'force-dynamic';

// ─── UTC calendar-day helpers (no weekend/holiday skipping) ──────────────────

const pad2 = (n: number): string => n.toString().padStart(2, '0');

const dateKeyFromUtc = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
};

/** Ordered (newest→oldest) list of consecutive UTC day keys ending at todayKey. */
const getRecentUtcDays = (todayKey: string, count: number): string[] => {
  const [y, m, d] = todayKey.split('-').map(Number);
  const startMs = Date.UTC(y!, m! - 1, d!);
  const days: string[] = [];
  for (let i = 0; i < count; i++) {
    days.push(dateKeyFromUtc(startMs - i * 86_400_000));
  }
  return days;
};

// ─── Streak calculation (batch) — consecutive UTC days solved ────────────────

type SolvedDateRow = { od_user_id: string; puzzle_date: string };

async function computeStreaksForUsers(
  userIds: string[],
  todayKey: string,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (userIds.length === 0) return result;

  const recentDays = getRecentUtcDays(todayKey, 400);
  const oldestDate = recentDays[recentDays.length - 1]!;

  const rows = (
    await query<SolvedDateRow>(
      `SELECT od_user_id, puzzle_date
         FROM word_grid_scores
        WHERE od_user_id = ANY($1::text[])
          AND solved = TRUE
          AND puzzle_date >= $2
        ORDER BY puzzle_date DESC`,
      [userIds, oldestDate],
    )
  ).rows;

  const userSolvedDates = new Map<string, Set<string>>();
  for (const row of rows) {
    let dates = userSolvedDates.get(row.od_user_id);
    if (!dates) {
      dates = new Set();
      userSolvedDates.set(row.od_user_id, dates);
    }
    dates.add(row.puzzle_date);
  }

  for (const userId of userIds) {
    const solvedDates = userSolvedDates.get(userId);
    if (!solvedDates || solvedDates.size === 0) {
      result.set(userId, 0);
      continue;
    }

    // Walk consecutive UTC days from today backward. Today not-yet-solved must
    // NOT break a streak earned through yesterday: if today is unsolved, start
    // counting from yesterday instead.
    let streak = 0;
    let started = false;
    for (let i = 0; i < recentDays.length; i++) {
      const dateKey = recentDays[i]!;
      const isSolved = solvedDates.has(dateKey);
      if (!started) {
        if (isSolved) {
          started = true;
          streak = 1;
        } else if (i === 0) {
          // today unsolved — keep looking; tomorrow's streak still stands
          continue;
        } else {
          // first considered past day is unsolved → no active streak
          break;
        }
      } else if (isSolved) {
        streak++;
      } else {
        break;
      }
    }
    result.set(userId, streak);
  }

  return result;
}

// ─── Daily leaderboard (default) ─────────────────────────────────────────────
// Rank: solved first, then fewest guesses, then fastest time.

async function getDailyLeaderboard(puzzleDate: string, limit: number) {
  const scores = await db
    .select({
      id: wordGridScores.id,
      odUserId: wordGridScores.odUserId,
      userName: wordGridScores.userName,
      guesses: wordGridScores.guesses,
      timeSeconds: wordGridScores.timeSeconds,
      solved: wordGridScores.solved,
    })
    .from(wordGridScores)
    .where(eq(wordGridScores.puzzleDate, puzzleDate))
    .orderBy(
      desc(wordGridScores.solved),
      asc(wordGridScores.guesses),
      asc(wordGridScores.timeSeconds),
    )
    .limit(limit);

  const userIds = [...new Set(scores.map((s) => s.odUserId))];
  const streaks = await computeStreaksForUsers(userIds as string[], getUtcDateKey());

  return scores.map((score) => {
    const solved = Boolean(score.solved);
    return {
      id: score.id,
      userId: score.odUserId,
      userName: score.userName,
      // Higher is better: solving in fewer guesses scores more.
      score: solved ? Math.max(0, (7 - score.guesses) * 100) : 0,
      guesses: score.guesses,
      timeSeconds: score.timeSeconds,
      solved,
      streak: streaks.get(score.odUserId) ?? 0,
    };
  });
}

// ─── All-time leaderboard ────────────────────────────────────────────────────

type AlltimeRow = {
  od_user_id: string;
  user_name: string;
  total_played: number;
  total_solved: number;
  solve_rate: number;
  avg_guesses: number;
};

async function getAlltimeLeaderboard(limit: number) {
  const rows = (
    await query<AlltimeRow>(
      `SELECT
         od_user_id,
         user_name,
         COUNT(*)::int AS total_played,
         SUM(CASE WHEN solved = TRUE THEN 1 ELSE 0 END)::int AS total_solved,
         ROUND((SUM(CASE WHEN solved = TRUE THEN 1 ELSE 0 END)::numeric / COUNT(*)::numeric) * 100, 1)::float AS solve_rate,
         ROUND(AVG(CASE WHEN solved = TRUE THEN guesses END)::numeric, 2)::float AS avg_guesses
       FROM word_grid_scores
       GROUP BY od_user_id, user_name
       ORDER BY total_solved DESC, solve_rate DESC, avg_guesses ASC NULLS LAST, MIN(created_at) ASC
       LIMIT $1`,
      [limit],
    )
  ).rows;

  const todayKey = getUtcDateKey();
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
    avgGuesses: row.avg_guesses ?? 0,
    streak: streaks.get(row.od_user_id) ?? 0,
  }));
}

// ─── Route handler ───────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') || 'daily';
  const limit = resolveLeaderboardLimit(searchParams) || LEADERBOARD_QUERY_LIMIT;

  try {
    if (mode === 'alltime') {
      const leaderboard = await getAlltimeLeaderboard(limit);
      return noStoreJson({ leaderboard, mode });
    }

    const dateParam = searchParams.get('date');
    const puzzleDate =
      dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
        ? dateParam
        : getUtcDateKey();

    const leaderboard = await getDailyLeaderboard(puzzleDate, limit);
    return noStoreJson({ leaderboard, mode: 'daily' });
  } catch (error) {
    return leaderboardServerError(error);
  }
}
