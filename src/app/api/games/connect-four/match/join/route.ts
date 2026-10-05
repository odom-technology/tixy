import { checkNewGameAvailability } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { getMatch, joinMatch } from '@/server/arcade/connect-four-match';
import { getWalletForUser } from '@/server/arcade/rewards/wallet';
import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import { markGameInviteCodeClaimed } from '@/server/arcade/multiplayer';
import { announceMatchTableOpponentJoined } from '@/server/arcade/multiplayer-waiting-notifications';

export const dynamic = 'force-dynamic';

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

  let body: { matchId?: string; inviteCode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  if (typeof body.matchId !== 'string' || !body.matchId.trim()) {
    return NextResponse.json({ error: 'matchId is required.' }, { status: 400 });
  }

  // Pre-validate Player 2's balance for wager matches.
  const match = await getMatch(body.matchId);
  if (match?.wagerAmount && match.wagerAmount > 0) {
    const wallet = await getWalletForUser(identity.userId);
    if (wallet.credits < match.wagerAmount) {
      return NextResponse.json(
        { error: `Insufficient Tickets. You have ${wallet.credits} but need ${match.wagerAmount} to accept this wager.` },
        { status: 402 },
      );
    }
  }

  try {
    const userName = identity.name || 'Anonymous';
    const joinedMatch = await joinMatch(body.matchId, identity.userId, userName);
    await announceMatchTableOpponentJoined({
      gameType: 'connect-four', matchId: body.matchId, opponentName: userName,
    });
    if (body.inviteCode?.trim()) {
      await markGameInviteCodeClaimed({
        code: body.inviteCode,
        gameType: 'connect-four',
        matchId: body.matchId,
        claimedByUserId: identity.userId,
      });
    }
    return NextResponse.json({ match: joinedMatch });
  } catch (error) {
    const message = (error as Error).message;
    const status =
      message.includes('not found') ? 404 :
      message.includes('not open') ||
      message.includes('already full') ||
      message.includes('own match') ||
      message.includes('already claimed') ||
      message.includes('reserved') ? 409 :
      500;
    return NextResponse.json({ error: message }, { status });
  }
}
