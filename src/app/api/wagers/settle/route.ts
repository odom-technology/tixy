import { NextResponse } from "next/server";
import { requireIdentity } from "@/server/auth";
import {
  validateArcadeToken,
  getArcadeSession,
  settleArcadeSession,
  refundArcadeSession,
} from "@/server/arcade/arcade-session";
import {
  getChickenMultiplier,
  getMinesMultiplier,
} from "@/server/arcade/arcade-constants";
import {
  computeMinesPayout,
  generateMinePositions,
} from "@/server/arcade/wager-games/mines";
import {
  resolveSlots,
  computeSlotsPayout,
} from "@/server/arcade/wager-games/slots";
import {
  resolveStoplight,
  computeStoplightPayout,
} from "@/server/arcade/wager-games/stoplight";
import { getCrashPoint } from "@/server/arcade/wager-games/crash";
import {
  resolvePlinko,
  computePlinkoPayout,
} from "@/server/arcade/wager-games/plinko";
import {
  resolveDice,
  computeDicePayout,
} from "@/server/arcade/wager-games/dice";
import {
  computeChickenPayout,
  generateChickenLanes,
} from "@/server/arcade/wager-games/chicken";
import {
  computeHiLoPayout,
  replayHiLoRound,
  type HiLoChoice,
} from "@/server/arcade/wager-games/hilo";
import {
  resolveCases,
  computeCasesPayout,
} from "@/server/arcade/wager-games/cases";
import {
  resolvePacks,
  computePacksPayout,
} from "@/server/arcade/wager-games/packs";
import {
  resolveDarts,
  computeDartsPayout,
} from "@/server/arcade/wager-games/darts";
import {
  replayLightspeedRound,
  computeLightspeedPayout,
  generateLightspeedJumps,
  type LightspeedChoice,
} from "@/server/arcade/wager-games/lightspeed";
import type {
  CaseRisk,
  ChickenDifficulty,
  DiceDirection,
  PlinkoRisk,
  PlinkoRows,
} from "@/server/arcade/arcade-constants";
import {
  resolveLimbo,
  computeLimboPayout,
} from "@/server/arcade/wager-games/limbo";
import {
  replayDragonRound,
  computeDragonPayout,
  generateDragonRows,
  type DragonChoice,
  type DragonDifficulty,
} from "@/server/arcade/wager-games/dragon";
import {
  resolveRoulette,
  computeRoulettePayout,
  type RouletteBet,
} from "@/server/arcade/wager-games/roulette";
import {
  resolveScratch,
  computeScratchPayout,
  type ScratchTier,
} from "@/server/arcade/wager-games/scratch";
import {
  replayPumpRound,
  computePumpPayout,
  PUMP_DIFFICULTIES,
  type PumpChoice,
  type PumpDifficulty,
} from "@/server/arcade/wager-games/pump";
import {
  resolveKeno,
  computeKenoPayout,
  KENO_PROFILES,
  type KenoProfile,
} from "@/server/arcade/wager-games/keno";
import {
  resolveWheel,
  computeWheelPayout,
  type WheelSegmentCount,
  type WheelRisk,
} from "@/server/arcade/wager-games/prize-wheel";
import {
  resolveBaccarat,
  computeBaccaratPayout,
  baccaratReturnMultiplier,
  BACCARAT_BETS,
  type BaccaratBet,
} from "@/server/arcade/wager-games/baccarat";
import {
  resolveFortune,
  computeFortunePayout,
  type FortuneTier,
  FORTUNE_TIERS,
} from "@/server/arcade/wager-games/fortune-teller";
import {
  resolveGemRoll,
  computeGemRollPayout,
} from "@/server/arcade/wager-games/gem-roll";
import {
  resolveLuckyCage,
  computeLuckyCagePayout,
} from "@/server/arcade/wager-games/lucky-cage";

export const dynamic = "force-dynamic";

type SettlePayload = {
  token?: string;
  action?: "cashout" | "forfeit";
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

  let payload: SettlePayload;
  try {
    payload = (await request.json()) as SettlePayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { token, action } = payload;
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
  if (session.settledAt) {
    if (session.gameType === "arcade-lucky-cage" && action === "cashout") {
      const replay = serializeLuckyCageReplay(session);
      if (!replay) {
        return NextResponse.json(
          { error: "Invalid Lucky Cage session config." },
          { status: 400 },
        );
      }
      return NextResponse.json(replay);
    }
    return NextResponse.json(
      { error: "Session already settled." },
      { status: 400 },
    );
  }

  // ----- Forfeit: refund the wager -----
  if (action === "forfeit") {
    try {
      await refundArcadeSession(session.sessionId, identity.userId);
      return NextResponse.json({ refunded: true, seed: session.seed });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Refund failed." },
        { status: 500 },
      );
    }
  }

  // ----- Cashout -----
  try {
    let payout = 0;
    let multiplier = 0;
    let outcomeJson: string | undefined;
    let extraResponse: Record<string, unknown> = {};

    switch (session.gameType) {
      case "arcade-mines": {
        const mineCount =
          (session.config as { mineCount?: number }).mineCount ?? 5;
        const tilesRevealed = (session.choices as number[]).length;
        if (tilesRevealed === 0) {
          // No tiles revealed — refund
          await refundArcadeSession(session.sessionId, identity.userId);
          return NextResponse.json({ refunded: true, seed: session.seed });
        }
        multiplier = getMinesMultiplier(tilesRevealed, mineCount);
        payout = computeMinesPayout(
          session.wager,
          tilesRevealed,
          mineCount,
          session.seed,
        );
        const minePositions = generateMinePositions(session.seed, mineCount);
        outcomeJson = JSON.stringify({
          minePositions,
          cashedOutAt: tilesRevealed,
        });
        extraResponse = { minePositions };
        break;
      }

      case "arcade-slots": {
        const result = resolveSlots(session.seed);
        multiplier = result.multiplier;
        payout = computeSlotsPayout(session.wager, multiplier, session.seed);
        outcomeJson = JSON.stringify(result);
        break;
      }

      case "arcade-stoplight": {
        const result = resolveStoplight(session.seed);
        multiplier = result.multiplier;
        payout = computeStoplightPayout(
          session.wager,
          multiplier,
          session.seed,
        );
        outcomeJson = JSON.stringify(result);
        break;
      }

      case "arcade-crash": {
        // Crash cashout goes through the /action endpoint. Settling here means crashed.
        const crashPoint = getCrashPoint(session.seed);
        multiplier = 0;
        payout = 0;
        outcomeJson = JSON.stringify({ crashPoint, expired: true });
        break;
      }

      case "arcade-plinko": {
        const rows =
          ((session.config as { rows?: number }).rows as PlinkoRows) ?? 8;
        const risk =
          ((session.config as { risk?: string }).risk as PlinkoRisk) ?? "low";
        const result = resolvePlinko(session.seed, rows, risk);
        multiplier = result.multiplier;
        payout = computePlinkoPayout(session.wager, result, session.seed);
        outcomeJson = JSON.stringify(result);
        break;
      }

      case "arcade-dice": {
        const target = (session.config as { target?: number }).target ?? 50;
        const direction =
          ((session.config as { direction?: string })
            .direction as DiceDirection) ?? "over";
        const result = resolveDice(session.seed, target, direction);
        multiplier = result.multiplier;
        payout = computeDicePayout(session.wager, result, session.seed);
        outcomeJson = JSON.stringify(result);
        break;
      }

      case "arcade-chicken": {
        const difficulty =
          ((session.config as { difficulty?: string })
            .difficulty as ChickenDifficulty) ?? "medium";
        const lanesCrossed = (session.choices as number[]).length;
        if (lanesCrossed === 0) {
          // No lanes crossed — refund
          await refundArcadeSession(session.sessionId, identity.userId);
          return NextResponse.json({ refunded: true, seed: session.seed });
        }
        multiplier = getChickenMultiplier(lanesCrossed, difficulty);
        payout = computeChickenPayout(
          session.wager,
          lanesCrossed,
          difficulty,
          session.seed,
        );
        const lanes = generateChickenLanes(session.seed, difficulty);
        outcomeJson = JSON.stringify({
          lanes,
          lanesCrossed,
          difficulty,
          cashedOut: true,
        });
        extraResponse = { lanes, lanesCrossed };
        break;
      }

      case "arcade-hilo": {
        const choices = (session.choices as HiLoChoice[]) ?? [];
        if (choices.length === 0) {
          // No guesses made — refund the wager
          await refundArcadeSession(session.sessionId, identity.userId);
          return NextResponse.json({ refunded: true, seed: session.seed });
        }
        const state = replayHiLoRound(session.seed, choices);
        if (!state.alive) {
          return NextResponse.json(
            { error: "Session already busted." },
            { status: 400 },
          );
        }
        multiplier = state.cumulativeMultiplier;
        payout = computeHiLoPayout(session.wager, session.seed, choices);
        outcomeJson = JSON.stringify({ choices, multiplier, cashedOut: true });
        break;
      }

      case "arcade-cases": {
        const risk =
          ((session.config as { risk?: string }).risk as CaseRisk) ?? "low";
        const result = resolveCases(session.seed, risk);
        multiplier = result.multiplier;
        payout = computeCasesPayout(session.wager, multiplier, session.seed);
        outcomeJson = JSON.stringify(result);
        extraResponse = {
          risk: result.risk,
          itemIndex: result.itemIndex,
          rarity: result.rarity,
        };
        break;
      }

      case "arcade-packs": {
        const result = resolvePacks(session.seed);
        multiplier = result.totalMultiplier;
        payout = computePacksPayout(session.wager, multiplier, session.seed);
        outcomeJson = JSON.stringify(result);
        extraResponse = {
          cards: result.cards,
          totalMultiplier: result.totalMultiplier,
        };
        break;
      }

      case "arcade-darts": {
        const result = resolveDarts(session.seed);
        multiplier = result.multiplier;
        payout = computeDartsPayout(session.wager, multiplier, session.seed);
        outcomeJson = JSON.stringify(result);
        extraResponse = {
          zoneIndex: result.zoneIndex,
          zone: result.zone,
          throwValue: result.throwValue,
        };
        break;
      }

      case "arcade-lightspeed": {
        const choices = (session.choices as LightspeedChoice[]) ?? [];
        if (choices.length === 0) {
          await refundArcadeSession(session.sessionId, identity.userId);
          return NextResponse.json({ refunded: true, seed: session.seed });
        }
        const state = replayLightspeedRound(session.seed, choices);
        if (!state.alive) {
          return NextResponse.json(
            { error: "Session already busted." },
            { status: 400 },
          );
        }
        multiplier = state.cumulativeMultiplier;
        payout = computeLightspeedPayout(
          session.wager,
          state.fairStepMultipliers,
          session.seed,
        );
        const jumps = generateLightspeedJumps(session.seed);
        outcomeJson = JSON.stringify({
          choices,
          jumps,
          multiplier,
          cashedOut: true,
        });
        extraResponse = { jumpsCompleted: state.jumpsCompleted };
        break;
      }

      case "arcade-blackjack": {
        // Blackjack settles automatically via the /action endpoint the moment
        // the round terminates. A /settle call only arrives here if the
        // player never played (no deal yet), in which case we refund the
        // initial hold. Anything past 'deal' cannot be manually cashed out.
        if (session.choices.length === 0) {
          await refundArcadeSession(session.sessionId, identity.userId);
          return NextResponse.json({ refunded: true, seed: session.seed });
        }
        return NextResponse.json(
          { error: "21 rounds end automatically — finish playing the hand." },
          { status: 400 },
        );
      }

      case "arcade-limbo": {
        const target = (session.config as { target?: number }).target ?? 2;
        const result = resolveLimbo(session.seed, target);
        multiplier = result.multiplier;
        payout = computeLimboPayout(session.wager, result, session.seed);
        outcomeJson = JSON.stringify(result);
        extraResponse = { roll: result.roll };
        break;
      }

      case "arcade-dragon": {
        const difficulty =
          ((session.config as { difficulty?: string })
            .difficulty as DragonDifficulty) ?? "medium";
        const choices = (session.choices as DragonChoice[]) ?? [];
        if (choices.length === 0) {
          await refundArcadeSession(session.sessionId, identity.userId);
          return NextResponse.json({ refunded: true, seed: session.seed });
        }
        const state = replayDragonRound(session.seed, choices, difficulty);
        if (!state.alive) {
          return NextResponse.json(
            { error: "Session already busted." },
            { status: 400 },
          );
        }
        multiplier = state.cumulativeMultiplier;
        payout = computeDragonPayout(
          session.wager,
          state.fairStepMultipliers,
          session.seed,
        );
        const rows = generateDragonRows(session.seed, difficulty);
        outcomeJson = JSON.stringify({
          rows,
          rowsClimbed: state.rowsClimbed,
          difficulty,
          multiplier,
          cashedOut: true,
        });
        extraResponse = { rows, rowsClimbed: state.rowsClimbed };
        break;
      }

      case "arcade-video-poker": {
        // Video poker settles atomically in the /action 'draw' handler. A
        // /settle call only arrives if the player never drew, in which case
        // we refund the hold. Anything past the draw is already settled.
        if (session.choices.length === 0) {
          await refundArcadeSession(session.sessionId, identity.userId);
          return NextResponse.json({ refunded: true, seed: session.seed });
        }
        return NextResponse.json(
          { error: "Hand already resolved." },
          { status: 400 },
        );
      }

      case "arcade-roulette": {
        const bets = ((session.config as { bets?: RouletteBet[] }).bets ??
          []) as RouletteBet[];
        const result = resolveRoulette(session.seed, bets, session.wager);
        multiplier = result.multiplier;
        payout = computeRoulettePayout(session.wager, bets, session.seed);
        outcomeJson = JSON.stringify(result);
        extraResponse = {
          pocket: result.pocket,
          color: result.color,
          winningBets: result.winningBets,
        };
        break;
      }

      case "arcade-scratch": {
        const tier =
          ((session.config as { tier?: string }).tier as ScratchTier) ??
          "bronze";
        const result = resolveScratch(session.seed, tier);
        multiplier = result.multiplier;
        payout = computeScratchPayout(session.wager, result, session.seed);
        outcomeJson = JSON.stringify(result);
        extraResponse = {
          grid: result.grid,
          win: result.win,
          symbol: result.symbol,
          prizeCells: result.prizeCells,
          tier: result.tier,
        };
        break;
      }

      case "arcade-pump": {
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
        const choices = (session.choices as PumpChoice[]) ?? [];
        if (choices.length === 0) {
          await refundArcadeSession(session.sessionId, identity.userId);
          return NextResponse.json({ refunded: true, seed: session.seed });
        }
        const state = replayPumpRound(session.seed, choices, difficulty);
        if (!state.alive) {
          return NextResponse.json(
            { error: "Session already busted." },
            { status: 400 },
          );
        }
        multiplier = state.cumulativeMultiplier;
        payout = computePumpPayout(
          session.wager,
          state.fairStepMultipliers,
          session.seed,
        );
        outcomeJson = JSON.stringify({
          choices,
          multiplier,
          difficulty,
          cashedOut: true,
        });
        extraResponse = { pumpsCompleted: state.pumpsCompleted };
        break;
      }

      case "arcade-keno": {
        const rawProfile = (session.config as { profile?: string }).profile;
        const picks = ((session.config as { picks?: number[] }).picks ??
          []) as number[];
        if (
          typeof rawProfile !== "string" ||
          !(KENO_PROFILES as readonly string[]).includes(rawProfile) ||
          picks.length === 0
        ) {
          return NextResponse.json(
            { error: "Invalid keno session config." },
            { status: 400 },
          );
        }
        const profile = rawProfile as KenoProfile;
        const result = resolveKeno(session.seed, profile, picks);
        multiplier = result.multiplier;
        payout = computeKenoPayout(
          session.wager,
          profile,
          picks.length,
          result.hits,
          session.seed,
        );
        outcomeJson = JSON.stringify(result);
        extraResponse = {
          drawn: result.drawn,
          hitNumbers: result.hitNumbers,
          hits: result.hits,
          profile,
          picks,
        };
        break;
      }

      case "arcade-prize-wheel": {
        const segments = (session.config as { segments?: number })
          .segments as WheelSegmentCount;
        const risk = (session.config as { risk?: string }).risk as WheelRisk;
        const result = resolveWheel(session.seed, segments, risk);
        multiplier = result.multiplier;
        payout = computeWheelPayout(session.wager, result, session.seed);
        outcomeJson = JSON.stringify(result);
        extraResponse = {
          index: result.index,
          segments: result.segments,
          risk: result.risk,
          won: result.won,
        };
        break;
      }

      case "arcade-baccarat": {
        const rawBet = (session.config as { bet?: string }).bet;
        if (
          typeof rawBet !== "string" ||
          !(BACCARAT_BETS as readonly string[]).includes(rawBet)
        ) {
          return NextResponse.json(
            { error: "Invalid baccarat session config." },
            { status: 400 },
          );
        }
        const bet = rawBet as BaccaratBet;
        const result = resolveBaccarat(session.seed);
        multiplier = baccaratReturnMultiplier(bet, result.outcome);
        payout = computeBaccaratPayout(
          session.wager,
          bet,
          result.outcome,
          session.seed,
        );
        outcomeJson = JSON.stringify({ bet, ...result });
        extraResponse = {
          bet,
          outcome: result.outcome,
          playerCards: result.playerCards,
          bankerCards: result.bankerCards,
          playerTotal: result.playerTotal,
          bankerTotal: result.bankerTotal,
          natural: result.natural,
        };
        break;
      }

      case "arcade-fortune-teller": {
        const rawTier = (session.config as { tier?: string }).tier;
        if (
          typeof rawTier !== "string" ||
          !(FORTUNE_TIERS as readonly string[]).includes(rawTier)
        ) {
          return NextResponse.json(
            { error: "Invalid fortune teller session config." },
            { status: 400 },
          );
        }
        const tier = rawTier as FortuneTier;
        const result = resolveFortune(session.seed, tier);
        multiplier = result.product;
        payout = computeFortunePayout(session.wager, result, session.seed);
        outcomeJson = JSON.stringify(result);
        extraResponse = {
          tier: result.tier,
          cards: result.cards,
          product: result.product,
          won: result.won,
        };
        break;
      }

      case "arcade-gem-roll": {
        const result = resolveGemRoll(session.seed);
        multiplier = result.multiplier;
        payout = computeGemRollPayout(session.wager, result, session.seed);
        outcomeJson = JSON.stringify(result);
        extraResponse = {
          gems: result.gems,
          pattern: result.pattern,
          matchedColors: result.matchedColors,
          won: result.won,
        };
        break;
      }

      case "arcade-lucky-cage": {
        // The ticket comes from the session config the server validated at
        // create time — never from this request. Re-validate anyway so a row
        // written by an older/looser build can't resolve to an unknown ticket.
        const rawTicket = (session.config as { ticket?: string }).ticket;
        const cage =
          typeof rawTicket === "string"
            ? resolveLuckyCage(session.seed, rawTicket)
            : null;
        if (!cage) {
          return NextResponse.json(
            { error: "Invalid Lucky Cage session config." },
            { status: 400 },
          );
        }
        // The multiplier already carries the house edge — it was built as
        // (1 / exactProbability) * 0.99. Do NOT discount it again.
        multiplier = cage.multiplier;
        payout = computeLuckyCagePayout(session.wager, cage, session.seed);
        outcomeJson = JSON.stringify(cage);
        extraResponse = {
          ticket: cage.ticket,
          family: cage.family,
          draw: cage.draw,
          head: cage.head,
          highCount: cage.highCount,
          rackCounts: cage.rackCounts,
          hitBalls: cage.hitBalls,
          won: cage.won,
        };
        break;
      }

      case "arcade-prize-claw": {
        // Prize Claw resolves and settles on the drop (POST /api/wagers/action
        // with action: 'drop'), like Blackjack settling from a terminal action.
        // Cashing out here can only mean the player never committed a drop, so
        // the honest answer is a refund, not a zero-payout settle.
        if (session.choices.length === 0) {
          await refundArcadeSession(session.sessionId, identity.userId);
          return NextResponse.json({ refunded: true, seed: session.seed });
        }
        return NextResponse.json(
          { error: "Prize Claw rounds settle on the drop." },
          { status: 400 },
        );
      }

      default:
        return NextResponse.json(
          { error: "Unknown game type." },
          { status: 400 },
        );
    }

    const userName = identity.name || "Anonymous";
    const settled = await settleArcadeSession(
      session.sessionId,
      identity.userId,
      payout,
      multiplier,
      outcomeJson,
      userName,
    );

    return NextResponse.json({
      payout: settled.payout,
      multiplier,
      seed: settled.seed,
      roundId: settled.roundId,
      achievements: settled.achievements,
      ...extraResponse,
    });
  } catch (error) {
    // A response can be lost after the guarded settlement commits, or another
    // same-token retry can win the race. Reconcile Lucky Cage from the stored
    // seed/config only after observing that the session is now settled.
    if (session.gameType === "arcade-lucky-cage") {
      const current = await getArcadeSession(
        session.sessionId,
        identity.userId,
      );
      const replay = current?.settledAt
        ? serializeLuckyCageReplay(current)
        : null;
      if (replay) return NextResponse.json(replay);
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Settlement failed." },
      { status: 500 },
    );
  }
}

function serializeLuckyCageReplay(
  session: NonNullable<Awaited<ReturnType<typeof getArcadeSession>>>,
) {
  const rawTicket = (session.config as { ticket?: string }).ticket;
  const cage =
    typeof rawTicket === "string"
      ? resolveLuckyCage(session.seed, rawTicket)
      : null;
  if (!cage) return null;
  return {
    payout: session.payout ?? 0,
    multiplier: cage.multiplier,
    seed: session.seed,
    roundId: null,
    ticket: cage.ticket,
    family: cage.family,
    draw: cage.draw,
    head: cage.head,
    highCount: cage.highCount,
    rackCounts: cage.rackCounts,
    hitBalls: cage.hitBalls,
    won: cage.won,
    replayed: true,
    achievements: [],
  };
}
