import { checkNewGameAvailability } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireIdentity } from '@/server/auth';
import { query } from '@/server/db/client';
import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import { getBotUserId, BOT_NAMES, isBotUser, computeBotMove, type BotDifficulty } from '@/server/arcade/checkers-bot';
import { getMatch, submitMove } from '@/server/arcade/checkers-match';
import { isValidTimeFormatId, resolveTimeFormat, STARTING_BOARD, type CheckersColor } from '@/features/arcade/lib/checkers/types';
import { colorForPlayer } from '@/features/arcade/lib/checkers';

export const dynamic = 'force-dynamic';

const VALID_DIFFICULTIES: BotDifficulty[] = ['easy', 'medium', 'hard'];

type BotMatchPayload = {
  difficulty?: string;
  timeFormatId?: string;
  preferredColor?: 'red' | 'white' | 'random';
};

/** POST — Create a match vs a bot. Bot matches are untimed. */
export async function POST(request: Request) {
  const unavailable = await checkNewGameAvailability('checkers');
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

  const timeFormatId = isValidTimeFormatId(body.timeFormatId) ? body.timeFormatId : 'untimed';
  const preset = resolveTimeFormat(timeFormatId);

  const botId = getBotUserId(difficulty);
  const botName = BOT_NAMES[difficulty];
  const userName = identity.name || 'Anonymous';
  const now = Date.now();
  const id = crypto.randomUUID();

  // Color selection. 'random' = 50/50. Red moves first.
  let humanColor: CheckersColor;
  if (body.preferredColor === 'red') humanColor = 'red';
  else if (body.preferredColor === 'white') humanColor = 'white';
  else humanColor = Math.random() < 0.5 ? 'red' : 'white';

  const redId = humanColor === 'red' ? identity.userId : botId;
  const whiteId = humanColor === 'red' ? botId : identity.userId;

  await query(
    `INSERT INTO checkers_matches
       (id, player1_id, player1_name, player2_id, player2_name, red_id,
        white_id, status, current_turn, time_format, initial_time_ms,
        increment_ms, red_time_ms, white_time_ms, last_move_at, board, ply,
        move_count, no_progress_plies, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9, $10, $11, $12, $13,
             $14, $15, 0, 0, 0, $16, $17)`,
    [
      id, identity.userId, userName, botId, botName, redId, whiteId,
      redId, preset.id, preset.initialTimeMs, preset.incrementMs,
      preset.initialTimeMs, preset.initialTimeMs, now, STARTING_BOARD, now, now,
    ],
  );

  let match = (await getMatch(id))!;

  // If the bot plays red, fire its opening move immediately.
  if (isBotUser(match.currentTurn)) {
    try {
      const botColor = colorForPlayer(match, botId);
      if (botColor) {
        const botMove = await computeBotMove(match.board, difficulty, botColor);
        const result = await submitMove(id, botId, botMove);
        match = result.match;
      }
    } catch (err) {
      console.error('Bot opening move failed:', err);
    }
  }

  return NextResponse.json({ match });
}
