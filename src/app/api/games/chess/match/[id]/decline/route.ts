import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import { query, queryOne } from '@/server/db/client';
import { broadcast } from '@/server/events';
import { mutateWalletAndLedgerTx } from '@/server/arcade/rewards/helpers';
import { recordChessChallengeDenied } from '@/server/arcade/chess-challenge-limits';

export const dynamic = 'force-dynamic';

/**
 * POST — Decline an incoming chess challenge. Deletes the waiting match,
 * refunds the creator's held wager, and records a denial event for
 * rate-limiting purposes.
 */
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
  const banResponse = await ensureNotGameBanned(identity.userId);
  if (banResponse) return banResponse;

  const { id: matchId } = await params;
  const row = await queryOne<{
    player1Id: string;
    invitedUserId: string | null;
    status: string;
    wagerAmount: string | number | null;
    wagerStatus: string | null;
  }>(
    `SELECT player1_id AS "player1Id",
            invited_user_id AS "invitedUserId",
            status,
            wager_amount AS "wagerAmount",
            wager_status AS "wagerStatus"
     FROM chess_matches
     WHERE id = $1`,
    [matchId],
  );
  if (!row) return NextResponse.json({ error: 'Match not found.' }, { status: 404 });
  if (row.status !== 'waiting') {
    return NextResponse.json({ error: 'Match is not a pending invite.' }, { status: 409 });
  }
  if (row.invitedUserId !== identity.userId) {
    return NextResponse.json({ error: 'This challenge is not for you.' }, { status: 403 });
  }

  // Delete with CAS on status='waiting' so a race with a concurrent join
  // (which is also CAS-safe on the flip side) can't leave us deleting an
  // active match and issuing a phantom refund.
  const deleted = await query(
    `DELETE FROM chess_matches WHERE id = $1 AND status = 'waiting'`,
    [matchId],
  );
  if ((deleted.rowCount ?? 0) === 0) {
    return NextResponse.json(
      { error: 'Match is no longer declinable — it may already be active.' },
      { status: 409 },
    );
  }

  // Refund creator's held wager (if any). Covers both 'pending_accept' and
  // 'p1_held'; ledger is idempotent on sourceId so duplicate refunds no-op.
  // Runs after the delete commits so a lost race can't trigger a stray refund.
  const wagerAmount = row.wagerAmount == null ? null : Number(row.wagerAmount);
  if (wagerAmount && wagerAmount > 0 && row.wagerStatus !== 'held' && row.wagerStatus !== 'paid' && row.wagerStatus !== 'refunded') {
    try {
      await mutateWalletAndLedgerTx({
        userId: row.player1Id,
        currencyType: 'credits',
        amount: wagerAmount,
        sourceType: 'wager_refund',
        sourceId: `chess-wager-refund:${matchId}:${row.player1Id}`,
        meta: { matchId, reason: 'declined', gameType: 'chess' },
      });
    } catch (error) {
      console.error('Failed to refund wager on decline:', error);
    }
  }

  await recordChessChallengeDenied({
    senderUserId: row.player1Id,
    targetUserId: identity.userId,
  });

  broadcast('chessLobby', { type: 'match_declined', matchId });
  broadcast([`chess:${matchId}`, 'chessMatch'], { matchId, type: 'declined', by: identity.userId });

  return NextResponse.json({ ok: true });
}
