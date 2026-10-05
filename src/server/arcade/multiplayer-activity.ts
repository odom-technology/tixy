import { query } from '@/server/db/client';
import {
  MULTIPLAYER_GAME_CONFIG,
  type MultiplayerGameType,
} from '@/server/arcade/multiplayer';

export type MultiplayerActivityGameType = Exclude<MultiplayerGameType, 'blackjack' | 'derby'>;

export type MultiplayerGameActivity = {
  gameType: MultiplayerActivityGameType;
  label: string;
  lobbyPath: string;
  playersInGame: number;
  openLobbies: number;
  liveMatches: number;
};

export type MultiplayerFeaturedReason =
  | 'open-lobbies'
  | 'players-online'
  | 'live-matches'
  | 'daily-rotation';

export type MultiplayerFeaturedActivity = MultiplayerGameActivity & {
  reason: MultiplayerFeaturedReason;
};

export type MultiplayerActivitySnapshot = {
  generatedAt: number;
  connectedNow: number;
  friendsOnline: number | null;
  openLobbies: number;
  liveMatches: number;
  games: MultiplayerGameActivity[];
  featured: MultiplayerFeaturedActivity;
};

type ActivityRow = {
  gameType: MultiplayerActivityGameType;
  playersInGame: string | number;
  openLobbies: string | number;
  liveMatches: string | number;
};

type ConnectedRow = { count: string | number };

/**
 * Blackjack uses a shared dealer table rather than the unified versus queue,
 * so it is intentionally excluded from this recommendation surface. Keeping
 * the pool explicit also makes the daily fallback stable as games are added.
 */
export const MULTIPLAYER_ACTIVITY_GAME_TYPES: readonly MultiplayerActivityGameType[] = [
  '8-ball',
  'chess',
  'typing-test',
  'connect-four',
  'checkers',
  'reversi',
  'battleship',
];

const PRESENCE_FRESH_MS = 90_000;
const LIVE_MATCH_FRESH_MS = 5 * 60_000;

function numberFromDb(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function localDateKey(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function rotationIndex(dateKey: string, size: number): number {
  let hash = 0;
  for (let index = 0; index < dateKey.length; index += 1) {
    hash = (hash * 31 + dateKey.charCodeAt(index)) >>> 0;
  }
  return size > 0 ? hash % size : 0;
}

function activityScore(game: MultiplayerGameActivity): number {
  // A waiting player is the most valuable recommendation: sending one person
  // there can create a match immediately. Presence and live matches are softer
  // signals that still keep players concentrated in the same cabinet.
  return game.openLobbies * 10 + game.playersInGame * 3 + game.liveMatches * 2;
}

export function pickFeaturedMultiplayerGame(
  games: readonly MultiplayerGameActivity[],
  dateKey: string,
): MultiplayerFeaturedActivity {
  if (games.length === 0) {
    throw new Error('At least one multiplayer game is required.');
  }

  const rotated = games.map((_, index) => games[(index + rotationIndex(dateKey, games.length)) % games.length]!);
  const featured = rotated.reduce((best, game) =>
    activityScore(game) > activityScore(best) ? game : best,
  );
  const reason: MultiplayerFeaturedReason =
    featured.openLobbies > 0
      ? 'open-lobbies'
      : featured.playersInGame > 0
        ? 'players-online'
        : featured.liveMatches > 0
          ? 'live-matches'
          : 'daily-rotation';

  return { ...featured, reason };
}

function gameActivityFromRow(row: ActivityRow | undefined, gameType: MultiplayerActivityGameType) {
  const config = MULTIPLAYER_GAME_CONFIG[gameType];
  return {
    gameType,
    label: config.label,
    lobbyPath: config.lobbyPath,
    playersInGame: numberFromDb(row?.playersInGame),
    openLobbies: numberFromDb(row?.openLobbies),
    liveMatches: numberFromDb(row?.liveMatches),
  } satisfies MultiplayerGameActivity;
}

/**
 * Aggregated multiplayer demand only. No account ids, player names, lobby ids,
 * or invite-only matches leave this module. A waiting lobby is counted only
 * while its owner has fresh presence, avoiding 14-day retained queue rows being
 * presented as people who are ready to play now.
 */
export async function getMultiplayerActivitySnapshot(input?: {
  now?: number;
  friendsOnline?: number | null;
}): Promise<MultiplayerActivitySnapshot> {
  const now = input?.now ?? Date.now();
  const presenceCutoff = now - PRESENCE_FRESH_MS;
  const liveCutoff = now - LIVE_MATCH_FRESH_MS;

  const [activityResult, connectedResult] = await Promise.all([
    query<ActivityRow>(
      `
        WITH fresh_presence AS (
          SELECT user_id, status, game_slug
          FROM arcade_user_presence
          WHERE status <> 'offline' AND last_seen_at >= $1
        ), match_activity AS (
          SELECT '8-ball'::text AS "gameType",
                 COUNT(*) FILTER (
                   WHERE status = 'waiting' AND invited_user_id IS NULL
                     AND EXISTS (SELECT 1 FROM fresh_presence p WHERE p.user_id = player1_id)
                 ) AS "openLobbies",
                 COUNT(*) FILTER (
                   WHERE status = 'active' AND updated_at >= $2
                     AND player2_id IS NOT NULL AND player2_id NOT LIKE 'bot:%'
                 ) AS "liveMatches"
          FROM pool_matches
          UNION ALL
          SELECT 'chess',
                 COUNT(*) FILTER (
                   WHERE status = 'waiting' AND invited_user_id IS NULL
                     AND EXISTS (SELECT 1 FROM fresh_presence p WHERE p.user_id = player1_id)
                 ),
                 COUNT(*) FILTER (
                   WHERE status = 'active' AND updated_at >= $2
                     AND player2_id IS NOT NULL AND player2_id NOT LIKE 'bot:%'
                 )
          FROM chess_matches
          UNION ALL
          SELECT 'connect-four',
                 COUNT(*) FILTER (
                   WHERE status = 'waiting' AND invited_user_id IS NULL
                     AND EXISTS (SELECT 1 FROM fresh_presence p WHERE p.user_id = player1_id)
                 ),
                 COUNT(*) FILTER (
                   WHERE status = 'active' AND updated_at >= $2
                     AND player2_id IS NOT NULL AND player2_id NOT LIKE 'bot:%'
                 )
          FROM connect_four_matches
          UNION ALL
          SELECT 'checkers',
                 COUNT(*) FILTER (
                   WHERE status = 'waiting' AND invited_user_id IS NULL
                     AND EXISTS (SELECT 1 FROM fresh_presence p WHERE p.user_id = player1_id)
                 ),
                 COUNT(*) FILTER (
                   WHERE status = 'active' AND updated_at >= $2
                     AND player2_id IS NOT NULL AND player2_id NOT LIKE 'bot:%'
                 )
          FROM checkers_matches
          UNION ALL
          SELECT 'reversi',
                 COUNT(*) FILTER (
                   WHERE status = 'waiting' AND invited_user_id IS NULL
                     AND EXISTS (SELECT 1 FROM fresh_presence p WHERE p.user_id = player1_id)
                 ),
                 COUNT(*) FILTER (
                   WHERE status = 'active' AND updated_at >= $2
                     AND player2_id IS NOT NULL AND player2_id NOT LIKE 'bot:%'
                 )
          FROM reversi_matches
          UNION ALL
          SELECT 'battleship',
                 COUNT(*) FILTER (
                   WHERE status = 'waiting' AND invited_user_id IS NULL
                     AND EXISTS (SELECT 1 FROM fresh_presence p WHERE p.user_id = player1_id)
                 ),
                 COUNT(*) FILTER (
                   WHERE status = 'active' AND updated_at >= $2
                     AND player2_id IS NOT NULL AND player2_id NOT LIKE 'bot:%'
                 )
          FROM battleship_matches
          UNION ALL
          SELECT 'typing-test',
                 COUNT(*) FILTER (
                   WHERE status = 'waiting' AND visibility = 'public'
                     AND current_player_count < max_players
                     AND EXISTS (SELECT 1 FROM fresh_presence p WHERE p.user_id = owner_user_id)
                 ),
                 COUNT(*) FILTER (WHERE status = 'active' AND updated_at >= $2)
          FROM arcade_multiplayer_sessions
          WHERE game_type = 'typing-test'
        ), in_game_presence AS (
          SELECT CASE game_slug WHEN 'typing-duel' THEN 'typing-test' ELSE game_slug END AS "gameType",
                 COUNT(*) AS "playersInGame"
          FROM fresh_presence
          WHERE status = 'in_game'
            AND game_slug IN ('8-ball', 'chess', 'typing-duel', 'connect-four', 'checkers', 'reversi', 'battleship')
          GROUP BY 1
        )
        SELECT m."gameType",
               COALESCE(p."playersInGame", 0) AS "playersInGame",
               m."openLobbies",
               m."liveMatches"
        FROM match_activity m
        LEFT JOIN in_game_presence p ON p."gameType" = m."gameType"
      `,
      [presenceCutoff, liveCutoff],
    ),
    query<ConnectedRow>(
      `SELECT COUNT(*) AS count
       FROM arcade_user_presence
       WHERE status <> 'offline' AND last_seen_at >= $1`,
      [presenceCutoff],
    ),
  ]);

  const rowsByGame = new Map(activityResult.rows.map((row) => [row.gameType, row]));
  const games = MULTIPLAYER_ACTIVITY_GAME_TYPES.map((gameType) =>
    gameActivityFromRow(rowsByGame.get(gameType), gameType),
  );
  const dateKey = localDateKey(new Date(now));

  return {
    generatedAt: now,
    connectedNow: numberFromDb(connectedResult.rows[0]?.count),
    friendsOnline: input?.friendsOnline ?? null,
    openLobbies: games.reduce((total, game) => total + game.openLobbies, 0),
    liveMatches: games.reduce((total, game) => total + game.liveMatches, 0),
    games,
    featured: pickFeaturedMultiplayerGame(games, dateKey),
  };
}
