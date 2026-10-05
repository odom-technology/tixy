import { checkNewGameAvailability } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireIdentity } from '@/server/auth';
import { query } from '@/server/db/client';
import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import { getBotUserId, BOT_NAMES, isBotUser, computeBotMove, type BotDifficulty } from '@/server/arcade/reversi-bot';
import { getMatch, submitMove } from '@/server/arcade/reversi-match';
import { STARTING_BOARD, type Color } from '@/features/arcade/lib/reversi/types';

export const dynamic = 'force-dynamic';

const VALID_DIFFICULTIES: BotDifficulty[] = ['easy', 'medium', 'hard'];

type BotMatchPayload = {
  difficulty?: string;
  preferredColor?: 'black' | 'white' | 'random';
};

/** POST — Create a match vs a bot. Status is active immediately; if the bot is
 *  black (moves first) its opening move is fired inline. */
export async function POST(request: Request) {
  const unavailable = await checkNewGameAvailability('reversi');
  if (unavailable) return unavailable;

  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  const banResponse = await ensureNotGameBanned(identity.userId);
  if (banResponse) return banResponse;

  let body: BotMatchPayload = {};
  try {
    body = (await request.json()) as BotMatchPayload;
  } catch {
    // optional
  }

  const difficulty = (body.difficulty ?? 'medium') as BotDifficulty;
  if (!VALID_DIFFICULTIES.includes(difficulty)) {
    return NextResponse.json({ error: 'Invalid difficulty.' }, { status: 400 });
  }

  const botId = getBotUserId(difficulty);
  const botName = BOT_NAMES[difficulty];
  const userName =
    identity.name && identity.name !== identity.email ? identity.name : 'Player';
  const now = Date.now();
  const id = crypto.randomUUID();

  // Color selection. 'random' = 50/50. Black moves first.
  let humanColor: Color;
  if (body.preferredColor === 'black') humanColor = 'black';
  else if (body.preferredColor === 'white') humanColor = 'white';
  else humanColor = Math.random() < 0.5 ? 'black' : 'white';

  const blackId = humanColor === 'black' ? identity.userId : botId;
  const whiteId = humanColor === 'black' ? botId : identity.userId;

  await query(
    `INSERT INTO reversi_matches
       (id, player1_id, player1_name, player2_id, player2_name, black_id,
        white_id, status, current_turn, board, ply, move_count,
        created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9, 0, 0, $10, $11)`,
    [
      id, identity.userId, userName, botId, botName, blackId, whiteId,
      blackId, STARTING_BOARD, now, now,
    ],
  );

  let match = (await getMatch(id))!;

  // If the bot plays black (first), fire its opening move immediately.
  if (isBotUser(match.currentTurn)) {
    try {
      const botCell = await computeBotMove(match.board, 'black', difficulty);
      const result = await submitMove(id, botId, botCell);
      match = result.match;
    } catch (err) {
      console.error('Bot opening move failed:', err);
    }
  }

  return NextResponse.json({ match });
}
