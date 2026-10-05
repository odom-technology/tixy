import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import { submitPlacement, runBotReply } from '@/server/arcade/battleship-match';
import { redactMatchForViewer } from '@/server/arcade/battleship-engine';
import { isBotUser } from '@/server/arcade/battleship-bot';

export const dynamic = 'force-dynamic';

type PlacePayload = { ships?: unknown };

/**
 * POST — Submit a fleet placement + ready up (phase='placement').
 * Body: { ships: Array<{ id, cells: number[] }> }. Server validates legality.
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

  let body: PlacePayload;
  try {
    body = (await request.json()) as PlacePayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  try {
    const result = await submitPlacement(matchId, identity.userId, body.ships);

    // If the battle started and it's now a bot's turn (or the bot still needs to
    // place in a bot match), kick the bot worker.
    if (
      result.match.status === 'active'
      && (isBotUser(result.match.player1Id) || (result.match.player2Id != null && isBotUser(result.match.player2Id)))
    ) {
      void runBotReply(matchId);
    }

    return NextResponse.json({
      match: redactMatchForViewer(result.match, identity.userId),
      bothReady: result.bothReady,
    });
  } catch (error) {
    const message = (error as Error).message;
    const status = message.includes('not found') ? 404
      : message.includes('Illegal') || message.includes('Invalid') ? 400
      : message.includes('not a player') || message.includes('not in this match') ? 403
      : 409;
    return NextResponse.json({ error: message }, { status });
  }
}
