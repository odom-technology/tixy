// ---------------------------------------------------------------------------
// Chess — Tournament Bracket System (ported from pool-tournament).
//
// Manages tournament lifecycle: registration → seeding → bracket progression.
// Supports single elimination, double elimination (losers bracket), BO1/BO3.
// Tournament matches are regular chessMatches linked via tournamentMatchId.
// Handles draws as replays within the series (with a safety cap).
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { query, queryOne } from '@/server/db/client';
import { broadcast } from '@/server/events';
import { getElo, STARTING_ELO } from '@/server/arcade/chess-elo';
import { resolveTimeFormat, type ChessMatch } from '@/features/arcade/lib/chess/types';
import { createBulkNotifications } from '@/server/services/notifications';
import {
  cancelTournamentMatchWagers,
  settleTournamentMatchWagers,
} from '@/server/arcade/chess-tournament-wagers';
import {
  CHESS_TOURNAMENT_DEFAULT_MAX_BET,
  CHESS_TOURNAMENT_DEFAULT_MIN_BET,
} from '@/server/arcade/chess-wager-constants';
import { registerChessMatchCompletedHandler } from '@/server/arcade/chess-match-completion-events';

type ChessMatchLib = {
  createMatch: (
    userId: string,
    userName: string,
    options?: {
      invitedUserId?: string | null;
      tournamentMatchId?: string | null;
      timeFormatId?: string;
    },
  ) => Promise<ChessMatch>;
  joinMatch: (matchId: string, userId: string, userName: string) => Promise<ChessMatch>;
  getMatch: (matchId: string) => Promise<ChessMatch | null>;
  resignMatch: (matchId: string, userId: string) => Promise<unknown>;
};

function getChessMatchLib(): ChessMatchLib {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@/server/arcade/chess-match') as ChessMatchLib;
}

export type TournamentStatus = 'registration' | 'active' | 'completed';
export type TournamentFormat = 'bo1' | 'bo3';
export type TournamentBracketType = 'winners' | 'losers' | 'grand_final';
export type TournamentMatchStatus = 'pending' | 'active' | 'completed';

export type Tournament = {
  id: string;
  name: string;
  createdBy: string;
  createdByName: string;
  status: TournamentStatus;
  format: TournamentFormat;
  timeFormat: string;
  initialTimeMs: number;
  incrementMs: number;
  hasLosersBracket: boolean;
  bettingEnabled: boolean;
  minBet: number;
  maxBet: number;
  totalRounds: number | null;
  currentRound: number | null;
  winnerId: string | null;
  winnerName: string | null;
  participantCount: number;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
};

export type TournamentParticipant = {
  tournamentId: string;
  userId: string;
  userName: string;
  seed: number | null;
  eloAtRegistration: number;
  eliminatedInRound: number | null;
  eliminatedFrom: string | null;
  placement: number | null;
  registeredAt: number;
};

// fallow-ignore-next-line duplicate-export
export type TournamentMatch = {
  id: string;
  tournamentId: string;
  bracket: TournamentBracketType;
  round: number;
  position: number;
  player1Id: string | null;
  player2Id: string | null;
  player1Name: string | null;
  player2Name: string | null;
  isBye: boolean;
  seriesMatchIds: string[];
  player1Wins: number;
  player2Wins: number;
  draws: number;
  winnerId: string | null;
  loserId: string | null;
  status: TournamentMatchStatus;
  overriddenBy: string | null;
  overrideReason: string | null;
  createdAt: number;
  completedAt: number | null;
};

const toNum = (value: unknown): number => (value == null ? 0 : Number(value));
const toNumOrNull = (value: unknown): number | null =>
  value == null ? null : Number(value);
const toBool = (value: unknown): boolean => value === true || value === 1;

const TOURNAMENT_SELECT = `
  id,
  name,
  created_by AS "createdBy",
  created_by_name AS "createdByName",
  status,
  format,
  time_format AS "timeFormat",
  initial_time_ms AS "initialTimeMs",
  increment_ms AS "incrementMs",
  has_losers_bracket AS "hasLosersBracket",
  betting_enabled AS "bettingEnabled",
  min_bet AS "minBet",
  max_bet AS "maxBet",
  total_rounds AS "totalRounds",
  current_round AS "currentRound",
  winner_id AS "winnerId",
  winner_name AS "winnerName",
  participant_count AS "participantCount",
  created_at AS "createdAt",
  started_at AS "startedAt",
  completed_at AS "completedAt"
`;

type TournamentRow = Record<string, unknown> & {
  id: string;
  name: string;
  createdBy: string;
  createdByName: string;
  status: string;
  format: string;
  timeFormat: string;
  winnerId: string | null;
  winnerName: string | null;
};

const TOURNAMENT_MATCH_SELECT = `
  id,
  tournament_id AS "tournamentId",
  bracket,
  round,
  position,
  player1_id AS "player1Id",
  player2_id AS "player2Id",
  player1_name AS "player1Name",
  player2_name AS "player2Name",
  is_bye AS "isBye",
  series_match_ids AS "seriesMatchIds",
  player1_wins AS "player1Wins",
  player2_wins AS "player2Wins",
  draws,
  winner_id AS "winnerId",
  loser_id AS "loserId",
  status,
  overridden_by AS "overriddenBy",
  override_reason AS "overrideReason",
  created_at AS "createdAt",
  completed_at AS "completedAt"
`;

type TournamentMatchRow = Record<string, unknown> & {
  id: string;
  tournamentId: string;
  bracket: string;
  player1Id: string | null;
  player2Id: string | null;
  player1Name: string | null;
  player2Name: string | null;
  seriesMatchIds: string | null;
  winnerId: string | null;
  loserId: string | null;
  status: string;
  overriddenBy: string | null;
  overrideReason: string | null;
};

const PARTICIPANT_SELECT = `
  tournament_id AS "tournamentId",
  user_id AS "userId",
  user_name AS "userName",
  seed,
  elo_at_registration AS "eloAtRegistration",
  eliminated_in_round AS "eliminatedInRound",
  eliminated_from AS "eliminatedFrom",
  placement,
  registered_at AS "registeredAt"
`;

type ParticipantRow = Record<string, unknown> & {
  tournamentId: string;
  userId: string;
  userName: string;
  eliminatedFrom: string | null;
};

function rowToTournament(row: TournamentRow): Tournament {
  return {
    id: row.id,
    name: row.name,
    createdBy: row.createdBy,
    createdByName: row.createdByName,
    status: row.status as TournamentStatus,
    format: row.format as TournamentFormat,
    timeFormat: row.timeFormat,
    initialTimeMs: toNum(row.initialTimeMs),
    incrementMs: toNum(row.incrementMs),
    hasLosersBracket: toBool(row.hasLosersBracket),
    bettingEnabled: toBool(row.bettingEnabled),
    minBet: toNumOrNull(row.minBet) ?? CHESS_TOURNAMENT_DEFAULT_MIN_BET,
    maxBet: toNumOrNull(row.maxBet) ?? CHESS_TOURNAMENT_DEFAULT_MAX_BET,
    totalRounds: toNumOrNull(row.totalRounds),
    currentRound: toNumOrNull(row.currentRound),
    winnerId: row.winnerId ?? null,
    winnerName: row.winnerName ?? null,
    participantCount: toNum(row.participantCount),
    createdAt: toNum(row.createdAt),
    startedAt: toNumOrNull(row.startedAt),
    completedAt: toNumOrNull(row.completedAt),
  };
}

function rowToTournamentMatch(row: TournamentMatchRow): TournamentMatch {
  let seriesMatchIds: string[] = [];
  if (row.seriesMatchIds) {
    try { seriesMatchIds = JSON.parse(row.seriesMatchIds) as string[]; } catch { /* empty */ }
  }
  return {
    id: row.id,
    tournamentId: row.tournamentId,
    bracket: row.bracket as TournamentBracketType,
    round: toNum(row.round),
    position: toNum(row.position),
    player1Id: row.player1Id ?? null,
    player2Id: row.player2Id ?? null,
    player1Name: row.player1Name ?? null,
    player2Name: row.player2Name ?? null,
    isBye: toBool(row.isBye),
    seriesMatchIds,
    player1Wins: toNum(row.player1Wins),
    player2Wins: toNum(row.player2Wins),
    draws: toNum(row.draws),
    winnerId: row.winnerId ?? null,
    loserId: row.loserId ?? null,
    status: row.status as TournamentMatchStatus,
    overriddenBy: row.overriddenBy ?? null,
    overrideReason: row.overrideReason ?? null,
    createdAt: toNum(row.createdAt),
    completedAt: toNumOrNull(row.completedAt),
  };
}

function rowToParticipant(row: ParticipantRow): TournamentParticipant {
  return {
    tournamentId: row.tournamentId,
    userId: row.userId,
    userName: row.userName,
    seed: toNumOrNull(row.seed),
    eloAtRegistration: toNum(row.eloAtRegistration),
    eliminatedInRound: toNumOrNull(row.eliminatedInRound),
    eliminatedFrom: row.eliminatedFrom ?? null,
    placement: toNumOrNull(row.placement),
    registeredAt: toNum(row.registeredAt),
  };
}

function nextPowerOf2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function generateSeedOrder(numSlots: number): number[] {
  if (numSlots === 1) return [1];
  const half = generateSeedOrder(numSlots / 2);
  return half.flatMap((seed) => [seed, numSlots + 1 - seed]);
}

function winsNeeded(format: TournamentFormat): number {
  return format === 'bo3' ? 2 : 1;
}

/** Max games in a series — caps runaway draws. */
function maxGamesInSeries(format: TournamentFormat): number {
  return format === 'bo3' ? 5 : 3; // 2N+1 or 3 for BO1 (allows 2 draws before tiebreak)
}

async function insertTournamentMatch(values: {
  id: string;
  tournamentId: string;
  bracket: TournamentBracketType;
  round: number;
  position: number;
  player1Id: string | null;
  player2Id: string | null;
  player1Name: string | null;
  player2Name: string | null;
  isBye: boolean;
  status: TournamentMatchStatus;
  createdAt: number;
  completedAt: number | null;
}): Promise<void> {
  await query(
    `INSERT INTO chess_tournament_matches
       (id, tournament_id, bracket, round, position, player1_id, player2_id,
        player1_name, player2_name, is_bye, series_match_ids, player1_wins,
        player2_wins, draws, winner_id, loser_id, status, overridden_by,
        override_reason, created_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, 0, 0, 0,
             NULL, NULL, $11, NULL, NULL, $12, $13)`,
    [
      values.id, values.tournamentId, values.bracket, values.round,
      values.position, values.player1Id, values.player2Id, values.player1Name,
      values.player2Name, values.isBye, values.status, values.createdAt,
      values.completedAt,
    ],
  );
}

export async function createTournament({
  name,
  format,
  timeFormatId,
  hasLosersBracket,
  bettingEnabled = false,
  minBet = CHESS_TOURNAMENT_DEFAULT_MIN_BET,
  maxBet = CHESS_TOURNAMENT_DEFAULT_MAX_BET,
  createdBy,
  createdByName,
}: {
  name: string;
  format: TournamentFormat;
  timeFormatId?: string;
  hasLosersBracket: boolean;
  bettingEnabled?: boolean;
  minBet?: number;
  maxBet?: number;
  createdBy: string;
  createdByName: string;
}): Promise<Tournament> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const preset = resolveTimeFormat(timeFormatId);

  const tournament: Tournament = {
    id,
    name,
    createdBy,
    createdByName,
    status: 'registration',
    format,
    timeFormat: preset.id,
    initialTimeMs: preset.initialTimeMs,
    incrementMs: preset.incrementMs,
    hasLosersBracket,
    bettingEnabled,
    minBet,
    maxBet,
    totalRounds: null,
    currentRound: null,
    winnerId: null,
    winnerName: null,
    participantCount: 0,
    createdAt: now,
    startedAt: null,
    completedAt: null,
  };

  await query(
    `INSERT INTO chess_tournaments
       (id, name, created_by, created_by_name, status, format, time_format,
        initial_time_ms, increment_ms, has_losers_bracket, betting_enabled,
        min_bet, max_bet, total_rounds, current_round, winner_id, winner_name,
        participant_count, created_at, started_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
             $16, $17, $18, $19, $20, $21)`,
    [
      tournament.id, tournament.name, tournament.createdBy,
      tournament.createdByName, tournament.status, tournament.format,
      tournament.timeFormat, tournament.initialTimeMs, tournament.incrementMs,
      tournament.hasLosersBracket, tournament.bettingEnabled, tournament.minBet,
      tournament.maxBet, tournament.totalRounds, tournament.currentRound,
      tournament.winnerId, tournament.winnerName, tournament.participantCount,
      tournament.createdAt, tournament.startedAt, tournament.completedAt,
    ],
  );
  broadcast('chessTournament', { type: 'tournament_created', tournamentId: id });
  return tournament;
}

export async function getTournament(id: string): Promise<Tournament | null> {
  const row = await queryOne<TournamentRow>(
    `SELECT ${TOURNAMENT_SELECT} FROM chess_tournaments WHERE id = $1`,
    [id],
  );
  return row ? rowToTournament(row) : null;
}

export async function getTournaments(): Promise<Tournament[]> {
  const result = await query<TournamentRow>(
    `SELECT ${TOURNAMENT_SELECT} FROM chess_tournaments
     ORDER BY created_at DESC
     LIMIT 20`,
  );
  return result.rows.map(rowToTournament);
}

export async function getParticipants(tournamentId: string): Promise<TournamentParticipant[]> {
  const result = await query<ParticipantRow>(
    `SELECT ${PARTICIPANT_SELECT} FROM chess_tournament_participants
     WHERE tournament_id = $1
     ORDER BY elo_at_registration DESC`,
    [tournamentId],
  );
  return result.rows.map(rowToParticipant);
}

export async function registerForTournament(tournamentId: string, userId: string, userName: string): Promise<void> {
  const tournament = await getTournament(tournamentId);
  if (!tournament) throw new Error('Tournament not found.');
  if (tournament.status !== 'registration') throw new Error('Registration is closed.');

  const existing = await queryOne(
    `SELECT user_id FROM chess_tournament_participants
     WHERE tournament_id = $1 AND user_id = $2`,
    [tournamentId, userId],
  );
  if (existing) throw new Error('Already registered.');

  const elo = await getElo(userId);
  const eloRating = elo?.eloRating ?? STARTING_ELO;

  await query(
    `INSERT INTO chess_tournament_participants
       (tournament_id, user_id, user_name, seed, elo_at_registration,
        eliminated_in_round, eliminated_from, placement, registered_at)
     VALUES ($1, $2, $3, NULL, $4, NULL, NULL, NULL, $5)`,
    [tournamentId, userId, userName, eloRating, Date.now()],
  );

  await query(
    `UPDATE chess_tournaments
     SET participant_count = participant_count + 1
     WHERE id = $1`,
    [tournamentId],
  );

  broadcast('chessTournament', { type: 'registration_updated', tournamentId });
}

export async function unregisterFromTournament(tournamentId: string, userId: string): Promise<void> {
  const tournament = await getTournament(tournamentId);
  if (!tournament) throw new Error('Tournament not found.');
  if (tournament.status !== 'registration') throw new Error('Cannot unregister after tournament has started.');

  const result = await query(
    `DELETE FROM chess_tournament_participants
     WHERE tournament_id = $1 AND user_id = $2`,
    [tournamentId, userId],
  );

  if ((result.rowCount ?? 0) === 0) throw new Error('Not registered.');

  await query(
    `UPDATE chess_tournaments
     SET participant_count = GREATEST(0, participant_count - 1)
     WHERE id = $1`,
    [tournamentId],
  );

  broadcast('chessTournament', { type: 'registration_updated', tournamentId });
}

async function createTournamentChessMatch(
  tournamentMatchId: string,
  p1Id: string,
  p1Name: string,
  p2Id: string,
  p2Name: string,
  tournament: Tournament,
): Promise<string> {
  const { createMatch, joinMatch } = getChessMatchLib();
  const match = await createMatch(p1Id, p1Name, {
    invitedUserId: p2Id,
    tournamentMatchId,
    timeFormatId: tournament.timeFormat,
  });
  await joinMatch(match.id, p2Id, p2Name);
  return match.id;
}

export async function startTournament(tournamentId: string): Promise<Tournament> {
  const tournament = await getTournament(tournamentId);
  if (!tournament) throw new Error('Tournament not found.');
  if (tournament.status !== 'registration') throw new Error('Tournament already started.');

  const participants = await getParticipants(tournamentId);
  if (participants.length < 2) throw new Error('Need at least 2 participants.');

  const sorted = [...participants].sort((a, b) => b.eloAtRegistration - a.eloAtRegistration);
  for (let i = 0; i < sorted.length; i++) {
    await query(
      `UPDATE chess_tournament_participants
       SET seed = $1
       WHERE tournament_id = $2 AND user_id = $3`,
      [i + 1, tournamentId, sorted[i].userId],
    );
    sorted[i].seed = i + 1;
  }

  const numSlots = nextPowerOf2(sorted.length);
  const totalWinnersRounds = Math.log2(numSlots);
  const seedOrder = generateSeedOrder(numSlots);
  const now = Date.now();

  const seedMap = new Map<number, TournamentParticipant>();
  for (const p of sorted) if (p.seed !== null) seedMap.set(p.seed, p);

  const round1Matches: Array<{
    id: string;
    position: number;
    p1: TournamentParticipant | null;
    p2: TournamentParticipant | null;
  }> = [];

  for (let i = 0; i < seedOrder.length; i += 2) {
    const seed1 = seedOrder[i];
    const seed2 = seedOrder[i + 1];
    const p1 = seedMap.get(seed1) ?? null;
    const p2 = seedMap.get(seed2) ?? null;
    const matchId = crypto.randomUUID();
    const isBye = !p1 || !p2;
    const position = i / 2 + 1;

    await insertTournamentMatch({
      id: matchId,
      tournamentId,
      bracket: 'winners',
      round: 1,
      position,
      player1Id: p1?.userId ?? null,
      player2Id: p2?.userId ?? null,
      player1Name: p1?.userName ?? null,
      player2Name: p2?.userName ?? null,
      isBye,
      status: isBye ? 'completed' : 'pending',
      createdAt: now,
      completedAt: isBye ? now : null,
    });
    round1Matches.push({ id: matchId, position, p1, p2 });
  }

  for (let round = 2; round <= totalWinnersRounds; round++) {
    const matchesInRound = numSlots / Math.pow(2, round);
    for (let pos = 1; pos <= matchesInRound; pos++) {
      await insertTournamentMatch({
        id: crypto.randomUUID(),
        tournamentId,
        bracket: 'winners',
        round,
        position: pos,
        player1Id: null, player2Id: null, player1Name: null, player2Name: null,
        isBye: false,
        status: 'pending',
        createdAt: now,
        completedAt: null,
      });
    }
  }

  if (tournament.hasLosersBracket && totalWinnersRounds > 1) {
    const totalLosersRounds = 2 * (totalWinnersRounds - 1);
    for (let round = 1; round <= totalLosersRounds; round++) {
      let matchesInRound: number;
      if (round === 1) matchesInRound = numSlots / 4;
      else if (round % 2 === 0) matchesInRound = getMatchCountForLosersRound(round - 1, numSlots);
      else matchesInRound = Math.max(1, getMatchCountForLosersRound(round - 1, numSlots) / 2);

      for (let pos = 1; pos <= matchesInRound; pos++) {
        await insertTournamentMatch({
          id: crypto.randomUUID(),
          tournamentId,
          bracket: 'losers',
          round,
          position: pos,
          player1Id: null, player2Id: null, player1Name: null, player2Name: null,
          isBye: false,
          status: 'pending',
          createdAt: now,
          completedAt: null,
        });
      }
    }

    // Grand final + reset
    for (const gfRound of [1, 2] as const) {
      await insertTournamentMatch({
        id: crypto.randomUUID(),
        tournamentId,
        bracket: 'grand_final',
        round: gfRound,
        position: 1,
        player1Id: null, player2Id: null, player1Name: null, player2Name: null,
        isBye: false,
        status: 'pending',
        createdAt: now,
        completedAt: null,
      });
    }
  }

  // Byes
  for (const m of round1Matches) {
    if (m.p1 && !m.p2) {
      await query(
        `UPDATE chess_tournament_matches
         SET winner_id = $1, loser_id = NULL, status = 'completed', completed_at = $2
         WHERE id = $3`,
        [m.p1.userId, now, m.id],
      );
      await advanceWinner(tournamentId, 'winners', 1, m.position, m.p1.userId, m.p1.userName, null, null, tournament);
    } else if (!m.p1 && m.p2) {
      await query(
        `UPDATE chess_tournament_matches
         SET winner_id = $1, loser_id = NULL, status = 'completed', completed_at = $2
         WHERE id = $3`,
        [m.p2.userId, now, m.id],
      );
      await advanceWinner(tournamentId, 'winners', 1, m.position, m.p2.userId, m.p2.userName, null, null, tournament);
    }
  }

  // Activate non-bye R1 matches
  const activableR1 = (await query<TournamentMatchRow>(
    `SELECT ${TOURNAMENT_MATCH_SELECT} FROM chess_tournament_matches
     WHERE tournament_id = $1 AND bracket = 'winners' AND round = 1 AND status = 'pending'`,
    [tournamentId],
  )).rows.filter((m) => m.player1Id && m.player2Id);

  for (const m of activableR1) {
    const chessMatchId = await createTournamentChessMatch(m.id, m.player1Id!, m.player1Name!, m.player2Id!, m.player2Name!, tournament);
    await query(
      `UPDATE chess_tournament_matches
       SET status = 'active', series_match_ids = $1
       WHERE id = $2`,
      [JSON.stringify([chessMatchId]), m.id],
    );
  }

  await tryActivatePendingMatches(tournamentId, tournament);

  await query(
    `UPDATE chess_tournaments
     SET status = 'active', total_rounds = $1, current_round = 1, started_at = $2
     WHERE id = $3`,
    [totalWinnersRounds, now, tournamentId],
  );

  void createBulkNotifications(sorted.map((p) => ({
    userId: p.userId,
    type: 'game_turn' as const,
    title: 'Chess tournament started!',
    body: `${tournament.name} has begun. Check the bracket for your first match.`,
    href: '/chess',
    preferenceKey: 'game_notifications' as const,
  })));

  broadcast('chessTournament', { type: 'tournament_started', tournamentId });
  return (await getTournament(tournamentId))!;
}

function getMatchCountForLosersRound(round: number, numSlots: number): number {
  const pairIndex = Math.floor((round - 1) / 2);
  return Math.max(1, numSlots / Math.pow(2, pairIndex + 2));
}

async function getTournamentMatchBySlot(
  tournamentId: string,
  bracket: TournamentBracketType,
  round: number,
  position?: number,
): Promise<TournamentMatchRow | null> {
  if (position === undefined) {
    return queryOne<TournamentMatchRow>(
      `SELECT ${TOURNAMENT_MATCH_SELECT} FROM chess_tournament_matches
       WHERE tournament_id = $1 AND bracket = $2 AND round = $3`,
      [tournamentId, bracket, round],
    );
  }
  return queryOne<TournamentMatchRow>(
    `SELECT ${TOURNAMENT_MATCH_SELECT} FROM chess_tournament_matches
     WHERE tournament_id = $1 AND bracket = $2 AND round = $3 AND position = $4`,
    [tournamentId, bracket, round, position],
  );
}

async function setTournamentMatchPlayers(
  matchId: string,
  update: Partial<Record<'player1Id' | 'player1Name' | 'player2Id' | 'player2Name', string | null>>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if ('player1Id' in update) { sets.push(`player1_id = $${i++}`); values.push(update.player1Id ?? null); }
  if ('player1Name' in update) { sets.push(`player1_name = $${i++}`); values.push(update.player1Name ?? null); }
  if ('player2Id' in update) { sets.push(`player2_id = $${i++}`); values.push(update.player2Id ?? null); }
  if ('player2Name' in update) { sets.push(`player2_name = $${i++}`); values.push(update.player2Name ?? null); }
  if (sets.length === 0) return;
  values.push(matchId);
  await query(
    `UPDATE chess_tournament_matches SET ${sets.join(', ')} WHERE id = $${i}`,
    values,
  );
}

async function advanceWinner(
  tournamentId: string,
  bracket: TournamentBracketType,
  round: number,
  position: number,
  winnerId: string,
  winnerName: string,
  loserId: string | null,
  loserName: string | null,
  tournament: Tournament,
): Promise<void> {
  if (bracket === 'winners') {
    const nextRound = round + 1;
    const nextPosition = Math.ceil(position / 2);
    const isPlayer1Slot = position % 2 === 1;

    const nextMatch = await getTournamentMatchBySlot(tournamentId, 'winners', nextRound, nextPosition);

    if (nextMatch) {
      if (isPlayer1Slot) {
        await setTournamentMatchPlayers(nextMatch.id, { player1Id: winnerId, player1Name: winnerName });
      } else {
        await setTournamentMatchPlayers(nextMatch.id, { player2Id: winnerId, player2Name: winnerName });
      }
    } else if (tournament.hasLosersBracket) {
      const grandFinal = await getTournamentMatchBySlot(tournamentId, 'grand_final', 1);

      if (grandFinal) {
        await setTournamentMatchPlayers(grandFinal.id, { player1Id: winnerId, player1Name: winnerName });
      } else {
        await completeTournament(tournamentId, winnerId, winnerName);
        return;
      }
    } else {
      await completeTournament(tournamentId, winnerId, winnerName);
      return;
    }

    if (tournament.hasLosersBracket && loserId && loserName) {
      await dropToLosersBracket(tournamentId, round, position, loserId, loserName, tournament);
    } else if (loserId) {
      await eliminatePlayer(tournamentId, loserId, round, 'winners');
    }
  } else if (bracket === 'losers') {
    const nextRound = round + 1;
    const totalLosersRounds = tournament.totalRounds ? 2 * (tournament.totalRounds - 1) : 0;
    if (round >= totalLosersRounds) {
      const grandFinal = await getTournamentMatchBySlot(tournamentId, 'grand_final', 1);
      if (grandFinal) {
        await setTournamentMatchPlayers(grandFinal.id, { player2Id: winnerId, player2Name: winnerName });
      }
    } else {
      const nextRoundIsDropRound = nextRound % 2 === 0;
      const nextPosition = nextRoundIsDropRound ? position : Math.ceil(position / 2);

      const nextMatch = await getTournamentMatchBySlot(tournamentId, 'losers', nextRound, nextPosition);

      if (nextMatch) {
        if (nextRoundIsDropRound) {
          if (!nextMatch.player1Id) {
            await setTournamentMatchPlayers(nextMatch.id, { player1Id: winnerId, player1Name: winnerName });
          } else if (!nextMatch.player2Id) {
            await setTournamentMatchPlayers(nextMatch.id, { player2Id: winnerId, player2Name: winnerName });
          }
        } else {
          const slotIsP1 = position % 2 === 1;
          if (slotIsP1 && !nextMatch.player1Id) {
            await setTournamentMatchPlayers(nextMatch.id, { player1Id: winnerId, player1Name: winnerName });
          } else if (!slotIsP1 && !nextMatch.player2Id) {
            await setTournamentMatchPlayers(nextMatch.id, { player2Id: winnerId, player2Name: winnerName });
          }
        }
      }
    }
    if (loserId) await eliminatePlayer(tournamentId, loserId, round, 'losers');
  } else if (bracket === 'grand_final') {
    if (round === 1) {
      const gfMatch = await getTournamentMatchBySlot(tournamentId, 'grand_final', 1);

      if (gfMatch && winnerId === gfMatch.player2Id) {
        const resetMatch = await getTournamentMatchBySlot(tournamentId, 'grand_final', 2);
        if (resetMatch) {
          await setTournamentMatchPlayers(resetMatch.id, {
            player1Id: gfMatch.player1Id,
            player1Name: gfMatch.player1Name,
            player2Id: gfMatch.player2Id,
            player2Name: gfMatch.player2Name,
          });
        }
        return;
      }
      await completeTournament(tournamentId, winnerId, winnerName);
      if (loserId) await eliminatePlayer(tournamentId, loserId, round, 'grand_final');
    } else {
      await completeTournament(tournamentId, winnerId, winnerName);
      if (loserId) await eliminatePlayer(tournamentId, loserId, round, 'grand_final');
    }
  }
}

async function dropToLosersBracket(
  tournamentId: string,
  fromWinnersRound: number,
  fromPosition: number,
  loserId: string,
  loserName: string,
  tournament: Tournament,
): Promise<void> {
  if (!tournament.totalRounds || tournament.totalRounds < 2) return;
  const losersRound =
    fromWinnersRound === 1 ? 1 : Math.min(2 * (fromWinnersRound - 1), 2 * (tournament.totalRounds - 1));
  const losersPosition = fromWinnersRound === 1 ? Math.ceil(fromPosition / 2) : fromPosition;

  const targetMatch = await getTournamentMatchBySlot(tournamentId, 'losers', losersRound, losersPosition);

  if (!targetMatch) return;

  if (!targetMatch.player1Id) {
    await setTournamentMatchPlayers(targetMatch.id, { player1Id: loserId, player1Name: loserName });
  } else if (!targetMatch.player2Id) {
    await setTournamentMatchPlayers(targetMatch.id, { player2Id: loserId, player2Name: loserName });
  }
}

async function eliminatePlayer(tournamentId: string, userId: string, round: number, bracket: string): Promise<void> {
  const remaining = await queryOne<{ cnt: unknown }>(
    `SELECT COUNT(*) AS cnt FROM chess_tournament_participants
     WHERE tournament_id = $1 AND eliminated_in_round IS NULL`,
    [tournamentId],
  );

  await query(
    `UPDATE chess_tournament_participants
     SET eliminated_in_round = $1, eliminated_from = $2, placement = $3
     WHERE tournament_id = $4 AND user_id = $5`,
    [round, bracket, toNum(remaining?.cnt), tournamentId, userId],
  );
}

export async function deleteTournament(tournamentId: string): Promise<void> {
  const tMatchIds = (await query<{ id: string }>(
    `SELECT id FROM chess_tournament_matches WHERE tournament_id = $1`,
    [tournamentId],
  )).rows.map((r) => r.id);

  if (tMatchIds.length > 0) {
    await query(
      'DELETE FROM chess_matches WHERE tournament_match_id = ANY($1)',
      [tMatchIds],
    );
  }
  await query('DELETE FROM chess_tournament_wagers WHERE tournament_id = $1', [tournamentId]);
  await query('DELETE FROM chess_tournament_matches WHERE tournament_id = $1', [tournamentId]);
  await query('DELETE FROM chess_tournament_participants WHERE tournament_id = $1', [tournamentId]);
  await query('DELETE FROM chess_tournaments WHERE id = $1', [tournamentId]);
}

export async function completeTournament(tournamentId: string, winnerId: string, winnerName: string): Promise<void> {
  const now = Date.now();
  await query(
    `UPDATE chess_tournament_participants
     SET placement = 1
     WHERE tournament_id = $1 AND user_id = $2`,
    [tournamentId, winnerId],
  );

  await query(
    `UPDATE chess_tournaments
     SET status = 'completed', winner_id = $1, winner_name = $2, completed_at = $3
     WHERE id = $4`,
    [winnerId, winnerName, now, tournamentId],
  );

  const participants = await getParticipants(tournamentId);
  void createBulkNotifications(participants.map((p) => ({
    userId: p.userId,
    type: 'game_turn' as const,
    title: 'Chess tournament complete!',
    body: `${winnerName} won the tournament!`,
    href: '/chess',
    preferenceKey: 'game_notifications' as const,
  })));

  broadcast('chessTournament', { type: 'tournament_completed', tournamentId });
}

async function tryActivatePendingMatches(tournamentId: string, tournament: Tournament): Promise<void> {
  if (tournament.bettingEnabled) return;

  const pending = await query<TournamentMatchRow>(
    `SELECT ${TOURNAMENT_MATCH_SELECT} FROM chess_tournament_matches
     WHERE tournament_id = $1
       AND status = 'pending'
       AND player1_id IS NOT NULL
       AND player2_id IS NOT NULL
       AND is_bye = false`,
    [tournamentId],
  );

  for (const m of pending.rows) {
    const chessMatchId = await createTournamentChessMatch(m.id, m.player1Id!, m.player1Name!, m.player2Id!, m.player2Name!, tournament);
    await query(
      `UPDATE chess_tournament_matches
       SET status = 'active', series_match_ids = $1
       WHERE id = $2`,
      [JSON.stringify([chessMatchId]), m.id],
    );

    void createBulkNotifications([
      {
        userId: m.player1Id!,
        type: 'game_turn',
        title: 'Tournament match ready!',
        body: `Your ${tournament.name} match vs ${m.player2Name} is ready to play.`,
        href: `/chess/${chessMatchId}`,
        preferenceKey: 'game_notifications',
      },
      {
        userId: m.player2Id!,
        type: 'game_turn',
        title: 'Tournament match ready!',
        body: `Your ${tournament.name} match vs ${m.player1Name} is ready to play.`,
        href: `/chess/${chessMatchId}`,
        preferenceKey: 'game_notifications',
      },
    ]);
  }
}

async function onChessMatchCompleted(chessMatchId: string): Promise<void> {
  const { getMatch } = getChessMatchLib();
  const match = await getMatch(chessMatchId);
  if (!match?.tournamentMatchId) return;
  if (match.status !== 'completed' && match.status !== 'forfeited') return;

  const tMatchRow = await queryOne<TournamentMatchRow>(
    `SELECT ${TOURNAMENT_MATCH_SELECT} FROM chess_tournament_matches WHERE id = $1`,
    [match.tournamentMatchId],
  );
  if (!tMatchRow) return;
  const tMatch = rowToTournamentMatch(tMatchRow);
  if (tMatch.status === 'completed') return;

  const tournament = await getTournament(tMatch.tournamentId);
  if (!tournament) return;

  const isDraw = match.result === '1/2-1/2' || !match.winnerId;
  const isP1Winner = match.winnerId === tMatch.player1Id;
  const isP2Winner = match.winnerId === tMatch.player2Id;

  const newP1Wins = tMatch.player1Wins + (isP1Winner ? 1 : 0);
  const newP2Wins = tMatch.player2Wins + (isP2Winner ? 1 : 0);
  const newDraws = tMatch.draws + (isDraw ? 1 : 0);

  const existingSeriesIds = [...tMatch.seriesMatchIds];
  if (!existingSeriesIds.includes(chessMatchId)) existingSeriesIds.push(chessMatchId);

  const needed = winsNeeded(tournament.format);
  const gamesPlayed = newP1Wins + newP2Wins + newDraws;
  const maxGames = maxGamesInSeries(tournament.format);
  const seriesDecided =
    newP1Wins >= needed ||
    newP2Wins >= needed ||
    gamesPlayed >= maxGames;

  if (seriesDecided) {
    let seriesWinnerId: string | null;
    let seriesLoserId: string | null;
    let winnerName: string | null;
    let loserName: string | null;

    if (newP1Wins > newP2Wins) {
      seriesWinnerId = tMatch.player1Id; seriesLoserId = tMatch.player2Id;
      winnerName = tMatch.player1Name; loserName = tMatch.player2Name;
    } else if (newP2Wins > newP1Wins) {
      seriesWinnerId = tMatch.player2Id; seriesLoserId = tMatch.player1Id;
      winnerName = tMatch.player2Name; loserName = tMatch.player1Name;
    } else {
      // All draws / tied at cap — tiebreak by registered seed (lower seed =
      // higher rank). Round 1 happens to put the higher seed in player1 but
      // after bracket advancement that's not guaranteed, so look up the
      // actual registration record.
      const p1Row = tMatch.player1Id
        ? await queryOne<{ seed: string | number | null }>(
            `SELECT seed FROM chess_tournament_participants
             WHERE tournament_id = $1 AND user_id = $2`,
            [tMatch.tournamentId, tMatch.player1Id],
          )
        : null;
      const p2Row = tMatch.player2Id
        ? await queryOne<{ seed: string | number | null }>(
            `SELECT seed FROM chess_tournament_participants
             WHERE tournament_id = $1 AND user_id = $2`,
            [tMatch.tournamentId, tMatch.player2Id],
          )
        : null;
      const p1Seed = toNumOrNull(p1Row?.seed ?? null) ?? Number.MAX_SAFE_INTEGER;
      const p2Seed = toNumOrNull(p2Row?.seed ?? null) ?? Number.MAX_SAFE_INTEGER;
      // Lower seed number wins the tiebreak.
      if (p1Seed <= p2Seed) {
        seriesWinnerId = tMatch.player1Id; seriesLoserId = tMatch.player2Id;
        winnerName = tMatch.player1Name; loserName = tMatch.player2Name;
      } else {
        seriesWinnerId = tMatch.player2Id; seriesLoserId = tMatch.player1Id;
        winnerName = tMatch.player2Name; loserName = tMatch.player1Name;
      }
    }

    await query(
      `UPDATE chess_tournament_matches
       SET player1_wins = $1, player2_wins = $2, draws = $3,
           series_match_ids = $4, winner_id = $5, loser_id = $6,
           status = 'completed', completed_at = $7
       WHERE id = $8`,
      [
        newP1Wins, newP2Wins, newDraws, JSON.stringify(existingSeriesIds),
        seriesWinnerId, seriesLoserId, Date.now(), tMatch.id,
      ],
    );

    await advanceWinner(
      tMatch.tournamentId,
      tMatch.bracket,
      tMatch.round,
      tMatch.position,
      seriesWinnerId!,
      winnerName!,
      seriesLoserId ?? null,
      loserName ?? null,
      tournament,
    );

    await tryActivatePendingMatches(tMatch.tournamentId, tournament);

    if (tournament.currentRound != null) {
      const remainingInRound = await queryOne<{ cnt: unknown }>(
        `SELECT COUNT(*) AS cnt FROM chess_tournament_matches
         WHERE tournament_id = $1 AND round = $2 AND status != 'completed' AND is_bye = false`,
        [tMatch.tournamentId, tournament.currentRound],
      );
      if (toNum(remainingInRound?.cnt) === 0) {
        const nextPending = await queryOne<{ round: string | number }>(
          `SELECT round FROM chess_tournament_matches
           WHERE tournament_id = $1
             AND status = 'pending'
             AND player1_id IS NOT NULL
             AND player2_id IS NOT NULL
             AND is_bye = false
           ORDER BY round
           LIMIT 1`,
          [tMatch.tournamentId],
        );
        if (nextPending) {
          await query(
            `UPDATE chess_tournaments SET current_round = $1 WHERE id = $2`,
            [toNum(nextPending.round), tMatch.tournamentId],
          );
        }
      }
    }

    if (tournament.bettingEnabled && seriesWinnerId) {
      try { await settleTournamentMatchWagers(tMatch.id, seriesWinnerId); }
      catch (error) { console.error('Failed to settle chess tournament wagers:', error); }
    }

    broadcast('chessTournament', { type: 'match_completed', tournamentId: tMatch.tournamentId });
  } else {
    await query(
      `UPDATE chess_tournament_matches
       SET player1_wins = $1, player2_wins = $2, draws = $3, series_match_ids = $4
       WHERE id = $5`,
      [newP1Wins, newP2Wins, newDraws, JSON.stringify(existingSeriesIds), tMatch.id],
    );

    const nextChessMatchId = await createTournamentChessMatch(
      tMatch.id, tMatch.player1Id!, tMatch.player1Name!,
      tMatch.player2Id!, tMatch.player2Name!, tournament,
    );
    existingSeriesIds.push(nextChessMatchId);
    await query(
      `UPDATE chess_tournament_matches SET series_match_ids = $1 WHERE id = $2`,
      [JSON.stringify(existingSeriesIds), tMatch.id],
    );

    const scoreLine = `Score: ${newP1Wins}-${newP2Wins}${newDraws > 0 ? ` (${newDraws}d)` : ''}`;
    void createBulkNotifications([
      {
        userId: tMatch.player1Id!,
        type: 'game_turn',
        title: 'Next game in series!',
        body: `Game ${existingSeriesIds.length} of your ${tournament.format.toUpperCase()} series is ready. ${scoreLine}`,
        href: `/chess/${nextChessMatchId}`,
        preferenceKey: 'game_notifications',
      },
      {
        userId: tMatch.player2Id!,
        type: 'game_turn',
        title: 'Next game in series!',
        body: `Game ${existingSeriesIds.length} of your ${tournament.format.toUpperCase()} series is ready. ${scoreLine}`,
        href: `/chess/${nextChessMatchId}`,
        preferenceKey: 'game_notifications',
      },
    ]);
  }
}

export async function startTournamentRound(
  tournamentId: string,
  round: number,
  bracket?: TournamentBracketType,
): Promise<{ activated: number }> {
  const tournament = await getTournament(tournamentId);
  if (!tournament) throw new Error('Tournament not found.');
  if (tournament.status !== 'active') throw new Error('Tournament is not active.');
  if (!tournament.bettingEnabled) throw new Error('Manual round start is only for betting-enabled tournaments.');

  const params: unknown[] = [tournamentId, round];
  let bracketClause = '';
  if (bracket) {
    bracketClause = 'AND bracket = $3';
    params.push(bracket);
  }

  const pending = await query<TournamentMatchRow>(
    `SELECT ${TOURNAMENT_MATCH_SELECT} FROM chess_tournament_matches
     WHERE tournament_id = $1
       AND status = 'pending'
       AND round = $2
       AND player1_id IS NOT NULL
       AND player2_id IS NOT NULL
       AND is_bye = false
       ${bracketClause}`,
    params,
  );

  let activated = 0;
  for (const m of pending.rows) {
    const chessMatchId = await createTournamentChessMatch(m.id, m.player1Id!, m.player1Name!, m.player2Id!, m.player2Name!, tournament);
    await query(
      `UPDATE chess_tournament_matches
       SET status = 'active', series_match_ids = $1
       WHERE id = $2`,
      [JSON.stringify([chessMatchId]), m.id],
    );

    void createBulkNotifications([
      {
        userId: m.player1Id!,
        type: 'game_turn',
        title: 'Tournament match ready!',
        body: `Your ${tournament.name} match vs ${m.player2Name} is ready to play.`,
        href: `/chess/${chessMatchId}`,
        preferenceKey: 'game_notifications',
      },
      {
        userId: m.player2Id!,
        type: 'game_turn',
        title: 'Tournament match ready!',
        body: `Your ${tournament.name} match vs ${m.player1Name} is ready to play.`,
        href: `/chess/${chessMatchId}`,
        preferenceKey: 'game_notifications',
      },
    ]);
    activated++;
  }

  if (activated > 0) broadcast('chessTournament', { type: 'round_started', tournamentId, round });
  return { activated };
}

export async function overrideTournamentMatchResult({
  tournamentMatchId,
  winnerId,
  modUserId,
  reason,
}: {
  tournamentMatchId: string;
  winnerId: string;
  modUserId: string;
  reason: string;
}): Promise<void> {
  const tMatchRow = await queryOne<TournamentMatchRow>(
    `SELECT ${TOURNAMENT_MATCH_SELECT} FROM chess_tournament_matches WHERE id = $1`,
    [tournamentMatchId],
  );
  if (!tMatchRow) throw new Error('Tournament match not found.');
  const tMatch = rowToTournamentMatch(tMatchRow);
  const tournament = await getTournament(tMatch.tournamentId);
  if (!tournament) throw new Error('Tournament not found.');
  if (tMatch.status === 'completed') throw new Error('Match already completed.');
  if (winnerId !== tMatch.player1Id && winnerId !== tMatch.player2Id) {
    throw new Error('Winner must be one of the match players.');
  }

  const loserId = winnerId === tMatch.player1Id ? tMatch.player2Id : tMatch.player1Id;
  const winnerName = winnerId === tMatch.player1Id ? tMatch.player1Name : tMatch.player2Name;
  const loserName = winnerId === tMatch.player1Id ? tMatch.player2Name : tMatch.player1Name;

  const seriesIds = tMatch.seriesMatchIds;
  const { getMatch, resignMatch } = getChessMatchLib();
  for (const matchId of seriesIds) {
    const m = await getMatch(matchId);
    if (m && m.status === 'active') {
      try { if (loserId) await resignMatch(matchId, loserId); }
      catch { /* already completed */ }
    }
  }

  await query(
    `UPDATE chess_tournament_matches
     SET winner_id = $1, loser_id = $2, status = 'completed',
         overridden_by = $3, override_reason = $4, completed_at = $5
     WHERE id = $6`,
    [winnerId, loserId, modUserId, reason, Date.now(), tournamentMatchId],
  );

  await advanceWinner(
    tMatch.tournamentId,
    tMatch.bracket,
    tMatch.round,
    tMatch.position,
    winnerId,
    winnerName!,
    loserId ?? null,
    loserName ?? null,
    tournament,
  );

  await tryActivatePendingMatches(tMatch.tournamentId, tournament);

  if (tournament.bettingEnabled) {
    try {
      if (seriesIds.length > 0) await settleTournamentMatchWagers(tournamentMatchId, winnerId);
      else await cancelTournamentMatchWagers(tournamentMatchId);
    } catch (error) {
      console.error('Failed to settle/cancel chess tournament wagers on override:', error);
    }
  }

  broadcast('chessTournament', { type: 'match_completed', tournamentId: tMatch.tournamentId });
}

async function getTournamentMatches(tournamentId: string): Promise<TournamentMatch[]> {
  const result = await query<TournamentMatchRow>(
    `SELECT ${TOURNAMENT_MATCH_SELECT} FROM chess_tournament_matches
     WHERE tournament_id = $1
     ORDER BY bracket, round, position`,
    [tournamentId],
  );
  return result.rows.map(rowToTournamentMatch);
}

// fallow-ignore-next-line duplicate-export
export type BracketData = {
  winners: TournamentMatch[][];
  losers: TournamentMatch[][];
  grandFinal: TournamentMatch[];
};

export async function getTournamentBracket(tournamentId: string): Promise<BracketData> {
  const matches = await getTournamentMatches(tournamentId);
  const winners: Map<number, TournamentMatch[]> = new Map();
  const losers: Map<number, TournamentMatch[]> = new Map();
  const grandFinal: TournamentMatch[] = [];

  for (const m of matches) {
    if (m.bracket === 'winners') {
      if (!winners.has(m.round)) winners.set(m.round, []);
      winners.get(m.round)!.push(m);
    } else if (m.bracket === 'losers') {
      if (!losers.has(m.round)) losers.set(m.round, []);
      losers.get(m.round)!.push(m);
    } else grandFinal.push(m);
  }

  const sortByPosition = (a: TournamentMatch, b: TournamentMatch) => a.position - b.position;
  const winnersArray: TournamentMatch[][] = [];
  const maxWinnersRound = Math.max(0, ...winners.keys());
  for (let r = 1; r <= maxWinnersRound; r++) winnersArray.push((winners.get(r) ?? []).sort(sortByPosition));

  const losersArray: TournamentMatch[][] = [];
  const maxLosersRound = Math.max(0, ...losers.keys());
  for (let r = 1; r <= maxLosersRound; r++) losersArray.push((losers.get(r) ?? []).sort(sortByPosition));

  return {
    winners: winnersArray,
    losers: losersArray,
    grandFinal: grandFinal.sort((a, b) => a.round - b.round),
  };
}

export async function getActiveChessMatchForTournamentMatch(tournamentMatchId: string): Promise<string | null> {
  const rows = await query<{ id: string; status: string }>(
    `SELECT id, status FROM chess_matches WHERE tournament_match_id = $1`,
    [tournamentMatchId],
  );
  const active = rows.rows.find((r) => r.status === 'active' || r.status === 'waiting');
  return active?.id ?? null;
}

registerChessMatchCompletedHandler(onChessMatchCompleted);
