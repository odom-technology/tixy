import { checkNewGameAvailability } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireIdentity } from '@/server/auth';
import { query } from '@/server/db/client';
import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import {
  getBotUserId,
  BOT_NAMES,
  randomFleet,
  type BotDifficulty,
} from '@/server/arcade/battleship-bot';
import { getMatch, runBotReply } from '@/server/arcade/battleship-match';
import { redactMatchForViewer } from '@/server/arcade/battleship-engine';

export const dynamic = 'force-dynamic';

const VALID_DIFFICULTIES: BotDifficulty[] = ['easy', 'medium', 'hard'];

type BotMatchPayload = { difficulty?: string };

/**
 * POST — Create a match vs a bot. The match opens directly in
 * status='active', phase='placement' with the bot (player2) pre-placed + ready.
 * The human still privately places their fleet; once they ready up the match
 * transitions to the battle and the first turn is chosen.
 */
export async function POST(request: Request) {
  const unavailable = await checkNewGameAvailability('battleship');
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
  const botFleet = JSON.stringify(randomFleet());

  await query(
    `INSERT INTO battleship_matches
       (id, player1_id, player1_name, player2_id, player2_name,
        status, phase, current_turn, player1_board, player2_board,
        player1_shots, player2_shots, player1_ready, player2_ready,
        ply, move_count, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5,
             'active', 'placement', NULL, NULL, $6,
             '[]', '[]', FALSE, TRUE,
             0, 0, $7, $7)`,
    [id, identity.userId, userName, botId, botName, botFleet, now],
  );

  // Record the bot's placement (audit).
  await query(
    `INSERT INTO battleship_moves (id, match_id, player_id, ply, kind, cell, outcome, move_duration_ms, created_at)
     VALUES ($1, $2, $3, 0, 'place', 0, NULL, NULL, $4)`,
    [crypto.randomUUID(), id, botId, now],
  );

  const match = (await getMatch(id))!;
  // Nothing to kick yet (bot is ready, waiting on the human to place).
  void runBotReply(id);

  return NextResponse.json({ match: redactMatchForViewer(match, identity.userId) });
}
