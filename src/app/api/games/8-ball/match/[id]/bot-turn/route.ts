import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { simulateShot } from '@/features/arcade/lib/pool-physics';
import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import {
  getMatch,
  updateMatchAfterShot,
  recordMove,
} from '@/server/arcade/pool-match';
import { evaluateShot } from '@/server/arcade/pool-rules';
import { isBotUser, computeBotShot, type BotDifficulty } from '@/server/arcade/pool-bot';
import { broadcast } from '@/server/events';
import { payPoolMatch, recordBotSpeedRun } from '@/server/arcade/pool-settle';
import { takeMatchRunResult, type MatchRunResult } from '@/server/arcade/match-run-results';
import type { GameRewardResult } from '@/server/arcade/rewards/wallet';
import type { BotRecordResult } from '@/server/arcade/pool-elo';
import { isGuestIdentity } from '@/server/auth/guest';
import {
  guestRateLimit,
  isGuestBotMatch,
  isGuestBotMatchFor,
  isPoolGuestPracticeEnabled,
} from '@/server/arcade/pool-guest-practice';

export const dynamic = 'force-dynamic';

/**
 * POST — Trigger the bot's turn(s). Called by the client when it
 * detects the match has the bot's turn (e.g., bot breaks).
 * Returns the bot shot inputs so the client can animate them.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true, allowGuest: isPoolGuestPracticeEnabled() });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  const guest = isGuestIdentity(identity);
  if (guest) {
    const limited = guestRateLimit(request, 'turn');
    if (limited) return limited;
  } else {
    const banResponse = await ensureNotGameBanned(identity.userId);
    if (banResponse) return banResponse;
  }

  const { id: matchId } = await params;
  let currentMatch = await getMatch(matchId);
  // A guest may drive only their own bot match.
  if (guest && (!currentMatch || !isGuestBotMatchFor(currentMatch, identity.userId))) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  if (!currentMatch) {
    return NextResponse.json({ error: 'Match not found.' }, { status: 404 });
  }
  if (currentMatch.status !== 'active') {
    return NextResponse.json({ error: 'Match is not active.' }, { status: 409 });
  }
  if (!isBotUser(currentMatch.currentTurn)) {
    return NextResponse.json({ error: 'Not the bot\'s turn.' }, { status: 409 });
  }
  // Verify the human player is in this match
  if (currentMatch.player1Id !== identity.userId && currentMatch.player2Id !== identity.userId) {
    return NextResponse.json({ error: 'Not a player in this match.' }, { status: 403 });
  }

  const botId = currentMatch.currentTurn;
  const difficultyStr = botId.replace('bot:', '') as BotDifficulty;
  const MAX_BOT_TURNS = 15;

  const botShotInputs: Array<{
    angle: number;
    power: number;
    cuePosition: { x: number; y: number } | null;
    spinX?: number;
    spinY?: number;
  }> = [];

  let lastBotEvaluation: {
    foul: string | null;
    turnContinues: boolean;
    phase: string;
    winnerId: string | null;
    loserId: string | null;
    winReason: string | null;
    nextTurn: string;
    foulState: unknown;
  } | null = null;

  for (let i = 0; i < MAX_BOT_TURNS; i++) {
    currentMatch = await getMatch(matchId);
    if (!currentMatch || currentMatch.phase === 'game_over') break;
    if (currentMatch.currentTurn !== botId) break;

    const botInput = computeBotShot(currentMatch, botId, difficultyStr);
    const botShotResult = simulateShot(currentMatch.balls, botInput);
    const botEval = evaluateShot(currentMatch, botShotResult, botId);
    const moveNumber = currentMatch.moveCount + 1;

    const applied = await updateMatchAfterShot(matchId, moveNumber - 1, {
      balls: botEval.balls,
      currentTurn: botEval.nextTurn,
      phase: botEval.phase,
      player1Group: botEval.player1Group,
      player2Group: botEval.player2Group,
      foulState: botEval.foulState,
      winnerId: botEval.winnerId,
      loserId: botEval.loserId,
      winReason: botEval.winReason,
      moveCount: moveNumber,
      lastShotInputJson: JSON.stringify(botInput),
      ballsBeforeLastShotJson: JSON.stringify(currentMatch.balls),
    });

    if (!applied) break; // CAS failed — another request already processed this turn

    await recordMove({
      matchId,
      playerId: botId,
      moveNumber,
      angle: botInput.angle,
      power: botInput.power,
      cuePosition: botInput.cuePosition,
      pocketedBallIds: botShotResult.pocketedBallIds,
      scratch: botShotResult.scratch,
      firstContactBallId: botShotResult.firstContactBallId,
      railContacts: botShotResult.railContacts,
      foulType: botEval.foul,
      resultJson: JSON.stringify({
        version: 2,
        shotInput: botInput,
        ballsBefore: currentMatch.balls,
        ballsAfter: botEval.balls,
        pocketedBallIds: botShotResult.pocketedBallIds,
        scratch: botShotResult.scratch,
        firstContactBallId: botShotResult.firstContactBallId,
        railContacts: botShotResult.railContacts,
        foulType: botEval.foul,
        totalFrames: botShotResult.totalFrames,
      }),
      // Bot timing is intentionally excluded from speed-run tie-breakers.
      turnDurationMs: 0,
    });

    botShotInputs.push({
      angle: botInput.angle,
      power: botInput.power,
      cuePosition: botInput.cuePosition,
      spinX: botInput.spinX,
      spinY: botInput.spinY,
    });

    lastBotEvaluation = {
      foul: botEval.foul,
      turnContinues: botEval.turnContinues,
      phase: botEval.phase,
      winnerId: botEval.winnerId,
      loserId: botEval.loserId,
      winReason: botEval.winReason,
      nextTurn: botEval.nextTurn,
      foulState: botEval.foulState,
    };

    if (!botEval.turnContinues || botEval.phase === 'game_over') break;
  }

  const finalMatch = await getMatch(matchId);

  // The bot's shot ended the game: the same steps as a game a person ends,
  // where they apply. Bot matches have no stats, Elo or wager; they do pay
  // tickets for a finish, keyed by sourceId like the shot route's, and a
  // guest's practice match pays nothing.
  let reward: GameRewardResult | null = null;
  let runResult: MatchRunResult | null = null;
  let botRecord: BotRecordResult | null = null;
  if (
    !guest &&
    lastBotEvaluation?.phase === 'game_over' &&
    lastBotEvaluation.winnerId &&
    lastBotEvaluation.loserId &&
    finalMatch &&
    !isGuestBotMatch(finalMatch)
  ) {
    const winnerName = lastBotEvaluation.winnerId === finalMatch.player1Id
      ? finalMatch.player1Name
      : (finalMatch.player2Name ?? 'Bot');
    botRecord = await recordBotSpeedRun(finalMatch, lastBotEvaluation.winnerId, winnerName, lastBotEvaluation.winReason);
    const paid = await payPoolMatch(finalMatch, lastBotEvaluation.winnerId, lastBotEvaluation.loserId, lastBotEvaluation.winReason);
    const mine = paid.get(identity.userId);
    if (mine) {
      reward = mine.reward;
      runResult = mine.runResult;
      takeMatchRunResult(matchId, identity.userId);
    }
    broadcast('gameLeaderboards', { gameType: '8-ball', updatedAt: Date.now() });
    broadcast('poolLobby', { type: 'match_ended', matchId });
  }

  return NextResponse.json({
    botShotInputs,
    lastBotEvaluation,
    match: finalMatch,
    // Additive, as on the shot route: the player's payout when the bot's
    // shot ended the game.
    botRecord: botRecord ?? undefined,
    reward: reward
      ? {
          awardedCredits: reward.awardedCredits,
          earnedTodayTotal: reward.earnedTodayTotal,
          capRemaining: reward.capRemaining,
          account: reward.account ?? null,
        }
      : undefined,
    runResult: runResult ?? undefined,
  });
}
