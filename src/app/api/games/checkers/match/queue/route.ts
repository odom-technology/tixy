import { checkNewGameAvailability } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';
import type { PoolClient } from 'pg';

import { requireIdentity } from '@/server/auth';
import { query } from '@/server/db/client';
import { broadcast } from '@/server/events';
import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import { createMatch } from '@/server/arcade/checkers-match';
import {
  runQuickMatch,
  type QuickMatchAdapter,
  type QuickMatchUser,
} from '@/server/arcade/match-queue';
import {
  isValidTimeFormatId,
  type CheckersColor,
} from '@/features/arcade/lib/checkers/types';

export const dynamic = 'force-dynamic';

type QueuePayload = {
  timeFormatId?: string;
  preferredColor?: CheckersColor | 'random';
};

/**
 * Resolve the two players' colours when quick-matching. Checkers pre-assigns the
 * CREATOR's committed side via red_id/white_id (see checkers `createMatch`); we
 * honour it, fill the joiner into the opposite side, and only fall back to random
 * when both would-be colours collide or neither expressed a preference — matching
 * the contract's "opposite prefs honored, conflict → random". Red always moves
 * first, so the returned redId is also the opening `current_turn`.
 */
function resolveQuickMatchColors(input: {
  creatorId: string;
  creatorRedId: string | null;
  creatorWhiteId: string | null;
  joinerId: string;
  joinerPref: CheckersColor | 'random';
}): { redId: string; whiteId: string } {
  const { creatorId, creatorRedId, creatorWhiteId, joinerId, joinerPref } = input;
  const creatorWantsRed = creatorRedId === creatorId;
  const creatorWantsWhite = creatorWhiteId === creatorId;

  // Creator committed to red and the joiner isn't also demanding red → honour it.
  if (creatorWantsRed && joinerPref !== 'red') {
    return { redId: creatorId, whiteId: joinerId };
  }
  // Creator committed to white and the joiner isn't also demanding white → honour it.
  if (creatorWantsWhite && joinerPref !== 'white') {
    return { redId: joinerId, whiteId: creatorId };
  }
  // Creator expressed no preference — let the joiner's preference decide.
  if (!creatorWantsRed && !creatorWantsWhite) {
    if (joinerPref === 'red') return { redId: joinerId, whiteId: creatorId };
    if (joinerPref === 'white') return { redId: creatorId, whiteId: joinerId };
  }
  // Conflict or double-random → coin flip.
  return Math.random() < 0.5
    ? { redId: creatorId, whiteId: joinerId }
    : { redId: joinerId, whiteId: creatorId };
}

/** Build the checkers adapter bound to this caller's requested params. */
function checkersQuickMatchAdapter(params: {
  timeFormatId: string;
  preferredColor: CheckersColor | 'random';
}): QuickMatchAdapter {
  return {
    gameType: 'checkers',

    async tryJoinWaiting(client: PoolClient, user: QuickMatchUser) {
      // Lock ONE compatible open row: casual (no wager), not a direct invite,
      // not the caller's own. SKIP LOCKED so parallel PLAY clicks never contend
      // for the same waiting match.
      const candidate = await client.query<{
        id: string;
        player1Id: string;
        redId: string | null;
        whiteId: string | null;
      }>(
        `SELECT id,
                player1_id AS "player1Id",
                red_id AS "redId",
                white_id AS "whiteId"
           FROM checkers_matches
          WHERE status = 'waiting'
            AND invited_user_id IS NULL
            AND (wager_amount IS NULL OR wager_amount = 0)
            AND time_format = $1
            AND player1_id <> $2
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1`,
        [params.timeFormatId, user.userId],
      );
      const row = candidate.rows[0];
      if (!row) return null;

      const { redId, whiteId } = resolveQuickMatchColors({
        creatorId: row.player1Id,
        creatorRedId: row.redId,
        creatorWhiteId: row.whiteId,
        joinerId: user.userId,
        joinerPref: params.preferredColor,
      });

      const now = Date.now();
      // The row is locked; this UPDATE claims it atomically. Red moves first.
      await client.query(
        `UPDATE checkers_matches
            SET player2_id = $1, player2_name = $2, invited_user_id = NULL,
                red_id = $3, white_id = $4, status = 'active',
                current_turn = $5, last_move_at = $6, updated_at = $6
          WHERE id = $7`,
        [user.userId, user.userName, redId, whiteId, redId, now, row.id],
      );
      return row.id;
    },

    async findOwnWaiting(user: QuickMatchUser) {
      const row = await query<{ id: string }>(
        `SELECT id FROM checkers_matches
          WHERE player1_id = $1
            AND status = 'waiting'
            AND invited_user_id IS NULL
            AND (wager_amount IS NULL OR wager_amount = 0)
            AND time_format = $2
          ORDER BY created_at DESC
          LIMIT 1`,
        [user.userId, params.timeFormatId],
      );
      return row.rows[0]?.id ?? null;
    },

    async createWaiting(user: QuickMatchUser) {
      // Reuse checkers createMatch so the lobby broadcast (match_created) + row
      // defaults stay canonical — a plain casual waiting row, no invite code.
      const match = await createMatch(user.userId, user.userName, {
        timeFormatId: params.timeFormatId,
        preferredColor: params.preferredColor,
      });
      return match.id;
    },

    onJoined(matchId: string, user: QuickMatchUser) {
      // Mirror checkers `joinMatch`'s broadcasts so both lobbies + the match
      // page transition without waiting for a poll.
      broadcast('checkersLobby', { type: 'match_joined', matchId });
      broadcast([`checkers:${matchId}`, 'checkersMatch'], {
        matchId,
        type: 'opponent_joined',
        userId: user.userId,
        userName: user.userName,
      });
    },
  };
}

/** POST — quick-match: join a compatible waiting match, else queue a new one. */
export async function POST(request: Request) {
  const unavailable = await checkNewGameAvailability('checkers');
  if (unavailable) return unavailable;

  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  const banResponse = await ensureNotGameBanned(identity.userId);
  if (banResponse) return banResponse;

  let body: QueuePayload = {};
  try {
    body = (await request.json()) as QueuePayload;
  } catch {
    // Body optional — defaults below.
  }

  const timeFormatId = isValidTimeFormatId(body.timeFormatId) ? body.timeFormatId : 'untimed';
  const preferredColor = body.preferredColor ?? 'random';

  try {
    const user: QuickMatchUser = {
      userId: identity.userId,
      userName: identity.name || 'Anonymous',
    };
    const result = await runQuickMatch(
      checkersQuickMatchAdapter({ timeFormatId, preferredColor }),
      user,
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to quick-match checkers:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to find a match.' },
      { status: 500 },
    );
  }
}
