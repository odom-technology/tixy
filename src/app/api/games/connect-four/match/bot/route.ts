import { checkNewGameAvailability } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireIdentity } from '@/server/auth';
import { query } from '@/server/db/client';
import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import { getBotUserId, BOT_NAMES, isBotUser, computeBotMove, type BotDifficulty } from '@/server/arcade/connect-four-bot';
import { getMatch, submitMove } from '@/server/arcade/connect-four-match';
import { STARTING_BOARD, type Color } from '@/features/arcade/lib/connect-four/types';

export const dynamic = 'force-dynamic';

const VALID_DIFFICULTIES: BotDifficulty[] = ['easy', 'medium', 'hard'];

type BotMatchPayload = {
  difficulty?: string;
  preferredColor?: 'red' | 'yellow' | 'random';
};

/** POST — Create a match vs a bot. Status is active immediately; if the bot
 *  is red (moves first) its opening drop is fired inline. */
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
  const userName = identity.name || 'Anonymous';
  const now = Date.now();
  const id = crypto.randomUUID();

  // Color selection. 'random' = 50/50. Red moves first.
  let humanColor: Color;
  if (body.preferredColor === 'red') humanColor = 'red';
  else if (body.preferredColor === 'yellow') humanColor = 'yellow';
  else humanColor = Math.random() < 0.5 ? 'red' : 'yellow';

  // red <-> white_id, yellow <-> black_id; red moves first (current_turn = redId).
  const redId = humanColor === 'red' ? identity.userId : botId;
  const yellowId = humanColor === 'red' ? botId : identity.userId;

  await query(
    `INSERT INTO connect_four_matches
       (id, player1_id, player1_name, player2_id, player2_name, white_id,
        black_id, status, current_turn, board, ply, move_count,
        created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9, 0, 0, $10, $11)`,
    [
      id, identity.userId, userName, botId, botName, redId, yellowId,
      redId, STARTING_BOARD, now, now,
    ],
  );

  let match = (await getMatch(id))!;

  // If the bot plays red (first), fire its opening move immediately.
  if (isBotUser(match.currentTurn)) {
    try {
      const botColumn = await computeBotMove(match.board, difficulty);
      const result = await submitMove(id, botId, botColumn);
      match = result.match;
    } catch (err) {
      console.error('Bot opening move failed:', err);
    }
  }

  return NextResponse.json({ match });
}
