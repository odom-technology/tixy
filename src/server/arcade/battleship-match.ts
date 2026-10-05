// ---------------------------------------------------------------------------
// Battleship match management (CRUD + state transitions).
//
// Cloned from reversi-match.ts and adapted for Battleship's TWO PHASES and
// HIDDEN fleets. Cloned UNTIMED: no clocks, flag-fall, or draw offers.
//
//   Lifecycle:  waiting -> active(phase=placement) -> active(phase=active) -> completed
//
//   * waiting   : creator alone, awaiting an opponent.
//   * placement : both players privately submit a legal fleet + ready up. When
//                 BOTH are ready the match transitions to phase='active' and a
//                 first turn is chosen (CAS so only one request wins).
//   * active    : players alternate firing one shot at the OPPONENT's grid. The
//                 server resolves hit/miss/sunk against the hidden board and
//                 records it. Win when the entire enemy fleet is destroyed.
//
// Server-authoritative everywhere. Shot application uses a CAS on `ply` +
// status='active' + phase='active' to reject double-apply on concurrent POSTs.
//
// HIDDEN-BOARD GUARANTEE: the raw player1_board / player2_board columns are
// NEVER returned to a client. API routes call `redactMatchForViewer` (engine)
// which assembles a per-viewer `PublicMatch` that omits the opponent's un-hit
// ship cells. `getMatch` returns the FULL match for server-internal use only.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { query, queryOne } from '@/server/db/client';
import { broadcast } from '@/server/events';
import {
  parseAndValidateFleet,
  resolveShot,
  seatForPlayer,
  type BattleshipMatch,
  type GameResult,
  type MatchStatus,
  type Phase,
  type Shot,
  type ShipPlacement,
  type WinReason,
} from '@/server/arcade/battleship-engine';
import {
  computeBotShot,
  randomFleet,
  isBotUser,
  botDifficultyFromId,
  type BotDifficulty,
} from '@/server/arcade/battleship-bot';
import {
  processRatedMatch,
  penalizeForfeitLoserOnly,
  recordBotSpeedRun,
  type EloChangeResult,
  type MatchOutcome,
} from '@/server/arcade/battleship-elo';
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
const toBool = (value: unknown): boolean => value === true || value === 't' || value === 1 || value === '1';

function parseBoard(text: string | null): ShipPlacement[] | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as ShipPlacement[]) : null;
  } catch {
    return null;
  }
}

function parseShots(text: string | null): Shot[] {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as Shot[]) : [];
  } catch {
    return [];
  }
}

const MATCH_SELECT = `
  id,
  player1_id AS "player1Id",
  player1_name AS "player1Name",
  invited_user_id AS "invitedUserId",
  player2_id AS "player2Id",
  player2_name AS "player2Name",
  status,
  phase,
  current_turn AS "currentTurn",
  player1_board AS "player1Board",
  player2_board AS "player2Board",
  player1_shots AS "player1Shots",
  player2_shots AS "player2Shots",
  player1_ready AS "player1Ready",
  player2_ready AS "player2Ready",
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

type BattleshipMatchRow = {
  id: string;
  player1Id: string;
  player1Name: string;
  invitedUserId: string | null;
  player2Id: string | null;
  player2Name: string | null;
  status: string;
  phase: string;
  currentTurn: string | null;
  player1Board: string | null;
  player2Board: string | null;
  player1Shots: string | null;
  player2Shots: string | null;
  player1Ready: unknown;
  player2Ready: unknown;
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

function rowToMatch(row: BattleshipMatchRow): BattleshipMatch {
  return {
    id: row.id,
    player1Id: row.player1Id,
    player1Name: row.player1Name,
    invitedUserId: row.invitedUserId ?? null,
    player2Id: row.player2Id ?? null,
    player2Name: row.player2Name ?? null,
    status: row.status as MatchStatus,
    phase: row.phase as Phase,
    currentTurn: row.currentTurn ?? null,
    player1Board: parseBoard(row.player1Board),
    player2Board: parseBoard(row.player2Board),
    player1Shots: parseShots(row.player1Shots),
    player2Shots: parseShots(row.player2Shots),
    player1Ready: toBool(row.player1Ready),
    player2Ready: toBool(row.player2Ready),
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
};

/** Create a new Battleship match (open, awaiting an opponent). */
export async function createMatch(
  userId: string,
  userName: string,
  options?: CreateMatchOptions,
): Promise<BattleshipMatch> {
  const id = crypto.randomUUID();
  const now = Date.now();

  await query(
    `INSERT INTO battleship_matches
       (id, player1_id, player1_name, invited_user_id, player2_id, player2_name,
        status, phase, current_turn, player1_board, player2_board,
        player1_shots, player2_shots, player1_ready, player2_ready,
        ply, move_count, last_move, result, winner_id, loser_id, win_reason,
        tournament_match_id, wager_amount, wager_status,
        created_at, updated_at, completed_at)
     VALUES ($1, $2, $3, $4, NULL, NULL,
             'waiting', 'placement', NULL, NULL, NULL,
             '[]', '[]', FALSE, FALSE,
             0, 0, NULL, NULL, NULL, NULL, NULL,
             $5, $6, $7, $8, $8, NULL)`,
    [
      id, userId, userName, options?.invitedUserId ?? null,
      options?.tournamentMatchId ?? null,
      options?.wagerAmount ?? null,
      options?.wagerAmount ? 'pending_accept' : null,
      now,
    ],
  );

  broadcast('battleshipLobby', { type: 'match_created', matchId: id });
  if (options?.invitedUserId) {
    broadcast('battleshipChallenge', {
      type: 'challenge_sent',
      matchId: id,
      senderId: userId,
      senderName: userName,
      invitedUserId: options.invitedUserId,
      wagerAmount: options?.wagerAmount ?? null,
    });
  }
  return (await getMatch(id))!;
}

export async function deleteMatch(matchId: string): Promise<void> {
  await query('DELETE FROM battleship_matches WHERE id = $1', [matchId]);
}

export async function cancelWaitingMatch(matchId: string, userId: string): Promise<void> {
  const row = await getMatch(matchId);
  if (!row) throw new Error('Match not found.');
  if (row.player1Id !== userId) throw new Error('Only the creator can cancel this match.');
  if (row.status !== 'waiting') throw new Error('Only waiting matches can be cancelled.');

  const deleted = await query(
    `DELETE FROM battleship_matches WHERE id = $1 AND status = 'waiting'`,
    [matchId],
  );
  if ((deleted.rowCount ?? 0) === 0) {
    throw new Error('Match is no longer cancellable — it may have been joined.');
  }
  broadcast('battleshipLobby', { type: 'match_cancelled', matchId });
}

/** Join an open match. Transitions to active/placement via an atomic CAS. */
export async function joinMatch(
  matchId: string,
  userId: string,
  userName: string,
): Promise<BattleshipMatch> {
  const row = await getMatch(matchId);
  if (!row) throw new Error('Match not found.');
  if (row.status !== 'waiting') throw new Error('Match is not open.');
  if (row.player1Id === userId) throw new Error('Cannot join your own match.');
  if (row.invitedUserId && row.invitedUserId !== userId) {
    throw new Error('This match is reserved for another player.');
  }
  if (row.player2Id) throw new Error('Match is already full.');

  const now = Date.now();
  const result = await query(
    `UPDATE battleship_matches
     SET player2_id = $1, player2_name = $2, invited_user_id = NULL,
         status = 'active', phase = 'placement', current_turn = NULL,
         updated_at = $3
     WHERE id = $4
       AND status = 'waiting'
       AND (invited_user_id IS NULL OR invited_user_id = $1)
       AND player2_id IS NULL`,
    [userId, userName, now, matchId],
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new Error('Match was already claimed by another player.');
  }

  const updated = (await getMatch(matchId))!;
  broadcast('battleshipLobby', { type: 'match_joined', matchId });
  broadcast([`battleship:${matchId}`, 'battleshipMatch'], { matchId, type: 'opponent_joined', userId, userName });
  return updated;
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/** Full server-internal match (INCLUDES hidden boards). Never return raw to a
 *  client — pass through `redactMatchForViewer` first. */
export async function getMatch(matchId: string): Promise<BattleshipMatch | null> {
  const row = await queryOne<BattleshipMatchRow>(
    `SELECT ${MATCH_SELECT} FROM battleship_matches WHERE id = $1`,
    [matchId],
  );
  return row ? rowToMatch(row) : null;
}

async function getRecentClearCutoffForUser(userId: string): Promise<number | null> {
  const row = await queryOne<{ clearedBeforeTs: string | number }>(
    `SELECT cleared_before_ts AS "clearedBeforeTs"
     FROM battleship_recent_match_clears
     WHERE user_id = $1`,
    [userId],
  );
  return row ? toNum(row.clearedBeforeTs) : null;
}

export async function getMatchesForUser(userId: string): Promise<BattleshipMatch[]> {
  const clearedBeforeTs = await getRecentClearCutoffForUser(userId);
  const result = await query<BattleshipMatchRow>(
    `SELECT ${MATCH_SELECT} FROM battleship_matches
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

export async function getOpenMatches(excludeUserId: string): Promise<BattleshipMatch[]> {
  const result = await query<BattleshipMatchRow>(
    `SELECT ${MATCH_SELECT} FROM battleship_matches
     WHERE status = 'waiting' AND invited_user_id IS NULL
     ORDER BY created_at DESC
     LIMIT 20`,
  );
  return result.rows.filter((r) => r.player1Id !== excludeUserId).map(rowToMatch);
}

export function isMatchSpectatable(match: BattleshipMatch): boolean {
  if (match.status !== 'active') return false;
  if (!match.player2Id) return false;
  if (match.tournamentMatchId) return true;
  return !match.player2Id.startsWith('bot:');
}

export async function getActiveSpectatableMatches(): Promise<Array<BattleshipMatch & { spectatorCount: number }>> {
  const cutoff = Date.now() - LIVE_MATCH_STALENESS_MS;
  const result = await query<BattleshipMatchRow>(
    `SELECT ${MATCH_SELECT} FROM battleship_matches
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
    `INSERT INTO battleship_recent_match_clears (user_id, cleared_before_ts, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET
       cleared_before_ts = EXCLUDED.cleared_before_ts,
       updated_at = EXCLUDED.updated_at`,
    [userId, now, now],
  );
  return now;
}

// ---------------------------------------------------------------------------
// Placement submission (phase='placement')
// ---------------------------------------------------------------------------

export type SubmitPlacementResult = {
  ok: true;
  match: BattleshipMatch;
  bothReady: boolean;
};

/**
 * Submit a fleet + ready up. Server validates the fleet (throws Illegal/Invalid
 * → 400). Stored on the caller's own board column with a CAS on the ready flag
 * to reject a double-submit. When BOTH players are ready the match transitions
 * to phase='active' with a randomly chosen first turn (a separate CAS so only
 * one concurrent request performs the transition).
 */
export async function submitPlacement(
  matchId: string,
  userId: string,
  fleetInput: unknown,
): Promise<SubmitPlacementResult> {
  const match = await getMatch(matchId);
  if (!match) throw new Error('Match not found.');
  if (match.status !== 'active' || match.phase !== 'placement') {
    throw new Error('Match is not accepting fleet placements.');
  }
  const seat = seatForPlayer(match, userId);
  if (!seat) throw new Error('You are not a player in this match.');
  const alreadyReady = seat === 'player1' ? match.player1Ready : match.player2Ready;
  if (alreadyReady) throw new Error('You have already placed your fleet.');

  // Validate (throws on illegal). Canonical, sorted placement is stored.
  const fleet = parseAndValidateFleet(fleetInput);
  const boardJson = JSON.stringify(fleet);
  const now = Date.now();

  const boardCol = seat === 'player1' ? 'player1_board' : 'player2_board';
  const readyCol = seat === 'player1' ? 'player1_ready' : 'player2_ready';

  const res = await query(
    `UPDATE battleship_matches
     SET ${boardCol} = $1, ${readyCol} = TRUE, updated_at = $2
     WHERE id = $3 AND status = 'active' AND phase = 'placement' AND ${readyCol} = FALSE`,
    [boardJson, now, matchId],
  );
  if ((res.rowCount ?? 0) === 0) {
    throw new Error('Fleet was already placed (concurrent request).');
  }

  // Record the placement move (audit; excluded from shot-count speed runs).
  await query(
    `INSERT INTO battleship_moves (id, match_id, player_id, ply, kind, cell, outcome, move_duration_ms, created_at)
     VALUES ($1, $2, $3, 0, 'place', 0, NULL, NULL, $4)`,
    [crypto.randomUUID(), matchId, userId, now],
  );

  // Attempt the placement -> active transition (only fires once both are ready).
  const first = Math.random() < 0.5 ? match.player1Id : match.player2Id!;
  const transition = await query(
    `UPDATE battleship_matches
     SET phase = 'active', current_turn = $1, updated_at = $2
     WHERE id = $3 AND status = 'active' AND phase = 'placement'
       AND player1_ready = TRUE AND player2_ready = TRUE`,
    [first, now, matchId],
  );
  const transitioned = (transition.rowCount ?? 0) > 0;

  const updated = (await getMatch(matchId))!;
  const bothReady = updated.player1Ready && updated.player2Ready;

  broadcast([`battleship:${matchId}`, 'battleshipMatch'], {
    matchId,
    type: transitioned ? 'battle_started' : 'fleet_ready',
    by: userId,
  });
  if (transitioned) broadcast('battleshipLobby', { type: 'match_started', matchId });

  return { ok: true, match: updated, bothReady };
}

// ---------------------------------------------------------------------------
// Shot submission (phase='active', server-authoritative)
// ---------------------------------------------------------------------------

export type SubmitShotResult = {
  ok: true;
  match: BattleshipMatch;
  shot: Shot;
  fleetDestroyed: boolean;
  eloChange: EloChangeResult | null;
};

/**
 * Fire a shot (0-99) at the opponent's grid. Server resolves hit/miss/sunk
 * against the HIDDEN opponent board and appends it to the caller's own shot
 * list, applied with a CAS on `ply` + status='active' + phase='active' to
 * reject double-apply. Strict alternation (no extra turn on a hit). Win when the
 * entire enemy fleet is destroyed.
 */
export async function submitShot(
  matchId: string,
  userId: string,
  cell: number,
): Promise<SubmitShotResult> {
  const match = await getMatch(matchId);
  if (!match) throw new Error('Match not found.');
  if (match.status !== 'active') throw new Error('Match is not in progress.');
  if (match.phase !== 'active') throw new Error('The battle has not started yet.');
  if (match.currentTurn !== userId) throw new Error('Not your turn.');

  const seat = seatForPlayer(match, userId);
  if (!seat) throw new Error('You are not a player in this match.');
  if (!match.player1Board || !match.player2Board) {
    throw new Error('Both fleets must be placed before firing.');
  }

  const targetBoard = seat === 'player1' ? match.player2Board : match.player1Board;
  const myShots = seat === 'player1' ? match.player1Shots : match.player2Shots;
  const opponentId = seat === 'player1' ? match.player2Id! : match.player1Id;

  // Resolve (throws Illegal/Invalid → mapped to 400).
  const resolved = resolveShot(targetBoard, myShots, cell);
  const newShots = [...myShots, resolved.shot];

  const now = Date.now();
  const elapsed = match.updatedAt ? Math.max(0, now - match.updatedAt) : 0;
  const moveDurationMs = Math.min(elapsed, MAX_RECORDED_MOVE_MS);

  const ply = match.ply + 1;
  const moveCount = ply;
  const over = resolved.fleetDestroyed;

  const nextTurn = over ? userId : opponentId; // strict alternation
  let nextStatus: MatchStatus = 'active';
  let winnerId: string | null = null;
  let loserId: string | null = null;
  let result: GameResult | null = null;
  let winReason: WinReason | null = null;
  if (over) {
    nextStatus = 'completed';
    winnerId = userId;
    loserId = opponentId;
    result = seat === 'player1' ? '1-0' : '0-1';
    winReason = 'fleet_destroyed';
  }

  const shotsCol = seat === 'player1' ? 'player1_shots' : 'player2_shots';
  const shotsJson = JSON.stringify(newShots);

  // CAS on ply + status='active' + phase='active' to reject double-apply.
  const res = await query(
    `UPDATE battleship_matches
     SET ${shotsCol} = $1, ply = $2, move_count = $3, current_turn = $4,
         last_move = $5, status = $6, result = $7, winner_id = $8,
         loser_id = $9, win_reason = $10, completed_at = $11, updated_at = $12
     WHERE id = $13 AND ply = $14 AND status = 'active' AND phase = 'active'`,
    [
      shotsJson, ply, moveCount, nextTurn, String(cell), nextStatus, result,
      winnerId, loserId, winReason, over ? now : null, now, matchId, match.ply,
    ],
  );
  if ((res.rowCount ?? 0) === 0) {
    throw new Error('Shot was already processed (concurrent request).');
  }

  // Record the shot.
  await query(
    `INSERT INTO battleship_moves (id, match_id, player_id, ply, kind, cell, outcome, move_duration_ms, created_at)
     VALUES ($1, $2, $3, $4, 'shot', $5, $6, $7, $8)`,
    [crypto.randomUUID(), matchId, userId, ply, cell, resolved.shot.outcome, moveDurationMs, now],
  );

  if (!userId.startsWith('bot:')) {
    void recordGameTimeMetric({
      userId,
      gameType: 'battleship',
      durationMs: moveDurationMs,
      playedAtMs: now,
    }).catch((error) => {
      console.error('Failed to record battleship shot time:', error);
    });
  }

  let eloChange: EloChangeResult | null = null;
  const updatedMatch = (await getMatch(matchId))!;
  if (nextStatus === 'completed') {
    eloChange = await finalizeCompletedMatch(updatedMatch);
  }

  broadcast([`battleship:${matchId}`, 'battleshipMatch'], {
    matchId,
    type: 'shot',
    shooterId: userId,
    cell,
    outcome: resolved.shot.outcome,
    ply,
    gameOver: nextStatus === 'completed',
    winnerId,
    winReason,
  });

  return {
    ok: true,
    match: updatedMatch,
    shot: resolved.shot,
    fleetDestroyed: over,
    eloChange,
  };
}

// ---------------------------------------------------------------------------
// Resign resolution
// ---------------------------------------------------------------------------

function recordTerminalTime(match: BattleshipMatch, userId: string, now: number): void {
  if (userId.startsWith('bot:')) return;
  if (!match.updatedAt) return;
  const elapsed = Math.max(0, now - match.updatedAt);
  const durationMs = Math.min(elapsed, MAX_RECORDED_MOVE_MS);
  if (durationMs <= 0) return;
  void recordGameTimeMetric({
    userId,
    gameType: 'battleship',
    durationMs,
    playedAtMs: now,
  }).catch((error) => {
    console.error('Failed to record battleship terminal time:', error);
  });
}

/** Resign as userId (allowed during placement or active). Returns final match + Elo. */
export async function resignMatch(
  matchId: string,
  userId: string,
): Promise<{ match: BattleshipMatch; eloChange: EloChangeResult | null }> {
  const match = await getMatch(matchId);
  if (!match) throw new Error('Match not found.');
  if (match.status === 'waiting') throw new Error("Use cancel for matches that haven't started yet.");
  if (match.status !== 'active') throw new Error('Match is not in progress.');
  if (match.player1Id !== userId && match.player2Id !== userId) {
    throw new Error('Not a player in this match.');
  }

  const winnerId = match.player1Id === userId ? match.player2Id : match.player1Id;
  if (!winnerId) throw new Error('Opponent missing.');
  const now = Date.now();
  const result: GameResult = winnerId === match.player1Id ? '1-0' : '0-1';

  const updated = await query(
    `UPDATE battleship_matches
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
  const eloChange = await finalizeCompletedMatch(finalMatch);
  broadcast([`battleship:${matchId}`, 'battleshipMatch'], { matchId, type: 'resigned', by: userId });
  broadcast('battleshipLobby', { type: 'match_ended', matchId });
  return { match: finalMatch, eloChange };
}

// ---------------------------------------------------------------------------
// Finalize (Elo + Tickets + stats + bot speed-run)
// ---------------------------------------------------------------------------

async function finalizeCompletedMatch(match: BattleshipMatch): Promise<EloChangeResult | null> {
  if (!match.player2Id) return null;
  if (!match.winnerId || !match.loserId) return null;

  const winnerId = match.winnerId;
  const loserId = match.loserId;
  const isHuman1 = !match.player1Id.startsWith('bot:');
  const isHuman2 = !match.player2Id.startsWith('bot:');
  const isHumanMatch = isHuman1 && isHuman2;
  const outcome: MatchOutcome = winnerId === match.player1Id ? 'win_a' : 'win_b';

  const shotsFor = (id: string): Shot[] =>
    id === match.player1Id ? match.player1Shots : match.player2Shots;
  const hitsOf = (shots: Shot[]) =>
    shots.filter((s) => s.outcome === 'hit' || s.outcome === 'sunk').length;

  // Stats (human vs human only).
  if (isHumanMatch) {
    const isResign = match.winReason === 'resignation';
    const winnerShots = shotsFor(winnerId);
    const loserShots = shotsFor(loserId);
    await updateStats(winnerId, nameFor(match, winnerId), 'win', winnerShots.length, hitsOf(winnerShots));
    await updateStats(loserId, nameFor(match, loserId), isResign ? 'forfeit' : 'loss', loserShots.length, hitsOf(loserShots));
  }

  // Elo (human vs human only).
  let eloChange: EloChangeResult | null = null;
  if (isHumanMatch) {
    const tooFew = match.ply < MIN_PLY_FOR_ELO_FORFEIT && match.winReason !== 'fleet_destroyed';
    const pairForfeitCount = await countPairForfeits(winnerId, loserId, PAIR_FORFEIT_WINDOW_MS);
    const pairAbuse = pairForfeitCount >= PAIR_FORFEIT_THRESHOLD;
    if (pairAbuse) {
      eloChange = await penalizeForfeitLoserOnly(
        match.id, winnerId, loserId, nameFor(match, winnerId), nameFor(match, loserId),
      );
    } else {
      eloChange = await processRatedMatch(
        match.id, match.player1Id, match.player2Id, match.player1Name,
        match.player2Name ?? 'Unknown', outcome,
      );
    }
    if (tooFew || pairAbuse) {
      const recentForfeits = await countRecentForfeits(loserId, FORFEIT_FLAG_WINDOW_MS);
      const suspicious = tooFew || pairAbuse || recentForfeits >= FORFEIT_FLAG_THRESHOLD;
      void addAntiCheatLog({
        ts: Date.now(),
        gameType: 'battleship',
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

  // Tickets.
  const matchIsBot = match.player1Id.startsWith('bot:') || match.player2Id.startsWith('bot:');
  const botDifficulty: BotDifficulty | undefined = matchIsBot
    ? (botDifficultyFromId(match.player2Id.startsWith('bot:') ? match.player2Id : match.player1Id) ?? undefined)
    : undefined;

  if (!winnerId.startsWith('bot:')) {
    try {
      const context = { gameType: 'battleship', result: 'win', vsBot: matchIsBot, botDifficulty } as const;
      const reward = await awardGameRunCredits({
        userId: winnerId,
        context,
        sourceId: `battleship-win:${match.id}:${winnerId}`,
        meta: { matchId: match.id, winReason: match.winReason },
      });
      await recordMatchRunResult({ matchId: match.id, userId: winnerId, context, reward });
    } catch (error) {
      console.error('Failed to award battleship winner credits:', error);
    }
  }
  if (!loserId.startsWith('bot:')) {
    try {
      const context = { gameType: 'battleship', result: 'loss', vsBot: matchIsBot, botDifficulty } as const;
      const reward = await awardGameRunCredits({
        userId: loserId,
        context,
        sourceId: `battleship-loss:${match.id}:${loserId}`,
        meta: { matchId: match.id, winReason: match.winReason },
      });
      await recordMatchRunResult({ matchId: match.id, userId: loserId, context, reward });
    } catch (error) {
      console.error('Failed to award battleship loser credits:', error);
    }
  }

  // Bot speed-run record: when a HUMAN sinks a BOT's whole fleet, record their
  // fewest-shots time for the per-difficulty bot leaderboard.
  if (
    matchIsBot
    && botDifficulty
    && !winnerId.startsWith('bot:')
    && match.winReason === 'fleet_destroyed'
  ) {
    void recordBotSpeedRun(match.id, winnerId, nameFor(match, winnerId), botDifficulty)
      .catch((error) => {
        console.error('Failed to record battleship bot speed run:', error);
      });
  }

  broadcast('gameLeaderboards', { gameType: 'battleship', updatedAt: Date.now() });
  return eloChange;
}

function nameFor(match: BattleshipMatch, userId: string): string {
  if (match.player1Id === userId) return match.player1Name;
  if (match.player2Id === userId) return match.player2Name ?? 'Unknown';
  return 'Unknown';
}

async function countRecentForfeits(byUserId: string, windowMs: number): Promise<number> {
  const since = Date.now() - windowMs;
  const r = await queryOne<{ cnt: unknown }>(
    `SELECT COUNT(*) AS cnt FROM battleship_matches
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
    `SELECT COUNT(*) AS cnt FROM battleship_matches
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

type StatResult = 'win' | 'loss' | 'forfeit';

async function updateStats(
  userId: string,
  userName: string,
  result: StatResult,
  shotsFired: number,
  hitsLanded: number,
): Promise<void> {
  const now = Date.now();
  const existing = await queryOne<{
    wins: string | number;
    losses: string | number;
    draws: string | number;
    forfeits: string | number;
    currentStreak: string | number;
    bestStreak: string | number;
    totalShots: string | number;
    totalHits: string | number;
  }>(
    `SELECT wins, losses, draws, forfeits,
            current_streak AS "currentStreak", best_streak AS "bestStreak",
            total_shots AS "totalShots", total_hits AS "totalHits"
     FROM battleship_stats
     WHERE user_id = $1`,
    [userId],
  );

  if (!existing) {
    await query(
      `INSERT INTO battleship_stats
         (user_id, user_name, wins, losses, draws, forfeits, current_streak,
          best_streak, total_shots, total_hits, updated_at)
       VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8, $9, $10)`,
      [
        userId,
        userName,
        result === 'win' ? 1 : 0,
        result === 'loss' || result === 'forfeit' ? 1 : 0,
        result === 'forfeit' ? 1 : 0,
        result === 'win' ? 1 : 0,
        result === 'win' ? 1 : 0,
        shotsFired,
        hitsLanded,
        now,
      ],
    );
    return;
  }

  const wins = toNum(existing.wins) + (result === 'win' ? 1 : 0);
  const losses = toNum(existing.losses) + (result === 'loss' || result === 'forfeit' ? 1 : 0);
  const forfeits = toNum(existing.forfeits) + (result === 'forfeit' ? 1 : 0);
  const currentStreak = result === 'win' ? toNum(existing.currentStreak) + 1 : 0;
  const bestStreak = Math.max(toNum(existing.bestStreak), currentStreak);
  const totalShots = toNum(existing.totalShots) + shotsFired;
  const totalHits = toNum(existing.totalHits) + hitsLanded;

  await query(
    `UPDATE battleship_stats
     SET user_name = $1, wins = $2, losses = $3, forfeits = $4,
         current_streak = $5, best_streak = $6, total_shots = $7, total_hits = $8,
         updated_at = $9
     WHERE user_id = $10`,
    [userName, wins, losses, forfeits, currentStreak, bestStreak, totalShots, totalHits, now, userId],
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
    `SELECT id FROM battleship_matches WHERE status = 'waiting' AND updated_at < $1 LIMIT $2`,
    [waitingCutoff, batchSize],
  );
  const staleFinished = await query<{ id: string }>(
    `SELECT id FROM battleship_matches
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
    'DELETE FROM battleship_moves WHERE match_id = ANY($1)', [ids],
  )).rowCount ?? 0;
  const deletedEloHistory = (await query(
    'DELETE FROM battleship_elo_history WHERE match_id = ANY($1)', [ids],
  )).rowCount ?? 0;
  const deletedMatches = (await query(
    'DELETE FROM battleship_matches WHERE id = ANY($1)', [ids],
  )).rowCount ?? 0;
  return { deletedMatches, deletedMoves, deletedEloHistory };
}

export async function maybeRunBattleshipDataRetentionCleanup(): Promise<void> {
  const now = Date.now();
  if (now - lastRetentionRunAt < RETENTION_MIN_INTERVAL_MS) return;
  lastRetentionRunAt = now;
  try {
    const stale = await listStaleMatchIds({ now, batchSize: RETENTION_BATCH_SIZE });
    await deleteMatchesById(stale);
  } catch (error) {
    console.error('Battleship retention cleanup failed', error);
  }
}

// ---------------------------------------------------------------------------
// Bot worker — auto-placement + shot replies + crash/restart recovery
// ---------------------------------------------------------------------------

/** Per-process guard preventing overlapping bot jobs for the same match. */
const botJobs = new Set<string>();

/**
 * Drive the bot for a match: place its fleet during placement, then fire when
 * it is its turn during the battle. Fair-play: the bot's `computeBotShot` only
 * sees its own shot history, never the opponent's hidden board.
 */
export async function runBotReply(matchId: string): Promise<void> {
  if (botJobs.has(matchId)) return;
  botJobs.add(matchId);
  try {
    for (let guard = 0; guard < 200; guard++) {
      const match = await getMatch(matchId);
      if (!match || match.status !== 'active') return;

      // Placement: auto-place the bot's fleet if it hasn't readied yet.
      if (match.phase === 'placement') {
        const botSeat = isBotUser(match.player1Id) ? 'player1'
          : (match.player2Id && isBotUser(match.player2Id)) ? 'player2'
          : null;
        if (!botSeat) return;
        const botId = botSeat === 'player1' ? match.player1Id : match.player2Id!;
        const ready = botSeat === 'player1' ? match.player1Ready : match.player2Ready;
        if (ready) return; // waiting on the human to place — nothing to do
        try {
          await submitPlacement(matchId, botId, randomFleet());
        } catch (err) {
          console.error('Bot placement failed:', err);
          return;
        }
        continue;
      }

      // Battle: fire when it is the bot's turn.
      if (match.phase !== 'active') return;
      if (!match.currentTurn || !isBotUser(match.currentTurn)) return;
      const difficulty = botDifficultyFromId(match.currentTurn) ?? 'medium';
      const botShots = match.currentTurn === match.player1Id ? match.player1Shots : match.player2Shots;
      const cell = computeBotShot(botShots, difficulty as BotDifficulty);
      await submitShot(matchId, match.currentTurn, cell);
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
  const result = await query<BattleshipMatchRow>(
    `SELECT ${MATCH_SELECT} FROM battleship_matches WHERE status = 'active'`,
  );
  let kicked = 0;
  for (const row of result.rows) {
    const match = rowToMatch(row);
    const botInvolved = isBotUser(match.player1Id) || (match.player2Id != null && isBotUser(match.player2Id));
    if (!botInvolved) continue;
    if (botJobs.has(match.id)) continue;

    // Only kick when there's actually bot work pending.
    const botSeat = isBotUser(match.player1Id) ? 'player1'
      : (match.player2Id && isBotUser(match.player2Id)) ? 'player2' : null;
    const botReady = botSeat === 'player1' ? match.player1Ready : botSeat === 'player2' ? match.player2Ready : true;
    const needsPlacement = match.phase === 'placement' && !botReady;
    const needsShot = match.phase === 'active' && match.currentTurn != null && isBotUser(match.currentTurn);
    if (!needsPlacement && !needsShot) continue;

    void runBotReply(match.id);
    kicked++;
  }
  return kicked;
}
