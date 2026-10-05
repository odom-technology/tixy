import { assertGameAvailable } from '@/server/arcade/game-availability';
// ---------------------------------------------------------------------------
// Quick-join ("PLAY") backend for session-backed versus games (typing-duel).
//
// The unified lobby's PLAY action is a transactional join-else-create. The
// match-table games use `runQuickMatch` (src/server/arcade/match-queue.ts) over
// their per-game `<game>_matches` table. typing-duel has no match table — it
// lives on the generic `arcade_multiplayer_sessions` tables — so it needs the
// same control flow expressed over those tables instead. This module is that
// sibling: a join-first-open-public-session-else-create routine that mirrors
// `runQuickMatch`'s SKIP LOCKED spirit.
//
//   1. Atomically claim ONE compatible open PUBLIC session (another player's
//      `waiting` session, matching `modeSec`, a free seat, not our own) using
//      FOR UPDATE SKIP LOCKED so parallel PLAY clicks never grab the same
//      session → `matched`.
//   2. Else, if we already own an equivalent waiting session → return it
//      (`queued`, no duplicate row).
//   3. Else open a fresh public waiting session and wait → `queued`.
//
// Pairing only seats both players in the same `waiting` session; the existing
// ready-up flow (all-ready → active, in `setMultiplayerSessionPlayerReady`)
// stays exactly as-is. This module imports from `multiplayer.ts` and never
// mutates it — the create path reuses the canonical `createMultiplayerSession`
// so metadata normalization (mode + typing seed) stays in one place.
// ---------------------------------------------------------------------------

import { query, withTransaction } from '@/server/db/client';
import {
  createMultiplayerSession,
} from '@/server/arcade/multiplayer';
import { serializePerKey } from '@/server/arcade/match-queue';
import {
  announceMultiplayerMatchFound,
  announceWaitingQueueToOnlineFriends,
  resolveMultiplayerWaitingNotifications,
  type WaitingNotificationGameType,
} from '@/server/arcade/multiplayer-waiting-notifications';

export type SessionQuickJoinUser = {
  userId: string;
  userName: string;
};

export type SessionQuickJoinResult = {
  status: 'matched' | 'queued';
  sessionId: string;
};

type CandidateRow = {
  id: string;
  ownerUserId: string;
  maxPlayers: string | number;
  currentPlayerCount: string | number;
};

type SeatRow = {
  userId: string;
  seatIndex: string | number;
  status: string;
  leftAt: string | number | null;
};

/**
 * Transactional join-else-create for a session-backed versus game.
 *
 * Only sessions with a compatible `modeSec` (and `public` visibility, `waiting`
 * status, a free seat, owned by someone else) are joinable — never the caller's
 * own row. Returns `matched` when we seat into someone else's session, else
 * `queued` (existing-own or freshly-created waiting session).
 */
export async function quickJoinSession(input: {
  gameType: WaitingNotificationGameType;
  modeSec: number;
  user: SessionQuickJoinUser;
  now?: number;
}): Promise<SessionQuickJoinResult> {
  await assertGameAvailable(input.gameType);
  const { gameType, modeSec, user } = input;
  const now = input.now ?? Date.now();
  const modeKey = String(modeSec);

  // The whole own-check → join → create flow is serialized per (gameType, user)
  // — the same in-process gate `runQuickMatch` uses for the match-table games —
  // so two concurrent quick-join POSTs from the SAME user can never both open a
  // public waiting session (`findOwn` / `createMultiplayerSession` are separate
  // pooled steps, not one atomic DB op). Own-check runs FIRST so a double-fire
  // returns the caller's existing row rather than claiming a third player's
  // session and orphaning its own. The gate is per-user, so cross-user pairing
  // and other users never contend.
  const outcome = await serializePerKey(`${gameType}:${user.userId}`, async () => {
    // 1) Already queued in a compatible session of our own? Reuse it (no dupes).
    const own = await query<{ id: string }>(
      `SELECT id
         FROM arcade_multiplayer_sessions
        WHERE owner_user_id = $1
          AND game_type = $2
          AND status = 'waiting'
          AND visibility = 'public'
          AND (metadata_json::jsonb ->> 'modeSec') = $3
        ORDER BY created_at DESC
        LIMIT 1`,
      [user.userId, gameType, modeKey],
    );
    if (own.rows[0]) {
      return { status: 'queued', sessionId: own.rows[0].id, created: false } as const;
    }

    // 2) Join a compatible open session (another player's), atomically (SKIP LOCKED).
    const joinedId = await withTransaction(async (client) => {
      const candidate = await client.query<CandidateRow>(
        `SELECT id,
                owner_user_id AS "ownerUserId",
                max_players AS "maxPlayers",
                current_player_count AS "currentPlayerCount"
           FROM arcade_multiplayer_sessions
          WHERE game_type = $1
            AND status = 'waiting'
            AND visibility = 'public'
            AND owner_user_id <> $2
            AND current_player_count < max_players
            AND (metadata_json::jsonb ->> 'modeSec') = $3
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1`,
        [gameType, user.userId, modeKey],
      );
      const row = candidate.rows[0];
      if (!row) return null;

      // Lock the seat rows so seat assignment can't race a concurrent joiner.
      const seatResult = await client.query<SeatRow>(
        `SELECT user_id AS "userId",
                seat_index AS "seatIndex",
                status,
                left_at AS "leftAt"
           FROM arcade_multiplayer_session_players
          WHERE session_id = $1
          FOR UPDATE`,
        [row.id],
      );
      const seats = seatResult.rows;
      const active = seats.filter((seat) => seat.status !== 'left' && seat.leftAt === null);
      if (active.length >= Number(row.maxPlayers)) return null;

      const occupied = new Set(active.map((seat) => Number(seat.seatIndex)));
      let seatIndex = 0;
      while (occupied.has(seatIndex)) seatIndex += 1;

      const existing = seats.find((seat) => seat.userId === user.userId);
      if (existing) {
        await client.query(
          `UPDATE arcade_multiplayer_session_players
              SET user_name = $1, seat_index = $2, role = 'player',
                  status = 'seated', joined_at = $3, updated_at = $3, left_at = NULL
            WHERE session_id = $4 AND user_id = $5`,
          [user.userName, seatIndex, now, row.id, user.userId],
        );
      } else {
        await client.query(
          `INSERT INTO arcade_multiplayer_session_players (
             session_id, user_id, user_name, seat_index, role, status,
             joined_at, updated_at, left_at
           ) VALUES ($1, $2, $3, $4, 'player', 'seated', $5, $5, NULL)`,
          [row.id, user.userId, user.userName, seatIndex, now],
        );
      }

      await client.query(
        `UPDATE arcade_multiplayer_sessions
            SET current_player_count = $1, updated_at = $2
          WHERE id = $3`,
        [active.length + 1, now, row.id],
      );
      return { sessionId: row.id, ownerUserId: row.ownerUserId };
    });

    if (joinedId) {
      return {
        status: 'matched',
        sessionId: joinedId.sessionId,
        ownerUserId: joinedId.ownerUserId,
        created: false,
      } as const;
    }

    // 3) Nobody to pair with — open a fresh public waiting session and wait.
    const snapshot = await createMultiplayerSession({
      gameType,
      ownerUserId: user.userId,
      ownerUserName: user.userName,
      visibility: 'public',
      metadata: { modeSec },
      now,
    });
    return { status: 'queued', sessionId: snapshot.session.id, created: true } as const;
  });

  // Release both the join transaction and per-user gate before notification I/O.
  if (outcome.status === 'matched') {
    await announceMultiplayerMatchFound({
      ownerUserId: outcome.ownerUserId,
      opponentName: user.userName,
      gameType,
      matchId: outcome.sessionId,
    });
  } else if (outcome.created) {
    await announceWaitingQueueToOnlineFriends({
      ownerUserId: user.userId,
      ownerName: user.userName,
      gameType,
      matchId: outcome.sessionId,
    });
  }

  return { status: outcome.status, sessionId: outcome.sessionId };
}

/**
 * Cancel a still-waiting quick-join session the caller owns. Cleanly retires
 * the row (status → `cancelled`, seats released) so cancelled queues don't
 * linger as empty "open" sessions. Throws when an opponent has already joined
 * (or the run started) so the lobby can fall through and open the live match
 * instead — matching the shared lobby's cancel-race recovery.
 */
export async function cancelOwnWaitingSession(input: {
  sessionId: string;
  userId: string;
  now?: number;
}): Promise<{ cancelled: true }> {
  const now = input.now ?? Date.now();
  const result = await withTransaction(async (client) => {
    const result = await client.query<{
      ownerUserId: string;
      status: string;
      currentPlayerCount: string | number;
    }>(
      `SELECT owner_user_id AS "ownerUserId",
              status,
              current_player_count AS "currentPlayerCount"
         FROM arcade_multiplayer_sessions
        WHERE id = $1
        FOR UPDATE`,
      [input.sessionId],
    );
    const session = result.rows[0];
    if (!session) throw new Error('Session not found.');
    if (session.ownerUserId !== input.userId) {
      throw new Error('Only the owner can cancel this session.');
    }
    if (session.status !== 'waiting' || Number(session.currentPlayerCount) > 1) {
      throw new Error('This duel already has an opponent.');
    }

    await client.query(
      `UPDATE arcade_multiplayer_session_players
          SET status = 'left', updated_at = $1, left_at = $1
        WHERE session_id = $2 AND status <> 'left'`,
      [now, input.sessionId],
    );
    await client.query(
      `UPDATE arcade_multiplayer_sessions
          SET status = 'cancelled', current_player_count = 0, updated_at = $1,
              completed_at = COALESCE(completed_at, $1)
        WHERE id = $2`,
      [now, input.sessionId],
    );
    return { cancelled: true as const };
  });
  await resolveMultiplayerWaitingNotifications({
    gameType: 'typing-test',
    matchId: input.sessionId,
  });
  return result;
}
