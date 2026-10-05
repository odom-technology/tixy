import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import { submitMove, runBotReply } from '@/server/arcade/chess-match';
import { isBotUser } from '@/server/arcade/chess-bot';

export const dynamic = 'force-dynamic';

type MovePayload = { uci?: string };

/**
 * POST — Submit a move. If the opponent is a bot, schedules the bot's reply
 * in the background and returns the player's updated match state immediately.
 * Body: { uci: "e2e4" | "e7e8q" }
 */
export async function POST(
  request: Request,
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

  let body: MovePayload;
  try {
    body = (await request.json()) as MovePayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  if (typeof body.uci !== 'string' || !body.uci.trim()) {
    return NextResponse.json({ error: 'uci is required.' }, { status: 400 });
  }

  try {
    const result = await submitMove(matchId, identity.userId, body.uci.trim().toLowerCase());
    const match = result.match;

    // If the opponent is a bot, fire its reply asynchronously — the SSE
    // `chessMatch` broadcast emitted by the bot's own submitMove call will
    // push the update to the client when it lands.
    if (match.status === 'active' && isBotUser(match.currentTurn)) {
      void runBotReply(matchId);
    }

    return NextResponse.json({ match, eloChange: result.eloChange ?? undefined });
  } catch (error) {
    const message = (error as Error).message;
    const status = message.includes('not found') ? 404
      : message.includes('Not your turn') ? 403
      : message.includes('Illegal') || message.includes('Invalid UCI') ? 400
      : 409;
    return NextResponse.json({ error: message }, { status });
  }
}
