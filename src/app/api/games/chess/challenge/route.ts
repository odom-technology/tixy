import { checkNewGameAvailability } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { getAccountById } from '@/server/accounts';
import { createNotification } from '@/server/services/notifications';
import { createMatch } from '@/server/arcade/chess-match';
import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import {
  areArcadeFriends,
  getMatchJoinHref,
  withAbsoluteUrl,
} from '@/server/arcade/multiplayer';
import {
  checkChessChallengeSendAllowed,
  recordChessChallengeSend,
} from '@/server/arcade/chess-challenge-limits';
import {
  CHESS_CHALLENGE_MAX_WAGER,
  CHESS_WAGER_INCREMENT,
  CHESS_WAGER_MIN,
} from '@/server/arcade/chess-wager-constants';
import { isValidTimeFormatId } from '@/features/arcade/lib/chess/types';

export const dynamic = 'force-dynamic';

type ChallengePayload = {
  targetUserId?: string;
  wagerAmount?: number;
  timeFormatId?: string;
  preferredColor?: 'white' | 'black' | 'random';
};

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

  let body: ChallengePayload;
  try {
    body = (await request.json()) as ChallengePayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const targetUserId = body.targetUserId?.trim();
  if (!targetUserId) return NextResponse.json({ error: 'targetUserId is required.' }, { status: 400 });
  if (targetUserId === identity.userId) {
    return NextResponse.json({ error: 'You cannot challenge yourself.' }, { status: 400 });
  }
  if (!(await areArcadeFriends(identity.userId, targetUserId))) {
    return NextResponse.json(
      { error: 'Add this user as a friend before inviting them to a game.' },
      { status: 403 },
    );
  }

  const wagerAmount = typeof body.wagerAmount === 'number' ? Math.trunc(body.wagerAmount) : null;
  if (wagerAmount !== null) {
    if (wagerAmount < CHESS_WAGER_MIN) {
      return NextResponse.json({ error: `Minimum wager is ${CHESS_WAGER_MIN} Tickets.` }, { status: 400 });
    }
    if (wagerAmount > CHESS_CHALLENGE_MAX_WAGER) {
      return NextResponse.json({ error: `Maximum wager is ${CHESS_CHALLENGE_MAX_WAGER} Tickets.` }, { status: 400 });
    }
    if (wagerAmount % CHESS_WAGER_INCREMENT !== 0) {
      return NextResponse.json({ error: `Wager must be a multiple of ${CHESS_WAGER_INCREMENT} Tickets.` }, { status: 400 });
    }
    const { getWalletForUser } = await import('@/server/arcade/rewards/wallet');
    const wallet = await getWalletForUser(identity.userId);
    if (wallet.credits < wagerAmount) {
      return NextResponse.json(
        { error: `Insufficient Tickets. You have ${wallet.credits} but need ${wagerAmount}.` },
        { status: 402 },
      );
    }
  }

  const timeFormatId = isValidTimeFormatId(body.timeFormatId) ? body.timeFormatId : 'blitz';
  const preferredColor = body.preferredColor ?? 'random';
  let createdMatch: Awaited<ReturnType<typeof createMatch>> | null = null;
  let creatorWagerHeld = false;
  let failureStatus = 500;

  try {
    const now = Date.now();
    const policy = await checkChessChallengeSendAllowed({
      senderUserId: identity.userId,
      targetUserId,
      now,
    });
    if (!policy.ok) {
      const headers: Record<string, string> = {};
      if (policy.retryAfterMs) {
        headers['Retry-After'] = String(Math.max(1, Math.ceil(policy.retryAfterMs / 1000)));
      }
      return NextResponse.json(
        { error: policy.message, reason: policy.reason, matchId: policy.matchId, retryAfterMs: policy.retryAfterMs },
        { status: policy.status, headers },
      );
    }

    const recipient = await getAccountById(targetUserId);
    if (!recipient?.email || recipient.status !== 'active') {
      return NextResponse.json({ error: 'Selected user is not eligible for challenges.' }, { status: 400 });
    }

    const senderName = identity.name?.trim() || 'A teammate';
    createdMatch = await createMatch(identity.userId, senderName, {
      invitedUserId: targetUserId,
      wagerAmount,
      timeFormatId,
      preferredColor,
    });

    if (wagerAmount && wagerAmount > 0) {
      try {
        const { holdPlayer1Wager } = await import('@/server/arcade/chess-wager');
        await holdPlayer1Wager(createdMatch.id, identity.userId, wagerAmount);
        creatorWagerHeld = true;
      } catch (holdErr) {
        failureStatus = 402;
        throw new Error(`Insufficient Tickets to hold wager. ${(holdErr as Error).message}`);
      }
    }

    const joinHref = getMatchJoinHref('chess', createdMatch.id);

    const notifParts = [`${senderName} challenged you to chess.`];
    if (wagerAmount) notifParts.push(`Wager: ${wagerAmount} Tickets each.`);

    const notification = await createNotification({
      userId: targetUserId,
      type: 'game_turn',
      title: wagerAmount ? `♟ ${wagerAmount}-Ticket chess wager` : '♟ New chess challenge',
      body: notifParts.join(' '),
      href: joinHref,
      preferenceKey: 'game_notifications',
    });

    const challengeUrl = withAbsoluteUrl(joinHref, request);
    await recordChessChallengeSend({ senderUserId: identity.userId, now });

    return NextResponse.json({
      success: true,
      matchId: createdMatch.id,
      notificationDelivered: Boolean(notification),
      challengeUrl,
    });
  } catch (error) {
    if (createdMatch) {
      try {
        if (creatorWagerHeld && wagerAmount && wagerAmount > 0) {
          const { mutateWalletAndLedgerTx } = await import('@/server/arcade/rewards/helpers');
          await mutateWalletAndLedgerTx({
            userId: identity.userId,
            currencyType: 'credits',
            amount: wagerAmount,
            sourceType: 'wager_refund',
            sourceId: `chess-wager-refund:${createdMatch.id}:${identity.userId}`,
            meta: { matchId: createdMatch.id, reason: 'challenge_setup_failed', gameType: 'chess' },
          });
        }
        const { deleteMatch } = await import('@/server/arcade/chess-match');
        await deleteMatch(createdMatch.id);
      } catch (cleanupError) {
        console.error('Failed to clean up chess challenge setup:', cleanupError);
      }
    }
    console.error('Failed to send chess challenge:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to send challenge.' },
      { status: failureStatus },
    );
  }
}
