import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import { submitMove, runBotReply } from '@/server/arcade/reversi-match';
import { isBotUser } from '@/server/arcade/reversi-bot';
import { parseCell } from '@/features/arcade/lib/reversi';

export const dynamic = 'force-dynamic';

type MovePayload = { cell?: number | string };

/**
 * POST — Place a disc. If the opponent is a bot, schedules the bot's reply in
 * the background and returns the player's updated match state immediately.
 * Body: { cell: 0-63 }
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

  const cell = parseCell(body.cell);
  if (cell === null) {
    return NextResponse.json({ error: 'cell is required.' }, { status: 400 });
  }

  try {
    const result = await submitMove(matchId, identity.userId, cell);
    const match = result.match;

    // If it's now a bot's turn (opponent, or the human passed back to the bot),
    // fire its reply asynchronously.
    if (match.status === 'active' && isBotUser(match.currentTurn)) {
      void runBotReply(matchId);
    }

    return NextResponse.json({ match, eloChange: result.eloChange ?? undefined });
  } catch (error) {
    const message = (error as Error).message;
    const status = message.includes('not found') ? 404
      : message.includes('Not your turn') ? 403
      : message.includes('Illegal') || message.includes('Invalid') ? 400
      : 409;
    return NextResponse.json({ error: message }, { status });
  }
}
