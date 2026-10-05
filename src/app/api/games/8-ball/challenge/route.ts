import { checkNewGameAvailability } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { withTransaction } from '@/server/db/client';
import { getAccountById } from '@/server/accounts';
import { createNotification } from '@/server/services/notifications';
import { createMatchWithStake } from '@/server/arcade/pool-match';
import { broadcast } from '@/server/events';
import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import {
  areArcadeFriends,
  getMatchJoinHref,
} from '@/server/arcade/multiplayer';
import {
  checkPoolChallengeSendAllowed,
  recordPoolChallengeSend,
} from '@/server/arcade/pool-challenge-limits';
import {
  POOL_WAGER_INCREMENT,
  POOL_WAGER_MIN,
} from '@/server/arcade/pool-wager-constants';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const unavailable = await checkNewGameAvailability('8-ball');
  if (unavailable) return unavailable;

  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401 },
    );
  }
  const banResponse = await ensureNotGameBanned(identity.userId);
  if (banResponse) return banResponse;

  let body: {
    targetUserId?: string;
    wagerAmount?: number;
    hardcoreMode?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const targetUserId = body.targetUserId?.trim();
  if (!targetUserId) {
    return NextResponse.json(
      { error: 'targetUserId is required.' },
      { status: 400 },
    );
  }
  if (targetUserId === identity.userId) {
    return NextResponse.json(
      { error: 'You cannot challenge yourself.' },
      { status: 400 },
    );
  }
  if (!(await areArcadeFriends(identity.userId, targetUserId))) {
    return NextResponse.json(
      { error: 'Add this user as a friend before inviting them to a game.' },
      { status: 403 },
    );
  }

  // Validate wager if provided
  const wagerAmount =
    typeof body.wagerAmount === 'number' ? Math.trunc(body.wagerAmount) : null;
  const hardcoreMode = body.hardcoreMode === true;
  if (wagerAmount !== null) {
    if (!Number.isSafeInteger(wagerAmount)) {
      return NextResponse.json(
        { error: 'Invalid wager amount.' },
        { status: 400 },
      );
    }
    if (wagerAmount < POOL_WAGER_MIN) {
      return NextResponse.json(
        { error: `Minimum wager is ${POOL_WAGER_MIN} Tickets.` },
        { status: 400 },
      );
    }
    if (wagerAmount % POOL_WAGER_INCREMENT !== 0) {
      return NextResponse.json(
        {
          error: `Wager must be a multiple of ${POOL_WAGER_INCREMENT} Tickets.`,
        },
        { status: 400 },
      );
    }
    // Validate sender balance (actual hold happens after match is created below)
    const { getWalletForUser } = await import('@/server/arcade/rewards/wallet');
    const wallet = await getWalletForUser(identity.userId);
    if (wallet.credits < wagerAmount) {
      return NextResponse.json(
        {
          error: `Insufficient Tickets. You have ${wallet.credits} but need ${wagerAmount}.`,
        },
        { status: 402 },
      );
    }
  }

  try {
    const now = Date.now();
    const senderName =
      identity.name?.trim() || 'A teammate';

    // One table per pair. Under an advisory lock on the pair, a challenge to
    // someone whose own challenge to you is still waiting, with the same
    // stake and rules, returns their table instead of opening a second one
    // (two players pressing rematch at once). The lock is held until the
    // new table, if any, has been inserted, so the second request sees it.
    const pairKey = `8ball-pair:${[identity.userId, targetUserId].sort().join(':')}`;
    let created;
    try {
      created = await withTransaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [pairKey]);
        const theirs = await client.query<{ id: string }>(
          `SELECT id FROM pool_matches
           WHERE status = 'waiting'
             AND player1_id = $1
             AND invited_user_id = $2
             AND player2_id IS NULL
             AND COALESCE(wager_amount, 0) = $3
             AND COALESCE(hardcore_mode, FALSE) = $4
             -- Only a table whose stake, if it has one, is already held.
             AND (wager_status IS NULL OR wager_status = 'p1_held')
           ORDER BY created_at DESC
           LIMIT 1`,
          [targetUserId, identity.userId, wagerAmount ?? 0, hardcoreMode],
        );
        if (theirs.rows[0]) return { kind: 'theirs' as const, matchId: theirs.rows[0].id };

        const challengePolicy = await checkPoolChallengeSendAllowed({
          senderUserId: identity.userId,
          targetUserId,
          now,
        });
        if (!challengePolicy.ok) {
          const headers: Record<string, string> = {};
          if (challengePolicy.retryAfterMs) {
            headers['Retry-After'] = String(
              Math.max(1, Math.ceil(challengePolicy.retryAfterMs / 1000)),
            );
          }
          return NextResponse.json(
            {
              error: challengePolicy.message,
              reason: challengePolicy.reason,
              matchId: challengePolicy.matchId,
              retryAfterMs: challengePolicy.retryAfterMs,
            },
            { status: challengePolicy.status, headers },
          );
        }

        const recipient = await getAccountById(targetUserId);
        if (!recipient?.email || recipient.status !== 'active') {
          return NextResponse.json(
            { error: 'Selected user is not eligible for challenges.' },
            { status: 400 },
          );
        }

        // The table and player 1's stake commit together on this client,
        // still under the pair lock: nobody can join before the stake is
        // held, and a failed hold leaves no table behind.
        return {
          kind: 'mine' as const,
          match: await createMatchWithStake(client, identity.userId, senderName, {
            invitedUserId: targetUserId,
            wagerAmount,
            hardcoreMode,
          }),
        };
      });
    } catch (holdErr) {
      if ((holdErr as Error).message?.includes('Insufficient')) {
        return NextResponse.json(
          { error: `Insufficient Tickets to hold wager. ${(holdErr as Error).message}` },
          { status: 402 },
        );
      }
      throw holdErr;
    }
    if (created instanceof NextResponse) return created;
    if (created.kind === 'theirs') {
      // Additive: `inviteFromTarget` tells the client to join this table.
      return NextResponse.json({
        success: true,
        matchId: created.matchId,
        reusedMatch: true,
        inviteFromTarget: true,
        notificationDelivered: false,
        mattermostDelivered: false,
      });
    }
    const match = created.match;

    broadcast('poolLobby', { type: 'match_created', matchId: match.id });

    await recordPoolChallengeSend({ senderUserId: identity.userId, now });
    const joinHref = getMatchJoinHref('8-ball', match.id);

    const notifParts = [`${senderName} challenged you to a game of 8-ball.`];
    if (wagerAmount) notifParts.push(`${wagerAmount} tickets each on the table.`);
    if (hardcoreMode) notifParts.push('Hardcore: no aim lines.');

    const notification = await createNotification({
      userId: targetUserId,
      type: 'game_turn',
      title: wagerAmount
        ? `8-ball for ${wagerAmount} tickets`
        : '8-ball challenge',
      body: notifParts.join(' '),
      href: joinHref,
      preferenceKey: 'game_notifications',
    });

    return NextResponse.json({
      success: true,
      matchId: match.id,
      reusedMatch: false,
      notificationDelivered: Boolean(notification),
      mattermostDelivered: false,
    });
  } catch (error) {
    console.error('Failed to send 8-ball challenge:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to send challenge.' },
      { status: 500 },
    );
  }
}
