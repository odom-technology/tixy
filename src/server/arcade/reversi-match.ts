// ---------------------------------------------------------------------------
// Reversi/Othello match management (CRUD + state transitions).
//
// Cloned from connect-four-match.ts and UNTIMED: no clock arithmetic, no
// flag-fall, no timeout watchdog, no draw offers. Board state lives in a single
// `board` text column (64-char string). Server-authoritative move legality +
// terminal detection via the pure engine in `@/features/arcade/lib/reversi`.
// Move application uses a CAS on `ply` + status='active' to prevent double-apply
// on concurrent POSTs.
//
// REVERSI-SPECIFIC: the seats are stored on the dedicated black_id / white_id
// columns (black moves first), and a turn is SKIPPED when a player has no legal
// move — so after a move the next turn can return to the mover. The game ends
// only when NEITHER side has a legal move (engine detectGameEnd).
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { query, queryOne } from '@/server/db/client';
import { broadcast } from '@/server/events';
import {
  applyMove,
  detectGameEnd,
  hasAnyMove,
  opposite,
  colorForPlayer,
  STARTING_BOARD,
  type GameEndResult,
} from '@/features/arcade/lib/reversi';
import {
  computeBotMove,
  isBotUser,
  botDifficultyFromId,
  type BotDifficulty,
} from '@/server/arcade/reversi-bot';
import type {
  Color,
  ReversiMatch,
  GameResult,
  MatchStatus,
  WinReason,
} from '@/features/arcade/lib/reversi/types';
import {
  processRatedMatch,
  penalizeForfeitLoserOnly,
  recordBotSpeedRun,
  type EloChangeResult,
  type MatchOutcome,
} from '@/server/arcade/reversi-elo';
import { awardGameRunCredits } from '@/server/arcade/rewards/wallet';
import { recordMatchRunResult } from '@/server/arcade/match-run-results';
import { recordGameTimeMetric } from '@/server/arcade/game-time-metrics';
import { addAntiCheatLog } from '@/server/arcade/anti-cheat-logs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MATCH_LIST_LIMIT = 50;
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
  black_id AS "blackId",
  white_id AS "whiteId",
  status,
  current_turn AS "currentTurn",
  board,
  ply,
  move_count AS "moveCount",
  last_move AS "lastMove",
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

type ReversiMatchRow = {
  id: string;
  player1Id: string;
  player1Name: string;
  invitedUserId: string | null;
  player2Id: string | null;
  player2Name: string | null;
  blackId: string | null;
  whiteId: string | null;
  status: string;
  currentTurn: string;
  board: string;
  ply: string | number;
  moveCount: string | number;
  lastMove: string | null;
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

function rowToMatch(row: ReversiMatchRow): ReversiMatch {
  return {
    id: row.id,
    player1Id: row.player1Id,
    player1Name: row.player1Name,
    invitedUserId: row.invitedUserId ?? null,
    player2Id: row.player2Id ?? null,
    player2Name: row.player2Name ?? null,
    blackId: row.blackId ?? null,
    whiteId: row.whiteId ?? null,
    status: row.status as MatchStatus,
    currentTurn: row.currentTurn,
    board: row.board,
    ply: toNum(row.ply),
    moveCount: toNum(row.moveCount),
    lastMove: row.lastMove ?? null,
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
  /** 'black' | 'white' | 'random' — which disc the creator wants. */
  preferredColor?: Color | 'random';
};

/** Create a new Reversi match. Colors are assigned when an opponent joins. */
export async function createMatch(
  userId: string,
  userName: string,
  options?: CreateMatchOptions,
): Promise<ReversiMatch> {
  const id = crypto.randomUUID();
  const now = Date.now();

  const preAssignedBlack = options?.preferredColor === 'black' ? userId : null;
  const preAssignedWhite = options?.preferredColor === 'white' ? userId : null;

  const match: ReversiMatch = {
    id,
    player1Id: userId,
    player1Name: userName,
    invitedUserId: options?.invitedUserId ?? null,
    player2Id: null,
    player2Name: null,
    blackId: preAssignedBlack,
    whiteId: preAssignedWhite,
    status: 'waiting',
    currentTurn: userId,
    board: STARTING_BOARD,
    ply: 0,
    moveCount: 0,
    lastMove: null,
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
    `INSERT INTO reversi_matches
       (id, player1_id, player1_name, invited_user_id, player2_id, player2_name,
        black_id, white_id, status, current_turn, board, ply, move_count,
        last_move, result, winner_id, loser_id, win_reason, tournament_match_id,
        wager_amount, wager_status, created_at, updated_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
             $16, $17, $18, $19, $20, $21, $22, $23, $24)`,
    [
      match.id, match.player1Id, match.player1Name, match.invitedUserId,
      match.player2Id, match.player2Name, match.blackId, match.whiteId,
      match.status, match.currentTurn, match.board, match.ply, match.moveCount,
      match.lastMove, match.result, match.winnerId, match.loserId,
      match.winReason, match.tournamentMatchId, match.wagerAmount,
      match.wagerStatus, match.createdAt, match.updatedAt, match.completedAt,
    ],
  );
  broadcast('reversiLobby', { type: 'match_created', matchId: id });
  if (options?.invitedUserId) {
    broadcast('reversiChallenge', {
      type: 'challenge_sent',
      matchId: id,
      senderId: userId,
      senderName: userName,
      invitedUserId: options.invitedUserId,
      wagerAmount: options?.wagerAmount ?? null,
    });
  }
  return match;
}

export async function deleteMatch(matchId: string): Promise<void> {
  await query('DELETE FROM reversi_matches WHERE id = $1', [matchId]);
}

export async function cancelWaitingMatch(matchId: string, userId: string): Promise<void> {
  const row = await getMatch(matchId);
  if (!row) throw new Error('Match not found.');
  if (row.player1Id !== userId) throw new Error('Only the creator can cancel this match.');
  if (row.status !== 'waiting') throw new Error('Only waiting matches can be cancelled.');

  const deleted = await query(
    `DELETE FROM reversi_matches WHERE id = $1 AND status = 'waiting'`,
    [matchId],
  );
  if ((deleted.rowCount ?? 0) === 0) {
    throw new Error('Match is no longer cancellable — it may have been joined.');
  }

  broadcast('reversiLobby', { type: 'match_cancelled', matchId });
}

/** Join an open match. Uses an atomic conditional UPDATE. */
export async function joinMatch(
  matchId: string,
  userId: string,
  userName: string,
): Promise<ReversiMatch> {
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
  let blackId = row.blackId;
  let whiteId = row.whiteId;
  if (blackId && !whiteId) whiteId = userId;
  else if (whiteId && !blackId) blackId = userId;
  else {
    if (Math.random() < 0.5) {
      blackId = row.player1Id;
      whiteId = userId;
    } else {
      blackId = userId;
      whiteId = row.player1Id;
    }
  }

  const result = await query(
    `UPDATE reversi_matches
     SET player2_id = $1, player2_name = $2, invited_user_id = NULL,
         black_id = $3, white_id = $4, status = 'active', current_turn = $5,
         updated_at = $6
     WHERE id = $7
       AND status = 'waiting'
       AND (invited_user_id IS NULL OR invited_user_id = $1)
       AND player2_id IS NULL`,
    [userId, userName, blackId, whiteId, blackId /* black moves first */, now, matchId],
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new Error('Match was already claimed by another player.');
  }

  const updated = await getMatch(matchId);
  broadcast('reversiLobby', { type: 'match_joined', matchId });
  broadcast([`reversi:${matchId}`, 'reversiMatch'], { matchId, type: 'opponent_joined', userId, userName });
  return updated!;
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

export async function getMatch(matchId: string): Promise<ReversiMatch | null> {
  const row = await queryOne<ReversiMatchRow>(
    `SELECT ${MATCH_SELECT} FROM reversi_matches WHERE id = $1`,
    [matchId],
  );
  return row ? rowToMatch(row) : null;
}

async function getRecentClearCutoffForUser(userId: string): Promise<number | null> {
  const row = await queryOne<{ clearedBeforeTs: string | number }>(
    `SELECT cleared_before_ts AS "clearedBeforeTs"
     FROM reversi_recent_match_clears
     WHERE user_id = $1`,
    [userId],
  );
  return row ? toNum(row.clearedBeforeTs) : null;
}

export async function getMatchesForUser(userId: string): Promise<ReversiMatch[]> {
  const clearedBeforeTs = await getRecentClearCutoffForUser(userId);
  const result = await query<ReversiMatchRow>(
    `SELECT ${MATCH_SELECT} FROM reversi_matches
     WHERE player1_id = $1
        OR player2_id = $1
        OR (status = 'waiting' AND invited_user_id = $1)
     ORDER BY updated_at DESC
     LIMIT $2`,
    [userId, MATCH_LIST_LIMIT * 4],
  );

  return result.rows
    .map(rowToMatch)
    .filter((m) => {
      if (clearedBeforeTs === null) return true;
      const isHistory = m.status === 'completed' || m.status === 'forfeited';
      if (!isHistory) return true;
      return (m.completedAt ?? m.updatedAt) > clearedBeforeTs;
    })
    .slice(0, MATCH_LIST_LIMIT);
}

export async function getOpenMatches(excludeUserId: string): Promise<ReversiMatch[]> {
  const result = await query<ReversiMatchRow>(
    `SELECT ${MATCH_SELECT} FROM reversi_matches
     WHERE status = 'waiting' AND invited_user_id IS NULL
     ORDER BY created_at DESC
     LIMIT 20`,
  );
  return result.rows.filter((r) => r.player1Id !== excludeUserId).map(rowToMatch);
}

export function isMatchSpectatable(match: ReversiMatch): boolean {
  if (match.status !== 'active') return false;
  if (!match.player2Id) return false;
  if (match.tournamentMatchId) return true;
  return !match.player2Id.startsWith('bot:');
}

export async function getActiveSpectatableMatches(): Promise<Array<ReversiMatch & { spectatorCount: number }>> {
  const cutoff = Date.now() - LIVE_MATCH_STALENESS_MS;
  const result = await query<ReversiMatchRow>(
    `SELECT ${MATCH_SELECT} FROM reversi_matches
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
    `INSERT INTO reversi_recent_match_clears (user_id, cleared_before_ts, updated_at)
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
  match: ReversiMatch;
  moveNotation: string;
  board: string;
  flipped: number[];
  end: GameEndResult;
  elapsedMs: number;
  eloChange: EloChangeResult | null;
};

/**
 * Submit a disc placement (0-63 cell index). Server validates legality +
 * flips + terminal detection, then applies with a CAS on `ply` to prevent
 * double-apply on concurrent requests. UNTIMED.
 *
 * After the move the next turn is the opponent UNLESS the opponent has no legal
 * move, in which case the opponent is skipped and it stays the mover's turn.
 * If neither side can move the game ends.
 */
export async function submitMove(
  matchId: string,
  userId: string,
  cell: number,
): Promise<SubmitMoveResult> {
  const match = await getMatch(matchId);
  if (!match) throw new Error('Match not found.');
  if (match.status !== 'active') throw new Error('Match is not in progress.');
  if (match.currentTurn !== userId) throw new Error('Not your turn.');

  const moverColor = colorForPlayer(match, userId);
  if (!moverColor) throw new Error('You are not a player in this match.');
  if (!match.blackId || !match.whiteId) throw new Error('Opponent has not joined yet.');

  // Validate + apply the placement (throws Illegal/Invalid → mapped to 400).
  const applied = applyMove(match.board, cell, moverColor);

  const now = Date.now();
  const elapsed = match.updatedAt ? Math.max(0, now - match.updatedAt) : 0;
  const moveDurationMs = Math.min(elapsed, MAX_RECORDED_MOVE_MS);

  const ply = match.ply + 1;
  const moveCount = ply;

  // Terminal detection on the post-move board (over only when neither side can
  // move). Otherwise resolve the next seat, honoring Reversi's pass rule.
  const end: GameEndResult = detectGameEnd(applied.board);
  const oppColor = opposite(moverColor);
  const oppId = oppColor === 'black' ? match.blackId : match.whiteId;

  let nextTurn: string;
  if (end.over) {
    nextTurn = userId; // unused once the match is completed
  } else if (hasAnyMove(applied.board, oppColor)) {
    nextTurn = oppId;
  } else {
    // Opponent has no move → they pass; since the game isn't over the mover is
    // guaranteed at least one legal move, so play returns to them.
    nextTurn = userId;
  }

  let winnerId: string | null = null;
  let loserId: string | null = null;
  let result: GameResult | null = null;
  let winReason: WinReason | null = null;
  let nextStatus: MatchStatus = 'active';

  if (end.over) {
    nextStatus = 'completed';
    result = end.result;
    winReason = end.reason;
    if (end.winnerColor === 'black') {
      winnerId = match.blackId;
      loserId = match.whiteId;
    } else if (end.winnerColor === 'white') {
      winnerId = match.whiteId;
      loserId = match.blackId;
    }
  }

  // Apply with CAS on ply + status='active' to reject double-apply.
  const res = await query(
    `UPDATE reversi_matches
     SET board = $1, ply = $2, move_count = $3, current_turn = $4,
         last_move = $5, status = $6, result = $7, winner_id = $8,
         loser_id = $9, win_reason = $10, completed_at = $11, updated_at = $12
     WHERE id = $13 AND ply = $14 AND status = 'active'`,
    [
      applied.board, ply, moveCount, nextTurn, String(applied.cell),
      nextStatus, result, winnerId, loserId, winReason,
      nextStatus === 'completed' ? now : null, now, matchId, match.ply,
    ],
  );

  if ((res.rowCount ?? 0) === 0) {
    throw new Error('Move was already processed (concurrent request).');
  }

  // Record the move.
  await query(
    `INSERT INTO reversi_moves
       (id, match_id, player_id, move_number, ply, cell_index, board_after,
        move_duration_ms, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      crypto.randomUUID(), matchId, userId, moveCount, ply, applied.cell,
      applied.board, moveDurationMs, now,
    ],
  );

  // Record game-time metric (active play only; bots excluded).
  if (!userId.startsWith('bot:')) {
    void recordGameTimeMetric({
      userId,
      gameType: 'reversi',
      durationMs: moveDurationMs,
      playedAtMs: now,
    }).catch((error) => {
      console.error('Failed to record reversi move time:', error);
    });
  }

  let eloChange: EloChangeResult | null = null;
  const updatedMatch = (await getMatch(matchId))!;

  if (nextStatus === 'completed') {
    eloChange = await finalizeCompletedMatch(updatedMatch, end);
  }

  broadcast([`reversi:${matchId}`, 'reversiMatch'], {
    matchId,
    type: 'move',
    moverId: userId,
    cell: applied.cell,
    ply,
    gameOver: nextStatus === 'completed',
    winnerId,
    winReason,
  });

  return {
    ok: true,
    match: updatedMatch,
    moveNotation: applied.moveNotation,
    board: applied.board,
    flipped: applied.flipped,
    end,
    elapsedMs: moveDurationMs,
    eloChange,
  };
}

// ---------------------------------------------------------------------------
// Resign resolution
// ---------------------------------------------------------------------------

function recordTerminalTime(
  match: ReversiMatch,
  userId: string,
  now: number,
): void {
  if (userId.startsWith('bot:')) return;
  if (!match.updatedAt) return;
  const elapsed = Math.max(0, now - match.updatedAt);
  const durationMs = Math.min(elapsed, MAX_RECORDED_MOVE_MS);
  if (durationMs <= 0) return;
  void recordGameTimeMetric({
    userId,
    gameType: 'reversi',
    durationMs,
    playedAtMs: now,
  }).catch((error) => {
    console.error('Failed to record reversi terminal time:', error);
  });
}

/** Resign the match as userId. Returns the final match + Elo change. */
export async function resignMatch(matchId: string, userId: string): Promise<{ match: ReversiMatch; eloChange: EloChangeResult | null }> {
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
  const winnerColor: Color | null = match.blackId === winnerId ? 'black' : match.whiteId === winnerId ? 'white' : null;
  const result: GameResult = winnerColor === 'black' ? '1-0' : '0-1';

  const updated = await query(
    `UPDATE reversi_matches
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
  recordTerminalTime(finalMatch, userId, now);
  const eloChange = await finalizeCompletedMatch(finalMatch, {
    over: true,
    winnerColor,
    result,
    reason: 'resignation',
  });
  broadcast([`reversi:${matchId}`, 'reversiMatch'], { matchId, type: 'resigned', by: userId });
  broadcast('reversiLobby', { type: 'match_ended', matchId });
  return { match: finalMatch, eloChange };
}

// ---------------------------------------------------------------------------
// Finalize (Elo + Tickets + wager + stats)
// ---------------------------------------------------------------------------

function outcomeFor(
  match: ReversiMatch,
  end: GameEndResult,
): { outcome: MatchOutcome | null; winnerId: string | null; loserId: string | null } {
  if (!end.over || !match.player2Id) return { outcome: null, winnerId: null, loserId: null };
  if (!match.blackId || !match.whiteId) return { outcome: null, winnerId: null, loserId: null };

  if (end.winnerColor === null) {
    return { outcome: 'draw', winnerId: null, loserId: null };
  }
  const winnerId = end.winnerColor === 'black' ? match.blackId : match.whiteId;
  const loserId = end.winnerColor === 'black' ? match.whiteId : match.blackId;
  const outcome: MatchOutcome = winnerId === match.player1Id ? 'win_a' : 'win_b';
  return { outcome, winnerId, loserId };
}

async function finalizeCompletedMatch(match: ReversiMatch, end: GameEndResult): Promise<EloChangeResult | null> {
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
      const isResign = match.winReason === 'resignation';
      const loserResult = isResign ? 'forfeit' : 'loss';
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
      const tooFew = match.ply < MIN_PLY_FOR_ELO_FORFEIT && match.winReason !== 'disc_majority';
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
          gameType: 'reversi',
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
  const matchIsBot = match.player1Id.startsWith('bot:') || match.player2Id.startsWith('bot:');
  const botDifficulty: BotDifficulty | undefined = matchIsBot
    ? (botDifficultyFromId(match.player2Id.startsWith('bot:') ? match.player2Id : match.player1Id) ?? undefined)
    : undefined;
  if (outcome === 'draw') {
    for (const pid of [match.player1Id, match.player2Id]) {
      if (pid.startsWith('bot:')) continue;
      try {
        const context = { gameType: 'reversi', result: 'loss', vsBot: matchIsBot, botDifficulty } as const;
        const reward = await awardGameRunCredits({
          userId: pid,
          context,
          sourceId: `reversi-draw:${match.id}:${pid}`,
          meta: { matchId: match.id, winReason: match.winReason ?? 'draw_full_board' },
        });
        await recordMatchRunResult({ matchId: match.id, userId: pid, context, reward });
      } catch (error) {
        console.error('Failed to award reversi draw credits:', error);
      }
    }
  } else if (winnerId && loserId) {
    if (!winnerId.startsWith('bot:')) {
      try {
        const context = { gameType: 'reversi', result: 'win', vsBot: matchIsBot, botDifficulty } as const;
        const reward = await awardGameRunCredits({
          userId: winnerId,
          context,
          sourceId: `reversi-win:${match.id}:${winnerId}`,
          meta: { matchId: match.id, winReason: match.winReason },
        });
        await recordMatchRunResult({ matchId: match.id, userId: winnerId, context, reward });
      } catch (error) {
        console.error('Failed to award reversi winner credits:', error);
      }
    }
    if (!loserId.startsWith('bot:')) {
      try {
        const context = { gameType: 'reversi', result: 'loss', vsBot: matchIsBot, botDifficulty } as const;
        const reward = await awardGameRunCredits({
          userId: loserId,
          context,
          sourceId: `reversi-loss:${match.id}:${loserId}`,
          meta: { matchId: match.id, winReason: match.winReason },
        });
        await recordMatchRunResult({ matchId: match.id, userId: loserId, context, reward });
      } catch (error) {
        console.error('Failed to award reversi loser credits:', error);
      }
    }
  }

  // Bot speed-run record: when a HUMAN beats a BOT by disc majority, record
  // their fewest-moves time for the per-difficulty bot leaderboard.
  if (
    matchIsBot
    && botDifficulty
    && winnerId
    && !winnerId.startsWith('bot:')
    && match.winReason === 'disc_majority'
  ) {
    void recordBotSpeedRun(match.id, winnerId, nameFor(match, winnerId), botDifficulty)
      .catch((error) => {
        console.error('Failed to record reversi bot speed run:', error);
      });
  }

  broadcast('gameLeaderboards', { gameType: 'reversi', updatedAt: Date.now() });
  return eloChange;
}

function nameFor(match: ReversiMatch, userId: string): string {
  if (match.player1Id === userId) return match.player1Name;
  if (match.player2Id === userId) return match.player2Name ?? 'Unknown';
  return 'Unknown';
}

async function countRecentForfeits(byUserId: string, windowMs: number): Promise<number> {
  const since = Date.now() - windowMs;
  const r = await queryOne<{ cnt: unknown }>(
    `SELECT COUNT(*) AS cnt FROM reversi_matches
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
    `SELECT COUNT(*) AS cnt FROM reversi_matches
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
    totalMoves: string | number;
  }>(
    `SELECT wins, losses, draws, forfeits,
            current_streak AS "currentStreak", best_streak AS "bestStreak",
            total_moves AS "totalMoves"
     FROM reversi_stats
     WHERE user_id = $1`,
    [userId],
  );

  if (!existing) {
    await query(
      `INSERT INTO reversi_stats
         (user_id, user_name, wins, losses, draws, forfeits, current_streak,
          best_streak, total_moves, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
    `UPDATE reversi_stats
     SET user_name = $1, wins = $2, losses = $3, draws = $4, forfeits = $5,
         current_streak = $6, best_streak = $7, updated_at = $8
     WHERE user_id = $9`,
    [
      userName, wins, losses, draws, forfeits, currentStreak, bestStreak,
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
  deletedEloHistory: number;
};

async function listStaleMatchIds({ now, batchSize }: { now: number; batchSize: number }): Promise<string[]> {
  const waitingCutoff = now - WAITING_MATCH_RETENTION_MS;
  const finishedCutoff = now - FINISHED_MATCH_RETENTION_MS;

  const staleWaiting = await query<{ id: string }>(
    `SELECT id FROM reversi_matches WHERE status = 'waiting' AND updated_at < $1 LIMIT $2`,
    [waitingCutoff, batchSize],
  );

  const staleFinished = await query<{ id: string }>(
    `SELECT id FROM reversi_matches
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
    return { deletedMatches: 0, deletedMoves: 0, deletedEloHistory: 0 };
  }
  const deletedMoves = (await query(
    'DELETE FROM reversi_moves WHERE match_id = ANY($1)', [ids],
  )).rowCount ?? 0;
  const deletedEloHistory = (await query(
    'DELETE FROM reversi_elo_history WHERE match_id = ANY($1)', [ids],
  )).rowCount ?? 0;
  const deletedMatches = (await query(
    'DELETE FROM reversi_matches WHERE id = ANY($1)', [ids],
  )).rowCount ?? 0;
  return { deletedMatches, deletedMoves, deletedEloHistory };
}

export async function maybeRunReversiDataRetentionCleanup(): Promise<void> {
  const now = Date.now();
  if (now - lastRetentionRunAt < RETENTION_MIN_INTERVAL_MS) return;
  lastRetentionRunAt = now;
  try {
    const stale = await listStaleMatchIds({ now, batchSize: RETENTION_BATCH_SIZE });
    await deleteMatchesById(stale);
  } catch (error) {
    console.error('Reversi retention cleanup failed', error);
  }
}

// ---------------------------------------------------------------------------
// Bot reply — async worker + crash/restart recovery
// ---------------------------------------------------------------------------

/** Per-process guard preventing overlapping bot jobs for the same match. */
const botJobs = new Set<string>();

/** Fire-and-forget: compute the bot's move(s) and submit them. Loops because
 *  Reversi has passes: if the opponent has no legal move after the bot plays it
 *  stays the bot's turn and it must move again. Bounded by 64 placements. */
export async function runBotReply(matchId: string): Promise<void> {
  if (botJobs.has(matchId)) return;
  botJobs.add(matchId);
  try {
    for (let guard = 0; guard < 64; guard++) {
      const match = await getMatch(matchId);
      if (!match || match.status !== 'active') return;
      if (!isBotUser(match.currentTurn)) return;
      const difficulty = botDifficultyFromId(match.currentTurn) ?? 'medium';
      const botColor = colorForPlayer(match, match.currentTurn);
      if (!botColor) return;
      const botCell = await computeBotMove(match.board, botColor, difficulty as BotDifficulty);
      await submitMove(matchId, match.currentTurn, botCell);
    }
  } catch (err) {
    console.error('Bot move failed:', err);
  } finally {
    botJobs.delete(matchId);
  }
}

const BOT_RESUME_INTERVAL_MS = 3_000;
let lastBotResumeAt = 0;
export async function resumeOrphanedBotTurns(): Promise<number> {
  const now = Date.now();
  if (now - lastBotResumeAt < BOT_RESUME_INTERVAL_MS) return 0;
  lastBotResumeAt = now;
  const result = await query<ReversiMatchRow>(
    `SELECT ${MATCH_SELECT} FROM reversi_matches WHERE status = 'active'`,
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
