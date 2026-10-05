import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { queryOne, withTransaction } from '@/server/db/client';
import { recordPoolChallengeDenied } from '@/server/arcade/pool-challenge-limits';
import { mutateWalletAndLedgerForTransaction } from '@/server/arcade/rewards/wallet';
import { resolveMultiplayerWaitingNotifications } from '@/server/arcade/multiplayer-waiting-notifications';

export const dynamic = 'force-dynamic';

/** POST — Cancel a waiting match (no opponent joined yet). */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const { id: matchId } = await params;

  const match = await queryOne<{
    player1Id: string;
    player2Id: string | null;
    invitedUserId: string | null;
    status: string;
    wagerAmount: string | number | null;
    wagerStatus: string | null;
  }>(
    `SELECT player1_id AS "player1Id",
            player2_id AS "player2Id",
            invited_user_id AS "invitedUserId",
            status,
            wager_amount AS "wagerAmount",
            wager_status AS "wagerStatus"
     FROM pool_matches
     WHERE id = $1`,
    [matchId],
  );

  if (!match) {
    // Idempotent cancel/decline handling for stale notification links.
    await resolveMultiplayerWaitingNotifications({ gameType: '8-ball', matchId });
    return NextResponse.json({
      success: true,
      stale: true,
      canceled: true,
    });
  }

  if (match.status !== 'waiting') {
    return NextResponse.json({ error: 'Can only cancel matches waiting for an opponent.' }, { status: 409 });
  }

  const isCreatorCancel = match.player1Id === identity.userId;
  const isInvitedDecline =
    match.invitedUserId === identity.userId &&
    !match.player2Id;

  if (!isCreatorCancel && !isInvitedDecline) {
    return NextResponse.json({ error: 'Not your match.' }, { status: 403 });
  }

  // Delete and refund together. The delete only takes a table that is still
  // waiting with no second player, so a join that lands first keeps its
  // table and its stakes, and the refund can't be paid for a table that
  // went on to be played.
  const removed = await withTransaction(async (client) => {
    const row = await client.query<{ wagerAmount: string | number | null; wagerStatus: string | null }>(
      `DELETE FROM pool_matches
       WHERE id = $1 AND status = 'waiting' AND player2_id IS NULL
       RETURNING wager_amount AS "wagerAmount", wager_status AS "wagerStatus"`,
      [matchId],
    );
    const deleted = row.rows[0];
    if (!deleted) return false;
    const wagerAmount = deleted.wagerAmount == null ? null : Number(deleted.wagerAmount);
    if (wagerAmount && wagerAmount > 0 && (deleted.wagerStatus === 'p1_held' || deleted.wagerStatus === 'held')) {
      await mutateWalletAndLedgerForTransaction(client, {
        userId: match.player1Id,
        currencyType: 'credits',
        amount: wagerAmount,
        sourceType: 'wager_refund',
        sourceId: `match-wager-refund:${matchId}:${match.player1Id}:cancel`,
        meta: { matchId, reason: 'match_canceled' },
      });
    }
    return true;
  });
  if (!removed) {
    return NextResponse.json({ error: 'Can only cancel matches waiting for an opponent.' }, { status: 409 });
  }
  await resolveMultiplayerWaitingNotifications({ gameType: '8-ball', matchId });

  if (isInvitedDecline) {
    const denyResult = await recordPoolChallengeDenied({
      senderUserId: match.player1Id,
      targetUserId: identity.userId,
    });

    return NextResponse.json({
      success: true,
      declined: true,
      blockedUntil: denyResult.blockedUntil,
    });
  }

  return NextResponse.json({ success: true, canceled: true });
}
