import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import { submitShot, runBotReply } from '@/server/arcade/battleship-match';
import { redactMatchForViewer } from '@/server/arcade/battleship-engine';
import { isBotUser } from '@/server/arcade/battleship-bot';

export const dynamic = 'force-dynamic';

type ShotPayload = { cell?: number | string };

function parseCell(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return null;
}

/**
 * POST — Fire a shot at the opponent's grid (phase='active'). Server resolves
 * hit/miss/sunk against the HIDDEN opponent board. If the opponent is a bot,
 * its reply is scheduled in the background. Body: { cell: 0-99 }.
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

  let body: ShotPayload;
  try {
    body = (await request.json()) as ShotPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const cell = parseCell(body.cell);
  if (cell === null) {
    return NextResponse.json({ error: 'cell is required.' }, { status: 400 });
  }

  try {
    const result = await submitShot(matchId, identity.userId, cell);
    const match = result.match;

    if (
      match.status === 'active'
      && match.currentTurn != null
      && isBotUser(match.currentTurn)
    ) {
      void runBotReply(matchId);
    }

    return NextResponse.json({
      match: redactMatchForViewer(match, identity.userId),
      shot: result.shot,
      eloChange: result.eloChange ?? undefined,
    });
  } catch (error) {
    const message = (error as Error).message;
    const status = message.includes('not found') ? 404
      : message.includes('Not your turn') ? 403
      : message.includes('Illegal') || message.includes('Invalid') ? 400
      : 409;
    return NextResponse.json({ error: message }, { status });
  }
}
