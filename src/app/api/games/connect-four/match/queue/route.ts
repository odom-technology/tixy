import { checkNewGameAvailability } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';
import type { PoolClient } from 'pg';

import { requireIdentity } from '@/server/auth';
import { query } from '@/server/db/client';
import { broadcast } from '@/server/events';
import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import { createMatch } from '@/server/arcade/connect-four-match';
import {
  runQuickMatch,
  type QuickMatchAdapter,
  type QuickMatchUser,
} from '@/server/arcade/match-queue';
import type { Color } from '@/features/arcade/lib/connect-four/types';

export const dynamic = 'force-dynamic';

type QueuePayload = {
  preferredColor?: Color | 'random';
};

/**
 * Resolve red/yellow when quick-matching. Connect Four is UNTIMED and has no
 * other compatibility params, so pairing only reconciles disc colors. The
 * waiting row already encodes the CREATOR's committed side via a pre-assigned
 * red_id/yellow_id (see connect-four `createMatch`). We honor the creator's
 * committed side, fill the joiner into the opposite side, and when both would
 * demand the same color (or neither expressed a preference) fall back to
 * random — matching the contract's "opposite prefs honored, conflict → random".
 * Red always drops first.
 */
function resolveQuickMatchColors(input: {
  creatorId: string;
  creatorRedId: string | null;
  creatorYellowId: string | null;
  joinerId: string;
  joinerPref: Color | 'random';
}): { redId: string; yellowId: string } {
  const { creatorId, creatorRedId, creatorYellowId, joinerId, joinerPref } = input;
  const creatorWantsRed = creatorRedId === creatorId;
  const creatorWantsYellow = creatorYellowId === creatorId;

  // Creator committed to red and joiner isn't also demanding red → honor it.
  if (creatorWantsRed && joinerPref !== 'red') {
    return { redId: creatorId, yellowId: joinerId };
  }
  // Creator committed to yellow and joiner isn't also demanding yellow → honor it.
  if (creatorWantsYellow && joinerPref !== 'yellow') {
    return { redId: joinerId, yellowId: creatorId };
  }
  // Creator expressed no preference — let the joiner's preference decide.
  if (!creatorWantsRed && !creatorWantsYellow) {
    if (joinerPref === 'red') return { redId: joinerId, yellowId: creatorId };
    if (joinerPref === 'yellow') return { redId: creatorId, yellowId: joinerId };
  }
  // Conflict or double-random → coin flip.
  return Math.random() < 0.5
    ? { redId: creatorId, yellowId: joinerId }
    : { redId: joinerId, yellowId: creatorId };
}

/** Build the connect-four adapter bound to this caller's requested color. */
function connectFourQuickMatchAdapter(params: {
  preferredColor: Color | 'random';
}): QuickMatchAdapter {
  return {
    gameType: 'connect-four',

    async tryJoinWaiting(client: PoolClient, user: QuickMatchUser) {
      // Lock ONE compatible open row: casual (no wager), not a direct invite,
      // not the caller's own. SKIP LOCKED so parallel PLAY clicks never contend
      // for the same waiting match. Board state has no compatibility axis
      // (untimed, no variants) so the only filters are open + casual + not-mine.
      // red disc <-> white_id, yellow disc <-> black_id (see connect-four schema).
      const candidate = await client.query<{
        id: string;
        player1Id: string;
        redId: string | null;
        yellowId: string | null;
      }>(
        `SELECT id,
                player1_id AS "player1Id",
                white_id AS "redId",
                black_id AS "yellowId"
           FROM connect_four_matches
          WHERE status = 'waiting'
            AND invited_user_id IS NULL
            AND (wager_amount IS NULL OR wager_amount = 0)
            AND player1_id <> $1
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1`,
        [user.userId],
      );
      const row = candidate.rows[0];
      if (!row) return null;

      const { redId, yellowId } = resolveQuickMatchColors({
        creatorId: row.player1Id,
        creatorRedId: row.redId,
        creatorYellowId: row.yellowId,
        joinerId: user.userId,
        joinerPref: params.preferredColor,
      });

      const now = Date.now();
      // The row is locked; this UPDATE claims it atomically. Red moves first.
      await client.query(
        `UPDATE connect_four_matches
            SET player2_id = $1, player2_name = $2, invited_user_id = NULL,
                white_id = $3, black_id = $4, status = 'active',
                current_turn = $5, updated_at = $6
          WHERE id = $7`,
        [user.userId, user.userName, redId, yellowId, redId, now, row.id],
      );
      return row.id;
    },

    async findOwnWaiting(user: QuickMatchUser) {
      const row = await query<{ id: string }>(
        `SELECT id FROM connect_four_matches
          WHERE player1_id = $1
            AND status = 'waiting'
            AND invited_user_id IS NULL
            AND (wager_amount IS NULL OR wager_amount = 0)
          ORDER BY created_at DESC
          LIMIT 1`,
        [user.userId],
      );
      return row.rows[0]?.id ?? null;
    },

    async createWaiting(user: QuickMatchUser) {
      // Reuse connect-four createMatch so the lobby broadcast + row defaults
      // stay canonical (do NOT inline the INSERT).
      const match = await createMatch(user.userId, user.userName, {
        preferredColor: params.preferredColor,
      });
      return match.id;
    },

    onJoined(matchId: string, user: QuickMatchUser) {
      // Mirror connect-four `joinMatch`'s broadcasts so both lobbies + the match
      // page transition without waiting for a poll.
      broadcast('connectFourLobby', { type: 'match_joined', matchId });
      broadcast([`connect-four:${matchId}`, 'connectFourMatch'], {
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
  const unavailable = await checkNewGameAvailability('connect-four');
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

  const preferredColor: Color | 'random' =
    body.preferredColor === 'red' || body.preferredColor === 'yellow'
      ? body.preferredColor
      : 'random';

  try {
    const user: QuickMatchUser = {
      userId: identity.userId,
      userName: identity.name || 'Anonymous',
    };
    const result = await runQuickMatch(
      connectFourQuickMatchAdapter({ preferredColor }),
      user,
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to quick-match connect-four:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to find a match.' },
      { status: 500 },
    );
  }
}
