"use client";

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from "react";
import { Rocket } from "lucide-react";
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
import { useGameFeedback } from "@/features/arcade/lib/use-game-feedback";
import { getWagerCelebrationTier } from "@/features/arcade/lib/wager-celebration";
import { SoundManager } from "@/features/arcade/lib/sound-manager";
import { playHaptic } from "@/features/arcade/lib/game-haptics";
import {
  createGameFrameLoop,
  type GameFrameLoop,
} from "@/features/arcade/lib/game-frame-loop";
import { useWagerSession } from "@/features/arcade/lib/use-wager-session";
import {
  ARCADE_MIN_BET,
  ARCADE_RTP,
  CRASH_MAX_MULTIPLIER,
} from "@/server/arcade/arcade-constants";

/* ---------- Types ---------- */

type GamePhase = "idle" | "flying" | "cashedOut" | "crashed";

type TickResponse = {
  status?: string;
  crashPoint?: number;
  seed?: number;
  elapsed?: number;
  roundId?: string | null;
};

type CashoutResponse = {
  cashedOut?: boolean;
  multiplier?: number;
  crashPoint?: number;
  payout?: number;
  seed?: number;
  roundId?: string | null;
};

/* ---------- Auto-cashout constants ---------- */

const AUTO_MIN = 1.01;
const AUTO_MAX = 50;
const AUTO_STEP = 0.05;
const AUTO_DEFAULT = 2;
/** Multiplier milestones that escalate the readout + feedback as the rocket climbs. */
const MILESTONES = [2, 5, 10, 25, 50, 100, 250, 500, 1000];
/** Fraction of the auto-cashout target at which the "closing in" cue starts. */
const AUTO_APPROACH_RATIO = 0.9;

/** Clamp + round to AUTO_STEP. */
function clampAuto(value: number): number {
  if (!Number.isFinite(value)) return AUTO_DEFAULT;
  const clamped = Math.min(AUTO_MAX, Math.max(AUTO_MIN, value));
  // Round to step then to 2 decimal places to avoid 1.0500000001 noise
  const stepped = Math.round(clamped / AUTO_STEP) * AUTO_STEP;
  return Math.round(stepped * 100) / 100;
}

/* ---------- The machine's copy ---------- */

const HOW_TO: GameHowTo = {
  lines: [
    "Pick a bet, press launch, then cash out before the rocket crashes.",
    "The multiplier climbs from 1× until the crash point, which is set when the round starts.",
    `Cashing out pays your bet times the multiplier: 10 tickets at 2.5× pays 25, up to ${CRASH_MAX_MULTIPLIER}×.`,
  ],
};

/** The rocket passes a multiplier m in about RTP / m of rounds. */
const GLASS_MARKS = [2, 5, 10, 100] as const;

function fmtMult(m: number): string {
  return `${m.toFixed(2)}×`;
}

function passChance(m: number): string {
  const pct = (ARCADE_RTP["arcade-crash"] * 100) / m;
  return `${pct >= 10 ? Math.floor(pct) : Number(pct.toPrecision(2))}%`;
}

/* ---------- Helpers ---------- */

/** Multiplier at a given elapsed time (ms). */
function getMultiplier(elapsedMs: number): number {
  return Math.exp(0.06 * (elapsedMs / 100));
}

/* Multiplier paint: solid enamel paints — calm teal, then amber heat past
   ×2, then danger red past ×10. Returns a CSS color (token) for the painted
   curve + readout. Enamel is applied flat — nothing glows. */
function multiplierPaint(m: number): string {
  if (m >= 10) return "var(--enamel-danger)";
  if (m >= 2) return "var(--enamel-tickets)";
  return "var(--enamel-prize)";
}
function multiplierInk(m: number): string {
  if (m >= 10) return "var(--enamel-danger-text)";
  if (m >= 2) return "var(--enamel-tickets-text)";
  return "var(--enamel-prize-text)";
}

/**
 * Returns a dynamic font size class based on multiplier magnitude so the
 * number feels like it's "growing" as the rocket climbs.
 */
function multiplierSize(m: number): string {
  if (m >= 25) return "text-6xl sm:text-8xl";
  if (m >= 10) return "text-6xl sm:text-7xl";
  if (m >= 5) return "text-5xl sm:text-6xl";
  if (m >= 2) return "text-5xl sm:text-6xl";
  return "text-4xl sm:text-5xl";
}

/* ---------- Curve geometry ----------
 * The crash "screen" is a 0..100 viewBox. We paint the multiplier as an
 * exponential curve climbing left→right and rising as it goes, matching the
 * exp() growth of getMultiplier(). x maps to progress toward the current
 * multiplier; y maps to height (inverted: 100 = floor). */
const CURVE_W = 100;
const CURVE_H = 100;

/** Map a multiplier (1..) to a 0..1 vertical climb, log-scaled so the early
 *  game is readable and big multipliers compress toward the top. */
function climb01(m: number): number {
  // log curve: 1x -> 0, ~25x -> ~1
  return Math.min(1, Math.log(Math.max(1, m)) / Math.log(25));
}

/** Build an SVG path for the curve from 1x up to the current multiplier. */
function buildCurvePath(current: number): string {
  const top = climb01(current);
  if (top <= 0) return `M 0 ${CURVE_H} L 2 ${CURVE_H}`;
  const steps = 28;
  let d = `M 0 ${CURVE_H}`;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    // exponential ease so the line whips upward — mirrors exp() growth
    const x = t * CURVE_W;
    const y = CURVE_H - Math.pow(t, 1.7) * top * CURVE_H;
    d += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return d;
}

/** Head position (rocket dot) at the end of the curve. */
function curveHead(current: number): { x: number; y: number } {
  const top = climb01(current);
  return { x: CURVE_W, y: CURVE_H - top * CURVE_H };
}

/** Static dashed preview of a ×10 flight, painted on the idle screen. */
const GHOST_CURVE_PATH = buildCurvePath(10);

/* ---------- Burst particles ----------
 * Deterministic debris layout — computed once at module scope so renders
 * never allocate and the burst looks identical on every crash. Coordinates
 * are px offsets from the rocket head; CSS animates them outward. */

type BurstPiece = {
  dx: number;
  dy: number;
  rot: number;
  delay: number;
  size: number;
  paint: string;
};

function buildBurst(paints: readonly string[], count: number): BurstPiece[] {
  const pieces: BurstPiece[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + 0.35;
    const dist = 34 + (i % 4) * 15;
    pieces.push({
      dx: Math.round(Math.cos(angle) * dist),
      dy: Math.round(Math.sin(angle) * dist - 12),
      rot: (i % 2 === 0 ? 1 : -1) * (120 + (i % 5) * 45),
      delay: (i % 3) * 22,
      size: 4 + (i % 3) * 2,
      paint: paints[i % paints.length]!,
    });
  }
  return pieces;
}

const CRASH_DEBRIS = buildBurst(
  ["var(--enamel-danger)", "var(--enamel-danger-text)", "var(--border-ink)"],
  12,
);
const CASHOUT_CONFETTI = buildBurst(
  ["var(--enamel-prize)", "var(--enamel-tickets)", "var(--enamel-prize-text)"],
  10,
);

/* ---------- Component ---------- */

export default function CrashClient() {
  /* -- wallet -- */
  const {
    wallet,
    loaded: walletLoaded,
    refresh: refreshWallet,
    adjustCredits,
  } = useGamesWallet();
  const balance = walletLoaded ? wallet.credits : null;
  const { trigger: triggerFeedback } = useGameFeedback();

  /* -- game state -- */
  const [phase, setPhase] = useState<GamePhase>("idle");

  /* -- setup -- */
  const [wager, setWager] = useMachineBet(balance, 10, {
    locked: phase === "flying",
  });
  /* The stake the open round was bought with; the receipt prints it. */
  const [roundStake, setRoundStake] = useState(0);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  // Auto-cashout: validated numeric value + a free text mirror so the user
  // can type freely while the value remains clamped to a safe range.
  const [autoCashoutValue, setAutoCashoutValue] =
    useState<number>(AUTO_DEFAULT);
  const [autoCashoutText, setAutoCashoutText] = useState<string>(
    AUTO_DEFAULT.toFixed(2),
  );
  const [autoCashoutEnabled, setAutoCashoutEnabled] = useState<boolean>(false);

  const [displayMultiplier, setDisplayMultiplier] = useState(1);
  const [crashPoint, setCrashPoint] = useState<number | null>(null);
  const [cashoutMultiplier, setCashoutMultiplier] = useState<number | null>(
    null,
  );
  const [payout, setPayout] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isCashingOut, setIsCashingOut] = useState(false);
  // Incremented each time a milestone is crossed — used as a React key to
  // re-fire the readout pop animation.
  const [milestonePop, setMilestonePop] = useState(0);
  // True once the multiplier enters the auto-cashout approach zone.
  const [autoApproach, setAutoApproach] = useState(false);

  /* -- auto-cashout refs (read by the frame loop without restarting it) -- */
  const autoCashoutRef = useRef<number | null>(null);
  const autoCashoutTriggeredRef = useRef<boolean>(false);
  const handleCashoutRef = useRef<(explicitTarget?: number) => void>(() => {});

  /* -- in-flight guards (synchronous, unlike state) so a pointerdown +
     click pair or a spacebar mash can never double-fire a wager action -- */
  const startInFlightRef = useRef(false);
  const cashoutInFlightRef = useRef(false);

  /* -- presentation refs (read by the frame loop) -- */
  const lastMilestoneRef = useRef(1);
  const autoApproachFiredRef = useRef(false);

  // Keep the auto-cashout ref in sync with the validated value + enabled flag
  useEffect(() => {
    autoCashoutRef.current = autoCashoutEnabled ? autoCashoutValue : null;
  }, [autoCashoutEnabled, autoCashoutValue]);

  /* ---------- Auto-cashout handlers ---------- */

  // Slider change: clamp + commit immediately, also enable.
  const handleAutoSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = clampAuto(parseFloat(e.target.value));
      setAutoCashoutValue(v);
      setAutoCashoutText(v.toFixed(2));
      setAutoCashoutEnabled(true);
    },
    [],
  );

  // Text input change: keep the raw text in state for free typing, and only
  // commit to autoCashoutValue if the parsed number is in range. This means
  // mid-typing values like "" or "1." don't bork the slider position.
  const handleAutoTextChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      setAutoCashoutText(next);
      const parsed = parseFloat(next);
      if (Number.isFinite(parsed) && parsed >= AUTO_MIN && parsed <= AUTO_MAX) {
        setAutoCashoutValue(Math.round(parsed * 100) / 100);
        setAutoCashoutEnabled(true);
      }
    },
    [],
  );

  // On blur (or Enter): clamp the value and re-format the text. This is the
  // hard backstop — even if the user types "9999" or "abc", they'll always
  // end up with a valid value here.
  const commitAutoText = useCallback(() => {
    const parsed = parseFloat(autoCashoutText);
    const v = clampAuto(parsed);
    setAutoCashoutValue(v);
    setAutoCashoutText(v.toFixed(2));
  }, [autoCashoutText]);

  const toggleAutoCashout = useCallback(() => {
    setAutoCashoutEnabled((prev) => !prev);
    playHaptic("tap");
  }, []);

  /* -- session / provably fair -- */
  const {
    tokenRef,
    revealedSeed,
    setRevealedSeed,
    start: startSession,
    action: sessionAction,
    achievements,
  } = useWagerSession("arcade-crash");

  /* -- animation / polling refs -- */
  const startTimeRef = useRef<number>(0);
  const frameLoopRef = useRef<GameFrameLoop | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Whether we've corrected the local clock against the server's elapsed
  // value at least once during this round.
  const clockAnchoredRef = useRef<boolean>(false);

  /* ---------- Animation + server tick polling ---------- */

  const stopAll = useCallback(() => {
    frameLoopRef.current?.stop();
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  /** Smooth local interpolation between server ticks. */
  const startLocalInterpolation = useCallback(() => {
    startTimeRef.current = Date.now();
    const renderFrame = () => {
      const elapsed = Date.now() - startTimeRef.current;
      // Smoothly interpolate using the local formula (same as server)
      const localMult = getMultiplier(elapsed);

      // Display is quantized to whole cents — matching the server's
      // cent-floored curve and skipping React re-renders whenever the
      // visible number hasn't changed (most frames early in a round).
      const shown = Math.floor(localMult * 100) / 100;
      setDisplayMultiplier((prev) => (prev === shown ? prev : shown));

      // Milestone escalation: tick + readout pop as the rocket crosses
      // ×2, ×5, ×10, … — the anticipation ramp of the round.
      for (let i = MILESTONES.length - 1; i >= 0; i--) {
        const m = MILESTONES[i]!;
        if (localMult >= m) {
          if (m > lastMilestoneRef.current) {
            lastMilestoneRef.current = m;
            setMilestonePop((c) => c + 1);
            SoundManager.play(m >= 10 ? "arcadeReveal" : "arcadeTick");
            playHaptic(m >= 10 ? "medium" : "light");
          }
          break;
        }
      }

      // Auto-cashout: fire as soon as the local multiplier crosses the
      // user's target. We pass the *exact* target (not localMult) so the
      // server locks the cashout in at, e.g., 9.95x rather than 9.97x just
      // because the rAF tick happened to land slightly past the threshold.
      const target = autoCashoutRef.current;
      if (target != null) {
        // "Closing in" cue once per round as the target comes within reach.
        if (
          !autoApproachFiredRef.current &&
          localMult >= target * AUTO_APPROACH_RATIO
        ) {
          autoApproachFiredRef.current = true;
          setAutoApproach(true);
          SoundManager.play("arcadeReveal");
        }
        if (!autoCashoutTriggeredRef.current && localMult >= target) {
          autoCashoutTriggeredRef.current = true;
          handleCashoutRef.current(target);
        }
      }
    };
    if (!frameLoopRef.current) {
      frameLoopRef.current = createGameFrameLoop({
        // Server polling remains authoritative. This loop only paints the
        // same Date.now()-parameterised interpolation and input threshold.
        simulate: () => undefined,
        render: renderFrame,
      });
    }
    frameLoopRef.current.start();
  }, []);

  /** Poll the server for authoritative crash state every 300ms. */
  const startServerPolling = useCallback(() => {
    const poll = async () => {
      if (!tokenRef.current) return;
      const requestSentAt = Date.now();
      try {
        const ticked = await sessionAction<TickResponse>("tick");
        const responseReceivedAt = Date.now();
        const halfRtt = (responseReceivedAt - requestSentAt) / 2;
        if (!ticked.ok) return;
        const data = ticked.data;

        if (data.status === "crashed") {
          // Server says it crashed — stop everything and show crash
          stopAll();
          SoundManager.play("arcadeCrash");
          playHaptic("failure");
          const cp = data.crashPoint ?? 1;
          setCrashPoint(cp);
          setDisplayMultiplier(cp);
          setCashoutMultiplier(null);
          setPayout(0);
          setRevealedSeed(data.seed ?? null);
          setRoundId(data.roundId ?? null);
          setPhase("crashed");
          triggerFeedback("loss", { sound: false });
          void refreshWallet();
          return;
        }

        // Anchor the local clock to the server's authoritative elapsed time so
        // the displayed multiplier matches what the server will compute at
        // cashout. The server measured `data.elapsed` ~halfRtt ms ago, so
        // current server elapsed ≈ data.elapsed + halfRtt.
        if (data.status === "flying" && typeof data.elapsed === "number") {
          const targetStartTime = responseReceivedAt - (data.elapsed + halfRtt);
          if (!clockAnchoredRef.current) {
            // First successful tick — snap the clock into alignment.
            clockAnchoredRef.current = true;
            startTimeRef.current = targetStartTime;
          } else {
            // Subsequent ticks — only re-anchor if we've drifted significantly
            // (>120ms) so that normal jitter doesn't yank the multiplier
            // backward visually.
            const drift = Math.abs(targetStartTime - startTimeRef.current);
            if (drift > 120) {
              startTimeRef.current = targetStartTime;
            }
          }
        }
      } catch {
        // Network blip — keep going, local interpolation continues
      }
    };
    pollRef.current = setInterval(() => void poll(), 300);
    // Fire immediately too
    void poll();
  }, [
    stopAll,
    refreshWallet,
    tokenRef,
    sessionAction,
    setRevealedSeed,
    triggerFeedback,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAll();
      frameLoopRef.current?.destroy();
      frameLoopRef.current = null;
    };
  }, [stopAll]);

  /* ---------- Start game ---------- */
  const handleStartGame = useCallback(async () => {
    // Synchronous guard: pointer + keyboard + rapid double-taps all funnel
    // through here, and only the first may create a session.
    if (startInFlightRef.current) return;
    if (balance == null) return;
    startInFlightRef.current = true;
    setError(null);

    if (wager > balance) {
      setError(`You need ${wager} tickets for this bet.`);
      startInFlightRef.current = false;
      return;
    }

    setIsStarting(true);
    try {
      const session = await startSession(wager);
      if (!session.ok) {
        setError(
          machineError(session.error, "The machine could not start the round."),
        );
        return;
      }

      SoundManager.play("arcadeBet");
      playHaptic("tap");

      setCrashPoint(null);
      setCashoutMultiplier(null);
      setPayout(0);
      setDisplayMultiplier(1);
      autoCashoutTriggeredRef.current = false;
      clockAnchoredRef.current = false;
      lastMilestoneRef.current = 1;
      autoApproachFiredRef.current = false;
      setAutoApproach(false);
      setIsCashingOut(false);
      setRoundStake(wager);
      setRoundId(null);
      setPhase("flying");

      // Optimistically debit wallet
      adjustCredits(-wager);

      // Start local interpolation + server polling
      startLocalInterpolation();
      startServerPolling();
    } catch {
      setError("The machine lost its connection. Try again.");
    } finally {
      startInFlightRef.current = false;
      setIsStarting(false);
    }
  }, [
    wager,
    balance,
    startLocalInterpolation,
    startServerPolling,
    startSession,
    adjustCredits,
  ]);

  /* ---------- Cash out ----------
   *
   * `explicitTarget` is set when auto-cashout fires — we want the server to
   * lock in at the user's *exact* configured target, not the slightly-higher
   * value the local rAF happened to be on when it crossed the threshold.
   * For manual cashouts (button, tap on the screen, or spacebar) we send the
   * displayed multiplier so the user gets exactly what they saw on screen.
   */
  const handleCashout = useCallback(
    async (explicitTarget?: number) => {
      if (phase !== "flying" || cashoutInFlightRef.current) return;
      cashoutInFlightRef.current = true;
      setIsCashingOut(true);
      setError(null);

      // Lock in the multiplier the user actually saw / asked for at this
      // instant. The server uses this as the cashout multiplier so network
      // latency between trigger and receipt can never push the cashout above
      // the user's intended target.
      const targetMultiplier = explicitTarget ?? displayMultiplier;

      try {
        const cashout = await sessionAction<CashoutResponse>("cashout", {
          targetMultiplier,
        });
        if (!cashout.ok) {
          setError(
            machineError(
              cashout.error,
              "The cash out did not go through. Try again.",
            ),
          );
          return;
        }
        const data = cashout.data;

        stopAll();

        if (data.cashedOut) {
          // Won!
          const mult = data.multiplier ?? displayMultiplier;
          const cashoutPayout = data.payout ?? Math.floor(roundStake * mult);
          const celebrationTier = getWagerCelebrationTier({
            amount: cashoutPayout,
            stake: roundStake,
            multiplier: mult,
            net: cashoutPayout - roundStake,
          });
          playHaptic("success");
          setCashoutMultiplier(mult);
          setDisplayMultiplier(mult);
          setCrashPoint(data.crashPoint ?? null);
          setPayout(cashoutPayout);
          setRevealedSeed(data.seed ?? null);
          setRoundId(data.roundId ?? null);
          setPhase("cashedOut");
          triggerFeedback(
            celebrationTier === "standard" ? "cashout" : "jackpot",
          );
          void refreshWallet();
        } else {
          // Crashed before cashout reached server
          SoundManager.play("arcadeCrash");
          playHaptic("failure");
          const cp = data.crashPoint ?? displayMultiplier;
          setCrashPoint(cp);
          setDisplayMultiplier(cp);
          setCashoutMultiplier(null);
          setPayout(0);
          setRevealedSeed(data.seed ?? null);
          setRoundId(data.roundId ?? null);
          setPhase("crashed");
          triggerFeedback("loss", { sound: false });
          void refreshWallet();
        }
      } catch {
        setError("The machine lost its connection. Try the cash out again.");
      } finally {
        cashoutInFlightRef.current = false;
        setIsCashingOut(false);
      }
    },
    [
      phase,
      displayMultiplier,
      roundStake,
      stopAll,
      refreshWallet,
      sessionAction,
      setRevealedSeed,
      triggerFeedback,
    ],
  );

  /* Keep the cashout ref pointed at the latest handler so the frame loop
     can fire it without being recreated when handleCashout's deps change. */
  useEffect(() => {
    handleCashoutRef.current = (explicitTarget?: number) => {
      void handleCashout(explicitTarget);
    };
  }, [handleCashout]);

  /* ---------- Keyboard: Space launches, never cashes out ---------- */
  useMachineKey(
    useMemo(
      () => (phase === "flying" ? null : () => void handleStartGame()),
      [phase, handleStartGame],
    ),
  );

  /* ---------- Computed values ---------- */
  const flying = phase === "flying";
  const over = phase === "cashedOut" || phase === "crashed";
  const potentialPayout = Math.floor(roundStake * displayMultiplier);
  const affordable = balance != null && wager <= balance;

  // The painted curve climbs to whatever multiplier we're showing. On crash
  // it freezes at the crash point; on cashout it freezes at the cashout mult.
  const curveTo =
    phase === "crashed"
      ? (crashPoint ?? displayMultiplier)
      : phase === "cashedOut"
        ? (cashoutMultiplier ?? displayMultiplier)
        : displayMultiplier;
  const curvePath = useMemo(() => buildCurvePath(curveTo), [curveTo]);
  const head = curveHead(curveTo);
  // A bust repaints the whole frozen curve danger red — the altitude the
  // rocket reached no longer matters once it's down.
  const paint =
    phase === "crashed" ? "var(--enamel-danger)" : multiplierPaint(curveTo);
  const ink =
    phase === "crashed" ? "var(--enamel-danger-text)" : multiplierInk(curveTo);

  /* ---------- Render ---------- */
  const glass = (
    <MachineGlass
      name="crash"
      rules={[
        "Cash out before the rocket crashes to win your bet times the multiplier. How often the rocket passes:",
      ]}
      paytable={GLASS_MARKS.map((m) => ({
        label: `${m}×`,
        value: passChance(m),
        lit: phase === "cashedOut" && (cashoutMultiplier ?? 0) >= m,
      }))}
    />
  );

  const screen = (
    <div
      className={`crash-screen ${phase === "crashed" ? "crash-screen--crashed" : ""}`}
      data-phase={phase}
    >
        {/* Recessed grid screen — the curve is painted enamel on a glass well.
          While flying the whole screen is one big bail-out target: a tap
          anywhere on it cashes out (keyboard players keep Space / the rail
          button; this layer is pointer-only so it never steals focus). */}
        <div
          className="crash-grid"
          data-phase={phase}
          onPointerDown={
            phase === "flying"
              ? (e) => {
                  if (e.button === 0) void handleCashout();
                }
              : undefined
          }
          role="presentation"
        >
          <svg
            className="crash-svg"
            viewBox={`0 0 ${CURVE_W} ${CURVE_H}`}
            preserveAspectRatio="none"
            role="presentation"
          >
            {/* Ghost trajectory on the idle screen — a faint dashed preview of
              a ×10 flight so the stage reads as a launch corridor, not a void */}
            {phase === "idle" && (
              <path
                d={GHOST_CURVE_PATH}
                fill="none"
                stroke="#ffffff16"
                strokeWidth={1.6}
                strokeDasharray="3 4"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {/* Painted area under the curve — flat enamel wash, denser band at
              the base so the flight leaves visible heat behind it */}
            <path
              className="crash-fill"
              d={`${curvePath} L ${CURVE_W} ${CURVE_H} Z`}
              fill={paint}
              fillOpacity={0.22}
            />
            {/* The enamel curve line itself */}
            <path
              className="crash-curve"
              d={curvePath}
              fill="none"
              stroke={paint}
              strokeWidth={3.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            {/* Head marker — a painted rivet that rides the curve tip */}
            {(phase === "flying" ||
              phase === "cashedOut" ||
              phase === "crashed") && (
              <circle
                className="crash-head"
                cx={head.x}
                cy={head.y}
                r={3}
                fill={phase === "crashed" ? "var(--enamel-danger)" : paint}
                stroke="var(--border-ink)"
                strokeWidth={0.8}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>

          {/* The rocket itself rides the curve tip (HTML overlay so the glyph
            isn't distorted by the non-uniform SVG scale). Flying: nose up-right
            with a thrust shiver and a flat enamel exhaust trail. Cashed out:
            it escapes straight up. Crashed: nose-dive at the crash altitude. */}
          {phase !== "idle" && (
            <div
              className="crash-rocket"
              data-phase={phase}
              style={{ top: `${head.y}%` }}
            >
              {phase === "flying" && (
                <span className="crash-exhaust" aria-hidden>
                  <span />
                  <span />
                  <span />
                </span>
              )}
              <Rocket
                size={26}
                aria-hidden
                style={{
                  color:
                    phase === "crashed" ? "var(--enamel-danger-text)" : ink,
                  transform:
                    phase === "crashed"
                      ? "rotate(135deg)"
                      : phase === "cashedOut"
                        ? "rotate(-45deg)"
                        : "none",
                }}
              />
            </div>
          )}

          {/* Burst debris — flat enamel shards kicked out from the rocket head
            on the bust frame, or a prize-colored confetti pop on cashout.
            Pure CSS animation; removed entirely under reduced motion. */}
          {phase === "crashed" && (
            <div
              className="crash-burst"
              style={{ top: `${head.y}%` }}
              aria-hidden
            >
              {CRASH_DEBRIS.map((d, i) => (
                <span
                  key={i}
                  className="crash-burst-piece"
                  style={{
                    ["--dx" as string]: `${d.dx}px`,
                    ["--dy" as string]: `${d.dy}px`,
                    ["--rot" as string]: `${d.rot}deg`,
                    animationDelay: `${d.delay}ms`,
                    width: d.size,
                    height: d.size,
                    background: d.paint,
                  }}
                />
              ))}
            </div>
          )}
          {phase === "cashedOut" && (
            <div
              className="crash-burst"
              style={{ top: `${head.y}%` }}
              aria-hidden
            >
              {CASHOUT_CONFETTI.map((d, i) => (
                <span
                  key={i}
                  className="crash-burst-piece crash-burst-piece--prize"
                  style={{
                    ["--dx" as string]: `${d.dx}px`,
                    ["--dy" as string]: `${d.dy}px`,
                    ["--rot" as string]: `${d.rot}deg`,
                    animationDelay: `${d.delay}ms`,
                    width: d.size,
                    height: d.size,
                    background: d.paint,
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Screen-reader round status — the visual readout updates every frame,
          so only phase-level outcomes are announced. */}
        <p className="sr-only" role="status">
          {flying
            ? "Rocket launched."
            : phase === "cashedOut"
              ? `Cashed out at ${fmtMult(cashoutMultiplier ?? displayMultiplier)}, paying ${payout.toLocaleString()} tickets.`
              : phase === "crashed"
                ? `Crashed at ${fmtMult(crashPoint ?? displayMultiplier)}.`
                : ""}
        </p>

        {/* Readout overlay — big mono multiplier, centered on the screen */}
        <div className="crash-readout">
          {/* ---------- IDLE phase ---------- */}
          {phase === "idle" && (
            <div className="space-y-2 text-center">
              {/* Launch pad — the rocket sits on an enamel platform with a
                gentle pre-flight bob (stilled under reduced motion) */}
              <div className="crash-pad mx-auto">
                <Rocket
                  size={44}
                  aria-hidden
                  className="crash-pad-rocket mx-auto -rotate-45 text-strong"
                />
                <span className="crash-pad-deck" aria-hidden />
                <span className="crash-pad-legs" aria-hidden />
              </div>
              <p className="text-base font-semibold text-strong">
                Ready to launch.
              </p>
              <p className="text-xs text-body">
                The multiplier climbs until the rocket crashes.
              </p>
            </div>
          )}

          {/* ---------- FLYING phase ---------- */}
          {flying && (
            <div className="space-y-1.5 text-center">
              {/* key=milestonePop remounts on each milestone crossing so the
                pop animation re-fires (disabled under reduced motion). */}
              <p
                key={milestonePop}
                className={`arcade-num arc-mult font-bold leading-none ${multiplierSize(displayMultiplier)} ${
                  milestonePop > 0 ? "crash-mult-pop" : ""
                }`}
                style={{ color: ink }}
              >
                {fmtMult(displayMultiplier)}
              </p>
              <p className="arcade-num text-xs font-medium text-body">
                Pays{" "}
                <span className="font-bold text-strong">
                  {potentialPayout.toLocaleString()}
                </span>{" "}
                tickets now.
              </p>
              {autoCashoutEnabled && (
                <p
                  className={`arcade-num text-[11px] font-medium ${
                    autoApproach ? "crash-auto-soon" : "text-faint"
                  }`}
                >
                  {autoApproach
                    ? `Closing in on auto cash out at ${fmtMult(autoCashoutValue)}.`
                    : `Auto cash out at ${fmtMult(autoCashoutValue)}.`}
                </p>
              )}
              <p className="text-[11px] text-faint sm:hidden">
                Tap the screen to cash out.
              </p>
            </div>
          )}

          {/* ---------- ROUND OVER: the frozen readout ---------- */}
          {over && (
            <div className="space-y-1.5 text-center">
              <p
                className={`arcade-num arc-mult font-bold leading-none ${multiplierSize(curveTo)}`}
                style={{ color: ink }}
              >
                {fmtMult(curveTo)}
              </p>
              <p className="text-xs font-medium text-body">
                {phase === "cashedOut"
                  ? crashPoint != null
                    ? `Cashed out. The rocket went down at ${fmtMult(crashPoint)}.`
                    : "Cashed out."
                  : "The rocket crashed."}
              </p>
            </div>
          )}
        </div>
    </div>
  );

  /* pointerdown (not click) is the fast path — in a crash game the ~100ms
     between press and click-release is real money. The click handler stays
     for keyboard/AT activation; a synchronous in-flight ref makes the pair
     fire exactly once. */
  const action = flying ? (
    <MachineButton
      className={`touch-manipulation ${autoApproach ? "crash-cashout-urgent" : ""}`}
      onPointerDown={(e) => {
        if (e.button === 0) void handleCashout();
      }}
      onClick={() => {
        void handleCashout();
      }}
      aria-disabled={isCashingOut || undefined}
      aria-label={`cash out ${potentialPayout} tickets`}
    >
      cash out
    </MachineButton>
  ) : (
    <MachineButton
      className="touch-manipulation"
      onClick={() => void handleStartGame()}
      disabled={!affordable || wager < ARCADE_MIN_BET}
      aria-disabled={isStarting || undefined}
      aria-label={`launch, ${wager} tickets`}
    >
      launch
    </MachineButton>
  );

  /* Auto cash out: an on/off row, and the target as a slider and a field. */
  const controls = (
    <div className="crash-auto" data-on={autoCashoutEnabled || undefined}>
      <MachineChoice
        label="auto cash out"
        options={[
          { value: "off", label: "off" },
          { value: "on", label: "on" },
        ]}
        value={autoCashoutEnabled ? "on" : "off"}
        onChange={(next) => {
          if ((next === "on") !== autoCashoutEnabled) toggleAutoCashout();
        }}
        disabled={flying}
      />
      <div className="crash-auto-row">
        <input
          id="crash-auto-cashout-slider"
          type="range"
          min={AUTO_MIN}
          max={AUTO_MAX}
          step={AUTO_STEP}
          value={autoCashoutValue}
          onChange={handleAutoSliderChange}
          disabled={flying}
          aria-label="auto cash out multiplier"
          className="crash-slider"
        />
        <span className="crash-auto-field">
          <input
            type="text"
            inputMode="decimal"
            value={autoCashoutText}
            onChange={handleAutoTextChange}
            onBlur={commitAutoText}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitAutoText();
                (e.target as HTMLInputElement).blur();
              }
            }}
            disabled={flying}
            aria-label="auto cash out at"
            className="arcade-num"
          />
          <span aria-hidden>×</span>
        </span>
      </div>
    </div>
  );

  const receipt = over ? (
    <ArcadeWagerResultPlate
      result={{
        payout: phase === "cashedOut" ? payout : 0,
        stake: roundStake,
        multiplier:
          phase === "cashedOut" ? (cashoutMultiplier ?? displayMultiplier) : 0,
      }}
      kicker="crash"
      headline={
        phase === "cashedOut"
          ? fmtMult(cashoutMultiplier ?? displayMultiplier)
          : "crashed"
      }
      detail={
        crashPoint != null || phase === "crashed"
          ? `The rocket went down at ${fmtMult(crashPoint ?? displayMultiplier)}.`
          : undefined
      }
      fairness={{ seedHash: null, revealedSeed }}
      achievements={achievements}
      roundId={roundId ?? undefined}
      sound={false}
    />
  ) : null;

  return (
    <GameShell
      game="crash"
      stat={<GameStat value={`${CRASH_MAX_MULTIPLIER}×`} label="top" />}
      howTo={HOW_TO}
    >
      <ArcadeMachine
        name="crash"
        glass={glass}
        action={action}
        bet={{ value: wager, onChange: setWager, balance, disabled: flying }}
        controls={controls}
        receipt={receipt}
        receiptKey={roundId}
        notice={error}
      >
        {screen}
      </ArcadeMachine>

      <style jsx global>{`
        /* Recessed glass "screen" — cool well behind the painted curve.
           Grid lines are hairline rules etched into the screen, not glowing. */
        /* phones: room for the curve and the readout */
        .arc-shell[data-game="crash"] .arc-machine-frame:not([data-wide]) {
          --machine-screen-min: 18rem;
        }
        /* The playfield fills the machine's screen. */
        .crash-screen {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background:
            repeating-linear-gradient(
              0deg,
              transparent 0 calc(12.5% - 1px),
              #ffffff0a calc(12.5% - 1px) 12.5%
            ),
            repeating-linear-gradient(
              90deg,
              transparent 0 calc(10% - 1px),
              #ffffff0a calc(10% - 1px) 10%
            ),
            var(--screen-well);
        }
        .crash-grid {
          position: absolute;
          inset: 10px;
          border: 1px solid #00000060;
          border-radius: 4px;
          box-shadow:
            inset 0 2px 10px #000000aa,
            inset 0 0 0 1px #ffffff08;
          overflow: hidden;
          touch-action: manipulation;
        }
        /* While flying the screen is the bail-out target — show it. */
        .crash-grid[data-phase="flying"] {
          cursor: pointer;
        }
        /* Screen lighting: a static enamel vignette + top sheen so the well
           reads as curved glass. Flat shading, no glow, zero repaint cost. */
        .crash-grid::before {
          content: "";
          position: absolute;
          inset: 0;
          z-index: 1;
          pointer-events: none;
          background:
            radial-gradient(120% 90% at 50% 0%, #ffffff08 0%, transparent 45%),
            radial-gradient(
              140% 120% at 50% 110%,
              transparent 55%,
              #00000038 100%
            );
        }
        .crash-svg {
          width: 100%;
          height: 100%;
          display: block;
        }
        .crash-curve {
          transition: d 0.12s linear;
        }
        /* Fill + head rivet share the curve's 0.12s cadence — without it they
           jump instantly while the line/rocket glide, tearing the curve tip. */
        .crash-fill {
          transition: d 0.12s linear;
        }
        .crash-head {
          transition:
            cx 0.12s linear,
            cy 0.12s linear;
        }
        .crash-readout {
          position: relative;
          z-index: 2;
          margin: auto;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 12px;
          pointer-events: none;
        }
        /* Rocket riding the curve tip — pinned to the right edge, top follows
           the head. Same 0.12s linear cadence as the curve so they move as
           one. Flat enamel, no glow. */
        .crash-rocket {
          position: absolute;
          right: 6px;
          transform: translateY(-50%);
          transition: top 0.12s linear;
          pointer-events: none;
          z-index: 1;
        }
        /* nose-turn on cashout/crash lives in CSS so reduced motion can
           disable it (an inline transition would win over the media block) */
        .crash-rocket svg {
          transition: transform 0.25s ease-out;
        }
        .crash-rocket[data-phase="flying"] svg {
          animation: crashThrust 0.3s ease-in-out infinite;
        }
        @keyframes crashThrust {
          0%,
          100% {
            translate: 0 0;
          }
          50% {
            translate: 1px -1px;
          }
        }
        /* Exhaust — three flat enamel puffs trailing down-left off the
           nozzle, staggered so the trail reads continuous. */
        .crash-exhaust {
          position: absolute;
          left: 1px;
          bottom: 2px;
          pointer-events: none;
        }
        .crash-exhaust span {
          position: absolute;
          left: 0;
          bottom: 0;
          width: 7px;
          height: 7px;
          border-radius: 9999px;
          background: var(--enamel-tickets);
          opacity: 0;
          animation: crashPuff 0.66s linear infinite;
        }
        .crash-exhaust span:nth-child(2) {
          width: 5px;
          height: 5px;
          animation-delay: 0.22s;
        }
        .crash-exhaust span:nth-child(3) {
          width: 4px;
          height: 4px;
          background: var(--enamel-prize);
          animation-delay: 0.44s;
        }
        @keyframes crashPuff {
          0% {
            transform: translate(0, 0) scale(0.6);
            opacity: 0.85;
          }
          100% {
            transform: translate(-16px, 15px) scale(1.5);
            opacity: 0;
          }
        }
        /* Milestone pop — a quick 1.12x stamp on the readout each time the
           multiplier crosses ×2 / ×5 / ×10 / … */
        .crash-mult-pop {
          animation: crashMultPop 0.28s cubic-bezier(0.2, 0.9, 0.3, 1.4) both;
        }
        @keyframes crashMultPop {
          0% {
            transform: scale(1.14);
          }
          100% {
            transform: scale(1);
          }
        }
        /* Auto-cashout approach — the target line + rail button pulse as the
           multiplier closes in. */
        .crash-auto-soon {
          color: var(--enamel-tickets-text);
          animation: crashAutoPulse 0.5s ease-in-out infinite;
        }
        .crash-cashout-urgent {
          animation: crashAutoPulse 0.5s ease-in-out infinite;
        }
        @keyframes crashAutoPulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.55;
          }
        }
        /* Burst debris — enamel shards flung from the rocket head on the
           bust/cashout frame. Positions come from per-piece CSS vars. */
        .crash-burst {
          position: absolute;
          right: 18px;
          z-index: 1;
          pointer-events: none;
        }
        .crash-burst-piece {
          position: absolute;
          left: 0;
          top: 0;
          border-radius: 1px;
          opacity: 0;
          animation: crashDebris 0.6s cubic-bezier(0.15, 0.6, 0.35, 1) forwards;
        }
        .crash-burst-piece--prize {
          border-radius: 9999px;
          animation-name: crashConfetti;
          animation-duration: 0.75s;
        }
        @keyframes crashDebris {
          0% {
            transform: translate(0, 0) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translate(var(--dx), var(--dy)) rotate(var(--rot));
            opacity: 0;
          }
        }
        @keyframes crashConfetti {
          0% {
            transform: translate(0, 0) rotate(0deg) scale(0.6);
            opacity: 1;
          }
          100% {
            transform: translate(var(--dx), var(--dy)) rotate(var(--rot))
              scale(1.1);
            opacity: 0;
          }
        }
        /* Idle launch pad — enamel deck + legs under the resting rocket */
        .crash-pad {
          position: relative;
          width: 96px;
          padding-bottom: 14px;
        }
        .crash-pad-rocket {
          position: relative;
          z-index: 1;
          animation: crashPadBob 2.6s ease-in-out infinite;
        }
        .crash-pad-deck {
          position: absolute;
          left: 50%;
          bottom: 8px;
          width: 72px;
          height: 8px;
          transform: translateX(-50%);
          border-radius: 3px;
          background: var(--enamel-prize);
          box-shadow:
            inset 0 -2px 0 #00000055,
            inset 0 1px 0 #ffffff30;
        }
        .crash-pad-legs {
          position: absolute;
          left: 50%;
          bottom: 0;
          width: 52px;
          height: 8px;
          transform: translateX(-50%);
          background:
            linear-gradient(to right, var(--border-ink) 0 6px, transparent 6px)
              left/50% 100% no-repeat,
            linear-gradient(to left, var(--border-ink) 0 6px, transparent 6px)
              right/50% 100% no-repeat;
        }
        @keyframes crashPadBob {
          0%,
          100% {
            translate: 0 0;
          }
          50% {
            translate: 0 -4px;
          }
        }
        /* Small screens: shrink the pad so the readout keeps clear of the
           curve on short stages. */
        @media (max-width: 640px) {
          .crash-pad {
            width: 76px;
            padding-bottom: 11px;
          }
          .crash-pad-rocket {
            width: 34px;
            height: 34px;
          }
          .crash-pad-deck {
            width: 58px;
            height: 7px;
          }
          .crash-pad-legs {
            width: 42px;
            height: 7px;
          }
        }
        /* Crash juice — a hard, brief red wash + cabinet shake. No glow. */
        .crash-screen--crashed {
          animation: crashShake 0.42s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
        }
        .crash-screen--crashed::after {
          content: "";
          position: absolute;
          inset: 0;
          z-index: 1;
          background: var(--enamel-danger);
          mix-blend-mode: screen;
          pointer-events: none;
          animation: crashFlash 0.5s ease-out forwards;
        }
        @keyframes crashShake {
          0%,
          100% {
            transform: translateX(0);
          }
          12% {
            transform: translateX(-5px);
          }
          24% {
            transform: translateX(5px);
          }
          40% {
            transform: translateX(-4px);
          }
          56% {
            transform: translateX(3px);
          }
          72% {
            transform: translateX(-2px);
          }
          88% {
            transform: translateX(1px);
          }
        }
        @keyframes crashFlash {
          0% {
            opacity: 0.4;
          }
          100% {
            opacity: 0;
          }
        }
        /* Auto cash out on the ink deck: on/off, a slider and a field. */
        .crash-auto {
          display: grid;
          width: 20rem;
          max-width: 100%;
          gap: 0.5rem;
        }
        .crash-auto-row {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }
        .crash-auto:not([data-on]) .crash-auto-row {
          opacity: 0.6;
        }
        .crash-slider {
          flex: 1;
          min-width: 0;
          height: 2.75rem;
          appearance: none;
          background: transparent;
          cursor: pointer;
        }
        .crash-slider::-webkit-slider-runnable-track {
          height: 6px;
          border-radius: 9999px;
          background: var(--tixy-screen);
        }
        .crash-slider::-moz-range-track {
          height: 6px;
          border-radius: 9999px;
          background: var(--tixy-screen);
        }
        .crash-slider::-webkit-slider-thumb {
          appearance: none;
          width: 1.25rem;
          height: 1.25rem;
          margin-top: -7px;
          border-radius: 9999px;
          background: var(--tixy-paper);
        }
        .crash-slider::-moz-range-thumb {
          width: 1.25rem;
          height: 1.25rem;
          border: 0;
          border-radius: 9999px;
          background: var(--tixy-paper);
        }
        .crash-slider:disabled,
        .crash-auto-field input:disabled {
          cursor: not-allowed;
        }
        .crash-auto-field {
          display: flex;
          flex: none;
          align-items: center;
          gap: 0.25rem;
          width: 5.5rem;
          min-height: 2.75rem;
          padding: 0 0.625rem;
          border-radius: var(--tixy-radius-button-sm);
          background: var(--tixy-screen);
          color: var(--tixy-on-ink-2);
        }
        .crash-auto-field input {
          width: 100%;
          min-width: 0;
          background: transparent;
          border: 0;
          text-align: right;
          font-size: 1rem;
          font-weight: 700;
          color: var(--tixy-paper);
        }
        .crash-auto-field:focus-within {
          outline: 2px solid var(--tixy-paper);
          outline-offset: 2px;
        }
        .crash-auto-field input:focus {
          outline: none;
        }
        /* Slider focus — the keyboard ring must survive the custom thumb. */
        .crash-slider:focus-visible {
          outline: 2px solid var(--tixy-paper);
          outline-offset: 2px;
        }
        @media (prefers-reduced-motion: reduce) {
          .crash-curve {
            transition: none;
          }
          .crash-fill {
            transition: none;
          }
          .crash-head {
            transition: none;
          }
          .crash-screen--crashed {
            animation: none;
          }
          .crash-screen--crashed::after {
            animation: none;
            opacity: 0;
          }
          .crash-rocket {
            transition: none;
          }
          .crash-rocket svg {
            transition: none;
          }
          .crash-rocket[data-phase="flying"] svg {
            animation: none;
          }
          .crash-exhaust {
            display: none;
          }
          .crash-burst {
            display: none;
          }
          .crash-mult-pop {
            animation: none;
          }
          .crash-auto-soon {
            animation: none;
          }
          .crash-cashout-urgent {
            animation: none;
          }
          .crash-pad-rocket {
            animation: none;
          }
        }
      `}</style>
    </GameShell>
  );
}
