import { NextResponse } from 'next/server';
import { inUserIdOrder, withSettleTransaction } from '@/server/arcade/pool-sql';
import { payPoolMatch, recordBotSpeedRun } from '@/server/arcade/pool-settle';
import { settleMatchWager } from '@/server/arcade/pool-wager';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import {
  simulateShot,
  isValidCuePlacement,
  type ShotInput,
} from '@/features/arcade/lib/pool-physics';
import { ensureNotGameBanned } from '@/app/api/games/_shared/ban-helpers';
import {
  getMatch,
  updateMatchAfterShot,
  recordMove,
  updateStats,
  countPlayerShots,
  estimatePoolTurnDurationMs,
} from '@/server/arcade/pool-match';
import { evaluateShot } from '@/server/arcade/pool-rules';
import {
  isBotUser,
  computeBotShot,
  type BotDifficulty,
} from '@/server/arcade/pool-bot';
import { recordGameTimeMetric } from '@/server/arcade/game-time-metrics';
import { addAntiCheatLog } from '@/server/arcade/anti-cheat-logs';
import { type GameRewardResult } from '@/server/arcade/rewards/wallet';
import { createNotification } from '@/server/services/notifications';
import {
  announcePoolWin,
  processRatedMatch,
  type EloChangeResult,
  type BotRecordResult,
} from '@/server/arcade/pool-elo';
import {
  takeMatchRunResult,
  type MatchRunResult,
} from '@/server/arcade/match-run-results';
import { isGuestIdentity } from '@/server/auth/guest';
import {
  isGuestBotMatch,
  isGuestBotMatchFor,
  isPoolGuestPracticeEnabled,
  guestRateLimit,
} from '@/server/arcade/pool-guest-practice';

export const dynamic = 'force-dynamic';
const POOL_FRAME_DURATION_MS = 1000 / 60;

/** Log a pool-specific rejection to the shared anti-cheat monitoring pipeline. */
function logPoolReject(userId: string, stage: string, reason: string) {
  void addAntiCheatLog({
    ts: Date.now(),
    gameType: '8-ball',
    userId,
    score: 0,
    result: 'reject',
    severity: 'reject',
    reason,
    stage,
    checks: [],
  });
}

type ShotPayload = {
  angle?: number;
  power?: number;
  cuePosition?: { x: number; y: number } | null;
  spinX?: number;
  spinY?: number;
  calledPocket?: number | null;
};

/**
 * POST — Submit a shot. Server runs physics and evaluates rules.
 *
 * A guest (POOL_GUEST_PRACTICE) can shoot only in their own bot match, and
 * that match pays nothing and records nothing beyond the match itself: no
 * tickets, no rating, no stats, no speed-run record, no play time.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true, allowGuest: isPoolGuestPracticeEnabled() });
  } catch {
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401 },
    );
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

  let body: ShotPayload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  // Validate input
  if (typeof body.angle !== 'number' || !Number.isFinite(body.angle)) {
    return NextResponse.json({ error: 'Invalid angle.' }, { status: 400 });
  }
  if (typeof body.power !== 'number' || body.power < 0 || body.power > 1) {
    return NextResponse.json(
      { error: 'Invalid power (must be 0-1).' },
      { status: 400 },
    );
  }

  // Get match
  const match = await getMatch(matchId);
  if (guest && (!match || !isGuestBotMatchFor(match, identity.userId))) {
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401 },
    );
  }
  if (!match) {
    return NextResponse.json({ error: 'Match not found.' }, { status: 404 });
  }
  // Guest practice: the match is played and kept until cleanup, nothing else.
  const guestMatch = isGuestBotMatch(match);

  // Verify it's this player's turn
  if (match.currentTurn !== identity.userId) {
    // Guests write no anti-cheat rows: they have no account to flag.
    if (!guest) {
      logPoolReject(
        identity.userId,
        'turn-check',
        `Shot attempted on someone else's turn (match ${matchId})`,
      );
    }
    return NextResponse.json({ error: 'Not your turn.' }, { status: 403 });
  }

  // Verify match is active
  if (match.status !== 'active' && match.status !== 'waiting') {
    return NextResponse.json(
      { error: 'Match is not in progress.' },
      { status: 409 },
    );
  }

  // For waiting matches, only allow the break (player1 shooting before player2 joins)
  // Actually, we should require player2 to have joined before any shots
  if (match.status === 'waiting') {
    return NextResponse.json(
      { error: 'Waiting for opponent to join.' },
      { status: 409 },
    );
  }

  // Validate cue position for ball-in-hand
  let cuePosition: { x: number; y: number } | null = null;
  if (match.foulState?.ballInHand && body.cuePosition) {
    cuePosition = body.cuePosition;
    if (
      !isValidCuePlacement(cuePosition, match.balls, {
        behindHeadString: match.foulState.behindHeadString,
      })
    ) {
      return NextResponse.json(
        { error: 'Invalid cue ball placement.' },
        { status: 400 },
      );
    }
  } else if (match.foulState?.ballInHand && !body.cuePosition) {
    return NextResponse.json(
      { error: 'Must provide cue ball position (ball-in-hand).' },
      { status: 400 },
    );
  }

  // Build shot input
  // Clamp spin to valid range
  const shotSpinX = Math.max(-1, Math.min(1, body.spinX ?? 0));
  const shotSpinY = Math.max(-1, Math.min(1, body.spinY ?? 0));

  const shotInput: ShotInput = {
    angle: body.angle,
    power: body.power,
    cuePosition,
    spinX: shotSpinX,
    spinY: shotSpinY,
  };

  // Run physics simulation (server-authoritative)
  const shotResult = simulateShot(match.balls, shotInput);

  // Validate calledPocket for hardcore mode
  const calledPocket =
    match.hardcoreMode && match.phase !== 'break'
      ? typeof body.calledPocket === 'number' &&
        body.calledPocket >= 0 &&
        body.calledPocket <= 5
        ? body.calledPocket
        : null
      : null;

  // Evaluate game rules
  const evaluation = evaluateShot(
    match,
    shotResult,
    identity.userId,
    calledPocket,
  );

  // Update match state with compare-and-swap on moveCount FIRST.
  // Only record the move if the CAS succeeds — prevents duplicate move
  // history from concurrent requests.
  const moveNumber = match.moveCount + 1;
  const matchUpdate = {
    balls: evaluation.balls,
    currentTurn: evaluation.nextTurn,
    phase: evaluation.phase,
    player1Group: evaluation.player1Group,
    player2Group: evaluation.player2Group,
    foulState: evaluation.foulState,
    winnerId: evaluation.winnerId,
    loserId: evaluation.loserId,
    winReason: evaluation.winReason,
    moveCount: moveNumber,
    lastShotInputJson: JSON.stringify(shotInput),
    ballsBeforeLastShotJson: JSON.stringify(match.balls),
  };

  // Record only the active turn duration for this human shot.
  const shotRecordedAtMs = Date.now();
  const measuredTurnMs = estimatePoolTurnDurationMs({
    turnStartedAt: match.turnStartedAt,
    endedAtMs: shotRecordedAtMs,
  });
  const simulatedShotMs = Math.max(
    0,
    Math.round(shotResult.totalFrames * POOL_FRAME_DURATION_MS),
  );
  const activeShotDurationMs = Math.max(measuredTurnMs, simulatedShotMs);
  const moveRecord = {
    matchId,
    playerId: identity.userId,
    moveNumber,
    angle: body.angle,
    power: body.power,
    cuePosition,
    pocketedBallIds: shotResult.pocketedBallIds,
    scratch: shotResult.scratch,
    firstContactBallId: shotResult.firstContactBallId,
    railContacts: shotResult.railContacts,
    foulType: evaluation.foul,
    resultJson: JSON.stringify({
      version: 2,
      shotInput,
      ballsBefore: match.balls,
      ballsAfter: evaluation.balls,
      pocketedBallIds: shotResult.pocketedBallIds,
      scratch: shotResult.scratch,
      firstContactBallId: shotResult.firstContactBallId,
      railContacts: shotResult.railContacts,
      foulType: evaluation.foul,
      totalFrames: shotResult.totalFrames,
    }),
    turnDurationMs: activeShotDurationMs,
  };

  // Track Elo / bot record results for response
  let eloChange: EloChangeResult | null = null;
  let botRecord: BotRecordResult | null = null;
  let reward: GameRewardResult | null = null;
  let runResult: MatchRunResult | null = null;

  const endsMatch = Boolean(
    !guestMatch &&
    evaluation.phase === 'game_over' &&
    evaluation.winnerId &&
    evaluation.loserId,
  );
  const isHumanMatch = Boolean(
    !isBotUser(match.player1Id) &&
    match.player2Id &&
    !isBotUser(match.player2Id),
  );
  const winnerName = evaluation.winnerId === match.player1Id ? match.player1Name : (match.player2Name ?? '');
  const loserName = evaluation.loserId === match.player1Id ? match.player1Name : (match.player2Name ?? '');
  const pocketedIn = (group: 'solids' | 'stripes' | null) =>
    group
      ? evaluation.balls.filter(
          (b) =>
            b.pocketed &&
            ((group === 'solids' && b.id >= 1 && b.id <= 7) ||
              (group === 'stripes' && b.id >= 9 && b.id <= 15)),
        ).length
      : 0;

  let applied: boolean;
  if (endsMatch && (isHumanMatch || (match.wagerAmount && match.wagerStatus === 'held'))) {
    // Settle once: the result, the move, both players' stats, the Elo change
    // and the wager commit together or not at all, on the same row lock the
    // compare-and-swap takes. A forfeit that lands first leaves the row not
    // active, the swap matches nothing, and nothing here runs.
    let settled: { change: EloChangeResult | null } | null;
    try {
      settled = await withSettleTransaction(async (client) => {
        if (!(await updateMatchAfterShot(matchId, moveNumber - 1, matchUpdate, client))) {
          return null;
        }
        await recordMove(moveRecord, client);
        let change: EloChangeResult | null = null;
        if (isHumanMatch) {
          const winnerId = evaluation.winnerId!;
          const loserId = evaluation.loserId!;
          const winnerGroup = match.player1Id === winnerId ? evaluation.player1Group : evaluation.player2Group;
          const loserGroup = match.player1Id === loserId ? evaluation.player1Group : evaluation.player2Group;
          // Per-player shot counts from recorded moves, this shot included.
          const winnerShots = await countPlayerShots(matchId, winnerId, client);
          const loserShots = await countPlayerShots(matchId, loserId, client);
          // Both players' rows, always in user-id order.
          const [first, second] = inUserIdOrder(
            { id: winnerId, name: winnerName, result: 'win' as const, shots: winnerShots, balls: pocketedIn(winnerGroup) },
            { id: loserId, name: loserName, result: 'loss' as const, shots: loserShots, balls: pocketedIn(loserGroup) },
          );
          await updateStats(first.id, first.name, first.result, { shots: first.shots, ballsPocketed: first.balls }, client);
          await updateStats(second.id, second.name, second.result, { shots: second.shots, ballsPocketed: second.balls }, client);
          change = await processRatedMatch(matchId, winnerId, loserId, winnerName, loserName, client);
        }
        if (match.wagerAmount && match.wagerAmount > 0 && match.wagerStatus === 'held') {
          await settleMatchWager(matchId, evaluation.winnerId!, match.wagerAmount, client);
        }
        return { change };
      });
    } catch (error) {
      // Retried once already for a deadlock; nothing was saved.
      console.error(`8-ball game-ending shot failed to settle on match ${matchId}`, error);
      return NextResponse.json(
        { error: 'The shot could not be saved. Try it again.' },
        { status: 500 },
      );
    }
    applied = settled !== null;
    eloChange = settled?.change ?? null;
  } else {
    applied = await updateMatchAfterShot(matchId, moveNumber - 1, matchUpdate);
    // CAS succeeded — now record the move in history (safe from duplicates)
    if (applied) await recordMove(moveRecord);
  }

  if (!applied) {
    if (!guest) {
      logPoolReject(
        identity.userId,
        'concurrent-shot',
        `Duplicate shot submission on match ${matchId} move ${moveNumber}`,
      );
    }
    return NextResponse.json(
      { error: 'Shot was already processed (concurrent request).' },
      { status: 409 },
    );
  }

  if (!guestMatch) {
    await recordGameTimeMetric({
      userId: identity.userId,
      gameType: '8-ball',
      durationMs: activeShotDurationMs,
      playedAtMs: shotRecordedAtMs,
    });
  }

  // Game over: the parts that are safe to repeat run after the result has
  // committed. Tickets are keyed by sourceId; the bot record keeps the best.
  if (endsMatch && evaluation.winnerId && evaluation.loserId) {
    // A rated win shows in the winner's feed, now that it has committed.
    if (isHumanMatch) announcePoolWin(evaluation.winnerId);
    botRecord = await recordBotSpeedRun(match, evaluation.winnerId, winnerName, evaluation.winReason);
    // Tickets for both players, each in its own try. The shooter gets their
    // strip from this response; the other player reads it from their next
    // match poll.
    const paid = await payPoolMatch(match, evaluation.winnerId, evaluation.loserId, evaluation.winReason);
    const mine = paid.get(identity.userId);
    if (mine) {
      reward = mine.reward;
      runResult = mine.runResult;
      takeMatchRunResult(matchId, identity.userId);
    }

    broadcast('gameLeaderboards', {
      gameType: '8-ball',
      updatedAt: Date.now(),
    });
    broadcast('poolLobby', { type: 'match_ended', matchId });

    // Tournament bracket progression
    if (match.tournamentMatchId) {
      try {
        const { onPoolMatchCompleted } =
          await import('@/server/arcade/pool-tournament');
        await onPoolMatchCompleted(matchId);
      } catch {
        /* tournament progression error should not fail the shot */
      }
    }
  }

  // Broadcast shot to opponent + spectators. Dual-fire to a global
  // `poolMatch` channel alongside the per-match channel so the SSE stream
  // route (which only forwards fixed channel names) actually delivers the
  // event — without this, spectators waited up to the 3s polling interval
  // to see any shot land, and the final 8-ball sink frequently missed its
  // animation window entirely. Mirrors the `chessMatch` pattern.
  if (!guestMatch) broadcast([`pool:${matchId}`, 'poolMatch'], {
    matchId,
    type: 'shot_taken',
    playerId: identity.userId,
    moveNumber,
    shotInput,
    pocketedBallIds: shotResult.pocketedBallIds,
    scratch: shotResult.scratch,
    foul: evaluation.foul,
    turnContinues: evaluation.turnContinues,
    gameOver: evaluation.phase === 'game_over',
    winnerId: evaluation.winnerId,
  });

  // Human-vs-human only: notify opponent when turn passes to them.
  const player2Id = match.player2Id;
  const isHumanPair =
    player2Id !== null && !isBotUser(match.player1Id) && !isBotUser(player2Id);
  const isValidTurnRecipient =
    evaluation.nextTurn === match.player1Id ||
    (player2Id !== null && evaluation.nextTurn === player2Id);
  if (
    isHumanPair &&
    evaluation.phase !== 'game_over' &&
    isValidTurnRecipient &&
    evaluation.nextTurn !== identity.userId
  ) {
    const shooterName =
      match.player1Id === identity.userId
        ? match.player1Name
        : (match.player2Name ?? 'Your opponent');
    try {
      await createNotification({
        userId: evaluation.nextTurn,
        type: 'game_turn',
        title: 'Your shot in 8-ball',
        body: `${shooterName} took their shot.`,
        href: `/8-ball/${matchId}`,
        preferenceKey: 'game_notifications',
      });
    } catch {
      // Do not block shot resolution if notification creation fails.
    }
  }

  // --- Bot auto-play ---
  // Run bot shots server-side, collect their shot inputs so the client
  // can animate them with client-side physics for smooth 60fps.
  const botShotInputs: Array<{
    angle: number;
    power: number;
    cuePosition: { x: number; y: number } | null;
    spinX?: number;
    spinY?: number;
  }> = [];
  const botShots: Array<{
    shotResult: {
      pocketedBallIds: number[];
      scratch: boolean;
      firstContactBallId: number | null;
      totalFrames: number;
    };
    evaluation: {
      foul: string | null;
      turnContinues: boolean;
      player1Group: string | null;
      player2Group: string | null;
      phase: string;
      winnerId: string | null;
      loserId: string | null;
      winReason: string | null;
      nextTurn: string;
      foulState: typeof evaluation.foulState;
    };
  }> = [];

  let currentMatch = await getMatch(matchId);
  if (
    currentMatch &&
    isBotUser(evaluation.nextTurn) &&
    evaluation.phase !== 'game_over'
  ) {
    // Determine bot difficulty from the bot user ID
    const botId = evaluation.nextTurn;
    const difficultyStr = botId.replace('bot:', '') as BotDifficulty;
    const MAX_BOT_TURNS = 15; // safety cap

    for (let i = 0; i < MAX_BOT_TURNS; i++) {
      currentMatch = await getMatch(matchId);
      if (!currentMatch || currentMatch.phase === 'game_over') break;
      if (currentMatch.currentTurn !== botId) break;

      const botInput = computeBotShot(currentMatch, botId, difficultyStr);
      const botShotResult = simulateShot(currentMatch.balls, botInput);
      const botEval = evaluateShot(currentMatch, botShotResult, botId);
      const botMoveNumber = currentMatch.moveCount + 1;

      // CAS first, then record — same pattern as the human shot path
      const botApplied = await updateMatchAfterShot(matchId, botMoveNumber - 1, {
        balls: botEval.balls,
        currentTurn: botEval.nextTurn,
        phase: botEval.phase,
        player1Group: botEval.player1Group,
        player2Group: botEval.player2Group,
        foulState: botEval.foulState,
        winnerId: botEval.winnerId,
        loserId: botEval.loserId,
        winReason: botEval.winReason,
        moveCount: botMoveNumber,
        lastShotInputJson: JSON.stringify(botInput),
        ballsBeforeLastShotJson: JSON.stringify(currentMatch.balls),
      });

      if (!botApplied) break; // CAS failed — concurrent request already advanced

      await recordMove({
        matchId,
        playerId: botId,
        moveNumber: botMoveNumber,
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

      if (
        !guestMatch &&
        botEval.phase === 'game_over' &&
        botEval.winnerId &&
        botEval.loserId
      ) {
        const wName =
          currentMatch.player1Id === botEval.winnerId
            ? currentMatch.player1Name
            : (currentMatch.player2Name ?? 'Bot');
        // Bot matches do NOT update poolStats (wins/losses are human-vs-human only)
        botRecord = await recordBotSpeedRun(currentMatch, botEval.winnerId, wName, botEval.winReason);
        const paid = await payPoolMatch(currentMatch, botEval.winnerId, botEval.loserId, botEval.winReason);
        const mine = paid.get(identity.userId);
        if (mine) {
          reward = mine.reward;
          runResult = mine.runResult;
          takeMatchRunResult(matchId, identity.userId);
        }

        broadcast('gameLeaderboards', {
          gameType: '8-ball',
          updatedAt: Date.now(),
        });
      }

      botShotInputs.push({
        angle: botInput.angle,
        power: botInput.power,
        cuePosition: botInput.cuePosition,
        spinX: botInput.spinX,
        spinY: botInput.spinY,
      });
      botShots.push({
        shotResult: {
          pocketedBallIds: botShotResult.pocketedBallIds,
          scratch: botShotResult.scratch,
          firstContactBallId: botShotResult.firstContactBallId,
          totalFrames: botShotResult.totalFrames,
        },
        evaluation: {
          foul: botEval.foul,
          turnContinues: botEval.turnContinues,
          player1Group: botEval.player1Group,
          player2Group: botEval.player2Group,
          phase: botEval.phase,
          winnerId: botEval.winnerId,
          loserId: botEval.loserId,
          winReason: botEval.winReason,
          nextTurn: botEval.nextTurn,
          foulState: botEval.foulState,
        },
      });

      // If bot's turn continues (potted a ball), loop again
      if (!botEval.turnContinues || botEval.phase === 'game_over') break;
    }
  }

  // Return result — no frame data (client runs physics locally for smooth animation)
  return NextResponse.json({
    shotResult: {
      pocketedBallIds: shotResult.pocketedBallIds,
      scratch: shotResult.scratch,
      firstContactBallId: shotResult.firstContactBallId,
    },
    evaluation: {
      foul: evaluation.foul,
      turnContinues: evaluation.turnContinues,
      player1Group: evaluation.player1Group,
      player2Group: evaluation.player2Group,
      phase: evaluation.phase,
      winnerId: evaluation.winnerId,
      loserId: evaluation.loserId,
      winReason: evaluation.winReason,
      nextTurn: evaluation.nextTurn,
      foulState: evaluation.foulState,
    },
    botShotInputs: botShotInputs.length > 0 ? botShotInputs : undefined,
    // Send the last bot shot's evaluation so the client can show appropriate
    // feedback (e.g., bot foul → ball-in-hand for human)
    lastBotEvaluation:
      botShots.length > 0
        ? botShots[botShots.length - 1].evaluation
        : undefined,
    match: await getMatch(matchId),
    eloChange: eloChange ?? undefined,
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
