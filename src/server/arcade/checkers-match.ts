// ---------------------------------------------------------------------------
// Checkers match management (CRUD + server-authoritative move submission).
//
// Cloned from `chess-match.ts` but UNTIMED (no clock arithmetic / flag-fall),
// with the board stored in a `board text` column and moves validated by the
// pure checkers engine. Bots, Elo, stats, Tickets, and the (dormant)
// broadcast()/subscribeLive seams mirror chess. Tournaments + wagers + chat +
// direct-challenge limits are intentionally NOT cloned for v1.
//
// NOTE on rewards/metrics: `awardGameRunCredits` + `recordGameTimeMetric` take
// constrained gameType unions (shared files) that don't include 'checkers'.
// To avoid editing those shared unions we record checkers economy/time under
// the existing 'chess' gameType bucket — same currency, same 2-player board
// shape + bot tiers. Documented for the orchestrator.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { query, queryOne } from '@/server/db/client';
import { broadcast } from '@/server/events';
import {
  applyMove,
  detectGameEnd,
  legalMoves,
  STARTING_BOARD,
  colorForPlayer,
  type GameEndResult,
} from '@/features/arcade/lib/checkers';
import {
  computeBotMove,
  isBotUser,
  type BotDifficulty,
} from '@/server/arcade/checkers-bot';
import {
  resolveTimeFormat,
  type CheckersColor,
  type CheckersMatch,
  type GameResult,
  type MatchStatus,
  type WinReason,
} from '@/features/arcade/lib/checkers/types';
import {
  processRatedMatch,
  penalizeForfeitLoserOnly,
  recordBotSpeedRun,
  type EloChangeResult,
  type MatchOutcome,
} from '@/server/arcade/checkers-elo';
import { awardGameRunCredits } from '@/server/arcade/rewards/wallet';
import { recordMatchRunResult } from '@/server/arcade/match-run-results';
import { recordGameTimeMetric } from '@/server/arcade/game-time-metrics';
import { addAntiCheatLog } from '@/server/arcade/anti-cheat-logs';

// Checkers records economy + game-time under the shared 'chess' bucket — see
// the file header note. Centralised here so it's a one-line change if the
// orchestrator later adds a dedicated 'checkers' union member.
const REWARD_GAME_TYPE = 'checkers' as const;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHECKERS_MATCH_LIST_LIMIT = 50;
const MAX_RECORDED_MOVE_MS = 60 * 60 * 1000;
const WAITING_MATCH_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const FINISHED_MATCH_RETENTION_MS = 120 * 24 * 60 * 60 * 1000;
const RETENTION_MIN_INTERVAL_MS = 60 * 60 * 1000;
const RETENTION_BATCH_SIZE = 200;

const LIVE_MATCH_STALENESS_MS = 5 * 60 * 1000;
const MIN_PLY_FOR_ELO_FORFEIT = 4;
const PAIR_FORFEIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const PAIR_FORFEIT_THRESHOLD = 2;
const FORFEIT_FLAG_WINDOW_MS = 60 * 60 * 1000;
const FORFEIT_FLAG_THRESHOLD = 3;

const SPECTATOR_EXPIRY_MS = 30_000;
const DRAW_OFFER_TTL_MS = 120_000;

let lastRetentionRunAt = 0;

// ---------------------------------------------------------------------------
// Row <-> domain conversion
// ---------------------------------------------------------------------------

const toNum = (value: unknown): number => (value == null ? 0 : Number(value));
const toNumOrNull = (value: unknown): number | null =>
  value == null ? null : Number(value);

const MATCH_SELECT = `
  id,
  player1_id AS "player1Id",
  player1_name AS "player1Name",
  invited_user_id AS "invitedUserId",
  player2_id AS "player2Id",
  player2_name AS "player2Name",
  red_id AS "redId",
  white_id AS "whiteId",
  status,
  current_turn AS "currentTurn",
  time_format AS "timeFormat",
  initial_time_ms AS "initialTimeMs",
  increment_ms AS "incrementMs",
  red_time_ms AS "redTimeMs",
  white_time_ms AS "whiteTimeMs",
  last_move_at AS "lastMoveAt",
  board,
  ply,
  move_count AS "moveCount",
  last_move AS "lastMove",
  draw_offered_by AS "drawOfferedBy",
  draw_offered_at AS "drawOfferedAt",
  result,
  winner_id AS "winnerId",
  loser_id AS "loserId",
  win_reason AS "winReason",
  tournament_match_id AS "tournamentMatchId",
  wager_amount AS "wagerAmount",
  wager_status AS "wagerStatus",
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  completed_at AS "completedAt"
`;

type CheckersMatchRow = {
  id: string;
  player1Id: string;
  player1Name: string;
  invitedUserId: string | null;
  player2Id: string | null;
  player2Name: string | null;
  redId: string | null;
  whiteId: string | null;
  status: string;
  currentTurn: string;
  timeFormat: string;
  initialTimeMs: string | number;
  incrementMs: string | number;
  redTimeMs: string | number;
  whiteTimeMs: string | number;
  lastMoveAt: string | number | null;
  board: string;
  ply: string | number;
  moveCount: string | number;
  lastMove: string | null;
  drawOfferedBy: string | null;
  drawOfferedAt: string | number | null;
  result: string | null;
  winnerId: string | null;
  loserId: string | null;
  winReason: string | null;
  tournamentMatchId: string | null;
  wagerAmount: string | number | null;
  wagerStatus: string | null;
  createdAt: string | number;
  updatedAt: string | number;
  completedAt: string | number | null;
};

function rowToMatch(row: CheckersMatchRow): CheckersMatch {
  return {
    id: row.id,
    player1Id: row.player1Id,
    player1Name: row.player1Name,
    invitedUserId: row.invitedUserId ?? null,
    player2Id: row.player2Id ?? null,
    player2Name: row.player2Name ?? null,
    redId: row.redId ?? null,
    whiteId: row.whiteId ?? null,
    status: row.status as MatchStatus,
    currentTurn: row.currentTurn,
    timeFormat: row.timeFormat,
    initialTimeMs: toNum(row.initialTimeMs),
    incrementMs: toNum(row.incrementMs),
    redTimeMs: toNum(row.redTimeMs),
    whiteTimeMs: toNum(row.whiteTimeMs),
    lastMoveAt: toNumOrNull(row.lastMoveAt),
    board: row.board,
    ply: toNum(row.ply),
    moveCount: toNum(row.moveCount),
    lastMove: row.lastMove ?? null,
    drawOfferedBy: row.drawOfferedBy ?? null,
    drawOfferedAt: toNumOrNull(row.drawOfferedAt),
    result: (row.result as GameResult | null) ?? null,
    winnerId: row.winnerId ?? null,
    loserId: row.loserId ?? null,
    winReason: (row.winReason as WinReason | null) ?? null,
    tournamentMatchId: row.tournamentMatchId ?? null,
    wagerAmount: toNumOrNull(row.wagerAmount),
    wagerStatus: row.wagerStatus ?? null,
    createdAt: toNum(row.createdAt),
    updatedAt: toNum(row.updatedAt),
    completedAt: toNumOrNull(row.completedAt),
  };
}

// ---------------------------------------------------------------------------
// Create / Join / Cancel
// ---------------------------------------------------------------------------

export type CreateMatchOptions = {
  invitedUserId?: string | null;
  tournamentMatchId?: string | null;
  wagerAmount?: number | null;
  timeFormatId?: string;
  preferredColor?: CheckersColor | 'random';
};

/** Create a new checkers match. Colours are assigned when an opponent joins. */
export async function createMatch(
  userId: string,
  userName: string,
  options?: CreateMatchOptions,
): Promise<CheckersMatch> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const preset = resolveTimeFormat(options?.timeFormatId);

  const preAssignedRed = options?.preferredColor === 'red' ? userId : null;
  const preAssignedWhite = options?.preferredColor === 'white' ? userId : null;

  const match: CheckersMatch = {
    id,
    player1Id: userId,
    player1Name: userName,
    invitedUserId: options?.invitedUserId ?? null,
    player2Id: null,
    player2Name: null,
    redId: preAssignedRed,
    whiteId: preAssignedWhite,
    status: 'waiting',
    currentTurn: userId,
    timeFormat: preset.id,
    initialTimeMs: preset.initialTimeMs,
    incrementMs: preset.incrementMs,
    redTimeMs: preset.initialTimeMs,
    whiteTimeMs: preset.initialTimeMs,
    lastMoveAt: null,
    board: STARTING_BOARD,
    ply: 0,
    moveCount: 0,
    lastMove: null,
    drawOfferedBy: null,
    drawOfferedAt: null,
    result: null,
    winnerId: null,
    loserId: null,
    winReason: null,
    tournamentMatchId: options?.tournamentMatchId ?? null,
    wagerAmount: options?.wagerAmount ?? null,
    wagerStatus: options?.wagerAmount ? 'pending_accept' : null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };

  await query(
    `INSERT INTO checkers_matches
       (id, player1_id, player1_name, invited_user_id, player2_id, player2_name,
        red_id, white_id, status, current_turn, time_format, initial_time_ms,
        increment_ms, red_time_ms, white_time_ms, last_move_at, board, ply,
        move_count, last_move, draw_offered_by, draw_offered_at,
        result, winner_id, loser_id, win_reason, tournament_match_id,
        wager_amount, wager_status, created_at, updated_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
             $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28,
             $29, $30, $31, $32)`,
    [
      match.id, match.player1Id, match.player1Name, match.invitedUserId,
      match.player2Id, match.player2Name, match.redId, match.whiteId,
      match.status, match.currentTurn, match.timeFormat, match.initialTimeMs,
      match.incrementMs, match.redTimeMs, match.whiteTimeMs, match.lastMoveAt,
      match.board, match.ply, match.moveCount, match.lastMove,
      match.drawOfferedBy, match.drawOfferedAt, match.result, match.winnerId,
      match.loserId, match.winReason, match.tournamentMatchId, match.wagerAmount,
      match.wagerStatus, match.createdAt, match.updatedAt, match.completedAt,
    ],
  );
  broadcast('checkersLobby', { type: 'match_created', matchId: id });
  if (options?.invitedUserId) {
    broadcast('checkersChallenge', {
      type: 'challenge_sent',
      matchId: id,
      senderId: userId,
      senderName: userName,
      invitedUserId: options.invitedUserId,
      timeFormatId: preset.id,
      wagerAmount: options?.wagerAmount ?? null,
    });
  }
  return match;
}

export async function deleteMatch(matchId: string): Promise<void> {
  await query('DELETE FROM checkers_matches WHERE id = $1', [matchId]);
}

export async function cancelWaitingMatch(matchId: string, userId: string): Promise<void> {
  const row = await getMatch(matchId);
  if (!row) throw new Error('Match not found.');
  if (row.player1Id !== userId) throw new Error('Only the creator can cancel this match.');
  if (row.status !== 'waiting') throw new Error('Only waiting matches can be cancelled.');

  const deleted = await query(
    `DELETE FROM checkers_matches WHERE id = $1 AND status = 'waiting'`,
    [matchId],
  );
  if ((deleted.rowCount ?? 0) === 0) {
    throw new Error('Match is no longer cancellable — it may have been joined.');
  }

  if (row.wagerAmount && row.wagerAmount > 0 && row.wagerStatus !== 'held' && row.wagerStatus !== 'paid' && row.wagerStatus !== 'refunded') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { mutateWalletAndLedgerTx } = require('@/server/arcade/rewards/helpers') as typeof import('@/server/arcade/rewards/helpers');
      await mutateWalletAndLedgerTx({
        userId: row.player1Id,
        currencyType: 'credits',
        amount: row.wagerAmount,
        sourceType: 'wager_refund',
        sourceId: `checkers-wager-refund:${matchId}:${row.player1Id}`,
        meta: { matchId, reason: 'cancelled', gameType: 'checkers' },
      });
    } catch (error) {
      console.error('Failed to refund wager on cancel:', error);
    }
  }

  broadcast('checkersLobby', { type: 'match_cancelled', matchId });
}

/** Join an open match. Uses atomic conditional UPDATE → 'active'. */
export async function joinMatch(
  matchId: string,
  userId: string,
  userName: string,
): Promise<CheckersMatch> {
  const row = await getMatch(matchId);
  if (!row) throw new Error('Match not found.');
  if (row.status !== 'waiting') throw new Error('Match is not open.');
  if (row.player1Id === userId) throw new Error('Cannot join your own match.');
  if (row.invitedUserId && row.invitedUserId !== userId) {
    throw new Error('This match is reserved for another player.');
  }
  if (row.player2Id) throw new Error('Match is already full.');

  const now = Date.now();

  // Resolve colours: if creator preferred a side it's already set; fill the other.
  let redId = row.redId;
  let whiteId = row.whiteId;
  if (redId && !whiteId) whiteId = userId;
  else if (whiteId && !redId) redId = userId;
  else {
    if (Math.random() < 0.5) {
      redId = row.player1Id;
      whiteId = userId;
    } else {
      redId = userId;
      whiteId = row.player1Id;
    }
  }

  // Red always moves first.
  const result = await query(
    `UPDATE checkers_matches
     SET player2_id = $1, player2_name = $2, invited_user_id = NULL,
         red_id = $3, white_id = $4, status = 'active', current_turn = $5,
         last_move_at = $6, updated_at = $6
     WHERE id = $7
       AND status = 'waiting'
       AND (invited_user_id IS NULL OR invited_user_id = $1)
       AND player2_id IS NULL`,
    [userId, userName, redId, whiteId, redId /* red moves first */, now, matchId],
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new Error('Match was already claimed by another player.');
  }

  if (row.wagerAmount && row.wagerAmount > 0) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { holdMatchWager } = require('@/server/arcade/chess-wager') as typeof import('@/server/arcade/chess-wager');
      await holdMatchWager(matchId, row.player1Id, userId, row.wagerAmount);
      await query(`UPDATE checkers_matches SET wager_status = 'held' WHERE id = $1`, [matchId]);
    } catch (error) {
      await query(
        `UPDATE checkers_matches
         SET player2_id = NULL, player2_name = NULL, red_id = $1, white_id = $2,
             invited_user_id = $3, status = 'waiting', current_turn = $4,
             last_move_at = NULL, updated_at = $5
         WHERE id = $6`,
        [row.redId, row.whiteId, row.invitedUserId, row.player1Id, Date.now(), matchId],
      );
      const message = (error as Error).message?.includes('Insufficient')
        ? 'Insufficient Tickets to accept this wager.'
        : 'Failed to hold wager Tickets.';
      throw new Error(message);
    }
  }

  const updated = await getMatch(matchId);
  broadcast('checkersLobby', { type: 'match_joined', matchId });
  broadcast([`checkers:${matchId}`, 'checkersMatch'], { matchId, type: 'opponent_joined', userId, userName });
  return updated!;
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

export async function getMatch(matchId: string): Promise<CheckersMatch | null> {
  const row = await queryOne<CheckersMatchRow>(
    `SELECT ${MATCH_SELECT} FROM checkers_matches WHERE id = $1`,
    [matchId],
  );
  return row ? rowToMatch(row) : null;
}

async function getRecentClearCutoffForUser(userId: string): Promise<number | null> {
  const row = await queryOne<{ clearedBeforeTs: string | number }>(
    `SELECT cleared_before_ts AS "clearedBeforeTs"
     FROM checkers_recent_match_clears
     WHERE user_id = $1`,
    [userId],
  );
  return row ? toNum(row.clearedBeforeTs) : null;
}

export async function getMatchesForUser(userId: string): Promise<CheckersMatch[]> {
  const clearedBeforeTs = await getRecentClearCutoffForUser(userId);
  const result = await query<CheckersMatchRow>(
    `SELECT ${MATCH_SELECT} FROM checkers_matches
     WHERE player1_id = $1
        OR player2_id = $1
        OR (status = 'waiting' AND invited_user_id = $1)
     ORDER BY updated_at DESC
     LIMIT $2`,
    [userId, CHECKERS_MATCH_LIST_LIMIT * 4],
  );

  return result.rows
    .map(rowToMatch)
    .filter((m) => {
      if (clearedBeforeTs === null) return true;
      const isHistory = m.status === 'completed' || m.status === 'forfeited';
      if (!isHistory) return true;
      return (m.completedAt ?? m.updatedAt) > clearedBeforeTs;
    })
    .slice(0, CHECKERS_MATCH_LIST_LIMIT);
}

export async function getOpenMatches(excludeUserId: string): Promise<CheckersMatch[]> {
  const result = await query<CheckersMatchRow>(
    `SELECT ${MATCH_SELECT} FROM checkers_matches
     WHERE status = 'waiting' AND invited_user_id IS NULL
     ORDER BY created_at DESC
     LIMIT 20`,
  );
  return result.rows.filter((r) => r.player1Id !== excludeUserId).map(rowToMatch);
}

export function isMatchSpectatable(match: CheckersMatch): boolean {
  if (match.status !== 'active') return false;
  if (!match.player2Id) return false;
  if (match.tournamentMatchId) return true;
  return !match.player2Id.startsWith('bot:');
}

export async function getActiveSpectatableMatches(): Promise<Array<CheckersMatch & { spectatorCount: number }>> {
  const cutoff = Date.now() - LIVE_MATCH_STALENESS_MS;
  const result = await query<CheckersMatchRow>(
    `SELECT ${MATCH_SELECT} FROM checkers_matches
     WHERE status = 'active' AND updated_at >= $1
     ORDER BY updated_at DESC
     LIMIT 50`,
    [cutoff],
  );
  return result.rows
    .map(rowToMatch)
    .filter(isMatchSpectatable)
    .map((m) => ({ ...m, spectatorCount: getSpectatorCount(m.id) }));
}

export async function clearRecentMatchesForUser(userId: string): Promise<number> {
  const now = Date.now();
  await query(
    `INSERT INTO checkers_recent_match_clears (user_id, cleared_before_ts, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET
       cleared_before_ts = EXCLUDED.cleared_before_ts,
       updated_at = EXCLUDED.updated_at`,
    [userId, now, now],
  );
  return now;
}

// ---------------------------------------------------------------------------
// Move submission (server-authoritative)
//
// The 40-move no-progress draw counter lives in the `no_progress_plies` column:
// it's reset to 0 on any capture or king promotion and incremented otherwise
// (see submitMove). detectGameEnd consumes it to declare a draw at 80 plies.
// ---------------------------------------------------------------------------

export type SubmitMoveResult = {
  ok: true;
  match: CheckersMatch;
  moveNotation: string;
  boardAfter: string;
  end: GameEndResult;
  elapsedMs: number;
  eloChange: EloChangeResult | null;
};

/**
 * Submit a move. Server validates legality (mandatory capture + full multi-jump
 * + promotion enforced by the engine), then runs terminal detection. Uses CAS
 * on ply to prevent double-apply on concurrent/duplicate requests.
 */
export async function submitMove(
  matchId: string,
  userId: string,
  move: string,
): Promise<SubmitMoveResult> {
  const match = await getMatch(matchId);
  if (!match) throw new Error('Match not found.');
  if (match.status !== 'active') throw new Error('Match is not in progress.');
  if (match.currentTurn !== userId) throw new Error('Not your turn.');

  const moverColor = colorForPlayer(match, userId);
  if (!moverColor) throw new Error('You are not a player in this match.');
  if (!match.redId || !match.whiteId) throw new Error('Opponent has not joined yet.');

  // Validate + apply move against the board (engine throws on illegal/invalid).
  const applied = applyMove(match.board, move, moverColor);

  const now = Date.now();
  const elapsed = match.lastMoveAt ? Math.max(0, now - match.lastMoveAt) : 0;
  const moveDurationMs = Math.min(elapsed, MAX_RECORDED_MOVE_MS);

  const nextTurn = moverColor === 'red' ? match.whiteId : match.redId;
  const ply = match.ply + 1;
  const moveCount = Math.ceil(ply / 2);

  // Compute the new no-progress counter: reset on capture or promotion, else +1.
  const priorNoProgress = await getNoProgressPlies(matchId);
  const nextNoProgress = applied.isCapture || applied.promoted ? 0 : priorNoProgress + 1;

  // Terminal detection for the side about to move (nextTurn's colour).
  const nextColor: CheckersColor = moverColor === 'red' ? 'white' : 'red';
  const end: GameEndResult = detectGameEnd(applied.board, nextColor, nextNoProgress);

  let winnerId: string | null = null;
  let loserId: string | null = null;
  let result: GameResult | null = null;
  let winReason: WinReason | null = null;
  let nextStatus: MatchStatus = 'active';

  if (end.over) {
    nextStatus = 'completed';
    result = end.result;
    winReason = end.reason;
    if (end.winnerColor === 'red') {
      winnerId = match.redId;
      loserId = match.whiteId;
    } else if (end.winnerColor === 'white') {
      winnerId = match.whiteId;
      loserId = match.redId;
    }
  }

  // Apply with CAS on ply + status='active' to prevent double-apply.
  const res = await query(
    `UPDATE checkers_matches
     SET board = $1, ply = $2, move_count = $3, current_turn = $4,
         last_move = $5, no_progress_plies = $6, last_move_at = $7,
         draw_offered_by = NULL, draw_offered_at = NULL, status = $8,
         result = $9, winner_id = $10, loser_id = $11, win_reason = $12,
         completed_at = $13, updated_at = $14
     WHERE id = $15 AND ply = $16 AND status = 'active'`,
    [
      applied.board, ply, moveCount, nextTurn, applied.moveNotation, nextNoProgress,
      now, nextStatus, result, winnerId, loserId, winReason,
      nextStatus === 'completed' ? now : null, now, matchId, match.ply,
    ],
  );

  if ((res.rowCount ?? 0) === 0) {
    throw new Error('Move was already processed (concurrent request).');
  }

  // Record move
  await query(
    `INSERT INTO checkers_moves
       (id, match_id, player_id, move_number, ply, notation, board_after,
        move_duration_ms, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      crypto.randomUUID(), matchId, userId, moveCount, ply, applied.moveNotation,
      applied.board, moveDurationMs, now,
    ],
  );

  if (!userId.startsWith('bot:')) {
    void recordGameTimeMetric({
      userId,
      gameType: REWARD_GAME_TYPE,
      durationMs: moveDurationMs,
      playedAtMs: now,
    }).catch((error) => {
      console.error('Failed to record checkers move time:', error);
    });
  }

  let eloChange: EloChangeResult | null = null;
  const updatedMatch = (await getMatch(matchId))!;

  if (nextStatus === 'completed') {
    eloChange = await finalizeCompletedMatch(updatedMatch, end);
  }

  broadcast([`checkers:${matchId}`, 'checkersMatch'], {
    matchId,
    type: 'move',
    moverId: userId,
    move: applied.moveNotation,
    ply,
    gameOver: nextStatus === 'completed',
    winnerId,
    winReason,
  });

  return {
    ok: true,
    match: updatedMatch,
    moveNotation: applied.moveNotation,
    boardAfter: applied.board,
    end,
    elapsedMs: moveDurationMs,
    eloChange,
  };
}

async function getNoProgressPlies(matchId: string): Promise<number> {
  const row = await queryOne<{ noProgressPlies: string | number }>(
    `SELECT no_progress_plies AS "noProgressPlies" FROM checkers_matches WHERE id = $1`,
    [matchId],
  );
  return toNum(row?.noProgressPlies);
}

// ---------------------------------------------------------------------------
// Resign / draw resolution
// ---------------------------------------------------------------------------

function recordCheckersTerminalTime(
  match: CheckersMatch,
  userId: string,
  now: number,
): void {
  if (userId.startsWith('bot:')) return;
  if (!match.lastMoveAt) return;
  const elapsed = Math.max(0, now - match.lastMoveAt);
  const durationMs = Math.min(elapsed, MAX_RECORDED_MOVE_MS);
  if (durationMs <= 0) return;
  void recordGameTimeMetric({
    userId,
    gameType: REWARD_GAME_TYPE,
    durationMs,
    playedAtMs: now,
  }).catch((error) => {
    console.error('Failed to record checkers terminal time:', error);
  });
}

/** Resign the match as userId. Returns the final match + Elo change. */
export async function resignMatch(matchId: string, userId: string): Promise<{ match: CheckersMatch; eloChange: EloChangeResult | null }> {
  const match = await getMatch(matchId);
  if (!match) throw new Error('Match not found.');
  if (match.status === 'waiting') throw new Error('Use cancel for matches that haven\'t started yet.');
  if (match.status !== 'active') throw new Error('Match is not in progress.');
  if (match.player1Id !== userId && match.player2Id !== userId) {
    throw new Error('Not a player in this match.');
  }

  const winnerId = match.player1Id === userId ? match.player2Id : match.player1Id;
  if (!winnerId) throw new Error('Opponent missing.');
  const now = Date.now();
  const winnerColor: CheckersColor | null = match.redId === winnerId ? 'red' : match.whiteId === winnerId ? 'white' : null;
  const result: GameResult = winnerColor === 'red' ? '1-0' : '0-1';

  const updated = await query(
    `UPDATE checkers_matches
     SET status = 'completed', result = $1, winner_id = $2, loser_id = $3,
         win_reason = 'resignation', completed_at = $4, updated_at = $4
     WHERE id = $5 AND status = 'active'`,
    [result, winnerId, userId, now, matchId],
  );

  if ((updated.rowCount ?? 0) === 0) {
    const current = await getMatch(matchId);
    if (!current) throw new Error('Match not found.');
    return { match: current, eloChange: null };
  }

  const finalMatch = (await getMatch(matchId))!;
  recordCheckersTerminalTime(finalMatch, userId, now);
  const eloChange = await finalizeCompletedMatch(finalMatch, {
    over: true,
    winnerColor,
    result,
    reason: 'resignation',
  });
  broadcast([`checkers:${matchId}`, 'checkersMatch'], { matchId, type: 'resigned', by: userId });
  broadcast('checkersLobby', { type: 'match_ended', matchId });
  return { match: finalMatch, eloChange };
}

export async function offerDraw(matchId: string, userId: string): Promise<CheckersMatch> {
  const match = await getMatch(matchId);
  if (!match) throw new Error('Match not found.');
  if (match.status !== 'active') throw new Error('Match is not in progress.');
  if (match.player1Id !== userId && match.player2Id !== userId) throw new Error('Not a player in this match.');

  const now = Date.now();
  const updated = await query(
    `UPDATE checkers_matches
     SET draw_offered_by = $1, draw_offered_at = $2, updated_at = $2
     WHERE id = $3 AND status = 'active'`,
    [userId, now, matchId],
  );
  if ((updated.rowCount ?? 0) === 0) throw new Error('Match is no longer active.');

  broadcast([`checkers:${matchId}`, 'checkersMatch'], { matchId, type: 'draw_offered', by: userId });
  return (await getMatch(matchId))!;
}

export async function acceptDraw(matchId: string, userId: string): Promise<{ match: CheckersMatch; eloChange: EloChangeResult | null }> {
  const match = await getMatch(matchId);
  if (!match) throw new Error('Match not found.');
  if (match.status !== 'active') throw new Error('Match is not in progress.');
  if (!match.drawOfferedBy) throw new Error('No draw offer to accept.');
  if (match.drawOfferedBy === userId) throw new Error('Cannot accept your own draw offer.');
  if (match.drawOfferedAt && Date.now() - match.drawOfferedAt > DRAW_OFFER_TTL_MS) {
    await declineDraw(matchId, userId);
    throw new Error('Draw offer has expired.');
  }
  if (match.player1Id !== userId && match.player2Id !== userId) throw new Error('Not a player in this match.');

  const now = Date.now();
  const updated = await query(
    `UPDATE checkers_matches
     SET status = 'completed', result = '1/2-1/2', winner_id = NULL,
         loser_id = NULL, win_reason = 'draw_agreement', draw_offered_by = NULL,
         draw_offered_at = NULL, completed_at = $1, updated_at = $1
     WHERE id = $2 AND status = 'active'`,
    [now, matchId],
  );

  if ((updated.rowCount ?? 0) === 0) {
    const current = await getMatch(matchId);
    if (!current) throw new Error('Match not found.');
    return { match: current, eloChange: null };
  }

  const finalMatch = (await getMatch(matchId))!;
  recordCheckersTerminalTime(finalMatch, userId, now);
  const eloChange = await finalizeCompletedMatch(finalMatch, {
    over: true,
    winnerColor: null,
    result: '1/2-1/2',
    reason: 'draw_agreement',
  });
  broadcast([`checkers:${matchId}`, 'checkersMatch'], { matchId, type: 'draw_accepted' });
  broadcast('checkersLobby', { type: 'match_ended', matchId });
  return { match: finalMatch, eloChange };
}

export async function declineDraw(matchId: string, userId: string): Promise<CheckersMatch> {
  const match = await getMatch(matchId);
  if (!match) throw new Error('Match not found.');
  if (match.player1Id !== userId && match.player2Id !== userId) throw new Error('Not a player in this match.');
  await query(
    `UPDATE checkers_matches
     SET draw_offered_by = NULL, draw_offered_at = NULL, updated_at = $1
     WHERE id = $2 AND status = 'active'`,
    [Date.now(), matchId],
  );
  broadcast([`checkers:${matchId}`, 'checkersMatch'], { matchId, type: 'draw_declined' });
  return (await getMatch(matchId))!;
}

// ---------------------------------------------------------------------------
// Finalize (Elo + Tickets + wager + stats + bot speed-run)
// ---------------------------------------------------------------------------

function outcomeFor(
  match: CheckersMatch,
  end: GameEndResult,
): { outcome: MatchOutcome | null; winnerId: string | null; loserId: string | null } {
  if (!end.over || !match.player2Id) return { outcome: null, winnerId: null, loserId: null };
  if (!match.redId || !match.whiteId) return { outcome: null, winnerId: null, loserId: null };

  if (end.winnerColor === null) {
    return { outcome: 'draw', winnerId: null, loserId: null };
  }
  const winnerId = end.winnerColor === 'red' ? match.redId : match.whiteId;
  const loserId = end.winnerColor === 'red' ? match.whiteId : match.redId;
  const outcome: MatchOutcome = winnerId === match.player1Id ? 'win_a' : 'win_b';
  return { outcome, winnerId, loserId };
}

async function finalizeCompletedMatch(match: CheckersMatch, end: GameEndResult): Promise<EloChangeResult | null> {
  if (!match.player2Id) return null;
  const isHuman1 = !match.player1Id.startsWith('bot:');
  const isHuman2 = !match.player2Id.startsWith('bot:');
  const isHumanMatch = isHuman1 && isHuman2;

  const { outcome, winnerId, loserId } = outcomeFor(match, end);

  // Stats
  if (isHumanMatch && outcome) {
    if (outcome === 'draw') {
      await updateStats(match.player1Id, match.player1Name, 'draw');
      await updateStats(match.player2Id, match.player2Name ?? 'Unknown', 'draw');
    } else {
      const resignOrTimeout = match.winReason === 'resignation';
      const loserResult = resignOrTimeout ? 'forfeit' : 'loss';
      if (winnerId && loserId) {
        await updateStats(winnerId, nameFor(match, winnerId), 'win');
        await updateStats(loserId, nameFor(match, loserId), loserResult);
      }
    }
  }

  // Elo
  let eloChange: EloChangeResult | null = null;
  if (isHumanMatch && outcome) {
    if (outcome === 'draw') {
      eloChange = await processRatedMatch(
        match.id,
        match.player1Id,
        match.player2Id,
        match.player1Name,
        match.player2Name ?? 'Unknown',
        'draw',
      );
    } else if (winnerId && loserId) {
      const tooFew = match.ply < MIN_PLY_FOR_ELO_FORFEIT && match.winReason !== 'no_moves';
      const pairForfeitCount = await countPairForfeits(winnerId, loserId, PAIR_FORFEIT_WINDOW_MS);
      const pairAbuse = pairForfeitCount >= PAIR_FORFEIT_THRESHOLD;
      if (pairAbuse) {
        eloChange = await penalizeForfeitLoserOnly(
          match.id,
          winnerId,
          loserId,
          nameFor(match, winnerId),
          nameFor(match, loserId),
        );
      } else {
        eloChange = await processRatedMatch(
          match.id,
          match.player1Id,
          match.player2Id,
          match.player1Name,
          match.player2Name ?? 'Unknown',
          outcome,
        );
      }
      if (tooFew || pairAbuse) {
        const recentForfeits = await countRecentForfeits(loserId, FORFEIT_FLAG_WINDOW_MS);
        const suspicious = tooFew || pairAbuse || recentForfeits >= FORFEIT_FLAG_THRESHOLD;
        void addAntiCheatLog({
          ts: Date.now(),
          gameType: 'chess',
          userId: loserId,
          userName: nameFor(match, loserId),
          score: 0,
          result: suspicious ? 'flag' : 'pass',
          severity: suspicious ? 'flag' : undefined,
          reason: `Early ${match.winReason} at ply ${match.ply}`,
          stage: 'forfeit',
          checks: [
            `ply:${match.ply}`,
            `pairForfeits24h:${pairForfeitCount}`,
            `userForfeits1h:${recentForfeits}`,
          ],
        });
      }
    }
  }

  // Bot speed-run record (human beats a bot)
  const isBotMatch = match.player1Id.startsWith('bot:') || match.player2Id.startsWith('bot:');
  if (isBotMatch && end.over && winnerId && loserId) {
    const botId = match.player1Id.startsWith('bot:') ? match.player1Id : match.player2Id.startsWith('bot:') ? match.player2Id : null;
    const humanWon = winnerId && !winnerId.startsWith('bot:');
    if (botId && humanWon) {
      const difficulty = botId.replace('bot:', '');
      await recordBotSpeedRun(match.id, winnerId, nameFor(match, winnerId), difficulty).catch((e) => {
        console.error('Failed to record checkers bot speed run:', e);
      });
    }
  }

  // Tickets
  const botDifficulty = isBotMatch
    ? ((match.player2Id.startsWith('bot:') ? match.player2Id : match.player1Id).replace('bot:', '') as 'easy' | 'medium' | 'hard')
    : undefined;
  if (outcome === 'draw') {
    for (const pid of [match.player1Id, match.player2Id]) {
      if (pid.startsWith('bot:')) continue;
      try {
        const context = { gameType: REWARD_GAME_TYPE, result: 'loss', vsBot: isBotMatch, botDifficulty } as const;
        const reward = await awardGameRunCredits({
          userId: pid,
          context,
          sourceId: `checkers-draw:${match.id}:${pid}`,
          meta: { matchId: match.id, winReason: match.winReason ?? 'draw_agreement', game: 'checkers' },
        });
        await recordMatchRunResult({ matchId: match.id, userId: pid, context, reward });
      } catch (error) {
        console.error('Failed to award checkers draw credits:', error);
      }
    }
  } else if (winnerId && loserId) {
    if (!winnerId.startsWith('bot:')) {
      try {
        const context = { gameType: REWARD_GAME_TYPE, result: 'win', vsBot: isBotMatch, botDifficulty } as const;
        const reward = await awardGameRunCredits({
          userId: winnerId,
          context,
          sourceId: `checkers-win:${match.id}:${winnerId}`,
          meta: { matchId: match.id, winReason: match.winReason, game: 'checkers' },
        });
        await recordMatchRunResult({ matchId: match.id, userId: winnerId, context, reward });
      } catch (error) {
        console.error('Failed to award checkers winner credits:', error);
      }
    }
    if (!loserId.startsWith('bot:')) {
      try {
        const context = { gameType: REWARD_GAME_TYPE, result: 'loss', vsBot: isBotMatch, botDifficulty } as const;
        const reward = await awardGameRunCredits({
          userId: loserId,
          context,
          sourceId: `checkers-loss:${match.id}:${loserId}`,
          meta: { matchId: match.id, winReason: match.winReason, game: 'checkers' },
        });
        await recordMatchRunResult({ matchId: match.id, userId: loserId, context, reward });
      } catch (error) {
        console.error('Failed to award checkers loser credits:', error);
      }
    }
  }

  // Wager settlement (reuses chess-wager helpers; ledger keyed per match)
  if (match.wagerAmount && match.wagerAmount > 0 && match.wagerStatus === 'held') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { settleMatchWager, refundMatchWager } = require('@/server/arcade/chess-wager') as typeof import('@/server/arcade/chess-wager');
      if (outcome === 'draw') {
        await refundMatchWager(match.id, match.player1Id, match.player2Id, match.wagerAmount);
      } else if (winnerId) {
        const earlyForfeit = match.ply < MIN_PLY_FOR_ELO_FORFEIT && match.winReason !== 'no_moves';
        if (earlyForfeit) {
          await refundMatchWager(match.id, match.player1Id, match.player2Id, match.wagerAmount);
        } else {
          await settleMatchWager(match.id, winnerId, match.wagerAmount);
        }
      }
    } catch (error) {
      console.error('Failed to settle checkers wager:', error);
    }
  }

  broadcast('gameLeaderboards', { gameType: 'checkers', updatedAt: Date.now() });
  return eloChange;
}

function nameFor(match: CheckersMatch, userId: string): string {
  if (match.player1Id === userId) return match.player1Name;
  if (match.player2Id === userId) return match.player2Name ?? 'Unknown';
  return 'Unknown';
}

async function countRecentForfeits(byUserId: string, windowMs: number): Promise<number> {
  const since = Date.now() - windowMs;
  const r = await queryOne<{ cnt: unknown }>(
    `SELECT COUNT(*) AS cnt FROM checkers_matches
     WHERE (player1_id = $1 OR player2_id = $1) AND loser_id = $1
       AND win_reason IN ('resignation', 'forfeit')
       AND completed_at > $2`,
    [byUserId, since],
  );
  return toNum(r?.cnt);
}

async function countPairForfeits(userA: string, userB: string, windowMs: number): Promise<number> {
  const since = Date.now() - windowMs;
  const r = await queryOne<{ cnt: unknown }>(
    `SELECT COUNT(*) AS cnt FROM checkers_matches
     WHERE win_reason IN ('resignation', 'forfeit')
       AND completed_at > $1
       AND (
         (player1_id = $2 AND player2_id = $3) OR
         (player1_id = $3 AND player2_id = $2)
       )`,
    [since, userA, userB],
  );
  return toNum(r?.cnt);
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

type StatResult = 'win' | 'loss' | 'forfeit' | 'draw';

async function updateStats(
  userId: string,
  userName: string,
  result: StatResult,
): Promise<void> {
  const now = Date.now();
  const existing = await queryOne<{
    wins: string | number;
    losses: string | number;
    draws: string | number;
    forfeits: string | number;
    currentStreak: string | number;
    bestStreak: string | number;
  }>(
    `SELECT wins, losses, draws, forfeits,
            current_streak AS "currentStreak", best_streak AS "bestStreak"
     FROM checkers_stats
     WHERE user_id = $1`,
    [userId],
  );

  if (!existing) {
    await query(
      `INSERT INTO checkers_stats
         (user_id, user_name, wins, losses, draws, forfeits, current_streak,
          best_streak, total_moves, kings_made, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        userId,
        userName,
        result === 'win' ? 1 : 0,
        result === 'loss' || result === 'forfeit' ? 1 : 0,
        result === 'draw' ? 1 : 0,
        result === 'forfeit' ? 1 : 0,
        result === 'win' ? 1 : 0,
        result === 'win' ? 1 : 0,
        0,
        0,
        now,
      ],
    );
    return;
  }

  const wins = toNum(existing.wins) + (result === 'win' ? 1 : 0);
  const losses = toNum(existing.losses) + (result === 'loss' || result === 'forfeit' ? 1 : 0);
  const draws = toNum(existing.draws) + (result === 'draw' ? 1 : 0);
  const forfeits = toNum(existing.forfeits) + (result === 'forfeit' ? 1 : 0);
  const currentStreak = result === 'win' ? toNum(existing.currentStreak) + 1 : 0;
  const bestStreak = Math.max(toNum(existing.bestStreak), currentStreak);

  await query(
    `UPDATE checkers_stats
     SET user_name = $1, wins = $2, losses = $3, draws = $4, forfeits = $5,
         current_streak = $6, best_streak = $7, updated_at = $8
     WHERE user_id = $9`,
    [userName, wins, losses, draws, forfeits, currentStreak, bestStreak, now, userId],
  );
}

// ---------------------------------------------------------------------------
// Spectator tracking
// ---------------------------------------------------------------------------

const spectatorMap = new Map<string, Map<string, number>>();

export function trackSpectator(matchId: string, userId: string): void {
  if (!spectatorMap.has(matchId)) spectatorMap.set(matchId, new Map());
  spectatorMap.get(matchId)!.set(userId, Date.now());
}

export function getSpectatorCount(matchId: string): number {
  const viewers = spectatorMap.get(matchId);
  if (!viewers) return 0;
  const cutoff = Date.now() - SPECTATOR_EXPIRY_MS;
  for (const [uid, lastSeen] of viewers) if (lastSeen < cutoff) viewers.delete(uid);
  if (viewers.size === 0) {
    spectatorMap.delete(matchId);
    return 0;
  }
  return viewers.size;
}

// ---------------------------------------------------------------------------
// Retention cleanup
// ---------------------------------------------------------------------------

async function listStaleMatchIds({ now, batchSize }: { now: number; batchSize: number }): Promise<string[]> {
  const waitingCutoff = now - WAITING_MATCH_RETENTION_MS;
  const finishedCutoff = now - FINISHED_MATCH_RETENTION_MS;

  const staleWaiting = await query<{ id: string }>(
    `SELECT id FROM checkers_matches WHERE status = 'waiting' AND updated_at < $1 LIMIT $2`,
    [waitingCutoff, batchSize],
  );

  const staleFinished = await query<{ id: string }>(
    `SELECT id FROM checkers_matches
     WHERE status IN ('completed', 'forfeited')
       AND COALESCE(completed_at, updated_at) < $1
     LIMIT $2`,
    [finishedCutoff, batchSize],
  );

  return Array.from(new Set([
    ...staleWaiting.rows.map((r) => r.id),
    ...staleFinished.rows.map((r) => r.id),
  ]));
}

async function deleteMatchesById(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await query('DELETE FROM checkers_moves WHERE match_id = ANY($1)', [ids]);
  await query('DELETE FROM checkers_elo_history WHERE match_id = ANY($1)', [ids]);
  await query('DELETE FROM checkers_matches WHERE id = ANY($1)', [ids]);
}

export async function maybeRunCheckersDataRetentionCleanup(): Promise<void> {
  const now = Date.now();
  if (now - lastRetentionRunAt < RETENTION_MIN_INTERVAL_MS) return;
  lastRetentionRunAt = now;
  try {
    const stale = await listStaleMatchIds({ now, batchSize: RETENTION_BATCH_SIZE });
    await deleteMatchesById(stale);
  } catch (error) {
    console.error('Checkers retention cleanup failed', error);
  }
}

// ---------------------------------------------------------------------------
// Bot reply — async worker + crash/restart recovery
// ---------------------------------------------------------------------------

const botJobs = new Set<string>();

/** Fire-and-forget: compute the bot's move and submit it. */
export async function runBotReply(matchId: string): Promise<void> {
  if (botJobs.has(matchId)) return;
  botJobs.add(matchId);
  try {
    const match = await getMatch(matchId);
    if (!match || match.status !== 'active') return;
    if (!isBotUser(match.currentTurn)) return;
    const difficulty = match.currentTurn.replace('bot:', '') as BotDifficulty;
    const botColor = colorForPlayer(match, match.currentTurn);
    if (!botColor) return;
    const botMove = await computeBotMove(match.board, difficulty, botColor);
    await submitMove(matchId, match.currentTurn, botMove);
  } catch (err) {
    console.error('Bot move failed:', err);
  } finally {
    botJobs.delete(matchId);
  }
}

/** Re-trigger bot replies for any active match where it's a bot's turn but no
 *  in-process job is running (crash/dev-restart recovery). Throttled. */
const BOT_RESUME_INTERVAL_MS = 3_000;
let lastBotResumeAt = 0;
export async function resumeOrphanedBotTurns(): Promise<number> {
  const now = Date.now();
  if (now - lastBotResumeAt < BOT_RESUME_INTERVAL_MS) return 0;
  lastBotResumeAt = now;
  const result = await query<CheckersMatchRow>(
    `SELECT ${MATCH_SELECT} FROM checkers_matches WHERE status = 'active'`,
  );
  let kicked = 0;
  for (const row of result.rows) {
    const match = rowToMatch(row);
    if (!isBotUser(match.currentTurn)) continue;
    if (botJobs.has(match.id)) continue;
    void runBotReply(match.id);
    kicked++;
  }
  return kicked;
}

// Re-export legalMoves for any route that wants to surface move hints.
export { legalMoves };
