import { NextResponse } from "next/server";
import { requireIdentity } from "@/server/auth";
import {
  validateArcadeToken,
  getArcadeSession,
  recordArcadeChoice,
  recordFirstArcadeChoice,
  settleArcadeSession,
  addArcadeWagerHold,
  TicketsShortError,
} from "@/server/arcade/arcade-session";
import {
  generateMinePositions,
  revealTile,
  computeMinesPayout,
} from "@/server/arcade/wager-games/mines";
import {
  computeCoinFlipPayout,
  resolveCoinFlip,
  type CoinFlipSide,
} from "@/server/arcade/wager-games/coin-flip";
import {
  validateCashout,
  computeCrashPayout,
  getCrashPoint,
  getMultiplierAtTime,
  getTimeForMultiplier,
} from "@/server/arcade/wager-games/crash";
import {
  advanceChickenLane,
  computeChickenPayout,
  generateChickenLanes,
} from "@/server/arcade/wager-games/chicken";
import {
  resolveHiLoNextGuess,
  computeHiLoPayout,
  replayHiLoRound,
  drawHiLoCard,
  type HiLoChoice,
} from "@/server/arcade/wager-games/hilo";
import {
  type ChickenDifficulty,
  type HiLoGuess,
  type LightspeedLane,
  HILO_MAX_CHAIN,
  CHICKEN_DIFFICULTIES,
  LIGHTSPEED_WAYPOINTS,
} from "@/server/arcade/arcade-constants";
import {
  generateLightspeedJumps,
  advanceLightspeedJump,
  computeLightspeedPayout,
  type LightspeedChoice,
} from "@/server/arcade/wager-games/lightspeed";
import {
  replayBlackjackRound,
  computeBlackjackPayout,
  serializeForClient as serializeBlackjack,
  legalActionsForState as blackjackLegalActions,
  totalWagered as blackjackTotalWagered,
  type BlackjackAction,
} from "@/server/arcade/wager-games/blackjack";
import { recordGameTimeMetric } from "@/server/arcade/game-time-metrics";
import {
  generateDragonRows,
  advanceDragonStep,
  replayDragonRound,
  computeDragonPayout,
  getDragonCumulativeMultiplier,
  DRAGON_ROWS,
  DRAGON_DIFFICULTIES,
  type DragonChoice,
  type DragonDifficulty,
} from "@/server/arcade/wager-games/dragon";
import {
  dealVideoPoker,
  drawVideoPoker,
  evaluateJacksOrBetter,
  computeVideoPokerPayout,
  getVideoPokerPayoutMultiplier,
  normalizeHolds,
  type VideoPokerChoice,
} from "@/server/arcade/wager-games/video-poker";
import {
  advancePumpStep,
  replayPumpRound,
  computePumpPayout,
  PUMP_DIFFICULTIES,
  PUMP_MAX_PUMPS,
  type PumpChoice,
  type PumpDifficulty,
} from "@/server/arcade/wager-games/pump";
import {
  computePrizeClawPayout,
  playPrizeClawDrop,
  readPrizeClawChoice,
  type PrizeClawRound,
} from "@/server/arcade/wager-games/prize-claw";
import { addAntiCheatLog } from "@/server/arcade/anti-cheat-logs";

export const dynamic = "force-dynamic";

type ActionPayload = {
  token?: string;
  action?: string;
  data?: Record<string, unknown>;
  /** Crash cashout: the multiplier the client locked in at trigger time. */
  targetMultiplier?: number;
};

export async function POST(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true, allowGuest: true });
  } catch {
    return NextResponse.json(
      { error: "Sign in to play for tickets." },
      { status: 401 },
    );
  }

  const userName = identity.name || "Anonymous";

  let payload: ActionPayload;
  try {
    payload = (await request.json()) as ActionPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { token, action, data } = payload;
  if (!token || !action) {
    return NextResponse.json(
      { error: "Token and action are required." },
      { status: 400 },
    );
  }

  const tokenResult = validateArcadeToken(token);
  if (!tokenResult.valid || tokenResult.userId !== identity.userId) {
    return NextResponse.json(
      { error: "Invalid session token." },
      { status: 400 },
    );
  }

  const session = await getArcadeSession(
    tokenResult.sessionId!,
    identity.userId,
  );
  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  // ----- Prize Claw: idempotent replay of an already-settled drop -----
  // A 3.5-5.6s drop animation can be interrupted by a tab switch or a flaky
  // mobile connection, and the client retries the SAME {x, z}. The payout was
  // already banked by settleArcadeSession — whose `arcade_settled_at IS NULL`
  // guard makes a second payment impossible — so all the client needs back is
  // the outcome. Recompute it deterministically from the stored seed and the
  // stored commit point and return it, without touching the wallet. This runs
  // BEFORE the generic already-settled rejection below on purpose.
  if (
    session.gameType === "arcade-prize-claw" &&
    action === "drop" &&
    session.settledAt &&
    session.choices.length > 0
  ) {
    const choice =
      session.choices.length === 1
        ? readPrizeClawChoice(session.choices[0])
        : null;
    const round = choice
      ? playPrizeClawDrop(session.config, session.seed, choice.x, choice.z)
      : null;
    if (!round) {
      return NextResponse.json(
        { error: "Invalid Prize Claw session config." },
        { status: 400 },
      );
    }
    return NextResponse.json({
      ...serializePrizeClawRound(round),
      payout: session.payout ?? 0,
      seed: session.seed,
      roundId: null,
      replayed: true,
      achievements: [],
    });
  }

  if (session.settledAt) {
    return NextResponse.json(
      { error: "Session already settled." },
      { status: 400 },
    );
  }

  // ----- Coin Flip: resolve one wagered flip -----
  if (session.gameType === "arcade-coin-flip" && action === "flip") {
    const rawSide = data?.side;
    if (rawSide !== "heads" && rawSide !== "tails") {
      return NextResponse.json(
        { error: "Pick heads or tails." },
        { status: 400 },
      );
    }
    if (session.choices.length > 0) {
      return NextResponse.json(
        { error: "Session already played." },
        { status: 400 },
      );
    }

    const pickedSide = rawSide as CoinFlipSide;
    await recordArcadeChoice(session.sessionId, identity.userId, pickedSide);

    const result = resolveCoinFlip(session.seed, pickedSide);
    const payout = computeCoinFlipPayout(session.wager, result, session.seed);
    const settled = await settleArcadeSession(
      session.sessionId,
      identity.userId,
      payout,
      result.multiplier,
      JSON.stringify({
        pickedSide: result.pickedSide,
        result: result.result,
        won: result.won,
      }),
      userName,
    );

    return NextResponse.json({
      result: result.result,
      pickedSide: result.pickedSide,
      won: result.won,
      payout: settled.payout,
      multiplier: result.multiplier,
      seed: settled.seed,
      roundId: settled.roundId,
      achievements: settled.achievements,
    });
  }

  // ----- Mines: reveal tile -----
  if (session.gameType === "arcade-mines" && action === "reveal") {
    const tile = data?.tile;
    if (typeof tile !== "number" || tile < 0 || tile >= 25) {
      return NextResponse.json(
        { error: "Invalid tile index." },
        { status: 400 },
      );
    }

    const mineCount = (session.config as { mineCount?: number }).mineCount ?? 5;
    const minePositions = generateMinePositions(session.seed, mineCount);
    const previouslyRevealed = (session.choices as number[]) ?? [];

    if (previouslyRevealed.includes(tile)) {
      return NextResponse.json(
        { error: "Tile already revealed." },
        { status: 400 },
      );
    }

    const result = revealTile(
      minePositions,
      previouslyRevealed,
      tile,
      mineCount,
    );
    await recordArcadeChoice(session.sessionId, identity.userId, tile);

    if (!result.safe) {
      // Hit a mine — auto-settle as loss
      const settled = await settleArcadeSession(
        session.sessionId,
        identity.userId,
        0,
        0,
        JSON.stringify({ minePositions, hitTile: tile }),
        userName,
      );
      return NextResponse.json({
        safe: false,
        minePositions,
        payout: 0,
        seed: settled.seed,
        roundId: settled.roundId,
        achievements: settled.achievements,
      });
    }

    if (result.allSafeRevealed) {
      // All safe tiles revealed — auto-settle as max win
      const payout = computeMinesPayout(
        session.wager,
        result.tilesRevealed,
        mineCount,
        session.seed,
      );
      const settled = await settleArcadeSession(
        session.sessionId,
        identity.userId,
        payout,
        result.currentMultiplier,
        JSON.stringify({ minePositions, allRevealed: true }),
        userName,
      );
      return NextResponse.json({
        safe: true,
        allRevealed: true,
        currentMultiplier: result.currentMultiplier,
        tilesRevealed: result.tilesRevealed,
        payout: settled.payout,
        seed: settled.seed,
        roundId: settled.roundId,
        achievements: settled.achievements,
      });
    }

    return NextResponse.json({
      safe: true,
      currentMultiplier: result.currentMultiplier,
      tilesRevealed: result.tilesRevealed,
    });
  }

  // ----- Crash: cashout -----
  if (session.gameType === "arcade-crash" && action === "cashout") {
    const crashPoint = getCrashPoint(session.seed);
    const now = Date.now();
    // The client passes its locked-in multiplier (auto-cashout target or
    // displayed multiplier at the moment the user tapped). Using it instead
    // of the server's current multiplier means latency between trigger and
    // server-receipt no longer pushes the cashout above the user's target.
    const clientTarget =
      typeof payload.targetMultiplier === "number"
        ? payload.targetMultiplier
        : undefined;
    const result = validateCashout(
      crashPoint,
      session.startedAt,
      now,
      clientTarget,
    );

    if (result.success) {
      const payout = computeCrashPayout(
        session.wager,
        result.multiplier,
        session.seed,
      );
      await recordArcadeChoice(session.sessionId, identity.userId, {
        action: "cashout",
        multiplier: result.multiplier,
        ts: now,
      });
      const settled = await settleArcadeSession(
        session.sessionId,
        identity.userId,
        payout,
        result.multiplier,
        JSON.stringify({
          crashPoint,
          cashedOutAt: result.multiplier,
          target: clientTarget,
        }),
        userName,
      );
      return NextResponse.json({
        cashedOut: true,
        multiplier: result.multiplier,
        crashPoint,
        payout: settled.payout,
        seed: settled.seed,
        roundId: settled.roundId,
        achievements: settled.achievements,
      });
    }

    // Cashout failed: either the round already crashed (`too-late`) or the
    // client supplied an implausibly high target (`too-high`). Either way
    // the player loses the wager. We tag the outcome so the audit log can
    // distinguish a real crash from a rejected cheat attempt.
    const settled = await settleArcadeSession(
      session.sessionId,
      identity.userId,
      0,
      0,
      JSON.stringify({
        crashPoint,
        reason: result.reason ?? "too-late",
        target: clientTarget,
      }),
      userName,
    );
    return NextResponse.json({
      cashedOut: false,
      crashPoint,
      payout: 0,
      seed: settled.seed,
      roundId: settled.roundId,
      achievements: settled.achievements,
    });
  }

  // ----- Crash: tick (poll for crash state) -----
  if (session.gameType === "arcade-crash" && action === "tick") {
    const crashPoint = getCrashPoint(session.seed);
    const crashTimeMs = getTimeForMultiplier(crashPoint);
    const now = Date.now();
    const elapsedMs = now - session.startedAt;

    if (elapsedMs >= crashTimeMs) {
      // Crashed — auto-settle as loss
      const settled = await settleArcadeSession(
        session.sessionId,
        identity.userId,
        0,
        0,
        JSON.stringify({ crashPoint, autoSettled: true }),
        userName,
      );
      return NextResponse.json({
        status: "crashed",
        crashPoint,
        multiplier: getMultiplierAtTime(elapsedMs),
        payout: 0,
        seed: settled.seed,
        roundId: settled.roundId,
        achievements: settled.achievements,
      });
    }

    // Still flying
    return NextResponse.json({
      status: "flying",
      multiplier: getMultiplierAtTime(elapsedMs),
      elapsed: elapsedMs,
    });
  }

  // ----- Chicken: advance one lane -----
  if (session.gameType === "arcade-chicken" && action === "advance") {
    const rawDifficulty = (session.config as { difficulty?: string })
      .difficulty;
    if (
      typeof rawDifficulty !== "string" ||
      !(CHICKEN_DIFFICULTIES as readonly string[]).includes(rawDifficulty)
    ) {
      return NextResponse.json(
        { error: "Invalid chicken session config." },
        { status: 400 },
      );
    }
    const difficulty = rawDifficulty as ChickenDifficulty;
    const lanes = generateChickenLanes(session.seed, difficulty);
    const lanesAlreadyCrossed = (session.choices as number[]).length;
    if (lanesAlreadyCrossed >= lanes.length) {
      return NextResponse.json(
        { error: "All lanes already crossed." },
        { status: 400 },
      );
    }

    const result = advanceChickenLane(lanes, lanesAlreadyCrossed, difficulty);
    await recordArcadeChoice(
      session.sessionId,
      identity.userId,
      result.laneIndex,
    );

    if (!result.alive) {
      const settled = await settleArcadeSession(
        session.sessionId,
        identity.userId,
        0,
        0,
        JSON.stringify({ lanes, diedAt: result.laneIndex, difficulty }),
        userName,
      );
      return NextResponse.json({
        alive: false,
        laneIndex: result.laneIndex,
        lanesCrossed: result.lanesCrossed,
        currentMultiplier: 0,
        lanes,
        payout: 0,
        seed: settled.seed,
        roundId: settled.roundId,
        achievements: settled.achievements,
      });
    }

    if (result.allLanesCrossed) {
      const payout = computeChickenPayout(
        session.wager,
        result.lanesCrossed,
        difficulty,
        session.seed,
      );
      const settled = await settleArcadeSession(
        session.sessionId,
        identity.userId,
        payout,
        result.currentMultiplier,
        JSON.stringify({
          lanes,
          lanesCrossed: result.lanesCrossed,
          difficulty,
          allLanesCrossed: true,
        }),
        userName,
      );
      return NextResponse.json({
        alive: true,
        allLanesCrossed: true,
        laneIndex: result.laneIndex,
        lanesCrossed: result.lanesCrossed,
        currentMultiplier: result.currentMultiplier,
        payout: settled.payout,
        seed: settled.seed,
        roundId: settled.roundId,
        achievements: settled.achievements,
      });
    }

    return NextResponse.json({
      alive: true,
      laneIndex: result.laneIndex,
      lanesCrossed: result.lanesCrossed,
      currentMultiplier: result.currentMultiplier,
    });
  }

  // ----- Hi-Lo: guess on next card -----
  if (session.gameType === "arcade-hilo" && action === "guess") {
    const rawGuess = payload.data?.guess;
    if (rawGuess !== "higher" && rawGuess !== "lower") {
      return NextResponse.json(
        { error: "Guess must be higher or lower." },
        { status: 400 },
      );
    }
    const guess = rawGuess as HiLoGuess;
    const priorChoices = (session.choices as HiLoChoice[]) ?? [];

    // Defensive: can't continue a busted chain, can't exceed max length.
    const priorState = replayHiLoRound(session.seed, priorChoices);
    if (!priorState.alive) {
      return NextResponse.json(
        { error: "Session already busted." },
        { status: 400 },
      );
    }
    if (priorChoices.length >= HILO_MAX_CHAIN) {
      return NextResponse.json(
        { error: "Chain already at maximum length." },
        { status: 400 },
      );
    }

    const step = resolveHiLoNextGuess(session.seed, priorChoices, guess);
    await recordArcadeChoice(session.sessionId, identity.userId, step.choice);

    if (!step.alive) {
      const settled = await settleArcadeSession(
        session.sessionId,
        identity.userId,
        0,
        0,
        JSON.stringify({
          drawnCard: step.drawnCard,
          previousCard: priorState.currentCard,
          guess,
          result: "lose",
        }),
        userName,
      );
      return NextResponse.json({
        alive: false,
        result: "lose",
        drawnCard: step.drawnCard,
        currentCard: step.currentCardAfter,
        cumulativeMultiplier: 0,
        payout: 0,
        seed: settled.seed,
        roundId: settled.roundId,
        achievements: settled.achievements,
      });
    }

    if (step.chainComplete) {
      const payout = computeHiLoPayout(session.wager, session.seed, [
        ...priorChoices,
        step.choice,
      ]);
      const settled = await settleArcadeSession(
        session.sessionId,
        identity.userId,
        payout,
        step.cumulativeMultiplier,
        JSON.stringify({
          drawnCard: step.drawnCard,
          result: step.choice.result,
          chainComplete: true,
        }),
        userName,
      );
      return NextResponse.json({
        alive: true,
        chainComplete: true,
        result: step.choice.result,
        drawnCard: step.drawnCard,
        currentCard: step.currentCardAfter,
        cumulativeMultiplier: step.cumulativeMultiplier,
        payout: settled.payout,
        seed: settled.seed,
        roundId: settled.roundId,
        achievements: settled.achievements,
      });
    }

    return NextResponse.json({
      alive: true,
      result: step.choice.result,
      drawnCard: step.drawnCard,
      currentCard: step.currentCardAfter,
      cumulativeMultiplier: step.cumulativeMultiplier,
    });
  }

  // ----- Hi-Lo: query starting card (no state change) -----
  if (session.gameType === "arcade-hilo" && action === "peek") {
    const state = replayHiLoRound(
      session.seed,
      (session.choices as HiLoChoice[]) ?? [],
    );
    const startingCard = drawHiLoCard(session.seed, 0);
    return NextResponse.json({
      startingCard,
      currentCard: state.currentCard,
      choices: session.choices,
      cumulativeMultiplier: state.cumulativeMultiplier,
      alive: state.alive,
    });
  }

  // ----- Lightspeed: jump to a lane -----
  if (session.gameType === "arcade-lightspeed" && action === "jump") {
    const lane = (payload.data as { lane?: unknown } | undefined)?.lane;
    if (typeof lane !== "number" || ![0, 1, 2].includes(lane)) {
      return NextResponse.json(
        { error: "Lane must be 0, 1, or 2." },
        { status: 400 },
      );
    }

    const jumps = generateLightspeedJumps(session.seed);
    const previousChoices = (session.choices as LightspeedChoice[]) ?? [];
    const jumpIndex = previousChoices.length;

    if (jumpIndex >= LIGHTSPEED_WAYPOINTS) {
      return NextResponse.json(
        { error: "All waypoints already jumped." },
        { status: 400 },
      );
    }

    const previousFairMults = previousChoices.map((c) => c.fairMult);
    const result = advanceLightspeedJump(
      jumps,
      jumpIndex,
      lane as LightspeedLane,
      previousFairMults,
    );

    const choice: LightspeedChoice = {
      lane: lane as LightspeedLane,
      result: result.alive ? "alive" : "dead",
      fairMult: result.fairMult,
    };
    await recordArcadeChoice(session.sessionId, identity.userId, choice);

    if (!result.alive) {
      const settled = await settleArcadeSession(
        session.sessionId,
        identity.userId,
        0,
        0,
        JSON.stringify({ jumps, diedAt: jumpIndex, lane }),
        userName,
      );
      return NextResponse.json({
        alive: false,
        jumpIndex,
        lane,
        jumpsCompleted: result.jumpsCompleted,
        currentMultiplier: 0,
        payout: 0,
        seed: settled.seed,
        roundId: settled.roundId,
        achievements: settled.achievements,
      });
    }

    if (result.allJumpsCompleted) {
      const allFairMults = [...previousFairMults, result.fairMult];
      const payout = computeLightspeedPayout(
        session.wager,
        allFairMults,
        session.seed,
      );
      const settled = await settleArcadeSession(
        session.sessionId,
        identity.userId,
        payout,
        result.currentMultiplier,
        JSON.stringify({
          jumps,
          choices: [...previousChoices, choice],
          completed: true,
        }),
        userName,
      );
      return NextResponse.json({
        alive: true,
        allJumpsCompleted: true,
        jumpIndex,
        lane,
        jumpsCompleted: result.jumpsCompleted,
        currentMultiplier: result.currentMultiplier,
        payout: settled.payout,
        seed: settled.seed,
        roundId: settled.roundId,
        achievements: settled.achievements,
      });
    }

    return NextResponse.json({
      alive: true,
      jumpIndex,
      lane,
      jumpsCompleted: result.jumpsCompleted,
      currentMultiplier: result.currentMultiplier,
    });
  }

  // ----- Blackjack: deal / hit / stand / double / split / peek -----
  if (session.gameType === "arcade-blackjack") {
    const allowed = [
      "deal",
      "hit",
      "stand",
      "double",
      "split",
      "peek",
    ] as const;
    if (!(allowed as readonly string[]).includes(action)) {
      return NextResponse.json(
        { error: "Unknown blackjack action." },
        { status: 400 },
      );
    }

    // Peek returns state without mutating the round.
    if (action === "peek") {
      const priorActions = (session.choices as BlackjackAction[]) ?? [];
      // `session.wager` is the total committed; the base per-hand bet is
      // the same for every hand, so we re-derive from the initial hold.
      // Before the deal, session.wager == base wager. After a split/double
      // session.wager has grown; base is session.wager / (1 + splits + doubles).
      const baseWager = computeBaseWager(session.wager, priorActions);
      const state = replayBlackjackRound(session.seed, baseWager, priorActions);
      return NextResponse.json({
        ...serializeBlackjack(state),
        legalActions: blackjackLegalActions(state),
      });
    }

    const priorActions = (session.choices as BlackjackAction[]) ?? [];
    const baseWager = computeBaseWager(session.wager, priorActions);

    // Replay prior actions to get the current authoritative state, then
    // validate + apply the new action. If applying it throws (illegal
    // move) we abort without touching the session.
    const priorState = replayBlackjackRound(
      session.seed,
      baseWager,
      priorActions,
    );

    // Route-level guards that depend on prior state.
    if (action === "deal" && priorActions.length > 0) {
      return NextResponse.json(
        { error: "Round already dealt." },
        { status: 400 },
      );
    }
    if (action !== "deal" && priorState.phase !== "playerTurn") {
      return NextResponse.json(
        { error: "Round not in player turn." },
        { status: 400 },
      );
    }

    // For double/split we need to atomically hold the extra wager BEFORE
    // we record the choice — a failed hold (insufficient Tickets) must
    // not mutate the session.
    let newAction: BlackjackAction;
    try {
      if (action === "deal") {
        newAction = { type: "deal" };
      } else if (action === "hit") {
        newAction = { type: "hit" };
      } else if (action === "stand") {
        newAction = { type: "stand" };
      } else if (action === "double") {
        // Validate locally first.
        const hand = priorState.hands[priorState.activeHandIndex];
        if (!hand || hand.cards.length !== 2 || hand.splitAce) {
          return NextResponse.json(
            { error: "Cannot double this hand." },
            { status: 400 },
          );
        }
        try {
          await addArcadeWagerHold(
            session.sessionId,
            identity.userId,
            baseWager,
            `double-${priorActions.length}`,
          );
        } catch (holdErr) {
          const message =
            holdErr instanceof Error
              ? holdErr.message
              : "You do not have the tickets to double.";
          const isInsufficient =
            holdErr instanceof TicketsShortError || message.toLowerCase().includes("insufficient");
          return NextResponse.json(
            { error: message },
            { status: isInsufficient ? 402 : 400 },
          );
        }
        newAction = { type: "double" };
      } else if (action === "split") {
        const hand = priorState.hands[priorState.activeHandIndex];
        if (!hand || hand.cards.length !== 2 || priorState.hands.length >= 4) {
          return NextResponse.json(
            { error: "Cannot split this hand." },
            { status: 400 },
          );
        }
        try {
          await addArcadeWagerHold(
            session.sessionId,
            identity.userId,
            baseWager,
            `split-${priorActions.length}`,
          );
        } catch (holdErr) {
          const message =
            holdErr instanceof Error
              ? holdErr.message
              : "You do not have the tickets to split.";
          const isInsufficient =
            holdErr instanceof TicketsShortError || message.toLowerCase().includes("insufficient");
          return NextResponse.json(
            { error: message },
            { status: isInsufficient ? 402 : 400 },
          );
        }
        newAction = { type: "split" };
      } else {
        return NextResponse.json(
          { error: "Unknown blackjack action." },
          { status: 400 },
        );
      }

      // Replay with the new action appended to verify legality.
      const nextActions = [...priorActions, newAction];
      try {
        replayBlackjackRound(session.seed, baseWager, nextActions);
      } catch (err) {
        // Illegal move. We've already taken a hold for double/split — but
        // the hold is the LAST thing we did, so the session is still in a
        // recoverable state. Best-effort: just surface the error; stale
        // session cleanup will handle abandoned holds. Players can't
        // reach this branch through normal UI flow.
        return NextResponse.json(
          {
            error:
              err instanceof Error ? err.message : "Invalid blackjack action.",
          },
          { status: 400 },
        );
      }

      await recordArcadeChoice(session.sessionId, identity.userId, newAction);

      // Re-read the session because arcade_wager may have changed.
      const updatedSession = await getArcadeSession(
        session.sessionId,
        identity.userId,
      );
      if (!updatedSession) {
        return NextResponse.json(
          { error: "Session vanished." },
          { status: 500 },
        );
      }

      const finalActions = (updatedSession.choices as BlackjackAction[]) ?? [];
      const finalBase = computeBaseWager(updatedSession.wager, finalActions);
      const finalState = replayBlackjackRound(
        updatedSession.seed,
        finalBase,
        finalActions,
      );

      if (finalState.phase === "roundEnd") {
        const payout = computeBlackjackPayout(finalState);
        const committed = blackjackTotalWagered(finalState);
        const multiplier = committed > 0 ? payout / committed : 0;
        const outcomeJson = JSON.stringify({
          hands: finalState.hands.map((h) => ({
            cards: h.cards,
            bet: h.bet,
            outcome: h.outcome,
            value: h.cards.length ? undefined : undefined,
          })),
          dealer: finalState.dealerCards,
          baseWager: finalBase,
        });
        const settled = await settleArcadeSession(
          updatedSession.sessionId,
          identity.userId,
          payout,
          multiplier,
          outcomeJson,
          userName,
        );
        // Additionally record game-time under the specific blackjack bucket
        // so admin pages and profile surface Blackjack time (the generic
        // 'arcade' umbrella bucket is already recorded inside
        // settleArcadeSession).
        await recordGameTimeMetric({
          userId: identity.userId,
          gameType: "arcade-blackjack",
          durationMs: Math.max(0, Date.now() - updatedSession.startedAt),
          playedAtMs: Date.now(),
        });
        return NextResponse.json({
          ...serializeBlackjack(finalState),
          legalActions: [],
          payout: settled.payout,
          multiplier,
          seed: settled.seed,
          roundId: settled.roundId,
          achievements: settled.achievements,
          totalWagered: committed,
        });
      }

      return NextResponse.json({
        ...serializeBlackjack(finalState),
        legalActions: blackjackLegalActions(finalState),
      });
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof Error ? err.message : "Blackjack action failed.",
        },
        { status: 400 },
      );
    }
  }

  // ----- Dragon Tower: climb one row -----
  if (session.gameType === "arcade-dragon" && action === "climb") {
    const rawDifficulty = (session.config as { difficulty?: string })
      .difficulty;
    if (
      typeof rawDifficulty !== "string" ||
      !(DRAGON_DIFFICULTIES as readonly string[]).includes(rawDifficulty)
    ) {
      return NextResponse.json(
        { error: "Invalid dragon session config." },
        { status: 400 },
      );
    }
    const difficulty = rawDifficulty as DragonDifficulty;

    const tile = (payload.data as { tile?: unknown } | undefined)?.tile;
    if (typeof tile !== "number" || !Number.isInteger(tile) || tile < 0) {
      return NextResponse.json({ error: "Invalid tile." }, { status: 400 });
    }

    const rows = generateDragonRows(session.seed, difficulty);
    const priorChoices = (session.choices as DragonChoice[]) ?? [];
    const rowIndex = priorChoices.length;
    if (rowIndex >= DRAGON_ROWS) {
      return NextResponse.json(
        { error: "Tower already cleared." },
        { status: 400 },
      );
    }

    // Defensive: replay to confirm the climb is still alive.
    const priorState = replayDragonRound(
      session.seed,
      priorChoices,
      difficulty,
    );
    if (!priorState.alive) {
      return NextResponse.json(
        { error: "Session already busted." },
        { status: 400 },
      );
    }

    let step;
    try {
      step = advanceDragonStep(
        rows,
        rowIndex,
        tile,
        difficulty,
        priorChoices.map((c) => c.fairMult),
      );
    } catch {
      return NextResponse.json({ error: "Invalid tile." }, { status: 400 });
    }

    const choice: DragonChoice = {
      tile,
      result: step.alive ? "alive" : "dead",
      fairMult: step.fairMult,
    };
    await recordArcadeChoice(session.sessionId, identity.userId, choice);

    if (!step.alive) {
      const settled = await settleArcadeSession(
        session.sessionId,
        identity.userId,
        0,
        0,
        JSON.stringify({ rows, diedAt: rowIndex, tile, difficulty }),
        userName,
      );
      return NextResponse.json({
        alive: false,
        currentMultiplier: 0,
        payout: 0,
        rows,
        seed: settled.seed,
        roundId: settled.roundId,
        achievements: settled.achievements,
      });
    }

    if (step.allRowsCompleted) {
      const allFairMults = [
        ...priorChoices.map((c) => c.fairMult),
        step.fairMult,
      ];
      const payout = computeDragonPayout(
        session.wager,
        allFairMults,
        session.seed,
      );
      const settled = await settleArcadeSession(
        session.sessionId,
        identity.userId,
        payout,
        step.currentMultiplier,
        JSON.stringify({
          rows,
          rowsClimbed: step.rowsClimbed,
          difficulty,
          completed: true,
        }),
        userName,
      );
      return NextResponse.json({
        alive: true,
        completed: true,
        currentMultiplier: step.currentMultiplier,
        payout: settled.payout,
        rows,
        seed: settled.seed,
        roundId: settled.roundId,
        achievements: settled.achievements,
      });
    }

    return NextResponse.json({
      alive: true,
      currentMultiplier: step.currentMultiplier,
      rowsClimbed: step.rowsClimbed,
    });
  }

  // ----- Dragon Tower: peek current progress (no state change, no seed) -----
  if (session.gameType === "arcade-dragon" && action === "peek") {
    const rawDifficulty = (session.config as { difficulty?: string })
      .difficulty;
    if (
      typeof rawDifficulty !== "string" ||
      !(DRAGON_DIFFICULTIES as readonly string[]).includes(rawDifficulty)
    ) {
      return NextResponse.json(
        { error: "Invalid dragon session config." },
        { status: 400 },
      );
    }
    const difficulty = rawDifficulty as DragonDifficulty;
    const state = replayDragonRound(
      session.seed,
      (session.choices as DragonChoice[]) ?? [],
      difficulty,
    );
    return NextResponse.json({
      alive: state.alive,
      rowsClimbed: state.rowsClimbed,
      currentMultiplier: getDragonCumulativeMultiplier(
        state.fairStepMultipliers,
      ),
    });
  }

  // ----- Video Poker: deal the initial 5 cards (no state change, no seed) -----
  if (session.gameType === "arcade-video-poker" && action === "peek") {
    if (session.choices.length > 0) {
      return NextResponse.json(
        { error: "Hand already drawn." },
        { status: 400 },
      );
    }
    const hand = dealVideoPoker(session.seed);
    return NextResponse.json({ hand });
  }

  // ----- Video Poker: draw (terminal — evaluate + settle, reveals seed) -----
  if (session.gameType === "arcade-video-poker" && action === "draw") {
    if (session.choices.length > 0) {
      return NextResponse.json(
        { error: "Hand already resolved." },
        { status: 400 },
      );
    }
    const holds = normalizeHolds(
      (payload.data as { holds?: unknown } | undefined)?.holds,
    );
    if (!holds) {
      return NextResponse.json(
        { error: "holds must be an array of 5 booleans." },
        { status: 400 },
      );
    }
    const finalHand = drawVideoPoker(session.seed, holds);
    const rank = evaluateJacksOrBetter(finalHand);
    const payoutMult = getVideoPokerPayoutMultiplier(rank);
    const payout = computeVideoPokerPayout(session.wager, rank, session.seed);
    const choice: VideoPokerChoice = { holds, rank, payoutMult };
    await recordArcadeChoice(session.sessionId, identity.userId, choice);
    const settled = await settleArcadeSession(
      session.sessionId,
      identity.userId,
      payout,
      payoutMult,
      JSON.stringify({ finalHand, rank, holds }),
      userName,
    );
    return NextResponse.json({
      finalHand,
      rank,
      payoutMult,
      multiplier: payoutMult,
      payout: settled.payout,
      seed: settled.seed,
      roundId: settled.roundId,
      achievements: settled.achievements,
    });
  }

  // ----- Pump: query current inflated state (no state change) -----
  if (session.gameType === "arcade-pump" && action === "peek") {
    const rawDifficulty = (session.config as { difficulty?: string })
      .difficulty;
    if (
      typeof rawDifficulty !== "string" ||
      !(PUMP_DIFFICULTIES as readonly string[]).includes(rawDifficulty)
    ) {
      return NextResponse.json(
        { error: "Invalid pump session config." },
        { status: 400 },
      );
    }
    const difficulty = rawDifficulty as PumpDifficulty;
    const state = replayPumpRound(
      session.seed,
      (session.choices as PumpChoice[]) ?? [],
      difficulty,
    );
    return NextResponse.json({
      alive: state.alive,
      pumpsCompleted: state.pumpsCompleted,
      currentMultiplier: state.cumulativeMultiplier,
    });
  }

  // ----- Pump: inflate the balloon one pump -----
  if (session.gameType === "arcade-pump" && action === "pump") {
    const rawDifficulty = (session.config as { difficulty?: string })
      .difficulty;
    if (
      typeof rawDifficulty !== "string" ||
      !(PUMP_DIFFICULTIES as readonly string[]).includes(rawDifficulty)
    ) {
      return NextResponse.json(
        { error: "Invalid pump session config." },
        { status: 400 },
      );
    }
    const difficulty = rawDifficulty as PumpDifficulty;
    const prior = (session.choices as PumpChoice[]) ?? [];
    const pumpIndex = prior.length;

    if (pumpIndex >= PUMP_MAX_PUMPS) {
      return NextResponse.json(
        { error: "Balloon already fully inflated." },
        { status: 400 },
      );
    }

    // Defensive: confirm the chain is still alive before pumping again.
    const priorState = replayPumpRound(session.seed, prior, difficulty);
    if (!priorState.alive) {
      return NextResponse.json(
        { error: "Session already busted." },
        { status: 400 },
      );
    }

    const result = advancePumpStep(
      session.seed,
      pumpIndex,
      difficulty,
      priorState.fairStepMultipliers,
    );
    const choice: PumpChoice = {
      result: result.alive ? "alive" : "pop",
      fairMult: result.fairMult,
    };
    await recordArcadeChoice(session.sessionId, identity.userId, choice);

    if (!result.alive) {
      const settled = await settleArcadeSession(
        session.sessionId,
        identity.userId,
        0,
        0,
        JSON.stringify({ poppedAt: pumpIndex, difficulty }),
        userName,
      );
      return NextResponse.json({
        alive: false,
        pumpsCompleted: result.pumpsCompleted,
        currentMultiplier: 0,
        payout: 0,
        seed: settled.seed,
        roundId: settled.roundId,
        achievements: settled.achievements,
      });
    }

    if (result.allPumpsCompleted) {
      const fairs = [...priorState.fairStepMultipliers, result.fairMult];
      const payout = computePumpPayout(session.wager, fairs, session.seed);
      const settled = await settleArcadeSession(
        session.sessionId,
        identity.userId,
        payout,
        result.currentMultiplier,
        JSON.stringify({
          pumps: result.pumpsCompleted,
          difficulty,
          completed: true,
        }),
        userName,
      );
      return NextResponse.json({
        alive: true,
        completed: true,
        allPumpsCompleted: true,
        pumpsCompleted: result.pumpsCompleted,
        currentMultiplier: result.currentMultiplier,
        payout: settled.payout,
        seed: settled.seed,
        roundId: settled.roundId,
        achievements: settled.achievements,
      });
    }

    return NextResponse.json({
      alive: true,
      pumpsCompleted: result.pumpsCompleted,
      currentMultiplier: result.currentMultiplier,
    });
  }

  // ----- Prize Claw: one drop — resolve, settle and reveal in a single call --
  if (session.gameType === "arcade-prize-claw" && action === "drop") {
    if (session.choices.length > 0) {
      const choice =
        session.choices.length === 1
          ? readPrizeClawChoice(session.choices[0])
          : null;
      const round = choice
        ? playPrizeClawDrop(session.config, session.seed, choice.x, choice.z)
        : null;
      if (!round) {
        return NextResponse.json(
          { error: "Invalid stored Prize Claw choice or session config." },
          { status: 400 },
        );
      }
      return settlePrizeClawRound(
        session,
        round,
        identity.userId,
        userName,
        true,
      );
    }

    // The client sends TWO FLOATS AND NOTHING ELSE. It never sends a prize
    // index, a tier, a grip chance, a multiplier or a payout — and if it did,
    // nothing here would read them.
    const rawX = data?.x;
    const rawZ = data?.z;
    if (
      typeof rawX !== "number" ||
      !Number.isFinite(rawX) ||
      typeof rawZ !== "number" ||
      !Number.isFinite(rawZ)
    ) {
      void addAntiCheatLog({
        ts: Date.now(),
        gameType: session.gameType,
        userId: identity.userId,
        userName,
        score: 0,
        result: "flag",
        severity: "flag",
        reason: `Non-finite drop coordinates: x=${String(rawX)} z=${String(rawZ)}`,
        stage: "prize-claw-drop",
        checks: [],
      }).catch(() => {
        // Audit logging is best effort; it never blocks the rejection.
      });
      return NextResponse.json(
        { error: "Drop needs finite x and z coordinates." },
        { status: 400 },
      );
    }

    // The bed is regenerated from the STORED public bedSeed, the target is
    // resolved from the CLAMPED coordinates, and both rolls come from the
    // private session seed.
    const round = playPrizeClawDrop(session.config, session.seed, rawX, rawZ);
    if (!round) {
      return NextResponse.json(
        { error: "Invalid Prize Claw session config." },
        { status: 400 },
      );
    }

    // Record the clamped point actually used, so the replay path above
    // reproduces this exact outcome.
    const recorded = await recordFirstArcadeChoice(
      session.sessionId,
      identity.userId,
      round.resolution.point,
    );
    if (!recorded) {
      // A concurrent request won the first-choice CAS. Reload and recover from
      // that stored point; never resolve or pay from this request's point.
      const current = await getArcadeSession(
        session.sessionId,
        identity.userId,
      );
      if (!current) {
        return NextResponse.json(
          { error: "Session not found." },
          { status: 404 },
        );
      }
      const choice =
        current.choices.length === 1
          ? readPrizeClawChoice(current.choices[0])
          : null;
      const replay = choice
        ? playPrizeClawDrop(current.config, current.seed, choice.x, choice.z)
        : null;
      if (!replay) {
        return NextResponse.json(
          { error: "Invalid stored Prize Claw choice or session config." },
          { status: 400 },
        );
      }
      if (current.settledAt) {
        return NextResponse.json({
          ...serializePrizeClawRound(replay),
          payout: current.payout ?? 0,
          seed: current.seed,
          roundId: null,
          replayed: true,
          achievements: [],
        });
      }
      return settlePrizeClawRound(
        current,
        replay,
        identity.userId,
        userName,
        true,
      );
    }

    return settlePrizeClawRound(
      session,
      round,
      identity.userId,
      userName,
      false,
    );
  }

  return NextResponse.json(
    { error: "Unknown action for this game type." },
    { status: 400 },
  );
}

async function settlePrizeClawRound(
  session: Awaited<ReturnType<typeof getArcadeSession>> & {},
  round: PrizeClawRound,
  userId: string,
  userName: string,
  replayed: boolean,
) {
  const payout = computePrizeClawPayout(
    session.wager,
    round.resolution,
    session.seed,
  );
  try {
    const settled = await settleArcadeSession(
      session.sessionId,
      userId,
      payout,
      round.resolution.multiplier,
      JSON.stringify({
        cabinet: round.config.cabinet,
        bedSeed: round.config.bedSeed,
        point: round.resolution.point,
        target: round.resolution.target,
        aimError: round.resolution.aimError,
        grip: round.resolution.grip,
        grabRoll: round.resolution.grabRoll,
        holdChance: round.resolution.holdChance,
        holdRoll: round.resolution.holdRoll,
        outcome: round.resolution.outcome,
      }),
      userName,
    );
    return NextResponse.json({
      ...serializePrizeClawRound(round),
      payout: settled.payout,
      seed: settled.seed,
      roundId: settled.roundId,
      achievements: settled.achievements,
      ...(replayed ? { replayed: true as const } : {}),
    });
  } catch (error) {
    // A concurrent retry may have settled between our read and guarded UPDATE.
    // Only turn that race into a replay after observing the persisted settle.
    const current = await getArcadeSession(session.sessionId, userId);
    if (!current?.settledAt) throw error;
    return NextResponse.json({
      ...serializePrizeClawRound(round),
      payout: current.payout ?? 0,
      seed: current.seed,
      roundId: null,
      replayed: true,
      achievements: [],
    });
  }
}

/**
 * The drop response. Everything the player needs to check the round for
 * themselves: the committed point, the target, the grip chance, BOTH revealed
 * rolls, the outcome, and the animation script. Shared by the live drop and the
 * replay path so the two can never drift.
 */
function serializePrizeClawRound(round: PrizeClawRound) {
  const { resolution } = round;
  return {
    cabinet: round.config.cabinet,
    bedSeed: round.config.bedSeed,
    point: resolution.point,
    target: resolution.target,
    aimError: resolution.aimError,
    grip: resolution.grip,
    grabRoll: resolution.grabRoll,
    grabbed: resolution.grabbed,
    holdChance: resolution.holdChance,
    holdRoll: resolution.holdRoll,
    held: resolution.held,
    outcome: resolution.outcome,
    multiplier: resolution.multiplier,
    script: round.script,
  };
}

/**
 * Derive the per-hand base wager from the session's cumulative `wager`
 * column and the action log. Each split or double adds exactly one extra
 * `baseWager` hold, so:
 *    totalWager = baseWager × (1 + #splits + #doubles)
 */
function computeBaseWager(
  totalWager: number,
  actions: readonly BlackjackAction[],
): number {
  let extras = 0;
  for (const a of actions) {
    if (a.type === "split" || a.type === "double") extras++;
  }
  const divisor = 1 + extras;
  // Integer division is safe because every hold is baseWager, a whole
  // number. Guard against /0 anyway.
  return divisor > 0 ? Math.floor(totalWager / divisor) : totalWager;
}
