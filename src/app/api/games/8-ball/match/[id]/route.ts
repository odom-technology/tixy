import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { queryOne } from '@/server/db/client';
import { countPlayerShots, getMatch, isMatchSpectatable, trackSpectator, getSpectatorCount, TURN_TIMEOUT_MS, REMINDER_COOLDOWN_MS } from '@/server/arcade/pool-match';
import { getTierName, getTierColor } from '@/server/arcade/pool-elo';
import { getPlayerCardsForUsers, type PlayerCard } from '@/server/arcade/player-cards';
import { takeMatchRunResult } from '@/server/arcade/match-run-results';
import { isGuestIdentity } from '@/server/auth/guest';
import {
  isGuestBotMatchFor,
  isPoolGuestPracticeEnabled,
} from '@/server/arcade/pool-guest-practice';

export const dynamic = 'force-dynamic';

type EloHistoryRow = {
  playerAId: string;
  playerBId: string;
  playerAEloBefore: string | number;
  playerBEloBefore: string | number;
  playerAEloAfter: string | number;
  playerBEloAfter: string | number;
  playerAEloChange: string | number;
  playerBEloChange: string | number;
};

/**
 * GET — Get the current state of a match, including async PvP metadata.
 * A guest (POOL_GUEST_PRACTICE) can read only their own bot match; any other
 * match answers 401, as if they were signed out.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true, allowGuest: isPoolGuestPracticeEnabled() });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const { id } = await params;
  const match = await getMatch(id);
  const guest = isGuestIdentity(identity);
  if (guest && (!match || !isGuestBotMatchFor(match, identity.userId))) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  if (!match) {
    return NextResponse.json({ error: 'Match not found.' }, { status: 404 });
  }

  const isPlayer = match.player1Id === identity.userId || match.player2Id === identity.userId;
  const isSpectator = !isPlayer && isMatchSpectatable(match);

  if (!isPlayer && !isSpectator) {
    return NextResponse.json({ error: 'Not a player in this match.' }, { status: 403 });
  }

  // Track spectator presence (refreshed on each poll)
  if (isSpectator) {
    trackSpectator(id, identity.userId);
  }
  const spectatorCount = getSpectatorCount(id);

  // Always provide the last shot input + pre-shot balls when available.
  // The client uses moveCount diffing to decide whether to replay — no need
  // to gate on whose turn it is. This enables shot-by-shot replay even when
  // the opponent's turn continues (consecutive pots).
  // Spectators also use this to animate shots live.
  let lastOpponentShot: { angle: number; power: number; cuePosition: { x: number; y: number } | null; spinX?: number; spinY?: number } | null = null;
  let ballsBeforeLastShot: unknown[] | null = null;
  if (match.lastShotInputJson) {
    try {
      lastOpponentShot = JSON.parse(match.lastShotInputJson);
    } catch {
      lastOpponentShot = null;
    }
    if (match.ballsBeforeLastShotJson) {
      try {
        ballsBeforeLastShot = JSON.parse(match.ballsBeforeLastShotJson);
      } catch {
        ballsBeforeLastShot = null;
      }
    }
  }

  // Compute async PvP timing info for the client (players only)
  const now = Date.now();
  const isHumanMatch = match.player2Id && !match.player2Id.startsWith('bot:');
  const canRemind = Boolean(
    !isSpectator
    && isHumanMatch
    && match.status === 'active'
    && match.currentTurn !== identity.userId
    && (!match.lastReminderAt || now - match.lastReminderAt >= REMINDER_COOLDOWN_MS),
  );
  const turnTimeRemainingMs = match.turnStartedAt && isHumanMatch
    ? Math.max(0, TURN_TIMEOUT_MS - (now - match.turnStartedAt))
    : null;

  // For completed human-vs-human matches, include Elo change data so both
  // players can see the rating update on the game-over screen.
  let eloChange: {
    winner: { before: number; after: number; change: number; tier: string; tierColor: string };
    loser: { before: number; after: number; change: number; tier: string; tierColor: string };
  } | undefined;
  const isCompleted = match.status === 'completed' || match.status === 'forfeited';
  if (isCompleted && isHumanMatch && match.winnerId) {
    const history = await queryOne<EloHistoryRow>(
      `SELECT player_a_id AS "playerAId",
              player_b_id AS "playerBId",
              player_a_elo_before AS "playerAEloBefore",
              player_b_elo_before AS "playerBEloBefore",
              player_a_elo_after AS "playerAEloAfter",
              player_b_elo_after AS "playerBEloAfter",
              player_a_elo_change AS "playerAEloChange",
              player_b_elo_change AS "playerBEloChange"
       FROM pool_elo_history
       WHERE match_id = $1
       LIMIT 1`,
      [id],
    );
    if (history) {
      const winnerId = match.winnerId;
      const isWinnerA = history.playerAId === winnerId;
      const wBefore = Number(isWinnerA ? history.playerAEloBefore : history.playerBEloBefore);
      const wAfter = Number(isWinnerA ? history.playerAEloAfter : history.playerBEloAfter);
      const wChange = Number(isWinnerA ? history.playerAEloChange : history.playerBEloChange);
      const lBefore = Number(isWinnerA ? history.playerBEloBefore : history.playerAEloBefore);
      const lAfter = Number(isWinnerA ? history.playerBEloAfter : history.playerAEloAfter);
      const lChange = Number(isWinnerA ? history.playerBEloChange : history.playerAEloChange);
      eloChange = {
        winner: { before: wBefore, after: wAfter, change: wChange, tier: getTierName(wAfter), tierColor: getTierColor(wAfter) },
        loser: { before: lBefore, after: lAfter, change: lChange, tier: getTierName(lAfter), tierColor: getTierColor(lAfter) },
      };
    }
  }

  const runResult = isPlayer && !guest ? takeMatchRunResult(id, identity.userId) : null;
  // Additive: the viewer's own shots, for the result (moveCount counts both
  // players and the bot).
  const myShots = isPlayer && isCompleted ? await countPlayerShots(id, identity.userId) : undefined;

  // Additive: the players' name, avatar and equipped flair (frame included),
  // from the lookup the other board games use. One query pair, only when the
  // page asks (`?cards=1`, on load and when a player joins), never per poll or shot.
  let playerCards: Record<string, PlayerCard> | undefined;
  if (new URL(request.url).searchParams.get('cards') === '1') {
    const humanIds = [match.player1Id, match.player2Id].filter(
      (pid): pid is string => !!pid && !pid.startsWith('bot:'),
    );
    try {
      playerCards = Object.fromEntries(await getPlayerCardsForUsers(humanIds));
    } catch (error) {
      // Cosmetics are optional: the match still loads without them.
      console.error('[8-ball] player cards failed:', error);
    }
  }

  return NextResponse.json({
    match,
    userId: identity.userId,
    lastOpponentShot,
    ballsBeforeLastShot,
    canRemind,
    turnTimeRemainingMs,
    eloChange,
    isSpectator,
    spectatorCount,
    runResult,
    guest,
    myShots,
    playerCards,
  });
}
