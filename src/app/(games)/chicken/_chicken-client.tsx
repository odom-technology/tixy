"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Bird } from "lucide-react";
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
import { ArcadeChip } from "@/features/arcade/components/ui/arcade-ui";
import { SoundManager } from "@/features/arcade/lib/sound-manager";
import { createGameFrameLoop } from "@/features/arcade/lib/game-frame-loop";
import { useWagerSession } from "@/features/arcade/lib/use-wager-session";
import { ARCADE_MIN_BET } from "@/server/arcade/arcade-constants";

/* ===========================================================================
 *  Types + constants
 * ========================================================================= */

type GamePhase = "setup" | "playing" | "won" | "lost";
type Difficulty = "easy" | "medium" | "hard" | "daredevil";

type LaneFate = boolean[];

type AdvanceResponse = {
  alive?: boolean;
  lanesCrossed?: number;
  currentMultiplier?: number;
  allLanesCrossed?: boolean;
  payout?: number;
  seed?: number;
  lanes?: LaneFate;
  roundId?: string | null;
};

type Car = {
  lane: number; // world strip index
  y: number; // screen y
  vy: number; // px/sec (signed: +down, -up)
  width: number; // horizontal (perpendicular to motion)
  height: number; // vertical (length of car body)
  color: string;
  stroke: string;
  kind: "ambient" | "attack";
  hit: boolean;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  /** Tumble rotation so feathers flutter instead of falling as dots */
  rot: number;
  rotV: number;
};

type ChickenAnim =
  | { kind: "idle"; bobT: number }
  | {
      kind: "hop";
      startT: number;
      fromWorldX: number;
      toWorldX: number;
      durationMs: number;
      willDie: boolean;
    }
  | {
      kind: "dying";
      startT: number;
      impactX: number;
      impactY: number;
    }
  | { kind: "victory"; startT: number };

type GameRef = {
  /** World-space x of the chicken. 0 = start grass; +LANE_W per forward strip. */
  chickenWorldX: number;
  /** Smoothed camera scroll (world x). */
  cameraWorldX: number;
  cameraTargetX: number;
  /** Committed lane count mirrored from React state. */
  lanesCrossed: number;
  chickenAnim: ChickenAnim;
  cars: Car[];
  particles: Particle[];
  shake: number;
  /** White flash remaining (seconds). */
  flashT: number;
  fateKnown: LaneFate | null;
  difficulty: Difficulty;
  lastFrameT: number;
};

/* ---- Canvas geometry (horizontal top-down view) ---- */
const CANVAS_W = 640;
const CANVAS_H = 360;
/** Width of one road strip (a "lane" the chicken hops across). */
const LANE_W = 112;
const CHICKEN_W = 40;
const CHICKEN_H = 34;
/** Chicken's fixed on-screen x (camera anchors here). */
const CHICKEN_VIEWPORT_X = 160;
/** Chicken's fixed on-screen y (center of the road). */
const CHICKEN_VIEWPORT_Y = CANVAS_H / 2;
const HOP_DURATION_MS = 420;
const DEATH_HOLD_MS = 1100;
/* ---- Difficulty details (mirror server) ---- */
const DIFFICULTY_DETAILS: Record<
  Difficulty,
  {
    laneCount: number;
    label: string;
    deathProb: number;
    sub: string;
    carMinSpeed: number;
    carMaxSpeed: number;
    attackSpeed: number;
    maxMult: number;
  }
> = {
  easy: {
    laneCount: 24,
    label: "Easy",
    deathProb: 1 / 25,
    sub: "4% risk · up to ~2.5x",
    carMinSpeed: 170,
    carMaxSpeed: 230,
    attackSpeed: 700,
    maxMult: 2.58,
  },
  medium: {
    laneCount: 24,
    label: "Medium",
    deathProb: 3 / 25,
    sub: "12% risk · up to ~22x",
    carMinSpeed: 200,
    carMaxSpeed: 280,
    attackSpeed: 820,
    maxMult: 20.85,
  },
  hard: {
    laneCount: 24,
    label: "Hard",
    deathProb: 5 / 25,
    sub: "20% risk · up to ~200x",
    carMinSpeed: 240,
    carMaxSpeed: 340,
    attackSpeed: 960,
    maxMult: 205.4,
  },
  daredevil: {
    laneCount: 12,
    label: "Daredevil",
    deathProb: 10 / 25,
    sub: "40% risk · up to ~448x",
    carMinSpeed: 300,
    carMaxSpeed: 420,
    attackSpeed: 1100,
    maxMult: 447.71,
  },
};

const DIFFICULTIES = Object.keys(DIFFICULTY_DETAILS) as Difficulty[];

const HOW_TO: GameHowTo = {
  lines: [
    "Pick a difficulty, press play, then cross the road one strip at a time.",
    "A car on a strip takes the bet, so cash out before one hits.",
    "On medium, 1 strip pays 1.1×, 10 pay 3.48× and all 24 pay 20.85×.",
  ],
};

/* Midway enamel car paints — flat saturated bodies on dark ink strokes.
   Mirrors the shell's enamel/piece palette so the cabinet stays coherent
   across all four sub-themes. Purely cosmetic. */
const CAR_PALETTE = [
  { body: "#c73538", stroke: "#5a1719" }, // enamel red
  { body: "#3b6fd4", stroke: "#1c3469" }, // enamel blue
  { body: "#f2a33c", stroke: "#7a4f17" }, // ticket amber
  { body: "#2fb8a6", stroke: "#155349" }, // prize teal
  { body: "#9a52d6", stroke: "#48256b" }, // enamel violet
  { body: "#e8d9b8", stroke: "#6b5631" }, // cream key face
];

/* ---- Midway material palette (canvas, dark lacquered cabinet) ---- */
const MK = {
  asphalt: "#1b140d", // dark lacquered road on the recessed screen
  asphaltDeep: "#120c07",
  grass: "#1d8579", // prize-teal "infield" (deep)
  grassLight: "#2fb8a6", // teal mowed-row band
  grassBlade: "#155349",
  curb: "#f2a33c", // amber curb
  curbShade: "#9a621a",
  laneLine: "rgba(246,237,220,0.42)", // cream dashed dividers
  edgeLine: "#e8d9b8", // cream shoulder lines
  ink: "#0a0704",
  cream: "#f6eddc",
  creamDim: "rgba(246,237,220,0.4)",
  amber: "#f2a33c",
  amberDeep: "#c47c1f",
  red: "#c73538",
  bodyCream: "#f3e6c4", // chicken body
  bodyWing: "#e8a23a", // chicken wing/amber
  beak: "#e8902a",
} as const;

/* Canvas can't resolve CSS var() in ctx.font — use the concrete stack that
   --font-mono-arcade resolves to so on-board numerics read as mono. */
const CANVAS_MONO = "'Spline Sans Mono', ui-monospace, monospace";

const RTP = 0.97;
const MAX_MULT = 500;

function computeMultiplier(lanes: number, difficulty: Difficulty): number {
  if (lanes <= 0) return 0;
  if (lanes > DIFFICULTY_DETAILS[difficulty].laneCount) return 0;
  const survival = 1 - DIFFICULTY_DETAILS[difficulty].deathProb;
  if (survival <= 0) return 0;
  const fair = 1 / Math.pow(survival, lanes);
  return Math.floor(Math.min(MAX_MULT, fair * RTP) * 100) / 100;
}

function formatMult(m: number): string {
  if (m >= 100) return `${m.toFixed(0)}x`;
  return `${m.toFixed(2)}x`;
}

/** A multiplier for the machine's words and glass. */
function fmtMult(m: number): string {
  return `${m.toLocaleString("en-US", { maximumFractionDigits: 2 })}×`;
}

/* Reduced-motion flag shared with the module-level update/draw fns. When on:
   no screen shake, no white flash, no feather burst — the crash snaps to the
   result instead of playing the juice. Updated by an effect in the client. */
let prefersReducedMotion = false;

/** Traffic direction for a strip: alternates down/up by strip index. */
function laneDirection(lane: number): 1 | -1 {
  return lane % 2 === 0 ? 1 : -1;
}

/** World-x of a strip center → screen x. Chicken anchors at
 *  CHICKEN_VIEWPORT_X when cameraWorldX == chickenWorldX. */
function worldLaneToScreenX(lane: number, cameraWorldX: number): number {
  return CHICKEN_VIEWPORT_X + (lane * LANE_W - cameraWorldX);
}

function chickenScreenX(state: GameRef): number {
  return CHICKEN_VIEWPORT_X + (state.chickenWorldX - state.cameraWorldX);
}

/* ===========================================================================
 *  Component
 * ========================================================================= */

export default function ChickenClient() {
  const { trigger: triggerFeedback } = useGameFeedback();
  const {
    wallet,
    loaded: walletLoaded,
    refresh: refreshWallet,
    adjustCredits,
  } = useGamesWallet();
  const balance = walletLoaded ? wallet.credits : null;
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");

  const [phase, setPhase] = useState<GamePhase>("setup");
  const [wager, setWager] = useMachineBet(balance, 10, {
    locked: phase === "playing",
  });
  /* The stake the open round was bought with; the receipt prints it. */
  const [roundStake, setRoundStake] = useState(0);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [lanesCrossed, setLanesCrossed] = useState(0);
  const [currentMultiplier, setCurrentMultiplier] = useState(0);
  const [payout, setPayout] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isAdvancing, setIsAdvancing] = useState(false);

  const {
    revealedSeed,
    setRevealedSeed,
    start: startSession,
    action: sessionAction,
    settle: settleSession,
    achievements,
  } = useWagerSession("arcade-chicken");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<GameRef>({
    chickenWorldX: 0,
    cameraWorldX: 0,
    cameraTargetX: 0,
    lanesCrossed: 0,
    chickenAnim: { kind: "idle", bobT: 0 },
    cars: [],
    particles: [],
    shake: 0,
    flashT: 0,
    fateKnown: null,
    difficulty: "medium",
    lastFrameT: 0,
  });

  /* ---------- Track reduced-motion preference ---------- */
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      prefersReducedMotion = mq.matches;
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  /* ---------- Canvas game loop ---------- */
  useEffect(() => {
    if (phase === "setup") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const state = gameRef.current;
    state.lastFrameT = performance.now();

    const frameLoop = createGameFrameLoop({
      // Wager state is committed by the server and React timers. Keep the
      // original wall-clock animation math and 64ms hitch cap unchanged.
      simulate: () => undefined,
      render: (_alpha, frameInfo) => {
        const now = frameInfo.nowMs;
        const dt = Math.min(64, now - state.lastFrameT) / 1000;
        state.lastFrameT = now;
        updateGame(state, dt, now);
        drawGame(ctx, state);
      },
    });
    frameLoop.start();
    return () => frameLoop.destroy();
  }, [phase]);

  /* ---------- Mirror committed state into ref ---------- */
  useEffect(() => {
    gameRef.current.difficulty = difficulty;
  }, [difficulty]);

  useEffect(() => {
    gameRef.current.lanesCrossed = lanesCrossed;
  }, [lanesCrossed]);

  /* ---------- Start ---------- */
  const handleStart = useCallback(async () => {
    if (isStarting || balance == null) return;
    setError(null);
    if (wager > balance) {
      setError(`You need ${wager} tickets for this bet.`);
      return;
    }
    setIsStarting(true);
    try {
      const session = await startSession(wager, { difficulty });
      if (!session.ok) {
        setError(
          machineError(session.error, "The machine could not start the run."),
        );
        return;
      }

      SoundManager.play("arcadeBet");

      const state = gameRef.current;
      state.chickenWorldX = 0;
      state.cameraWorldX = 0;
      state.cameraTargetX = 0;
      state.lanesCrossed = 0;
      state.chickenAnim = { kind: "idle", bobT: 0 };
      state.cars = [];
      state.particles = [];
      state.shake = 0;
      state.flashT = 0;
      state.fateKnown = null;
      state.difficulty = difficulty;

      setLanesCrossed(0);
      setCurrentMultiplier(0);
      setPayout(0);
      setRoundStake(wager);
      setRoundId(null);
      setPhase("playing");

      adjustCredits(-wager);
    } catch {
      setError("The machine lost its connection. Try again.");
    } finally {
      setIsStarting(false);
    }
  }, [
    isStarting,
    wager,
    balance,
    difficulty,
    startSession,
    adjustCredits,
  ]);

  /* ---------- Advance ---------- */
  const handleAdvance = useCallback(async () => {
    if (phase !== "playing" || isAdvancing) return;
    if (gameRef.current.chickenAnim.kind !== "idle") return;

    setIsAdvancing(true);
    setError(null);
    try {
      const advanced = await sessionAction<AdvanceResponse>("advance");
      if (!advanced.ok) {
        setError(
          machineError(advanced.error, "The chicken did not move. Try again."),
        );
        setIsAdvancing(false);
        return;
      }
      const data = advanced.data;

      const state = gameRef.current;
      const attemptingLane = state.lanesCrossed + 1;
      const fromWorldX = state.chickenWorldX;
      const toWorldX = attemptingLane * LANE_W;

      state.chickenAnim = {
        kind: "hop",
        startT: performance.now(),
        fromWorldX,
        toWorldX,
        durationMs: HOP_DURATION_MS,
        willDie: !data.alive,
      };

      if (!data.alive) {
        state.fateKnown = (data.lanes as LaneFate) ?? null;
        state.cars.push(spawnAttackCar(attemptingLane, difficulty));
      }

      setTimeout(() => {
        if (data.alive) {
          SoundManager.play("arcadeReveal");
          setLanesCrossed(data.lanesCrossed ?? 0);
          setCurrentMultiplier(data.currentMultiplier ?? 0);
          if (data.allLanesCrossed) {
            setPayout(data.payout ?? 0);
            setRevealedSeed(data.seed ?? null);
            setRoundId(data.roundId ?? null);
            gameRef.current.chickenAnim = {
              kind: "victory",
              startT: performance.now(),
            };
            setPhase("won");
            triggerFeedback("jackpot");
            void refreshWallet();
          } else {
            gameRef.current.chickenAnim = { kind: "idle", bobT: 0 };
          }
          setIsAdvancing(false);
        }
      }, HOP_DURATION_MS);

      if (!data.alive) {
        setTimeout(
          () => {
            SoundManager.play("arcadeExplode");
            const s = gameRef.current;
            const cx = chickenScreenX(s);
            const cy = CHICKEN_VIEWPORT_Y;
            // Crash juice — screen shake, flash, and a feather-burst that
            // replaces the chicken. Reduced motion snaps to the result: no
            // shake/flash/particles, just hide the body.
            if (!prefersReducedMotion) {
              s.shake = 18;
              s.flashT = 0.22;
              s.particles.push(...spawnFeathers(cx, cy, 48));
              s.particles.push(...spawnFeathers(cx, cy - 6, 20));
            }
            s.chickenAnim = {
              kind: "dying",
              startT: performance.now(),
              impactX: cx,
              impactY: cy,
            };
          },
          Math.floor(HOP_DURATION_MS * 0.65),
        );

        setTimeout(() => {
          setRevealedSeed(data.seed ?? null);
          setRoundId(data.roundId ?? null);
          setPayout(0);
          setPhase("lost");
          setIsAdvancing(false);
        }, HOP_DURATION_MS + DEATH_HOLD_MS);
      }
    } catch {
      setError("The machine lost its connection. Try the strip again.");
      setIsAdvancing(false);
    }
  }, [
    phase,
    isAdvancing,
    difficulty,
    refreshWallet,
    sessionAction,
    setRevealedSeed,
    triggerFeedback,
  ]);

  /* ---------- Cashout ---------- */
  const handleCashout = useCallback(async () => {
    if (phase !== "playing" || lanesCrossed === 0 || isAdvancing) return;
    if (gameRef.current.chickenAnim.kind !== "idle") return;
    setError(null);
    try {
      const settled = await settleSession<{
        payout?: number;
        multiplier?: number;
        roundId?: string | null;
      }>();
      if (!settled.ok) {
        setError(
          machineError(
            settled.error,
            "The cash out did not go through. Try again.",
          ),
        );
        return;
      }
      const data = settled.data;
      setPayout(data.payout ?? Math.floor(roundStake * currentMultiplier));
      setCurrentMultiplier(data.multiplier ?? currentMultiplier);
      setRoundId(data.roundId ?? null);
      gameRef.current.chickenAnim = {
        kind: "victory",
        startT: performance.now(),
      };
      setPhase("won");
      triggerFeedback("cashout");
      void refreshWallet();
    } catch {
      setError("The machine lost its connection. Try the cash out again.");
    }
  }, [
    phase,
    lanesCrossed,
    roundStake,
    currentMultiplier,
    isAdvancing,
    refreshWallet,
    settleSession,
    triggerFeedback,
  ]);

  /* ---------- Keyboard: Space crosses a strip, or plays ---------- */
  useMachineKey(
    useMemo(
      () =>
        phase === "playing"
          ? () => void handleAdvance()
          : () => void handleStart(),
      [phase, handleAdvance, handleStart],
    ),
  );

  /* ---------- Computed ---------- */
  const playing = phase === "playing";
  const potentialWin = Math.floor(roundStake * currentMultiplier);
  const nextMultiplier = computeMultiplier(lanesCrossed + 1, difficulty);
  const details = DIFFICULTY_DETAILS[difficulty];
  const laneCount = details.laneCount;
  const affordable = balance != null && wager <= balance;
  const strips = (n: number) => `${n} ${n === 1 ? "strip" : "strips"}`;

  const statusLine =
    phase === "setup"
      ? "Pick a difficulty, then press play."
      : playing
        ? lanesCrossed === 0
          ? `Cross a strip. The first pays ${fmtMult(nextMultiplier)}.`
          : lanesCrossed >= laneCount
            ? `${fmtMult(currentMultiplier)} now.`
            : `${fmtMult(currentMultiplier)} now, ${potentialWin.toLocaleString()} tickets. Next strip pays ${fmtMult(nextMultiplier)}.`
        : phase === "won"
          ? lanesCrossed >= laneCount
            ? `Crossed all ${laneCount} strips.`
            : `Cashed out at ${fmtMult(currentMultiplier)}.`
          : `Hit after ${strips(lanesCrossed)}.`;

  /* ---------- Screen ---------- */
  const screen = (
    <div className="arc-machine-fit">
      {phase === "setup" ? (
        <div className="flex flex-col items-center justify-center gap-3 text-center">
          <Bird size={40} aria-hidden className="text-faint" />
        </div>
      ) : (
        <div
          className="relative overflow-hidden"
          style={{
            width: `min(100%, ${CANVAS_W}px, calc((100cqh - 3.5rem) * ${CANVAS_W / CANVAS_H}))`,
            aspectRatio: `${CANVAS_W} / ${CANVAS_H}`,
          }}
        >
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            className="absolute inset-0 block h-full w-full"
          />
          <ArcadeChip className="arcade-num pointer-events-none absolute left-2.5 top-2.5 text-strong">
            strip {Math.min(lanesCrossed, laneCount)} of {laneCount}
          </ArcadeChip>
          <ArcadeChip className="pointer-events-none absolute right-2.5 top-2.5 text-tickets-text">
            {difficulty}
          </ArcadeChip>
        </div>
      )}
      <p role="status" className="arc-machine-status">
        {statusLine}
      </p>
    </div>
  );

  const glassStrips = [1, 5, 10, laneCount].filter(
    (n, idx, arr) => arr.indexOf(n) === idx,
  );
  const glass = (
    <MachineGlass
      name="crossy chicken"
      rules={[
        `On ${difficulty}, ${Math.round(details.deathProb * 100)}% of strips have a car. Cash out before one hits.`,
      ]}
      paytable={glassStrips.map((n) => ({
        label: strips(n),
        value: fmtMult(computeMultiplier(n, difficulty)),
        lit: (playing || phase === "won") && lanesCrossed === n,
      }))}
    />
  );

  const action = playing ? (
    <>
      <MachineButton
        onClick={() => void handleAdvance()}
        disabled={lanesCrossed >= laneCount}
        aria-disabled={isAdvancing || undefined}
        aria-label={`cross, next strip pays ${fmtMult(nextMultiplier)}`}
      >
        cross
      </MachineButton>
      <MachineButton
        second
        onClick={() => void handleCashout()}
        disabled={lanesCrossed === 0}
        aria-disabled={isAdvancing || undefined}
        aria-label={
          lanesCrossed === 0
            ? "cash out, cross a strip first"
            : `cash out ${potentialWin} tickets`
        }
      >
        cash out
      </MachineButton>
    </>
  ) : (
    <MachineButton
      onClick={() => void handleStart()}
      disabled={!affordable || wager < ARCADE_MIN_BET}
      aria-disabled={isStarting || undefined}
      aria-label={`play, ${wager} tickets`}
    >
      play
    </MachineButton>
  );

  const receipt =
    phase === "won" || phase === "lost" ? (
      <ArcadeWagerResultPlate
        result={{
          payout: phase === "won" ? payout : 0,
          stake: roundStake,
          multiplier: phase === "won" ? currentMultiplier : 0,
        }}
        kicker="crossy chicken"
        headline={phase === "won" ? fmtMult(currentMultiplier) : "hit"}
        detail={`${difficulty}, ${strips(lanesCrossed)}`}
        fairness={{ seedHash: null, revealedSeed }}
        achievements={achievements}
        roundId={roundId ?? undefined}
        sound={false}
      />
    ) : null;

  return (
    <GameShell
      game="chicken"
      stat={
        <GameStat
          value={fmtMult(computeMultiplier(laneCount, difficulty))}
          label="top"
        />
      }
      howTo={HOW_TO}
    >
      <ArcadeMachine
        name="crossy chicken"
        glass={glass}
        action={action}
        bet={{ value: wager, onChange: setWager, balance, disabled: playing }}
        controls={
          <MachineChoice<Difficulty>
            label="difficulty"
            options={DIFFICULTIES.map((key) => ({ value: key, label: key }))}
            value={difficulty}
            onChange={setDifficulty}
            disabled={playing}
          />
        }
        receipt={receipt}
        receiptKey={roundId}
        notice={error}
      >
        {screen}
      </ArcadeMachine>
    </GameShell>
  );
}

/* ===========================================================================
 *  Game state updates
 * ========================================================================= */

function updateGame(state: GameRef, dt: number, nowMs: number) {
  // Chicken animation
  const anim = state.chickenAnim;
  if (anim.kind === "idle") {
    anim.bobT += dt;
  } else if (anim.kind === "hop") {
    const t = Math.min(1, (nowMs - anim.startT) / anim.durationMs);
    const effectiveT = anim.willDie ? Math.min(t, 0.65) : t;
    const eased =
      effectiveT < 0.5
        ? 2 * effectiveT * effectiveT
        : 1 - Math.pow(-2 * effectiveT + 2, 2) / 2;
    state.chickenWorldX =
      anim.fromWorldX + (anim.toWorldX - anim.fromWorldX) * eased;
  } else if (anim.kind === "victory") {
    state.chickenWorldX += dt * 70; // walk forward
  }

  // Camera follows the committed lane (not the live chicken x), so the
  // chicken visibly moves forward during a hop before the camera catches up.
  state.cameraTargetX = state.lanesCrossed * LANE_W;
  const camLerp = 1 - Math.exp(-dt * 7);
  state.cameraWorldX += (state.cameraTargetX - state.cameraWorldX) * camLerp;

  // Cars
  for (const car of state.cars) {
    car.y += car.vy * dt;
    if (
      car.kind === "attack" &&
      !car.hit &&
      state.chickenAnim.kind !== "dying"
    ) {
      const carLaneX = worldLaneToScreenX(car.lane, state.cameraWorldX);
      const cx = chickenScreenX(state);
      const dx = Math.abs(cx - carLaneX);
      const dy = Math.abs(car.y - CHICKEN_VIEWPORT_Y);
      if (dx < 40 && dy < (car.height + CHICKEN_H) / 2 - 6) {
        car.hit = true;
      }
    }
  }
  state.cars = state.cars.filter((c) => c.y > -160 && c.y < CANVAS_H + 160);

  maintainAmbientCars(state);

  // Particles — light gravity plus air drag and tumble so feathers float
  for (const p of state.particles) {
    p.vy += 380 * dt;
    p.vx *= 1 - 1.4 * dt;
    p.vy *= 1 - 0.6 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.rotV * dt;
    p.life -= dt;
  }
  state.particles = state.particles.filter((p) => p.life > 0);

  // Shake + flash decay
  state.shake = Math.max(0, state.shake - dt * 30);
  state.flashT = Math.max(0, state.flashT - dt);
}

function spawnAttackCar(lane: number, difficulty: Difficulty): Car {
  const d = DIFFICULTY_DETAILS[difficulty];
  const dir = laneDirection(lane);
  const speed = d.attackSpeed;
  const palette = CAR_PALETTE[Math.floor(Math.random() * CAR_PALETTE.length)]!;
  const travelTimeMs = HOP_DURATION_MS * 0.62;
  const travelPx = speed * (travelTimeMs / 1000);
  const startY =
    dir === 1 ? CHICKEN_VIEWPORT_Y - travelPx : CHICKEN_VIEWPORT_Y + travelPx;
  return {
    lane,
    y: startY,
    vy: dir * speed,
    width: 48,
    height: 72,
    color: palette.body,
    stroke: palette.stroke,
    kind: "attack",
    hit: false,
  };
}

function maintainAmbientCars(state: GameRef) {
  const d = DIFFICULTY_DETAILS[state.difficulty];
  // Ambient cars only populate already-crossed strips that are still visible.
  const eligible: number[] = [];
  for (let lane = 1; lane < state.lanesCrossed; lane++) {
    const x = worldLaneToScreenX(lane, state.cameraWorldX);
    if (x > 20 && x < CANVAS_W + 20) eligible.push(lane);
  }
  if (eligible.length === 0) return;
  if (Math.random() >= 0.035) return;

  const lane = eligible[Math.floor(Math.random() * eligible.length)]!;
  const laneCars = state.cars.filter((c) => c.lane === lane);
  if (laneCars.length >= 2) return;

  const dir = laneDirection(lane);
  const spawnY = dir === 1 ? -80 : CANVAS_H + 80;
  const minGap = 120;
  const tooClose = laneCars.some((c) => {
    if (Math.abs(c.y - spawnY) < minGap) return true;
    if (dir === 1 && c.y < minGap) return true;
    if (dir === -1 && c.y > CANVAS_H - minGap) return true;
    return false;
  });
  if (tooClose) return;

  const speed = d.carMinSpeed + Math.random() * (d.carMaxSpeed - d.carMinSpeed);
  const palette = CAR_PALETTE[Math.floor(Math.random() * CAR_PALETTE.length)]!;
  state.cars.push({
    lane,
    y: spawnY,
    vy: dir * speed,
    width: 48,
    height: 72,
    color: palette.body,
    stroke: palette.stroke,
    kind: "ambient",
    hit: false,
  });
}

function spawnFeathers(x: number, y: number, count = 30): Particle[] {
  const out: Particle[] = [];
  // Warm cream/amber feather paints (no neon).
  const colors = [
    "#f6eddc",
    "#f3e6c4",
    "#f2a33c",
    "#e8d9b8",
    "#f7bd5e",
    "#e8a23a",
  ];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 140 + Math.random() * 280;
    out.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 140,
      life: 1.0 + Math.random() * 0.7,
      maxLife: 1.7,
      color: colors[Math.floor(Math.random() * colors.length)]!,
      size: 2 + Math.random() * 3.5,
      rot: Math.random() * Math.PI * 2,
      rotV: (Math.random() - 0.5) * 14,
    });
  }
  return out;
}

/* ===========================================================================
 *  Drawing
 * ========================================================================= */

function drawGame(ctx: CanvasRenderingContext2D, state: GameRef) {
  ctx.save();
  if (state.shake > 0) {
    ctx.translate(
      (Math.random() - 0.5) * state.shake,
      (Math.random() - 0.5) * state.shake,
    );
  }

  drawBackground(ctx);
  drawRoad(ctx, state);
  drawFinishLineIfClose(ctx, state);
  drawCars(ctx, state);
  drawChicken(ctx, state);
  drawParticles(ctx, state);

  ctx.restore();

  if (state.flashT > 0) {
    // Warm cream flash (never pure-white glow) on impact.
    const alpha = Math.min(1, state.flashT / 0.2) * 0.6;
    ctx.fillStyle = `rgba(246,237,220,${alpha})`;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }
}

function drawBackground(ctx: CanvasRenderingContext2D) {
  // Dark lacquered base — fully covered by road/grass below, but safe
  // fallback (matches the recessed cabinet "screen").
  ctx.fillStyle = MK.asphaltDeep;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

function drawRoad(ctx: CanvasRenderingContext2D, state: GameRef) {
  const laneCount = DIFFICULTY_DETAILS[state.difficulty].laneCount;
  // Road region: from strip 0.5 (start-zone edge) to strip LANE_COUNT + 0.5 (finish).
  const roadLeft = worldLaneToScreenX(0.5, state.cameraWorldX);
  const roadRight = worldLaneToScreenX(laneCount + 0.5, state.cameraWorldX);
  const clippedLeft = Math.max(0, roadLeft);
  const clippedRight = Math.min(CANVAS_W, roadRight);

  // 1. Asphalt base (solid lacquered road, with top/bottom vignette)
  if (clippedRight > clippedLeft) {
    ctx.fillStyle = MK.asphalt;
    ctx.fillRect(clippedLeft, 0, clippedRight - clippedLeft, CANVAS_H);

    const shoulder = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    shoulder.addColorStop(0, "rgba(0,0,0,0.5)");
    shoulder.addColorStop(0.12, "rgba(0,0,0,0)");
    shoulder.addColorStop(0.88, "rgba(0,0,0,0)");
    shoulder.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = shoulder;
    ctx.fillRect(clippedLeft, 0, clippedRight - clippedLeft, CANVAS_H);
  }

  // 2. Grass for start zone (left of roadLeft).
  if (roadLeft > 0) {
    drawGrass(ctx, 0, 0, Math.min(CANVAS_W, roadLeft), CANVAS_H, "START");
  }
  // 3. Grass for finish zone (right of roadRight).
  if (roadRight < CANVAS_W) {
    drawGrass(
      ctx,
      Math.max(0, roadRight),
      0,
      CANVAS_W - Math.max(0, roadRight),
      CANVAS_H,
      null,
    );
  }

  // 4. Cream edge lines at the top and bottom of the road — real road
  //    shoulder markings. Only drawn where the asphalt is visible.
  if (clippedRight > clippedLeft) {
    ctx.fillStyle = MK.edgeLine;
    ctx.fillRect(clippedLeft, 26, clippedRight - clippedLeft, 3);
    ctx.fillRect(clippedLeft, CANVAS_H - 29, clippedRight - clippedLeft, 3);
  }

  // 5. Target-strip highlight (amber enamel fill). Pulses under motion;
  //    static under reduced motion.
  const targetLane = state.lanesCrossed + 1;
  if (targetLane <= laneCount && state.chickenAnim.kind === "idle") {
    const leftEdge = worldLaneToScreenX(targetLane - 0.5, state.cameraWorldX);
    const rightEdge = worldLaneToScreenX(targetLane + 0.5, state.cameraWorldX);
    const x = Math.max(0, leftEdge);
    const w = Math.min(CANVAS_W, rightEdge) - x;
    if (w > 0) {
      const wave = prefersReducedMotion ? 0 : Math.sin(performance.now() / 220);
      const pulse = 0.1 + 0.06 * wave;
      ctx.fillStyle = `rgba(242, 163, 60, ${pulse.toFixed(3)})`;
      ctx.fillRect(x, 0, w, CANVAS_H);
      const borderPulse = 0.5 + 0.22 * wave;
      ctx.strokeStyle = `rgba(242, 163, 60, ${borderPulse.toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, 1, Math.max(0, w - 2), CANVAS_H - 2);
    }
  }

  // 6. Dashed vertical dividers between strips (cream).
  ctx.strokeStyle = MK.laneLine;
  ctx.lineWidth = 2;
  ctx.setLineDash([14, 16]);
  for (let boundary = 1; boundary < laneCount; boundary++) {
    const x = worldLaneToScreenX(boundary + 0.5, state.cameraWorldX);
    if (x < -4 || x > CANVAS_W + 4) continue;
    ctx.beginPath();
    ctx.moveTo(x, 26);
    ctx.lineTo(x, CANVAS_H - 26);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // 7. Amber curbs separating infield from road (one on each side).
  if (roadLeft > -6 && roadLeft < CANVAS_W + 6) {
    ctx.fillStyle = MK.curb;
    ctx.fillRect(roadLeft - 3, 0, 6, CANVAS_H);
    ctx.fillStyle = MK.curbShade;
    ctx.fillRect(roadLeft + 3, 0, 1, CANVAS_H);
  }
  if (roadRight > -6 && roadRight < CANVAS_W + 6) {
    ctx.fillStyle = MK.curb;
    ctx.fillRect(roadRight - 3, 0, 6, CANVAS_H);
    ctx.fillStyle = MK.curbShade;
    ctx.fillRect(roadRight - 4, 0, 1, CANVAS_H);
  }

  // 8. Per-strip multiplier labels + direction arrows.
  for (let lane = 1; lane <= laneCount; lane++) {
    const centerX = worldLaneToScreenX(lane, state.cameraWorldX);
    if (centerX < -LANE_W / 2 || centerX > CANVAS_W + LANE_W / 2) continue;
    drawLaneLabel(ctx, centerX, lane, state);
  }
}

function drawGrass(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string | null,
) {
  if (w <= 0 || h <= 0) return;
  // Teal-enamel "infield" safe zone (deep base + mowed bands + blades).
  ctx.fillStyle = MK.grass;
  ctx.fillRect(x, y, w, h);
  // Mowed-row stripes: alternating lighter bands across the strip
  const rowW = 26;
  ctx.fillStyle = "rgba(63, 201, 182, 0.16)";
  for (let gx = 0; gx < w; gx += rowW * 2) {
    ctx.fillRect(x + gx, y, Math.min(rowW, w - gx), h);
  }
  // Deterministic blade texture (darker teal)
  ctx.fillStyle = MK.grassBlade;
  for (let gx = 4; gx < w; gx += 14) {
    ctx.fillRect(x + gx, y + 10 + ((gx * 7) % Math.max(4, h - 12)), 2, 6);
    ctx.fillRect(x + gx + 6, y + 30 + ((gx * 3) % Math.max(4, h - 12)), 2, 5);
  }
  if (label) {
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = "rgba(246,237,220,0.45)";
    ctx.font = "bold 14px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, 0, 5);
    ctx.restore();
  }
}

function drawLaneLabel(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  lane: number,
  state: GameRef,
) {
  const mult = computeMultiplier(lane, state.difficulty);
  const isPast = lane <= state.lanesCrossed;
  const isTarget =
    lane === state.lanesCrossed + 1 && state.chickenAnim.kind === "idle";

  ctx.save();
  ctx.textAlign = "center";
  // Multiplier near the top of the strip (mono numerics).
  const topY = 58;
  if (isTarget) {
    const wave = prefersReducedMotion ? 0 : Math.sin(performance.now() / 220);
    const pulse = 0.9 + 0.1 * wave;
    ctx.font = `bold 22px ${CANVAS_MONO}`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(10,7,4,0.8)";
    ctx.fillStyle = `rgba(242, 163, 60, ${pulse.toFixed(3)})`;
    ctx.strokeText(formatMult(mult), centerX, topY);
    ctx.fillText(formatMult(mult), centerX, topY);
  } else if (isPast) {
    // Cleared-lane checkmark drawn as a path so it renders identically on
    // every platform (no glyph/emoji fallback).
    ctx.strokeStyle = "rgba(47, 184, 166, 0.6)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(centerX - 8, topY - 7);
    ctx.lineTo(centerX - 2, topY - 1);
    ctx.lineTo(centerX + 8, topY - 13);
    ctx.stroke();
  } else {
    ctx.font = `bold 18px ${CANVAS_MONO}`;
    ctx.fillStyle = "rgba(246,237,220,0.4)";
    ctx.fillText(formatMult(mult), centerX, topY);
  }

  // Directional arrow near the bottom.
  const dir = laneDirection(lane);
  const arrowY = CANVAS_H - 52;
  ctx.fillStyle = "rgba(246,237,220,0.18)";
  ctx.beginPath();
  if (dir === 1) {
    ctx.moveTo(centerX - 10, arrowY - 8);
    ctx.lineTo(centerX + 10, arrowY - 8);
    ctx.lineTo(centerX, arrowY + 10);
  } else {
    ctx.moveTo(centerX - 10, arrowY + 8);
    ctx.lineTo(centerX + 10, arrowY + 8);
    ctx.lineTo(centerX, arrowY - 10);
  }
  ctx.closePath();
  ctx.fill();

  // Small strip number under the mult (mono).
  ctx.fillStyle = "rgba(179, 164, 138, 0.55)";
  ctx.font = `10px ${CANVAS_MONO}`;
  ctx.fillText(`#${lane}`, centerX, topY + 14);

  ctx.restore();
}

function drawFinishLineIfClose(ctx: CanvasRenderingContext2D, state: GameRef) {
  const laneCount = DIFFICULTY_DETAILS[state.difficulty].laneCount;
  const x = worldLaneToScreenX(laneCount + 0.5, state.cameraWorldX);
  if (x < -20 || x > CANVAS_W + 20) return;
  const stripes = 12;
  const stripeH = CANVAS_H / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? MK.cream : MK.ink;
    ctx.fillRect(x - 6, i * stripeH, 12, stripeH);
  }
  // Second row for thickness
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? MK.ink : MK.cream;
    ctx.fillRect(x + 6, i * stripeH, 6, stripeH);
  }
  // FINISH label to the right of the line (in the infield zone)
  ctx.fillStyle = MK.amber;
  ctx.strokeStyle = MK.ink;
  ctx.lineWidth = 3;
  ctx.font = `bold 16px ${CANVAS_MONO}`;
  ctx.textAlign = "center";
  ctx.save();
  ctx.translate(x + 30, CANVAS_H / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.strokeText("FINISH", 0, 0);
  ctx.fillText("FINISH", 0, 0);
  ctx.restore();
}

function drawCars(ctx: CanvasRenderingContext2D, state: GameRef) {
  for (const car of state.cars) {
    const x = worldLaneToScreenX(car.lane, state.cameraWorldX);
    if (x < -LANE_W || x > CANVAS_W + LANE_W) continue;
    drawCar(ctx, car, x);
  }
}

function drawCar(ctx: CanvasRenderingContext2D, car: Car, centerX: number) {
  const facingDown = car.vy > 0;
  const w = car.width;
  const h = car.height;
  const left = centerX - w / 2;
  const top = car.y - h / 2;

  // Shadow offset slightly to the right
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  roundRect(ctx, left + 4, top + 3, w, h, 8);
  ctx.fill();

  // Body
  ctx.fillStyle = car.color;
  roundRect(ctx, left, top, w, h, 8);
  ctx.fill();
  ctx.strokeStyle = car.stroke;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Hood (front end) — warm gloss highlight
  ctx.fillStyle = "rgba(255,247,234,0.1)";
  if (facingDown) {
    roundRect(ctx, left + 3, top + h * 0.55, w - 6, h * 0.35, 4);
  } else {
    roundRect(ctx, left + 3, top + h * 0.1, w - 6, h * 0.35, 4);
  }
  ctx.fill();

  // Windshield (dark lacquer)
  ctx.fillStyle = "rgba(12, 9, 7, 0.82)";
  const windY = facingDown ? top + h * 0.15 : top + h * 0.55;
  roundRect(ctx, left + 5, windY, w - 10, h * 0.28, 3);
  ctx.fill();

  // Roof split (thin center stripe)
  ctx.fillStyle = "rgba(20, 14, 8, 0.7)";
  ctx.fillRect(left + 5, top + h * 0.45, w - 10, h * 0.1);

  // Wheels — dark tires with a warm tread stripe
  const drawWheel = (wx: number, wy: number) => {
    ctx.fillStyle = "#0a0704";
    roundRect(ctx, wx, wy, 5, 14, 2.5);
    ctx.fill();
    ctx.fillStyle = "rgba(179,164,138,0.4)";
    ctx.fillRect(wx + 1.5, wy + 5, 2, 4);
  };
  drawWheel(left - 3, top + 6);
  drawWheel(left - 3, top + h - 20);
  drawWheel(left + w - 2, top + 6);
  drawWheel(left + w - 2, top + h - 20);

  // Headlight beams cast onto the road ahead (amber wash, no glow)
  const beamLen = h * 0.45;
  const beamTop = facingDown ? top + h : top - beamLen;
  const beamGrad = ctx.createLinearGradient(
    0,
    facingDown ? top + h : top,
    0,
    facingDown ? top + h + beamLen : top - beamLen,
  );
  beamGrad.addColorStop(0, "rgba(242,163,60,0.16)");
  beamGrad.addColorStop(1, "rgba(242,163,60,0)");
  ctx.fillStyle = beamGrad;
  ctx.fillRect(left + 3, beamTop, w - 6, beamLen);

  // Headlights — flat amber enamel dots (no glow/blur in the Midway cabinet)
  ctx.fillStyle = MK.amber;
  if (facingDown) {
    ctx.fillRect(left + 6, top + h - 4, 6, 4);
    ctx.fillRect(left + w - 12, top + h - 4, 6, 4);
  } else {
    ctx.fillRect(left + 6, top, 6, 4);
    ctx.fillRect(left + w - 12, top, 6, 4);
  }
}

function drawChicken(ctx: CanvasRenderingContext2D, state: GameRef) {
  const anim = state.chickenAnim;

  // On death the chicken is replaced by a feather burst — draw nothing for
  // the body/shadow so the particles carry the entire visual.
  if (anim.kind === "dying") return;

  const x = chickenScreenX(state);
  const y = CHICKEN_VIEWPORT_Y;

  let hopLift = 0;
  let wingPhase = 0;
  let bodyRot = 0;

  if (anim.kind === "idle") {
    if (!prefersReducedMotion) {
      hopLift = Math.sin(anim.bobT * 4) * 1.5;
      wingPhase = Math.sin(anim.bobT * 3) * 0.6;
    }
  } else if (anim.kind === "hop") {
    const t = Math.min(1, (performance.now() - anim.startT) / anim.durationMs);
    // Reduced motion: no vertical hop arc / wing flap / body tilt — the
    // chicken slides flat to the next strip instead of bouncing.
    if (!prefersReducedMotion) {
      hopLift = -Math.sin(t * Math.PI) * 26;
      bodyRot = (t - 0.5) * 0.25;
      wingPhase = Math.sin(t * 12) * 1.2;
      if (anim.willDie && t > 0.65) hopLift = -Math.sin(0.65 * Math.PI) * 26;
    }
  } else if (anim.kind === "victory") {
    if (!prefersReducedMotion) {
      hopLift = Math.sin((performance.now() - anim.startT) / 80) * 4;
      wingPhase = Math.sin((performance.now() - anim.startT) / 50) * 1.5;
    }
  }

  // Shadow (stays on ground)
  ctx.save();
  ctx.fillStyle = `rgba(0,0,0,${anim.kind === "hop" ? 0.22 : 0.4})`;
  ctx.beginPath();
  ctx.ellipse(x, y + 16, CHICKEN_W / 2 - 2, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(x, y + hopLift);
  ctx.rotate(bodyRot);

  // Body
  ctx.fillStyle = MK.bodyCream;
  ctx.strokeStyle = MK.ink;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(0, 0, CHICKEN_W / 2, CHICKEN_H / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Wing
  ctx.fillStyle = MK.bodyWing;
  ctx.beginPath();
  ctx.ellipse(-4, 2 + wingPhase, 10, 6, wingPhase * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Tail feathers (back)
  ctx.fillStyle = MK.amber;
  ctx.beginPath();
  ctx.moveTo(-CHICKEN_W / 2 + 2, -4);
  ctx.lineTo(-CHICKEN_W / 2 - 7, -9);
  ctx.lineTo(-CHICKEN_W / 2 - 5, 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Head (front, facing right)
  ctx.fillStyle = MK.bodyCream;
  ctx.beginPath();
  ctx.arc(CHICKEN_W / 2 - 3, -7, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Comb (enamel-red crest)
  ctx.fillStyle = MK.red;
  ctx.beginPath();
  ctx.arc(CHICKEN_W / 2 - 6, -15, 3, 0, Math.PI * 2);
  ctx.arc(CHICKEN_W / 2 - 1, -16, 3, 0, Math.PI * 2);
  ctx.arc(CHICKEN_W / 2 + 3, -14, 3, 0, Math.PI * 2);
  ctx.fill();

  // Eye
  ctx.fillStyle = MK.ink;
  ctx.beginPath();
  ctx.arc(CHICKEN_W / 2, -8, 1.8, 0, Math.PI * 2);
  ctx.fill();
  // Eye gleam
  ctx.fillStyle = MK.cream;
  ctx.beginPath();
  ctx.arc(CHICKEN_W / 2 + 0.6, -8.6, 0.7, 0, Math.PI * 2);
  ctx.fill();

  // Beak
  ctx.fillStyle = MK.beak;
  ctx.beginPath();
  ctx.moveTo(CHICKEN_W / 2 + 5, -7);
  ctx.lineTo(CHICKEN_W / 2 + 12, -5);
  ctx.lineTo(CHICKEN_W / 2 + 5, -3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Feet
  ctx.strokeStyle = MK.beak;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-5, CHICKEN_H / 2);
  ctx.lineTo(-5, CHICKEN_H / 2 + 5);
  ctx.moveTo(5, CHICKEN_H / 2);
  ctx.lineTo(5, CHICKEN_H / 2 + 5);
  ctx.stroke();

  ctx.restore();
}

function drawParticles(ctx: CanvasRenderingContext2D, state: GameRef) {
  // Feather-shaped quills: an elongated ellipse with a darker spine,
  // tumbling via p.rot.
  for (const p of state.particles) {
    const alpha = Math.max(0, p.life / p.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, p.size * 1.7, p.size * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(120, 80, 20, 0.35)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-p.size * 1.5, 0);
    ctx.lineTo(p.size * 1.5, 0);
    ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

/* ---- canvas helper: rounded rect ---- */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
