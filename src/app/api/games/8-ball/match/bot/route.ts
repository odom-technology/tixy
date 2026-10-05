import { checkNewGameAvailability } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireIdentity, type ArcadeIdentity } from '@/server/auth';
import { isGuestIdentity } from '@/server/auth/guest';
import { getOrCreateRouteIdentity } from '@/server/auth/route-identity';
import { query } from '@/server/db/client';
import { createBreakRack } from '@/features/arcade/lib/pool-physics';
import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import { getBotUserId, BOT_NAMES, type BotDifficulty } from '@/server/arcade/pool-bot';
import { getMatch } from '@/server/arcade/pool-match';
import {
  cleanupGuestPoolMatches,
  deleteGuestPoolMatches,
  guestRateLimit,
  isPoolGuestPracticeEnabled,
} from '@/server/arcade/pool-guest-practice';

export const dynamic = 'force-dynamic';

const VALID_DIFFICULTIES: BotDifficulty[] = ['easy', 'medium', 'hard'];

/**
 * POST — Create a match against a bot. Body: { difficulty: 'easy'|'medium'|'hard' }
 *
 * Signed-out players get a guest identity here when POOL_GUEST_PRACTICE is on
 * (server/arcade/pool-guest-practice.ts). A guest has one bot match at a time.
 */
export async function POST(request: Request) {
  const unavailable = await checkNewGameAvailability('8-ball');
  if (unavailable) return unavailable;

  let identity: ArcadeIdentity;
  let attachCookie: (response: NextResponse) => void = () => {};
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    if (!isPoolGuestPracticeEnabled()) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }
    const routeIdentity = await getOrCreateRouteIdentity({ allowExternal: true });
    if (!isGuestIdentity(routeIdentity.identity)) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }
    identity = routeIdentity.identity;
    attachCookie = routeIdentity.attachCookie;
  }
  if (isGuestIdentity(identity)) {
    const limited = guestRateLimit(request, 'match');
    if (limited) return limited;
  }
  const guest = isGuestIdentity(identity);
  if (!guest) {
    const banResponse = await ensureNotGameBanned(identity.userId);
    if (banResponse) return banResponse;
  }

  let body: { difficulty?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const difficulty = (body.difficulty ?? 'medium') as BotDifficulty;
  if (!VALID_DIFFICULTIES.includes(difficulty)) {
    return NextResponse.json({ error: 'Invalid difficulty. Must be easy, medium, or hard.' }, { status: 400 });
  }

  if (guest) {
    await deleteGuestPoolMatches(identity.userId);
  }
  void cleanupGuestPoolMatches();

  const botId = getBotUserId(difficulty);
  const botName = BOT_NAMES[difficulty];
  const userName = identity.name || 'Anonymous';
  const now = Date.now();
  const id = crypto.randomUUID();
  const balls = createBreakRack();

  // Randomly decide who breaks (50/50)
  const humanBreaks = Math.random() < 0.5;
  const breaker = humanBreaks ? identity.userId : botId;

  // Create match with bot already joined (status: active).
  // If bot breaks, DON'T process the break here — leave the rack intact
  // so the game page can animate the bot's break shot visually.
  await query(
    `INSERT INTO pool_matches
       (id, player1_id, player1_name, player2_id, player2_name, status,
        current_turn, phase, player1_group, player2_group, balls_json,
        foul_state_json, winner_id, loser_id, win_reason, move_count,
        turn_started_at, last_reminder_at, last_shot_input_json, created_at,
        updated_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, 'active', $6, 'break', NULL, NULL, $7, NULL,
             NULL, NULL, NULL, 0, $8, NULL, NULL, $9, $10, NULL)`,
    [
      id, identity.userId, userName, botId, botName, breaker,
      JSON.stringify(balls), now, now, now,
    ],
  );

  const match = await getMatch(id);
  const response = NextResponse.json({ match, guest });
  attachCookie(response);
  return response;
}
