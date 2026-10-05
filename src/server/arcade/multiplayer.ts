import { assertGameAvailable } from '@/server/arcade/game-availability';
import crypto from 'node:crypto';

import type { PoolClient } from 'pg';

import { getGameDisplayRoute, getGameTitle } from '@/features/arcade/lib/game-renames';
import { query, queryOne, withTransaction } from '@/server/db/client';

export type MultiplayerGameType = '8-ball' | 'chess' | 'blackjack' | 'typing-test' | 'connect-four' | 'checkers' | 'reversi' | 'battleship' | 'derby';
export type MultiplayerPlayMode = 'versus' | 'shared-table';
export type MultiplayerTargetKind = 'match' | 'table';
export type MultiplayerSessionStatus = 'waiting' | 'active' | 'completed' | 'cancelled';
export type MultiplayerSessionVisibility = 'invite' | 'public' | 'private';
export type MultiplayerSessionPlayerStatus = 'seated' | 'ready' | 'left';

export type ArcadeFriendshipStatus = 'pending' | 'accepted';

export type ArcadeFriendship = {
  id: string;
  requesterUserId: string;
  recipientUserId: string;
  userAId: string;
  userBId: string;
  status: ArcadeFriendshipStatus;
  createdAt: number;
  updatedAt: number;
  acceptedAt: number | null;
};

export type ArcadeFriendList = {
  friends: ArcadeFriendship[];
  incoming: ArcadeFriendship[];
  outgoing: ArcadeFriendship[];
};

export type GameInviteCode = {
  code: string;
  gameType: MultiplayerGameType;
  matchId: string;
  targetKind: MultiplayerTargetKind;
  targetId: string;
  createdByUserId: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
  maxClaims: number;
  claimCount: number;
  claimedByUserId: string | null;
  claimedAt: number | null;
  lastClaimedByUserId: string | null;
  lastClaimedAt: number | null;
};

export type MultiplayerSession = {
  id: string;
  gameType: MultiplayerGameType;
  mode: MultiplayerPlayMode;
  status: MultiplayerSessionStatus;
  ownerUserId: string;
  ownerUserName: string;
  minPlayers: number;
  maxPlayers: number;
  currentPlayerCount: number;
  visibility: MultiplayerSessionVisibility;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
};

export type MultiplayerSessionPlayer = {
  sessionId: string;
  userId: string;
  userName: string;
  seatIndex: number;
  role: string;
  status: MultiplayerSessionPlayerStatus;
  joinedAt: number;
  updatedAt: number;
  leftAt: number | null;
};

export type MultiplayerSessionSnapshot = {
  session: MultiplayerSession;
  players: MultiplayerSessionPlayer[];
};

type FriendshipRow = {
  id: string;
  requesterUserId: string;
  recipientUserId: string;
  userAId: string;
  userBId: string;
  status: ArcadeFriendshipStatus;
  createdAt: string | number;
  updatedAt: string | number;
  acceptedAt: string | number | null;
};

type GameInviteRow = {
  code: string;
  gameType: MultiplayerGameType;
  matchId: string;
  targetKind: MultiplayerTargetKind | null;
  targetId: string | null;
  createdByUserId: string;
  createdAt: string | number;
  updatedAt: string | number;
  expiresAt: string | number | null;
  maxClaims: string | number | null;
  claimCount: string | number | null;
  claimedByUserId: string | null;
  claimedAt: string | number | null;
  lastClaimedByUserId: string | null;
  lastClaimedAt: string | number | null;
};

type MultiplayerSessionRow = {
  id: string;
  gameType: MultiplayerGameType;
  mode: MultiplayerPlayMode;
  status: MultiplayerSessionStatus;
  ownerUserId: string;
  ownerUserName: string;
  minPlayers: string | number;
  maxPlayers: string | number;
  currentPlayerCount: string | number;
  visibility: MultiplayerSessionVisibility;
  metadataJson: string | null;
  createdAt: string | number;
  updatedAt: string | number;
  startedAt: string | number | null;
  completedAt: string | number | null;
};

type MultiplayerSessionPlayerRow = {
  sessionId: string;
  userId: string;
  userName: string;
  seatIndex: string | number;
  role: string;
  status: MultiplayerSessionPlayerStatus;
  joinedAt: string | number;
  updatedAt: string | number;
  leftAt: string | number | null;
};

export const MULTIPLAYER_GAME_CONFIG: Record<
  MultiplayerGameType,
  {
    label: string;
    lobbyPath: string;
    playMode: MultiplayerPlayMode;
    targetKind: MultiplayerTargetKind;
    minPlayers: number;
    maxPlayers: number;
    sharedOpponentLabel?: string;
  }
> = {
  '8-ball': {
    label: '8-Ball Pool',
    lobbyPath: '/8-ball',
    playMode: 'versus',
    targetKind: 'match',
    minPlayers: 2,
    maxPlayers: 2,
  },
  chess: {
    label: 'Chess',
    lobbyPath: '/chess',
    playMode: 'versus',
    targetKind: 'match',
    minPlayers: 2,
    maxPlayers: 2,
  },
  blackjack: {
    label: 'Blackjack',
    lobbyPath: '/21',
    playMode: 'shared-table',
    targetKind: 'table',
    minPlayers: 1,
    maxPlayers: 5,
    sharedOpponentLabel: 'Dealer',
  },
  'typing-test': {
    label: 'Typing Duel',
    lobbyPath: '/typing-test/duel',
    playMode: 'versus',
    targetKind: 'match',
    minPlayers: 2,
    maxPlayers: 2,
  },
  'connect-four': {
    label: getGameTitle('connect-four', 'Connect Four'),
    lobbyPath: getGameDisplayRoute('connect-four', '/connect-four'),
    playMode: 'versus',
    targetKind: 'match',
    minPlayers: 2,
    maxPlayers: 2,
  },
  checkers: {
    label: 'Checkers',
    lobbyPath: '/checkers',
    playMode: 'versus',
    targetKind: 'match',
    minPlayers: 2,
    maxPlayers: 2,
  },
  reversi: {
    label: 'Reversi',
    lobbyPath: '/reversi',
    playMode: 'versus',
    targetKind: 'match',
    minPlayers: 2,
    maxPlayers: 2,
  },
  battleship: {
    label: getGameTitle('battleship', 'Battleship'),
    lobbyPath: getGameDisplayRoute('battleship', '/battleship'),
    playMode: 'versus',
    targetKind: 'match',
    minPlayers: 2,
    maxPlayers: 2,
  },  // Derby: up to eight lanes, so an invite code takes up to seven friends.
  // Races live in derby_water_races (src/server/arcade/derby-race).
  derby: {
    label: 'Derby',
    lobbyPath: '/derby',
    playMode: 'shared-table',
    targetKind: 'table',
    minPlayers: 1,
    maxPlayers: 8,
  },

};

const GAME_INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const GAME_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const friendshipSelect = `
  id,
  requester_user_id AS "requesterUserId",
  recipient_user_id AS "recipientUserId",
  user_a_id AS "userAId",
  user_b_id AS "userBId",
  status,
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  accepted_at AS "acceptedAt"
`;

const gameInviteSelect = `
  code,
  game_type AS "gameType",
  match_id AS "matchId",
  target_kind AS "targetKind",
  COALESCE(target_id, match_id) AS "targetId",
  created_by_user_id AS "createdByUserId",
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  expires_at AS "expiresAt",
  max_claims AS "maxClaims",
  claim_count AS "claimCount",
  claimed_by_user_id AS "claimedByUserId",
  claimed_at AS "claimedAt",
  last_claimed_by_user_id AS "lastClaimedByUserId",
  last_claimed_at AS "lastClaimedAt"
`;

const multiplayerSessionSelect = `
  id,
  game_type AS "gameType",
  mode,
  status,
  owner_user_id AS "ownerUserId",
  owner_user_name AS "ownerUserName",
  min_players AS "minPlayers",
  max_players AS "maxPlayers",
  current_player_count AS "currentPlayerCount",
  visibility,
  metadata_json AS "metadataJson",
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  started_at AS "startedAt",
  completed_at AS "completedAt"
`;

const multiplayerSessionPlayerSelect = `
  session_id AS "sessionId",
  user_id AS "userId",
  user_name AS "userName",
  seat_index AS "seatIndex",
  role,
  status,
  joined_at AS "joinedAt",
  updated_at AS "updatedAt",
  left_at AS "leftAt"
`;

const rowToFriendship = (row: FriendshipRow): ArcadeFriendship => ({
  id: row.id,
  requesterUserId: row.requesterUserId,
  recipientUserId: row.recipientUserId,
  userAId: row.userAId,
  userBId: row.userBId,
  status: row.status,
  createdAt: Number(row.createdAt ?? 0),
  updatedAt: Number(row.updatedAt ?? 0),
  acceptedAt: row.acceptedAt == null ? null : Number(row.acceptedAt),
});

const rowToGameInvite = (row: GameInviteRow): GameInviteCode => ({
  code: row.code,
  gameType: row.gameType,
  matchId: row.matchId,
  targetKind: row.targetKind ?? 'match',
  targetId: row.targetId ?? row.matchId,
  createdByUserId: row.createdByUserId,
  createdAt: Number(row.createdAt ?? 0),
  updatedAt: Number(row.updatedAt ?? 0),
  expiresAt: row.expiresAt == null ? null : Number(row.expiresAt),
  maxClaims: Number(row.maxClaims ?? 1),
  claimCount: Number(row.claimCount ?? (row.claimedAt == null ? 0 : 1)),
  claimedByUserId: row.claimedByUserId ?? null,
  claimedAt: row.claimedAt == null ? null : Number(row.claimedAt),
  lastClaimedByUserId: row.lastClaimedByUserId ?? row.claimedByUserId ?? null,
  lastClaimedAt:
    row.lastClaimedAt == null
      ? row.claimedAt == null
        ? null
        : Number(row.claimedAt)
      : Number(row.lastClaimedAt),
});

const rowToMultiplayerSession = (row: MultiplayerSessionRow): MultiplayerSession => ({
  id: row.id,
  gameType: row.gameType,
  mode: row.mode,
  status: row.status,
  ownerUserId: row.ownerUserId,
  ownerUserName: row.ownerUserName,
  minPlayers: Number(row.minPlayers ?? 1),
  maxPlayers: Number(row.maxPlayers ?? 1),
  currentPlayerCount: Number(row.currentPlayerCount ?? 0),
  visibility: row.visibility,
  metadata: parseMetadataJson(row.metadataJson),
  createdAt: Number(row.createdAt ?? 0),
  updatedAt: Number(row.updatedAt ?? 0),
  startedAt: row.startedAt == null ? null : Number(row.startedAt),
  completedAt: row.completedAt == null ? null : Number(row.completedAt),
});

const rowToMultiplayerSessionPlayer = (
  row: MultiplayerSessionPlayerRow,
): MultiplayerSessionPlayer => ({
  sessionId: row.sessionId,
  userId: row.userId,
  userName: row.userName,
  seatIndex: Number(row.seatIndex ?? 0),
  role: row.role,
  status: row.status,
  joinedAt: Number(row.joinedAt ?? 0),
  updatedAt: Number(row.updatedAt ?? 0),
  leftAt: row.leftAt == null ? null : Number(row.leftAt),
});

export function normalizeGameCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isMultiplayerGameType(value: string): value is MultiplayerGameType {
  return value in MULTIPLAYER_GAME_CONFIG;
}

export function getMultiplayerGameConfig(gameType: MultiplayerGameType) {
  return MULTIPLAYER_GAME_CONFIG[gameType];
}

export function getGameCodeJoinHref(gameType: MultiplayerGameType, code: string) {
  return `${MULTIPLAYER_GAME_CONFIG[gameType].lobbyPath}?code=${encodeURIComponent(code)}`;
}

export function getMatchJoinHref(gameType: MultiplayerGameType, matchId: string) {
  return `${MULTIPLAYER_GAME_CONFIG[gameType].lobbyPath}?join=${encodeURIComponent(matchId)}`;
}

export function getTableJoinHref(gameType: MultiplayerGameType, tableId: string) {
  return `${MULTIPLAYER_GAME_CONFIG[gameType].lobbyPath}?table=${encodeURIComponent(tableId)}`;
}

export function getMultiplayerTargetJoinHref(input: {
  gameType: MultiplayerGameType;
  targetKind: MultiplayerTargetKind;
  targetId: string;
}) {
  return input.targetKind === 'table'
    ? getTableJoinHref(input.gameType, input.targetId)
    : getMatchJoinHref(input.gameType, input.targetId);
}

export function getPublicBaseUrlForRequest(request: Request) {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
  if (configured) return configured.replace(/\/+$/, '');

  const forwardedHost = request.headers
    .get('x-forwarded-host')
    ?.split(',')[0]
    ?.trim();
  const forwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim();
  if (forwardedHost) {
    return `${forwardedProto || 'https'}://${forwardedHost}`.replace(/\/+$/, '');
  }

  const host = request.headers.get('host')?.trim();
  if (host) {
    const proto =
      forwardedProto ||
      (host.includes('localhost') ||
      host.startsWith('127.') ||
      host.startsWith('0.0.0.0')
        ? 'http'
        : 'https');
    return `${proto}://${host}`.replace(/\/+$/, '');
  }

  return 'http://localhost:3000';
}

export function withAbsoluteUrl(href: string, request: Request) {
  return new URL(href, getPublicBaseUrlForRequest(request)).toString();
}

export async function listFriendshipsForUser(userId: string): Promise<ArcadeFriendList> {
  const result = await query<FriendshipRow>(
    `
      SELECT ${friendshipSelect}
      FROM arcade_friendships
      WHERE user_a_id = $1 OR user_b_id = $1
      ORDER BY updated_at DESC
    `,
    [userId],
  );
  const friendships = result.rows.map(rowToFriendship);

  return {
    friends: friendships.filter((row) => row.status === 'accepted'),
    incoming: friendships.filter(
      (row) => row.status === 'pending' && row.recipientUserId === userId,
    ),
    outgoing: friendships.filter(
      (row) => row.status === 'pending' && row.requesterUserId === userId,
    ),
  };
}

export function getOtherFriendshipUserId(friendship: ArcadeFriendship, userId: string) {
  return friendship.userAId === userId ? friendship.userBId : friendship.userAId;
}

/** Lean list of accepted-friend user ids — used for realtime presence/activity fan-out. */
export async function listAcceptedFriendIds(userId: string): Promise<string[]> {
  const result = await query<{ otherId: string }>(
    `
      SELECT CASE WHEN user_a_id = $1 THEN user_b_id ELSE user_a_id END AS "otherId"
      FROM arcade_friendships
      WHERE status = 'accepted' AND (user_a_id = $1 OR user_b_id = $1)
    `,
    [userId],
  );
  return result.rows.map((row) => row.otherId);
}

async function getFriendshipForPair(userId: string, targetUserId: string) {
  const [userAId, userBId] = sortFriendPair(userId, targetUserId);
  const row = await queryOne<FriendshipRow>(
    `
      SELECT ${friendshipSelect}
      FROM arcade_friendships
      WHERE user_a_id = $1 AND user_b_id = $2
      LIMIT 1
    `,
    [userAId, userBId],
  );
  return row ? rowToFriendship(row) : null;
}

async function getFriendshipById(friendshipId: string) {
  const row = await queryOne<FriendshipRow>(
    `
      SELECT ${friendshipSelect}
      FROM arcade_friendships
      WHERE id = $1
      LIMIT 1
    `,
    [friendshipId],
  );
  return row ? rowToFriendship(row) : null;
}

export async function areArcadeFriends(userId: string, targetUserId: string) {
  const row = await getFriendshipForPair(userId, targetUserId);
  return row?.status === 'accepted';
}

export async function sendArcadeFriendRequest(input: {
  requesterUserId: string;
  recipientUserId: string;
}) {
  const { requesterUserId, recipientUserId } = input;
  if (requesterUserId === recipientUserId) {
    throw new Error('You cannot add yourself as a friend.');
  }

  const [userAId, userBId] = sortFriendPair(requesterUserId, recipientUserId);
  const existing = await getFriendshipForPair(requesterUserId, recipientUserId);
  if (existing) {
    if (existing.status === 'accepted') return existing;
    if (existing.recipientUserId === requesterUserId) {
      return acceptArcadeFriendship({
        friendshipId: existing.id,
        actorUserId: requesterUserId,
      });
    }
    return existing;
  }

  const now = Date.now();
  const id = crypto.randomUUID();
  await query(
    `
      INSERT INTO arcade_friendships (
        id,
        requester_user_id,
        recipient_user_id,
        user_a_id,
        user_b_id,
        status,
        created_at,
        updated_at,
        accepted_at
      ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $6, NULL)
    `,
    [id, requesterUserId, recipientUserId, userAId, userBId, now],
  );

  const row = await getFriendshipById(id);
  if (!row) throw new Error('Friend request could not be created.');
  return row;
}

export async function acceptArcadeFriendship(input: {
  friendshipId: string;
  actorUserId: string;
}) {
  const row = await getFriendshipById(input.friendshipId);
  if (!row) throw new Error('Friend request not found.');
  if (row.status === 'accepted') return row;
  if (row.recipientUserId !== input.actorUserId) {
    throw new Error('Only the recipient can accept this friend request.');
  }

  const now = Date.now();
  await query(
    `
      UPDATE arcade_friendships
      SET status = 'accepted',
          updated_at = $1,
          accepted_at = COALESCE(accepted_at, $1)
      WHERE id = $2
    `,
    [now, input.friendshipId],
  );
  const updated = await getFriendshipById(input.friendshipId);
  if (!updated) throw new Error('Friend request not found.');
  return updated;
}

export async function deleteArcadeFriendship(input: {
  friendshipId: string;
  actorUserId: string;
}) {
  const row = await getFriendshipById(input.friendshipId);
  if (!row) throw new Error('Friendship not found.');
  if (row.userAId !== input.actorUserId && row.userBId !== input.actorUserId) {
    throw new Error('You cannot update this friendship.');
  }
  await query('DELETE FROM arcade_friendships WHERE id = $1', [
    input.friendshipId,
  ]);
}

/** Blocking a player also removes any pending or accepted relationship. */
export async function deleteFriendshipBetweenUsers(userId: string, targetUserId: string) {
  const [userAId, userBId] = sortFriendPair(userId, targetUserId);
  await query(
    'DELETE FROM arcade_friendships WHERE user_a_id = $1 AND user_b_id = $2',
    [userAId, userBId],
  );
}

export async function createGameInviteCode(input: {
  gameType: MultiplayerGameType;
  matchId?: string;
  targetKind?: MultiplayerTargetKind;
  targetId?: string;
  createdByUserId: string;
  maxClaims?: number;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const config = MULTIPLAYER_GAME_CONFIG[input.gameType];
  const targetKind = input.targetKind ?? config.targetKind;
  const targetId = (input.targetId ?? input.matchId)?.trim();
  if (!targetId) throw new Error('targetId is required.');
  const matchId = input.matchId?.trim() || targetId;
  const maxClaims = clampPositiveInteger(
    input.maxClaims ?? (targetKind === 'table' ? config.maxPlayers : 1),
    1,
    config.maxPlayers,
  );

  const existing = await queryOne<GameInviteRow>(
    `
      SELECT ${gameInviteSelect}
      FROM arcade_game_invites
      WHERE game_type = $1
        AND COALESCE(target_kind, 'match') = $2
        AND COALESCE(target_id, match_id) = $3
        AND COALESCE(claim_count, CASE WHEN claimed_at IS NULL THEN 0 ELSE 1 END) < COALESCE(max_claims, 1)
        AND (expires_at IS NULL OR expires_at > $4)
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [input.gameType, targetKind, targetId, now],
  );
  if (existing) return rowToGameInvite(existing);

  const expiresAt = now + GAME_INVITE_TTL_MS;
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateGameCode();
    try {
      await query(
        `
          INSERT INTO arcade_game_invites (
            code,
            game_type,
            match_id,
            target_kind,
            target_id,
            created_by_user_id,
            created_at,
            updated_at,
            expires_at,
            max_claims,
            claim_count,
            claimed_by_user_id,
            claimed_at,
            last_claimed_by_user_id,
            last_claimed_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, 0, NULL, NULL, NULL, NULL)
        `,
        [
          code,
          input.gameType,
          matchId,
          targetKind,
          targetId,
          input.createdByUserId,
          now,
          expiresAt,
          maxClaims,
        ],
      );
      return {
        code,
        gameType: input.gameType,
        matchId,
        targetKind,
        targetId,
        createdByUserId: input.createdByUserId,
        createdAt: now,
        updatedAt: now,
        expiresAt,
        maxClaims,
        claimCount: 0,
        claimedByUserId: null,
        claimedAt: null,
        lastClaimedByUserId: null,
        lastClaimedAt: null,
      } satisfies GameInviteCode;
    } catch (error) {
      if (attempt === 7) throw error;
    }
  }

  throw new Error('Unable to create a game code.');
}

export async function getGameInviteCode(code: string) {
  const normalized = normalizeGameCode(code);
  if (!normalized) return null;
  const row = await queryOne<GameInviteRow>(
    `
      SELECT ${gameInviteSelect}
      FROM arcade_game_invites
      WHERE code = $1
        AND (expires_at IS NULL OR expires_at > $2)
        AND COALESCE(claim_count, CASE WHEN claimed_at IS NULL THEN 0 ELSE 1 END) < COALESCE(max_claims, 1)
      LIMIT 1
    `,
    [normalized, Date.now()],
  );
  return row ? rowToGameInvite(row) : null;
}

export async function markGameInviteCodeClaimed(input: {
  code: string;
  gameType: MultiplayerGameType;
  matchId: string;
  targetKind?: MultiplayerTargetKind;
  targetId?: string;
  claimedByUserId: string;
}) {
  const now = Date.now();
  const targetKind = input.targetKind ?? 'match';
  const targetId = input.targetId ?? input.matchId;
  await query(
    `
      UPDATE arcade_game_invites
      SET claimed_by_user_id = COALESCE(claimed_by_user_id, $1),
          claimed_at = COALESCE(claimed_at, $2),
          last_claimed_by_user_id = $1,
          last_claimed_at = $2,
          claim_count = COALESCE(claim_count, CASE WHEN claimed_at IS NULL THEN 0 ELSE 1 END) + 1,
          updated_at = $2
      WHERE code = $3
        AND game_type = $4
        AND COALESCE(target_kind, 'match') = $5
        AND COALESCE(target_id, match_id) = $6
        AND COALESCE(claim_count, CASE WHEN claimed_at IS NULL THEN 0 ELSE 1 END) < COALESCE(max_claims, 1)
    `,
    [
      input.claimedByUserId,
      now,
      normalizeGameCode(input.code),
      input.gameType,
      targetKind,
      targetId,
    ],
  );
}

export async function createMultiplayerSession(input: {
  gameType: MultiplayerGameType;
  ownerUserId: string;
  ownerUserName: string;
  visibility?: MultiplayerSessionVisibility;
  minPlayers?: number;
  maxPlayers?: number;
  metadata?: Record<string, unknown>;
  now?: number;
}): Promise<MultiplayerSessionSnapshot> {
  await assertGameAvailable(input.gameType);
  const config = MULTIPLAYER_GAME_CONFIG[input.gameType];
  const now = input.now ?? Date.now();
  const maxPlayers = clampPositiveInteger(
    input.maxPlayers ?? config.maxPlayers,
    config.minPlayers,
    config.maxPlayers,
  );
  const minPlayers = clampPositiveInteger(
    input.minPlayers ?? config.minPlayers,
    1,
    maxPlayers,
  );
  const visibility = input.visibility ?? 'invite';
  const metadataJson = JSON.stringify(
    normalizeSessionMetadata(input.gameType, input.metadata),
  );
  const sessionId = crypto.randomUUID();

  return withTransaction(async (client) => {
    await client.query(
      `
        INSERT INTO arcade_multiplayer_sessions (
          id,
          game_type,
          mode,
          status,
          owner_user_id,
          owner_user_name,
          min_players,
          max_players,
          current_player_count,
          visibility,
          metadata_json,
          created_at,
          updated_at,
          started_at,
          completed_at
        ) VALUES ($1, $2, $3, 'waiting', $4, $5, $6, $7, 1, $8, $9, $10, $10, NULL, NULL)
      `,
      [
        sessionId,
        input.gameType,
        config.playMode,
        input.ownerUserId,
        input.ownerUserName,
        minPlayers,
        maxPlayers,
        visibility,
        metadataJson,
        now,
      ],
    );

    await client.query(
      `
        INSERT INTO arcade_multiplayer_session_players (
          session_id,
          user_id,
          user_name,
          seat_index,
          role,
          status,
          joined_at,
          updated_at,
          left_at
        ) VALUES ($1, $2, $3, 0, 'player', 'seated', $4, $4, NULL)
      `,
      [sessionId, input.ownerUserId, input.ownerUserName, now],
    );

    return getMultiplayerSessionSnapshotTx(client, sessionId);
  });
}

export async function getMultiplayerSession(
  sessionId: string,
): Promise<MultiplayerSession | null> {
  const row = await queryOne<MultiplayerSessionRow>(
    `
      SELECT ${multiplayerSessionSelect}
      FROM arcade_multiplayer_sessions
      WHERE id = $1
      LIMIT 1
    `,
    [sessionId],
  );
  return row ? rowToMultiplayerSession(row) : null;
}

export async function listMultiplayerSessionPlayers(
  sessionId: string,
): Promise<MultiplayerSessionPlayer[]> {
  const result = await query<MultiplayerSessionPlayerRow>(
    `
      SELECT ${multiplayerSessionPlayerSelect}
      FROM arcade_multiplayer_session_players
      WHERE session_id = $1
        AND status <> 'left'
      ORDER BY seat_index ASC, joined_at ASC
    `,
    [sessionId],
  );
  return result.rows.map(rowToMultiplayerSessionPlayer);
}

export async function getMultiplayerSessionSnapshot(
  sessionId: string,
): Promise<MultiplayerSessionSnapshot | null> {
  const session = await getMultiplayerSession(sessionId);
  if (!session) return null;
  return {
    session,
    players: await listMultiplayerSessionPlayers(sessionId),
  };
}

export async function listOpenMultiplayerSessions(input: {
  gameType?: MultiplayerGameType;
  limit?: number;
} = {}): Promise<MultiplayerSession[]> {
  const limit = clampPositiveInteger(input.limit ?? 20, 1, 100);
  const params: unknown[] = [];
  const gameTypeWhere = input.gameType
    ? (() => {
        params.push(input.gameType);
        return `AND game_type = $${params.length}`;
      })()
    : '';
  params.push(limit);

  const result = await query<MultiplayerSessionRow>(
    `
      SELECT ${multiplayerSessionSelect}
      FROM arcade_multiplayer_sessions
      WHERE status IN ('waiting', 'active')
        AND current_player_count < max_players
        ${gameTypeWhere}
      ORDER BY updated_at DESC
      LIMIT $${params.length}
    `,
    params,
  );
  return result.rows.map(rowToMultiplayerSession);
}

export async function listOpenMultiplayerSessionSnapshots(input: {
  gameType?: MultiplayerGameType;
  limit?: number;
} = {}): Promise<MultiplayerSessionSnapshot[]> {
  const sessions = await listOpenMultiplayerSessions(input);
  if (sessions.length === 0) return [];

  const sessionIds = sessions.map((session) => session.id);
  const playersResult = await query<MultiplayerSessionPlayerRow>(
    `
      SELECT ${multiplayerSessionPlayerSelect}
      FROM arcade_multiplayer_session_players
      WHERE session_id = ANY($1::text[])
        AND status <> 'left'
      ORDER BY session_id ASC, seat_index ASC, joined_at ASC
    `,
    [sessionIds],
  );

  const playersBySessionId = new Map<string, MultiplayerSessionPlayer[]>();
  for (const row of playersResult.rows) {
    const player = rowToMultiplayerSessionPlayer(row);
    const players = playersBySessionId.get(player.sessionId);
    if (players) {
      players.push(player);
    } else {
      playersBySessionId.set(player.sessionId, [player]);
    }
  }

  return sessions.map((session) => ({
    session,
    players: playersBySessionId.get(session.id) ?? [],
  }));
}

export async function joinMultiplayerSession(input: {
  sessionId: string;
  userId: string;
  userName: string;
  inviteCode?: string;
  now?: number;
}): Promise<MultiplayerSessionSnapshot> {
  const now = input.now ?? Date.now();
  const result = await withTransaction(async (client) => {
    const session = await getMultiplayerSessionForUpdateTx(client, input.sessionId);
    if (!session) throw new Error('Table not found.');
    const isSharedTable = session.mode === 'shared-table';
    const acceptsPlayers = isSharedTable
      ? session.status === 'waiting' || session.status === 'active'
      : session.status === 'waiting';
    if (!acceptsPlayers) {
      throw new Error(isSharedTable ? 'This table is not accepting players.' : 'This match is not accepting players.');
    }

    const playerRows = await client.query<MultiplayerSessionPlayerRow>(
      `
        SELECT ${multiplayerSessionPlayerSelect}
        FROM arcade_multiplayer_session_players
        WHERE session_id = $1
        ORDER BY seat_index ASC
        FOR UPDATE
      `,
      [input.sessionId],
    );
    const players = playerRows.rows.map(rowToMultiplayerSessionPlayer);
    const existing = players.find((player) => player.userId === input.userId);
    if (existing && existing.status !== 'left' && existing.leftAt === null) {
      return {
        claimedSeat: false,
        snapshot: await getMultiplayerSessionSnapshotTx(client, input.sessionId),
      };
    }

    await assertGameAvailable(session.gameType);

    const activePlayers = players.filter(
      (player) => player.status !== 'left' && player.leftAt === null,
    );
    if (activePlayers.length >= session.maxPlayers) {
      throw new Error(isSharedTable ? 'This table is already full.' : 'This match is already full.');
    }

    const seatIndex = getNextSeatIndex(activePlayers, session.maxPlayers);
    if (seatIndex === null) {
      throw new Error(isSharedTable ? 'This table has no open seats.' : 'This match has no open seats.');
    }

    if (existing) {
      await client.query(
        `
          UPDATE arcade_multiplayer_session_players
          SET user_name = $1,
              seat_index = $2,
              role = 'player',
              status = 'seated',
              joined_at = $3,
              updated_at = $3,
              left_at = NULL
          WHERE session_id = $4
            AND user_id = $5
        `,
        [input.userName, seatIndex, now, input.sessionId, input.userId],
      );
    } else {
      await client.query(
        `
          INSERT INTO arcade_multiplayer_session_players (
            session_id,
            user_id,
            user_name,
            seat_index,
            role,
            status,
            joined_at,
            updated_at,
            left_at
          ) VALUES ($1, $2, $3, $4, 'player', 'seated', $5, $5, NULL)
        `,
        [input.sessionId, input.userId, input.userName, seatIndex, now],
      );
    }

    const currentPlayerCount = activePlayers.length + 1;
    await client.query(
      `
        UPDATE arcade_multiplayer_sessions
        SET current_player_count = $1,
            updated_at = $2
        WHERE id = $3
      `,
      [currentPlayerCount, now, input.sessionId],
    );

    return {
      claimedSeat: true,
      snapshot: await getMultiplayerSessionSnapshotTx(client, input.sessionId),
    };
  });

  if (result.claimedSeat && input.inviteCode?.trim()) {
    await markGameInviteCodeClaimed({
      code: input.inviteCode,
      gameType: result.snapshot.session.gameType,
      matchId: result.snapshot.session.id,
      targetKind: 'table',
      targetId: result.snapshot.session.id,
      claimedByUserId: input.userId,
    });
  }

  return result.snapshot;
}

export async function leaveMultiplayerSession(input: {
  sessionId: string;
  userId: string;
  now?: number;
}): Promise<MultiplayerSessionSnapshot> {
  const now = input.now ?? Date.now();
  return withTransaction(async (client) => {
    const session = await getMultiplayerSessionForUpdateTx(client, input.sessionId);
    if (!session) throw new Error('Table not found.');

    await client.query(
      `
        UPDATE arcade_multiplayer_session_players
        SET status = 'left',
            updated_at = $1,
            left_at = $1
        WHERE session_id = $2
          AND user_id = $3
          AND status <> 'left'
      `,
      [now, input.sessionId, input.userId],
    );

    const countResult = await client.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM arcade_multiplayer_session_players
        WHERE session_id = $1
          AND status <> 'left'
          AND left_at IS NULL
      `,
      [input.sessionId],
    );
    const currentPlayerCount = Number(countResult.rows[0]?.count ?? 0);

    await client.query(
      `
        UPDATE arcade_multiplayer_sessions
        SET current_player_count = $1,
            updated_at = $2
        WHERE id = $3
      `,
      [currentPlayerCount, now, input.sessionId],
    );

    return getMultiplayerSessionSnapshotTx(client, input.sessionId);
  });
}

export async function setMultiplayerSessionPlayerReady(input: {
  sessionId: string;
  userId: string;
  ready?: boolean;
  now?: number;
}): Promise<MultiplayerSessionSnapshot> {
  const now = input.now ?? Date.now();
  const ready = input.ready ?? true;

  return withTransaction(async (client) => {
    const session = await getMultiplayerSessionForUpdateTx(client, input.sessionId);
    if (!session) throw new Error('Session not found.');
    if (session.status !== 'waiting' && session.status !== 'active') {
      throw new Error('This session is not accepting readiness changes.');
    }
    if (!ready && session.status === 'active') {
      throw new Error('This session has already started.');
    }

    if (ready && session.status === 'waiting') {
      await assertGameAvailable(session.gameType);
    }

    const status: MultiplayerSessionPlayerStatus = ready ? 'ready' : 'seated';
    const updated = await client.query(
      `
        UPDATE arcade_multiplayer_session_players
        SET status = $1,
            updated_at = $2
        WHERE session_id = $3
          AND user_id = $4
          AND status <> 'left'
          AND left_at IS NULL
      `,
      [status, now, input.sessionId, input.userId],
    );
    if ((updated.rowCount ?? 0) === 0) {
      throw new Error('You are not seated in this session.');
    }

    const playerRows = await client.query<MultiplayerSessionPlayerRow>(
      `
        SELECT ${multiplayerSessionPlayerSelect}
        FROM arcade_multiplayer_session_players
        WHERE session_id = $1
          AND status <> 'left'
          AND left_at IS NULL
        ORDER BY seat_index ASC, joined_at ASC
        FOR UPDATE
      `,
      [input.sessionId],
    );
    const players = playerRows.rows.map(rowToMultiplayerSessionPlayer);
    const allReady =
      players.length >= session.minPlayers &&
      players.length <= session.maxPlayers &&
      players.every((player) => player.status === 'ready');

    if (allReady && session.status === 'waiting') {
      await client.query(
        `
          UPDATE arcade_multiplayer_sessions
          SET status = 'active',
              current_player_count = $1,
              updated_at = $2,
              started_at = COALESCE(started_at, $2)
          WHERE id = $3
        `,
        [players.length, now, input.sessionId],
      );
    } else {
      await client.query(
        `
          UPDATE arcade_multiplayer_sessions
          SET current_player_count = $1,
              updated_at = $2
          WHERE id = $3
        `,
        [players.length, now, input.sessionId],
      );
    }

    return getMultiplayerSessionSnapshotTx(client, input.sessionId);
  });
}

export function sortFriendPair(userId: string, targetUserId: string): [string, string] {
  return userId < targetUserId
    ? [userId, targetUserId]
    : [targetUserId, userId];
}

function generateGameCode(length = 6) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += GAME_CODE_ALPHABET[crypto.randomInt(0, GAME_CODE_ALPHABET.length)];
  }
  return code;
}

async function getMultiplayerSessionForUpdateTx(
  client: PoolClient,
  sessionId: string,
): Promise<MultiplayerSession | null> {
  const result = await client.query<MultiplayerSessionRow>(
    `
      SELECT ${multiplayerSessionSelect}
      FROM arcade_multiplayer_sessions
      WHERE id = $1
      LIMIT 1
      FOR UPDATE
    `,
    [sessionId],
  );
  const row = result.rows[0];
  return row ? rowToMultiplayerSession(row) : null;
}

async function getMultiplayerSessionSnapshotTx(
  client: PoolClient,
  sessionId: string,
): Promise<MultiplayerSessionSnapshot> {
  const sessionResult = await client.query<MultiplayerSessionRow>(
    `
      SELECT ${multiplayerSessionSelect}
      FROM arcade_multiplayer_sessions
      WHERE id = $1
      LIMIT 1
    `,
    [sessionId],
  );
  const sessionRow = sessionResult.rows[0];
  if (!sessionRow) throw new Error('Table not found.');

  const playersResult = await client.query<MultiplayerSessionPlayerRow>(
    `
      SELECT ${multiplayerSessionPlayerSelect}
      FROM arcade_multiplayer_session_players
      WHERE session_id = $1
        AND status <> 'left'
      ORDER BY seat_index ASC, joined_at ASC
    `,
    [sessionId],
  );

  return {
    session: rowToMultiplayerSession(sessionRow),
    players: playersResult.rows.map(rowToMultiplayerSessionPlayer),
  };
}

function getNextSeatIndex(
  players: MultiplayerSessionPlayer[],
  maxPlayers: number,
) {
  const occupied = new Set(players.map((player) => player.seatIndex));
  for (let seatIndex = 0; seatIndex < maxPlayers; seatIndex++) {
    if (!occupied.has(seatIndex)) return seatIndex;
  }
  return null;
}

function parseMetadataJson(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return normalizeMetadata(parsed);
  } catch {
    return {};
  }
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeSessionMetadata(
  gameType: MultiplayerGameType,
  value: unknown,
): Record<string, unknown> {
  const metadata = normalizeMetadata(value);
  if (gameType !== 'typing-test') return metadata;

  const modeValue = Number(metadata.modeSec);
  const modeSec = modeValue === 15 || modeValue === 30 || modeValue === 60
    ? modeValue
    : 30;

  return {
    ...metadata,
    modeSec,
    typingSeed: crypto.randomInt(0, 2 ** 31),
  };
}

function clampPositiveInteger(value: number, min: number, max: number) {
  const normalized = Math.trunc(Number.isFinite(value) ? value : min);
  return Math.max(min, Math.min(max, normalized));
}
