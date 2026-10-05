// ---------------------------------------------------------------------------
// 8-Ball Pool match management (CRUD + state transitions).
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { query, queryOne, withTransaction } from '@/server/db/client';
import {
  inUserIdOrder,
  poolSql,
  withSettleTransaction,
  type PoolSql,
} from '@/server/arcade/pool-sql';
import { isGuestUserId } from '@/server/auth/guest';
import { createBreakRack, type Ball } from '@/features/arcade/lib/pool-physics';
import { broadcast } from '@/server/events';
import {
  announcePoolWin,
  processRatedMatch,
  penalizeForfeitLoserOnly,
  type EloChangeResult,
} from '@/server/arcade/pool-elo';
import {
  holdMatchWager,
  holdPlayer1Wager,
  refundMatchWager,
  settleMatchWager,
} from '@/server/arcade/pool-wager';
import { payPoolMatch } from '@/server/arcade/pool-settle';
import { recordGameTimeMetric } from '@/server/arcade/game-time-metrics';
import { addAntiCheatLog } from '@/server/arcade/anti-cheat-logs';
import { clearPoolChallengeDenials } from '@/server/arcade/pool-challenge-limits';
import { cleanupGuestPoolMatches } from '@/server/arcade/pool-guest-practice';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MatchStatus = 'waiting' | 'active' | 'completed' | 'forfeited';
export type MatchPhase = 'break' | 'open_table' | 'play' | 'game_over';
export type FoulState = {
  type: 'scratch' | 'wrong_first' | 'no_rail' | 'no_contact' | 'illegal_break';
  ballInHand: boolean;
  behindHeadString: boolean;
};

export type PoolMatch = {
  id: string;
  player1Id: string;
  player1Name: string;
  invitedUserId: string | null;
  player2Id: string | null;
  player2Name: string | null;
  status: MatchStatus;
  currentTurn: string;
  phase: MatchPhase;
  player1Group: 'solids' | 'stripes' | null;
  player2Group: 'solids' | 'stripes' | null;
  balls: Ball[];
  foulState: FoulState | null;
  winnerId: string | null;
  loserId: string | null;
  winReason: string | null;
  moveCount: number;
  turnStartedAt: number | null;
  lastReminderAt: number | null;
  lastShotInputJson: string | null;
  ballsBeforeLastShotJson: string | null;
  tournamentMatchId: string | null;
  wagerAmount: number | null;
  hardcoreMode: boolean;
  wagerStatus: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Cap for recorded per-turn play time. 8-ball is async — TURN_TIMEOUT_MS
// is 12 hours — so wall-clock between turnStartedAt and a shot can be
// arbitrarily long even though the player's real engagement is a few
// seconds of thinking plus the shot animation. 60s covers even a slow
// human turn while preventing AFK/async gaps from inflating the
// per-player game-time-metrics.
const MAX_RECORDED_TURN_MS = 60 * 1000;
const POOL_MATCH_LIST_LIMIT = 50;
const POOL_RETENTION_BATCH_SIZE = 200;
const POOL_RETENTION_MIN_INTERVAL_MS = 60 * 60 * 1000; // 1h
const WAITING_MATCH_RETENTION_MS = 14 * 24 * 60 * 60 * 1000; // 14d
const FINISHED_MATCH_RETENTION_MS = 120 * 24 * 60 * 60 * 1000; // 120d

let lastPoolRetentionRunAt = 0;

type PoolDeleteCounts = {
  deletedMatches: number;
  deletedMoves: number;
  deletedChat: number;
  deletedEloHistory: number;
};

const toNum = (value: unknown): number => (value == null ? 0 : Number(value));
const toNumOrNull = (value: unknown): number | null =>
  value == null ? null : Number(value);

const clampTurnDurationMs = (durationMs: number): number => {
  if (!Number.isFinite(durationMs)) return 0;
  const normalized = Math.floor(durationMs);
  if (normalized <= 0) return 0;
  return Math.min(normalized, MAX_RECORDED_TURN_MS);
};

export const estimatePoolTurnDurationMs = ({
  turnStartedAt,
  endedAtMs = Date.now(),
}: {
  turnStartedAt: number | null | undefined;
  endedAtMs?: number;
}) => {
  if (typeof turnStartedAt !== 'number' || !Number.isFinite(turnStartedAt)) {
    return 0;
  }
  return clampTurnDurationMs(endedAtMs - turnStartedAt);
};

function parseBalls(json: string): Ball[] {
  try {
    return JSON.parse(json) as Ball[];
  } catch {
    return [];
  }
}

function parseFoulState(json: string | null): FoulState | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as FoulState;
  } catch {
    return null;
  }
}

const POOL_MATCH_SELECT = `
  id,
  player1_id AS "player1Id",
  player1_name AS "player1Name",
  invited_user_id AS "invitedUserId",
  player2_id AS "player2Id",
  player2_name AS "player2Name",
  status,
  current_turn AS "currentTurn",
  phase,
  player1_group AS "player1Group",
  player2_group AS "player2Group",
  balls_json AS "ballsJson",
  foul_state_json AS "foulStateJson",
  winner_id AS "winnerId",
  loser_id AS "loserId",
  win_reason AS "winReason",
  move_count AS "moveCount",
  turn_started_at AS "turnStartedAt",
  last_reminder_at AS "lastReminderAt",
  last_shot_input_json AS "lastShotInputJson",
  balls_before_last_shot_json AS "ballsBeforeLastShotJson",
  tournament_match_id AS "tournamentMatchId",
  wager_amount AS "wagerAmount",
  hardcore_mode AS "hardcoreMode",
  wager_status AS "wagerStatus",
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  completed_at AS "completedAt"
`;

type PoolMatchRow = {
  id: string;
  player1Id: string;
  player1Name: string;
  invitedUserId: string | null;
  player2Id: string | null;
  player2Name: string | null;
  status: string;
  currentTurn: string;
  phase: string;
  player1Group: string | null;
  player2Group: string | null;
  ballsJson: string;
  foulStateJson: string | null;
  winnerId: string | null;
  loserId: string | null;
  winReason: string | null;
  moveCount: string | number;
  turnStartedAt: string | number | null;
  lastReminderAt: string | number | null;
  lastShotInputJson: string | null;
  ballsBeforeLastShotJson: string | null;
  tournamentMatchId: string | null;
  wagerAmount: string | number | null;
  hardcoreMode: boolean | number | null;
  wagerStatus: string | null;
  createdAt: string | number;
  updatedAt: string | number;
  completedAt: string | number | null;
};

function rowToMatch(row: PoolMatchRow): PoolMatch {
  return {
    id: row.id,
    player1Id: row.player1Id,
    player1Name: row.player1Name,
    invitedUserId: row.invitedUserId ?? null,
    player2Id: row.player2Id ?? null,
    player2Name: row.player2Name ?? null,
    status: row.status as MatchStatus,
    currentTurn: row.currentTurn,
    phase: row.phase as MatchPhase,
    player1Group: (row.player1Group as 'solids' | 'stripes') ?? null,
    player2Group: (row.player2Group as 'solids' | 'stripes') ?? null,
    balls: parseBalls(row.ballsJson),
    foulState: parseFoulState(row.foulStateJson ?? null),
    winnerId: row.winnerId ?? null,
    loserId: row.loserId ?? null,
    winReason: row.winReason ?? null,
    moveCount: toNum(row.moveCount),
    turnStartedAt: toNumOrNull(row.turnStartedAt),
    lastReminderAt: toNumOrNull(row.lastReminderAt),
    lastShotInputJson: row.lastShotInputJson ?? null,
    ballsBeforeLastShotJson: row.ballsBeforeLastShotJson ?? null,
    tournamentMatchId: row.tournamentMatchId ?? null,
    wagerAmount: toNumOrNull(row.wagerAmount),
    hardcoreMode: row.hardcoreMode === true || row.hardcoreMode === 1,
    wagerStatus: row.wagerStatus ?? null,
    createdAt: toNum(row.createdAt),
    updatedAt: toNum(row.updatedAt),
    completedAt: toNumOrNull(row.completedAt),
  };
}

const listStalePoolMatchIds = async ({
  now,
  batchSize,
}: {
  now: number;
  batchSize: number;
}) => {
  const waitingCutoff = now - WAITING_MATCH_RETENTION_MS;
  const finishedCutoff = now - FINISHED_MATCH_RETENTION_MS;

  const staleWaiting = await query<{ id: string }>(
    `SELECT id
     FROM pool_matches
     WHERE status = 'waiting'
       AND updated_at < $1
     LIMIT $2`,
    [waitingCutoff, batchSize],
  );

  const staleFinished = await query<{ id: string }>(
    `SELECT id
     FROM pool_matches
     WHERE status IN ('completed', 'forfeited')
       AND COALESCE(completed_at, updated_at) < $1
     LIMIT $2`,
    [finishedCutoff, batchSize],
  );

  return Array.from(
    new Set([
      ...staleWaiting.rows.map((row) => row.id),
      ...staleFinished.rows.map((row) => row.id),
    ]),
  );
};

const deletePoolMatchesById = async (matchIds: string[]): Promise<PoolDeleteCounts> => {
  if (matchIds.length === 0) {
    return {
      deletedMatches: 0,
      deletedMoves: 0,
      deletedChat: 0,
      deletedEloHistory: 0,
    };
  }

  const deletedMoves = (await query(
    'DELETE FROM pool_moves WHERE match_id = ANY($1)', [matchIds],
  )).rowCount ?? 0;
  const deletedChat = (await query(
    'DELETE FROM pool_match_chat WHERE match_id = ANY($1)', [matchIds],
  )).rowCount ?? 0;
  const deletedEloHistory = (await query(
    'DELETE FROM pool_elo_history WHERE match_id = ANY($1)', [matchIds],
  )).rowCount ?? 0;
  const deletedMatches = (await query(
    'DELETE FROM pool_matches WHERE id = ANY($1)', [matchIds],
  )).rowCount ?? 0;

  return {
    deletedMatches,
    deletedMoves,
    deletedChat,
    deletedEloHistory,
  };
};

export async function maybeRunPoolDataRetentionCleanup(): Promise<void> {
  const now = Date.now();
  if (now - lastPoolRetentionRunAt < POOL_RETENTION_MIN_INTERVAL_MS) {
    return;
  }
  lastPoolRetentionRunAt = now;

  try {
    const staleMatchIds = await listStalePoolMatchIds({
      now,
      batchSize: POOL_RETENTION_BATCH_SIZE,
    });
    await deletePoolMatchesById(staleMatchIds);
  } catch (error) {
    console.error('Pool retention cleanup failed', error);
  }
  await cleanupGuestPoolMatches(now);
}

export async function deleteRecentMatchHistoryForUser(
  userId: string,
): Promise<PoolDeleteCounts> {
  const finishedRows = await query<{ id: string }>(
    `SELECT id FROM pool_matches
     WHERE status IN ('completed', 'forfeited')
       AND (player1_id = $1 OR player2_id = $1)`,
    [userId],
  );

  const matchIds = finishedRows.rows.map((row) => row.id);
  const counts = await deletePoolMatchesById(matchIds);
  await query('DELETE FROM pool_recent_match_clears WHERE user_id = $1', [userId]);

  return counts;
}

const getRecentClearCutoffForUser = async (userId: string): Promise<number | null> => {
  const row = await queryOne<{ clearedBeforeTs: string | number }>(
    `SELECT cleared_before_ts AS "clearedBeforeTs"
     FROM pool_recent_match_clears
     WHERE user_id = $1`,
    [userId],
  );
  return row ? toNum(row.clearedBeforeTs) : null;
};

// ---------------------------------------------------------------------------
// Match CRUD
// ---------------------------------------------------------------------------

/** Create a new match. Breaker is decided when the opponent joins. */
export async function createMatch(
  userId: string,
  userName: string,
  options?: {
    invitedUserId?: string | null;
    tournamentMatchId?: string | null;
    wagerAmount?: number | null;
    hardcoreMode?: boolean;
  },
  /** Insert on this transaction. The caller broadcasts after its commit. */
  sql?: PoolSql,
): Promise<PoolMatch> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const balls = createBreakRack();

  const match: PoolMatch = {
    id,
    player1Id: userId,
    player1Name: userName,
    invitedUserId: options?.invitedUserId ?? null,
    player2Id: null,
    player2Name: null,
    status: 'waiting',
    currentTurn: userId,
    phase: 'break',
    player1Group: null,
    player2Group: null,
    balls,
    foulState: null,
    winnerId: null,
    loserId: null,
    winReason: null,
    moveCount: 0,
    turnStartedAt: now,
    lastReminderAt: null,
    lastShotInputJson: null,
    ballsBeforeLastShotJson: null,
    tournamentMatchId: options?.tournamentMatchId ?? null,
    wagerAmount: options?.wagerAmount ?? null,
    hardcoreMode: options?.hardcoreMode ?? false,
    wagerStatus: options?.wagerAmount ? 'pending_accept' : null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };

  await poolSql(sql).query(
    `INSERT INTO pool_matches
       (id, player1_id, player1_name, invited_user_id, player2_id, player2_name,
        status, current_turn, phase, player1_group, player2_group, balls_json,
        foul_state_json, winner_id, loser_id, win_reason, move_count,
        turn_started_at, last_reminder_at, last_shot_input_json,
        tournament_match_id, wager_amount, hardcore_mode, wager_status,
        created_at, updated_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
             $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)`,
    [
      match.id, match.player1Id, match.player1Name, match.invitedUserId,
      match.player2Id, match.player2Name, match.status, match.currentTurn,
      match.phase, match.player1Group, match.player2Group,
      JSON.stringify(balls), null, match.winnerId, match.loserId,
      match.winReason, match.moveCount, match.turnStartedAt,
      match.lastReminderAt, match.lastShotInputJson, match.tournamentMatchId,
      match.wagerAmount, match.hardcoreMode, match.wagerStatus,
      match.createdAt, match.updatedAt, match.completedAt,
    ],
  );
  if (!sql) broadcast('poolLobby', { type: 'match_created', matchId: id });

  return match;
}

/**
 * Create a challenge and hold player 1's stake on the given transaction, so
 * no one can join a wagered table before its stake is held, and a failed
 * hold leaves no table behind.
 */
export async function createMatchWithStake(
  client: PoolSql,
  userId: string,
  userName: string,
  options: {
    invitedUserId?: string | null;
    wagerAmount?: number | null;
    hardcoreMode?: boolean;
  },
): Promise<PoolMatch> {
  const match = await createMatch(userId, userName, options, client);
  if (match.wagerAmount && match.wagerAmount > 0) {
    await holdPlayer1Wager(match.id, userId, match.wagerAmount, client as PoolClient);
    match.wagerStatus = 'p1_held';
  }
  return match;
}

/** Delete a match (used when wager hold fails during creation). */
export async function deleteMatch(matchId: string): Promise<void> {
  await query('DELETE FROM pool_matches WHERE id = $1', [matchId]);
}

/** Join an open match. Uses an atomic conditional UPDATE to prevent races. */
export async function joinMatch(
  matchId: string,
  userId: string,
  userName: string,
): Promise<PoolMatch> {
  // Pre-flight checks for clear error messages
  const row = await getMatch(matchId);

  if (!row) throw new Error('Match not found.');
  if (row.status !== 'waiting') throw new Error('Match is not open.');
  if (row.player1Id === userId) throw new Error('Cannot join your own match.');
  if (row.invitedUserId && row.invitedUserId !== userId) {
    throw new Error('This match is reserved for another player.');
  }
  if (row.player2Id) throw new Error('Match is already full.');

  // Atomic seat claim: only succeeds if still waiting + no player2.
  // Randomly assign who breaks (50/50 between creator and joiner).
  const now = Date.now();
  const joinerBreaks = Math.random() < 0.5;
  const breaker = joinerBreaks ? userId : row.player1Id;
  // The seat, player 2's stake and the move to 'held' commit together. A
  // forfeit can never see an active match whose stake is only half held,
  // and a failed hold leaves the table waiting as it was.
  const wagered = Boolean(row.wagerAmount && row.wagerAmount > 0);
  try {
    await withTransaction(async (client) => {
      const result = await client.query(
        `UPDATE pool_matches
         SET player2_id = $1, player2_name = $2, invited_user_id = NULL,
             status = 'active', current_turn = $3, turn_started_at = $4, updated_at = $4,
             wager_status = CASE WHEN $6 THEN 'held' ELSE wager_status END
         WHERE id = $5
           AND status = 'waiting'
           AND (invited_user_id IS NULL OR invited_user_id = $1)
           AND player2_id IS NULL
           AND (NOT $6 OR wager_status = 'p1_held')`,
        [userId, userName, breaker, now /* break turn timer starts when opponent joins */, matchId, wagered],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new Error('Match was already claimed by another player.');
      }
      if (wagered) {
        await holdMatchWager(matchId, row.player1Id, userId, row.wagerAmount!, client);
      }
    });
  } catch (error) {
    const message = (error as Error).message ?? '';
    if (message.includes('already claimed')) throw error;
    throw new Error(
      message.includes('Insufficient')
        ? 'Insufficient Tickets to accept this wager.'
        : 'Failed to hold wager Tickets.',
    );
  }

  // Accepting a challenge clears any prior deny streak for this sender-target pair.
  if (row.invitedUserId === userId) {
    await clearPoolChallengeDenials({
      senderUserId: row.player1Id,
      targetUserId: userId,
    });
  }

  const updated = await getMatch(matchId);

  broadcast('poolLobby', { type: 'match_joined', matchId });
  broadcast([`pool:${matchId}`, 'poolMatch'], { matchId, type: 'opponent_joined', userId, userName });

  return updated!;
}

/** Get a single match by ID. */
export async function getMatch(matchId: string): Promise<PoolMatch | null> {
  const row = await queryOne<PoolMatchRow>(
    `SELECT ${POOL_MATCH_SELECT} FROM pool_matches WHERE id = $1`,
    [matchId],
  );
  return row ? rowToMatch(row) : null;
}

/** Get all matches for a user (active, waiting, and recent completed). */
export async function getMatchesForUser(userId: string): Promise<PoolMatch[]> {
  const clearedBeforeTs = await getRecentClearCutoffForUser(userId);
  const result = await query<PoolMatchRow>(
    `SELECT ${POOL_MATCH_SELECT} FROM pool_matches
     WHERE player1_id = $1
        OR player2_id = $1
        OR (status = 'waiting' AND invited_user_id = $1)
     ORDER BY updated_at DESC
     LIMIT $2`,
    [userId, POOL_MATCH_LIST_LIMIT * 4],
  );

  const visibleMatches = result.rows.map(rowToMatch).filter((match) => {
    if (clearedBeforeTs === null) return true;
    const isRecentHistoryStatus =
      match.status === 'completed' || match.status === 'forfeited';
    if (!isRecentHistoryStatus) return true;
    const effectiveCompletedAt = match.completedAt ?? match.updatedAt;
    return effectiveCompletedAt > clearedBeforeTs;
  });

  return visibleMatches.slice(0, POOL_MATCH_LIST_LIMIT);
}

/** Get matches waiting for a second player (excluding the user's own). */
export async function getOpenMatches(excludeUserId: string): Promise<PoolMatch[]> {
  const result = await query<PoolMatchRow>(
    `SELECT ${POOL_MATCH_SELECT} FROM pool_matches
     WHERE status = 'waiting' AND invited_user_id IS NULL
     ORDER BY created_at DESC
     LIMIT 20`,
  );

  return result.rows.filter((r) => r.player1Id !== excludeUserId).map(rowToMatch);
}

// Minimum moves before a forfeit awards Elo. Prevents instant-forfeit Elo farming.
const MIN_MOVES_FOR_ELO_FORFEIT = 4;
// Rapid forfeit thresholds for anti-cheat flagging
const FORFEIT_FLAG_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const FORFEIT_FLAG_THRESHOLD = 3; // 3+ forfeits in 1 hour = flag
// Same-pair forfeit block: if same pair forfeits 2+ times in 24h, no Elo
const PAIR_FORFEIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const PAIR_FORFEIT_THRESHOLD = 2;

/** Count recent forfeits by a user within a time window. */
async function countRecentForfeits(byUserId: string, windowMs: number): Promise<number> {
  const since = Date.now() - windowMs;
  const result = await queryOne<{ cnt: unknown }>(
    `SELECT COUNT(*) AS cnt FROM pool_matches
     WHERE (player1_id = $1 OR player2_id = $1) AND loser_id = $1
       AND win_reason = 'forfeit' AND completed_at > $2`,
    [byUserId, since],
  );
  return toNum(result?.cnt);
}

/** Count recent forfeits between a specific pair of players. */
async function countPairForfeits(
  userA: string,
  userB: string,
  windowMs: number,
): Promise<number> {
  const since = Date.now() - windowMs;
  const result = await queryOne<{ cnt: unknown }>(
    `SELECT COUNT(*) AS cnt FROM pool_matches
     WHERE win_reason = 'forfeit' AND completed_at > $1
       AND (
         (player1_id = $2 AND player2_id = $3) OR
         (player1_id = $3 AND player2_id = $2)
       )`,
    [since, userA, userB],
  );
  return toNum(result?.cnt);
}

/** Forfeit a match. The forfeiting player loses. Returns match + eloChange (if applicable). */
export async function forfeitMatch(
  matchId: string,
  userId: string,
): Promise<{ match: PoolMatch; eloChange: EloChangeResult | null }> {
  const row = await getMatch(matchId);

  if (!row) throw new Error('Match not found.');
  if (row.status === 'waiting') {
    throw new Error("Use cancel for matches that haven't started yet.");
  }
  if (row.status !== 'active') {
    throw new Error('Match is not in progress.');
  }
  if (row.player1Id !== userId && row.player2Id !== userId) {
    throw new Error('Not a player in this match.');
  }

  const winnerId = row.player1Id === userId ? row.player2Id : row.player1Id;
  const now = Date.now();
  const isBot = (id: string) => id.startsWith('bot:');
  const isHumanMatch = Boolean(
    winnerId && !isBot(winnerId) && !isBot(userId) && row.player2Id,
  );
  const winnerName =
    row.player1Id === winnerId ? row.player1Name : (row.player2Name ?? 'Unknown');
  const loserName =
    row.player1Id === userId ? row.player1Name : (row.player2Name ?? 'Unknown');

  // Anti-collusion inputs, read before the transaction (they don't change it).
  // 1. Must have played at least MIN_MOVES_FOR_ELO_FORFEIT moves (no instant-forfeit farming)
  // 2. Same pair can't earn Elo from forfeits more than PAIR_FORFEIT_THRESHOLD times in 24h
  const tooFew = row.moveCount < MIN_MOVES_FOR_ELO_FORFEIT;
  const pairForfeitCount = isHumanMatch && winnerId
    ? await countPairForfeits(winnerId, userId, PAIR_FORFEIT_WINDOW_MS)
    : 0;
  const pairAbuse = pairForfeitCount >= PAIR_FORFEIT_THRESHOLD;

  // Settle once: the claim, both players' stats, the Elo change and the
  // wager commit together or not at all. Only the request that flips the
  // row from active settles; a second forfeit, or a forfeit racing the shot
  // that ends the game, finds the row already taken and stops here.
  const eloChange = await withSettleTransaction(async (client) => {
    const claimed = await client.query(
      `UPDATE pool_matches
       SET status = 'forfeited', phase = 'game_over', winner_id = $1,
           loser_id = $2, win_reason = 'forfeit', updated_at = $3, completed_at = $3
       WHERE id = $4 AND status = 'active'`,
      [winnerId, userId, now, matchId],
    );
    if ((claimed.rowCount ?? 0) === 0) {
      throw new Error('Match is not in progress.');
    }

    let change: EloChangeResult | null = null;
    // Stats + Elo: only for human-vs-human matches (bot matches don't affect win/loss record)
    if (isHumanMatch && winnerId) {
      // Both players' rows, always in user-id order.
      const [first, second] = inUserIdOrder(
        { id: winnerId, name: winnerName, result: 'win' as const },
        { id: userId, name: loserName, result: 'forfeit' as const },
      );
      await updateStats(first.id, first.name, first.result, undefined, client);
      await updateStats(second.id, second.name, second.result, undefined, client);
      change = !tooFew && !pairAbuse
        // Clean forfeit after enough moves — full Elo for both sides
        ? await processRatedMatch(matchId, winnerId, userId, winnerName, loserName, client)
        // Suspicious forfeit — penalize the forfeiter but don't reward the winner.
        // This makes forfeiting always costly for the forfeiter (can't use
        // throwaway accounts without losing Elo) while preventing the winner
        // from farming Elo from instant forfeits.
        : await penalizeForfeitLoserOnly(matchId, winnerId, userId, winnerName, loserName, client);
    }

    // Settle or refund private match wagers, in the same transaction.
    if (
      row.wagerAmount &&
      row.wagerAmount > 0 &&
      row.wagerStatus === 'held' &&
      winnerId &&
      row.player2Id
    ) {
      if (row.moveCount < MIN_MOVES_FOR_ELO_FORFEIT) {
        // Early forfeit — refund both players
        await refundMatchWager(matchId, row.player1Id, row.player2Id, row.wagerAmount, client);
      } else {
        // Real forfeit — winner gets the pot
        await settleMatchWager(matchId, winnerId, row.wagerAmount, client);
      }
    }
    return change;
  });

  // A clean, rated forfeit win shows in the winner's feed, after the commit.
  if (isHumanMatch && winnerId && !tooFew && !pairAbuse) {
    announcePoolWin(winnerId);
  }

  if (isHumanMatch) {
    // Anti-cheat: flag rapid forfeits and pair abuse
    const recentForfeits = await countRecentForfeits(userId, FORFEIT_FLAG_WINDOW_MS);
    const isSuspicious =
      tooFew || pairAbuse || recentForfeits >= FORFEIT_FLAG_THRESHOLD;

    void addAntiCheatLog({
      ts: now,
      gameType: '8-ball',
      userId,
      userName: loserName,
      score: 0,
      result: isSuspicious ? 'flag' : 'pass',
      severity: isSuspicious ? 'flag' : undefined,
      reason: isSuspicious
        ? `Forfeit flagged: ${tooFew ? 'too_few_moves(' + row.moveCount + ')' : ''}${pairAbuse ? ' pair_abuse' : ''}${recentForfeits >= FORFEIT_FLAG_THRESHOLD ? ' rapid_forfeits(' + recentForfeits + '/1h)' : ''}`.trim()
        : `Forfeit at move ${row.moveCount}${tooFew ? ' (no Elo — too early)' : ''}`,
      stage: 'forfeit',
      checks: [
        `moves:${row.moveCount}`,
        `eloAwarded:${!tooFew && !pairAbuse}`,
        `pairForfeits24h:${pairForfeitCount}`,
        `userForfeits1h:${recentForfeits}`,
      ],
    });
  }

  // Record only active turn time for the forfeiting player (not match lifetime).
  if (row.currentTurn === userId && !isBot(userId) && !isGuestUserId(userId)) {
    const forfeitingTurnDurationMs = estimatePoolTurnDurationMs({
      turnStartedAt: row.turnStartedAt,
      endedAtMs: now,
    });
    void recordGameTimeMetric({
      userId,
      gameType: '8-ball',
      durationMs: forfeitingTurnDurationMs,
      playedAtMs: now,
    }).catch((error) => {
      console.error('Failed to record 8-ball forfeit time:', error);
    });
  }

  // Tickets for a completed match (a forfeit still counts as a played game),
  // awaited after the result has committed. awardGameRunCredits runs its own
  // transaction under the daily-cap lock and is keyed by sourceId, so a retry
  // can't pay twice. A guest's practice match pays nothing.
  if (winnerId && row.player2Id && !isGuestUserId(row.player1Id)) {
    await payPoolMatch(row, winnerId, userId, 'forfeit');
  }

  const updated = await getMatch(matchId);
  broadcast([`pool:${matchId}`, 'poolMatch'], {
    matchId,
    type: 'match_forfeited',
    forfeitedBy: userId,
  });
  broadcast('poolLobby', { type: 'match_ended', matchId });

  return { match: updated!, eloChange };
}

/**
 * Update match state after a shot. Uses compare-and-swap on moveCount
 * to prevent concurrent shot submissions from double-applying a turn, and
 * requires the match to still be active, so a shot that lands after a
 * forfeit can't reopen and settle the match a second time.
 * Returns true if the update was applied, false if it was rejected (stale).
 */
export async function updateMatchAfterShot(
  matchId: string,
  expectedMoveCount: number,
  update: {
    balls: Ball[];
    currentTurn: string;
    phase: MatchPhase;
    player1Group: 'solids' | 'stripes' | null;
    player2Group: 'solids' | 'stripes' | null;
    foulState: FoulState | null;
    winnerId: string | null;
    loserId: string | null;
    winReason: string | null;
    moveCount: number;
    /** JSON-encoded shot input for replay by the opponent. */
    lastShotInputJson?: string | null;
    /** JSON-encoded ball positions before this shot (for async replay). */
    ballsBeforeLastShotJson?: string | null;
  },
  sql?: PoolSql,
): Promise<boolean> {
  const now = Date.now();
  const isGameOver = update.phase === 'game_over';

  const result = await poolSql(sql).query(
    `UPDATE pool_matches
     SET balls_json = $1, current_turn = $2, phase = $3, player1_group = $4,
         player2_group = $5, foul_state_json = $6, winner_id = $7,
         loser_id = $8, win_reason = $9, move_count = $10, turn_started_at = $11,
         last_reminder_at = NULL, last_shot_input_json = $12,
         balls_before_last_shot_json = $13, status = $14, updated_at = $15,
         completed_at = CASE WHEN $16 THEN $17 ELSE completed_at END
     WHERE id = $18 AND move_count = $19 AND status = 'active'`,
    [
      JSON.stringify(update.balls),
      update.currentTurn,
      update.phase,
      update.player1Group,
      update.player2Group,
      update.foulState ? JSON.stringify(update.foulState) : null,
      update.winnerId,
      update.loserId,
      update.winReason,
      update.moveCount,
      now,
      update.lastShotInputJson ?? null,
      update.ballsBeforeLastShotJson ?? null,
      isGameOver ? 'completed' : 'active',
      now,
      isGameOver,
      now,
      matchId,
      expectedMoveCount,
    ],
  );

  return (result.rowCount ?? 0) > 0;
}

/** Record a shot move for replay/audit purposes. */
export async function recordMove(move: {
  matchId: string;
  playerId: string;
  moveNumber: number;
  angle: number;
  power: number;
  cuePosition: { x: number; y: number } | null;
  pocketedBallIds: number[];
  scratch: boolean;
  firstContactBallId: number | null;
  railContacts: number;
  foulType: string | null;
  resultJson: string;
  turnDurationMs?: number;
}, sql?: PoolSql): Promise<void> {
  await poolSql(sql).query(
    `INSERT INTO pool_moves
       (id, match_id, player_id, move_number, angle, power, cue_position_json,
        pocketed_balls_json, scratch, first_contact_ball_id, rail_contacts,
        foul_type, result_json, turn_duration_ms, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      crypto.randomUUID(),
      move.matchId,
      move.playerId,
      move.moveNumber,
      move.angle,
      move.power,
      move.cuePosition ? JSON.stringify(move.cuePosition) : null,
      JSON.stringify(move.pocketedBallIds),
      move.scratch ? 1 : 0,
      move.firstContactBallId,
      move.railContacts,
      move.foulType,
      move.resultJson,
      move.turnDurationMs ?? 0,
      Date.now(),
    ],
  );
}

// ── Turn timeout & reminder constants ────────────────────────────────────
/** After this many ms without a move, the inactive player auto-forfeits. */
export const TURN_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12 hours
/** Minimum time between nudge reminders. */
export const REMINDER_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Send a "your turn" reminder notification to the current player.
 * Returns false if on cooldown or not applicable (bot match, game over, etc.).
 */
export async function sendTurnReminder(
  matchId: string,
  requestingUserId: string,
): Promise<{ sent: boolean; reason?: string; retryAfterMs?: number }> {
  const { createNotification } =
    await import('@/server/services/notifications');
  const match = await getMatch(matchId);
  if (!match) return { sent: false, reason: 'Match not found.' };
  if (match.status !== 'active')
    return { sent: false, reason: 'Match is not active.' };
  if (match.currentTurn === requestingUserId)
    return { sent: false, reason: 'It is already your turn.' };
  if (match.currentTurn.startsWith('bot:'))
    return { sent: false, reason: 'Cannot remind a bot.' };

  // Check cooldown
  const now = Date.now();
  if (
    match.lastReminderAt &&
    now - match.lastReminderAt < REMINDER_COOLDOWN_MS
  ) {
    const remainMs = REMINDER_COOLDOWN_MS - (now - match.lastReminderAt);
    const remainMin = Math.ceil(remainMs / 60000);
    return {
      sent: false,
      reason: `Reminder already sent. Try again in ${remainMin} min.`,
      retryAfterMs: remainMs,
    };
  }

  // Update cooldown timestamp
  await query(
    'UPDATE pool_matches SET last_reminder_at = $1 WHERE id = $2',
    [now, matchId],
  );

  // Determine names
  const senderName =
    match.player1Id === requestingUserId
      ? match.player1Name
      : (match.player2Name ?? 'Opponent');

  await createNotification({
    userId: match.currentTurn,
    type: 'game_turn',
    title: 'Your shot in 8-ball',
    body: `${senderName} is waiting for your shot.`,
    href: `/8-ball/${matchId}`,
    preferenceKey: 'game_notifications',
  });

  return { sent: true };
}

/**
 * Find active human-vs-human matches where the current player's turn has
 * exceeded TURN_TIMEOUT_MS and auto-forfeit them. Called periodically.
 */
export async function processStaleMatches(): Promise<number> {
  const cutoff = Date.now() - TURN_TIMEOUT_MS;
  const staleMatches = await query<PoolMatchRow>(
    `SELECT ${POOL_MATCH_SELECT} FROM pool_matches
     WHERE status = 'active'
       AND current_turn NOT LIKE 'bot:%'
       AND player1_id NOT LIKE 'guest:%'
       AND turn_started_at IS NOT NULL
       AND turn_started_at < $1`,
    [cutoff],
  );

  let forfeited = 0;
  for (const row of staleMatches.rows) {
    try {
      // The player whose turn it is gets forfeited
      const { match } = await forfeitMatch(row.id, row.currentTurn);
      forfeited++;
      // A timed-out tournament match moves its bracket on, like a forfeit
      // from the route does.
      if (match.tournamentMatchId) {
        try {
          const { onPoolMatchCompleted } = await import('@/server/arcade/pool-tournament');
          await onPoolMatchCompleted(match.id);
        } catch (error) {
          console.error('Tournament progression after a timed-out 8-ball match failed', error);
        }
      }
    } catch {
      // Already completed or invalid — skip
    }
  }

  // A bot match left on the bot's turn (the player never opened it again
  // after the bot's break, or the shot route stopped at its 15-turn cap)
  // ends with no result. Bot matches pay out only on a real finish, and
  // nobody is rated, so there is nothing to settle.
  const stalledBot = await query(
    `UPDATE pool_matches
     SET status = 'forfeited', phase = 'game_over', win_reason = 'timeout',
         updated_at = $2, completed_at = $2
     WHERE status = 'active'
       AND current_turn LIKE 'bot:%'
       AND turn_started_at IS NOT NULL
       AND turn_started_at < $1`,
    [cutoff, Date.now()],
  );
  return forfeited + (stalledBot.rowCount ?? 0);
}

/** Count how many shots a player took in a match (from recorded moves). */
export async function countPlayerShots(matchId: string, playerId: string, sql?: PoolSql): Promise<number> {
  const result = (await poolSql(sql).query<{ count: unknown }>(
    `SELECT COUNT(*) AS count FROM pool_moves
     WHERE match_id = $1 AND player_id = $2`,
    [matchId, playerId],
  )).rows[0];
  return toNum(result?.count);
}

/**
 * Update player stats after a match concludes. One upsert with relative
 * counters, so two settles for the same player can't lose an update. Call
 * it for both players in user-id order inside a settle transaction, so the
 * row locks are always taken in the same order.
 */
export async function updateStats(
  userId: string,
  userName: string,
  result: 'win' | 'loss' | 'forfeit',
  matchStats?: { shots: number; ballsPocketed: number },
  sql?: PoolSql,
): Promise<void> {
  const now = Date.now();
  const shots = matchStats?.shots ?? 0;
  const ballsPocketed = matchStats?.ballsPocketed ?? 0;
  const win = result === 'win' ? 1 : 0;
  const loss = result === 'loss' || result === 'forfeit' ? 1 : 0;
  const forfeit = result === 'forfeit' ? 1 : 0;
  await poolSql(sql).query(
    `INSERT INTO pool_stats
       (user_id, user_name, wins, losses, forfeits, current_streak,
        best_streak, total_shots, total_balls_pocketed, updated_at)
     VALUES ($1, $2, $3, $4, $5, $3, $3, $6, $7, $8)
     ON CONFLICT (user_id) DO UPDATE SET
       user_name = EXCLUDED.user_name,
       wins = pool_stats.wins + EXCLUDED.wins,
       losses = pool_stats.losses + EXCLUDED.losses,
       forfeits = pool_stats.forfeits + EXCLUDED.forfeits,
       current_streak = CASE WHEN EXCLUDED.wins > 0 THEN pool_stats.current_streak + 1 ELSE 0 END,
       best_streak = GREATEST(
         pool_stats.best_streak,
         CASE WHEN EXCLUDED.wins > 0 THEN pool_stats.current_streak + 1 ELSE 0 END
       ),
       total_shots = pool_stats.total_shots + EXCLUDED.total_shots,
       total_balls_pocketed = pool_stats.total_balls_pocketed + EXCLUDED.total_balls_pocketed,
       updated_at = EXCLUDED.updated_at`,
    [userId, userName, win, loss, forfeit, shots, ballsPocketed, now],
  );
}

// ---------------------------------------------------------------------------
// Spectator tracking (in-memory, 30s heartbeat expiry)
// ---------------------------------------------------------------------------

const SPECTATOR_EXPIRY_MS = 30_000;

/** matchId → Map<userId, lastSeenTimestamp> */
const spectatorMap = new Map<string, Map<string, number>>();

/** Register (or refresh) a spectator's presence on a match. */
export function trackSpectator(matchId: string, userId: string): void {
  if (!spectatorMap.has(matchId)) spectatorMap.set(matchId, new Map());
  spectatorMap.get(matchId)!.set(userId, Date.now());
}

/** Get the number of active spectators for a match. Prunes stale entries. */
export function getSpectatorCount(matchId: string): number {
  const viewers = spectatorMap.get(matchId);
  if (!viewers) return 0;
  const cutoff = Date.now() - SPECTATOR_EXPIRY_MS;
  for (const [uid, lastSeen] of viewers) {
    if (lastSeen < cutoff) viewers.delete(uid);
  }
  if (viewers.size === 0) {
    spectatorMap.delete(matchId);
    return 0;
  }
  return viewers.size;
}

/** Check if a match is spectatable (active human-vs-human or tournament). */
export function isMatchSpectatable(match: PoolMatch): boolean {
  if (match.status !== 'active') return false;
  if (!match.player2Id) return false;
  // Tournament matches are always spectatable
  if (match.tournamentMatchId) return true;
  // Ranked human-vs-human matches are spectatable
  return !match.player2Id.startsWith('bot:');
}

/** Max age of last turn for a match to appear in the live spectating list. */
const LIVE_MATCH_STALENESS_MS = 5 * 60 * 1000; // 5 minutes

/** Get all currently active spectatable matches (turn taken within last 5 min). */
export async function getActiveSpectatableMatches(): Promise<Array<
  PoolMatch & { spectatorCount: number }
>> {
  const cutoff = Date.now() - LIVE_MATCH_STALENESS_MS;

  const result = await query<PoolMatchRow>(
    `SELECT ${POOL_MATCH_SELECT} FROM pool_matches
     WHERE status = 'active' AND updated_at >= $1
       -- Bot matches (guest practice included) are never spectatable, and
       -- busy practice tables would otherwise crowd real games out of the 50.
       AND player2_id IS NOT NULL AND player2_id NOT LIKE 'bot:%'
     ORDER BY updated_at DESC
     LIMIT 50`,
    [cutoff],
  );

  return result.rows
    .map(rowToMatch)
    .filter(isMatchSpectatable)
    .map((match) => ({
      ...match,
      spectatorCount: getSpectatorCount(match.id),
    }));
}
