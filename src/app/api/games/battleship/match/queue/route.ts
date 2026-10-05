import { checkNewGameAvailability } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';
import type { PoolClient } from 'pg';

import { requireIdentity } from '@/server/auth';
import { query } from '@/server/db/client';
import { broadcast } from '@/server/events';
import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import { createMatch } from '@/server/arcade/battleship-match';
import {
  runQuickMatch,
  type QuickMatchAdapter,
  type QuickMatchUser,
} from '@/server/arcade/match-queue';

export const dynamic = 'force-dynamic';

/**
 * Battleship quick-match adapter. Battleship is UNTIMED with no per-match
 * options (no time format, no color), so any two casual open rows are
 * compatible — the predicate is simply "another player's waiting, un-invited,
 * non-wager match". Wagered/invited rows are excluded so quick-match never
 * silently joins a stakes game or someone else's private invite.
 */
function battleshipQuickMatchAdapter(): QuickMatchAdapter {
  return {
    gameType: 'battleship',

    async tryJoinWaiting(client: PoolClient, user: QuickMatchUser) {
      // Lock ONE compatible open row: casual (no wager), not a direct invite,
      // not the caller's own. SKIP LOCKED so parallel PLAY clicks never contend
      // for the same waiting match.
      const candidate = await client.query<{ id: string }>(
        `SELECT id
           FROM battleship_matches
          WHERE status = 'waiting'
            AND invited_user_id IS NULL
            AND (wager_amount IS NULL OR wager_amount = 0)
            AND player2_id IS NULL
            AND player1_id <> $1
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1`,
        [user.userId],
      );
      const row = candidate.rows[0];
      if (!row) return null;

      const now = Date.now();
      // The row is locked; this UPDATE claims it atomically and mirrors the
      // canonical `joinMatch` transition (waiting → active/placement).
      await client.query(
        `UPDATE battleship_matches
            SET player2_id = $1, player2_name = $2, invited_user_id = NULL,
                status = 'active', phase = 'placement', current_turn = NULL,
                updated_at = $3
          WHERE id = $4`,
        [user.userId, user.userName, now, row.id],
      );
      return row.id;
    },

    async findOwnWaiting(user: QuickMatchUser) {
      const row = await query<{ id: string }>(
        `SELECT id FROM battleship_matches
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
      // Reuse battleship createMatch so the lobby broadcast + row defaults stay
      // canonical (do NOT inline the INSERT).
      const match = await createMatch(user.userId, user.userName);
      return match.id;
    },

    onJoined(matchId: string, user: QuickMatchUser) {
      // Mirror battleship `joinMatch`'s broadcasts so both lobbies + the match
      // page transition without waiting for a poll.
      broadcast('battleshipLobby', { type: 'match_joined', matchId });
      broadcast([`battleship:${matchId}`, 'battleshipMatch'], {
        matchId,
        type: 'opponent_joined',
        userId: user.userId,
        userName: user.userName,
      });
    },
  };
}

/** POST — quick-match: join a compatible waiting match, else queue a new one. */
export async function POST() {
  const unavailable = await checkNewGameAvailability('battleship');
  if (unavailable) return unavailable;

  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  const banResponse = await ensureNotGameBanned(identity.userId);
  if (banResponse) return banResponse;

  try {
    const userName =
      identity.name && identity.name !== identity.email ? identity.name : 'Player';
    const user: QuickMatchUser = { userId: identity.userId, userName };
    const result = await runQuickMatch(battleshipQuickMatchAdapter(), user);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to quick-match battleship:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to find a match.' },
      { status: 500 },
    );
  }
}
