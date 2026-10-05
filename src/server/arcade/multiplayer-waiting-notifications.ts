import {
  getMatchJoinHref,
  getMultiplayerGameConfig,
  type MultiplayerGameType,
} from '@/server/arcade/multiplayer';
import { query, queryOne } from '@/server/db/client';
import { getFriendsPresence } from '@/server/realtime/presence';
import {
  createBulkNotifications,
  createNotification,
  markNotificationsReadByDedupePrefix,
  type NotificationInput,
} from '@/server/services/notifications';

export type WaitingNotificationGameType = Exclude<MultiplayerGameType, 'blackjack' | 'derby'>;
type MatchTableGameType = Exclude<WaitingNotificationGameType, 'typing-test'>;

const WAIT_PREFIX = 'multiplayer-wait';
const FOUND_PREFIX = 'multiplayer-found';

const MATCH_TABLES: Record<MatchTableGameType, string> = {
  '8-ball': 'pool_matches',
  chess: 'chess_matches',
  'connect-four': 'connect_four_matches',
  checkers: 'checkers_matches',
  reversi: 'reversi_matches',
  battleship: 'battleship_matches',
};

function safePlayerName(value: string) {
  const name = value.trim();
  return name && !name.includes('@') ? name.slice(0, 60) : 'A friend';
}

export function multiplayerWaitDedupePrefix(input: {
  gameType: WaitingNotificationGameType;
  matchId: string;
}) {
  return `${WAIT_PREFIX}:${input.gameType}:${input.matchId}:`;
}

export function buildFriendWaitingNotification(input: {
  recipientUserId: string;
  ownerName: string;
  gameType: WaitingNotificationGameType;
  matchId: string;
}): NotificationInput {
  const config = getMultiplayerGameConfig(input.gameType);
  const ownerName = safePlayerName(input.ownerName);
  return {
    userId: input.recipientUserId,
    type: 'friend_waiting_for_match',
    title: `${ownerName} wants to play`,
    body: `${ownerName} is waiting in ${config.label}. Join the lobby while the table is open.`,
    // Deliberately link to the public lobby, not a match/session identifier.
    // The canonical queue will re-check that a compatible seat is still open.
    href: config.lobbyPath,
    preferenceKey: 'game_notifications',
    dedupeKey: `${multiplayerWaitDedupePrefix(input)}${input.recipientUserId}`,
  };
}

export function buildMatchFoundNotification(input: {
  ownerUserId: string;
  opponentName: string;
  gameType: WaitingNotificationGameType;
  matchId: string;
}): NotificationInput {
  const config = getMultiplayerGameConfig(input.gameType);
  const opponentName = safePlayerName(input.opponentName);
  return {
    userId: input.ownerUserId,
    type: 'multiplayer_match_found',
    title: 'Match found',
    body: `${opponentName} joined your ${config.label} lobby. Your match is ready.`,
    // Only the participating owner receives this authorized match deep link.
    href: getMatchJoinHref(input.gameType, input.matchId),
    preferenceKey: 'game_notifications',
    dedupeKey: `${FOUND_PREFIX}:${input.gameType}:${input.matchId}:${input.ownerUserId}`,
  };
}

/**
 * Tell only accepted friends who are genuinely online that a new public queue
 * exists. Fail-soft: matchmaking must never depend on notification delivery.
 */
export async function announceWaitingQueueToOnlineFriends(input: {
  ownerUserId: string;
  ownerName: string;
  gameType: WaitingNotificationGameType;
  matchId: string;
}): Promise<void> {
  try {
    const presence = await getFriendsPresence(input.ownerUserId);
    const onlineFriendIds = presence
      .filter((friend) => friend.status === 'online' || friend.status === 'in_game')
      .map((friend) => friend.userId);
    if (onlineFriendIds.length === 0) return;
    await createBulkNotifications(
      onlineFriendIds.map((recipientUserId) =>
        buildFriendWaitingNotification({ ...input, recipientUserId }),
      ),
    );
  } catch (error) {
    console.error('Failed to announce multiplayer waiting queue:', error);
  }
}

/** Resolve stale friend alerts and notify the waiting owner after a real join. */
export async function announceMultiplayerMatchFound(input: {
  ownerUserId: string;
  opponentName: string;
  gameType: WaitingNotificationGameType;
  matchId: string;
}): Promise<void> {
  try {
    await Promise.all([
      markNotificationsReadByDedupePrefix({
        dedupePrefix: multiplayerWaitDedupePrefix(input),
      }),
      createNotification(buildMatchFoundNotification(input)),
    ]);
  } catch (error) {
    console.error('Failed to announce multiplayer match:', error);
  }
}

/** Match-table convenience used by both quick-match and explicit lobby joins. */
export async function announceMatchTableOpponentJoined(input: {
  gameType: MatchTableGameType;
  matchId: string;
  opponentName: string;
}): Promise<void> {
  try {
    // Table names come exclusively from the fixed map above, never user input.
    const row = await queryOne<{ ownerUserId: string }>(
      `SELECT player1_id AS "ownerUserId" FROM ${MATCH_TABLES[input.gameType]} WHERE id = $1`,
      [input.matchId],
    );
    if (!row) return;
    await announceMultiplayerMatchFound({ ...input, ownerUserId: row.ownerUserId });
  } catch (error) {
    console.error('Failed to resolve multiplayer match owner:', error);
  }
}

/** Resolve friend alerts when a queue is canceled or otherwise retired. */
export async function resolveMultiplayerWaitingNotifications(input: {
  gameType: WaitingNotificationGameType;
  matchId: string;
}): Promise<void> {
  try {
    await markNotificationsReadByDedupePrefix({
      dedupePrefix: multiplayerWaitDedupePrefix(input),
    });
  } catch (error) {
    console.error('Failed to resolve multiplayer waiting notifications:', error);
  }
}

/** Resolve every public queue alert owned by a player who has gone offline. */
export async function resolveWaitingNotificationsForOfflineOwner(ownerUserId: string) {
  try {
    const result = await query<{ gameType: WaitingNotificationGameType; matchId: string }>(
      `SELECT '8-ball'::text AS "gameType", id AS "matchId"
         FROM pool_matches WHERE player1_id = $1 AND status = 'waiting' AND invited_user_id IS NULL
       UNION ALL
       SELECT 'chess', id FROM chess_matches
        WHERE player1_id = $1 AND status = 'waiting' AND invited_user_id IS NULL
       UNION ALL
       SELECT 'connect-four', id FROM connect_four_matches
        WHERE player1_id = $1 AND status = 'waiting' AND invited_user_id IS NULL
       UNION ALL
       SELECT 'checkers', id FROM checkers_matches
        WHERE player1_id = $1 AND status = 'waiting' AND invited_user_id IS NULL
       UNION ALL
       SELECT 'reversi', id FROM reversi_matches
        WHERE player1_id = $1 AND status = 'waiting' AND invited_user_id IS NULL
       UNION ALL
       SELECT 'battleship', id FROM battleship_matches
        WHERE player1_id = $1 AND status = 'waiting' AND invited_user_id IS NULL
       UNION ALL
       SELECT game_type, id FROM arcade_multiplayer_sessions
        WHERE owner_user_id = $1 AND status = 'waiting' AND visibility = 'public'
          AND game_type <> 'blackjack'`,
      [ownerUserId],
    );
    await Promise.all(
      result.rows.map(({ gameType, matchId }) =>
        resolveMultiplayerWaitingNotifications({ gameType, matchId }),
      ),
    );
  } catch (error) {
    console.error('Failed to resolve offline player waiting notifications:', error);
  }
}
