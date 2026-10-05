"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useGamesWallet } from "@/features/arcade/components/shell/games-wallet-provider";
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

/* ===========================================================================
 *  Types + constants
 * ========================================================================= */

type Zone = { label: string; multiplier: number; color: string };

/* Midway enamel paints (flat, saturated, NO glow) painted on dark lacquered
   wood. Colors mirror the shell's enamel/piece tokens so all four arcade
   sub-themes stay coherent; values are purely cosmetic (scoring comes from
   the server settle, never from these). */
const ZONES: Zone[] = [
  { label: "Bullseye", multiplier: 100, color: "#c73538" }, // enamel red
  { label: "Inner Bull", multiplier: 25, color: "#f2a33c" }, // ticket amber
  { label: "Outer Bull", multiplier: 8, color: "#e8a23a" }, // enamel orange
  { label: "Double", multiplier: 3, color: "#9a52d6" }, // enamel violet
  { label: "Treble", multiplier: 1.5, color: "#3b6fd4" }, // enamel blue
  { label: "Single", multiplier: 0.8, color: "#2fb8a6" }, // prize teal
  { label: "Outer", multiplier: 0.3, color: "#5fc06a" }, // enamel green
  { label: "Miss", multiplier: 0, color: "#4a3722" }, // dark wood edge
];

const RING_RADII = [0.08, 0.16, 0.26, 0.38, 0.52, 0.68, 0.86, 1.0];
const BOARD_R = 90;
const MAX_STUCK_DARTS = 20;
const DART_FADE_MS = 8000;
const THROW_ANIM_MS = 500;
const WINDUP_MS = 400; // min anticipation hold between click and release
const POPUP_DELAY_MS = 260; // impact → zone flash → payout plate staging

type DartState = "flying" | "stuck";

type StuckDart = {
  id: number;
  x: number;
  y: number;
  angle: number;
  zoneIndex: number;
  multiplier: number;
  payout: number;
  createdAt: number;
  state: DartState;
  label: string;
  zoneColor: string;
};

type SettleResponse = {
  payout: number;
  multiplier: number;
  seed: number;
  roundId?: string | null;
  zoneIndex?: number;
  throwValue?: number;
  error?: string;
};

function formatMult(m: number): string {
  if (m === 0) return "0×";
  if (m >= 100) return `${m.toFixed(0)}×`;
  if (m >= 1) return `${m.toFixed(1)}×`;
  return `${m.toFixed(2)}×`;
}

const HOW_TO: GameHowTo = {
  lines: [
    "Pick a bet and throw a dart at the board.",
    "The ring it lands in decides the payout; 31% of throws miss the board.",
    "The rings pay 0.3× to 3×, the bull 8× and 25×, and the bullseye 100×, about 1 throw in 1,000.",
  ],
};

/** The landed throw the receipt prints. */
type LastThrow = {
  payout: number;
  stake: number;
  multiplier: number;
  zone: string;
  seed: number | null;
  roundId: string | null;
};

let dartIdCounter = 0;

/* Dart artwork, drawn around local origin (tip at 0,-9). Shared by the
   wind-up overlay and the flying/stuck darts so both read identically. */
function DartGlyph() {
  return (
    <>
      {/* Needle tip */}
      <polygon points="0,-9 -0.8,-2 0.8,-2" fill="url(#dartTip)" />
      {/* Knurled barrel */}
      <rect
        x={-1.4}
        y={-2}
        width={2.8}
        height={5}
        rx={0.9}
        fill="url(#dartBarrel)"
      />
      <line
        x1={-1.2}
        y1={-0.8}
        x2={1.2}
        y2={-0.8}
        stroke="rgba(15,23,42,0.35)"
        strokeWidth={0.35}
      />
      <line
        x1={-1.2}
        y1={0.4}
        x2={1.2}
        y2={0.4}
        stroke="rgba(15,23,42,0.35)"
        strokeWidth={0.35}
      />
      <line
        x1={-1.2}
        y1={1.6}
        x2={1.2}
        y2={1.6}
        stroke="rgba(15,23,42,0.35)"
        strokeWidth={0.35}
      />
      {/* Stem */}
      <rect x={-0.6} y={3} width={1.2} height={4.2} rx={0.3} fill="#2f2417" />
      {/* Flights — enamel-red layered fins with a lit edge */}
      <polygon points="-4.4,11.5 -0.4,5.8 -0.4,12.3" fill="#98262a" />
      <polygon points="4.4,11.5 0.4,5.8 0.4,12.3" fill="#c73538" />
      <polygon
        points="0,6.2 -1.1,12.6 1.1,12.6"
        fill="#d34b4e"
        opacity={0.95}
      />
      <line
        x1={0}
        y1={5.8}
        x2={0}
        y2={12.4}
        stroke="rgba(253,247,234,0.5)"
        strokeWidth={0.3}
      />
    </>
  );
}

/* ===========================================================================
 *  Component
 * ========================================================================= */

export default function DartsClient() {
  const { trigger: triggerFeedback } = useGameFeedback();
  const {
    wallet,
    loaded: walletLoaded,
    refresh: refreshWallet,
    adjustCredits,
  } = useGamesWallet();
  const balance = walletLoaded ? wallet.credits : null;
  /* True from the press until the dart (and any queued one) has landed. */
  const [throwing, setThrowing] = useState(false);
  const [wager, setWager] = useMachineBet(balance, 10, { locked: throwing });
  const [lastThrow, setLastThrow] = useState<LastThrow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [darts, setDarts] = useState<StuckDart[]>([]);
  const [, setTick] = useState(0); // force re-render for age-based opacity
  const [reducedMotion, setReducedMotion] = useState(false);

  /* Respect prefers-reduced-motion: snap the dart to its landing spot
     instead of animating the flight arc. */
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const {
    start: startSession,
    settle: settleSession,
    achievements,
  } = useWagerSession("arcade-darts");

  // Plinko-style throttle: 1 in-flight at a time, queue next throw
  const inFlightRef = useRef(false);

  // Wind-up anticipation: dart cocks back at the release point from click
  // until the settle has landed AND the minimum hold has elapsed.
  const [winding, setWinding] = useState(false);
  // Impact FX: bumped per landing to retrigger the board shake/flash.
  const [boardFx, setBoardFx] = useState(0);

  // All pending timeouts, cleared on unmount.
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    const timers = timersRef.current;
    return () => {
      mountedRef.current = false;
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);
  const later = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timersRef.current.delete(t);
      fn();
    }, ms);
    timersRef.current.add(t);
  }, []);

  /* ---------- Tick for age-based rendering ---------- */
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
      // Clean up expired darts
      const now = Date.now();
      setDarts((prev) => prev.filter((d) => now - d.createdAt < DART_FADE_MS));
    }, 200);
    return () => clearInterval(interval);
  }, []);

  /* ---------- Throw (with queue) ---------- */
  const doThrow = useCallback(async () => {
    if (inFlightRef.current) return;
    if (balance == null) return;
    setError(null);
    if (wager > balance) {
      setError(`You need ${wager} tickets for this bet.`);
      return;
    }

    inFlightRef.current = true;
    setThrowing(true);
    SoundManager.play("arcadeBet");
    playHaptic("tap");
    adjustCredits(-wager);

    // Wind-up starts the instant the button is pressed, so the wait for the
    // server reads as anticipation instead of dead air. Reduced motion skips
    // it entirely (no hold, no overlay, instant result).
    const windupStart = performance.now();
    if (!reducedMotion) setWinding(true);

    try {
      // 1. Create session + settle
      const session = await startSession(wager, {});
      if (!mountedRef.current) return;
      if (!session.ok) {
        setError(
          machineError(session.error, "The machine could not start the throw."),
        );
        inFlightRef.current = false;
        setThrowing(false);
        setWinding(false);
        void refreshWallet();
        return;
      }

      const settled = await settleSession<SettleResponse>();
      if (!mountedRef.current) return;
      if (!settled.ok) {
        setError(
          machineError(settled.error, "The throw did not go through. Try again."),
        );
        inFlightRef.current = false;
        setThrowing(false);
        setWinding(false);
        void refreshWallet();
        return;
      }
      const settleData = settled.data;

      const zoneIdx = settleData.zoneIndex ?? ZONES.length - 1;
      const throwVal = settleData.throwValue ?? Math.random();
      const zone = ZONES[zoneIdx]!;

      // 2. Compute landing position
      const innerR = zoneIdx === 0 ? 0 : RING_RADII[zoneIdx - 1]!;
      const outerR = RING_RADII[zoneIdx]!;
      const rFrac = innerR + (outerR - innerR) * (0.2 + Math.random() * 0.6);
      const r = rFrac * BOARD_R;
      const angle = throwVal * Math.PI * 2;
      const x = 100 + Math.cos(angle) * r;
      const y = 100 + Math.sin(angle) * r;
      const tipAngle = (Math.atan2(100 - y, 100 - x) * 180) / Math.PI - 90;

      const id = ++dartIdCounter;
      const isWin = settleData.multiplier > 0;
      const label = isWin
        ? settleData.multiplier >= 3
          ? `+${settleData.payout} (${formatMult(settleData.multiplier)})`
          : `+${settleData.payout}`
        : "miss";

      const flightMs = reducedMotion ? 0 : THROW_ANIM_MS;

      // 3. Release: held until BOTH the settle is in AND the wind-up minimum
      // has elapsed — never longer than the settle itself takes.
      const release = () => {
        setWinding(false);
        if (!reducedMotion)
          SoundManager.play("arcadeRoll", { volume: 0.35, pitch: 1.6 }); // whoosh

        // Add dart in "flying" state (arcs in from bottom center)
        const newDart: StuckDart = {
          id,
          x,
          y,
          angle: tipAngle,
          zoneIndex: zoneIdx,
          multiplier: settleData.multiplier,
          payout: settleData.payout,
          createdAt: Date.now(),
          state: "flying",
          label,
          zoneColor: zone.color,
        };

        setDarts((prev) => {
          const next = [...prev, newDart];
          if (next.length > MAX_STUCK_DARTS)
            return next.slice(-MAX_STUCK_DARTS);
          return next;
        });

        // 4. Impact: mark stuck at flight end → shake/flash + zone flash
        // first, then the staged payout plate.
        later(() => {
          setDarts((prev) =>
            prev.map((d) =>
              d.id === id ? { ...d, state: "stuck", createdAt: Date.now() } : d,
            ),
          );
          playHaptic("medium");
          setBoardFx((n) => n + 1);
          if (settleData.payout === 0) {
            triggerFeedback("loss");
          } else if (settleData.multiplier >= 8) {
            triggerFeedback("jackpot");
          } else {
            triggerFeedback("round-win");
          }

          // The receipt, staged a beat after impact so the zone flash
          // reads first.
          later(
            () => {
              playHaptic(settleData.payout > 0 ? "success" : "failure");
              setLastThrow({
                payout: settleData.payout,
                stake: wager,
                multiplier: settleData.multiplier,
                zone: zone.label.toLowerCase(),
                seed: settleData.seed ?? null,
                roundId: settleData.roundId ?? null,
              });
            },
            reducedMotion ? 0 : POPUP_DELAY_MS,
          );
        }, flightMs);

        void refreshWallet();

        // 5. Release lock after animation, process queue
        later(
          () => {
            inFlightRef.current = false;
            setThrowing(false);
          },
          // after the receipt's beat, so it prints this throw
          flightMs + (reducedMotion ? 0 : POPUP_DELAY_MS) + 100,
        );
      };

      const windupElapsed = performance.now() - windupStart;
      later(
        release,
        reducedMotion ? 0 : Math.max(0, WINDUP_MS - windupElapsed),
      );
    } catch {
      if (!mountedRef.current) return;
      inFlightRef.current = false;
      setThrowing(false);
      setWinding(false);
      setError("The machine lost its connection. Try again.");
      void refreshWallet();
    }
  }, [
    wager,
    balance,
    reducedMotion,
    later,
    refreshWallet,
    adjustCredits,
    startSession,
    settleSession,
    triggerFeedback,
  ]);

  // Stable ref for keyboard handler
  const doThrowRef = useRef(doThrow);
  doThrowRef.current = doThrow;

  /* ---------- Keyboard: Space throws, never while a dart is in the air ---------- */
  useMachineKey(
    useMemo(() => (throwing ? null : () => void doThrowRef.current()), [throwing]),
  );

  /* ---------- Render ---------- */
  const now = Date.now();
  const affordable = balance != null && wager <= balance;

  /* ---------- Stage ---------- */
  const screen = (
    <div className="arc-machine-fit">
      <p role="status" className="arc-machine-status">
        {lastThrow && !throwing
          ? lastThrow.multiplier > 0
            ? `It landed in ${lastThrow.zone} for ${formatMult(lastThrow.multiplier)}.`
            : "A miss."
          : throwing
            ? "The dart is in the air."
            : "Throw a dart at the board."}
      </p>
      <div
        key={boardFx}
        className="relative"
        style={{
          flex: "none",
          // the largest board the screen holds under the status line
          width: "min(100%, 37.5rem, 100cqh - 5rem)",
          aspectRatio: "1",
          // Brief shake on dart impact; key bump re-triggers per landing.
          animation:
            boardFx > 0 && !reducedMotion
              ? "dartBoardShake 320ms ease-out"
              : undefined,
        }}
      >
        <svg viewBox="0 0 200 220" className="h-full w-full overflow-visible">
          <defs>
            {/* Lacquered-wood cabinet behind the board */}
            <radialGradient id="dartsCabinet" cx="38%" cy="32%" r="80%">
              <stop offset="0%" stopColor="#3a2c1a" />
              <stop offset="65%" stopColor="#261d13" />
              <stop offset="100%" stopColor="#140e08" />
            </radialGradient>
            {/* Brass number-ring (warm enamel-cabinet rim, not chrome) */}
            <linearGradient id="dartsRim" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#f3dcae" />
              <stop offset="45%" stopColor="#b78a48" />
              <stop offset="100%" stopColor="#6b4a26" />
            </linearGradient>
            {/* Overhead lighting sheen across the board face (warm, never glows) */}
            <radialGradient id="dartsSheen" cx="36%" cy="30%" r="85%">
              <stop offset="0%" stopColor="rgba(255,247,234,0.18)" />
              <stop offset="45%" stopColor="rgba(255,247,234,0.05)" />
              <stop offset="75%" stopColor="rgba(0,0,0,0.06)" />
              <stop offset="100%" stopColor="rgba(0,0,0,0.34)" />
            </radialGradient>
            {/* Dart metals — warm steel barrel, cream gloss tip */}
            <linearGradient id="dartTip" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#fdf7ea" />
              <stop offset="50%" stopColor="#c4b392" />
              <stop offset="100%" stopColor="#6b5631" />
            </linearGradient>
            <linearGradient id="dartBarrel" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#8a7c63" />
              <stop offset="45%" stopColor="#f3dcae" />
              <stop offset="100%" stopColor="#4a3722" />
            </linearGradient>
          </defs>

          {/* Drop shadow */}
          <ellipse
            cx={100}
            cy={107}
            rx={BOARD_R + 14}
            ry={BOARD_R + 9}
            fill="black"
            opacity={0.4}
          />
          {/* Lacquered-wood cabinet surround */}
          <circle
            cx={100}
            cy={100}
            r={BOARD_R + 13}
            fill="url(#dartsCabinet)"
            stroke="#0a0704"
            strokeWidth={1.5}
          />
          <circle
            cx={100}
            cy={100}
            r={BOARD_R + 12}
            fill="none"
            stroke="#4a382278"
            strokeWidth={0.8}
          />
          {/* Brass rim ring */}
          <circle
            cx={100}
            cy={100}
            r={BOARD_R + 4.5}
            fill="none"
            stroke="url(#dartsRim)"
            strokeWidth={3.5}
          />
          <circle
            cx={100}
            cy={100}
            r={BOARD_R + 6.6}
            fill="none"
            stroke="rgba(0,0,0,0.5)"
            strokeWidth={0.8}
          />

          {/* Rings outer→inner */}
          {[...ZONES].reverse().map((zone, ri) => {
            const idx = ZONES.length - 1 - ri;
            const r = RING_RADII[idx]! * BOARD_R;
            return (
              <circle
                key={idx}
                cx={100}
                cy={100}
                r={r}
                fill={zone.color}
                stroke="#0a0704"
                strokeWidth={0.9}
                opacity={0.96}
              />
            );
          })}

          {/* Spider wires between rings — warm brass, like a real board's frets */}
          {RING_RADII.slice(0, -1).map((rf, i) => (
            <circle
              key={`w-${i}`}
              cx={100}
              cy={100}
              r={rf * BOARD_R}
              fill="none"
              stroke="rgba(243,220,174,0.28)"
              strokeWidth={0.5}
            />
          ))}
          {/* Radial spider wires — decorative, like a real board's
              segment wires; scoring stays purely ring-based */}
          {Array.from({ length: 20 }).map((_, i) => {
            const a = ((i + 0.5) / 20) * Math.PI * 2;
            const r0 = RING_RADII[2]! * BOARD_R;
            // Fixed precision: server (Node) and client (browser) trig can
            // differ in the last ULP, which trips hydration on raw doubles.
            const fix = (v: number) => v.toFixed(3);
            return (
              <line
                key={`spoke-${i}`}
                x1={fix(100 + Math.cos(a) * r0)}
                y1={fix(100 + Math.sin(a) * r0)}
                x2={fix(100 + Math.cos(a) * BOARD_R)}
                y2={fix(100 + Math.sin(a) * BOARD_R)}
                stroke="rgba(10,7,4,0.45)"
                strokeWidth={0.5}
              />
            );
          })}

          {/* Crosshair */}
          <line
            x1={100}
            y1={100 - BOARD_R}
            x2={100}
            y2={100 + BOARD_R}
            stroke="#f6eddc"
            strokeWidth={0.3}
            opacity={0.1}
          />
          <line
            x1={100 - BOARD_R}
            y1={100}
            x2={100 + BOARD_R}
            y2={100}
            stroke="#f6eddc"
            strokeWidth={0.3}
            opacity={0.1}
          />

          {/* Lighting sheen over the whole face */}
          <circle
            cx={100}
            cy={100}
            r={BOARD_R}
            fill="url(#dartsSheen)"
            pointerEvents="none"
          />

          {/* Ring labels */}
          {ZONES.slice(0, -1).map((zone, idx) => {
            const innerR = idx === 0 ? 0 : RING_RADII[idx - 1]!;
            const outerR = RING_RADII[idx]!;
            const labelR = ((innerR + outerR) / 2) * BOARD_R;
            if (labelR < 8) return null;
            return (
              <text
                key={idx}
                x={100}
                y={100 - labelR}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={labelR > 20 ? 5.5 : 3.5}
                fontWeight="bold"
                fill="#fdf7ea"
                opacity={0.82}
                style={{
                  fontFamily: "var(--font-mono-arcade, monospace)",
                  paintOrder: "stroke",
                }}
                stroke="#0a0704"
                strokeWidth={0.35}
              >
                {formatMult(zone.multiplier)}
              </text>
            );
          })}

          {/* ---- Darts ---- */}
          {darts.map((dart) => {
            const isFlying = dart.state === "flying";
            const age = now - dart.createdAt;
            const isWin = dart.multiplier > 0;

            // Fade out stuck darts over time
            const fadeStart = DART_FADE_MS * 0.65;
            const stuckOpacity =
              dart.state === "stuck" && age > fadeStart
                ? Math.max(
                    0,
                    1 - (age - fadeStart) / (DART_FADE_MS - fadeStart),
                  )
                : 1;

            // Flying: arcs in from the release point via the dartFly
            // keyframes (custom props carry the per-dart target vector).
            // Reduced motion: render straight at the landing spot (no arc).
            const flyAnim = isFlying && !reducedMotion;

            return (
              <g key={dart.id}>
                {/* Dart body */}
                <g
                  style={
                    flyAnim
                      ? {
                          ["--dart-dx" as string]: `${dart.x - 100}px`,
                          ["--dart-dy" as string]: `${dart.y - 210}px`,
                          ["--dart-rot" as string]: `${dart.angle}deg`,
                          animation: `dartFly ${THROW_ANIM_MS}ms cubic-bezier(0.3, 0, 0.2, 1) forwards`,
                        }
                      : {
                          transform: `translate(${dart.x}px, ${dart.y}px) rotate(${dart.angle}deg)`,
                          opacity: stuckOpacity,
                        }
                  }
                >
                  <DartGlyph />
                </g>

                {/* Expanding impact ripple right after landing (motion only) */}
                {!isFlying && !reducedMotion && age < 700 && (
                  <circle
                    cx={dart.x}
                    cy={dart.y}
                    r={isWin ? 5 : 3}
                    fill="none"
                    stroke={dart.zoneColor}
                    strokeWidth={1.5}
                    style={{
                      transformBox: "fill-box",
                      transformOrigin: "center",
                      animation: "dartRipple 650ms ease-out forwards",
                    }}
                  />
                )}

                {/* Lingering impact ring */}
                {!isFlying && (
                  <circle
                    cx={dart.x}
                    cy={dart.y}
                    r={isWin ? 6 : 3}
                    fill="none"
                    stroke={dart.zoneColor}
                    strokeWidth={1.2}
                    opacity={Math.min(
                      stuckOpacity,
                      age < 600 ? 0.6 : Math.max(0, 0.6 - (age - 600) / 1500),
                    )}
                  />
                )}

                {/* Small zone label on the dart (brief flash) */}
                {!isFlying && age < 1200 && (
                  <text
                    x={dart.x}
                    y={dart.y - 12}
                    textAnchor="middle"
                    fontSize={4.2}
                    fontWeight="bold"
                    fill={dart.zoneColor}
                    stroke="#0a0704"
                    strokeWidth={0.5}
                    style={{
                      fontFamily: "var(--font-mono-arcade, monospace)",
                      paintOrder: "stroke",
                    }}
                    opacity={
                      age < 200 ? 1 : Math.max(0, 1 - (age - 200) / 1000)
                    }
                  >
                    {formatMult(dart.multiplier)}
                  </text>
                )}
              </g>
            );
          })}

          {/* ---- Wind-up: dart cocked back at the release point with an
                  aim pulse, held until the settle lands (motion only) ---- */}
          {winding && !reducedMotion && (
            <g pointerEvents="none">
              <circle
                cx={100}
                cy={212}
                r={7}
                fill="none"
                stroke="#f2a33c"
                strokeWidth={1}
                style={{
                  transformBox: "fill-box",
                  transformOrigin: "center",
                  animation: "dartAimPulse 520ms ease-out infinite",
                }}
              />
              <g
                style={{
                  animation: "dartWindup 460ms ease-in-out infinite alternate",
                }}
              >
                <DartGlyph />
              </g>
            </g>
          )}
        </svg>

        {/* Impact flash across the board face (motion only) */}
        {boardFx > 0 && !reducedMotion && (
          <div
            className="pointer-events-none absolute inset-0 rounded-full"
            style={{
              background:
                "radial-gradient(circle at 50% 45%, rgba(255,247,234,0.2), transparent 62%)",
              animation: "dartBoardFlash 280ms ease-out forwards",
            }}
          />
        )}

      </div>
    </div>
  );

  const glass = (
    <MachineGlass
      name="darts"
      rules={["The ring the dart lands in pays. A miss pays nothing."]}
      paytable={ZONES.slice(0, -1).map((zone) => ({
        label: zone.label.toLowerCase(),
        value: formatMult(zone.multiplier),
        lit: !throwing && lastThrow?.zone === zone.label.toLowerCase(),
      }))}
    />
  );

  const action = (
    <MachineButton
      onClick={() => void doThrow()}
      disabled={!affordable}
      aria-label={`throw, ${wager} tickets`}
    >
      throw
    </MachineButton>
  );

  const receipt =
    lastThrow && !throwing ? (
      <ArcadeWagerResultPlate
        result={{
          payout: lastThrow.payout,
          stake: lastThrow.stake,
          multiplier: lastThrow.multiplier,
          jackpot: lastThrow.multiplier >= 25,
        }}
        kicker="darts"
        headline={
          lastThrow.multiplier > 0 ? formatMult(lastThrow.multiplier) : "miss"
        }
        detail={lastThrow.zone}
        fairness={{ seedHash: null, revealedSeed: lastThrow.seed }}
        achievements={achievements}
        roundId={lastThrow.roundId ?? undefined}
        sound={false}
      />
    ) : null;

  return (
    <GameShell
      game="darts"
      stat={<GameStat value="100×" label="top" />}
      howTo={HOW_TO}
    >
      <ArcadeMachine
        name="darts"
        glass={glass}
        action={action}
        bet={{
          value: wager,
          onChange: setWager,
          balance,
          disabled: throwing,
        }}
        receipt={receipt}
        receiptKey={lastThrow?.roundId ?? null}
        notice={error}
      >
        {screen}
      </ArcadeMachine>

      <style jsx global>{`
        /* Enamel result plate over the board — lacquered panel, hard offset
           shadow, enamel accent border. No glow. */
        .dart-popup-plate {
          border-radius: var(--radius-panel, 12px);
          border: 2px solid var(--dart-accent, var(--border-soft));
          background:
            var(--grain),
            linear-gradient(180deg, var(--surface-raised), var(--surface-panel));
          background-size:
            80px 80px,
            80px 80px,
            auto;
          box-shadow:
            inset 0 1px 0 var(--bevel-hi),
            inset 0 -2px 4px #00000060,
            0 5px 0 var(--shadow-color),
            0 7px 14px #00000055;
        }
        @keyframes dartPopup {
          0% {
            opacity: 0;
            transform: scale(0.4) translateY(14px);
          }
          14% {
            opacity: 1;
            transform: scale(1.14) translateY(-5px);
          }
          26% {
            transform: scale(0.97) translateY(1px);
          }
          38% {
            transform: scale(1) translateY(0);
          }
          70% {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
          100% {
            opacity: 0;
            transform: scale(0.9) translateY(-20px);
          }
        }
        @keyframes dartRipple {
          0% {
            opacity: 0.9;
            transform: scale(0.4);
          }
          100% {
            opacity: 0;
            transform: scale(2.6);
          }
        }
        @media (prefers-reduced-motion: no-preference) {
          /* Wind-up: dart pulls back and settles, looping until release. */
          @keyframes dartWindup {
            0% {
              transform: translate(100px, 206px) rotate(0deg) scale(1.16);
            }
            100% {
              transform: translate(100px, 216px) rotate(0deg) scale(1.34);
            }
          }
          /* Aim pulse at the release point while winding up. */
          @keyframes dartAimPulse {
            0% {
              opacity: 0.85;
              transform: scale(0.55);
            }
            100% {
              opacity: 0;
              transform: scale(1.9);
            }
          }
          /* Flight: slight arc — rises above the straight line mid-flight,
             then drops onto the server-resolved landing spot. */
          @keyframes dartFly {
            0% {
              transform: translate(100px, 210px) rotate(0deg) scale(1.25);
            }
            45% {
              transform: translate(
                  calc(100px + var(--dart-dx, 0px) * 0.45),
                  calc(210px + var(--dart-dy, 0px) * 0.45 - 26px)
                )
                rotate(calc(var(--dart-rot, 0deg) * 0.35)) scale(1.12);
            }
            100% {
              transform: translate(
                  calc(100px + var(--dart-dx, 0px)),
                  calc(210px + var(--dart-dy, 0px))
                )
                rotate(var(--dart-rot, 0deg)) scale(1);
            }
          }
          /* Impact: quick board shudder + light flash. */
          @keyframes dartBoardShake {
            0% {
              transform: translate(0, 0);
            }
            20% {
              transform: translate(-2.5px, 1.5px);
            }
            45% {
              transform: translate(2px, -1px);
            }
            70% {
              transform: translate(-1px, 0.5px);
            }
            100% {
              transform: translate(0, 0);
            }
          }
          @keyframes dartBoardFlash {
            0% {
              opacity: 1;
            }
            100% {
              opacity: 0;
            }
          }
        }
        @media (prefers-reduced-motion: reduce) {
          /* Snap the result plate in, hold it, fade out — no travel/scale. */
          .dart-popup-plate {
            animation: dartPopupReduced 1.8s ease-out forwards !important;
          }
        }
        @keyframes dartPopupReduced {
          0% {
            opacity: 0;
          }
          8% {
            opacity: 1;
          }
          78% {
            opacity: 1;
          }
          100% {
            opacity: 0;
          }
        }
      `}</style>
    </GameShell>
  );
}
