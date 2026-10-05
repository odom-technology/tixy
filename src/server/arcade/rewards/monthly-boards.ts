// ─────────────────────────────────────────────────────────────────────────────
// The monthly leaderboard award, retired (PROGRESSION.md "Decided").
//
// From October 2026 the weekly boards pay instead (weekly-boards.ts): three
// games a week, 300 / 200 / 100 tickets and a medal for first. The monthly
// award pays nothing for any month from MONTHLY_BOARDS_RETIRED_FROM ('2026-10')
// on; the cron route and the dry run say so and write nothing. The floor list
// planned for 2026-11 was never paid and is gone.
//
// Months before that still award under season 0's rules whenever they run, so
// an award for September 2026 or earlier is unchanged: 12 boards ranking
// all-time bests and current ratings, the top 5 of each paid
// 1,200 / 900 / 600 / 300 / 150 (3,150), and 2,400 / 1,800 / 1,200 / 800 / 400
// on 8-ball rating (6,600), up to 41,250 a month. A player takes only the
// highest of their typing boards.
//
// The rule is picked by the month the award is for (the 'YYYY-MM' key), not by
// the day the job runs. Month keys compare as strings.
//
// The award stays idempotent: one ledger row per month, board and user
// (`monthly-credits:<month>:<board>:<user>`), and one run row per month.
// ─────────────────────────────────────────────────────────────────────────────
import { asc, desc, eq, sql } from 'drizzle-orm';

import { MONTHLY_CREDIT_PAYOUTS } from '@/features/arcade/lib/rewards';
import { db, query } from '@/server/db/client';
import {
  coinFlipScores,
  flappyBirdScores,
  poolBotRecords,
  poolElo,
  reactionTimeScores,
  snakeScores,
  typingTestScores,
} from '@/server/db/schema';

/** The first award month that pays nothing: the weekly boards pay from the week of 5 October 2026. */
export const MONTHLY_BOARDS_RETIRED_FROM = '2026-10';

/** 8-ball rating pays more than any other board. */
export const ELO_CREDIT_PAYOUTS = [2400, 1800, 1200, 800, 400] as const;

export type MonthlyAwardCandidate = {
  leaderboardKey: string;
  userId: string;
  rank: number;
  credits: number;
};

type Row = { userId: string };

export type MonthlyBoard = {
  /** Stored in monthly_reward_awards.leaderboard_key and in ledger source ids. Never renamed. */
  key: string;
  /** Registry slug of the game the board belongs to. */
  game: string;
  label: string;
  payouts: readonly number[];
  /** Top 5 in rank order, all-time bests. */
  select: () => Promise<Row[]>;
};

const sumPayouts = (payouts: readonly number[]) => payouts.reduce((total, credits) => total + credits, 0);

// ── Selectors ────────────────────────────────────────────────────────────────

const selectTopSnake = async () =>
  db
    .select({ userId: snakeScores.odUserId })
    .from(snakeScores)
    .orderBy(desc(snakeScores.score), asc(snakeScores.createdAt))
    .limit(5);

const selectTopFlappy = async () =>
  db
    .select({ userId: flappyBirdScores.odUserId })
    .from(flappyBirdScores)
    .orderBy(desc(flappyBirdScores.score), asc(flappyBirdScores.createdAt))
    .limit(5);

const selectTopReaction = async () =>
  db
    .select({ userId: reactionTimeScores.odUserId })
    .from(reactionTimeScores)
    .orderBy(
      asc(reactionTimeScores.averageTime),
      asc(reactionTimeScores.bestTime),
      asc(reactionTimeScores.createdAt),
    )
    .limit(5);

const selectTopTypingByMode = (mode: 15 | 30 | 60) => async () =>
  db
    .select({ userId: typingTestScores.odUserId })
    .from(typingTestScores)
    .where(eq(typingTestScores.mode, mode))
    .orderBy(
      desc(typingTestScores.wpm),
      desc(typingTestScores.accuracy),
      asc(typingTestScores.createdAt),
    )
    .limit(5);

const selectTopCoinFlip = async () =>
  db
    .select({ userId: coinFlipScores.odUserId })
    .from(coinFlipScores)
    .orderBy(desc(coinFlipScores.streak), asc(coinFlipScores.createdAt))
    .limit(5);

const selectTopConnections = async () => {
  const result = await query<Row>(
    `SELECT od_user_id as "userId",
            SUM(CASE WHEN solved THEN 1 ELSE 0 END) as "totalSolved"
     FROM connections_scores
     GROUP BY od_user_id
     ORDER BY "totalSolved" DESC, MIN(created_at) ASC
     LIMIT 5`,
  );
  return result.rows;
};

const selectTopPoolElo = async () =>
  db
    .select({ userId: poolElo.userId })
    .from(poolElo)
    .where(sql`${poolElo.totalGames} > 0`)
    .orderBy(desc(poolElo.eloRating))
    .limit(5);

const selectTopPoolBotRun = (difficulty: string) => async () =>
  db
    .select({ userId: poolBotRecords.userId })
    .from(poolBotRecords)
    .where(eq(poolBotRecords.botDifficulty, difficulty))
    .orderBy(
      asc(poolBotRecords.fewestTurns),
      sql`CASE WHEN ${poolBotRecords.totalTurnDurationMs} IS NULL THEN 1 ELSE 0 END`,
      asc(poolBotRecords.totalTurnDurationMs),
      asc(poolBotRecords.achievedAt),
    )
    .limit(5);

// ── The list ─────────────────────────────────────────────────────────────────

const standard = (
  key: string,
  game: string,
  label: string,
  select: () => Promise<Row[]>,
  payouts: readonly number[] = MONTHLY_CREDIT_PAYOUTS,
): MonthlyBoard => ({ key, game, label, payouts, select });

/** The season 0 list: 12 boards ranking all-time bests and current ratings. */
const LEGACY_BOARDS: MonthlyBoard[] = [
  standard('snake', 'snake', 'snake high score, all time', selectTopSnake),
  standard('flappy-bird', 'flappy-bird', 'flappy bird high score', selectTopFlappy),
  standard('reaction-time', 'reaction-time', 'reaction time average', selectTopReaction),
  standard('coin-flip', 'coin-flip', 'coin flip streak', selectTopCoinFlip),
  standard('connections', 'connections', 'connections puzzles solved', selectTopConnections),
  standard('typing-15', 'typing-test', 'typing 15 seconds', selectTopTypingByMode(15)),
  standard('typing-30', 'typing-test', 'typing 30 seconds', selectTopTypingByMode(30)),
  standard('typing-60', 'typing-test', 'typing 60 seconds', selectTopTypingByMode(60)),
  standard('8ball-bot-easy', '8-ball', '8-ball easy bot, fewest turns, all time', selectTopPoolBotRun('easy')),
  standard('8ball-bot-medium', '8-ball', '8-ball medium bot, fewest turns, all time', selectTopPoolBotRun('medium')),
  standard('8ball-bot-hard', '8-ball', '8-ball hard bot, fewest turns, all time', selectTopPoolBotRun('hard')),
  standard('8ball-elo', '8-ball', '8-ball rating', selectTopPoolElo, ELO_CREDIT_PAYOUTS),
];

export type BoardRules = 'season0' | 'retired';

/** True for a month the monthly award no longer pays: October 2026 on. */
export const monthlyBoardsRetired = (monthKey: string): boolean => monthKey >= MONTHLY_BOARDS_RETIRED_FROM;

/** The rules a month's award runs under: picked by the month, never by the day it runs. */
export const rulesForMonth = (monthKey: string): BoardRules =>
  monthlyBoardsRetired(monthKey) ? 'retired' : 'season0';

/** The boards a month pays: season 0's 12 before October 2026, none after. */
export const getMonthlyBoards = (monthKey: string): MonthlyBoard[] =>
  rulesForMonth(monthKey) === 'retired' ? [] : LEGACY_BOARDS;

/** The most a month can pay on a list, if every board has five winners. */
export const maxMonthlyPayout = (boards: MonthlyBoard[]): number =>
  boards.reduce((total, board) => total + sumPayouts(board.payouts), 0);

// ── Building the awards ──────────────────────────────────────────────────────

/** Season 0's rule: a player takes the highest of their typing boards, once. */
const applyTypingOneModeRule = (candidates: MonthlyAwardCandidate[]) => {
  const bestByUser = new Map<string, MonthlyAwardCandidate>();
  for (const candidate of candidates) {
    const current = bestByUser.get(candidate.userId);
    if (
      !current ||
      candidate.credits > current.credits ||
      (candidate.credits === current.credits && candidate.rank < current.rank)
    ) {
      bestByUser.set(candidate.userId, candidate);
    }
  }
  return new Set(
    Array.from(bestByUser.values()).map((candidate) => `${candidate.leaderboardKey}:${candidate.userId}`),
  );
};

/** Who wins what for a month. Nothing from October 2026 on. Reads only. */
export const buildMonthlyAwards = async (monthKey: string): Promise<MonthlyAwardCandidate[]> => {
  const boards = getMonthlyBoards(monthKey);
  if (boards.length === 0) return [];
  const tops = await Promise.all(boards.map((board) => board.select()));

  const candidates: MonthlyAwardCandidate[] = [];
  boards.forEach((board, boardIndex) => {
    tops[boardIndex]!.slice(0, 5).forEach((row, index) => {
      candidates.push({
        leaderboardKey: board.key,
        userId: row.userId,
        rank: index + 1,
        credits: board.payouts[index] ?? 0,
      });
    });
  });

  const typingAllowed = applyTypingOneModeRule(
    candidates.filter((candidate) => candidate.leaderboardKey.startsWith('typing-')),
  );
  return candidates.filter(
    (candidate) =>
      !candidate.leaderboardKey.startsWith('typing-') ||
      typingAllowed.has(`${candidate.leaderboardKey}:${candidate.userId}`),
  );
};
