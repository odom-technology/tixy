import { queryOne } from '@/server/db/client';
import {
  getAntiCheatPlayRestriction,
  type AntiCheatPlayRestriction,
} from '@/server/arcade/anti-cheat-logs';
import {
  getUserGameTimeMetrics,
} from '@/server/arcade/game-time-metrics';
import type { UserGameTimeMetrics } from '@/features/arcade/lib/game-time';
import {
  getGameBanStatus,
  type GameBanStatus,
} from '@/server/arcade/game-bans';
import {
  getElo,
  getEloRank,
  getTierName,
  getTierColor,
  STARTING_ELO,
} from '@/server/arcade/pool-elo';
import { getWalletForUser } from '@/server/arcade/rewards';

type ProfileScoreStats = {
  snake: {
    score: number | null;
    createdAt: number | null;
  };
  flappyBird: {
    score: number | null;
    createdAt: number | null;
  };
  reactionTime: {
    score: number | null;
    averageTime: number | null;
    bestTime: number | null;
    attempts: number | null;
    createdAt: number | null;
  };
  typingTest: {
    wpm: number | null;
    accuracy: number | null;
    mode: number | null;
    rawWpm: number | null;
    createdAt: number | null;
  };
  tetris: {
    score: number | null;
    level: number | null;
    lines: number | null;
    totalGames: number | null;
    totalLines: number | null;
    totalPlayTimeMs: number | null;
    createdAt: number | null;
  };
  coinFlip: {
    streak: number | null;
    totalGamesPlayed: number | null;
    accuracyPercentage: number | null;
    createdAt: number | null;
  };
  connections: {
    totalPlayed: number | null;
    totalSolved: number | null;
    solveRate: number | null;
    lastPlayedAt: number | null;
  };
};

type ProfilePoolStats = {
  eloRating: number;
  tier: string;
  tierColor: string;
  rank: number | null;
  totalGames: number;
  totalWins: number;
  totalLosses: number;
  winRate: number;
  peakElo: number;
  currentStreak: number;
  bestStreak: number;
  totalShots: number;
  totalBallsPocketed: number;
  forfeits: number;
} | null;

export type ProfileStats = {
  wallet: {
    credits: number;
  };
  gameBan: GameBanStatus;
  antiCheatRestriction: AntiCheatPlayRestriction;
  gameTime: UserGameTimeMetrics;
  scores: ProfileScoreStats;
  pool: ProfilePoolStats;
};

const emptyScores: ProfileScoreStats = {
  snake: {
    score: null,
    createdAt: null,
  },
  flappyBird: {
    score: null,
    createdAt: null,
  },
  reactionTime: {
    score: null,
    averageTime: null,
    bestTime: null,
    attempts: null,
    createdAt: null,
  },
  typingTest: {
    wpm: null,
    accuracy: null,
    mode: null,
    rawWpm: null,
    createdAt: null,
  },
  tetris: {
    score: null,
    level: null,
    lines: null,
    totalGames: null,
    totalLines: null,
    totalPlayTimeMs: null,
    createdAt: null,
  },
  coinFlip: {
    streak: null,
    totalGamesPlayed: null,
    accuracyPercentage: null,
    createdAt: null,
  },
  connections: {
    totalPlayed: null,
    totalSolved: null,
    solveRate: null,
    lastPlayedAt: null,
  },
};

export const getProfileStats = async (userId: string): Promise<ProfileStats> => {
  const snakeRow = await queryOne<{
    score: number;
    created_at: string | number;
  }>(
    `SELECT score, created_at
     FROM snake_scores
     WHERE od_user_id = $1
     ORDER BY score DESC, created_at ASC
     LIMIT 1`,
    [userId],
  );

  const flappyBirdRow = await queryOne<{
    score: number;
    created_at: string | number;
  }>(
    `SELECT score, created_at
     FROM flappy_bird_scores
     WHERE od_user_id = $1
     ORDER BY score DESC, created_at ASC
     LIMIT 1`,
    [userId],
  );

  const reactionTimeRow = await queryOne<{
    score: number;
    average_time: number;
    best_time: number;
    attempts: number;
    created_at: string | number;
  }>(
    `SELECT score, average_time, best_time, attempts, created_at
     FROM reaction_time_scores
     WHERE od_user_id = $1
     ORDER BY score DESC, average_time ASC, best_time ASC, created_at ASC
     LIMIT 1`,
    [userId],
  );

  const typingTestRow = await queryOne<{
    wpm: number;
    raw_wpm: number;
    accuracy: number;
    mode: number;
    created_at: string | number;
  }>(
    `SELECT wpm, raw_wpm, accuracy, mode, created_at
     FROM typing_test_scores
     WHERE od_user_id = $1
     ORDER BY wpm DESC, accuracy DESC, created_at ASC
     LIMIT 1`,
    [userId],
  );

  const tetrisRow = await queryOne<{
    score: number;
    level: number;
    lines: number;
    total_games: number;
    total_lines: number;
    total_play_time_ms: string | number;
    created_at: string | number;
  }>(
    `SELECT score, level, lines, total_games, total_lines, total_play_time_ms, created_at
     FROM tetris_scores
     WHERE od_user_id = $1
     LIMIT 1`,
    [userId],
  );
  const coinFlipBestRow = await queryOne<{
    streak: number;
    created_at: string | number;
  }>(
    `SELECT
       streak,
       created_at
     FROM coin_flip_scores
     WHERE od_user_id = $1
     ORDER BY streak DESC, created_at ASC
     LIMIT 1`,
    [userId],
  );
  const coinFlipAggregateRow = await queryOne<{
    total_games_played: string | number;
    accuracy_percentage: string | number;
  }>(
    `SELECT
       CASE
         WHEN total_games_played > 0 THEN total_games_played
         ELSE 1
       END AS total_games_played,
       ROUND(
         (CAST(GREATEST(total_correct_flips, streak) AS numeric) /
           CASE
             WHEN GREATEST(total_flips, streak + 1) > 0 THEN GREATEST(total_flips, streak + 1)
             ELSE 1
           END
         ) * 100,
         1
       ) AS accuracy_percentage
     FROM coin_flip_scores
     WHERE od_user_id = $1
     LIMIT 1`,
    [userId],
  );
  const connectionsRow = await queryOne<{
    total_played: string | number;
    total_solved: string | number;
    solve_rate: string | number;
    last_played_at: string | number;
  }>(
    `SELECT
       COUNT(*) AS total_played,
       SUM(CASE WHEN solved THEN 1 ELSE 0 END) AS total_solved,
       ROUND(
         (CAST(SUM(CASE WHEN solved THEN 1 ELSE 0 END) AS numeric) /
           CASE WHEN COUNT(*) > 0 THEN COUNT(*) ELSE 1 END
         ) * 100,
         1
       ) AS solve_rate,
       MAX(created_at) AS last_played_at
     FROM connections_scores
     WHERE od_user_id = $1`,
    [userId],
  );

  const wallet = await getWalletForUser(userId);
  const gameBan = await getGameBanStatus(userId);
  const antiCheatRestriction = await getAntiCheatPlayRestriction(userId);
  const gameTime = await getUserGameTimeMetrics(userId);

  // Pool Elo + stats
  const elo = await getElo(userId);
  const poolStatsRow = await queryOne<{
    wins: number;
    losses: number;
    forfeits: number;
    current_streak: number;
    best_streak: number;
    total_shots: number;
    total_balls_pocketed: number;
  }>(
    `SELECT wins, losses, forfeits, current_streak, best_streak, total_shots, total_balls_pocketed
     FROM pool_stats
     WHERE user_id = $1
     LIMIT 1`,
    [userId],
  );

  let pool: ProfilePoolStats = null;
  const hasElo = elo && elo.totalGames > 0;
  const hasPoolStats = poolStatsRow && (poolStatsRow.wins + poolStatsRow.losses > 0);
  if (hasElo || hasPoolStats) {
    const eloRating = elo?.eloRating ?? STARTING_ELO;
    const totalGames = hasElo
      ? elo.totalGames
      : (poolStatsRow!.wins + poolStatsRow!.losses);
    const totalWins = hasElo ? elo.totalWins : poolStatsRow!.wins;
    const totalLosses = hasElo ? elo.totalLosses : poolStatsRow!.losses;
    pool = {
      eloRating,
      tier: getTierName(eloRating),
      tierColor: getTierColor(eloRating),
      rank: hasElo ? await getEloRank(userId) : null,
      totalGames,
      totalWins,
      totalLosses,
      winRate: totalGames > 0 ? Math.round((totalWins / totalGames) * 100) : 0,
      peakElo: elo?.peakElo ?? eloRating,
      currentStreak: poolStatsRow?.current_streak ?? 0,
      bestStreak: poolStatsRow?.best_streak ?? 0,
      totalShots: poolStatsRow?.total_shots ?? 0,
      totalBallsPocketed: poolStatsRow?.total_balls_pocketed ?? 0,
      forfeits: poolStatsRow?.forfeits ?? 0,
    };
  }

  return {
    wallet: {
      credits: wallet.credits,
    },
    gameBan,
    antiCheatRestriction,
    gameTime,
    pool,
    scores: {
      snake: snakeRow
        ? {
            score: snakeRow.score,
            createdAt: Number(snakeRow.created_at),
          }
        : emptyScores.snake,
      flappyBird: flappyBirdRow
        ? {
            score: flappyBirdRow.score,
            createdAt: Number(flappyBirdRow.created_at),
          }
        : emptyScores.flappyBird,
      reactionTime: reactionTimeRow
        ? {
            score: reactionTimeRow.score,
            averageTime: reactionTimeRow.average_time,
            bestTime: reactionTimeRow.best_time,
            attempts: reactionTimeRow.attempts,
            createdAt: Number(reactionTimeRow.created_at),
          }
        : emptyScores.reactionTime,
      typingTest: typingTestRow
        ? {
            wpm: typingTestRow.wpm,
            rawWpm: typingTestRow.raw_wpm,
            accuracy: typingTestRow.accuracy,
            mode: typingTestRow.mode,
            createdAt: Number(typingTestRow.created_at),
          }
        : emptyScores.typingTest,
      tetris: tetrisRow
        ? {
            score: tetrisRow.score,
            level: tetrisRow.level,
            lines: tetrisRow.lines,
            totalGames: tetrisRow.total_games,
            totalLines: tetrisRow.total_lines,
            totalPlayTimeMs: Number(tetrisRow.total_play_time_ms),
            createdAt: Number(tetrisRow.created_at),
          }
        : emptyScores.tetris,
      coinFlip: coinFlipBestRow
        ? {
            streak: coinFlipBestRow.streak,
            totalGamesPlayed: Number(coinFlipAggregateRow?.total_games_played ?? 0),
            accuracyPercentage: Number(coinFlipAggregateRow?.accuracy_percentage ?? 0),
            createdAt: Number(coinFlipBestRow.created_at),
          }
        : emptyScores.coinFlip,
      connections:
        connectionsRow && Number(connectionsRow.total_played ?? 0) > 0
          ? {
              totalPlayed: Number(connectionsRow.total_played ?? 0),
              totalSolved: Number(connectionsRow.total_solved ?? 0),
              solveRate: Number(connectionsRow.solve_rate ?? 0),
              lastPlayedAt: Number(connectionsRow.last_played_at ?? 0),
            }
          : emptyScores.connections,
    },
  };
};
