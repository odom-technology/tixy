// ---------------------------------------------------------------------------
// 8-Ball Pool — Tournament Bracket System
//
// Manages tournament lifecycle: registration → seeding → bracket progression.
// Supports single elimination, double elimination (losers bracket), BO1/BO3.
// Tournament matches are regular poolMatches linked via tournamentMatchId.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { query, queryOne } from '@/server/db/client';
import { broadcast } from '@/server/events';
import { getElo, STARTING_ELO } from '@/server/arcade/pool-elo';
import {
  createMatch,
  joinMatch,
  getMatch,
  forfeitMatch,
} from '@/server/arcade/pool-match';
import { createBulkNotifications } from '@/server/services/notifications';
import {
  cancelTournamentMatchWagers,
  settleTournamentMatchWagers,
} from '@/server/arcade/pool-tournament-wagers';
import {
  POOL_TOURNAMENT_DEFAULT_MAX_BET,
  POOL_TOURNAMENT_DEFAULT_MIN_BET,
} from '@/server/arcade/pool-wager-constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  winnerId: string | null;
  loserId: string | null;
  status: TournamentMatchStatus;
  overriddenBy: string | null;
  overrideReason: string | null;
  createdAt: number;
  completedAt: number | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    hasLosersBracket: toBool(row.hasLosersBracket),
    bettingEnabled: toBool(row.bettingEnabled),
    minBet: toNumOrNull(row.minBet) ?? POOL_TOURNAMENT_DEFAULT_MIN_BET,
    maxBet: toNumOrNull(row.maxBet) ?? POOL_TOURNAMENT_DEFAULT_MAX_BET,
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
    try {
      seriesMatchIds = JSON.parse(row.seriesMatchIds) as string[];
    } catch {
      /* empty */
    }
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

/** Next power of 2 >= n. */
function nextPowerOf2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Standard tournament seeding order. For numSlots=8 produces [1,8,5,4,3,6,7,2],
 * giving matchups 1v8, 5v4, 3v6, 7v2 — converging to 1v2 in the final.
 */
function generateSeedOrder(numSlots: number): number[] {
  if (numSlots === 1) return [1];
  const half = generateSeedOrder(numSlots / 2);
  return half.flatMap((seed) => [seed, numSlots + 1 - seed]);
}

/** Number of wins needed to clinch a series. */
function winsNeeded(format: TournamentFormat): number {
  return format === 'bo3' ? 2 : 1;
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
    `INSERT INTO pool_tournament_matches
       (id, tournament_id, bracket, round, position, player1_id, player2_id,
        player1_name, player2_name, is_bye, series_match_ids, player1_wins,
        player2_wins, winner_id, loser_id, status, overridden_by,
        override_reason, created_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, 0, 0,
             NULL, NULL, $11, NULL, NULL, $12, $13)`,
    [
      values.id, values.tournamentId, values.bracket, values.round,
      values.position, values.player1Id, values.player2Id, values.player1Name,
      values.player2Name, values.isBye, values.status, values.createdAt,
      values.completedAt,
    ],
  );
}

async function getTournamentMatchBySlot(
  tournamentId: string,
  bracket: TournamentBracketType,
  round: number,
  position?: number,
): Promise<TournamentMatchRow | null> {
  if (position === undefined) {
    return queryOne<TournamentMatchRow>(
      `SELECT ${TOURNAMENT_MATCH_SELECT} FROM pool_tournament_matches
       WHERE tournament_id = $1 AND bracket = $2 AND round = $3`,
      [tournamentId, bracket, round],
    );
  }
  return queryOne<TournamentMatchRow>(
    `SELECT ${TOURNAMENT_MATCH_SELECT} FROM pool_tournament_matches
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
    `UPDATE pool_tournament_matches SET ${sets.join(', ')} WHERE id = $${i}`,
    values,
  );
}

// ---------------------------------------------------------------------------
// Tournament CRUD
// ---------------------------------------------------------------------------

export async function createTournament({
  name,
  format,
  hasLosersBracket,
  bettingEnabled = false,
  minBet = POOL_TOURNAMENT_DEFAULT_MIN_BET,
  maxBet = POOL_TOURNAMENT_DEFAULT_MAX_BET,
  createdBy,
  createdByName,
}: {
  name: string;
  format: TournamentFormat;
  hasLosersBracket: boolean;
  bettingEnabled?: boolean;
  minBet?: number;
  maxBet?: number;
  createdBy: string;
  createdByName: string;
}): Promise<Tournament> {
  const id = crypto.randomUUID();
  const now = Date.now();

  const tournament: Tournament = {
    id,
    name,
    createdBy,
    createdByName,
    status: 'registration',
    format,
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
    `INSERT INTO pool_tournaments
       (id, name, created_by, created_by_name, status, format,
        has_losers_bracket, betting_enabled, min_bet, max_bet, total_rounds,
        current_round, winner_id, winner_name, participant_count, created_at,
        started_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
             $16, $17, $18)`,
    [
      tournament.id, tournament.name, tournament.createdBy,
      tournament.createdByName, tournament.status, tournament.format,
      tournament.hasLosersBracket, tournament.bettingEnabled, tournament.minBet,
      tournament.maxBet, tournament.totalRounds, tournament.currentRound,
      tournament.winnerId, tournament.winnerName, tournament.participantCount,
      tournament.createdAt, tournament.startedAt, tournament.completedAt,
    ],
  );
  broadcast('poolTournament', { type: 'tournament_created', tournamentId: id });

  return tournament;
}

export async function getTournament(id: string): Promise<Tournament | null> {
  const row = await queryOne<TournamentRow>(
    `SELECT ${TOURNAMENT_SELECT} FROM pool_tournaments WHERE id = $1`,
    [id],
  );
  return row ? rowToTournament(row) : null;
}

export async function getTournaments(): Promise<Tournament[]> {
  const result = await query<TournamentRow>(
    `SELECT ${TOURNAMENT_SELECT} FROM pool_tournaments
     ORDER BY created_at DESC
     LIMIT 20`,
  );
  return result.rows.map(rowToTournament);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export async function getParticipants(tournamentId: string): Promise<TournamentParticipant[]> {
  const result = await query<ParticipantRow>(
    `SELECT ${PARTICIPANT_SELECT} FROM pool_tournament_participants
     WHERE tournament_id = $1
     ORDER BY elo_at_registration DESC`,
    [tournamentId],
  );
  return result.rows.map(rowToParticipant);
}

export async function registerForTournament(
  tournamentId: string,
  userId: string,
  userName: string,
): Promise<void> {
  const tournament = await getTournament(tournamentId);
  if (!tournament) throw new Error('Tournament not found.');
  if (tournament.status !== 'registration')
    throw new Error('Registration is closed.');

  // Check if already registered
  const existing = await queryOne(
    `SELECT user_id FROM pool_tournament_participants
     WHERE tournament_id = $1 AND user_id = $2`,
    [tournamentId, userId],
  );
  if (existing) throw new Error('Already registered.');

  // Snapshot current Elo
  const elo = await getElo(userId);
  const eloRating = elo?.eloRating ?? STARTING_ELO;

  await query(
    `INSERT INTO pool_tournament_participants
       (tournament_id, user_id, user_name, seed, elo_at_registration,
        eliminated_in_round, eliminated_from, placement, registered_at)
     VALUES ($1, $2, $3, NULL, $4, NULL, NULL, NULL, $5)`,
    [tournamentId, userId, userName, eloRating, Date.now()],
  );

  await query(
    `UPDATE pool_tournaments
     SET participant_count = participant_count + 1
     WHERE id = $1`,
    [tournamentId],
  );

  broadcast('poolTournament', { type: 'registration_updated', tournamentId });
}

export async function unregisterFromTournament(
  tournamentId: string,
  userId: string,
): Promise<void> {
  const tournament = await getTournament(tournamentId);
  if (!tournament) throw new Error('Tournament not found.');
  if (tournament.status !== 'registration')
    throw new Error('Cannot unregister after tournament has started.');

  const result = await query(
    `DELETE FROM pool_tournament_participants
     WHERE tournament_id = $1 AND user_id = $2`,
    [tournamentId, userId],
  );

  if ((result.rowCount ?? 0) === 0) throw new Error('Not registered.');

  await query(
    `UPDATE pool_tournaments
     SET participant_count = GREATEST(0, participant_count - 1)
     WHERE id = $1`,
    [tournamentId],
  );

  broadcast('poolTournament', { type: 'registration_updated', tournamentId });
}

// ---------------------------------------------------------------------------
// Tournament Start — Seeding & Bracket Generation
// ---------------------------------------------------------------------------

/**
 * Create an active pool match for a tournament bracket slot and immediately
 * start it (both players joined). Returns the pool match ID.
 */
async function createTournamentPoolMatch(
  tournamentMatchId: string,
  p1Id: string,
  p1Name: string,
  p2Id: string,
  p2Name: string,
): Promise<string> {
  const poolMatch = await createMatch(p1Id, p1Name, {
    invitedUserId: p2Id,
    tournamentMatchId,
  });
  await joinMatch(poolMatch.id, p2Id, p2Name);
  return poolMatch.id;
}

export async function startTournament(tournamentId: string): Promise<Tournament> {
  const tournament = await getTournament(tournamentId);
  if (!tournament) throw new Error('Tournament not found.');
  if (tournament.status !== 'registration')
    throw new Error('Tournament already started.');

  const participants = await getParticipants(tournamentId);
  if (participants.length < 2) throw new Error('Need at least 2 participants.');

  // Sort by Elo descending, assign seeds
  const sorted = [...participants].sort(
    (a, b) => b.eloAtRegistration - a.eloAtRegistration,
  );
  for (let i = 0; i < sorted.length; i++) {
    await query(
      `UPDATE pool_tournament_participants
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

  // Build seed-to-player map (seeds beyond participant count are byes)
  const seedMap = new Map<number, TournamentParticipant>();
  for (const p of sorted) {
    if (p.seed !== null) seedMap.set(p.seed, p);
  }

  // Create winners bracket round 1 matches
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

  // Create remaining winners bracket rounds (empty slots)
  for (let round = 2; round <= totalWinnersRounds; round++) {
    const matchesInRound = numSlots / Math.pow(2, round);
    for (let pos = 1; pos <= matchesInRound; pos++) {
      await insertTournamentMatch({
        id: crypto.randomUUID(),
        tournamentId,
        bracket: 'winners',
        round,
        position: pos,
        player1Id: null,
        player2Id: null,
        player1Name: null,
        player2Name: null,
        isBye: false,
        status: 'pending',
        createdAt: now,
        completedAt: null,
      });
    }
  }

  // Create losers bracket rounds (if double elimination)
  if (tournament.hasLosersBracket && totalWinnersRounds > 1) {
    const totalLosersRounds = 2 * (totalWinnersRounds - 1);
    for (let round = 1; round <= totalLosersRounds; round++) {
      // Standard double-elimination pattern:
      // L1 opens with W1 losers, even rounds mix in winners-bracket losers,
      // odd rounds >1 are internal consolidation rounds.
      let matchesInRound: number;
      if (round === 1) {
        matchesInRound = numSlots / 4; // half of winners R1
      } else if (round % 2 === 0) {
        // Mixed round: same count as the prior internal/opening round
        matchesInRound = getMatchCountForLosersRound(round - 1, numSlots);
      } else {
        // Internal round: halve the prior mixed round
        matchesInRound = Math.max(
          1,
          getMatchCountForLosersRound(round - 1, numSlots) / 2,
        );
      }

      for (let pos = 1; pos <= matchesInRound; pos++) {
        await insertTournamentMatch({
          id: crypto.randomUUID(),
          tournamentId,
          bracket: 'losers',
          round,
          position: pos,
          player1Id: null,
          player2Id: null,
          player1Name: null,
          player2Name: null,
          isBye: false,
          status: 'pending',
          createdAt: now,
          completedAt: null,
        });
      }
    }

    // Grand final match(es)
    await insertTournamentMatch({
      id: crypto.randomUUID(),
      tournamentId,
      bracket: 'grand_final',
      round: 1,
      position: 1,
      player1Id: null,
      player2Id: null,
      player1Name: null,
      player2Name: null,
      isBye: false,
      status: 'pending',
      createdAt: now,
      completedAt: null,
    });

    // Grand final reset (used only if losers bracket champ wins the first set)
    await insertTournamentMatch({
      id: crypto.randomUUID(),
      tournamentId,
      bracket: 'grand_final',
      round: 2,
      position: 1,
      player1Id: null,
      player2Id: null,
      player1Name: null,
      player2Name: null,
      isBye: false,
      status: 'pending',
      createdAt: now,
      completedAt: null,
    });
  }

  // Handle byes: auto-advance winners from round 1
  for (const m of round1Matches) {
    if (m.p1 && !m.p2) {
      // p1 gets a bye
      await query(
        `UPDATE pool_tournament_matches
         SET winner_id = $1, loser_id = NULL, status = 'completed', completed_at = $2
         WHERE id = $3`,
        [m.p1.userId, now, m.id],
      );
      await advanceWinner(
        tournamentId,
        'winners',
        1,
        m.position,
        m.p1.userId,
        m.p1.userName,
        null,
        null,
        tournament,
      );
    } else if (!m.p1 && m.p2) {
      await query(
        `UPDATE pool_tournament_matches
         SET winner_id = $1, loser_id = NULL, status = 'completed', completed_at = $2
         WHERE id = $3`,
        [m.p2.userId, now, m.id],
      );
      await advanceWinner(
        tournamentId,
        'winners',
        1,
        m.position,
        m.p2.userId,
        m.p2.userName,
        null,
        null,
        tournament,
      );
    }
  }

  // Create pool matches for all non-bye round 1 matches that have both players
  const activableR1 = (await query<TournamentMatchRow>(
    `SELECT ${TOURNAMENT_MATCH_SELECT} FROM pool_tournament_matches
     WHERE tournament_id = $1 AND bracket = 'winners' AND round = 1 AND status = 'pending'`,
    [tournamentId],
  )).rows.filter((m) => m.player1Id && m.player2Id);

  for (const m of activableR1) {
    const poolMatchId = await createTournamentPoolMatch(
      m.id,
      m.player1Id!,
      m.player1Name!,
      m.player2Id!,
      m.player2Name!,
    );
    await query(
      `UPDATE pool_tournament_matches
       SET status = 'active', series_match_ids = $1
       WHERE id = $2`,
      [JSON.stringify([poolMatchId]), m.id],
    );
  }

  // Also try to activate any losers/later round matches that might already have both players
  // (from cascading byes)
  await tryActivatePendingMatches(tournamentId, tournament);

  // Update tournament status
  await query(
    `UPDATE pool_tournaments
     SET status = 'active', total_rounds = $1, current_round = 1, started_at = $2
     WHERE id = $3`,
    [totalWinnersRounds, now, tournamentId],
  );

  // Notify all participants
  const notifEntries = sorted.map((p) => ({
    userId: p.userId,
    type: 'game_turn' as const,
    title: 'Tournament started!',
    body: `${tournament.name} has begun. Check the bracket for your first match.`,
    href: '/8-ball',
    preferenceKey: 'game_notifications' as const,
  }));
  void createBulkNotifications(notifEntries);

  broadcast('poolTournament', { type: 'tournament_started', tournamentId });

  return (await getTournament(tournamentId))!;
}

/** Helper to compute match count for a losers bracket round. */
function getMatchCountForLosersRound(round: number, numSlots: number): number {
  // Losers bracket sizing:
  // R1: numSlots/4 matches
  // R2 (internal): numSlots/4 matches (same as R1)
  // R3 (drop-down): numSlots/8
  // R4 (internal): numSlots/8
  // ... pattern: every 2 rounds, count halves
  const pairIndex = Math.floor((round - 1) / 2);
  return Math.max(1, numSlots / Math.pow(2, pairIndex + 2));
}

// ---------------------------------------------------------------------------
// Bracket Advancement
// ---------------------------------------------------------------------------

/**
 * Advance a winner from a completed tournament match to the next slot.
 * Also handles dropping the loser into the losers bracket if enabled.
 */
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
    // Advance winner to next winners round
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
      // No next winners round = this is the winners bracket final
      // Winner goes to grand final as player 1
      const grandFinal = await getTournamentMatchBySlot(tournamentId, 'grand_final', 1);

      if (grandFinal) {
        await setTournamentMatchPlayers(grandFinal.id, { player1Id: winnerId, player1Name: winnerName });
      } else {
        // No grand final exists (e.g., 2-player tournament) — winner is champion
        await completeTournament(tournamentId, winnerId, winnerName);
        return;
      }
    } else {
      // Single elimination — this winner is the champion
      await completeTournament(tournamentId, winnerId, winnerName);
      return;
    }

    // Drop loser into losers bracket (if enabled and there's a loser)
    if (tournament.hasLosersBracket && loserId && loserName) {
      await dropToLosersBracket(
        tournamentId,
        round,
        position,
        loserId,
        loserName,
        tournament,
      );
    } else if (loserId) {
      // Single elimination — loser is eliminated
      await eliminatePlayer(tournamentId, loserId, round, 'winners');
    }
  } else if (bracket === 'losers') {
    // Advance winner to next losers round
    const nextRound = round + 1;

    // Check if this is the last losers bracket round
    const totalLosersRounds = tournament.totalRounds
      ? 2 * (tournament.totalRounds - 1)
      : 0;
    if (round >= totalLosersRounds) {
      // Winner of the losers bracket goes to grand final as player 2
      const grandFinal = await getTournamentMatchBySlot(tournamentId, 'grand_final', 1);

      if (grandFinal) {
        await setTournamentMatchPlayers(grandFinal.id, { player2Id: winnerId, player2Name: winnerName });
      }
    } else {
      const nextRoundIsDropRound = nextRound % 2 === 0;
      const nextPosition = nextRoundIsDropRound
        ? position
        : Math.ceil(position / 2);

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

    // Loser in losers bracket is eliminated
    if (loserId) {
      await eliminatePlayer(tournamentId, loserId, round, 'losers');
    }
  } else if (bracket === 'grand_final') {
    if (round === 1) {
      // Check if the losers bracket champion won (requires reset)
      // Grand final player1 = winners bracket champ, player2 = losers bracket champ
      const gfMatch = await getTournamentMatchBySlot(tournamentId, 'grand_final', 1);

      if (gfMatch && winnerId === gfMatch.player2Id) {
        // Losers bracket champ won — need a reset match
        const resetMatch = await getTournamentMatchBySlot(tournamentId, 'grand_final', 2);

        if (resetMatch) {
          await setTournamentMatchPlayers(resetMatch.id, {
            player1Id: gfMatch.player1Id,
            player1Name: gfMatch.player1Name,
            player2Id: gfMatch.player2Id,
            player2Name: gfMatch.player2Name,
          });
        }
        return; // Don't complete tournament yet — reset match needed
      }

      // Winners bracket champ won — they are the champion
      await completeTournament(tournamentId, winnerId, winnerName);
      if (loserId) await eliminatePlayer(tournamentId, loserId, round, 'grand_final');
    } else {
      // Grand final reset (round 2) — winner is the champion
      await completeTournament(tournamentId, winnerId, winnerName);
      if (loserId) await eliminatePlayer(tournamentId, loserId, round, 'grand_final');
    }
  }
}

/** Drop a loser from the winners bracket into the losers bracket. */
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
    fromWinnersRound === 1
      ? 1
      : Math.min(2 * (fromWinnersRound - 1), 2 * (tournament.totalRounds - 1));
  const losersPosition =
    fromWinnersRound === 1 ? Math.ceil(fromPosition / 2) : fromPosition;

  const targetMatch = await getTournamentMatchBySlot(tournamentId, 'losers', losersRound, losersPosition);

  if (!targetMatch) return;

  // Either side may arrive first depending on match timing, so fill the next
  // open slot instead of assuming strict ordering.
  if (!targetMatch.player1Id) {
    await setTournamentMatchPlayers(targetMatch.id, { player1Id: loserId, player1Name: loserName });
  } else if (!targetMatch.player2Id) {
    await setTournamentMatchPlayers(targetMatch.id, { player2Id: loserId, player2Name: loserName });
  }
}

async function eliminatePlayer(
  tournamentId: string,
  userId: string,
  round: number,
  bracket: string,
): Promise<void> {
  // Count remaining active players to determine placement
  const remaining = await queryOne<{ cnt: unknown }>(
    `SELECT COUNT(*) AS cnt FROM pool_tournament_participants
     WHERE tournament_id = $1 AND eliminated_in_round IS NULL`,
    [tournamentId],
  );

  await query(
    `UPDATE pool_tournament_participants
     SET eliminated_in_round = $1, eliminated_from = $2, placement = $3
     WHERE tournament_id = $4 AND user_id = $5`,
    [round, bracket, toNum(remaining?.cnt), tournamentId, userId],
  );
}

/** Permanently delete a tournament and all associated data. */
export async function deleteTournament(tournamentId: string): Promise<void> {
  const tournamentMatchIds = (await query<{ id: string }>(
    `SELECT id FROM pool_tournament_matches WHERE tournament_id = $1`,
    [tournamentId],
  )).rows.map((row) => row.id);

  if (tournamentMatchIds.length > 0) {
    await query(
      'DELETE FROM pool_matches WHERE tournament_match_id = ANY($1)',
      [tournamentMatchIds],
    );
  }
  await query('DELETE FROM pool_tournament_wagers WHERE tournament_id = $1', [tournamentId]);
  await query('DELETE FROM pool_tournament_matches WHERE tournament_id = $1', [tournamentId]);
  await query('DELETE FROM pool_tournament_participants WHERE tournament_id = $1', [tournamentId]);
  await query('DELETE FROM pool_tournaments WHERE id = $1', [tournamentId]);
}

export async function completeTournament(
  tournamentId: string,
  winnerId: string,
  winnerName: string,
): Promise<void> {
  const now = Date.now();

  // Set winner placement
  await query(
    `UPDATE pool_tournament_participants
     SET placement = 1
     WHERE tournament_id = $1 AND user_id = $2`,
    [tournamentId, winnerId],
  );

  await query(
    `UPDATE pool_tournaments
     SET status = 'completed', winner_id = $1, winner_name = $2, completed_at = $3
     WHERE id = $4`,
    [winnerId, winnerName, now, tournamentId],
  );

  // Notify all participants
  const participants = await getParticipants(tournamentId);
  const notifEntries = participants.map((p) => ({
    userId: p.userId,
    type: 'game_turn' as const,
    title: 'Tournament complete!',
    body: `${winnerName} won the tournament!`,
    href: '/8-ball',
    preferenceKey: 'game_notifications' as const,
  }));
  void createBulkNotifications(notifEntries);

  broadcast('poolTournament', { type: 'tournament_completed', tournamentId });
}

/**
 * Try to activate any pending matches that now have both players assigned.
 * Called after byes cascade or after a match completes.
 */
async function tryActivatePendingMatches(
  tournamentId: string,
  tournament: Tournament,
): Promise<void> {
  // When betting is enabled, don't auto-activate — organizer must click "Start Round"
  if (tournament.bettingEnabled) return;

  const pendingWithBothPlayers = await query<TournamentMatchRow>(
    `SELECT ${TOURNAMENT_MATCH_SELECT} FROM pool_tournament_matches
     WHERE tournament_id = $1
       AND status = 'pending'
       AND player1_id IS NOT NULL
       AND player2_id IS NOT NULL
       AND is_bye = false`,
    [tournamentId],
  );

  for (const m of pendingWithBothPlayers.rows) {
    const poolMatchId = await createTournamentPoolMatch(
      m.id,
      m.player1Id!,
      m.player1Name!,
      m.player2Id!,
      m.player2Name!,
    );
    await query(
      `UPDATE pool_tournament_matches
       SET status = 'active', series_match_ids = $1
       WHERE id = $2`,
      [JSON.stringify([poolMatchId]), m.id],
    );

    // Notify both players about their match
    void createBulkNotifications([
      {
        userId: m.player1Id!,
        type: 'game_turn',
        title: 'Tournament match ready!',
        body: `Your ${tournament.name} match vs ${m.player2Name} is ready to play.`,
        href: `/8-ball/${poolMatchId}`,
        preferenceKey: 'game_notifications',
      },
      {
        userId: m.player2Id!,
        type: 'game_turn',
        title: 'Tournament match ready!',
        body: `Your ${tournament.name} match vs ${m.player1Name} is ready to play.`,
        href: `/8-ball/${poolMatchId}`,
        preferenceKey: 'game_notifications',
      },
    ]);
  }
}

// ---------------------------------------------------------------------------
// Match Completion Hook
// ---------------------------------------------------------------------------

/**
 * Called when a pool match linked to a tournament completes.
 * Updates series score and triggers bracket advancement if series is decided.
 */
export async function onPoolMatchCompleted(poolMatchId: string): Promise<void> {
  const poolMatch = await getMatch(poolMatchId);
  if (!poolMatch?.tournamentMatchId) return;
  if (!poolMatch.winnerId || !poolMatch.loserId) return;

  const tMatchRow = await queryOne<TournamentMatchRow>(
    `SELECT ${TOURNAMENT_MATCH_SELECT} FROM pool_tournament_matches WHERE id = $1`,
    [poolMatch.tournamentMatchId],
  );
  if (!tMatchRow) return;
  const tMatch = rowToTournamentMatch(tMatchRow);
  if (tMatch.status === 'completed') return;

  const tournament = await getTournament(tMatch.tournamentId);
  if (!tournament) return;

  // Update series score
  const isP1Winner = poolMatch.winnerId === tMatch.player1Id;
  const newP1Wins = tMatch.player1Wins + (isP1Winner ? 1 : 0);
  const newP2Wins = tMatch.player2Wins + (isP1Winner ? 0 : 1);

  // Add match to series list
  const existingSeriesIds = [...tMatch.seriesMatchIds];
  if (!existingSeriesIds.includes(poolMatchId)) {
    existingSeriesIds.push(poolMatchId);
  }

  const needed = winsNeeded(tournament.format);
  const seriesDecided = newP1Wins >= needed || newP2Wins >= needed;

  if (seriesDecided) {
    const seriesWinnerId =
      newP1Wins >= needed ? tMatch.player1Id : tMatch.player2Id;
    const seriesLoserId =
      newP1Wins >= needed ? tMatch.player2Id : tMatch.player1Id;
    const winnerName =
      newP1Wins >= needed ? tMatch.player1Name : tMatch.player2Name;
    const loserName =
      newP1Wins >= needed ? tMatch.player2Name : tMatch.player1Name;

    await query(
      `UPDATE pool_tournament_matches
       SET player1_wins = $1, player2_wins = $2, series_match_ids = $3,
           winner_id = $4, loser_id = $5, status = 'completed', completed_at = $6
       WHERE id = $7`,
      [
        newP1Wins, newP2Wins, JSON.stringify(existingSeriesIds),
        seriesWinnerId, seriesLoserId, Date.now(), tMatch.id,
      ],
    );

    // Advance in bracket
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

    // Try to activate any matches that now have both players
    await tryActivatePendingMatches(tMatch.tournamentId, tournament);

    // Advance currentRound when all matches in the current round are done
    if (tournament.currentRound != null) {
      const remainingInRound = await queryOne<{ cnt: unknown }>(
        `SELECT COUNT(*) AS cnt FROM pool_tournament_matches
         WHERE tournament_id = $1 AND round = $2 AND status != 'completed' AND is_bye = false`,
        [tMatch.tournamentId, tournament.currentRound],
      );
      if (toNum(remainingInRound?.cnt) === 0) {
        // Find the next round that has pending matches with both players
        const nextPending = await queryOne<{ round: string | number }>(
          `SELECT round FROM pool_tournament_matches
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
            `UPDATE pool_tournaments SET current_round = $1 WHERE id = $2`,
            [toNum(nextPending.round), tMatch.tournamentId],
          );
        }
      }
    }

    // Settle tournament wagers for this match
    if (tournament.bettingEnabled && seriesWinnerId) {
      try {
        await settleTournamentMatchWagers(tMatch.id, seriesWinnerId);
      } catch (error) {
        console.error('Failed to settle tournament wagers:', error);
      }
    }

    broadcast('poolTournament', {
      type: 'match_completed',
      tournamentId: tMatch.tournamentId,
    });
  } else {
    // Series continues — create next game
    await query(
      `UPDATE pool_tournament_matches
       SET player1_wins = $1, player2_wins = $2, series_match_ids = $3
       WHERE id = $4`,
      [newP1Wins, newP2Wins, JSON.stringify(existingSeriesIds), tMatch.id],
    );

    // Create next pool match in the series
    const nextPoolMatchId = await createTournamentPoolMatch(
      tMatch.id,
      tMatch.player1Id!,
      tMatch.player1Name!,
      tMatch.player2Id!,
      tMatch.player2Name!,
    );

    existingSeriesIds.push(nextPoolMatchId);
    await query(
      `UPDATE pool_tournament_matches SET series_match_ids = $1 WHERE id = $2`,
      [JSON.stringify(existingSeriesIds), tMatch.id],
    );

    // Notify both players about the next game in the series
    void createBulkNotifications([
      {
        userId: tMatch.player1Id!,
        type: 'game_turn',
        title: 'Next game in series!',
        body: `Game ${existingSeriesIds.length} of your ${tournament.format.toUpperCase()} series is ready. Score: ${newP1Wins}-${newP2Wins}`,
        href: `/8-ball/${nextPoolMatchId}`,
        preferenceKey: 'game_notifications',
      },
      {
        userId: tMatch.player2Id!,
        type: 'game_turn',
        title: 'Next game in series!',
        body: `Game ${existingSeriesIds.length} of your ${tournament.format.toUpperCase()} series is ready. Score: ${newP2Wins}-${newP1Wins}`,
        href: `/8-ball/${nextPoolMatchId}`,
        preferenceKey: 'game_notifications',
      },
    ]);
  }
}

// ---------------------------------------------------------------------------
// Manual Round Start (for betting-enabled tournaments)
// ---------------------------------------------------------------------------

/**
 * Start a tournament round — creates pool matches for all pending matches
 * in the given round that have both players assigned. After this, betting
 * is closed for those matches (status moves from 'pending' to 'active').
 */
export async function startTournamentRound(
  tournamentId: string,
  round: number,
  bracket?: TournamentBracketType,
): Promise<{ activated: number }> {
  const tournament = await getTournament(tournamentId);
  if (!tournament) throw new Error('Tournament not found.');
  if (tournament.status !== 'active')
    throw new Error('Tournament is not active.');
  if (!tournament.bettingEnabled)
    throw new Error(
      'Manual round start is only for betting-enabled tournaments.',
    );

  const params: unknown[] = [tournamentId, round];
  let bracketClause = '';
  if (bracket) {
    bracketClause = 'AND bracket = $3';
    params.push(bracket);
  }

  const pendingMatches = await query<TournamentMatchRow>(
    `SELECT ${TOURNAMENT_MATCH_SELECT} FROM pool_tournament_matches
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
  for (const m of pendingMatches.rows) {
    const poolMatchId = await createTournamentPoolMatch(
      m.id,
      m.player1Id!,
      m.player1Name!,
      m.player2Id!,
      m.player2Name!,
    );
    await query(
      `UPDATE pool_tournament_matches
       SET status = 'active', series_match_ids = $1
       WHERE id = $2`,
      [JSON.stringify([poolMatchId]), m.id],
    );

    void createBulkNotifications([
      {
        userId: m.player1Id!,
        type: 'game_turn',
        title: 'Tournament match ready!',
        body: `Your ${tournament.name} match vs ${m.player2Name} is ready to play.`,
        href: `/8-ball/${poolMatchId}`,
        preferenceKey: 'game_notifications',
      },
      {
        userId: m.player2Id!,
        type: 'game_turn',
        title: 'Tournament match ready!',
        body: `Your ${tournament.name} match vs ${m.player1Name} is ready to play.`,
        href: `/8-ball/${poolMatchId}`,
        preferenceKey: 'game_notifications',
      },
    ]);

    activated++;
  }

  if (activated > 0) {
    broadcast('poolTournament', { type: 'round_started', tournamentId, round });
  }

  return { activated };
}

// ---------------------------------------------------------------------------
// Moderator Override
// ---------------------------------------------------------------------------

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
    `SELECT ${TOURNAMENT_MATCH_SELECT} FROM pool_tournament_matches WHERE id = $1`,
    [tournamentMatchId],
  );
  if (!tMatchRow) throw new Error('Tournament match not found.');
  const tMatch = rowToTournamentMatch(tMatchRow);

  const tournament = await getTournament(tMatch.tournamentId);
  if (!tournament) throw new Error('Tournament not found.');

  if (tMatch.status === 'completed')
    throw new Error('Match already completed.');

  // Validate winnerId is one of the players
  if (winnerId !== tMatch.player1Id && winnerId !== tMatch.player2Id) {
    throw new Error('Winner must be one of the match players.');
  }

  const loserId =
    winnerId === tMatch.player1Id ? tMatch.player2Id : tMatch.player1Id;
  const winnerName =
    winnerId === tMatch.player1Id ? tMatch.player1Name : tMatch.player2Name;
  const loserName =
    winnerId === tMatch.player1Id ? tMatch.player2Name : tMatch.player1Name;

  // Forfeit any in-progress pool matches in the series
  const seriesIds = tMatch.seriesMatchIds;
  for (const poolMatchId of seriesIds) {
    const pm = await getMatch(poolMatchId);
    if (pm && pm.status === 'active') {
      try {
        // Forfeit the match as the loser
        if (loserId) await forfeitMatch(poolMatchId, loserId);
      } catch {
        // Match may already be completed — ignore
      }
    }
  }

  // Mark tournament match as completed with override
  await query(
    `UPDATE pool_tournament_matches
     SET winner_id = $1, loser_id = $2, status = 'completed',
         overridden_by = $3, override_reason = $4, completed_at = $5
     WHERE id = $6`,
    [winnerId, loserId, modUserId, reason, Date.now(), tournamentMatchId],
  );

  // Advance bracket
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

  // Settle or cancel wagers on override
  if (tournament.bettingEnabled) {
    try {
      if (seriesIds.length > 0) {
        // Games were played — settle with the override winner
        await settleTournamentMatchWagers(tournamentMatchId, winnerId);
      } else {
        // No games played — refund all bets
        await cancelTournamentMatchWagers(tournamentMatchId);
      }
    } catch (error) {
      console.error(
        'Failed to settle/cancel tournament wagers on override:',
        error,
      );
    }
  }

  broadcast('poolTournament', {
    type: 'match_completed',
    tournamentId: tMatch.tournamentId,
  });
}

// ---------------------------------------------------------------------------
// Query Helpers
// ---------------------------------------------------------------------------

async function getTournamentMatches(tournamentId: string): Promise<TournamentMatch[]> {
  const result = await query<TournamentMatchRow>(
    `SELECT ${TOURNAMENT_MATCH_SELECT} FROM pool_tournament_matches
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
    } else if (m.bracket === 'grand_final') {
      grandFinal.push(m);
    }
  }

  // Sort each round by position
  const sortByPosition = (a: TournamentMatch, b: TournamentMatch) =>
    a.position - b.position;

  const winnersArray: TournamentMatch[][] = [];
  const maxWinnersRound = Math.max(0, ...winners.keys());
  for (let r = 1; r <= maxWinnersRound; r++) {
    winnersArray.push((winners.get(r) ?? []).sort(sortByPosition));
  }

  const losersArray: TournamentMatch[][] = [];
  const maxLosersRound = Math.max(0, ...losers.keys());
  for (let r = 1; r <= maxLosersRound; r++) {
    losersArray.push((losers.get(r) ?? []).sort(sortByPosition));
  }

  return {
    winners: winnersArray,
    losers: losersArray,
    grandFinal: grandFinal.sort((a, b) => a.round - b.round),
  };
}

/** Get the active pool match IDs for a tournament match (for linking to game pages). */
export async function getActivePoolMatchForTournamentMatch(
  tournamentMatchId: string,
): Promise<string | null> {
  const rows = await query<{ id: string; status: string }>(
    `SELECT id, status FROM pool_matches WHERE tournament_match_id = $1`,
    [tournamentMatchId],
  );

  const active = rows.rows.find(
    (r) => r.status === 'active' || r.status === 'waiting',
  );
  return active?.id ?? null;
}
