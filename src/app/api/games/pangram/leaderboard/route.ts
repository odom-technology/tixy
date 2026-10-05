import { asc, eq, desc } from 'drizzle-orm';
import { db, query } from '@/server/db/client';
import { pangramScores } from '@/server/db/schema';
import {
  resolveLeaderboardLimit,
  noStoreJson,
  leaderboardServerError,
} from '../../_shared/leaderboard-helpers';
import { LEADERBOARD_QUERY_LIMIT } from '../../_shared/constants';
import { getUtcDateKey } from '@/server/arcade/pangram';

export const dynamic = 'force-dynamic';

// ── UTC calendar-day helpers ─────────────────────────────────────────────────

const pad2 = (n: number) => n.toString().padStart(2, '0');

const dateKeyFromUtcMs = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
};

const utcMsFromKey = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!);
};

const DAY_MS = 86_400_000;

/** Consecutive UTC calendar days, today→back, newest first. */
function getRecentUtcDays(todayKey: string, count: number): string[] {
  const todayMs = utcMsFromKey(todayKey);
  const days: string[] = [];
  for (let i = 0; i < count; i++) days.push(dateKeyFromUtcMs(todayMs - i * DAY_MS));
  return days;
}

// ── Streak: consecutive UTC days with score > 0 (played-and-scored) ──────────

type ScoredDateRow = { od_user_id: string; puzzle_date: string };

async function computeStreaksForUsers(
  userIds: string[],
  todayKey: string,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (userIds.length === 0) return result;

  const days = getRecentUtcDays(todayKey, 200);
  const oldestDate = days[days.length - 1]!;

  const rows = (
    await query<ScoredDateRow>(
      `SELECT od_user_id, puzzle_date
       FROM pangram_scores
       WHERE od_user_id = ANY($1::text[])
         AND score > 0
         AND puzzle_date >= $2
       ORDER BY puzzle_date DESC`,
      [userIds, oldestDate],
    )
  ).rows;

  const userScoredDates = new Map<string, Set<string>>();
  for (const row of rows) {
    let dates = userScoredDates.get(row.od_user_id);
    if (!dates) {
      dates = new Set();
      userScoredDates.set(row.od_user_id, dates);
    }
    dates.add(row.puzzle_date);
  }

  for (const userId of userIds) {
    const scored = userScoredDates.get(userId);
    if (!scored || scored.size === 0) {
      result.set(userId, 0);
      continue;
    }
    let streak = 0;
    // Today may not be played yet — if missing, start the streak from yesterday.
    let started = false;
    for (const dateKey of days) {
      if (scored.has(dateKey)) {
        streak++;
        started = true;
      } else if (started || dateKey !== todayKey) {
        break;
      }
    }
    result.set(userId, streak);
  }

  return result;
}

// ── Daily leaderboard ────────────────────────────────────────────────────────

async function getDailyLeaderboard(puzzleDate: string, limit: number) {
  const scores = await db
    .select({
      id: pangramScores.id,
      odUserId: pangramScores.odUserId,
      userName: pangramScores.userName,
      score: pangramScores.score,
      wordsFound: pangramScores.wordsFound,
      pangrams: pangramScores.pangrams,
      timeSeconds: pangramScores.timeSeconds,
    })
    .from(pangramScores)
    .where(eq(pangramScores.puzzleDate, puzzleDate))
    .orderBy(
      desc(pangramScores.score),
      desc(pangramScores.pangrams),
      asc(pangramScores.timeSeconds),
    )
    .limit(limit);

  const userIds = [...new Set(scores.map((s) => s.odUserId))];
  const streaks = await computeStreaksForUsers(userIds as string[], getUtcDateKey());

  return scores.map((score) => ({
    id: score.id,
    userId: score.odUserId,
    userName: score.userName,
    score: score.score,
    wordsFound: score.wordsFound,
    pangrams: score.pangrams,
    timeSeconds: score.timeSeconds,
    streak: streaks.get(score.odUserId) ?? 0,
  }));
}

// ── All-time leaderboard ─────────────────────────────────────────────────────

type AlltimeRow = {
  od_user_id: string;
  user_name: string;
  total_played: number;
  best_score: number;
  total_words: number;
  total_pangrams: number;
};

async function getAlltimeLeaderboard(limit: number) {
  const rows = (
    await query<AlltimeRow>(
      `SELECT
         od_user_id,
         MAX(user_name) as user_name,
         COUNT(*)::int as total_played,
         MAX(score)::int as best_score,
         SUM(words_found)::int as total_words,
         SUM(pangrams)::int as total_pangrams
       FROM pangram_scores
       GROUP BY od_user_id
       ORDER BY best_score DESC, total_pangrams DESC, total_words DESC, MIN(created_at) ASC
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
    score: row.best_score,
    bestScore: row.best_score,
    totalPlayed: row.total_played,
    totalWords: row.total_words,
    totalPangrams: row.total_pangrams,
    streak: streaks.get(row.od_user_id) ?? 0,
  }));
}

// ── Route handler ────────────────────────────────────────────────────────────

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
