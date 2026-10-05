import { checkNewGameAvailability } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';
import type { PoolClient } from 'pg';

import { requireIdentity } from '@/server/auth';
import { query } from '@/server/db/client';
import { broadcast } from '@/server/events';
import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import { createMatch } from '@/server/arcade/chess-match';
import {
  runQuickMatch,
  type QuickMatchAdapter,
  type QuickMatchUser,
} from '@/server/arcade/match-queue';
import {
  isValidTimeFormatId,
  type ChessColor,
} from '@/features/arcade/lib/chess/types';

export const dynamic = 'force-dynamic';

type QueuePayload = {
  timeFormatId?: string;
  preferredColor?: ChessColor | 'random';
};

/**
 * Resolve the two players' colors when quick-matching. The waiting row already
 * encodes the CREATOR's preference via a pre-assigned white_id/black_id (see
 * chess `createMatch`). We honor the creator's committed side, fill the joiner
 * into the opposite side, and when both would-be colors collide (or neither
 * side expressed a preference) fall back to random — matching the contract's
 * "opposite prefs honored, conflict → random".
 */
function resolveQuickMatchColors(input: {
  creatorId: string;
  creatorWhiteId: string | null;
  creatorBlackId: string | null;
  joinerId: string;
  joinerPref: ChessColor | 'random';
}): { whiteId: string; blackId: string } {
  const { creatorId, creatorWhiteId, creatorBlackId, joinerId, joinerPref } = input;
  const creatorWantsWhite = creatorWhiteId === creatorId;
  const creatorWantsBlack = creatorBlackId === creatorId;

  // Creator committed to white and joiner isn't also demanding white → honor it.
  if (creatorWantsWhite && joinerPref !== 'white') {
    return { whiteId: creatorId, blackId: joinerId };
  }
  // Creator committed to black and joiner isn't also demanding black → honor it.
  if (creatorWantsBlack && joinerPref !== 'black') {
    return { whiteId: joinerId, blackId: creatorId };
  }
  // Creator expressed no preference — let the joiner's preference decide.
  if (!creatorWantsWhite && !creatorWantsBlack) {
    if (joinerPref === 'white') return { whiteId: joinerId, blackId: creatorId };
    if (joinerPref === 'black') return { whiteId: creatorId, blackId: joinerId };
  }
  // Conflict or double-random → coin flip.
  return Math.random() < 0.5
    ? { whiteId: creatorId, blackId: joinerId }
    : { whiteId: joinerId, blackId: creatorId };
}

/** Build the chess adapter bound to this caller's requested params. */
function chessQuickMatchAdapter(params: {
  timeFormatId: string;
  preferredColor: ChessColor | 'random';
}): QuickMatchAdapter {
  return {
    gameType: 'chess',

    async tryJoinWaiting(client: PoolClient, user: QuickMatchUser) {
      // Lock ONE compatible open row: same time format, casual (no wager),
      // not a direct invite, not the caller's own. SKIP LOCKED so parallel
      // PLAY clicks never contend for the same waiting match.
      const candidate = await client.query<{
        id: string;
        player1Id: string;
        whiteId: string | null;
        blackId: string | null;
      }>(
        `SELECT id,
                player1_id AS "player1Id",
                white_id AS "whiteId",
                black_id AS "blackId"
           FROM chess_matches
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

      const { whiteId, blackId } = resolveQuickMatchColors({
        creatorId: row.player1Id,
        creatorWhiteId: row.whiteId,
        creatorBlackId: row.blackId,
        joinerId: user.userId,
        joinerPref: params.preferredColor,
      });

      const now = Date.now();
      // The row is locked; this UPDATE claims it atomically. White moves first.
      await client.query(
        `UPDATE chess_matches
            SET player2_id = $1, player2_name = $2, invited_user_id = NULL,
                white_id = $3, black_id = $4, status = 'active',
                current_turn = $5, last_move_at = $6, updated_at = $6
          WHERE id = $7`,
        [user.userId, user.userName, whiteId, blackId, whiteId, now, row.id],
      );
      return row.id;
    },

    async findOwnWaiting(user: QuickMatchUser) {
      const row = await query<{ id: string }>(
        `SELECT id FROM chess_matches
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
      // Reuse chess createMatch so lobby broadcast + row defaults stay canonical.
      const match = await createMatch(user.userId, user.userName, {
        timeFormatId: params.timeFormatId,
        preferredColor: params.preferredColor,
      });
      return match.id;
    },

    onJoined(matchId: string, user: QuickMatchUser) {
      // Mirror chess `joinMatch`'s broadcasts so both lobbies + the match page
      // transition without waiting for a poll.
      broadcast('chessLobby', { type: 'match_joined', matchId });
      broadcast([`chess:${matchId}`, 'chessMatch'], {
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
  const unavailable = await checkNewGameAvailability('chess');
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

  const timeFormatId = isValidTimeFormatId(body.timeFormatId) ? body.timeFormatId : 'blitz';
  const preferredColor = body.preferredColor ?? 'random';

  try {
    const user: QuickMatchUser = {
      userId: identity.userId,
      userName: identity.name || 'Anonymous',
    };
    const result = await runQuickMatch(
      chessQuickMatchAdapter({ timeFormatId, preferredColor }),
      user,
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to quick-match chess:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to find a match.' },
      { status: 500 },
    );
  }
}
