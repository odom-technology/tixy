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
import { ArcadePayoutAmount } from "@/features/arcade/components/wagers/arcade-wager-shell";
import { ArcadeWagerResultPlate } from "@/features/arcade/components/results/arcade-run-result";
import { useGameFeedback } from "@/features/arcade/lib/use-game-feedback";
import { SoundManager } from "@/features/arcade/lib/sound-manager";
import { playHaptic } from "@/features/arcade/lib/game-haptics";
import {
  createGameFrameLoop,
  type GameFrameLoop,
} from "@/features/arcade/lib/game-frame-loop";
import { useWagerSession } from "@/features/arcade/lib/use-wager-session";
import { ARCADE_MIN_BET } from "@/server/arcade/arcade-constants";
import {
  WHEEL_SEGMENT_COUNTS,
  WHEEL_RISKS,
  getWheelLayout,
  getWheelMaxMultiplier,
  type WheelSegmentCount,
  type WheelRisk,
} from "@/server/arcade/wager-games/prize-wheel";
import {
  DEFAULT_PRIZE_WHEEL_THEME,
  buildPrizeWheelTheme,
  segmentBand,
  type PrizeWheelTheme,
} from "./_prize-wheel-theme";

type InventoryEquipResponse = {
  equipped?: Array<{
    slot?: string;
    item?: { assetRef?: Record<string, unknown> | null } | null;
  }>;
};

/* ========================================================================== */
/*  Helpers                                                                    */
/* ========================================================================== */

const HOW_TO: GameHowTo = {
  lines: [
    "Pick a bet, how many segments and a risk, then spin.",
    "The wheel stops on one segment, and its multiplier times your bet is the payout.",
    "High risk has one prize segment: on 10 segments it pays 9.9×, on 50 it pays 49.5×.",
  ],
};

/** A server or rules error with a sentence ready for the notice. */
class SpinError extends Error {}

const SPIN_TURNS = 6; // full rotations before the wheel settles
const SPIN_MS = 3200; // matches the CSS transition duration below
const LAND_REVEAL_MS = 350; // landing kick → readout/result plate delay
const IMPACT_MS = 520; // pointer-kick / cabinet-shake duration
const CONFETTI_MS = 1100; // big-win burst lifetime before it self-cleans
const TICK_MIN_MS = 60; // SoundManager enforces a 50ms floor; stay above it
const TICK_END_PAD_MS = 180; // ticks go quiet just before the wheel settles

/**
 * Easing of the .pw-wheel-rot CSS transition (cubic-bezier(0.17, 0.72, 0.14, 1))
 * mirrored in JS so passing-segment ticks track the wheel's actual rotation
 * instead of running on a guessed timer. Presentation only.
 */
const SPIN_BEZIER = { x1: 0.17, y1: 0.72, x2: 0.14, y2: 1 } as const;

function spinEase(t: number): number {
  const { x1, y1, x2, y2 } = SPIN_BEZIER;
  const ax = 1 - 3 * x2 + 3 * x1;
  const bx = 3 * x2 - 6 * x1;
  const cx = 3 * x1;
  const ay = 1 - 3 * y2 + 3 * y1;
  const by = 3 * y2 - 6 * y1;
  const cy = 3 * y1;
  const xAt = (u: number) => ((ax * u + bx) * u + cx) * u;
  const yAt = (u: number) => ((ay * u + by) * u + cy) * u;
  // x(u) is monotonic for these control points — bisect to solve x(u) = t.
  let lo = 0;
  let hi = 1;
  let u = t;
  for (let i = 0; i < 20; i += 1) {
    const err = xAt(u) - t;
    if (Math.abs(err) < 1e-4) break;
    if (err > 0) hi = u;
    else lo = u;
    u = (lo + hi) / 2;
  }
  return yAt(u);
}

/**
 * First mulberry32 draw for a seed — mirrors resolveWheel() on the server so the
 * client can reconstruct the winning segment for the spin. The authoritative
 * index still comes from the settle response; this is only a fallback.
 */
function firstDraw(seed: number): number {
  let s = seed | 0;
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function indexFromSeed(seed: number, count: number): number {
  return Math.floor(firstDraw(seed) * count);
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Format a multiplier for a wheel label / chip. */
function fmtMult(m: number): string {
  return Number.isInteger(m) ? String(m) : m.toFixed(2).replace(/0$/, "");
}

/* ========================================================================== */
/*  Component                                                                   */
/* ========================================================================== */

export default function PrizeWheelClient() {
  const { trigger: triggerFeedback } = useGameFeedback();
  const {
    wallet,
    loaded: walletLoaded,
    refresh: refreshWallet,
    adjustCredits,
  } = useGamesWallet();
  const balance = walletLoaded ? wallet.credits : null;
  const [isSpinning, setIsSpinning] = useState(false);
  const [wager, setWager] = useMachineBet(balance, 10, { locked: isSpinning });
  const [segments, setSegments] = useState<WheelSegmentCount>(20);
  const [risk, setRisk] = useState<WheelRisk>("medium");
  const [error, setError] = useState<string | null>(null);
  const [roundId, setRoundId] = useState<string | null>(null);
  // The wheel the last spin was bought on; the receipt prints it.
  const [settledWheel, setSettledWheel] = useState("");

  // Accumulated wheel rotation (deg) — keeps spinning forward each round.
  const [wheelDeg, setWheelDeg] = useState(0);
  // Settled result.
  const [resultIndex, setResultIndex] = useState<number | null>(null);
  const [resultMult, setResultMult] = useState<number | null>(null);
  const [lastPayout, setLastPayout] = useState<number | null>(null);
  const [settledWager, setSettledWager] = useState(10);
  const [resultWon, setResultWon] = useState<boolean | null>(null);
  // Landing kick (pointer bounce + cabinet shake) and big-win confetti burst.
  const [impact, setImpact] = useState(false);
  const [confettiKey, setConfettiKey] = useState(0);

  const spinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const impactTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confettiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickLoop = useRef<GameFrameLoop | null>(null);
  const mountedRef = useRef(true);
  // Mirror of the committed wheelDeg so the tick loop can read the exact
  // from/to rotation without depending on functional-setState timing.
  const rotRef = useRef(0);

  const [theme, setTheme] = useState<PrizeWheelTheme>(
    DEFAULT_PRIZE_WHEEL_THEME,
  );
  const layout = useMemo(
    () => getWheelLayout(segments, risk),
    [segments, risk],
  );
  const maxMult = useMemo(
    () => getWheelMaxMultiplier(segments, risk),
    [segments, risk],
  );
  const winSegments = useMemo(
    () => layout.filter((m) => m > 0).length,
    [layout],
  );

  const {
    revealedSeed,
    start: startSession,
    settle: settleSession,
    achievements,
  } = useWagerSession("arcade-prize-wheel");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (spinTimer.current) clearTimeout(spinTimer.current);
      if (stageTimer.current) clearTimeout(stageTimer.current);
      if (impactTimer.current) clearTimeout(impactTimer.current);
      if (confettiTimer.current) clearTimeout(confettiTimer.current);
      tickLoop.current?.destroy();
      tickLoop.current = null;
    };
  }, []);

  // Load equipped cosmetics (best-effort); empty loadout keeps the Midway default.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/store/inventory?gameType=prize-wheel", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const payload = (await res.json()) as InventoryEquipResponse;
        if (!cancelled) setTheme(buildPrizeWheelTheme(payload.equipped ?? []));
      } catch {
        /* default theme stays */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Changing the wheel config clears the prior result so labels stay coherent.
  useEffect(() => {
    setResultIndex(null);
    setResultMult(null);
    setResultWon(null);
    setLastPayout(null);
  }, [segments, risk]);

  // ─── Spin ────────────────────────────────────────────────────────────────
  const handleSpin = useCallback(async () => {
    if (isSpinning) return;
    if (wager < ARCADE_MIN_BET) {
      setError(`The smallest bet is ${ARCADE_MIN_BET} tickets.`);
      return;
    }
    if (balance == null || wager > balance) {
      setError(`You need ${wager} tickets for this bet.`);
      return;
    }

    // Passing-segment tick loop — samples the same eased rotation the CSS
    // transition plays and ticks (quietly) each time a wedge boundary passes
    // the fixed pointer. Presentation only; never faster than TICK_MIN_MS.
    const stopTicks = () => {
      tickLoop.current?.destroy();
      tickLoop.current = null;
    };
    const startTicks = (fromDeg: number, toDeg: number, count: number) => {
      stopTicks();
      const seg = 360 / count;
      const t0 = performance.now();
      let boundary = Math.floor(fromDeg / seg);
      let lastTickAt = 0;
      const frameLoop = createGameFrameLoop({
        simulate: () => true,
        render: (_alpha, info) => {
          const now = info.nowMs;
          const elapsed = now - t0;
          if (elapsed >= SPIN_MS - TICK_END_PAD_MS) {
            frameLoop.destroy(); // go quiet just before the settle
            if (tickLoop.current === frameLoop) tickLoop.current = null;
            return;
          }
          const deg =
            fromDeg +
            (toDeg - fromDeg) * spinEase(Math.min(elapsed / SPIN_MS, 1));
          const b = Math.floor(deg / seg);
          if (b !== boundary) {
            boundary = b;
            if (now - lastTickAt >= TICK_MIN_MS) {
              lastTickAt = now;
              SoundManager.play("arcadeTick", { volume: 0.25 });
            }
          }
        },
      });
      tickLoop.current = frameLoop;
      frameLoop.start();
    };

    setError(null);
    setIsSpinning(true);
    setSettledWager(wager);
    setSettledWheel(`${risk}, ${segments} segments`);
    setRoundId(null);
    setResultIndex(null);
    setResultMult(null);
    setResultWon(null);
    setLastPayout(null);
    setImpact(false);
    setConfettiKey(0);
    stopTicks();
    if (stageTimer.current) clearTimeout(stageTimer.current);
    if (impactTimer.current) clearTimeout(impactTimer.current);
    if (confettiTimer.current) clearTimeout(confettiTimer.current);
    SoundManager.play("arcadeSpin");
    playHaptic("tap");

    // Optimistic debit.
    adjustCredits(-wager);

    const count = segments;
    const currentRisk = risk;
    const currentWager = wager;
    const reduced = prefersReducedMotion();

    try {
      const session = await startSession(currentWager, {
        segments: count,
        risk: currentRisk,
      });
      if (!mountedRef.current) return;
      if (!session.ok)
        throw new SpinError(
          machineError(session.error, "The machine could not start the round."),
        );

      const settled = await settleSession<{
        seed: number;
        payout: number;
        multiplier: number;
        index?: number;
        won?: boolean;
        roundId?: string | null;
      }>();
      if (!mountedRef.current) return;
      if (!settled.ok)
        throw new SpinError(
          machineError(settled.error, "The spin did not go through. Try again."),
        );
      const data = settled.data;

      // Authoritative winning segment: the server's index (fall back to a
      // reconstruction from the revealed seed if it's somehow absent).
      const index =
        typeof data.index === "number"
          ? data.index
          : indexFromSeed(data.seed, count);
      const mult = getWheelLayout(count, currentRisk)[index] ?? data.multiplier;
      const won = data.payout > 0;

      // Rotate so segment `index` centre lands under the fixed top pointer.
      // Same aiming math as before, computed against the rotRef mirror so the
      // tick loop can share the exact from/to rotation.
      const seg = 360 / count;
      const landing = (360 - (index + 0.5) * seg) % 360; // target rot mod 360
      const prevDeg = rotRef.current;
      const base = prevDeg - (((prevDeg % 360) + 360) % 360);
      let nextDeg = base + 360 * SPIN_TURNS + landing;
      while (nextDeg <= prevDeg) nextDeg += 360;
      rotRef.current = nextDeg;
      setWheelDeg(nextDeg);

      const reveal = () => {
        setResultMult(mult);
        setResultWon(won);
        setLastPayout(data.payout);
        setRoundId(data.roundId ?? null);
        playHaptic(won ? "success" : "failure");
        if (won) {
          const big = mult >= 10;
          SoundManager.play(big ? "arcadeBigWin" : "arcadeWin");
          if (big && !reduced) {
            // Restrained confetti burst around the wheel; self-cleans.
            setConfettiKey((k) => k + 1);
            if (confettiTimer.current) clearTimeout(confettiTimer.current);
            confettiTimer.current = setTimeout(
              () => setConfettiKey(0),
              CONFETTI_MS,
            );
          }
        } else {
          triggerFeedback("loss");
        }
        void refreshWallet();
        setIsSpinning(false);
      };

      // Landing moment: clack + pointer kick + winning-wedge highlight first,
      // then the readout / result plate a beat later.
      const land = () => {
        stopTicks();
        SoundManager.play("arcadeReelStop");
        playHaptic("medium");
        setResultIndex(index);
        setImpact(true);
        impactTimer.current = setTimeout(() => setImpact(false), IMPACT_MS);
        stageTimer.current = setTimeout(reveal, LAND_REVEAL_MS);
      };

      if (reduced) {
        setResultIndex(index);
        reveal();
      } else {
        startTicks(prevDeg, nextDeg, count);
        spinTimer.current = setTimeout(land, SPIN_MS);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof SpinError
          ? err.message
          : "The machine lost its connection. Try again.",
      );
      void refreshWallet();
      setIsSpinning(false);
    }
  }, [
    isSpinning,
    wager,
    balance,
    segments,
    risk,
    adjustCredits,
    startSession,
    settleSession,
    refreshWallet,
    triggerFeedback,
  ]);

  // Space spins (the machine hook ignores presses on controls).
  useMachineKey(useMemo(() => () => void handleSpin(), [handleSpin]));

  // ─── Computed ──────────────────────────────────────────────────────────
  const affordable = balance != null && wager <= balance;
  const settled = resultIndex != null && lastPayout != null && !isSpinning;
  /** Each multiplier on this wheel and how many segments carry it. */
  const glassRows = useMemo(() => {
    const counts = new Map<number, number>();
    for (const m of layout) counts.set(m, (counts.get(m) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([m, n]) => ({
        label: `${n} of ${segments}`,
        value: `${fmtMult(m)}×`,
        lit: settled && resultMult === m,
      }));
  }, [layout, segments, settled, resultMult]);

  const screen = (
    <div className="arc-machine-fit pw-well">
      <PrizeWheel
        layout={layout}
        theme={theme}
        rotation={wheelDeg}
        spinning={isSpinning}
        landed={impact}
        burstKey={confettiKey}
        resultIndex={resultIndex}
        maxMult={maxMult}
      />

      <div className="mt-4 flex h-10 flex-col items-center justify-center">
        {resultIndex != null && resultMult != null ? (
          <p
            key={`${resultIndex}-${resultWon}`}
            className={`pw-readout arcade-num text-2xl leading-none font-bold sm:text-3xl ${
              resultWon ? "text-prize-text" : "text-danger-text"
            }`}
          >
            {fmtMult(resultMult)}×
            <span className="ml-2 align-middle text-xs font-semibold">
              {resultWon ? (
                <>
                  Won <ArcadePayoutAmount value={lastPayout ?? 0} /> tickets.
                </>
              ) : (
                "No win."
              )}
            </span>
          </p>
        ) : (
          <p className="arc-machine-status">
            {isSpinning
              ? "The wheel is spinning."
              : "Spin for the multiplier the pointer lands on."}
          </p>
        )}
      </div>

      <style jsx global>{`
        .arc-shell[data-game="prize-wheel"] .arc-machine-frame:not([data-wide]) {
          --machine-screen-min: 18rem;
        }
        .pw-well {
          background:
            radial-gradient(120% 90% at 50% 0%, #ffffff08, transparent 60%),
            var(--screen-well);
        }
        .pw-wheel-rot {
          transition: transform ${SPIN_MS}ms cubic-bezier(0.17, 0.72, 0.14, 1);
          transform-box: fill-box;
          transform-origin: center;
        }
        .pw-readout {
          text-shadow: 0 1px 8px rgba(0, 0, 0, 0.6);
          animation: pw-pop var(--motion-reveal, 240ms)
            var(--ease-spring, ease-out);
        }
        @keyframes pw-pop {
          0% {
            transform: scale(0.7);
            opacity: 0;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pw-wheel-rot {
            transition: none;
          }
          .pw-readout {
            animation: none;
          }
        }
      `}</style>
    </div>
  );

  const action = (
    <MachineButton
      onClick={() => void handleSpin()}
      disabled={!affordable || wager < ARCADE_MIN_BET}
      aria-disabled={isSpinning || undefined}
      aria-label={`spin, ${wager} tickets`}
    >
      spin
    </MachineButton>
  );

  const controls = (
    <>
      <MachineChoice
        label="segments"
        options={WHEEL_SEGMENT_COUNTS.map((c) => ({
          value: c,
          label: <span className="arcade-num">{c}</span>,
        }))}
        value={segments}
        onChange={(next) => setSegments(next as WheelSegmentCount)}
        disabled={isSpinning}
      />
      <MachineChoice
        label="risk"
        options={WHEEL_RISKS.map((r) => ({ value: r, label: r }))}
        value={risk}
        onChange={(next) => setRisk(next as WheelRisk)}
        disabled={isSpinning}
      />
    </>
  );

  const receipt = settled ? (
    <ArcadeWagerResultPlate
      result={{
        payout: lastPayout ?? 0,
        stake: settledWager,
        multiplier: resultMult,
      }}
      kicker="prize wheel"
      headline={`${fmtMult(resultMult ?? 0)}×`}
      detail={settledWheel}
      fairness={{ seedHash: null, revealedSeed }}
      achievements={achievements}
      roundId={roundId ?? undefined}
      sound={false}
    />
  ) : null;

  return (
    <GameShell
      game="prize-wheel"
      stat={<GameStat value={`${fmtMult(maxMult)}×`} label="top" />}
      howTo={HOW_TO}
    >
      <ArcadeMachine
        name="prize wheel"
        glass={
          <MachineGlass
            name="prize wheel"
            rules={[`${winSegments} of ${segments} segments pay something. The segments and what they pay:`]}
            paytable={glassRows}
          />
        }
        action={action}
        bet={{ value: wager, onChange: setWager, balance, disabled: isSpinning }}
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

/* ========================================================================== */
/*  Wheel (SVG)                                                                 */
/* ========================================================================== */

const VIEW = 200;
const CENTER = VIEW / 2;
const R_OUTER = 95;
const R_HUB = 24;

function polar(r: number, angleDeg: number): { x: number; y: number } {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: CENTER + r * Math.cos(a), y: CENTER + r * Math.sin(a) };
}

/** Path for a wheel wedge from angle a0 to a1 (deg, 0 at top, clockwise). */
function wedgePath(a0: number, a1: number): string {
  const p0 = polar(R_OUTER, a0);
  const p1 = polar(R_OUTER, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${CENTER} ${CENTER} L ${p0.x.toFixed(3)} ${p0.y.toFixed(3)} A ${R_OUTER} ${R_OUTER} 0 ${large} 1 ${p1.x.toFixed(3)} ${p1.y.toFixed(3)} Z`;
}

function PrizeWheel({
  layout,
  theme,
  rotation,
  spinning,
  landed,
  burstKey,
  resultIndex,
  maxMult,
}: {
  layout: readonly number[];
  theme: PrizeWheelTheme;
  rotation: number;
  spinning: boolean;
  landed: boolean;
  burstKey: number;
  resultIndex: number | null;
  maxMult: number;
}) {
  const count = layout.length;
  const seg = 360 / count;
  const labelFont =
    count <= 10
      ? 9
      : count <= 20
        ? 7
        : count <= 30
          ? 5.6
          : count <= 40
            ? 4.8
            : 4.2;
  const labelR = R_OUTER * 0.66;

  const wedges = useMemo(() => {
    return layout.map((mult, i) => {
      const a0 = i * seg;
      const a1 = (i + 1) * seg;
      const isJackpot = mult === maxMult && maxMult > 0;
      const band = segmentBand(theme, mult, isJackpot);
      const mid = a0 + seg / 2;
      const pos = polar(labelR, mid);
      // Radial labels: rotate to the mid-angle, flipping the lower half so text
      // stays upright.
      const flip = mid > 90 && mid < 270;
      const textRot = flip ? mid + 180 : mid;
      return {
        mult,
        i,
        band,
        pos,
        textRot,
        isJackpot,
        path: wedgePath(a0, a1),
      };
    });
  }, [layout, seg, theme, maxMult, labelR]);

  return (
    <div className={`pw-wheel-wrap${landed ? " pw-impact" : ""}`}>
      {burstKey > 0 ? <ConfettiBurst key={burstKey} theme={theme} /> : null}
      {/* Fixed pointer at 12 o'clock. */}
      <svg
        className="pw-pointer"
        viewBox="0 0 20 20"
        width="26"
        height="26"
        aria-hidden
      >
        <path
          d="M10 18 L2 4 Q10 8 18 4 Z"
          fill={theme.pointer}
          stroke={theme.pointerEdge}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>

      <svg
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        className="pw-wheel"
        role="img"
        aria-label={`Prize wheel with ${count} segments`}
      >
        {/* Outer rim */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={R_OUTER + 4}
          fill={theme.rim}
          stroke={theme.rimEdge}
          strokeWidth="3"
        />
        {/* Rotating segment group */}
        <g
          className="pw-wheel-rot"
          style={{ transform: `rotate(${rotation}deg)` }}
        >
          {wedges.map((w) => {
            const isResult = resultIndex === w.i && (landed || !spinning);
            return (
              <g key={w.i}>
                <path
                  d={w.path}
                  className={isResult ? "pw-wedge-win" : undefined}
                  fill={w.band.face}
                  stroke={isResult ? theme.pointer : theme.spoke}
                  strokeWidth={isResult ? 2.4 : 0.8}
                  strokeLinejoin="round"
                  opacity={
                    isResult || resultIndex == null || spinning ? 1 : 0.82
                  }
                />
                {w.mult > 0 ? (
                  <text
                    x={w.pos.x}
                    y={w.pos.y}
                    fill={w.band.on}
                    fontSize={labelFont}
                    fontWeight={700}
                    textAnchor="middle"
                    dominantBaseline="central"
                    transform={`rotate(${w.textRot} ${w.pos.x.toFixed(2)} ${w.pos.y.toFixed(2)})`}
                    style={{ fontFamily: "var(--font-mono-arcade)" }}
                  >
                    {fmtMult(w.mult)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
        {/* Hub cap (fixed) */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={R_HUB}
          fill={theme.hub}
          stroke={theme.hubEdge}
          strokeWidth="2"
        />
        <text
          x={CENTER}
          y={CENTER}
          fill={theme.hubOn}
          fontSize={resultIndex != null && !spinning ? 13 : 10}
          fontWeight={700}
          textAnchor="middle"
          dominantBaseline="central"
          style={{ fontFamily: "var(--font-mono-arcade)" }}
        >
          {resultIndex != null && !spinning
            ? `${fmtMult(layout[resultIndex] ?? 0)}×`
            : "spin"}
        </text>
      </svg>

      <style jsx>{`
        .pw-wheel-wrap {
          position: relative;
          /* the largest wheel the screen holds above the readout */
          width: clamp(160px, min(90cqw, 100cqh - 7rem), 380px);
          aspect-ratio: 1;
          filter: drop-shadow(0 8px 18px #00000070);
        }
        .pw-wheel {
          width: 100%;
          height: 100%;
          display: block;
        }
        .pw-pointer {
          position: absolute;
          top: -6px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 4;
          filter: drop-shadow(0 2px 2px #00000090);
        }
        /* Landing kick — pointer flapper bounce + a subtle cabinet shudder. */
        .pw-impact .pw-pointer {
          animation: pw-pointer-kick ${IMPACT_MS}ms var(--ease-spring, ease-out);
        }
        .pw-impact .pw-wheel {
          animation: pw-cabinet-shake ${IMPACT_MS}ms ease-out;
        }
        @keyframes pw-pointer-kick {
          0% {
            transform: translateX(-50%) rotate(0deg);
          }
          25% {
            transform: translateX(-50%) rotate(-14deg);
          }
          55% {
            transform: translateX(-50%) rotate(7deg);
          }
          80% {
            transform: translateX(-50%) rotate(-3deg);
          }
          100% {
            transform: translateX(-50%) rotate(0deg);
          }
        }
        @keyframes pw-cabinet-shake {
          0% {
            transform: translate(0, 0);
          }
          20% {
            transform: translate(1.5px, -1px) rotate(0.4deg);
          }
          45% {
            transform: translate(-1.5px, 1px) rotate(-0.4deg);
          }
          70% {
            transform: translate(1px, 0.5px);
          }
          100% {
            transform: translate(0, 0);
          }
        }
        /* Winning-wedge highlight pulse (two beats, then it rests). */
        .pw-wedge-win {
          animation: pw-wedge-pulse 640ms ease-out 2;
        }
        @keyframes pw-wedge-pulse {
          0%,
          100% {
            filter: none;
          }
          50% {
            filter: drop-shadow(0 0 5px rgba(242, 193, 78, 0.85));
          }
        }
        /* Big-win confetti — a dozen enamel chips, self-cleaning. */
        .pw-confetti {
          position: absolute;
          inset: 0;
          z-index: 5;
          pointer-events: none;
        }
        .pw-confetti span {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 6px;
          height: 9px;
          border-radius: 1px;
          opacity: 0;
          animation: pw-confetti-pop 880ms cubic-bezier(0.16, 0.6, 0.4, 1)
            var(--pw-cd, 0ms) forwards;
        }
        @keyframes pw-confetti-pop {
          0% {
            transform: translate(-50%, -50%) rotate(0deg);
            opacity: 1;
          }
          70% {
            opacity: 1;
          }
          100% {
            transform: translate(
                calc(-50% + var(--pw-cx, 0px)),
                calc(-50% + var(--pw-cy, 0px))
              )
              rotate(var(--pw-cr, 0deg));
            opacity: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pw-impact .pw-pointer,
          .pw-impact .pw-wheel,
          .pw-wedge-win {
            animation: none;
          }
          .pw-confetti {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}

/** Short-lived big-win burst: a dozen enamel chips tossed from the hub. */
function ConfettiBurst({ theme }: { theme: PrizeWheelTheme }) {
  const pieces = useMemo(() => {
    const colors = [
      theme.pointer,
      theme.jackpot.face,
      theme.huge.face,
      theme.mid.face,
      theme.big.face,
    ];
    return Array.from({ length: 14 }, (_, i) => {
      const angle = (i / 14) * Math.PI * 2 + (i % 3) * 0.4;
      const dist = 44 + ((i * 37) % 56);
      return {
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist * 0.85 - 26,
        r: ((i * 61) % 260) - 130,
        delay: (i % 5) * 26,
        color: colors[i % colors.length],
      };
    });
  }, [theme]);

  return (
    <div className="pw-confetti" aria-hidden>
      {pieces.map((p, i) => (
        <span
          key={i}
          style={
            {
              "--pw-cx": `${p.x.toFixed(1)}px`,
              "--pw-cy": `${p.y.toFixed(1)}px`,
              "--pw-cr": `${p.r}deg`,
              "--pw-cd": `${p.delay}ms`,
              background: p.color,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
