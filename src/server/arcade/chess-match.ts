// ---------------------------------------------------------------------------
// Chess match management (CRUD + state transitions + clock arithmetic).
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { query, queryOne } from '@/server/db/client';
import { broadcast } from '@/server/events';
import {
  applyUciMove,
  detectGameEnd,
  hasMatingMaterialFor,
  STARTING_FEN,
  colorForPlayer,
  type GameEndResult,
} from '@/features/arcade/lib/chess';
import {
  computeBotMove,
  isBotUser,
  type BotDifficulty,
} from '@/server/arcade/chess-bot';
import {
  resolveTimeFormat,
  type ChessColor,
  type ChessMatch,
  type GameResult,
  type MatchStatus,
  type WinReason,
} from '@/features/arcade/lib/chess/types';
import {
  processRatedMatch,
  penalizeForfeitLoserOnly,
  type EloChangeResult,
  type MatchOutcome,
} from '@/server/arcade/chess-elo';
import { awardGameRunCredits } from '@/server/arcade/rewards/wallet';
import { recordMatchRunResult } from '@/server/arcade/match-run-results';
import { recordGameTimeMetric } from '@/server/arcade/game-time-metrics';
import { addAntiCheatLog } from '@/server/arcade/anti-cheat-logs';
import { clearChessChallengeDenials } from '@/server/arcade/chess-challenge-limits';
import { notifyChessMatchCompleted } from '@/server/arcade/chess-match-completion-events';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHESS_MATCH_LIST_LIMIT = 50;
const MAX_RECORDED_MOVE_MS = 60 * 60 * 1000; // cap per-move recorded time at 1h
const WAITING_MATCH_RETENTION_MS = 14 * 24 * 60 * 60 * 1000; // 14d
const FINISHED_MATCH_RETENTION_MS = 120 * 24 * 60 * 60 * 1000; // 120d
const RETENTION_MIN_INTERVAL_MS = 60 * 60 * 1000; // 1h
const RETENTION_BATCH_SIZE = 200;

const LIVE_MATCH_STALENESS_MS = 5 * 60 * 1000;
const MIN_PLY_FOR_ELO_FORFEIT = 4; // don't award Elo on instant resigns
const PAIR_FORFEIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const PAIR_FORFEIT_THRESHOLD = 2;
const FORFEIT_FLAG_WINDOW_MS = 60 * 60 * 1000;
const FORFEIT_FLAG_THRESHOLD = 3;

const SPECTATOR_EXPIRY_MS = 30_000;
const DRAW_OFFER_TTL_MS = 120_000; // 2 minute expiry on draw offers

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
  white_id AS "whiteId",
  black_id AS "blackId",
  status,
  current_turn AS "currentTurn",
  time_format AS "timeFormat",
  initial_time_ms AS "initialTimeMs",
  increment_ms AS "incrementMs",
  white_time_ms AS "whiteTimeMs",
  black_time_ms AS "blackTimeMs",
  last_move_at AS "lastMoveAt",
  fen,
  ply,
  move_count AS "moveCount",
  last_move_uci AS "lastMoveUci",
  last_move_san AS "lastMoveSan",
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

type ChessMatchRow = {
  id: string;
  player1Id: string;
  player1Name: string;
  invitedUserId: string | null;
  player2Id: string | null;
  player2Name: string | null;
  whiteId: string | null;
  blackId: string | null;
  status: string;
  currentTurn: string;
  timeFormat: string;
  initialTimeMs: string | number;
  incrementMs: string | number;
  whiteTimeMs: string | number;
  blackTimeMs: string | number;
  lastMoveAt: string | number | null;
  fen: string;
  ply: string | number;
  moveCount: string | number;
  lastMoveUci: string | null;
  lastMoveSan: string | null;
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

function rowToMatch(row: ChessMatchRow): ChessMatch {
  return {
    id: row.id,
    player1Id: row.player1Id,
    player1Name: row.player1Name,
    invitedUserId: row.invitedUserId ?? null,
    player2Id: row.player2Id ?? null,
    player2Name: row.player2Name ?? null,
    whiteId: row.whiteId ?? null,
    blackId: row.blackId ?? null,
    status: row.status as MatchStatus,
    currentTurn: row.currentTurn,
    timeFormat: row.timeFormat,
    initialTimeMs: toNum(row.initialTimeMs),
    incrementMs: toNum(row.incrementMs),
    whiteTimeMs: toNum(row.whiteTimeMs),
    blackTimeMs: toNum(row.blackTimeMs),
    lastMoveAt: toNumOrNull(row.lastMoveAt),
    fen: row.fen,
    ply: toNum(row.ply),
    moveCount: toNum(row.moveCount),
    lastMoveUci: row.lastMoveUci ?? null,
    lastMoveSan: row.lastMoveSan ?? null,
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
// Clock arithmetic
// ---------------------------------------------------------------------------

/** True when either side of this match is a bot — bot games run without a clock. */
function isBotMatch(match: ChessMatch): boolean {
  return (
    match.player1Id.startsWith('bot:')
    || (match.player2Id?.startsWith('bot:') ?? false)
  );
}

/** Compute the remaining time for the player to move, given the match state and now. */
export function effectiveRemainingMs(match: ChessMatch, now = Date.now()): {
  whiteMs: number;
  blackMs: number;
} {
  // Bot matches have no timer — always report the stored values without
  // deducting elapsed time so the clock never ticks down or flags.
  if (isBotMatch(match)) {
    return { whiteMs: match.whiteTimeMs, blackMs: match.blackTimeMs };
  }
  const sideToMove = match.currentTurn === match.whiteId ? 'white' : match.currentTurn === match.blackId ? 'black' : null;
  if (match.status !== 'active' || !match.lastMoveAt || !sideToMove) {
    return { whiteMs: match.whiteTimeMs, blackMs: match.blackTimeMs };
  }
  // Don't run either clock until the first full move (white + black) is complete.
  // Both players get to make their opening move without time pressure.
  if (match.ply < 2) {
    return { whiteMs: match.whiteTimeMs, blackMs: match.blackTimeMs };
  }
  const elapsed = Math.max(0, now - match.lastMoveAt);
  if (sideToMove === 'white') {
    return { whiteMs: Math.max(0, match.whiteTimeMs - elapsed), blackMs: match.blackTimeMs };
  }
  return { whiteMs: match.whiteTimeMs, blackMs: Math.max(0, match.blackTimeMs - elapsed) };
}

/** Returns true if the player on the move has flagged (out of time). */
function isFlagged(match: ChessMatch, now = Date.now()): boolean {
  if (match.status !== 'active' || !match.lastMoveAt) return false;
  // Bot matches are untimed, so no side ever flags.
  if (isBotMatch(match)) return false;
  const rem = effectiveRemainingMs(match, now);
  const sideToMove = match.currentTurn === match.whiteId ? 'white' : 'black';
  return sideToMove === 'white' ? rem.whiteMs <= 0 : rem.blackMs <= 0;
}

// ---------------------------------------------------------------------------
// Create / Join / Cancel
// ---------------------------------------------------------------------------

export type CreateMatchOptions = {
  invitedUserId?: string | null;
  tournamentMatchId?: string | null;
  wagerAmount?: number | null;
  timeFormatId?: string;
  preferredColor?: ChessColor | 'random';
};

/** Create a new chess match. Colors are assigned when an opponent joins. */
export async function createMatch(
  userId: string,
  userName: string,
  options?: CreateMatchOptions,
): Promise<ChessMatch> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const preset = resolveTimeFormat(options?.timeFormatId);

  // If preferredColor is white/black, pre-assign it so it's respected on join.
  const preAssignedWhite = options?.preferredColor === 'white' ? userId : null;
  const preAssignedBlack = options?.preferredColor === 'black' ? userId : null;

  const match: ChessMatch = {
    id,
    player1Id: userId,
    player1Name: userName,
    invitedUserId: options?.invitedUserId ?? null,
    player2Id: null,
    player2Name: null,
    whiteId: preAssignedWhite,
    blackId: preAssignedBlack,
    status: 'waiting',
    currentTurn: userId,
    timeFormat: preset.id,
    initialTimeMs: preset.initialTimeMs,
    incrementMs: preset.incrementMs,
    whiteTimeMs: preset.initialTimeMs,
    blackTimeMs: preset.initialTimeMs,
    lastMoveAt: null,
    fen: STARTING_FEN,
    ply: 0,
    moveCount: 0,
    lastMoveUci: null,
    lastMoveSan: null,
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
    `INSERT INTO chess_matches
       (id, player1_id, player1_name, invited_user_id, player2_id, player2_name,
        white_id, black_id, status, current_turn, time_format, initial_time_ms,
        increment_ms, white_time_ms, black_time_ms, last_move_at, fen, ply,
        move_count, last_move_uci, last_move_san, draw_offered_by, draw_offered_at,
        result, winner_id, loser_id, win_reason, tournament_match_id,
        wager_amount, wager_status, created_at, updated_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
             $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28,
             $29, $30, $31, $32, $33)`,
    [
      match.id, match.player1Id, match.player1Name, match.invitedUserId,
      match.player2Id, match.player2Name, match.whiteId, match.blackId,
      match.status, match.currentTurn, match.timeFormat, match.initialTimeMs,
      match.incrementMs, match.whiteTimeMs, match.blackTimeMs, match.lastMoveAt,
      match.fen, match.ply, match.moveCount, match.lastMoveUci, match.lastMoveSan,
      match.drawOfferedBy, match.drawOfferedAt, match.result, match.winnerId,
      match.loserId, match.winReason, match.tournamentMatchId, match.wagerAmount,
      match.wagerStatus, match.createdAt, match.updatedAt, match.completedAt,
    ],
  );
  broadcast('chessLobby', { type: 'match_created', matchId: id });
  // Direct challenges (including rematches) get a targeted broadcast so the
  // invited player's open pages — specifically the previous match's postgame
  // overlay — can surface a rematch invite without waiting for a reload.
  if (options?.invitedUserId) {
    broadcast('chessChallenge', {
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
  await query('DELETE FROM chess_matches WHERE id = $1', [matchId]);
}

export async function cancelWaitingMatch(matchId: string, userId: string): Promise<void> {
  const row = await getMatch(matchId);
  if (!row) throw new Error('Match not found.');
  if (row.player1Id !== userId) throw new Error('Only the creator can cancel this match.');
  if (row.status !== 'waiting') throw new Error('Only waiting matches can be cancelled.');

  // Delete with CAS on status='waiting'. Without it, a race between cancel
  // and a successful join would let the unconditional delete wipe the now-
  // active match (and issue a phantom refund).
  const deleted = await query(
    `DELETE FROM chess_matches WHERE id = $1 AND status = 'waiting'`,
    [matchId],
  );
  if ((deleted.rowCount ?? 0) === 0) {
    throw new Error('Match is no longer cancellable — it may have been joined.');
  }

  // Refund player1 if a wager was held on create. Only fires once the
  // delete actually took effect so a lost race can't issue a stray refund.
  // Status may be either 'pending_accept' (challenge created but hold
  // hasn't completed yet) or 'p1_held' (hold succeeded) — both are
  // recoverable to the creator. The ledger is idempotent on sourceId, so
  // a no-op hold → refund sequence is safe.
  if (row.wagerAmount && row.wagerAmount > 0 && row.wagerStatus !== 'held' && row.wagerStatus !== 'paid' && row.wagerStatus !== 'refunded') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { mutateWalletAndLedgerTx } = require('@/server/arcade/rewards/helpers') as typeof import('@/server/arcade/rewards/helpers');
      await mutateWalletAndLedgerTx({
        userId: row.player1Id,
        currencyType: 'credits',
        amount: row.wagerAmount,
        sourceType: 'wager_refund',
        sourceId: `chess-wager-refund:${matchId}:${row.player1Id}`,
        meta: { matchId, reason: 'cancelled', gameType: 'chess' },
      });
    } catch (error) {
      console.error('Failed to refund wager on cancel:', error);
    }
  }

  broadcast('chessLobby', { type: 'match_cancelled', matchId });
}

/** Join an open match. Uses atomic conditional UPDATE. */
export async function joinMatch(
  matchId: string,
  userId: string,
  userName: string,
): Promise<ChessMatch> {
  const row = await getMatch(matchId);
  if (!row) throw new Error('Match not found.');
  if (row.status !== 'waiting') throw new Error('Match is not open.');
  if (row.player1Id === userId) throw new Error('Cannot join your own match.');
  if (row.invitedUserId && row.invitedUserId !== userId) {
    throw new Error('This match is reserved for another player.');
  }
  if (row.player2Id) throw new Error('Match is already full.');

  const now = Date.now();

  // Resolve colors: if creator preferred a side it's already set; fill the other.
  let whiteId = row.whiteId;
  let blackId = row.blackId;
  if (whiteId && !blackId) blackId = userId;
  else if (blackId && !whiteId) whiteId = userId;
  else {
    // Random assignment
    if (Math.random() < 0.5) {
      whiteId = row.player1Id;
      blackId = userId;
    } else {
      whiteId = userId;
      blackId = row.player1Id;
    }
  }

  const result = await query(
    `UPDATE chess_matches
     SET player2_id = $1, player2_name = $2, invited_user_id = NULL,
         white_id = $3, black_id = $4, status = 'active', current_turn = $5,
         last_move_at = $6, updated_at = $6
     WHERE id = $7
       AND status = 'waiting'
       AND (invited_user_id IS NULL OR invited_user_id = $1)
       AND player2_id IS NULL`,
    [userId, userName, whiteId, blackId, whiteId /* white moves first */, now, matchId],
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new Error('Match was already claimed by another player.');
  }

  // Hold wager Tickets for player 2
  if (row.wagerAmount && row.wagerAmount > 0) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { holdMatchWager } = require('@/server/arcade/chess-wager') as typeof import('@/server/arcade/chess-wager');
      await holdMatchWager(matchId, row.player1Id, userId, row.wagerAmount);
      await query(
        `UPDATE chess_matches SET wager_status = 'held' WHERE id = $1`,
        [matchId],
      );
    } catch (error) {
      // Rollback on wager failure
      await query(
        `UPDATE chess_matches
         SET player2_id = NULL, player2_name = NULL, white_id = $1, black_id = $2,
             invited_user_id = $3, status = 'waiting', current_turn = $4,
             last_move_at = NULL, updated_at = $5
         WHERE id = $6`,
        [row.whiteId, row.blackId, row.invitedUserId, row.player1Id, Date.now(), matchId],
      );
      const message = (error as Error).message?.includes('Insufficient')
        ? 'Insufficient Tickets to accept this wager.'
        : 'Failed to hold wager Tickets.';
      throw new Error(message);
    }
  }

  if (row.invitedUserId === userId) {
    await clearChessChallengeDenials({ senderUserId: row.player1Id, targetUserId: userId });
  }

  const updated = await getMatch(matchId);
  broadcast('chessLobby', { type: 'match_joined', matchId });
  broadcast([`chess:${matchId}`, 'chessMatch'], { matchId, type: 'opponent_joined', userId, userName });
  return updated!;
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

export async function getMatch(matchId: string): Promise<ChessMatch | null> {
  const row = await queryOne<ChessMatchRow>(
    `SELECT ${MATCH_SELECT} FROM chess_matches WHERE id = $1`,
    [matchId],
  );
  return row ? rowToMatch(row) : null;
}

async function getRecentClearCutoffForUser(userId: string): Promise<number | null> {
  const row = await queryOne<{ clearedBeforeTs: string | number }>(
    `SELECT cleared_before_ts AS "clearedBeforeTs"
     FROM chess_recent_match_clears
     WHERE user_id = $1`,
    [userId],
  );
  return row ? toNum(row.clearedBeforeTs) : null;
}

export async function getMatchesForUser(userId: string): Promise<ChessMatch[]> {
  const clearedBeforeTs = await getRecentClearCutoffForUser(userId);
  const result = await query<ChessMatchRow>(
    `SELECT ${MATCH_SELECT} FROM chess_matches
     WHERE player1_id = $1
        OR player2_id = $1
        OR (status = 'waiting' AND invited_user_id = $1)
     ORDER BY updated_at DESC
     LIMIT $2`,
    [userId, CHESS_MATCH_LIST_LIMIT * 4],
  );

  return result.rows
    .map(rowToMatch)
    .filter((m) => {
      if (clearedBeforeTs === null) return true;
      const isHistory = m.status === 'completed' || m.status === 'forfeited';
      if (!isHistory) return true;
      return (m.completedAt ?? m.updatedAt) > clearedBeforeTs;
    })
    .slice(0, CHESS_MATCH_LIST_LIMIT);
}

export async function getOpenMatches(excludeUserId: string): Promise<ChessMatch[]> {
  const result = await query<ChessMatchRow>(
    `SELECT ${MATCH_SELECT} FROM chess_matches
     WHERE status = 'waiting' AND invited_user_id IS NULL
     ORDER BY created_at DESC
     LIMIT 20`,
  );
  return result.rows.filter((r) => r.player1Id !== excludeUserId).map(rowToMatch);
}

export function isMatchSpectatable(match: ChessMatch): boolean {
  if (match.status !== 'active') return false;
  if (!match.player2Id) return false;
  if (match.tournamentMatchId) return true;
  return !match.player2Id.startsWith('bot:');
}

export async function getActiveSpectatableMatches(): Promise<Array<ChessMatch & { spectatorCount: number }>> {
  const cutoff = Date.now() - LIVE_MATCH_STALENESS_MS;
  const result = await query<ChessMatchRow>(
    `SELECT ${MATCH_SELECT} FROM chess_matches
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
    `INSERT INTO chess_recent_match_clears (user_id, cleared_before_ts, updated_at)
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
// ---------------------------------------------------------------------------

export type SubmitMoveResult = {
  ok: true;
  match: ChessMatch;
  san: string;
  fenAfter: string;
  end: GameEndResult;
  elapsedMs: number;
  eloChange: EloChangeResult | null;
};

/**
 * Submit a UCI move. Server validates legality, applies clock arithmetic, then
 * runs terminal-position detection. Uses CAS on ply to prevent double-apply.
 */
export async function submitMove(
  matchId: string,
  userId: string,
  uci: string,
): Promise<SubmitMoveResult> {
  const match = await getMatch(matchId);
  if (!match) throw new Error('Match not found.');
  if (match.status !== 'active') throw new Error('Match is not in progress.');
  if (match.currentTurn !== userId) throw new Error('Not your turn.');

  // Flag-fall — if the mover's time is already gone, resolve as timeout instead.
  if (isFlagged(match)) {
    await applyTimeoutResolution(matchId);
    throw new Error('Your time has expired.');
  }

  // Validate + apply move against the FEN (chess.js throws on illegal).
  const applied = applyUciMove(match.fen, uci);

  const now = Date.now();
  const moverColor = colorForPlayer(match, userId);
  if (!moverColor) throw new Error('You are not a player in this match.');
  if (!match.whiteId || !match.blackId) throw new Error('Opponent has not joined yet.');

  // Clock update: deduct elapsed since lastMoveAt, add increment, swap turns.
  // Exception: during the first full move (white's move 1 and black's move 1)
  // the clock is paused so a player joining doesn't immediately bleed time.
  const clockRunning = match.ply >= 2;
  const elapsed = clockRunning && match.lastMoveAt ? Math.max(0, now - match.lastMoveAt) : 0;
  const moveDurationMs = Math.min(elapsed, MAX_RECORDED_MOVE_MS);

  let newWhiteMs = match.whiteTimeMs;
  let newBlackMs = match.blackTimeMs;
  if (clockRunning) {
    if (moverColor === 'white') {
      newWhiteMs = Math.max(0, match.whiteTimeMs - elapsed) + match.incrementMs;
    } else {
      newBlackMs = Math.max(0, match.blackTimeMs - elapsed) + match.incrementMs;
    }
  }

  const nextTurn = moverColor === 'white' ? match.blackId : match.whiteId;
  const ply = match.ply + 1;
  // Display move number (1. e4, 1... e5, 2. Nf3, ...), not completed full turns.
  const moveCount = Math.ceil(ply / 2);

  // Terminal detection based on post-move FEN. Threefold repetition needs
  // the full move history to fire, so replay UCIs from the chess_moves log
  // (plus this new UCI) and hand them to detectGameEnd.
  const priorMoves = await query<{ uci: string }>(
    `SELECT uci FROM chess_moves WHERE match_id = $1 ORDER BY ply ASC`,
    [matchId],
  );
  const fullHistory = [...priorMoves.rows.map((m) => m.uci), applied.uci];
  const end: GameEndResult = detectGameEnd(applied.fenAfter, fullHistory);

  // Timeout detection post-move: if opponent already has 0 ms they immediately
  // flag on their turn. This mostly won't fire here because we just incremented.
  let winnerId: string | null = null;
  let loserId: string | null = null;
  let result: GameResult | null = null;
  let winReason: WinReason | null = null;
  let nextStatus: MatchStatus = 'active';

  if (end.over) {
    nextStatus = 'completed';
    result = end.result;
    winReason = end.reason;
    if (end.winnerColor === 'white') {
      winnerId = match.whiteId;
      loserId = match.blackId;
    } else if (end.winnerColor === 'black') {
      winnerId = match.blackId;
      loserId = match.whiteId;
    }
  }

  // Apply with CAS on ply to prevent double-apply on concurrent requests.
  const res = await query(
    `UPDATE chess_matches
     SET fen = $1, ply = $2, move_count = $3, current_turn = $4,
         last_move_uci = $5, last_move_san = $6, white_time_ms = $7,
         black_time_ms = $8, last_move_at = $9, draw_offered_by = NULL,
         draw_offered_at = NULL, status = $10, result = $11, winner_id = $12,
         loser_id = $13, win_reason = $14, completed_at = $15, updated_at = $16
     WHERE id = $17 AND ply = $18 AND status = 'active'`,
    [
      applied.fenAfter, ply, moveCount, nextTurn, uci, applied.san,
      newWhiteMs, newBlackMs, now, nextStatus, result, winnerId, loserId,
      winReason, nextStatus === 'completed' ? now : null, now, matchId, match.ply,
    ],
  );

  if ((res.rowCount ?? 0) === 0) {
    throw new Error('Move was already processed (concurrent request).');
  }

  // Record move
  await query(
    `INSERT INTO chess_moves
       (id, match_id, player_id, move_number, ply, uci, san, fen_after,
        clock_remaining_ms, move_duration_ms, eval_centipawns, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      crypto.randomUUID(), matchId, userId, Math.ceil(ply / 2), ply, uci,
      applied.san, applied.fenAfter,
      moverColor === 'white' ? newWhiteMs : newBlackMs,
      moveDurationMs, null, now,
    ],
  );

  // Record game-time metric (active play only)
  if (!userId.startsWith('bot:')) {
    void recordGameTimeMetric({
      userId,
      gameType: 'chess',
      durationMs: moveDurationMs,
      playedAtMs: now,
    }).catch((error) => {
      console.error('Failed to record chess move time:', error);
    });
  }

  // Post-game bookkeeping
  let eloChange: EloChangeResult | null = null;
  const updatedMatch = (await getMatch(matchId))!;

  if (nextStatus === 'completed') {
    eloChange = await finalizeCompletedMatch(updatedMatch, end);
  }

  broadcast([`chess:${matchId}`, 'chessMatch'], {
    matchId,
    type: 'move',
    moverId: userId,
    uci,
    san: applied.san,
    ply,
    gameOver: nextStatus === 'completed',
    winnerId,
    winReason,
  });

  return {
    ok: true,
    match: updatedMatch,
    san: applied.san,
    fenAfter: applied.fenAfter,
    end,
    elapsedMs: moveDurationMs,
    eloChange,
  };
}

// ---------------------------------------------------------------------------
// Timeout / resign / draw resolution
// ---------------------------------------------------------------------------

/**
 * Ticket a player with active-play time for a non-move terminal action
 * (resignation, timeout, draw acceptance). Chess normally records game time
 * per move via `moveDurationMs`, but terminal actions that skip move
 * submission would otherwise discard the thinking time the player spent on
 * the final turn. Bots are excluded and the duration is capped at
 * `MAX_RECORDED_MOVE_MS` to match move-path behavior.
 */
function recordChessTerminalTime(
  match: ChessMatch,
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
    gameType: 'chess',
    durationMs,
    playedAtMs: now,
  }).catch((error) => {
    console.error('Failed to record chess terminal time:', error);
  });
}

/** If the mover's clock has expired, resolve as a timeout win for the opponent. */
export async function applyTimeoutResolution(matchId: string): Promise<ChessMatch | null> {
  const match = await getMatch(matchId);
  if (!match || match.status !== 'active') return null;
  if (!isFlagged(match)) return null;
  if (!match.whiteId || !match.blackId) return null;

  const moverColor = match.currentTurn === match.whiteId ? 'white' : 'black';
  const winnerColor: ChessColor = moverColor === 'white' ? 'black' : 'white';
  const winnerId = winnerColor === 'white' ? match.whiteId : match.blackId;
  const loserId = winnerColor === 'white' ? match.blackId : match.whiteId;
  const now = Date.now();

  // FIDE 6.9: the flagging side only loses if the opponent can still
  // possibly deliver mate with the material remaining. A lone king, K+N,
  // K+B, or 2 same-color bishops opposite isn't enough — draw instead.
  // `detectGameEnd(fen)`'s `insufficient_material` branch is stricter
  // (both sides' material together), which was mis-scoring timeouts
  // like `7k/8/8/8/8/8/8/KQ6 w - - 0 1` as a black win instead of a draw.
  const winnerCanMate = hasMatingMaterialFor(match.fen, winnerColor);
  const drawByInsufficient = !winnerCanMate;

  const result: GameResult = drawByInsufficient
    ? '1/2-1/2'
    : winnerColor === 'white' ? '1-0' : '0-1';
  const reason: WinReason = drawByInsufficient ? 'insufficient_material' : 'timeout';

  // CAS on status to avoid double-applying.
  const updated = await query(
    `UPDATE chess_matches
     SET status = 'completed', result = $1, winner_id = $2, loser_id = $3,
         win_reason = $4, white_time_ms = $5, black_time_ms = $6,
         completed_at = $7, updated_at = $7
     WHERE id = $8 AND status = 'active'`,
    [
      result,
      drawByInsufficient ? null : winnerId,
      drawByInsufficient ? null : loserId,
      reason,
      moverColor === 'white' ? 0 : match.whiteTimeMs,
      moverColor === 'black' ? 0 : match.blackTimeMs,
      now,
      matchId,
    ],
  );

  if ((updated.rowCount ?? 0) === 0) return getMatch(matchId);

  const finalMatch = (await getMatch(matchId))!;
  // The flagging side used real time on their clock; Ticket them for it so
  // timeouts don't silently zero-out a long final think.
  recordChessTerminalTime(finalMatch, match.currentTurn ?? '', now);
  await finalizeCompletedMatch(finalMatch, {
    over: true,
    winnerColor: drawByInsufficient ? null : winnerColor,
    result,
    reason,
  });
  broadcast([`chess:${matchId}`, 'chessMatch'], { matchId, type: 'timeout', loserId, winnerId: drawByInsufficient ? null : winnerId });
  broadcast('chessLobby', { type: 'match_ended', matchId });
  return finalMatch;
}

/**
 * Scan active matches for flag-fall and close them. Called on the lobby poll
 * as a safety net in case no client has read a specific match in a while.
 *
 * Throttled to at most once every `TIMEOUT_SCAN_INTERVAL_MS` across all
 * callers — every lobby load (from every user) otherwise triggers a full
 * active-match scan, which is wasteful on a table scan that's the same for
 * all requesters. Flag-fall precision to within a few seconds is fine since
 * the client-side clock resolves most timeouts well before this watchdog.
 */
const TIMEOUT_SCAN_INTERVAL_MS = 2_000;
let lastTimeoutScanAt = 0;
export async function processTimedOutMatches(): Promise<number> {
  const now = Date.now();
  if (now - lastTimeoutScanAt < TIMEOUT_SCAN_INTERVAL_MS) return 0;
  lastTimeoutScanAt = now;
  const result = await query<ChessMatchRow>(
    `SELECT ${MATCH_SELECT} FROM chess_matches WHERE status = 'active'`,
  );
  let closed = 0;
  for (const row of result.rows) {
    const m = rowToMatch(row);
    if (!m.lastMoveAt || !m.whiteId || !m.blackId) continue;
    // Bot matches have no timer — skip the flag-fall check entirely.
    if (isBotMatch(m)) continue;
    // Clock isn't running until both sides have made their first move.
    if (m.ply < 2) continue;
    const elapsed = now - m.lastMoveAt;
    const moverColor = m.currentTurn === m.whiteId ? 'white' : 'black';
    const remaining = moverColor === 'white' ? m.whiteTimeMs : m.blackTimeMs;
    if (remaining - elapsed <= 0) {
      try {
        await applyTimeoutResolution(m.id);
        closed++;
      } catch { /* ignore */ }
    }
  }
  return closed;
}

/** Resign the match as userId. Returns the final match + Elo change. */
export async function resignMatch(matchId: string, userId: string): Promise<{ match: ChessMatch; eloChange: EloChangeResult | null }> {
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
  const winnerColor: ChessColor | null = match.whiteId === winnerId ? 'white' : match.blackId === winnerId ? 'black' : null;
  const result: GameResult = winnerColor === 'white' ? '1-0' : '0-1';

  // CAS on status = 'active' so concurrent resign/timeout/draw-accept calls
  // can't each run finalize and double-apply Elo / stats.
  const updated = await query(
    `UPDATE chess_matches
     SET status = 'completed', result = $1, winner_id = $2, loser_id = $3,
         win_reason = 'resignation', completed_at = $4, updated_at = $4
     WHERE id = $5 AND status = 'active'`,
    [result, winnerId, userId, now, matchId],
  );

  if ((updated.rowCount ?? 0) === 0) {
    // Someone else already finalized the match. Return the current snapshot
    // without re-running finalize.
    const current = await getMatch(matchId);
    if (!current) throw new Error('Match not found.');
    return { match: current, eloChange: null };
  }

  const finalMatch = (await getMatch(matchId))!;
  // Ticket the resigner for the time they spent on the final think before
  // resigning — move-path time tracking would otherwise skip it.
  recordChessTerminalTime(finalMatch, userId, now);
  const eloChange = await finalizeCompletedMatch(finalMatch, {
    over: true,
    winnerColor,
    result,
    reason: 'resignation',
  });
  broadcast([`chess:${matchId}`, 'chessMatch'], { matchId, type: 'resigned', by: userId });
  broadcast('chessLobby', { type: 'match_ended', matchId });
  return { match: finalMatch, eloChange };
}

export async function offerDraw(matchId: string, userId: string): Promise<ChessMatch> {
  const match = await getMatch(matchId);
  if (!match) throw new Error('Match not found.');
  if (match.status !== 'active') throw new Error('Match is not in progress.');
  if (match.player1Id !== userId && match.player2Id !== userId) throw new Error('Not a player in this match.');

  const now = Date.now();
  // CAS on status='active' — don't stamp a draw offer onto a row that
  // finalized between the read and the write.
  const updated = await query(
    `UPDATE chess_matches
     SET draw_offered_by = $1, draw_offered_at = $2, updated_at = $2
     WHERE id = $3 AND status = 'active'`,
    [userId, now, matchId],
  );
  if ((updated.rowCount ?? 0) === 0) {
    throw new Error('Match is no longer active.');
  }

  broadcast([`chess:${matchId}`, 'chessMatch'], { matchId, type: 'draw_offered', by: userId });
  return (await getMatch(matchId))!;
}

export async function acceptDraw(matchId: string, userId: string): Promise<{ match: ChessMatch; eloChange: EloChangeResult | null }> {
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
    `UPDATE chess_matches
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
  // Ticket the acceptor for the time they spent on the turn before accepting
  // the draw — same reasoning as resignation.
  recordChessTerminalTime(finalMatch, userId, now);
  const eloChange = await finalizeCompletedMatch(finalMatch, {
    over: true,
    winnerColor: null,
    result: '1/2-1/2',
    reason: 'draw_agreement',
  });
  broadcast([`chess:${matchId}`, 'chessMatch'], { matchId, type: 'draw_accepted' });
  broadcast('chessLobby', { type: 'match_ended', matchId });
  return { match: finalMatch, eloChange };
}

export async function declineDraw(matchId: string, userId: string): Promise<ChessMatch> {
  const match = await getMatch(matchId);
  if (!match) throw new Error('Match not found.');
  if (match.player1Id !== userId && match.player2Id !== userId) throw new Error('Not a player in this match.');
  // CAS on status='active' — a completed row shouldn't have its draw-offer
  // state cleared out from under spectator/replay views.
  await query(
    `UPDATE chess_matches
     SET draw_offered_by = NULL, draw_offered_at = NULL, updated_at = $1
     WHERE id = $2 AND status = 'active'`,
    [Date.now(), matchId],
  );
  broadcast([`chess:${matchId}`, 'chessMatch'], { matchId, type: 'draw_declined' });
  return (await getMatch(matchId))!;
}

// ---------------------------------------------------------------------------
// Finalize (Elo + Tickets + wager + stats + tournament)
// ---------------------------------------------------------------------------

function outcomeFor(
  match: ChessMatch,
  end: GameEndResult,
): { outcome: MatchOutcome | null; winnerId: string | null; loserId: string | null } {
  if (!end.over || !match.player2Id) return { outcome: null, winnerId: null, loserId: null };
  if (!match.whiteId || !match.blackId) return { outcome: null, winnerId: null, loserId: null };

  if (end.winnerColor === null) {
    // Draw — arbitrarily treat player1 as playerA.
    return { outcome: 'draw', winnerId: null, loserId: null };
  }
  const winnerId = end.winnerColor === 'white' ? match.whiteId : match.blackId;
  const loserId = end.winnerColor === 'white' ? match.blackId : match.whiteId;
  // win_a = player1 is winner; win_b = player2 is winner.
  const outcome: MatchOutcome = winnerId === match.player1Id ? 'win_a' : 'win_b';
  return { outcome, winnerId, loserId };
}

async function finalizeCompletedMatch(match: ChessMatch, end: GameEndResult): Promise<EloChangeResult | null> {
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
      const resignOrTimeout = match.winReason === 'resignation' || match.winReason === 'timeout';
      const loserResult = resignOrTimeout ? 'forfeit' : 'loss';
      if (winnerId && loserId) {
        await updateStats(winnerId, nameFor(match, winnerId), 'win', {
          isCheckmate: match.winReason === 'checkmate',
        });
        await updateStats(loserId, nameFor(match, loserId), loserResult, {
          isTimeout: match.winReason === 'timeout',
        });
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
      const tooFew = match.ply < MIN_PLY_FOR_ELO_FORFEIT && match.winReason !== 'checkmate';
      const pairForfeitCount = await countPairForfeits(winnerId, loserId, PAIR_FORFEIT_WINDOW_MS);
      const pairAbuse = pairForfeitCount >= PAIR_FORFEIT_THRESHOLD;
      // Only withhold the winner's ELO + win Ticket when we detect
      // pair-farming (same two players repeatedly forfeiting to each other).
      // Early resigns on their own happen for legitimate reasons — bad
      // opener, misclick, seeing a forced mate — and the winner should
      // still get full Ticket. `tooFew` is kept purely as an anti-cheat
      // signal (logged below), not as a rating penalty gate.
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

  // Tickets
  const isBotMatch = match.player1Id.startsWith('bot:') || match.player2Id.startsWith('bot:');
  const botDifficulty = isBotMatch
    ? ((match.player2Id.startsWith('bot:') ? match.player2Id : match.player1Id).replace('bot:', '') as 'easy' | 'medium' | 'hard')
    : undefined;
  if (outcome === 'draw') {
    for (const pid of [match.player1Id, match.player2Id]) {
      if (pid.startsWith('bot:')) continue;
      try {
        const context = { gameType: 'chess', result: 'loss', vsBot: isBotMatch, botDifficulty } as const;
        const reward = await awardGameRunCredits({
          userId: pid,
          context,
          sourceId: `chess-draw:${match.id}:${pid}`,
          meta: { matchId: match.id, winReason: match.winReason ?? 'draw_agreement' },
        });
        await recordMatchRunResult({ matchId: match.id, userId: pid, context, reward });
      } catch (error) {
        console.error('Failed to award chess draw credits:', error);
      }
    }
  } else if (winnerId && loserId) {
    if (!winnerId.startsWith('bot:')) {
      try {
        const context = { gameType: 'chess', result: 'win', vsBot: isBotMatch, botDifficulty } as const;
        const reward = await awardGameRunCredits({
          userId: winnerId,
          context,
          sourceId: `chess-win:${match.id}:${winnerId}`,
          meta: { matchId: match.id, winReason: match.winReason },
        });
        await recordMatchRunResult({ matchId: match.id, userId: winnerId, context, reward });
      } catch (error) {
        console.error('Failed to award chess winner credits:', error);
      }
    }
    if (!loserId.startsWith('bot:')) {
      try {
        const context = { gameType: 'chess', result: 'loss', vsBot: isBotMatch, botDifficulty } as const;
        const reward = await awardGameRunCredits({
          userId: loserId,
          context,
          sourceId: `chess-loss:${match.id}:${loserId}`,
          meta: { matchId: match.id, winReason: match.winReason },
        });
        await recordMatchRunResult({ matchId: match.id, userId: loserId, context, reward });
      } catch (error) {
        console.error('Failed to award chess loser credits:', error);
      }
    }
  }

  // Wager settlement
  if (match.wagerAmount && match.wagerAmount > 0 && match.wagerStatus === 'held') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { settleMatchWager, refundMatchWager } = require('@/server/arcade/chess-wager') as typeof import('@/server/arcade/chess-wager');
      if (outcome === 'draw') {
        // Split pot: refund both players (each keeps their stake).
        await refundMatchWager(match.id, match.player1Id, match.player2Id, match.wagerAmount);
      } else if (winnerId) {
        const earlyForfeit = match.ply < MIN_PLY_FOR_ELO_FORFEIT && match.winReason !== 'checkmate';
        if (earlyForfeit) {
          await refundMatchWager(match.id, match.player1Id, match.player2Id, match.wagerAmount);
        } else {
          await settleMatchWager(match.id, winnerId, match.wagerAmount);
        }
      }
    } catch (error) {
      console.error('Failed to settle chess wager:', error);
    }
  }

  // Tournament progression
  if (match.tournamentMatchId) {
    await notifyChessMatchCompleted(match.id);
  }

  broadcast('gameLeaderboards', { gameType: 'chess', updatedAt: Date.now() });
  return eloChange;
}

function nameFor(match: ChessMatch, userId: string): string {
  if (match.player1Id === userId) return match.player1Name;
  if (match.player2Id === userId) return match.player2Name ?? 'Unknown';
  return 'Unknown';
}

async function countRecentForfeits(byUserId: string, windowMs: number): Promise<number> {
  const since = Date.now() - windowMs;
  const r = await queryOne<{ cnt: unknown }>(
    `SELECT COUNT(*) AS cnt FROM chess_matches
     WHERE (player1_id = $1 OR player2_id = $1) AND loser_id = $1
       AND win_reason IN ('resignation', 'timeout', 'forfeit')
       AND completed_at > $2`,
    [byUserId, since],
  );
  return toNum(r?.cnt);
}

async function countPairForfeits(userA: string, userB: string, windowMs: number): Promise<number> {
  const since = Date.now() - windowMs;
  const r = await queryOne<{ cnt: unknown }>(
    `SELECT COUNT(*) AS cnt FROM chess_matches
     WHERE win_reason IN ('resignation', 'timeout', 'forfeit')
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
  extra?: { isCheckmate?: boolean; isTimeout?: boolean },
): Promise<void> {
  const now = Date.now();
  const existing = await queryOne<{
    wins: string | number;
    losses: string | number;
    draws: string | number;
    forfeits: string | number;
    currentStreak: string | number;
    bestStreak: string | number;
    checkmatesGiven: string | number;
    timeouts: string | number;
  }>(
    `SELECT wins, losses, draws, forfeits,
            current_streak AS "currentStreak", best_streak AS "bestStreak",
            checkmates_given AS "checkmatesGiven", timeouts
     FROM chess_stats
     WHERE user_id = $1`,
    [userId],
  );
  const cm = extra?.isCheckmate ? 1 : 0;
  const to = extra?.isTimeout ? 1 : 0;

  if (!existing) {
    await query(
      `INSERT INTO chess_stats
         (user_id, user_name, wins, losses, draws, forfeits, current_streak,
          best_streak, total_moves, checkmates_given, timeouts, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
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
        cm,
        to,
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
    `UPDATE chess_stats
     SET user_name = $1, wins = $2, losses = $3, draws = $4, forfeits = $5,
         current_streak = $6, best_streak = $7, checkmates_given = $8,
         timeouts = $9, updated_at = $10
     WHERE user_id = $11`,
    [
      userName, wins, losses, draws, forfeits, currentStreak, bestStreak,
      toNum(existing.checkmatesGiven) + cm,
      toNum(existing.timeouts) + to,
      now,
      userId,
    ],
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

type DeleteCounts = {
  deletedMatches: number;
  deletedMoves: number;
  deletedChat: number;
  deletedEloHistory: number;
};

async function listStaleMatchIds({ now, batchSize }: { now: number; batchSize: number }): Promise<string[]> {
  const waitingCutoff = now - WAITING_MATCH_RETENTION_MS;
  const finishedCutoff = now - FINISHED_MATCH_RETENTION_MS;

  const staleWaiting = await query<{ id: string }>(
    `SELECT id FROM chess_matches WHERE status = 'waiting' AND updated_at < $1 LIMIT $2`,
    [waitingCutoff, batchSize],
  );

  const staleFinished = await query<{ id: string }>(
    `SELECT id FROM chess_matches
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

async function deleteMatchesById(ids: string[]): Promise<DeleteCounts> {
  if (ids.length === 0) {
    return { deletedMatches: 0, deletedMoves: 0, deletedChat: 0, deletedEloHistory: 0 };
  }
  const deletedMoves = (await query(
    'DELETE FROM chess_moves WHERE match_id = ANY($1)', [ids],
  )).rowCount ?? 0;
  const deletedChat = (await query(
    'DELETE FROM chess_match_chat WHERE match_id = ANY($1)', [ids],
  )).rowCount ?? 0;
  const deletedEloHistory = (await query(
    'DELETE FROM chess_elo_history WHERE match_id = ANY($1)', [ids],
  )).rowCount ?? 0;
  const deletedMatches = (await query(
    'DELETE FROM chess_matches WHERE id = ANY($1)', [ids],
  )).rowCount ?? 0;
  return { deletedMatches, deletedMoves, deletedChat, deletedEloHistory };
}

export async function maybeRunChessDataRetentionCleanup(): Promise<void> {
  const now = Date.now();
  if (now - lastRetentionRunAt < RETENTION_MIN_INTERVAL_MS) return;
  lastRetentionRunAt = now;
  try {
    const stale = await listStaleMatchIds({ now, batchSize: RETENTION_BATCH_SIZE });
    await deleteMatchesById(stale);
  } catch (error) {
    console.error('Chess retention cleanup failed', error);
  }
}

// ---------------------------------------------------------------------------
// Bot reply — async worker + crash/restart recovery
// ---------------------------------------------------------------------------

/**
 * Per-process guard preventing overlapping Stockfish jobs for the same
 * match. Reset on process restart (so crash recovery just kicks off a
 * fresh reply for any orphaned bot turn — see `resumeOrphanedBotTurns`).
 */
const botJobs = new Set<string>();

/** Fire-and-forget: compute the bot's move and submit it. Called from the
 * move route after a human move and from the resumer after a restart. */
export async function runBotReply(matchId: string): Promise<void> {
  if (botJobs.has(matchId)) return;
  botJobs.add(matchId);
  try {
    const match = await getMatch(matchId);
    if (!match || match.status !== 'active') return;
    if (!isBotUser(match.currentTurn)) return;
    const difficulty = match.currentTurn.replace('bot:', '') as BotDifficulty;
    const botUci = await computeBotMove(match.fen, difficulty);
    await submitMove(matchId, match.currentTurn, botUci);
  } catch (err) {
    console.error('Bot move failed:', err);
  } finally {
    botJobs.delete(matchId);
  }
}

/**
 * Re-trigger bot replies for any active match where it's a bot's turn
 * but no in-process job is running. Covers dev-server restarts and
 * crashes that killed an in-flight Stockfish job mid-computation: the
 * DB shows `currentTurn = bot:...` but no one is computing. Called
 * opportunistically from the match list + match detail routes.
 *
 * Throttled so routine lobby polls don't scan more than once every few
 * seconds — the actual per-match dedupe lives in `botJobs`.
 */
const BOT_RESUME_INTERVAL_MS = 3_000;
let lastBotResumeAt = 0;
export async function resumeOrphanedBotTurns(): Promise<number> {
  const now = Date.now();
  if (now - lastBotResumeAt < BOT_RESUME_INTERVAL_MS) return 0;
  lastBotResumeAt = now;
  const result = await query<ChessMatchRow>(
    `SELECT ${MATCH_SELECT} FROM chess_matches WHERE status = 'active'`,
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
