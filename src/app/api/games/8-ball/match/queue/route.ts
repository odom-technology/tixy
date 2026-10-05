import { checkNewGameAvailability } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';
import type { PoolClient } from 'pg';

import { requireIdentity } from '@/server/auth';
import { query } from '@/server/db/client';
import { broadcast } from '@/server/events';
import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import { createMatch } from '@/server/arcade/pool-match';
import {
  runQuickMatch,
  type QuickMatchAdapter,
  type QuickMatchUser,
} from '@/server/arcade/match-queue';

export const dynamic = 'force-dynamic';

/**
 * 8-Ball quick-match ("Play now") adapter.
 *
 * Pairs only CASUAL open tables: no wager, no direct invite, and no tournament
 * seed. Wagered/hardcore challenges and tournament matches keep flowing through
 * the dedicated challenge/tournament paths — they are deliberately excluded from
 * `tryJoinWaiting` / `findOwnWaiting` so a Play-now click never silently drops a
 * player into a staked or reserved game.
 */
function poolQuickMatchAdapter(): QuickMatchAdapter {
  return {
    gameType: '8-ball',

    async tryJoinWaiting(client: PoolClient, user: QuickMatchUser) {
      // Lock ONE compatible open table (casual, un-invited, non-tournament,
      // not the caller's own). SKIP LOCKED so parallel Play clicks never
      // contend for the same waiting row.
      const candidate = await client.query<{ id: string; player1Id: string }>(
        `SELECT id, player1_id AS "player1Id"
           FROM pool_matches
          WHERE status = 'waiting'
            AND invited_user_id IS NULL
            AND (wager_amount IS NULL OR wager_amount = 0)
            AND tournament_match_id IS NULL
            AND player1_id <> $1
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1`,
        [user.userId],
      );
      const row = candidate.rows[0];
      if (!row) return null;

      // Mirror pool `joinMatch`: randomly assign the break (50/50) and start
      // the turn timer at join time.
      const now = Date.now();
      const joinerBreaks = Math.random() < 0.5;
      const breaker = joinerBreaks ? user.userId : row.player1Id;

      // The row is locked; this UPDATE claims it atomically. No wager holds —
      // casual tables only reach this path.
      await client.query(
        `UPDATE pool_matches
            SET player2_id = $1, player2_name = $2, invited_user_id = NULL,
                status = 'active', current_turn = $3,
                turn_started_at = $4, updated_at = $4
          WHERE id = $5`,
        [user.userId, user.userName, breaker, now, row.id],
      );
      return row.id;
    },

    async findOwnWaiting(user: QuickMatchUser) {
      const row = await query<{ id: string }>(
        `SELECT id FROM pool_matches
          WHERE player1_id = $1
            AND status = 'waiting'
            AND invited_user_id IS NULL
            AND (wager_amount IS NULL OR wager_amount = 0)
            AND tournament_match_id IS NULL
          ORDER BY created_at DESC
          LIMIT 1`,
        [user.userId],
      );
      return row.rows[0]?.id ?? null;
    },

    async createWaiting(user: QuickMatchUser) {
      // Reuse pool createMatch so the break rack, defaults, and the
      // `poolLobby` match_created broadcast stay canonical.
      const match = await createMatch(user.userId, user.userName);
      return match.id;
    },

    onJoined(matchId: string, user: QuickMatchUser) {
      // Mirror pool `joinMatch`'s broadcasts so both lobbies + the match page
      // transition without waiting for the 5s poll.
      broadcast('poolLobby', { type: 'match_joined', matchId });
      broadcast([`pool:${matchId}`, 'poolMatch'], {
        matchId,
        type: 'opponent_joined',
        userId: user.userId,
        userName: user.userName,
      });
    },
  };
}

/** POST — quick-match: join a compatible casual table, else queue a new one. */
export async function POST() {
  const unavailable = await checkNewGameAvailability('8-ball');
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
    const user: QuickMatchUser = {
      userId: identity.userId,
      userName: identity.name || 'Anonymous',
    };
    const result = await runQuickMatch(poolQuickMatchAdapter(), user);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to quick-match 8-ball:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to find a match.' },
      { status: 500 },
    );
  }
}
