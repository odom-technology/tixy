"use client";

import { sha256 } from "@/features/arcade/lib/sha256";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import "./_slots.css";
import {
  GameShell,
  type GameHowTo,
} from "@/features/arcade/components/shell/game-shell";
import {
  ArcadeMachine,
  MachineGlass,
  machineError,
  useMachineBet,
  useMachineKey,
} from "@/features/arcade/components/wagers/arcade-machine";
import { MachineLever } from "@/features/arcade/components/wagers/machine-lever";
import { ArcadeWagerResultPlate } from "@/features/arcade/components/results/arcade-run-result";
import { useGameFeedback } from "@/features/arcade/lib/use-game-feedback";
import { SoundManager } from "@/features/arcade/lib/sound-manager";
import { createGameFrameLoop } from "@/features/arcade/lib/game-frame-loop";
import { cubicBezier } from "@/features/arcade/lib/game-feel";
import { useArcadeRunResult } from "@/features/arcade/lib/run-result";
import {
  getWagerCelebrationTier,
  getWagerFeedbackEvent,
} from "@/features/arcade/lib/wager-celebration";

/* ===========================================================================
 *  Types + constants
 * ========================================================================= */

type SlotSymbol = "cherry" | "lemon" | "bar" | "bell" | "seven" | "star";
type GamePhase = "idle" | "spinning" | "result";

type WinPayline = {
  paylineIndex: number;
  symbols: SlotSymbol[];
  multiplier: number;
};

type SessionResponse = {
  sessionId: string;
  token: string;
};

type SettleResponse = {
  payout: number;
  multiplier: number;
  seed: number;
  roundId: string;
};

type WalletData = { credits: number };

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  spinV: number;
  life: number;
  maxLife: number;
  size: number;
};

type ReelRef = {
  strip: SlotSymbol[];
  /** Current scroll distance (px). Increases during spin. */
  currentOffset: number;
  /** Final resting position. */
  targetOffset: number;
  startT: number;
  durationMs: number;
  /** Index of the TOP-visible symbol at rest. */
  landingIndex: number;
  landed: boolean;
  /** For sound-tick throttling. */
  lastTickSymbolIndex: number;
  /** Scroll speed this frame (px/s); drives the blur. */
  speed: number;
  /** When it locked (performance.now()), for the settle bounce. */
  landedAt: number;
};

/** The cabinet's paint: the tixy palette, flat. Read from the tixy tokens
 *  on mount (every theme defines them), with these values as the fallback.
 *  MACHINES_LOOK.md, "Slots". */
type SlotsPaint = {
  window: string; // the ink window the reels sit in
  reel: string; // paper reel band
  reelShade: string; // the reel's top and bottom edges, a step darker
  ink: string;
  ink2: string;
  red: string; // cherries, the 7, the line that paid
  ticket: string; // the star (the top prize) and a big win's stubs
  lemon: string;
  brass: string; // the bell
  paper: string;
  /** The Big Shoulders font stack, for the 7. */
  numFont: string;
  /** The Gabarito font stack, for the bar plate. */
  textFont: string;
};

const PAINT_FALLBACK: SlotsPaint = {
  window: "#1f1a16",
  reel: "#f4ebdc",
  reelShade: "#eadfcb",
  ink: "#1f1a16",
  ink2: "#54483d",
  red: "#b83627",
  ticket: "#f2a33c",
  lemon: "#e6c44c",
  brass: "#b9832c",
  paper: "#f4ebdc",
  numFont: "'Big Shoulders', sans-serif",
  textFont: "Gabarito, system-ui, sans-serif",
};

/** Read the tixy tokens once on mount, never per frame. */
function readSlotsPaint(el: HTMLElement): SlotsPaint {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    ...PAINT_FALLBACK,
    window: v("--tixy-ink", PAINT_FALLBACK.window),
    reel: v("--tixy-paper", PAINT_FALLBACK.reel),
    reelShade: v("--tixy-paper-2", PAINT_FALLBACK.reelShade),
    ink: v("--tixy-ink", PAINT_FALLBACK.ink),
    ink2: v("--tixy-ink-2", PAINT_FALLBACK.ink2),
    red: v("--tixy-red", PAINT_FALLBACK.red),
    ticket: v("--tixy-ticket", PAINT_FALLBACK.ticket),
    paper: v("--tixy-paper", PAINT_FALLBACK.paper),
    numFont: v("--tixy-font-num", PAINT_FALLBACK.numFont),
    textFont: v("--tixy-font-text", PAINT_FALLBACK.textFont),
  };
}

type GameRef = {
  reels: [ReelRef, ReelRef, ReelRef];
  particles: Particle[];
  winPayline: WinPayline | null;
  /** 0..1 animation progress of the winning-line sweep. */
  winLineT: number;
  winStartT: number | null;
  /** The feel kit's shake offset for this frame (zero when still). */
  shakeAt: () => { x: number; y: number };
  /** Called once as each reel locks, left to right (0, 1, 2). */
  onReelStop: (reel: 0 | 1 | 2) => void;
  phase: GamePhase;
  /** The cabinet's paint (read on mount and on a theme change). */
  theme: SlotsPaint;
  /** When true: no spin scroll, no shake, no LED chase, no coin shower. */
  reducedMotion: boolean;
};

const ALL_SYMBOLS: SlotSymbol[] = [
  "cherry",
  "lemon",
  "bar",
  "bell",
  "seven",
  "star",
];

const PAYOUT_3_MATCH: Record<SlotSymbol, number> = {
  cherry: 3,
  lemon: 5,
  bar: 9,
  bell: 18,
  seven: 50,
  star: 250,
};

const PAYOUT_2_MATCH: Partial<Record<SlotSymbol, number>> = {
  cherry: 1,
  seven: 3,
  star: 6,
};

const PAYLINE_NAMES = [
  "top row",
  "middle row",
  "bottom row",
  "diagonal down",
  "diagonal up",
];

const SYMBOL_PLURAL: Record<SlotSymbol, string> = {
  cherry: "cherries",
  lemon: "lemons",
  bar: "bars",
  bell: "bells",
  seven: "sevens",
  star: "stars",
};

/** The glass: three of a kind, best first, then the pairs that pay. */
const GLASS_ROWS: { symbol: SlotSymbol; count: 2 | 3; mult: number }[] = [
  ...[...ALL_SYMBOLS]
    .reverse()
    .map((symbol) => ({ symbol, count: 3 as const, mult: PAYOUT_3_MATCH[symbol] })),
  ...(Object.entries(PAYOUT_2_MATCH) as [SlotSymbol, number][])
    .sort((a, b) => b[1] - a[1])
    .map(([symbol, mult]) => ({ symbol, count: 2 as const, mult })),
];

const HOW_TO: GameHowTo = {
  lines: [
    "Pick a bet and press spin.",
    "The best of 5 lines pays: three in a row, or a pair of cherries, sevens or stars.",
    "Three stars pay 250× your bet and two cherries return it.",
  ],
};

/** What a winning line paid for: three of a symbol, or two side by side. */
function lineMatch(line: WinPayline): { symbol: SlotSymbol; count: 2 | 3 } {
  const [a, b, c] = line.symbols;
  if (a === b && b === c) return { symbol: a!, count: 3 };
  return { symbol: a === b ? a! : b!, count: 2 };
}

const PAYLINE_INDICES: [number, number, number][] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 4, 8],
  [6, 4, 2],
];

/* Canvas geometry: three paper reels in an ink window. */
const CANVAS_W = 420;
const CANVAS_H = 280;
/** The canvas backing store is this many times the drawing size, so the
    cabinet stays sharp when the machine's screen draws it large. */
const RENDER_SCALE = 2;
const FRAME_L = 24;
const FRAME_TOP = 26;
const VIEWPORT_W = CANVAS_W - FRAME_L * 2; // 372
const SYMBOL_H = 76;
const SYMBOL_VIEWPORT_H = SYMBOL_H * 3; // 228
const REEL_GAP = 9;
const REEL_W = (VIEWPORT_W - REEL_GAP * 2) / 3; // 118
/** The ink window around the reels. */
const WINDOW_PAD = 9;
const STRIP_LEN = 18;

/* Spin timing (ms) — staggered so reels stop L to R */
const REEL_SPIN_DURATIONS = [1500, 2000, 2500];
/** How many extra full rotations the strip scrolls through during the spin,
 *  on top of the final landing position. Higher = more drama. */
const EXTRA_REVOLUTIONS = 3;

/* ---- Weighted symbol pool (mirrors server) ---- */
const SLOT_REEL_STOPS = 32;
const SLOT_SYMBOL_WEIGHTS: { symbol: SlotSymbol; weight: number }[] = [
  { symbol: "cherry", weight: 10 },
  { symbol: "lemon", weight: 8 },
  { symbol: "bar", weight: 6 },
  { symbol: "bell", weight: 4 },
  { symbol: "seven", weight: 3 },
  { symbol: "star", weight: 1 },
];

function buildServerReelStrip(): SlotSymbol[] {
  const strip: SlotSymbol[] = [];
  for (const { symbol, weight } of SLOT_SYMBOL_WEIGHTS) {
    for (let i = 0; i < weight; i++) strip.push(symbol);
  }
  return strip;
}

const SERVER_REEL_STRIP = buildServerReelStrip();

/** When the last win line started to show (performance.now()), so the
    winning symbols pop once and then hold still. */
let winPulseFrom = 0;

/* ===========================================================================
 *  Component
 * ========================================================================= */

export default function SlotsClient() {
  const { trigger: triggerFeedback, shakeOffset } = useGameFeedback();
  const {
    achievements,
    capture: captureRunResult,
    reset: resetRunResult,
  } = useArcadeRunResult();
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [walletLoading, setWalletLoading] = useState(true);

  const [phase, setPhase] = useState<GamePhase>("idle");
  const balance = walletLoading ? null : (wallet?.credits ?? null);
  const [bet, setBet] = useMachineBet(balance, 25, {
    locked: phase === "spinning",
  });
  const [roundId, setRoundId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [lastPayout, setLastPayout] = useState<number | null>(null);
  const [lastMultiplier, setLastMultiplier] = useState<number | null>(null);
  const [settledBet, setSettledBet] = useState(25);
  const [winPayline, setWinPayline] = useState<WinPayline | null>(null);

  const [revealedSeed, setRevealedSeed] = useState<number | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settleTimerRef = useRef<number | null>(null);
  const gameRef = useRef<GameRef>({
    reels: [buildIdleReel(), buildIdleReel(), buildIdleReel()],
    particles: [],
    winPayline: null,
    winLineT: 0,
    winStartT: null,
    shakeAt: () => ({ x: 0, y: 0 }),
    onReelStop: () => {},
    phase: "idle",
    theme: PAINT_FALLBACK,
    reducedMotion: false,
  });

  /* The loop reads the shake through the ref; each reel locks with a clunk
     pitched a step above the last, a tap, and a shake that grows to the
     third reel. */
  useEffect(() => {
    const state = gameRef.current;
    state.shakeAt = () => shakeOffset();
    state.onReelStop = (reel) => {
      SoundManager.play("slotsClunk", { pitch: [1, 1.12, 1.26][reel] });
      triggerFeedback("impact", {
        sound: false,
        haptic: true,
        shake: [0.35, 0.55, 0.9][reel],
      });
    };
  }, [shakeOffset, triggerFeedback]);

  /* ---------- Wallet ---------- */
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

  useEffect(
    () => () => {
      if (settleTimerRef.current != null) {
        window.clearTimeout(settleTimerRef.current);
      }
    },
    [],
  );

  /* ---------- Shared canvas loop ---------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const state = gameRef.current;
    const frameLoop = createGameFrameLoop({
      simulate: () => true,
      render: (_alpha, info) => {
        const dt = Math.min(64, info.deltaMs) / 1000;
        updateGame(state, dt, info.nowMs);
        ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
        drawGame(ctx, state);
      },
    });
    frameLoop.start();
    return () => frameLoop.destroy();
  }, []);

  /* Mirror phase into ref so the loop can read it. */
  useEffect(() => {
    gameRef.current.phase = phase;
  }, [phase]);

  /* Read the tixy tokens and the reduced-motion preference. Re-reads when
     the account swaps arcade theme (data-arcade-theme on <html>). */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const refreshTheme = () => {
      gameRef.current.theme = readSlotsPaint(canvas);
    };
    refreshTheme();

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const applyMotion = () => {
      gameRef.current.reducedMotion = mq.matches;
    };
    applyMotion();
    mq.addEventListener("change", applyMotion);

    const themeObserver = new MutationObserver(refreshTheme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-arcade-theme"],
    });

    return () => {
      mq.removeEventListener("change", applyMotion);
      themeObserver.disconnect();
    };
  }, []);

  /* ---------- Spin ---------- */
  // Spin starts the next round from the idle machine or from the last
  // round's result.
  const handleSpin = useCallback(async () => {
    triggerFeedback("press", { haptic: true });
    if (phase === "spinning" || !wallet) return;
    if (wallet.credits < bet) {
      setError(`You need ${bet} tickets for this bet.`);
      return;
    }

    setError(null);
    setPhase("spinning");
    setSettledBet(bet);
    setLastPayout(null);
    setLastMultiplier(null);
    setWinPayline(null);
    setRevealedSeed(null);
    setRoundId(null);
    resetRunResult();

    // Optimistic bet deduction
    setWallet((prev) =>
      prev ? { ...prev, credits: prev.credits - bet } : prev,
    );

    // Reset game state for a fresh spin
    const state = gameRef.current;
    state.reels = [buildIdleReel(), buildIdleReel(), buildIdleReel()];
    state.particles = [];
    state.winPayline = null;
    state.winLineT = 0;
    state.winStartT = null;

    try {
      const sessionRes = await fetch("/api/wagers/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameType: "arcade-slots", wager: bet }),
      });
      const sessionData = (await sessionRes.json()) as SessionResponse & {
        error?: string;
      };
      if (!sessionRes.ok)
        throw new Error(
          machineError(sessionData.error, "The machine could not start the spin. Try again."),
        );

      const settleRes = await fetch("/api/wagers/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: sessionData.token, action: "cashout" }),
      });
      const settleData = (await settleRes.json()) as SettleResponse & {
        error?: string;
      };
      if (!settleRes.ok)
        throw new Error(
          machineError(settleData.error, "The spin did not settle. Your tickets are safe."),
        );
      captureRunResult(settleData);

      const resolved = await deriveGridFromSeed(settleData.seed);
      // Load each reel with its final symbols + start the scroll animation.
      const reduced = state.reducedMotion;
      kickOffReels(state, resolved.grid, reduced);
      if (reduced) state.onReelStop(2);

      const settleResult = () => {
        settleTimerRef.current = null;
        setRevealedSeed(settleData.seed);
        setRoundId(settleData.roundId ?? null);
        setLastPayout(settleData.payout);
        setLastMultiplier(settleData.multiplier);
        setWinPayline(resolved.winPayline);
        setPhase("result");
        const celebrationTier = getWagerCelebrationTier({
          amount: settleData.payout,
          stake: bet,
          multiplier: settleData.multiplier,
          net: settleData.payout - bet,
        });
        triggerFeedback(
          getWagerFeedbackEvent({
            won: settleData.payout > 0,
            amount: settleData.payout,
            stake: bet,
            multiplier: settleData.multiplier,
            net: settleData.payout - bet,
          }),
          { haptic: true },
        );

        if (settleData.multiplier > 0) {
          // Win-line reveal: trace under full motion, snap on under reduced.
          state.winPayline = resolved.winPayline;
          state.winStartT = reduced ? null : performance.now();
          winPulseFrom = state.winStartT ?? 0;
          state.winLineT = reduced ? 1 : 0;
          // A big win bursts ticket stubs from the line (none under
          // reduced motion).
          if (celebrationTier !== "standard" && !reduced) {
            state.particles.push(...spawnStubBurst(resolved.winPayline));
          }
        }
        void loadWallet();
      };

      // When the last reel lands, transition to result phase. Reduced motion
      // settles straight to the result instead of waiting out the spin.
      settleTimerRef.current = window.setTimeout(
        settleResult,
        reduced ? 60 : REEL_SPIN_DURATIONS[2]! + 50,
      );
    } catch (err) {
      setError(
        err instanceof Error && err.message !== "Failed to fetch"
          ? err.message
          : "The machine lost its connection. Try again.",
      );
      setPhase("idle");
      state.reels = [buildIdleReel(), buildIdleReel(), buildIdleReel()];
      void loadWallet();
    }
  }, [
    phase,
    wallet,
    bet,
    loadWallet,
    captureRunResult,
    resetRunResult,
    triggerFeedback,
  ]);

  /* ---------- Space spins ---------- */
  useMachineKey(
    useMemo(
      () => (phase === "spinning" ? null : () => void handleSpin()),
      [phase, handleSpin],
    ),
  );

  const isSpinning = phase === "spinning";
  const isResult = phase === "result";
  const isWin = isResult && lastMultiplier != null && lastMultiplier > 0;
  const resultTier = getWagerCelebrationTier({
    amount: lastPayout ?? 0,
    stake: settledBet,
    multiplier: lastMultiplier,
    net: (lastPayout ?? 0) - settledBet,
  });
  const paid = isWin && winPayline ? lineMatch(winPayline) : null;

  /* Said only for a win, with its numbers. The reels show the rest. */
  const statusLine =
    isResult && isWin && winPayline && paid
      ? `${paid.count} ${SYMBOL_PLURAL[paid.symbol]} on the ${PAYLINE_NAMES[winPayline.paylineIndex]} pay ${lastMultiplier}×.`
      : "";

  const glass = (
    <MachineGlass
      name="slots"
      rules={["Five lines pay and the best one counts."]}
      paytable={GLASS_ROWS.map((row) => ({
        label: <PayLabel symbol={row.symbol} count={row.count} />,
        value: `${row.mult}×`,
        lit:
          paid != null &&
          paid.symbol === row.symbol &&
          paid.count === row.count,
      }))}
    >
      <Paylines lit={isWin && winPayline ? winPayline.paylineIndex : null} />
    </MachineGlass>
  );

  const screen = (
    <div className="arc-machine-fit">
      <p className="sr-only" role="status">
        {statusLine}
      </p>
      {/* Canvas machine — the playfield renders its own surface */}
      <div
        className="slots-cabinet relative mx-auto overflow-hidden rounded-well"
        style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_W * RENDER_SCALE}
          height={CANVAS_H * RENDER_SCALE}
          className="absolute inset-0 block h-full w-full"
          aria-hidden
        />
      </div>
      <style jsx>{`
        /* The largest cabinet that fits the screen. */
        .slots-cabinet {
          width: min(100%, (100cqh - 1.5rem) * ${CANVAS_W / CANVAS_H});
          flex: none;
        }
      `}</style>
    </div>
  );

  const receipt = isResult ? (
    <ArcadeWagerResultPlate
      result={{
        payout: lastPayout ?? 0,
        stake: settledBet,
        multiplier: lastMultiplier,
        jackpot: resultTier === "jackpot",
      }}
      kicker="slots"
      headline={`${isWin ? lastMultiplier : 0}×`}
      detail={
        isWin && winPayline && paid
          ? `${PAYLINE_NAMES[winPayline.paylineIndex]}, ${paid.count} ${SYMBOL_PLURAL[paid.symbol]}`
          : "no line"
      }
      fairness={{ seedHash: null, revealedSeed }}
      achievements={achievements}
      roundId={roundId ?? undefined}
      sound={false}
    />
  ) : null;

  return (
    <GameShell
      game="slots"
      howTo={HOW_TO}
      tickets={wallet?.credits}
    >
      <ArcadeMachine
        name="slots"
        glass={glass}
        action={
          <MachineLever
            onPull={() => void handleSpin()}
            disabled={balance == null || balance < bet}
            aria-disabled={isSpinning || undefined}
            aria-label={`spin, ${bet} tickets, pull the lever`}
          >
            spin
          </MachineLever>
        }
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

/** A symbol as SVG, the same shapes the reels draw, for the pays sheet and
    the line that paid on the glass. It sits on a small paper tile so it
    reads on any ground. */
function SlotGlyph({ symbol }: { symbol: SlotSymbol }) {
  return (
    <svg viewBox="-50 -50 100 100" className="slots-glyph" aria-hidden>
      {symbol === "cherry" ? (
        <>
          <path
            d="M -17 12 Q -10 -18 4 -34 M 17 12 Q 12 -16 4 -34"
            fill="none"
            stroke="var(--tixy-ink)"
            strokeWidth={6}
            strokeLinecap="square"
          />
          <ellipse cx={16} cy={-32} rx={14} ry={6} transform="rotate(-26 16 -32)" fill="var(--tixy-ink-2)" />
          <circle cx={-17} cy={20} r={19} fill="var(--tixy-red)" />
          <circle cx={17} cy={20} r={19} fill="var(--tixy-red)" />
        </>
      ) : symbol === "lemon" ? (
        <g transform="rotate(-11)">
          <ellipse rx={37} ry={26} fill={PAINT_FALLBACK.lemon} />
          <ellipse cx={-37} rx={7} ry={5} fill={PAINT_FALLBACK.lemon} />
          <ellipse cx={37} rx={7} ry={5} fill={PAINT_FALLBACK.lemon} />
        </g>
      ) : symbol === "bar" ? (
        <>
          <rect x={-43} y={-20} width={86} height={40} rx={6} fill="var(--tixy-ink)" />
          <text
            y={1}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={27}
            fontWeight={900}
            fill="var(--tixy-paper)"
            style={{ fontFamily: "var(--tixy-font-text)" }}
          >
            bar
          </text>
        </>
      ) : symbol === "bell" ? (
        <>
          <path d="M -36 22 L 36 22 L 31 14 C 32 -27 -32 -27 -31 14 Z" fill={PAINT_FALLBACK.brass} />
          <circle cy={-26} r={5} fill={PAINT_FALLBACK.brass} />
          <circle cy={30} r={7} fill="var(--tixy-ink)" />
        </>
      ) : symbol === "seven" ? (
        <text
          y={6}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={98}
          fontWeight={800}
          fill="var(--tixy-red)"
          style={{ fontFamily: "var(--tixy-font-num)" }}
        >
          7
        </text>
      ) : (
        <polygon points="0.0,-43.0 12.4,-14.1 43.7,-11.2 20.1,9.5 27.0,40.2 0.0,24.2 -27.0,40.2 -20.1,9.5 -43.7,-11.2 -12.4,-14.1" fill="var(--tixy-ticket)" />
      )}
    </svg>
  );
}

/** A pays line's label: the symbols drawn, then the words. */
function PayLabel({ symbol, count }: { symbol: SlotSymbol; count: 2 | 3 }) {
  return (
    <span className="slots-pay-label">
      <span className="slots-glyphs">
        {Array.from({ length: count }, (_, i) => (
          <SlotGlyph key={i} symbol={symbol} />
        ))}
      </span>
      {count} {SYMBOL_PLURAL[symbol]}
    </span>
  );
}

/** The five paylines, in the pays sheet: each a small grid with its line.
    The one that just paid is red. The server reads rows 0 to 2 of a 3 by 3
    grid, left to right, as PAYLINE_INDICES says. */
function Paylines({ lit }: { lit: number | null }) {
  return (
    <div className="slots-paylines" role="img" aria-label="5 paylines: the top, middle and bottom rows, and the two diagonals">
      {PAYLINE_INDICES.map((line, index) => {
        const pts = line.map((cell) => {
          const col = cell % 3;
          const row = Math.floor(cell / 3);
          return `${5 + col * 7},${5 + row * 7}`;
        });
        return (
          <svg
            key={index}
            viewBox="0 0 24 24"
            className="slots-payline"
            data-lit={lit === index || undefined}
          >
            {Array.from({ length: 9 }).map((_, cell) => (
              <circle
                key={cell}
                cx={5 + (cell % 3) * 7}
                cy={5 + Math.floor(cell / 3) * 7}
                r={1.1}
                className="slots-payline-dot"
              />
            ))}
            <polyline
              points={pts.join(" ")}
              fill="none"
              strokeWidth={2}
              strokeLinecap="square"
              strokeLinejoin="miter"
              className="slots-payline-line"
            />
          </svg>
        );
      })}
      <style jsx>{`
        .slots-paylines {
          display: flex;
          gap: 0.75rem;
        }
        .slots-payline {
          width: 2.25rem;
          height: 2.25rem;
          color: var(--tixy-ink-2);
        }
        .slots-payline-dot {
          fill: currentColor;
          opacity: 0.45;
        }
        .slots-payline-line {
          stroke: currentColor;
        }
        .slots-payline[data-lit] {
          color: var(--tixy-red);
        }
      `}</style>
    </div>
  );
}

/* ===========================================================================
 *  Game state helpers
 * ========================================================================= */

function weightedRandomSymbol(): SlotSymbol {
  const total = SLOT_SYMBOL_WEIGHTS.reduce((s, w) => s + w.weight, 0);
  let r = Math.random() * total;
  for (const { symbol, weight } of SLOT_SYMBOL_WEIGHTS) {
    r -= weight;
    if (r <= 0) return symbol;
  }
  return "cherry";
}

function buildRandomStrip(): SlotSymbol[] {
  return Array.from({ length: STRIP_LEN }, () => weightedRandomSymbol());
}

function buildIdleReel(): ReelRef {
  return {
    strip: buildRandomStrip(),
    currentOffset: 0,
    targetOffset: 0,
    startT: 0,
    durationMs: 0,
    landingIndex: 0,
    landed: true,
    lastTickSymbolIndex: 0,
    speed: 0,
    landedAt: 0,
  };
}

/**
 * Seeds each reel with a strip of symbols that includes the final
 * 3-symbol column somewhere in the middle, and kicks off a decelerating
 * scroll animation that lands with those 3 symbols in the viewport.
 */
function kickOffReels(state: GameRef, grid: SlotSymbol[], reduced = false) {
  const now = performance.now();
  for (let reel = 0; reel < 3; reel++) {
    const above = grid[reel]!; // top row of this column
    const center = grid[reel + 3]!; // mid row
    const below = grid[reel + 6]!; // bottom row

    // Build a strip and plant the final 3 symbols at a chosen landing slot.
    // The viewport shows 3 consecutive strip indices; we want:
    //   strip[landingIndex]     = above   (top of viewport)
    //   strip[landingIndex + 1] = center  (middle)
    //   strip[landingIndex + 2] = below   (bottom)
    const strip = buildRandomStrip();
    const landingIndex = 8; // mid-strip so there's filler above and below
    strip[landingIndex] = above;
    strip[landingIndex + 1] = center;
    strip[landingIndex + 2] = below;

    // Offset when landed: landingIndex * SYMBOL_H.
    // Spin adds EXTRA_REVOLUTIONS full strip scrolls on top for drama.
    const baseLanding = landingIndex * SYMBOL_H;
    const extra = reduced ? 0 : EXTRA_REVOLUTIONS * STRIP_LEN * SYMBOL_H;
    const targetOffset = baseLanding + extra;

    // Reduced motion: place the reel directly on its landing position — no
    // scroll, no per-symbol tick storm — so the result reads instantly.
    state.reels[reel as 0 | 1 | 2] = {
      strip,
      currentOffset: reduced ? targetOffset : 0,
      targetOffset,
      startT: now,
      durationMs: REEL_SPIN_DURATIONS[reel]!,
      landingIndex,
      landed: reduced,
      lastTickSymbolIndex: reduced ? Math.floor(targetOffset / SYMBOL_H) : 0,
      speed: 0,
      landedAt: 0,
    };
  }
}

/* ===========================================================================
 *  Update loop
 * ========================================================================= */

/** How long the paid line takes to draw across. */
const WIN_LINE_MS = 300;

/** A reel spins up, runs, and slows to a stop: slope zero at both ends. */
const reelEase = cubicBezier(0.32, 0, 0.12, 1);
/** After it locks, the strip dips past its stop and settles back. */
const LOCK_BOUNCE_MS = 200;

function updateGame(state: GameRef, dt: number, nowMs: number) {
  state.reels.forEach((reel, index) => {
    if (reel.landed) {
      // The lock: a small dip past the stop that settles, in the same
      // frames the clunk lands. None under reduced motion.
      const k = (nowMs - reel.landedAt) / LOCK_BOUNCE_MS;
      reel.speed = 0;
      reel.currentOffset =
        !state.reducedMotion && reel.landedAt > 0 && k >= 0 && k < 1
          ? reel.targetOffset - SYMBOL_H * 0.14 * Math.sin(k * Math.PI) * (1 - k)
          : reel.targetOffset;
      return;
    }
    const t = Math.min(1, (nowMs - reel.startT) / reel.durationMs);
    const before = reel.currentOffset;
    reel.currentOffset = reel.targetOffset * reelEase(t);
    reel.speed = dt > 0 ? (reel.currentOffset - before) / dt : 0;

    // Tick sound each time a full SYMBOL_H passes under the viewport,
    // but only once the reel is slow enough to read individual symbols
    // (otherwise the start of the spin is a machine-gun of clicks).
    const tickIdx = Math.floor(reel.currentOffset / SYMBOL_H);
    if (tickIdx > reel.lastTickSymbolIndex && reel.speed < 700 && t < 0.98) {
      SoundManager.play("arcadeReveal");
    }
    reel.lastTickSymbolIndex = tickIdx;

    if (t >= 1) {
      reel.landed = true;
      reel.landedAt = nowMs;
      reel.currentOffset = reel.targetOffset;
      reel.speed = 0;
      state.onReelStop(index as 0 | 1 | 2);
    }
  });

  // Win line progression
  if (state.winStartT != null) {
    const elapsed = nowMs - state.winStartT;
    state.winLineT = Math.min(1, elapsed / WIN_LINE_MS);
  }

  // Particles — coin shower physics
  for (const p of state.particles) {
    p.vy += 520 * dt; // gravity
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.spin += p.spinV * dt;
    p.life -= dt;
  }
  state.particles = state.particles.filter(
    (p) => p.life > 0 && p.y < CANVAS_H + 40,
  );

}

/** A big win: ticket stubs burst up from the middle of the line that paid
 *  and fall. */
function spawnStubBurst(win: WinPayline | null): Particle[] {
  const cell = win ? PAYLINE_INDICES[win.paylineIndex]![1]! : 4;
  const cx = reelCenterX(cell % 3);
  const cy = FRAME_TOP + Math.floor(cell / 3) * SYMBOL_H + SYMBOL_H / 2;
  const out: Particle[] = [];
  for (let i = 0; i < 30; i++) {
    out.push({
      x: cx + (Math.random() - 0.5) * 30,
      y: cy + (Math.random() - 0.5) * 20,
      vx: (Math.random() - 0.5) * 380,
      vy: -(180 + Math.random() * 260),
      spin: (Math.random() - 0.5) * 1.2,
      spinV: (Math.random() - 0.5) * 9,
      life: 1.1 + Math.random() * 0.3,
      maxLife: 1.4,
      size: 9 + Math.random() * 4,
    });
  }
  return out;
}

/* ===========================================================================
 *  Drawing: flat paint, no gradients, no glow. MACHINES_LOOK.md, "Slots".
 * ========================================================================= */

function reelX(reel: number): number {
  return FRAME_L + reel * (REEL_W + REEL_GAP);
}

function reelCenterX(reel: number): number {
  return reelX(reel) + REEL_W / 2;
}

function drawGame(ctx: CanvasRenderingContext2D, state: GameRef) {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.save();
  // The feel kit's shake: a few px for a few frames when a reel locks.
  if (!state.reducedMotion) {
    const { x, y } = state.shakeAt();
    if (x !== 0 || y !== 0) ctx.translate(x, y);
  }
  drawWindow(ctx, state.theme);
  drawReelBands(ctx, state.theme);
  const showWin = state.winPayline != null && state.winLineT > 0;
  // The line sits on the paper, under the symbols, so it reads between them.
  if (showWin) drawWinLine(ctx, state);
  drawReelSymbols(ctx, state);
  drawParticles(ctx, state);
  ctx.restore();
}

/** The ink window around the reels, with a notch at each end of the middle
 *  row: the line the eye reads first. */
function drawWindow(ctx: CanvasRenderingContext2D, paint: SlotsPaint) {
  ctx.fillStyle = paint.window;
  roundRect(
    ctx,
    FRAME_L - WINDOW_PAD,
    FRAME_TOP - WINDOW_PAD,
    VIEWPORT_W + WINDOW_PAD * 2,
    SYMBOL_VIEWPORT_H + WINDOW_PAD * 2,
    16,
  );
  ctx.fill();
  const midY = FRAME_TOP + SYMBOL_H * 1.5;
  ctx.fillStyle = paint.paper;
  for (const [x, dir] of [
    [FRAME_L - WINDOW_PAD + 1, 1],
    [FRAME_L + VIEWPORT_W + WINDOW_PAD - 1, -1],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(x, midY - 6);
    ctx.lineTo(x + dir * 6, midY);
    ctx.lineTo(x, midY + 6);
    ctx.closePath();
    ctx.fill();
  }
}

/** Each reel is a paper band; its top and bottom edges a step darker, so it
 *  reads as a drum without a gradient. */
function drawReelBands(ctx: CanvasRenderingContext2D, paint: SlotsPaint) {
  for (let r = 0; r < 3; r++) {
    const x = reelX(r);
    ctx.save();
    roundRect(ctx, x, FRAME_TOP, REEL_W, SYMBOL_VIEWPORT_H, 8);
    ctx.clip();
    ctx.fillStyle = paint.reel;
    ctx.fillRect(x, FRAME_TOP, REEL_W, SYMBOL_VIEWPORT_H);
    ctx.fillStyle = paint.reelShade;
    ctx.fillRect(x, FRAME_TOP, REEL_W, 12);
    ctx.fillRect(x, FRAME_TOP + SYMBOL_VIEWPORT_H - 12, REEL_W, 12);
    ctx.restore();
  }
}

function drawReelSymbols(ctx: CanvasRenderingContext2D, state: GameRef) {
  const paint = state.theme;
  const win = state.winPayline;
  // Once a line has paid, the symbols off it step back.
  const dim = win ? 1 - 0.65 * state.winLineT : 1;
  for (let r = 0; r < 3; r++) {
    const reel = state.reels[r as 0 | 1 | 2];
    const x = reelX(r);
    ctx.save();
    roundRect(ctx, x, FRAME_TOP, REEL_W, SYMBOL_VIEWPORT_H, 8);
    ctx.clip();

    // How far the strip travels in one 60 Hz frame; past a third of a
    // symbol it is smeared along its travel so the eye reads a spinning reel
    // instead of strobing symbols.
    const perFrame = reel.landed ? 0 : reel.speed / 60;
    const smear = perFrame > SYMBOL_H * 0.33 ? Math.min(SYMBOL_H * 1.1, perFrame) : 0;

    const wrapLen = STRIP_LEN * SYMBOL_H;
    const effective = ((reel.currentOffset % wrapLen) + wrapLen) % wrapLen;
    const startIdx = Math.floor(effective / SYMBOL_H);
    const pixelShift = effective - startIdx * SYMBOL_H;

    for (let row = -1; row <= 3; row++) {
      const stripIdx = (startIdx + row + STRIP_LEN) % STRIP_LEN;
      const symbol = reel.strip[stripIdx]!;
      const y = FRAME_TOP + row * SYMBOL_H - pixelShift;
      const onLine = reel.landed && win !== null && isSymbolOnPayline(win, r, row);
      ctx.globalAlpha = win && reel.landed && !onLine ? dim : 1;
      drawSymbolAt(ctx, symbol, x + REEL_W / 2, y + SYMBOL_H / 2, SYMBOL_H * 0.78, onLine, smear, paint);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

function isSymbolOnPayline(
  win: WinPayline,
  reel: number,
  row: number,
): boolean {
  // row -1 = above viewport, 0 = top, 1 = middle, 2 = bottom, 3 = below
  if (row < 0 || row > 2) return false;
  const gridIdx = row * 3 + reel;
  return PAYLINE_INDICES[win.paylineIndex]!.includes(gridIdx);
}

/** The line that paid, drawn left to right in red, from the first reel to
 *  the last. Reduced motion draws it whole. */
function drawWinLine(ctx: CanvasRenderingContext2D, state: GameRef) {
  const win = state.winPayline!;
  const pts = PAYLINE_INDICES[win.paylineIndex]!.map((idx) => ({
    x: reelCenterX(idx % 3),
    y: FRAME_TOP + Math.floor(idx / 3) * SYMBOL_H + SYMBOL_H / 2,
  }));
  const start = { x: FRAME_L - WINDOW_PAD + 2, y: pts[0]!.y };
  const end = { x: FRAME_L + VIEWPORT_W + WINDOW_PAD - 2, y: pts[2]!.y };
  const path = [start, ...pts, end];
  // Lengths along the path, so the line draws at one speed.
  const segs = path.slice(1).map((p, i) => Math.hypot(p.x - path[i]!.x, p.y - path[i]!.y));
  const total = segs.reduce((a, b) => a + b, 0);
  let left = total * state.winLineT;
  ctx.save();
  ctx.strokeStyle = state.theme.red;
  ctx.lineWidth = 7;
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(path[0]!.x, path[0]!.y);
  for (let i = 1; i < path.length && left > 0; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const k = Math.min(1, left / segs[i - 1]!);
    ctx.lineTo(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);
    left -= segs[i - 1]!;
  }
  ctx.stroke();
  ctx.restore();
}

/** Ticket stubs from a big win: amber, with a perforation. */
function drawParticles(ctx: CanvasRenderingContext2D, state: GameRef) {
  const paint = state.theme;
  for (const p of state.particles) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, (p.life / p.maxLife) * 2));
    ctx.translate(p.x, p.y);
    ctx.rotate(p.spin);
    const w = p.size * 1.6;
    const h = p.size;
    ctx.fillStyle = paint.ticket;
    roundRect(ctx, -w / 2, -h / 2, w, h, 2);
    ctx.fill();
    ctx.fillStyle = paint.ink;
    ctx.globalAlpha *= 0.5;
    for (let k = -2; k <= 2; k++) ctx.fillRect(w * 0.22 - 0.6, k * (h / 6) - 0.8, 1.2, 1.6);
    ctx.restore();
  }
}

/** How long a symbol on the paid line takes to pop. */
const POP_MS = 320;

function drawSymbolAt(
  ctx: CanvasRenderingContext2D,
  symbol: SlotSymbol,
  cx: number,
  cy: number,
  size: number,
  highlight: boolean,
  smear: number,
  paint: SlotsPaint,
) {
  ctx.save();
  ctx.translate(cx, cy);
  // A symbol on the paid line pops once to 115% and settles. It doesn't
  // keep moving.
  if (highlight && winPulseFrom > 0) {
    const t = (performance.now() - winPulseFrom) / POP_MS;
    if (t > 0 && t < 1) {
      const scale = 1 + 0.15 * Math.sin(Math.PI * t);
      ctx.scale(scale, scale);
    }
  }
  if (smear > 0) {
    // Motion blur: the symbol drawn at several points along its travel,
    // each faint, so it streaks. No canvas filter (Safari lacks it).
    const copies = Math.min(13, Math.ceil(smear / 4.5) + 1);
    const base = ctx.globalAlpha;
    ctx.globalAlpha = base * Math.max(0.1, 1.9 / copies);
    for (let i = 0; i < copies; i++) {
      ctx.save();
      ctx.translate(0, (i / (copies - 1) - 0.5) * smear);
      drawSymbol(ctx, symbol, size, paint);
      ctx.restore();
    }
  } else {
    drawSymbol(ctx, symbol, size, paint);
  }
  ctx.restore();
}

function drawSymbol(
  ctx: CanvasRenderingContext2D,
  symbol: SlotSymbol,
  size: number,
  paint: SlotsPaint = PAINT_FALLBACK,
) {
  switch (symbol) {
    case "cherry":
      drawCherry(ctx, size, paint);
      break;
    case "lemon":
      drawLemon(ctx, size, paint);
      break;
    case "bar":
      drawBar(ctx, size, paint);
      break;
    case "bell":
      drawBell(ctx, size, paint);
      break;
    case "seven":
      drawSeven(ctx, size, paint);
      break;
    case "star":
      drawStar(ctx, size, paint);
      break;
  }
}

/* Every symbol is one or two flat fills, drawn on the paper reel, the same
   shapes as SlotGlyph on the pays sheet. */

function drawCherry(ctx: CanvasRenderingContext2D, size: number, paint: SlotsPaint) {
  const r = size * 0.19;
  ctx.strokeStyle = paint.ink;
  ctx.lineWidth = Math.max(2.5, size * 0.055);
  ctx.lineCap = "square";
  ctx.beginPath();
  ctx.moveTo(-size * 0.17, size * 0.12);
  ctx.quadraticCurveTo(-size * 0.1, -size * 0.18, size * 0.04, -size * 0.34);
  ctx.moveTo(size * 0.17, size * 0.12);
  ctx.quadraticCurveTo(size * 0.12, -size * 0.16, size * 0.04, -size * 0.34);
  ctx.stroke();
  ctx.fillStyle = paint.ink2;
  ctx.save();
  ctx.translate(size * 0.16, -size * 0.32);
  ctx.rotate(-0.45);
  ctx.beginPath();
  ctx.ellipse(0, 0, size * 0.14, size * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = paint.red;
  for (const dx of [-size * 0.17, size * 0.17]) {
    ctx.beginPath();
    ctx.arc(dx, size * 0.2, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawLemon(ctx: CanvasRenderingContext2D, size: number, paint: SlotsPaint) {
  const rx = size * 0.37;
  const ry = size * 0.26;
  ctx.fillStyle = paint.lemon;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.rotate(-0.2);
  ctx.beginPath();
  ctx.ellipse(-rx, 0, size * 0.07, size * 0.05, 0, 0, Math.PI * 2);
  ctx.ellipse(rx, 0, size * 0.07, size * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBar(ctx: CanvasRenderingContext2D, size: number, paint: SlotsPaint) {
  const w = size * 0.86;
  const h = size * 0.4;
  ctx.fillStyle = paint.ink;
  roundRect(ctx, -w / 2, -h / 2, w, h, 6);
  ctx.fill();
  ctx.fillStyle = paint.paper;
  ctx.font = `900 ${size * 0.27}px ${paint.textFont}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("bar", 0, size * 0.01);
}

function drawBell(ctx: CanvasRenderingContext2D, size: number, paint: SlotsPaint) {
  const s = size * 0.44;
  ctx.fillStyle = paint.brass;
  ctx.beginPath();
  ctx.moveTo(-s * 0.82, s * 0.5);
  ctx.lineTo(s * 0.82, s * 0.5);
  ctx.lineTo(s * 0.7, s * 0.32);
  ctx.bezierCurveTo(s * 0.72, -s * 0.62, -s * 0.72, -s * 0.62, -s * 0.7, s * 0.32);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, -s * 0.6, s * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = paint.ink;
  ctx.beginPath();
  ctx.arc(0, s * 0.68, s * 0.15, 0, Math.PI * 2);
  ctx.fill();
}

function drawSeven(ctx: CanvasRenderingContext2D, size: number, paint: SlotsPaint) {
  ctx.fillStyle = paint.red;
  ctx.font = `800 ${size * 0.98}px ${paint.numFont}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("7", 0, size * 0.04);
}

function drawStar(ctx: CanvasRenderingContext2D, size: number, paint: SlotsPaint) {
  const r = size * 0.46;
  const inner = r * 0.46;
  ctx.fillStyle = paint.ticket;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = (i * Math.PI) / 5 - Math.PI / 2;
    const radius = i % 2 === 0 ? r : inner;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius + size * 0.03;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
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

/* ===========================================================================
 *  Seed → grid (mirrors server)
 * ========================================================================= */

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function deriveSubSeed(seed: number, domain: string): Promise<number> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${seed}:${domain}`);
  const hashBuffer = await sha256(data);
  return new DataView(hashBuffer).getUint32(0, false);
}

function getVisibleSymbols(stop: number): [SlotSymbol, SlotSymbol, SlotSymbol] {
  const above =
    SERVER_REEL_STRIP[(stop + SLOT_REEL_STOPS - 1) % SLOT_REEL_STOPS]!;
  const center = SERVER_REEL_STRIP[stop % SLOT_REEL_STOPS]!;
  const below = SERVER_REEL_STRIP[(stop + 1) % SLOT_REEL_STOPS]!;
  return [above, center, below];
}

function evaluatePaylines(grid: SlotSymbol[]): WinPayline | null {
  let best: WinPayline | null = null;
  let bestMult = 0;
  for (let pi = 0; pi < PAYLINE_INDICES.length; pi++) {
    const [a, b, c] = PAYLINE_INDICES[pi]!;
    const symbols: SlotSymbol[] = [grid[a]!, grid[b]!, grid[c]!];
    if (symbols[0] === symbols[1] && symbols[1] === symbols[2]) {
      const mult = PAYOUT_3_MATCH[symbols[0]!]!;
      if (mult > bestMult) {
        bestMult = mult;
        best = { paylineIndex: pi, symbols, multiplier: mult };
      }
      continue;
    }
    for (const pair of [
      [0, 1],
      [1, 2],
    ] as const) {
      if (symbols[pair[0]] === symbols[pair[1]]) {
        const sym = symbols[pair[0]]!;
        const mult = PAYOUT_2_MATCH[sym];
        if (mult && mult > bestMult) {
          bestMult = mult;
          best = { paylineIndex: pi, symbols, multiplier: mult };
        }
      }
    }
  }
  return best;
}

async function deriveGridFromSeed(
  seed: number,
): Promise<{ grid: SlotSymbol[]; winPayline: WinPayline | null }> {
  const subSeed = await deriveSubSeed(seed, "slots-reels");
  const rng = mulberry32(subSeed);
  const reelStops: [number, number, number] = [
    Math.floor(rng() * SLOT_REEL_STOPS),
    Math.floor(rng() * SLOT_REEL_STOPS),
    Math.floor(rng() * SLOT_REEL_STOPS),
  ];
  const [r1a, r1c, r1b] = getVisibleSymbols(reelStops[0]);
  const [r2a, r2c, r2b] = getVisibleSymbols(reelStops[1]);
  const [r3a, r3c, r3b] = getVisibleSymbols(reelStops[2]);
  const grid: SlotSymbol[] = [r1a, r2a, r3a, r1c, r2c, r3c, r1b, r2b, r3b];
  return { grid, winPayline: evaluatePaylines(grid) };
}
