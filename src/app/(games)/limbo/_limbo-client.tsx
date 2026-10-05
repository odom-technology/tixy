"use client";

import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from "react";
import { useGamesWallet } from "@/features/arcade/components/shell/games-wallet-provider";
import {
  GameShell,
  GameStat,
  type GameHowTo,
} from "@/features/arcade/components/shell/game-shell";
import {
  ArcadeMachine,
  MachineButton,
  MachineChoice,
  MachineGlass,
  machineError,
  useMachineBet,
  useMachineKey,
} from "@/features/arcade/components/wagers/arcade-machine";
import { ArcadeWagerResultPlate } from "@/features/arcade/components/results/arcade-run-result";
import { ArcadeStub } from "@/features/arcade/components/ui/arcade-ui";
import { useGameFeedback } from "@/features/arcade/lib/use-game-feedback";
import { getWagerFeedbackEvent } from "@/features/arcade/lib/wager-celebration";
import { SoundManager } from "@/features/arcade/lib/sound-manager";
import { playHaptic } from "@/features/arcade/lib/game-haptics";
import {
  createGameFrameLoop,
  type GameFrameLoop,
} from "@/features/arcade/lib/game-frame-loop";
import { useWagerSession } from "@/features/arcade/lib/use-wager-session";
import { ARCADE_MIN_BET } from "@/server/arcade/arcade-constants";
import {
  LIMBO_MIN_TARGET,
  LIMBO_MAX_TARGET,
} from "@/server/arcade/wager-games/limbo";

/* ========================================================================== */
/*  Helpers                                                                   */
/* ========================================================================== */

/** Quick targets, and `custom` for a typed one: one control on the deck. */
const TARGET_PRESETS = [1.5, 2, 5, 10, 100];

const HOW_TO: GameHowTo = {
  lines: [
    "Set a target multiplier, then launch.",
    "The rocket stops at a random multiplier, and you win if it reaches your target.",
    `A win pays your bet times the target: 2× wins about 49 times in 100, ${LIMBO_MAX_TARGET}× about 1 in 1000.`,
  ],
};

/** A server or rules error with a sentence ready for the notice. */
class LaunchError extends Error {}

function floorToTwoDecimals(value: number): number {
  return Math.floor(value * 100) / 100;
}

function clampTarget(value: number): number {
  if (!Number.isFinite(value)) return 2;
  return Math.min(
    LIMBO_MAX_TARGET,
    Math.max(LIMBO_MIN_TARGET, floorToTwoDecimals(value)),
  );
}

/**
 * Re-roll the crash-point from the revealed seed for the rise animation. This
 * MUST mirror rollLimboCrashPoint() in the server's limbo.ts exactly — the
 * authoritative payout still comes from the settle response.
 */
function reconstructCrashPoint(seed: number): number {
  let s = seed | 0;
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const float = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  const u32 = Math.floor(float * 2 ** 32);
  const raw = (0.99 * 2 ** 32) / (u32 + 1);
  return Math.max(1.0, Math.floor(raw * 100) / 100);
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

type LimboPhase = "idle" | "requesting" | "revealing" | "result";

type PendingLimboResult = {
  roll: number;
  won: boolean;
  payout: number;
  paidMultiplier: number;
  wager: number;
  target: number;
};

/* ========================================================================== */
/*  Component                                                                 */
/* ========================================================================== */

export default function LimboClient() {
  const { trigger: triggerFeedback } = useGameFeedback();
  const {
    wallet,
    loaded: walletLoaded,
    refresh: refreshWallet,
    adjustCredits,
  } = useGamesWallet();
  const balance = walletLoaded ? wallet.credits : null;
  const [phase, setPhase] = useState<LimboPhase>("idle");
  const isRolling = phase === "requesting" || phase === "revealing";
  const [wager, setWager] = useMachineBet(balance, 10, { locked: isRolling });
  const [target, setTarget] = useState(2);
  const [targetText, setTargetText] = useState("2.00");
  // `custom` is lit and the field is open, even if the typed target matches a
  // quick one.
  const [customOpen, setCustomOpen] = useState(false);
  // The climbing number has passed the target line (a win, mid-climb).
  const [crossed, setCrossed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roundId, setRoundId] = useState<string | null>(null);

  // Live rising readout + settled result.
  const [displayMult, setDisplayMult] = useState<number | null>(null);
  const [finalRoll, setFinalRoll] = useState<number | null>(null);
  const [rollWon, setRollWon] = useState<boolean | null>(null);
  const [lastPayout, setLastPayout] = useState<number | null>(null);
  const [settledWager, setSettledWager] = useState(10);
  const [settledTarget, setSettledTarget] = useState(2);
  const [lastPaidMultiplier, setLastPaidMultiplier] = useState<number | null>(
    null,
  );

  const riseFrameLoopRef = useRef<GameFrameLoop | null>(null);
  const riseAnimationRef = useRef<{
    roll: number;
    won: boolean;
    paidMultiplier: number;
    target: number;
    start: number;
    duration: number;
  } | null>(null);
  const crossedRef = useRef(false);
  const triggerFeedbackRef = useRef(triggerFeedback);
  triggerFeedbackRef.current = triggerFeedback;
  const pendingResultRef = useRef<PendingLimboResult | null>(null);
  const finishRevealRef = useRef<() => void>(() => undefined);

  // Provably fair (hook also owns the session/settle round-trips).
  const {
    revealedSeed,
    start: startSession,
    settle: settleSession,
    achievements,
  } = useWagerSession("arcade-limbo");

  // Own the presentation loop independently from the settled wager.
  useEffect(() => {
    const frameLoop = createGameFrameLoop({
      simulate: () => undefined,
      render: (_alpha, frameInfo) => {
        const animation = riseAnimationRef.current;
        if (!animation) {
          frameLoop.stop();
          return;
        }
        const t = Math.min(
          1,
          (frameInfo.nowMs - animation.start) / animation.duration,
        );
        const eased = 1 - Math.pow(1 - t, 3);
        // Climb in log-space so the number accelerates like the real curve.
        const value = Math.pow(animation.roll, eased);
        setDisplayMult(floorToTwoDecimals(value));
        // The moment the number passes the target line: the line lights, and
        // a cue plays. Only a rise that ends past the target gets here.
        if (
          !crossedRef.current &&
          animation.won &&
          floorToTwoDecimals(value) >= animation.target
        ) {
          crossedRef.current = true;
          setCrossed(true);
          triggerFeedbackRef.current("collect", { haptic: true });
          playHaptic("medium");
        }
        if (t >= 1) finishRevealRef.current();
      },
    });
    riseFrameLoopRef.current = frameLoop;
    return () => {
      riseAnimationRef.current = null;
      frameLoop.destroy();
      if (riseFrameLoopRef.current === frameLoop) {
        riseFrameLoopRef.current = null;
      }
    };
  }, []);

  const finishReveal = useCallback(() => {
    const result = pendingResultRef.current;
    if (!result) return;
    pendingResultRef.current = null;
    riseAnimationRef.current = null;
    riseFrameLoopRef.current?.stop();

    setDisplayMult(result.roll);
    setFinalRoll(result.roll);
    setRollWon(result.won);
    setLastPayout(result.payout);
    setLastPaidMultiplier(result.paidMultiplier);
    setPhase("result");

    const feedbackEvent = getWagerFeedbackEvent({
      won: result.won,
      amount: result.payout,
      stake: result.wager,
      multiplier: result.won ? result.paidMultiplier : 0,
      net: result.payout - result.wager,
    });
    triggerFeedback(feedbackEvent);
    void refreshWallet();
  }, [refreshWallet, triggerFeedback]);
  finishRevealRef.current = finishReveal;

  // Drive the dramatic count-up of the crash-point toward/over the target.
  const animateRise = useCallback(
    (roll: number, won: boolean, paidMultiplier: number, target: number) => {
      riseFrameLoopRef.current?.stop();
      riseAnimationRef.current = null;

      if (prefersReducedMotion()) {
        crossedRef.current = won;
        setCrossed(won);
        setDisplayMult(roll);
        finishRevealRef.current();
        return;
      }

      // Ease-out climb whose duration scales (log) with how high the rocket goes,
      // so a ×1000 hit still feels like a long climb without dragging on ×1.2.
      const duration = Math.min(
        2200,
        650 + Math.log10(Math.max(1, roll)) * 520,
      );
      riseAnimationRef.current = {
        roll,
        won,
        paidMultiplier,
        target,
        start: performance.now(),
        duration,
      };
      riseFrameLoopRef.current?.start();
    },
    [],
  );

  const commitTarget = useCallback((raw: string) => {
    const parsed = Number(raw);
    const next = clampTarget(parsed);
    setTarget(next);
    setTargetText(next.toFixed(2));
  }, []);

  // ─── Roll ────────────────────────────────────────────────────────────
  const handleRoll = useCallback(async () => {
    if (isRolling) return;
    if (wager < ARCADE_MIN_BET) {
      setError(`The smallest bet is ${ARCADE_MIN_BET} tickets.`);
      return;
    }
    if (balance == null || wager > balance) {
      setError(`You need ${wager} tickets for this bet.`);
      return;
    }

    const currentTarget = clampTarget(target);
    setError(null);
    setPhase("requesting");
    setSettledWager(wager);
    setSettledTarget(currentTarget);
    setRoundId(null);
    crossedRef.current = false;
    setCrossed(false);
    SoundManager.play("arcadeBet");

    // Optimistic debit.
    adjustCredits(-wager);

    // Reset the prior result; the rocket starts climbing from ×1.00.
    setRollWon(null);
    setLastPayout(null);
    setLastPaidMultiplier(null);
    setFinalRoll(null);
    setDisplayMult(1.0);

    const currentWager = wager;

    try {
      const session = await startSession(currentWager, {
        target: currentTarget,
      });
      if (!session.ok)
        throw new LaunchError(
          machineError(session.error, "The machine could not start the round."),
        );

      const settled = await settleSession<{
        seed: number;
        payout: number;
        multiplier: number;
        roundId?: string | null;
      }>();
      if (!settled.ok)
        throw new LaunchError(
          machineError(
            settled.error,
            "The launch did not go through. Try again.",
          ),
        );
      const settleData = settled.data;
      setRoundId(settleData.roundId ?? null);

      // Reconstruct the crash-point for the rise; payout is authoritative.
      const roll = reconstructCrashPoint(settleData.seed);
      const won = roll >= currentTarget;
      pendingResultRef.current = {
        roll,
        won,
        payout: settleData.payout,
        paidMultiplier: settleData.multiplier,
        wager: currentWager,
        target: currentTarget,
      };
      setPhase("revealing");
      animateRise(roll, won, settleData.multiplier, currentTarget);
    } catch (err) {
      pendingResultRef.current = null;
      riseAnimationRef.current = null;
      riseFrameLoopRef.current?.stop();
      setError(
        err instanceof LaunchError
          ? err.message
          : "The machine lost its connection. Try again.",
      );
      setDisplayMult(null);
      setPhase("idle");
      void refreshWallet();
    }
  }, [
    isRolling,
    wager,
    balance,
    target,
    refreshWallet,
    adjustCredits,
    startSession,
    settleSession,
    animateRise,
  ]);

  // Space launches (ignored while typing in the target field or on a control).
  useMachineKey(useMemo(() => () => void handleRoll(), [handleRoll]));

  // ─── Computed ──────────────────────────────────────────────────────────
  const safeTarget = clampTarget(target);
  const stageTarget = phase === "idle" ? safeTarget : settledTarget;
  // Edge lives in the crash-point curve: win chance ≈ 0.99 / target.
  const winChancePct = Math.min(99, (0.99 / safeTarget) * 100);
  const potentialPayout = Math.floor(wager * safeTarget);
  const affordable = balance != null && wager <= balance;

  const shownMult = displayMult ?? 1.0;
  const settled = phase === "result" && finalRoll != null;
  const tone = settled ? (rollWon ? "win" : "loss") : "idle";
  const net = (lastPayout ?? 0) - settledWager;
  const targetText2 = stageTarget.toFixed(2);

  const readoutMain = settled
    ? rollWon
      ? "you win"
      : "you lose"
    : isRolling
      ? "climbing"
      : `${targetText2}×`;
  const readoutSub = settled
    ? rollWon
      ? `Reached ${finalRoll.toFixed(2)}×, past your ${targetText2}×. Paid ${(lastPayout ?? 0).toLocaleString()}.`
      : `Stopped at ${finalRoll.toFixed(2)}×, short of your ${targetText2}×. Bet of ${settledWager.toLocaleString()} lost.`
    : isRolling
      ? crossed
        ? `Past your ${targetText2}× target.`
        : `Needs ${targetText2}× to win.`
      : `Win if the rocket reaches ${targetText2}×: ${winChancePct.toFixed(1)}% chance.`;

  const screen = (
    <div className="arc-machine-fit limbo-screen">
      {/* The rocket's altitude, big. It climbs on the click and stops where
          the round says. */}
      <p
        className="limbo-number arcade-num"
        data-tone={tone}
        data-crossed={(isRolling && crossed) || undefined}
        data-idle={displayMult == null || undefined}
      >
        {shownMult.toFixed(2)}×
      </p>

      <div className="limbo-readout" data-tone={tone}>
        <p className="limbo-readout-main">{readoutMain}</p>
        <p className="limbo-readout-sub">{readoutSub}</p>
        {tone === "win" ? (
          <ArcadeStub size="lg" className="limbo-readout-side">
            +{net.toLocaleString()}
          </ArcadeStub>
        ) : tone === "loss" ? (
          <p className="limbo-readout-side limbo-readout-net">
            {`−${(settledWager - (lastPayout ?? 0)).toLocaleString()}`}
          </p>
        ) : null}
      </div>

      {/* Screen-reader round status: only the settled outcome is announced. */}
      <p className="sr-only" role="status">
        {settled
          ? rollWon
            ? `Target cleared at ${finalRoll.toFixed(2)} times. Paid ${(lastPayout ?? 0).toLocaleString()} tickets.`
            : `Stopped at ${finalRoll.toFixed(2)} times, short of ${targetText2}.`
          : ""}
      </p>

      {/* The rail: altitude left to right, the target always in the middle
          (it is a log scale ending at the target squared), so the whole rail
          is the climb around your target. Past the line is the win zone. */}
      <div
        className="limbo-rail"
        data-crossed={crossed || undefined}
        data-tone={tone}
        style={
          {
            "--target": `${railPct(stageTarget, stageTarget)}%`,
            "--rocket": `${railPct(shownMult, stageTarget)}%`,
          } as CSSProperties
        }
      >
        <div className="limbo-scale">
          <div className="limbo-track" />
          <div className="limbo-zone-win" />
          <div className="limbo-line" aria-hidden>
            <span className="limbo-line-tag arcade-num">{targetText2}×</span>
          </div>
          <span className="limbo-end limbo-end-start arcade-num" aria-hidden>
            1×
          </span>
          <span className="limbo-end limbo-end-top arcade-num" aria-hidden>
            {formatRailEnd(railEnd(stageTarget))}×
          </span>
          <div
            className="limbo-rocket"
            data-rising={isRolling || undefined}
            data-tone={tone}
            aria-hidden
          >
            <RocketIcon />
          </div>
        </div>
      </div>

      <style jsx global>{`
        .arc-shell[data-game="limbo"] .arc-machine-frame:not([data-wide]) {
          --machine-screen-min: 18rem;
        }
        .limbo-screen {
          --limbo-plate: 5.25rem;
          --limbo-rail: clamp(3.25rem, 11cqh, 5rem);
          --limbo-rocket: calc(var(--limbo-rail) * 2.2);
          gap: clamp(0.5rem, 2cqh, 1.25rem);
          padding: 0.75rem clamp(0.75rem, 4cqi, 2rem);
          background: var(--screen-well);
        }
        .limbo-screen > * {
          width: min(100%, 52rem);
        }
        /* the climbing number: the biggest thing on the screen */
        .limbo-number {
          margin: 0;
          flex: none;
          font-size: clamp(3.25rem, min(20cqi, 18cqh), 9rem);
          font-weight: var(--tixy-weight-num);
          line-height: 0.95;
          letter-spacing: var(--tixy-tracking-num);
          text-align: center;
          color: var(--tixy-paper);
        }
        .limbo-number[data-idle] {
          color: var(--tixy-on-ink-3);
        }
        .limbo-number[data-tone="loss"] {
          color: var(--tixy-on-ink-2);
        }
        .limbo-readout {
          display: grid;
          flex: none;
          grid-template-columns: minmax(0, 1fr) auto;
          grid-template-areas:
            "main side"
            "sub  side";
          align-items: center;
          column-gap: 1rem;
          box-sizing: border-box;
          height: var(--limbo-plate);
          padding: 0.375rem 1rem;
          border-radius: var(--tixy-radius-panel-sm);
          color: var(--tixy-paper);
        }
        .limbo-readout[data-tone="idle"] {
          padding-inline: 0;
          justify-items: center;
          text-align: center;
          grid-template-columns: minmax(0, 1fr);
          grid-template-areas: "main" "sub";
        }
        .limbo-readout[data-tone="win"] {
          background: var(--tixy-red);
          color: var(--tixy-on-red);
        }
        .limbo-readout[data-tone="loss"] {
          background: var(--tixy-screen-2);
        }
        .limbo-readout-main {
          grid-area: main;
          margin: 0;
          font-family: var(--tixy-font-num);
          font-size: 2rem;
          font-weight: var(--tixy-weight-num);
          line-height: 1.1;
          letter-spacing: var(--tixy-tracking-num);
        }
        .limbo-readout-sub {
          grid-area: sub;
          margin: 0.125rem 0 0;
          overflow: hidden;
          font-size: 0.9375rem;
          line-height: 1.25;
          color: var(--tixy-on-ink-2);
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
        }
        .limbo-readout[data-tone="win"] .limbo-readout-sub {
          color: var(--tixy-on-red);
        }
        .limbo-readout-side {
          grid-area: side;
        }
        .limbo-readout-net {
          margin: 0;
          font-family: var(--tixy-font-num);
          font-size: 2.25rem;
          font-weight: var(--tixy-weight-num);
          line-height: 1;
          color: var(--tixy-on-ink-2);
        }
        /* the rail: room on the left for the rocket to start in, the label
           above the line and the ends below */
        .limbo-rail {
          position: relative;
          flex: none;
          height: calc(var(--limbo-rail) + 4rem);
          padding-left: var(--limbo-rocket);
        }
        .limbo-scale {
          position: relative;
          height: 100%;
        }
        .limbo-track {
          position: absolute;
          top: 2.25rem;
          left: calc(var(--limbo-rocket) * -1);
          right: 0;
          height: var(--limbo-rail);
          border-radius: 10px;
          background: var(--tixy-screen-2);
        }
        /* the win zone: from the line to the end of the rail, red */
        .limbo-zone-win {
          position: absolute;
          top: 2.25rem;
          left: var(--target);
          right: 0;
          height: var(--limbo-rail);
          border-radius: 0 10px 10px 0;
          background: var(--tixy-red);
        }
        /* the target: a paper line through the track, labelled above; it
           lights when the climb crosses it */
        .limbo-line {
          position: absolute;
          top: 1.5rem;
          bottom: 1.25rem;
          left: var(--target);
          width: 3px;
          margin-left: -1.5px;
          border-radius: 2px;
          background: var(--tixy-paper);
        }
        .limbo-line-tag {
          position: absolute;
          bottom: 100%;
          left: 50%;
          padding: 0.0625rem 0.5rem;
          border-radius: 6px;
          background: var(--tixy-paper);
          color: var(--tixy-ink);
          font-size: 1.125rem;
          font-weight: var(--tixy-weight-num);
          line-height: 1.3;
          white-space: nowrap;
          transform: translateX(-50%);
        }
        .limbo-rail[data-crossed] .limbo-line {
          width: 6px;
          margin-left: -3px;
        }
        .limbo-rail[data-crossed] .limbo-line-tag {
          background: var(--tixy-red);
          color: var(--tixy-on-red);
          box-shadow: 0 0 0 2px var(--tixy-paper);
        }
        .limbo-end {
          position: absolute;
          bottom: 0;
          font-size: 0.9375rem;
          color: var(--tixy-on-ink-3);
        }
        .limbo-end-start {
          left: 0;
        }
        .limbo-end-top {
          right: 0;
        }
        /* the rocket: its nose is the altitude, so it crosses the line when
           the number does */
        .limbo-rocket {
          position: absolute;
          top: 2.25rem;
          left: var(--rocket);
          width: var(--limbo-rocket);
          height: var(--limbo-rail);
          display: flex;
          align-items: center;
          transform: translateX(-100%);
          color: var(--tixy-paper);
        }
        .limbo-rocket > svg {
          width: 100%;
          height: auto;
          max-height: 90%;
          overflow: visible;
        }
        .limbo-rocket[data-tone="loss"] {
          opacity: 0.55;
        }
        .limbo-rocket .limbo-flame {
          opacity: 0;
        }
        .limbo-rocket[data-rising] .limbo-flame {
          opacity: 1;
        }
        /* a short screen (a phone): a smaller plate and rail, so the whole
           screen and the controls under it stay on the page */
        @container (max-height: 26rem) {
          .limbo-screen {
            --limbo-plate: 4.5rem;
            gap: 0.5rem;
            padding-block: 0.5rem;
          }
          .limbo-readout-main {
            font-size: 1.75rem;
          }
          .limbo-number {
            font-size: clamp(3rem, min(20cqi, 18cqh), 9rem);
          }
        }
        @media (prefers-reduced-motion: no-preference) {
          .limbo-readout[data-tone="win"],
          .limbo-readout[data-tone="loss"],
          .limbo-number[data-tone="win"],
          .limbo-number[data-tone="loss"] {
            animation: arc-stub-pop var(--motion-reveal) var(--ease-spring) both;
          }
          /* crossing the line: the label and the number pop once */
          .limbo-rail[data-crossed] .limbo-line-tag,
          .limbo-number[data-crossed] {
            animation: arc-stub-pop var(--motion-reveal) var(--ease-spring) both;
          }
          .limbo-rocket[data-rising] .limbo-flame {
            animation: limbo-flame 0.12s linear infinite alternate;
          }
          @keyframes limbo-flame {
            from {
              transform: scaleX(0.7);
            }
            to {
              transform: scaleX(1.1);
            }
          }
        }
        .limbo-flame {
          transform-box: fill-box;
          transform-origin: right center;
        }
      `}</style>
    </div>
  );

  const action = (
    <MachineButton
      onClick={() => void handleRoll()}
      disabled={!affordable || wager < ARCADE_MIN_BET}
      aria-disabled={isRolling || undefined}
      aria-label={`launch, ${wager} tickets`}
    >
      launch
    </MachineButton>
  );

  // One control: quick targets, and custom for a typed one.
  const isPreset = TARGET_PRESETS.includes(safeTarget);
  const showField = customOpen || !isPreset;
  const controls = (
    <>
      <div className="limbo-targets">
        <MachineChoice<string | number>
          label="target"
          options={[
            ...TARGET_PRESETS.map((preset) => ({
              value: preset as string | number,
              label: <span className="arcade-num">{preset}×</span>,
            })),
            { value: "custom", label: "custom" },
          ]}
          value={showField ? "custom" : safeTarget}
          onChange={(next) => {
            if (next === "custom") {
              setCustomOpen(true);
              return;
            }
            setCustomOpen(false);
            commitTarget(String(next));
          }}
          disabled={isRolling}
        />
        {showField ? (
          <label className="limbo-field-box">
            <span className="sr-only">
              target, {LIMBO_MIN_TARGET} to {LIMBO_MAX_TARGET}
            </span>
            <input
              id="limbo-target"
              type="number"
              inputMode="decimal"
              min={LIMBO_MIN_TARGET}
              max={LIMBO_MAX_TARGET}
              step={0.01}
              value={targetText}
              disabled={isRolling}
              autoFocus={customOpen}
              onChange={(e) => setTargetText(e.target.value)}
              onBlur={(e) => commitTarget(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitTarget(e.currentTarget.value);
              }}
              className="arcade-num"
            />
            <span aria-hidden>×</span>
          </label>
        ) : null}
      </div>
      <style jsx global>{`
        /* five quick targets and custom: three to a row, so the deck never
           clips one */
        .limbo-targets .arc-machine-choice {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        .limbo-targets {
          width: 20rem;
          max-width: 100%;
        }
        .limbo-field-box {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          width: 9rem;
          min-height: 2.75rem;
          margin: 0.5rem 0 0 auto;
          padding: 0 0.75rem;
          border-radius: var(--tixy-radius-button-sm);
          background: var(--tixy-screen);
          color: var(--tixy-on-ink-2);
        }
        .limbo-field-box:focus-within {
          outline: 2px solid var(--tixy-paper);
          outline-offset: 2px;
        }
        .limbo-field-box input {
          width: 100%;
          min-width: 0;
          border: 0;
          background: transparent;
          text-align: right;
          font-size: 1rem;
          font-weight: 700;
          color: var(--tixy-paper);
          outline: none;
          appearance: textfield;
        }
        .limbo-field-box input::-webkit-inner-spin-button,
        .limbo-field-box input::-webkit-outer-spin-button {
          appearance: none;
        }
        .limbo-field-box input:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }
      `}</style>
    </>
  );

  const receipt =
    finalRoll != null && phase === "result" ? (
      <ArcadeWagerResultPlate
        result={{
          payout: lastPayout ?? 0,
          stake: settledWager,
          multiplier: rollWon ? lastPaidMultiplier : 0,
        }}
        kicker="limbo"
        headline={`${finalRoll.toFixed(2)}×`}
        detail={`target ${settledTarget.toFixed(2)}×`}
        fairness={{ seedHash: null, revealedSeed }}
        achievements={achievements}
        roundId={roundId ?? undefined}
        sound={false}
      />
    ) : null;

  return (
    <GameShell
      game="limbo"
      stat={<GameStat value={`${safeTarget}×`} label="target" />}
      howTo={HOW_TO}
    >
      <ArcadeMachine
        name="limbo"
        glass={
          <MachineGlass
            name="limbo"
            rules={["Reach your target to win your bet times the target."]}
            paytable={[
              { label: "chance", value: `${winChancePct.toFixed(1)}%` },
              {
                label: "pays",
                value: `${safeTarget.toFixed(2)}×`,
                lit: phase === "result" && rollWon === true,
              },
              { label: "on a win", value: potentialPayout.toLocaleString() },
            ]}
          />
        }
        action={action}
        bet={{ value: wager, onChange: setWager, balance, disabled: isRolling }}
        controls={controls}
        receipt={receipt}
        receiptKey={roundId}
        notice={error}
      >
        {screen}
      </ArcadeMachine>
    </GameShell>
  );
}

/**
 * Where the rail ends: the target squared (but never closer than half a point
 * past the target). The rail is a log scale from 1× to there, so the target
 * is in the middle and the climb that decides the round fills the rail.
 * Purely cosmetic, never feeds the payout.
 */
function railEnd(target: number): number {
  return Math.max(target * target, target + 0.5);
}

/** Map a multiplier to a 0..100 rail position, past the end pinned at 100. */
function railPct(multiplier: number, target: number): number {
  const pct =
    (Math.log(Math.max(1, multiplier)) / Math.log(railEnd(target))) * 100;
  return Math.min(100, Math.max(0, pct));
}

/** The end of the rail for the label: whole when it is, else one decimal. */
function formatRailEnd(value: number): string {
  if (value >= 100) return Math.round(value).toLocaleString("en-US");
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(value >= 10 ? 0 : 1);
}

/** A flat rocket pointing right: a paper body, an ink window, two fins and a
 *  flame while it climbs. Drawn in paper on the screen, so it reads as a
 *  rocket and not a leaf, at any size. */
function RocketIcon() {
  return (
    <svg viewBox="-16 0 94 32" aria-hidden>
      <path
        className="limbo-flame"
        d="M8 10 L-14 16 L8 22 Z"
        fill="var(--tixy-on-ink-2)"
      />
      <path
        d="M12 8 L3 0 L24 8 Z M12 24 L3 32 L24 24 Z"
        fill="var(--tixy-on-ink-2)"
      />
      <path
        d="M8 6 H38 C52 6 62 12 66 16 C62 20 52 26 38 26 H8 Z"
        fill="currentColor"
      />
      <circle cx="42" cy="16" r="5" fill="var(--tixy-screen)" />
    </svg>
  );
}
