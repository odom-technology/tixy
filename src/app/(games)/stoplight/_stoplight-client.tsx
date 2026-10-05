"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import "./_stoplight-midway.css";
import {
  GameShell,
  GameStat,
  type GameHowTo,
} from "@/features/arcade/components/shell/game-shell";
import {
  ArcadeMachine,
  MachineButton,
  MachineGlass,
  machineError,
  useMachineBet,
  useMachineKey,
} from "@/features/arcade/components/wagers/arcade-machine";
import { ArcadeWagerResultPlate } from "@/features/arcade/components/results/arcade-run-result";
import { useGameFeedback } from "@/features/arcade/lib/use-game-feedback";
import { SoundManager } from "@/features/arcade/lib/sound-manager";
import { playHaptic } from "@/features/arcade/lib/game-haptics";
import { useWagerSession } from "@/features/arcade/lib/use-wager-session";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type GamePhase = "idle" | "spinning" | "result";

type SettleResponse = {
  payout: number;
  multiplier: number;
  seed: number;
  roundId?: string | null;
};

type WalletData = {
  credits: number;
};

type Segment = {
  label: string;
  multiplier: number;
  weight: number;
  color: string;
};

// Enamel-painted lanes. Colors are flat, saturated paints in the Midway
// red / amber / teal family (NO glow). The "Lose" lane is bare dark wood;
// the rare high lanes climb from amber into the deep teal/prize paints so a
// big hit reads richer. Only `color` is cosmetic — label/multiplier/weight
// are gameplay/RNG and must NOT change.
const SEGMENTS: Segment[] = [
  { label: "Lose", multiplier: 0, weight: 47.5, color: "#1b130b" },
  { label: "0.5x", multiplier: 0.5, weight: 20, color: "#c47c1f" },
  { label: "1x", multiplier: 1, weight: 14.5, color: "#f2a33c" },
  { label: "2x", multiplier: 2, weight: 9, color: "#2fb8a6" },
  { label: "3x", multiplier: 3, weight: 4, color: "#1d8579" },
  { label: "5x", multiplier: 5, weight: 3, color: "#c73538" },
  { label: "10x", multiplier: 10, weight: 1.5, color: "#98262a" },
  { label: "25x", multiplier: 25, weight: 0.5, color: "#f7bd5e" },
];

const TOTAL_WEIGHT = SEGMENTS.reduce((sum, s) => sum + s.weight, 0); // 100

/** A lane's name on the wheel and the glass: its multiplier. */
function laneLabel(seg: Segment): string {
  return seg.multiplier === 0 ? "lose" : `${seg.multiplier}×`;
}

const HOW_TO: GameHowTo = {
  lines: [
    "Pick a bet and spin the wheel.",
    "It stops on one of 8 lanes, from 47.5% of the wheel for no win to 0.5% for 25×.",
    "The lanes pay 0.5×, 1×, 2×, 3×, 5×, 10× or 25× the bet.",
  ],
};

/** Pre-compute start/end angles (degrees) for each segment. 0 deg = top (12 o'clock). */
function computeSegmentAngles(): { startDeg: number; endDeg: number }[] {
  const angles: { startDeg: number; endDeg: number }[] = [];
  let cumulative = 0;
  for (const seg of SEGMENTS) {
    const startDeg = (cumulative / TOTAL_WEIGHT) * 360;
    cumulative += seg.weight;
    const endDeg = (cumulative / TOTAL_WEIGHT) * 360;
    angles.push({ startDeg, endDeg });
  }
  return angles;
}

const SEGMENT_ANGLES = computeSegmentAngles();

/** Build a CSS conic-gradient string for the wheel. */
function buildConicGradient(): string {
  const stops: string[] = [];
  let cumPct = 0;
  for (const seg of SEGMENTS) {
    const pct = (seg.weight / TOTAL_WEIGHT) * 100;
    stops.push(`${seg.color} ${cumPct}% ${cumPct + pct}%`);
    cumPct += pct;
  }
  // conic-gradient starts at top (from 0deg) and goes clockwise
  return `conic-gradient(from 0deg, ${stops.join(", ")})`;
}

/** Duration & easing for the spin animation */
const SPIN_DURATION_MS = 4000;
const SPIN_EASING = "cubic-bezier(0.17, 0.67, 0.12, 0.99)";
const FULL_ROTATIONS = 5;

/** Peg-click schedule for the flapper as the wheel decelerates. Tick times
    follow the inverse of the spin's ease-out, so clicks start dense and
    stretch out as the wheel loses speed. */
const SPIN_TICK_COUNT = 14;
function spinTickTimes(durationMs: number): number[] {
  const times: number[] = [];
  for (let i = 1; i <= SPIN_TICK_COUNT; i++) {
    const p = i / SPIN_TICK_COUNT;
    times.push(Math.round(durationMs * (1 - Math.pow(1 - p, 1 / 3))));
  }
  return times;
}

/** True when the user has asked for reduced motion. The wheel then settles
    straight to the result lane instead of playing the long spin. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function StoplightClient() {
  const { trigger: triggerFeedback } = useGameFeedback();
  // Wallet
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [walletLoading, setWalletLoading] = useState(true);

  const balance = walletLoading ? null : (wallet?.credits ?? null);

  // Game state
  const [phase, setPhase] = useState<GamePhase>("idle");

  // Bet
  const [bet, setBet] = useMachineBet(balance, 10, {
    locked: phase === "spinning",
  });
  const [roundId, setRoundId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Wheel rotation
  const [rotation, setRotation] = useState(0);
  const [animating, setAnimating] = useState(false);

  // Result
  const [lastPayout, setLastPayout] = useState<number | null>(null);
  const [lastMultiplier, setLastMultiplier] = useState<number | null>(null);
  const [settledBet, setSettledBet] = useState(10);
  const [landedSegmentIndex, setLandedSegmentIndex] = useState<number | null>(
    null,
  );

  // Provably fair (hook also owns the session/settle round-trips; the
  // wallet stays hand-rolled because its null state drives loading UI)
  const {
    revealedSeed,
    setRevealedSeed,
    start: startSession,
    settle: settleSession,
    achievements,
  } = useWagerSession("arcade-stoplight");

  // Ref to track current base rotation (so sequential spins accumulate)
  const baseRotation = useRef(0);
  // Peg-click + settle timers for the current spin — cleared on unmount so a
  // queued sound never fires after the cabinet has left the screen.
  const spinTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const mountedRef = useRef(true);

  const clearSpinTimers = useCallback(() => {
    for (const id of spinTimers.current) clearTimeout(id);
    spinTimers.current = [];
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearSpinTimers();
    };
  }, [clearSpinTimers]);

  // Memoize the conic gradient
  const conicGradient = useMemo(() => buildConicGradient(), []);

  // ---------------------------------------------------------------------------
  // Load wallet
  // ---------------------------------------------------------------------------

  const loadWallet = useCallback(async () => {
    try {
      const res = await fetch("/api/store/inventory", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load wallet");
      const data = await res.json();
      setWallet({
        credits: data.wallet?.credits ?? 0,
      });
    } catch {
      setWallet({ credits: 0 });
    } finally {
      setWalletLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWallet();
  }, [loadWallet]);

  // ---------------------------------------------------------------------------
  // Find the segment for a given multiplier
  // ---------------------------------------------------------------------------

  function findSegmentIndex(multiplier: number): number {
    const idx = SEGMENTS.findIndex((s) => s.multiplier === multiplier);
    return idx >= 0 ? idx : 0; // fallback to Lose
  }

  // ---------------------------------------------------------------------------
  // Calculate target angle for a segment
  // The pointer is at the top (0 degrees). The wheel rotates clockwise.
  // We need the wheel to stop such that the target segment is under the pointer.
  //
  // The conic-gradient draws segments starting from 12 o'clock going clockwise.
  // When we rotate the wheel by X degrees clockwise, the segment that was at
  // X degrees now appears at the top (under the pointer).
  //
  // So to land on a segment whose midpoint is at angleDeg from the top,
  // we rotate the wheel by angleDeg (plus full rotations).
  // ---------------------------------------------------------------------------

  function computeTargetRotation(segmentIndex: number): number {
    const { startDeg, endDeg } = SEGMENT_ANGLES[segmentIndex]!;
    const midDeg = (startDeg + endDeg) / 2;
    const segSpan = endDeg - startDeg;
    const jitter = (Math.random() - 0.5) * segSpan * 0.6;

    // The angle the wheel must show at top to land on this segment.
    // conic-gradient paints clockwise from 0°. CSS rotate(X) rotates CW.
    // After rotating by X total, the segment originally at (X % 360)° is at
    // the bottom, and the segment at (360 - X%360)° is at the top (pointer).
    // So to put midDeg at the pointer: (360 - totalRotation%360) ≡ midDeg
    //   → totalRotation%360 = 360 - midDeg
    const desiredRemainder = (((360 - (midDeg + jitter)) % 360) + 360) % 360;
    const currentRemainder = ((baseRotation.current % 360) + 360) % 360;
    // How many additional degrees to go from current position to the target
    const delta = (((desiredRemainder - currentRemainder) % 360) + 360) % 360;

    return FULL_ROTATIONS * 360 + delta;
  }

  // ---------------------------------------------------------------------------
  // Spin logic
  // ---------------------------------------------------------------------------

  const handleSpin = useCallback(async () => {
    if (phase === "spinning") return;
    if (!wallet || wallet.credits < bet) {
      setError(`You need ${bet} tickets for this bet.`);
      return;
    }

    setError(null);
    setPhase("spinning");
    setSettledBet(bet);
    setRoundId(null);
    setLastPayout(null);
    setLastMultiplier(null);
    setLandedSegmentIndex(null);
    setRevealedSeed(null);
    SoundManager.play("arcadeSpin");
    playHaptic("tap");

    // Optimistically deduct bet
    setWallet((prev) =>
      prev ? { ...prev, credits: prev.credits - bet } : prev,
    );

    try {
      // 1. Create session
      const session = await startSession(bet);
      if (!mountedRef.current) return;
      if (!session.ok) {
        throw new Error(
          machineError(session.error, "The machine could not start the spin."),
        );
      }

      // 2. Immediately settle (single-action game)
      const settled = await settleSession<SettleResponse>();
      if (!mountedRef.current) return;
      if (!settled.ok) {
        throw new Error(
          machineError(settled.error, "The spin did not go through. Try again."),
        );
      }
      const settleData = settled.data;

      // Determine which segment the multiplier maps to
      const segIdx = findSegmentIndex(settleData.multiplier);

      const reduced = prefersReducedMotion();

      // Compute where the wheel must come to rest. Under reduced motion we
      // settle straight to the lane (no extra full rotations, no transition);
      // otherwise we play the long eased spin.
      const targetRot = reduced
        ? ((computeTargetRotation(segIdx) % 360) + 360) % 360
        : computeTargetRotation(segIdx);
      const newAbsoluteRotation = baseRotation.current + targetRot;

      setAnimating(!reduced);
      setRotation(newAbsoluteRotation);

      // Flapper clicks over the lane pegs while the wheel decelerates.
      // Skipped under reduced motion — the wheel settles straight to the lane.
      clearSpinTimers();
      if (!reduced) {
        for (const at of spinTickTimes(SPIN_DURATION_MS)) {
          spinTimers.current.push(
            setTimeout(
              () => SoundManager.play("arcadeReelTick", { volume: 0.5 }),
              at,
            ),
          );
        }
      }

      const settleDelay = reduced ? 200 : SPIN_DURATION_MS + 200;

      // After the spin animation completes (or immediately, reduced-motion),
      // show the result.
      const settleTimer = setTimeout(() => {
        baseRotation.current = newAbsoluteRotation;
        setAnimating(false);
        setLastPayout(settleData.payout);
        setLastMultiplier(settleData.multiplier);
        setLandedSegmentIndex(segIdx);
        setRoundId(settleData.roundId ?? null);
        setPhase("result");
        triggerFeedback(
          settleData.payout <= 0
            ? "loss"
            : settleData.multiplier >= 5
              ? "jackpot"
              : "round-win",
        );

        // The wheel clunks to a stop, then the outcome jingle + settle haptic
        SoundManager.play("arcadeReelStop");
        if (settleData.multiplier > 0) {
          playHaptic("success");
        } else {
          playHaptic("failure");
        }

        // Refresh wallet to get accurate balance
        void loadWallet();
      }, settleDelay);
      spinTimers.current.push(settleTimer);
    } catch (err) {
      if (!mountedRef.current) return;
      const message =
        err instanceof Error && !(err instanceof TypeError)
          ? err.message
          : "The machine lost its connection. Try again.";
      setError(message);
      setPhase("idle");
      // Restore wallet on error
      void loadWallet();
    }
  }, [
    phase,
    wallet,
    bet,
    loadWallet,
    startSession,
    settleSession,
    setRevealedSeed,
    clearSpinTimers,
    triggerFeedback,
  ]);

  // Space spins, also straight from a result
  useMachineKey(
    useMemo(
      () => (phase === "spinning" ? null : () => void handleSpin()),
      [phase, handleSpin],
    ),
  );

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const isSpinning = phase === "spinning";
  const isResult = phase === "result";
  const isWin = isResult && lastMultiplier != null && lastMultiplier > 0;
  const affordable = balance != null && bet <= balance;

  const statusLine = isSpinning
    ? "The wheel is spinning."
    : isResult
      ? isWin
        ? `${lastMultiplier}× for ${(lastPayout ?? 0).toLocaleString()} tickets.`
        : "No win this spin."
      : "Spin to stop on a lane.";

  // ── Screen: the wheel ─────────────────────────────────────────────────────
  const screen = (
    <div className="arc-machine-fit stoplight-midway">
      <p className="arc-machine-status" role="status" aria-live="polite">
        {statusLine}
      </p>

      {/* Wheel + pointer — decorative; the status line, the receipt and
          the glass carry the same information for screen readers. */}
      <div
        className={`sl-wheel-wrap relative mx-auto ${
          isSpinning && !animating ? "sl-winding" : ""
        }`}
        aria-hidden="true"
      >
        {/* Fixed cream pointer (flapper) at top — a physical key-faced peg
            that the lanes click past. Layered: a dark wooden base behind a
            cream blade, capped with a bolt head. No glow. */}
        <div className="sl-pointer">
          <span className="sl-pointer-base" aria-hidden />
          <span className="sl-pointer-blade" aria-hidden />
          <span className="sl-pointer-bolt" aria-hidden />
        </div>

        {/* Wooden cabinet ring around the enamel wheel — hard bevel, no glow.
            data-result lets the landed lane tint the inner rim faintly. */}
        <div
          className="sl-ring relative aspect-square w-full rounded-full"
          data-result={isResult || undefined}
        >
          {/* Wheel */}
          <div
            className="sl-wheel absolute inset-[6px] rounded-full"
            style={{
              background: conicGradient,
              transform: `rotate(${rotation}deg)`,
              transition: animating
                ? `transform ${SPIN_DURATION_MS}ms ${SPIN_EASING}`
                : "none",
            }}
          >
            {/* Divider pegs at each lane boundary — enamel-painted seams
                between weighted lanes. They rotate with the wheel. */}
            {SEGMENT_ANGLES.map(({ startDeg }, i) => (
              <div
                key={`spoke-${i}`}
                className="sl-spoke absolute left-1/2 top-1/2 h-1/2 w-px"
                style={{
                  transform: `translateX(-50%) rotate(${startDeg + 180}deg)`,
                  transformOrigin: "top center",
                }}
              />
            ))}

            {/* Lane labels on the wheel — mono numerics on the enamel paint.
                The final rotate cancels BOTH the segment angle and the live
                wheel rotation (same transition as the wheel, so the two
                interpolations stay in lockstep) — labels remain upright
                mid-spin and, more importantly, at whatever angle the wheel
                lands on. */}
            {SEGMENTS.map((seg, i) => {
              const { startDeg, endDeg } = SEGMENT_ANGLES[i]!;
              const midAngle = (startDeg + endDeg) / 2;
              // Lanes under 3% are too thin for a label; the glass
              // prints every lane.
              if (seg.weight < 3) return null;
              // Position labels at ~64% radius from center: the outer
              // layer turns to the lane, the label counter-turns.
              return (
                <div
                  key={i}
                  className="absolute inset-0"
                  style={{ transform: `rotate(${midAngle}deg)` }}
                >
                  <span
                    className="sl-lane-label arcade-num absolute left-1/2 top-[18%] block text-[11px] sm:text-xs"
                    style={{
                      transform: `translate(-50%, -50%) rotate(${-midAngle - rotation}deg)`,
                      transition: animating
                        ? `transform ${SPIN_DURATION_MS}ms ${SPIN_EASING}`
                        : "none",
                    }}
                  >
                    {laneLabel(seg)}
                  </span>
                </div>
              );
            })}

            {/* Center hub — cream key-faced cap with a bolt, over the pegs.
                Counter-rotates against the wheel so "spin" stays upright. */}
            <div
              className="sl-hub absolute left-1/2 top-1/2 h-12 w-12 rounded-full sm:h-16 sm:w-16"
              style={{
                transform: `translate(-50%, -50%) rotate(${-rotation}deg)`,
                transition: animating
                  ? `transform ${SPIN_DURATION_MS}ms ${SPIN_EASING}`
                  : "none",
              }}
            >
              <span className="sl-hub-bolt" aria-hidden />
              <span className="sl-hub-label arcade-num">spin</span>
            </div>
          </div>
        </div>
      </div>

    </div>
  );

  const glass = (
    <MachineGlass
      name="lucky wheel"
      rules={["The wheel stops on one lane. Each lane's share of the wheel is its chance."]}
      paytable={SEGMENTS.map((seg, i) => ({
        label: `${seg.weight}%`,
        value: seg.multiplier === 0 ? "0" : `${seg.multiplier}×`,
        lit: landedSegmentIndex === i,
      }))}
    />
  );

  const action = (
    <MachineButton
      onClick={() => void handleSpin()}
      disabled={!affordable}
      aria-disabled={isSpinning || undefined}
      aria-label={`spin, ${bet} tickets`}
    >
      spin
    </MachineButton>
  );

  const receipt = isResult ? (
    <ArcadeWagerResultPlate
      result={{
        payout: isWin ? (lastPayout ?? 0) : 0,
        stake: settledBet,
        multiplier: isWin ? lastMultiplier : 0,
      }}
      kicker="lucky wheel"
      headline={isWin ? `${lastMultiplier}×` : "no win"}
      fairness={{ seedHash: null, revealedSeed }}
      achievements={achievements}
      roundId={roundId ?? undefined}
      sound={false}
    />
  ) : null;

  return (
    <GameShell
      game="stoplight"
      stat={<GameStat value="25×" label="top" />}
      howTo={HOW_TO}
      tickets={balance ?? undefined}
    >
      <ArcadeMachine
        name="lucky wheel"
        glass={glass}
        action={action}
        bet={{
          value: bet,
          onChange: setBet,
          balance,
          disabled: isSpinning,
        }}
        receipt={receipt}
        receiptKey={roundId}
        notice={error}
      >
        {screen}
      </ArcadeMachine>
    </GameShell>
  );
}
