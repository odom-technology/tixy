// ---------------------------------------------------------------------------
// 8-Ball Pool — Elo Rating System & Bot Speed Run Records
//
// Elo uses standard chess formula with dynamic K-factors.
// Bot records track fewest human turns to beat each difficulty, then
// use total active turn duration as a tie-breaker.
// All calculations are server-side only (tamper-resistant).
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { query, queryOne, withTransaction } from '@/server/db/client';
import { poolSql, type PoolSql } from '@/server/arcade/pool-sql';
import { recordActivityEvent } from '@/server/services/activity-events';
import { evaluateProfileMilestones } from '@/server/services/profile-milestones';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const STARTING_ELO = 1200;
const ELO_FLOOR = 100;

const K_PROVISIONAL = 40;  // games 1-10
const K_SETTLING = 30;     // games 11-30
const K_ESTABLISHED = 20;  // games 31+
const K_ELITE = 16;        // 2000+ with 30+ games

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

// ---------------------------------------------------------------------------
// Elo math (pure functions)
// ---------------------------------------------------------------------------

function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * K-factor bands based on pre-match game count:
 *   K=40 for games 1-10  (totalGames 0-9)
 *   K=30 for games 11-30 (totalGames 10-29)
 *   K=20 for games 31+   (totalGames 30+)
 *   K=16 elite override   (2000+ rating with 30+ games)
 */
function getKFactor(totalGames: number, rating: number): number {
  if (totalGames < 10) return K_PROVISIONAL;
  if (totalGames < 30) return K_SETTLING;
  if (rating >= 2000) return K_ELITE;
  return K_ESTABLISHED;
}

function calculateNewRating(
  oldRating: number,
  opponentRating: number,
  won: boolean,
  totalGames: number,
): { newRating: number; change: number } {
  const k = getKFactor(totalGames, oldRating);
  const expected = expectedScore(oldRating, opponentRating);
  const actual = won ? 1.0 : 0.0;
  const rawChange = Math.round(k * (actual - expected));
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
};

const normalizeEloHistoryRow = (row: RawEloHistoryRow): EloHistoryRecord => ({
  id: row.id,
  matchId: row.matchId,
  playerAId: row.playerAId,
  playerBId: row.playerBId,
  winnerId: row.winnerId ?? null,
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
  fewestTurns: number;
  totalTurnDurationMs: number | null;
  achievedAt: number;
};

const BOT_RECORD_SELECT = `
  user_id AS "userId",
  user_name AS "userName",
  bot_difficulty AS "botDifficulty",
  fewest_turns AS "fewestTurns",
  total_turn_duration_ms AS "totalTurnDurationMs",
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
  fewestTurns: toNum(row.fewestTurns),
  totalTurnDurationMs: toNumOrNull(row.totalTurnDurationMs),
  achievedAt: toNum(row.achievedAt),
});

const BOT_RECORD_ORDER_BY = `
  ORDER BY fewest_turns ASC,
    CASE WHEN total_turn_duration_ms IS NULL THEN 1 ELSE 0 END ASC,
    total_turn_duration_ms ASC,
    achieved_at ASC
`;

// ---------------------------------------------------------------------------
// DB operations — Elo records
// ---------------------------------------------------------------------------


export async function getElo(userId: string, sql?: PoolSql): Promise<EloRecord | null> {
  const row = (await poolSql(sql).query<RawEloRow>(
    `SELECT ${ELO_SELECT} FROM pool_elo WHERE user_id = $1`,
    [userId],
  )).rows[0] ?? null;
  return row ? normalizeEloRow(row) : null;
}

export type EloChangeResult = {
  winner: { before: number; after: number; change: number; tier: string; tierColor: string };
  loser: { before: number; after: number; change: number; tier: string; tierColor: string };
};

/**
 * Both players' Elo rows, created if missing and locked FOR UPDATE in
 * user-id order, so two settles touching the same players queue up instead
 * of losing an update or deadlocking. Must run inside a transaction.
 */
async function lockEloPair(
  sql: PoolSql,
  a: { id: string; name: string },
  b: { id: string; name: string },
): Promise<Map<string, EloRecord>> {
  const now = Date.now();
  const ordered = [a, b].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  for (const player of ordered) {
    await sql.query(
      `INSERT INTO pool_elo
         (user_id, user_name, elo_rating, total_wins, total_losses, total_games, peak_elo, last_played, created_at)
       VALUES ($1, $2, $3, 0, 0, 0, $3, NULL, $4)
       ON CONFLICT (user_id) DO NOTHING`,
      [player.id, player.name, STARTING_ELO, now],
    );
  }
  const rows = await sql.query<RawEloRow>(
    `SELECT ${ELO_SELECT} FROM pool_elo
     WHERE user_id = ANY($1)
     ORDER BY user_id
     FOR UPDATE`,
    [ordered.map((player) => player.id)],
  );
  return new Map(rows.rows.map((row) => {
    const record = normalizeEloRow(row);
    return [record.userId, record];
  }));
}

/** Run `fn` on the caller's transaction, or in a new one. */
const inEloTransaction = <T>(sql: PoolSql | undefined, fn: (sql: PoolSql) => Promise<T>) =>
  sql ? fn(sql) : withTransaction((client) => fn(client));

/**
 * After a rated win has committed: the winner's feed event and milestone
 * check. Fail-soft, and never inside the settle transaction, so a rolled
 * back result announces nothing.
 */
export function announcePoolWin(winnerId: string) {
  if (!winnerId || winnerId.startsWith('bot:')) return;
  void recordActivityEvent({ userId: winnerId, type: 'match_win', payload: { game: '8-ball' } });
  void evaluateProfileMilestones(winnerId);
}

/**
 * Process a rated match result (human vs human only).
 * Updates both players' Elo, logs history. Returns change details for display.
 * Locks both Elo rows (user-id order); counters move relatively. The caller
 * announces the win with announcePoolWin once its transaction commits.
 */
export async function processRatedMatch(
  matchId: string,
  winnerId: string,
  loserId: string,
  winnerName: string,
  loserName: string,
  sql?: PoolSql,
): Promise<EloChangeResult> {
  return inEloTransaction(sql, async (tx) => {
    const locked = await lockEloPair(tx, { id: winnerId, name: winnerName }, { id: loserId, name: loserName });
    const winner = locked.get(winnerId)!;
    const loser = locked.get(loserId)!;

    const winnerCalc = calculateNewRating(winner.eloRating, loser.eloRating, true, winner.totalGames);
    const loserCalc = calculateNewRating(loser.eloRating, winner.eloRating, false, loser.totalGames);
    const now = Date.now();

    // The rows are locked, so the ratings read above are current. Counters
    // still move relatively.
    await tx.query(
      `UPDATE pool_elo
       SET user_name = $1, elo_rating = $2, total_wins = total_wins + 1,
           total_games = total_games + 1, peak_elo = GREATEST(peak_elo, $2), last_played = $3
       WHERE user_id = $4`,
      [winnerName, winnerCalc.newRating, now, winnerId],
    );
    await tx.query(
      `UPDATE pool_elo
       SET user_name = $1, elo_rating = $2, total_losses = total_losses + 1,
           total_games = total_games + 1, last_played = $3
       WHERE user_id = $4`,
      [loserName, loserCalc.newRating, now, loserId],
    );

    // Log history
    await tx.query(
      `INSERT INTO pool_elo_history
         (id, match_id, player_a_id, player_b_id, winner_id,
          player_a_elo_before, player_b_elo_before, player_a_elo_after, player_b_elo_after,
          player_a_elo_change, player_b_elo_change, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        crypto.randomUUID(),
        matchId,
        winnerId,
        loserId,
        winnerId,
        winner.eloRating,
        loser.eloRating,
        winnerCalc.newRating,
        loserCalc.newRating,
        winnerCalc.change,
        loserCalc.change,
        now,
      ],
    );

    return {
      winner: {
        before: winner.eloRating,
        after: winnerCalc.newRating,
        change: winnerCalc.change,
        tier: getTierName(winnerCalc.newRating),
        tierColor: getTierColor(winnerCalc.newRating),
      },
      loser: {
        before: loser.eloRating,
        after: loserCalc.newRating,
        change: loserCalc.change,
        tier: getTierName(loserCalc.newRating),
        tierColor: getTierColor(loserCalc.newRating),
      },
    };
  });
}

/**
 * Penalize only the forfeiter's Elo without rewarding the winner.
 * Used for suspicious forfeits (too early, pair abuse) so the forfeiter
 * always pays a cost but the "winner" can't farm Elo from it.
 */
export async function penalizeForfeitLoserOnly(
  matchId: string,
  winnerId: string,
  loserId: string,
  winnerName: string,
  loserName: string,
  sql?: PoolSql,
): Promise<EloChangeResult> {
  return inEloTransaction(sql, async (tx) => {
    const locked = await lockEloPair(tx, { id: winnerId, name: winnerName }, { id: loserId, name: loserName });
    const winner = locked.get(winnerId)!;
    const loser = locked.get(loserId)!;

    // Calculate what the loser WOULD lose in a normal match
    const loserCalc = calculateNewRating(loser.eloRating, winner.eloRating, false, loser.totalGames);
    const now = Date.now();

    // Only update the loser — winner's rating stays the same
    await tx.query(
      `UPDATE pool_elo
       SET user_name = $1, elo_rating = $2, total_losses = total_losses + 1,
           total_games = total_games + 1, last_played = $3
       WHERE user_id = $4`,
      [loserName, loserCalc.newRating, now, loserId],
    );

    // Log history (winner change = 0)
    await tx.query(
      `INSERT INTO pool_elo_history
         (id, match_id, player_a_id, player_b_id, winner_id,
          player_a_elo_before, player_b_elo_before, player_a_elo_after, player_b_elo_after,
          player_a_elo_change, player_b_elo_change, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        crypto.randomUUID(),
        matchId,
        winnerId,
        loserId,
        winnerId,
        winner.eloRating,
        loser.eloRating,
        winner.eloRating, // unchanged
        loserCalc.newRating,
        0,
        loserCalc.change,
        now,
      ],
    );

    return {
      winner: {
        before: winner.eloRating,
        after: winner.eloRating,
        change: 0,
        tier: getTierName(winner.eloRating),
        tierColor: getTierColor(winner.eloRating),
      },
      loser: {
        before: loser.eloRating,
        after: loserCalc.newRating,
        change: loserCalc.change,
        tier: getTierName(loserCalc.newRating),
        tierColor: getTierColor(loserCalc.newRating),
      },
    };
  });
}

/** Get recent Elo history for a player (for detail view). */
export async function getEloHistory(userId: string, limit = 10): Promise<EloHistoryRecord[]> {
  const result = await query<RawEloHistoryRow>(
    `SELECT ${ELO_HISTORY_SELECT} FROM pool_elo_history
     WHERE player_a_id = $1 OR player_b_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit],
  );
  return result.rows.map(normalizeEloHistoryRow);
}

/** Get a player's rank on the Elo leaderboard (1-indexed). Returns null if unranked. */
export async function getEloRank(userId: string): Promise<number | null> {
  const elo = await getElo(userId);
  if (!elo || elo.totalGames === 0) return null;
  const result = await queryOne<{ count: unknown }>(
    `SELECT COUNT(*) AS count FROM pool_elo
     WHERE total_games > 0 AND elo_rating > $1`,
    [elo.eloRating],
  );
  return toNum(result?.count) + 1;
}

/** Get the Elo leaderboard (players with at least 1 game, sorted by rating). */
export async function getEloLeaderboard(limit = 50): Promise<EloRecord[]> {
  const result = await query<RawEloRow>(
    `SELECT ${ELO_SELECT} FROM pool_elo
     WHERE total_games > 0
     ORDER BY elo_rating DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows.map(normalizeEloRow);
}

// ---------------------------------------------------------------------------
// DB operations — Bot speed run records
// ---------------------------------------------------------------------------

export type BotRecordResult = {
  humanTurns: number;
  previousBest: number | null;
  isNewRecord: boolean;
  isWorldRecord: boolean;
};

const isBetterTotalTurnDuration = (
  candidateMs: number,
  existingMs: number | null,
) => {
  if (existingMs == null) return false;
  return candidateMs < existingMs;
};

/** Count human shots + total active turn duration for a completed bot speed run. */
export async function getHumanSpeedRunStats(matchId: string, humanPlayerId: string): Promise<{
  humanTurns: number;
  totalTurnDurationMs: number;
}> {
  const result = await queryOne<{ humanTurns: unknown; totalTurnDurationMs: unknown }>(
    `SELECT COUNT(*) AS "humanTurns", COALESCE(SUM(turn_duration_ms), 0) AS "totalTurnDurationMs"
     FROM pool_moves
     WHERE match_id = $1 AND player_id = $2`,
    [matchId, humanPlayerId],
  );
  return {
    humanTurns: toNum(result?.humanTurns),
    totalTurnDurationMs: toNum(result?.totalTurnDurationMs),
  };
}

/**
 * Check and update the bot speed run record after a human wins vs a bot.
 * Returns details for post-game display.
 */
export async function checkAndUpdateBotRecord(
  userId: string,
  userName: string,
  difficulty: string,
  humanTurns: number,
  totalTurnDurationMs: number,
): Promise<BotRecordResult> {
  const existingRow = await queryOne<RawBotRecordRow>(
    `SELECT ${BOT_RECORD_SELECT} FROM pool_bot_records
     WHERE user_id = $1 AND bot_difficulty = $2`,
    [userId, difficulty],
  );
  const existing = existingRow ? normalizeBotRecordRow(existingRow) : null;

  const isNewRecord = !existing
    || humanTurns < existing.fewestTurns
    || (
      humanTurns === existing.fewestTurns
      && isBetterTotalTurnDuration(totalTurnDurationMs, existing.totalTurnDurationMs ?? null)
    );
  const isLegacyTimeUpgrade = Boolean(
    existing
    && humanTurns === existing.fewestTurns
    && existing.totalTurnDurationMs == null,
  );

  if (isNewRecord || isLegacyTimeUpgrade) {
    const now = Date.now();
    if (existing) {
      await query(
        `UPDATE pool_bot_records
         SET user_name = $1, fewest_turns = $2, total_turn_duration_ms = $3, achieved_at = $4
         WHERE user_id = $5 AND bot_difficulty = $6`,
        [userName, humanTurns, totalTurnDurationMs, now, userId, difficulty],
      );
    } else {
      await query(
        `INSERT INTO pool_bot_records
           (user_id, user_name, bot_difficulty, fewest_turns, total_turn_duration_ms, achieved_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, userName, difficulty, humanTurns, totalTurnDurationMs, now],
      );
    }
  }

  // Check if this is #1 on the global leaderboard for this difficulty
  const best = await queryOne<RawBotRecordRow>(
    `SELECT ${BOT_RECORD_SELECT} FROM pool_bot_records
     WHERE bot_difficulty = $1
     ${BOT_RECORD_ORDER_BY}
     LIMIT 1`,
    [difficulty],
  );

  const isWorldRecord = isNewRecord && best?.userId === userId;

  return {
    humanTurns,
    previousBest: existing?.fewestTurns ?? null,
    isNewRecord,
    isWorldRecord,
  };
}

/** Get bot speed run leaderboard for a specific difficulty. */
export async function getBotRecordLeaderboard(difficulty: string, limit = 50): Promise<BotRecordRow[]> {
  const result = await query<RawBotRecordRow>(
    `SELECT ${BOT_RECORD_SELECT} FROM pool_bot_records
     WHERE bot_difficulty = $1
     ${BOT_RECORD_ORDER_BY}
     LIMIT $2`,
    [difficulty, limit],
  );
  return result.rows.map(normalizeBotRecordRow);
}

/** Get a player's personal bests across all difficulties. */
export async function getPlayerBotRecords(userId: string): Promise<BotRecordRow[]> {
  const result = await query<RawBotRecordRow>(
    `SELECT ${BOT_RECORD_SELECT} FROM pool_bot_records WHERE user_id = $1`,
    [userId],
  );
  return result.rows.map(normalizeBotRecordRow);
}
