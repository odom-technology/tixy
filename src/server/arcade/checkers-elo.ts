// ---------------------------------------------------------------------------
// Checkers — Elo Rating System & Bot Speed Run Records.
//
// Near-verbatim clone of `chess-elo.ts`, re-pointed at the checkers_* tables.
// Supports draws (0.5 / 0.5 actual score). Bot speed-run records track the
// fewest plies a human took to beat a given bot difficulty.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { query, queryOne } from '@/server/db/client';

export const STARTING_ELO = 1200;
const ELO_FLOOR = 100;

const K_PROVISIONAL = 40;
const K_SETTLING = 30;
const K_ESTABLISHED = 20;
const K_ELITE = 16;

const ELO_TIERS = [
  { min: 0,    max: 799,       name: 'Beginner',      color: '#9ca3af' },
  { min: 800,  max: 999,       name: 'Novice',        color: '#a3e635' },
  { min: 1000, max: 1199,      name: 'Intermediate',  color: '#22c55e' },
  { min: 1200, max: 1399,      name: 'Skilled',       color: '#06b6d4' },
  { min: 1400, max: 1599,      name: 'Advanced',      color: '#3b82f6' },
  { min: 1600, max: 1799,      name: 'Expert',        color: '#8b5cf6' },
  { min: 1800, max: 1999,      name: 'Master',        color: '#f59e0b' },
  { min: 2000, max: 2199,      name: 'Grandmaster',   color: '#ef4444' },
  { min: 2200, max: Infinity,  name: 'Legend',         color: '#ec4899' },
] as const;

function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function getKFactor(totalGames: number, rating: number): number {
  if (totalGames < 10) return K_PROVISIONAL;
  if (totalGames < 30) return K_SETTLING;
  if (rating >= 2000) return K_ELITE;
  return K_ESTABLISHED;
}

function calculateNewRating(
  oldRating: number,
  opponentRating: number,
  actualScore: 0 | 0.5 | 1,
  totalGames: number,
): { newRating: number; change: number } {
  const k = getKFactor(totalGames, oldRating);
  const expected = expectedScore(oldRating, opponentRating);
  const rawChange = Math.round(k * (actualScore - expected));
  const newRating = Math.max(ELO_FLOOR, oldRating + rawChange);
  return { newRating, change: newRating - oldRating };
}

export function getTierName(rating: number): string {
  const tier = ELO_TIERS.find((t) => rating >= t.min && rating <= t.max);
  return tier?.name ?? 'Unranked';
}

export function getTierColor(rating: number): string {
  const tier = ELO_TIERS.find((t) => rating >= t.min && rating <= t.max);
  return tier?.color ?? '#9ca3af';
}

// ---------------------------------------------------------------------------
// Row types + normalization (pg returns bigint columns as strings)
// ---------------------------------------------------------------------------

const toNum = (value: unknown): number => (value == null ? 0 : Number(value));
const toNumOrNull = (value: unknown): number | null =>
  value == null ? null : Number(value);

export type EloRecord = {
  userId: string;
  userName: string;
  eloRating: number;
  totalWins: number;
  totalLosses: number;
  totalDraws: number;
  totalGames: number;
  peakElo: number;
  lastPlayed: number | null;
  createdAt: number;
};

const ELO_SELECT = `
  user_id AS "userId",
  user_name AS "userName",
  elo_rating AS "eloRating",
  total_wins AS "totalWins",
  total_losses AS "totalLosses",
  total_draws AS "totalDraws",
  total_games AS "totalGames",
  peak_elo AS "peakElo",
  last_played AS "lastPlayed",
  created_at AS "createdAt"
`;

type RawEloRow = Record<string, unknown> & { userId: string; userName: string };

const normalizeEloRow = (row: RawEloRow): EloRecord => ({
  userId: row.userId,
  userName: row.userName,
  eloRating: toNum(row.eloRating),
  totalWins: toNum(row.totalWins),
  totalLosses: toNum(row.totalLosses),
  totalDraws: toNum(row.totalDraws),
  totalGames: toNum(row.totalGames),
  peakElo: toNum(row.peakElo),
  lastPlayed: toNumOrNull(row.lastPlayed),
  createdAt: toNum(row.createdAt),
});

export type EloHistoryRecord = {
  id: string;
  matchId: string;
  playerAId: string;
  playerBId: string;
  winnerId: string | null;
  outcome: string;
  playerAEloBefore: number;
  playerBEloBefore: number;
  playerAEloAfter: number;
  playerBEloAfter: number;
  playerAEloChange: number;
  playerBEloChange: number;
  createdAt: number;
};

const ELO_HISTORY_SELECT = `
  id,
  match_id AS "matchId",
  player_a_id AS "playerAId",
  player_b_id AS "playerBId",
  winner_id AS "winnerId",
  outcome,
  player_a_elo_before AS "playerAEloBefore",
  player_b_elo_before AS "playerBEloBefore",
  player_a_elo_after AS "playerAEloAfter",
  player_b_elo_after AS "playerBEloAfter",
  player_a_elo_change AS "playerAEloChange",
  player_b_elo_change AS "playerBEloChange",
  created_at AS "createdAt"
`;

type RawEloHistoryRow = Record<string, unknown> & {
  id: string;
  matchId: string;
  playerAId: string;
  playerBId: string;
  winnerId: string | null;
  outcome: string;
};

const normalizeEloHistoryRow = (row: RawEloHistoryRow): EloHistoryRecord => ({
  id: row.id,
  matchId: row.matchId,
  playerAId: row.playerAId,
  playerBId: row.playerBId,
  winnerId: row.winnerId ?? null,
  outcome: row.outcome,
  playerAEloBefore: toNum(row.playerAEloBefore),
  playerBEloBefore: toNum(row.playerBEloBefore),
  playerAEloAfter: toNum(row.playerAEloAfter),
  playerBEloAfter: toNum(row.playerBEloAfter),
  playerAEloChange: toNum(row.playerAEloChange),
  playerBEloChange: toNum(row.playerBEloChange),
  createdAt: toNum(row.createdAt),
});

export type BotRecordRow = {
  userId: string;
  userName: string;
  botDifficulty: string;
  fewestPly: number;
  totalThinkingMs: number | null;
  achievedAt: number;
};

const BOT_RECORD_SELECT = `
  user_id AS "userId",
  user_name AS "userName",
  bot_difficulty AS "botDifficulty",
  fewest_ply AS "fewestPly",
  total_thinking_ms AS "totalThinkingMs",
  achieved_at AS "achievedAt"
`;

type RawBotRecordRow = Record<string, unknown> & {
  userId: string;
  userName: string;
  botDifficulty: string;
};

const normalizeBotRecordRow = (row: RawBotRecordRow): BotRecordRow => ({
  userId: row.userId,
  userName: row.userName,
  botDifficulty: row.botDifficulty,
  fewestPly: toNum(row.fewestPly),
  totalThinkingMs: toNumOrNull(row.totalThinkingMs),
  achievedAt: toNum(row.achievedAt),
});

const BOT_RECORD_ORDER_BY = `
  ORDER BY fewest_ply ASC,
    CASE WHEN total_thinking_ms IS NULL THEN 1 ELSE 0 END ASC,
    total_thinking_ms ASC,
    achieved_at ASC
`;

// ---------------------------------------------------------------------------
// DB operations — Elo records
// ---------------------------------------------------------------------------

async function getOrCreateElo(userId: string, userName: string): Promise<EloRecord> {
  const existing = await getElo(userId);
  if (existing) return existing;

  const now = Date.now();
  const record: EloRecord = {
    userId,
    userName,
    eloRating: STARTING_ELO,
    totalWins: 0,
    totalLosses: 0,
    totalDraws: 0,
    totalGames: 0,
    peakElo: STARTING_ELO,
    lastPlayed: null,
    createdAt: now,
  };
  await query(
    `INSERT INTO checkers_elo
       (user_id, user_name, elo_rating, total_wins, total_losses, total_draws, total_games, peak_elo, last_played, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, userName, STARTING_ELO, 0, 0, 0, 0, STARTING_ELO, null, now],
  );
  return record;
}

export async function getElo(userId: string): Promise<EloRecord | null> {
  const row = await queryOne<RawEloRow>(
    `SELECT ${ELO_SELECT} FROM checkers_elo WHERE user_id = $1`,
    [userId],
  );
  return row ? normalizeEloRow(row) : null;
}

export type EloChangeResult = {
  playerA: { id: string; before: number; after: number; change: number; tier: string; tierColor: string };
  playerB: { id: string; before: number; after: number; change: number; tier: string; tierColor: string };
  outcome: 'win_a' | 'win_b' | 'draw';
};

export type MatchOutcome = 'win_a' | 'win_b' | 'draw';

/** Process a rated match result (win/loss/draw). */
export async function processRatedMatch(
  matchId: string,
  playerAId: string,
  playerBId: string,
  playerAName: string,
  playerBName: string,
  outcome: MatchOutcome,
): Promise<EloChangeResult> {
  const a = await getOrCreateElo(playerAId, playerAName);
  const b = await getOrCreateElo(playerBId, playerBName);

  const actualA: 0 | 0.5 | 1 = outcome === 'win_a' ? 1 : outcome === 'win_b' ? 0 : 0.5;
  const actualB: 0 | 0.5 | 1 = outcome === 'win_b' ? 1 : outcome === 'win_a' ? 0 : 0.5;

  const aCalc = calculateNewRating(a.eloRating, b.eloRating, actualA, a.totalGames);
  const bCalc = calculateNewRating(b.eloRating, a.eloRating, actualB, b.totalGames);

  const now = Date.now();
  const incrA = { wins: outcome === 'win_a' ? 1 : 0, losses: outcome === 'win_b' ? 1 : 0, draws: outcome === 'draw' ? 1 : 0 };
  const incrB = { wins: outcome === 'win_b' ? 1 : 0, losses: outcome === 'win_a' ? 1 : 0, draws: outcome === 'draw' ? 1 : 0 };

  await query(
    `UPDATE checkers_elo
     SET user_name = $1, elo_rating = $2, total_wins = $3, total_losses = $4,
         total_draws = $5, total_games = $6, peak_elo = $7, last_played = $8
     WHERE user_id = $9`,
    [
      playerAName,
      aCalc.newRating,
      a.totalWins + incrA.wins,
      a.totalLosses + incrA.losses,
      a.totalDraws + incrA.draws,
      a.totalGames + 1,
      Math.max(a.peakElo, aCalc.newRating),
      now,
      playerAId,
    ],
  );

  await query(
    `UPDATE checkers_elo
     SET user_name = $1, elo_rating = $2, total_wins = $3, total_losses = $4,
         total_draws = $5, total_games = $6, peak_elo = $7, last_played = $8
     WHERE user_id = $9`,
    [
      playerBName,
      bCalc.newRating,
      b.totalWins + incrB.wins,
      b.totalLosses + incrB.losses,
      b.totalDraws + incrB.draws,
      b.totalGames + 1,
      Math.max(b.peakElo, bCalc.newRating),
      now,
      playerBId,
    ],
  );

  await query(
    `INSERT INTO checkers_elo_history
       (id, match_id, player_a_id, player_b_id, winner_id, outcome,
        player_a_elo_before, player_b_elo_before, player_a_elo_after, player_b_elo_after,
        player_a_elo_change, player_b_elo_change, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      crypto.randomUUID(),
      matchId,
      playerAId,
      playerBId,
      outcome === 'win_a' ? playerAId : outcome === 'win_b' ? playerBId : null,
      outcome,
      a.eloRating,
      b.eloRating,
      aCalc.newRating,
      bCalc.newRating,
      aCalc.change,
      bCalc.change,
      now,
    ],
  );

  return {
    playerA: {
      id: playerAId,
      before: a.eloRating,
      after: aCalc.newRating,
      change: aCalc.change,
      tier: getTierName(aCalc.newRating),
      tierColor: getTierColor(aCalc.newRating),
    },
    playerB: {
      id: playerBId,
      before: b.eloRating,
      after: bCalc.newRating,
      change: bCalc.change,
      tier: getTierName(bCalc.newRating),
      tierColor: getTierColor(bCalc.newRating),
    },
    outcome,
  };
}

/** Penalize only the forfeiter's Elo (loser-only). */
export async function penalizeForfeitLoserOnly(
  matchId: string,
  winnerId: string,
  loserId: string,
  winnerName: string,
  loserName: string,
): Promise<EloChangeResult> {
  const winner = await getOrCreateElo(winnerId, winnerName);
  const loser = await getOrCreateElo(loserId, loserName);

  const loserCalc = calculateNewRating(loser.eloRating, winner.eloRating, 0, loser.totalGames);
  const now = Date.now();

  await query(
    `UPDATE checkers_elo
     SET user_name = $1, elo_rating = $2, total_losses = $3, total_games = $4, last_played = $5
     WHERE user_id = $6`,
    [
      loserName,
      loserCalc.newRating,
      loser.totalLosses + 1,
      loser.totalGames + 1,
      now,
      loserId,
    ],
  );

  await query(
    `INSERT INTO checkers_elo_history
       (id, match_id, player_a_id, player_b_id, winner_id, outcome,
        player_a_elo_before, player_b_elo_before, player_a_elo_after, player_b_elo_after,
        player_a_elo_change, player_b_elo_change, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      crypto.randomUUID(),
      matchId,
      winnerId,
      loserId,
      winnerId,
      'win_a',
      winner.eloRating,
      loser.eloRating,
      winner.eloRating,
      loserCalc.newRating,
      0,
      loserCalc.change,
      now,
    ],
  );

  return {
    playerA: {
      id: winnerId,
      before: winner.eloRating,
      after: winner.eloRating,
      change: 0,
      tier: getTierName(winner.eloRating),
      tierColor: getTierColor(winner.eloRating),
    },
    playerB: {
      id: loserId,
      before: loser.eloRating,
      after: loserCalc.newRating,
      change: loserCalc.change,
      tier: getTierName(loserCalc.newRating),
      tierColor: getTierColor(loserCalc.newRating),
    },
    outcome: 'win_a',
  };
}

export async function getEloHistory(userId: string, limit = 10): Promise<EloHistoryRecord[]> {
  const result = await query<RawEloHistoryRow>(
    `SELECT ${ELO_HISTORY_SELECT} FROM checkers_elo_history
     WHERE player_a_id = $1 OR player_b_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit],
  );
  return result.rows.map(normalizeEloHistoryRow);
}

export async function getEloRank(userId: string): Promise<number | null> {
  const elo = await getElo(userId);
  if (!elo || elo.totalGames === 0) return null;
  const result = await queryOne<{ count: unknown }>(
    `SELECT COUNT(*) AS count FROM checkers_elo
     WHERE total_games > 0 AND elo_rating > $1`,
    [elo.eloRating],
  );
  return toNum(result?.count) + 1;
}

export async function getEloLeaderboard(limit = 50): Promise<EloRecord[]> {
  const result = await query<RawEloRow>(
    `SELECT ${ELO_SELECT} FROM checkers_elo
     WHERE total_games > 0
     ORDER BY elo_rating DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows.map(normalizeEloRow);
}

// ---------------------------------------------------------------------------
// Bot speed run records — shortest game by half-moves (ply).
// ---------------------------------------------------------------------------

export type BotRecordResult = {
  humanPly: number;
  previousBest: number | null;
  isNewRecord: boolean;
  isWorldRecord: boolean;
};

const isBetterTime = (candidateMs: number, existingMs: number | null) => {
  if (existingMs == null) return false;
  return candidateMs < existingMs;
};

export async function getBotRecordLeaderboard(difficulty: string, limit = 50): Promise<BotRecordRow[]> {
  const result = await query<RawBotRecordRow>(
    `SELECT ${BOT_RECORD_SELECT} FROM checkers_bot_records
     WHERE bot_difficulty = $1
     ${BOT_RECORD_ORDER_BY}
     LIMIT $2`,
    [difficulty, limit],
  );
  return result.rows.map(normalizeBotRecordRow);
}

export async function getPlayerBotRecords(userId: string): Promise<BotRecordRow[]> {
  const result = await query<RawBotRecordRow>(
    `SELECT ${BOT_RECORD_SELECT} FROM checkers_bot_records WHERE user_id = $1`,
    [userId],
  );
  return result.rows.map(normalizeBotRecordRow);
}

/** Record a human's win-vs-bot speed (fewest plies). Called from finalize. */
export async function recordBotSpeedRun(
  matchId: string,
  userId: string,
  userName: string,
  difficulty: string,
): Promise<BotRecordResult | null> {
  const stats = await queryOne<{ humanPly: unknown; totalThinkingMs: unknown }>(
    `SELECT COUNT(*) AS "humanPly", COALESCE(SUM(move_duration_ms), 0) AS "totalThinkingMs"
     FROM checkers_moves
     WHERE match_id = $1 AND player_id = $2`,
    [matchId, userId],
  );
  const humanPly = toNum(stats?.humanPly);
  const totalThinkingMs = toNum(stats?.totalThinkingMs);
  if (humanPly <= 0) return null;

  const existing = await queryOne<RawBotRecordRow>(
    `SELECT ${BOT_RECORD_SELECT} FROM checkers_bot_records
     WHERE user_id = $1 AND bot_difficulty = $2`,
    [userId, difficulty],
  ).then((row) => (row ? normalizeBotRecordRow(row) : null));

  const isNewRecord = !existing
    || humanPly < existing.fewestPly
    || (humanPly === existing.fewestPly && isBetterTime(totalThinkingMs, existing.totalThinkingMs ?? null));

  if (isNewRecord) {
    const now = Date.now();
    if (existing) {
      await query(
        `UPDATE checkers_bot_records
         SET user_name = $1, fewest_ply = $2, total_thinking_ms = $3, achieved_at = $4
         WHERE user_id = $5 AND bot_difficulty = $6`,
        [userName, humanPly, totalThinkingMs, now, userId, difficulty],
      );
    } else {
      await query(
        `INSERT INTO checkers_bot_records
           (user_id, user_name, bot_difficulty, fewest_ply, total_thinking_ms, achieved_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, userName, difficulty, humanPly, totalThinkingMs, now],
      );
    }
  }

  const best = await queryOne<RawBotRecordRow>(
    `SELECT ${BOT_RECORD_SELECT} FROM checkers_bot_records
     WHERE bot_difficulty = $1
     ${BOT_RECORD_ORDER_BY}
     LIMIT 1`,
    [difficulty],
  );

  return {
    humanPly,
    previousBest: existing?.fewestPly ?? null,
    isNewRecord,
    isWorldRecord: isNewRecord && best?.userId === userId,
  };
}
