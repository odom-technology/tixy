import { checkNewGameAvailability } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';
import type { PoolClient } from 'pg';

import { requireIdentity } from '@/server/auth';
import { query } from '@/server/db/client';
import { broadcast } from '@/server/events';
import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import { createMatch } from '@/server/arcade/reversi-match';
import {
  runQuickMatch,
  type QuickMatchAdapter,
  type QuickMatchUser,
} from '@/server/arcade/match-queue';
import type { Color } from '@/features/arcade/lib/reversi/types';

export const dynamic = 'force-dynamic';

type QueuePayload = {
  preferredColor?: Color | 'random';
};

/**
 * Resolve the two players' disc colors when quick-matching. The waiting row
 * already encodes the CREATOR's preference via a pre-assigned black_id/white_id
 * (see reversi `createMatch`). We honor the creator's committed side, fill the
 * joiner into the opposite side, and when both would-be colors collide (or
 * neither side expressed a preference) fall back to random — matching the
 * contract's "opposite prefs honored, conflict → random". Mirrors the chess
 * pilot's `resolveQuickMatchColors`, swapping white↔black semantics (Reversi's
 * black moves first).
 */
function resolveQuickMatchColors(input: {
  creatorId: string;
  creatorBlackId: string | null;
  creatorWhiteId: string | null;
  joinerId: string;
  joinerPref: Color | 'random';
}): { blackId: string; whiteId: string } {
  const { creatorId, creatorBlackId, creatorWhiteId, joinerId, joinerPref } = input;
  const creatorWantsBlack = creatorBlackId === creatorId;
  const creatorWantsWhite = creatorWhiteId === creatorId;

  // Creator committed to black and joiner isn't also demanding black → honor it.
  if (creatorWantsBlack && joinerPref !== 'black') {
    return { blackId: creatorId, whiteId: joinerId };
  }
  // Creator committed to white and joiner isn't also demanding white → honor it.
  if (creatorWantsWhite && joinerPref !== 'white') {
    return { blackId: joinerId, whiteId: creatorId };
  }
  // Creator expressed no preference — let the joiner's preference decide.
  if (!creatorWantsBlack && !creatorWantsWhite) {
    if (joinerPref === 'black') return { blackId: joinerId, whiteId: creatorId };
    if (joinerPref === 'white') return { blackId: creatorId, whiteId: joinerId };
  }
  // Conflict or double-random → coin flip.
  return Math.random() < 0.5
    ? { blackId: creatorId, whiteId: joinerId }
    : { blackId: joinerId, whiteId: creatorId };
}

/** Build the reversi adapter bound to this caller's requested color pref. */
function reversiQuickMatchAdapter(params: {
  preferredColor: Color | 'random';
}): QuickMatchAdapter {
  return {
    gameType: 'reversi',

    async tryJoinWaiting(client: PoolClient, user: QuickMatchUser) {
      // Lock ONE compatible open row: casual (no wager), not a direct invite,
      // not the caller's own. Reversi is untimed so there are no format params
      // to match on. SKIP LOCKED so parallel PLAY clicks never contend for the
      // same waiting match.
      const candidate = await client.query<{
        id: string;
        player1Id: string;
        blackId: string | null;
        whiteId: string | null;
      }>(
        `SELECT id,
                player1_id AS "player1Id",
                black_id AS "blackId",
                white_id AS "whiteId"
           FROM reversi_matches
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

      const { blackId, whiteId } = resolveQuickMatchColors({
        creatorId: row.player1Id,
        creatorBlackId: row.blackId,
        creatorWhiteId: row.whiteId,
        joinerId: user.userId,
        joinerPref: params.preferredColor,
      });

      const now = Date.now();
      // The row is locked; this UPDATE claims it atomically. Black moves first.
      await client.query(
        `UPDATE reversi_matches
            SET player2_id = $1, player2_name = $2, invited_user_id = NULL,
                black_id = $3, white_id = $4, status = 'active',
                current_turn = $5, updated_at = $6
          WHERE id = $7`,
        [user.userId, user.userName, blackId, whiteId, blackId, now, row.id],
      );
      return row.id;
    },

    async findOwnWaiting(user: QuickMatchUser) {
      const row = await query<{ id: string }>(
        `SELECT id FROM reversi_matches
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
      // Reuse reversi createMatch so lobby broadcast + row defaults stay canonical.
      const match = await createMatch(user.userId, user.userName, {
        preferredColor: params.preferredColor,
      });
      return match.id;
    },

    onJoined(matchId: string, user: QuickMatchUser) {
      // Mirror reversi `joinMatch`'s broadcasts so both lobbies + the match page
      // transition without waiting for a poll.
      broadcast('reversiLobby', { type: 'match_joined', matchId });
      broadcast([`reversi:${matchId}`, 'reversiMatch'], {
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
  const unavailable = await checkNewGameAvailability('reversi');
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
    body.preferredColor === 'black' || body.preferredColor === 'white'
      ? body.preferredColor
      : 'random';

  try {
    const userName =
      identity.name && identity.name !== identity.email ? identity.name : 'Player';
    const user: QuickMatchUser = { userId: identity.userId, userName };
    const result = await runQuickMatch(
      reversiQuickMatchAdapter({ preferredColor }),
      user,
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to quick-match reversi:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to find a match.' },
      { status: 500 },
    );
  }
}
