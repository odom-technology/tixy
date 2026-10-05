import { queryOne } from '@/server/db/client';

export type PublicProfileStats = {
  snake: { score: number | null };
  flappyBird: { score: number | null };
  reactionTime: {
    averageTime: number | null;
    bestTime: number | null;
  };
  typingTest: {
    wpm: number | null;
    accuracy: number | null;
  };
  tetris: {
    score: number | null;
    lines: number | null;
  };
  coinFlip: {
    streak: number | null;
    accuracyPercentage: number | null;
  };
  connections: {
    totalSolved: number | null;
    solveRate: number | null;
  };
  pool: {
    eloRating: number;
    totalWins: number;
    totalLosses: number;
  } | null;
};

const emptyStats: PublicProfileStats = {
  snake: { score: null },
  flappyBird: { score: null },
  reactionTime: { averageTime: null, bestTime: null },
  typingTest: { wpm: null, accuracy: null },
  tetris: { score: null, lines: null },
  coinFlip: { streak: null, accuracyPercentage: null },
  connections: { totalSolved: null, solveRate: null },
  pool: null,
};

function numberOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function safeQueryOne<T extends Record<string, unknown>>(
  text: string,
  values: unknown[],
) {
  try {
    return await queryOne<T>(text, values);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '42P01' || code === '42703') return null;
    throw error;
  }
}

export async function getPublicProfileStats(userId: string): Promise<PublicProfileStats> {
  const [
    snake,
    flappyBird,
    reactionTime,
    typingTest,
    tetris,
    coinFlip,
    connections,
    pool,
  ] = await Promise.all([
    safeQueryOne<{ score: number }>(
      `SELECT score
       FROM snake_scores
       WHERE od_user_id = $1
       ORDER BY score DESC, created_at ASC
       LIMIT 1`,
      [userId],
    ),
    safeQueryOne<{ score: number }>(
      `SELECT score
       FROM flappy_bird_scores
       WHERE od_user_id = $1
       ORDER BY score DESC, created_at ASC
       LIMIT 1`,
      [userId],
    ),
    safeQueryOne<{ average_time: number; best_time: number }>(
      `SELECT average_time, best_time
       FROM reaction_time_scores
       WHERE od_user_id = $1
       ORDER BY score DESC, average_time ASC, best_time ASC, created_at ASC
       LIMIT 1`,
      [userId],
    ),
    safeQueryOne<{ wpm: number; accuracy: number }>(
      `SELECT wpm, accuracy
       FROM typing_test_scores
       WHERE od_user_id = $1
       ORDER BY wpm DESC, accuracy DESC, created_at ASC
       LIMIT 1`,
      [userId],
    ),
    safeQueryOne<{ score: number; lines: number }>(
      `SELECT score, lines
       FROM tetris_scores
       WHERE od_user_id = $1
       ORDER BY score DESC, lines ASC, created_at ASC
       LIMIT 1`,
      [userId],
    ),
    safeQueryOne<{ streak: number; accuracy_percentage: number }>(
      `SELECT
         streak,
         CASE
           WHEN GREATEST(total_flips, streak + 1) > 0
             THEN ROUND(
               (GREATEST(total_correct_flips, streak)::numeric /
                GREATEST(total_flips, streak + 1)::numeric) * 100,
               1
             )
           ELSE 0
         END AS accuracy_percentage
       FROM coin_flip_scores
       WHERE od_user_id = $1
       ORDER BY streak DESC, created_at ASC
       LIMIT 1`,
      [userId],
    ),
    safeQueryOne<{ total_solved: number; solve_rate: number }>(
      `SELECT
         COALESCE(SUM(CASE WHEN solved THEN 1 ELSE 0 END), 0) AS total_solved,
         CASE
           WHEN COUNT(*) > 0
             THEN ROUND(
               (SUM(CASE WHEN solved THEN 1 ELSE 0 END)::numeric / COUNT(*)::numeric) * 100,
               1
             )
           ELSE 0
         END AS solve_rate
       FROM connections_scores
       WHERE od_user_id = $1`,
      [userId],
    ),
    safeQueryOne<{
      elo_rating: number;
      total_wins: number;
      total_losses: number;
      total_games: number;
    }>(
      `SELECT elo_rating, total_wins, total_losses, total_games
       FROM pool_elo
       WHERE user_id = $1
       LIMIT 1`,
      [userId],
    ),
  ]);

  return {
    ...emptyStats,
    snake: { score: numberOrNull(snake?.score) },
    flappyBird: { score: numberOrNull(flappyBird?.score) },
    reactionTime: {
      averageTime: numberOrNull(reactionTime?.average_time),
      bestTime: numberOrNull(reactionTime?.best_time),
    },
    typingTest: {
      wpm: numberOrNull(typingTest?.wpm),
      accuracy: numberOrNull(typingTest?.accuracy),
    },
    tetris: {
      score: numberOrNull(tetris?.score),
      lines: numberOrNull(tetris?.lines),
    },
    coinFlip: {
      streak: numberOrNull(coinFlip?.streak),
      accuracyPercentage: numberOrNull(coinFlip?.accuracy_percentage),
    },
    connections: {
      totalSolved: numberOrNull(connections?.total_solved),
      solveRate: numberOrNull(connections?.solve_rate),
    },
    pool:
      pool && Number(pool.total_games) > 0
        ? {
            eloRating: Number(pool.elo_rating),
            totalWins: Number(pool.total_wins),
            totalLosses: Number(pool.total_losses),
          }
        : null,
  };
}
