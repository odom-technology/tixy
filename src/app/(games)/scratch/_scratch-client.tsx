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
  MachineChoice,
  MachineGlass,
  machineError,
  useMachineBet,
  useMachineKey,
} from "@/features/arcade/components/wagers/arcade-machine";
import { ArcadeWagerResultPlate } from "@/features/arcade/components/results/arcade-run-result";
import { useGameFeedback } from "@/features/arcade/lib/use-game-feedback";
import { SoundManager } from "@/features/arcade/lib/sound-manager";
import { gameCanvasDpr } from "@/features/arcade/lib/game-frame-loop";
import { useWagerSession } from "@/features/arcade/lib/use-wager-session";
import { ARCADE_MIN_BET } from "@/server/arcade/arcade-constants";

/* ===========================================================================
 *  Types + constants (tier metadata mirrors the server for paytable display)
 * ========================================================================= */

type Tier = "bronze" | "silver" | "gold";
type Phase = "setup" | "scratching" | "result";

type SettleResponse = {
  payout: number;
  multiplier: number;
  seed: number;
  roundId?: string | null;
  grid?: string[];
  win?: boolean;
  symbol?: string | null;
  prizeCells?: number[];
  error?: string;
};

/** Symbol glyph + enamel paint per prize symbol. Flat lacquer, NOTHING GLOWS. */
const SYMBOL_META: Record<
  string,
  { glyph: string; bg: string; on: string; edge: string }
> = {
  cherry: { glyph: "🍒", bg: "#c73538", on: "#ffefe4", edge: "#7e2225" },
  lemon: { glyph: "🍋", bg: "#e0b13a", on: "#2a1b06", edge: "#9a7a1a" },
  bell: { glyph: "🔔", bg: "#2fb8a6", on: "#04231e", edge: "#1b7466" },
  bar: { glyph: "🅱", bg: "#3a86c4", on: "#04161f", edge: "#1f547e" },
  seven: { glyph: "7", bg: "#c73538", on: "#ffefe4", edge: "#7e2225" },
  star: { glyph: "★", bg: "#e0a23a", on: "#2a1b06", edge: "#9a621a" },
  diamond: { glyph: "◆", bg: "#5aa0db", on: "#04161f", edge: "#1f547e" },
  clover: { glyph: "♣", bg: "#3f9d52", on: "#04210b", edge: "#1f5a2c" },
  crown: { glyph: "♛", bg: "#8a52c4", on: "#f3e9ff", edge: "#5a2e94" },
  horseshoe: { glyph: "♞", bg: "#c98a3a", on: "#2a1b06", edge: "#8a5a1a" },
};

const FALLBACK_SYMBOL = {
  glyph: "?",
  bg: "#46525c",
  on: "#e7eef2",
  edge: "#2a333a",
};

function symMeta(sym: string) {
  return SYMBOL_META[sym] ?? FALLBACK_SYMBOL;
}

/* ---- Tier tables (mirror the server's SCRATCH_WIN_BUCKETS) ----
 * The symbol on a winning card is only the picture: the server rolls the
 * multiplier first, so every symbol pays the card's multiplier. The paytable
 * therefore lists multipliers and their odds, not symbols. */
const WIN_BUCKETS: Record<Tier, readonly (readonly [number, number])[]> = {
  bronze: [
    [0.5, 3400],
    [1, 3000],
    [2, 1100],
    [3, 320],
    [5, 110],
    [10, 30],
    [25, 8],
  ],
  silver: [
    [0.5, 1500],
    [1, 1500],
    [2, 950],
    [4, 360],
    [8, 140],
    [20, 46],
    [50, 12],
    [75, 5],
  ],
  gold: [
    [1, 1400],
    [2, 760],
    [5, 360],
    [12, 130],
    [30, 48],
    [75, 18],
    [150, 6],
    [200, 3],
  ],
};
/** The server sizes the no-match weight so each tier returns this much. */
const TARGET_EV = 0.96;

function buildTier(tier: Tier) {
  const buckets = WIN_BUCKETS[tier];
  const winWeight = buckets.reduce((sum, [, w]) => sum + w, 0);
  const winEv = buckets.reduce((sum, [m, w]) => sum + m * w, 0);
  const lossWeight = Math.max(0, Math.round(winEv / TARGET_EV - winWeight));
  const total = lossWeight + winWeight;
  return {
    label: tier,
    /** Share of cards with a match, in percent. */
    match: Math.round((winWeight / total) * 100),
    /** Share that pay the bet back or more (1× and up), in percent. */
    payback: Math.round(
      (buckets.filter(([m]) => m >= 1).reduce((sum, [, w]) => sum + w, 0) /
        total) *
        100,
    ),
    maxMult: Math.max(...buckets.map(([m]) => m)),
    /** One in N cards, best prize first. */
    pays: [...buckets]
      .reverse()
      .map(([mult, weight]) => ({ mult, oneIn: Math.round(total / weight) })),
  };
}

const TIER_META: Record<Tier, ReturnType<typeof buildTier>> = {
  bronze: buildTier("bronze"),
  silver: buildTier("silver"),
  gold: buildTier("gold"),
};

/** Flat foil paint per tier, with the ink printed on it. */
const FOIL_PAINT: Record<Tier, { fill: string; stripe: string; ink: string }> =
  {
    bronze: {
      fill: "#a8703f",
      stripe: "rgba(255,255,255,0.07)",
      ink: "#2a1608",
    },
    silver: {
      fill: "#a9b1b8",
      stripe: "rgba(255,255,255,0.12)",
      ink: "#1c2228",
    },
    gold: { fill: "#e0a23a", stripe: "rgba(255,255,255,0.1)", ink: "#2a1b06" },
  };

const TIER_ITEMS = [
  { value: "bronze" as Tier, label: "bronze" },
  { value: "silver" as Tier, label: "silver" },
  { value: "gold" as Tier, label: "gold" },
];

const HOW_TO: GameHowTo = {
  lines: [
    "Pick a card tier and a bet, buy a card, then rub the foil or press reveal.",
    "Three of one symbol on the 9 cells wins. The card sets the prize when it prints: every symbol pays the same multiplier.",
    `Bronze matches ${TIER_META.bronze.match}% of cards and tops at ${TIER_META.bronze.maxMult}×, silver ${TIER_META.silver.match}% at ${TIER_META.silver.maxMult}×, gold ${TIER_META.gold.match}% at ${TIER_META.gold.maxMult}×. A match under 1× pays back less than the bet.`,
  ],
};

/** The foil is wiped away by this share of the card. */
const CLEAR_SHARE = 0.55;
/** Coverage is tracked on a coarse grid, so no pixel read ever runs. */
const COVER_COLS = 30;
const COVER_ROWS = 20;

function formatMult(m: number): string {
  if (m >= 100) return `${m.toFixed(0)}×`;
  if (Number.isInteger(m)) return `${m}×`;
  return `${m.toFixed(1)}×`;
}

/* ===========================================================================
 *  Component
 * ========================================================================= */

export default function ScratchClient() {
  const { trigger: triggerFeedback } = useGameFeedback();
  const {
    wallet,
    loaded: walletLoaded,
    refresh: refreshWallet,
    adjustCredits,
  } = useGamesWallet();
  const balance = walletLoaded ? wallet.credits : null;
  const [tier, setTier] = useState<Tier>("bronze");

  const [phase, setPhase] = useState<Phase>("setup");
  const [isBuying, setIsBuying] = useState(false);
  const roundPlaying = phase === "scratching" || isBuying;
  const [wager, setWager] = useMachineBet(balance, 10, {
    locked: roundPlaying,
  });
  const [roundId, setRoundId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The settled card (predetermined server-side). Null until a card is bought.
  const [card, setCard] = useState<SettleResponse | null>(null);
  const [settledWager, setSettledWager] = useState(10);
  // Whether the foil has been fully cleared (reveals the result plate).
  const [revealed, setRevealed] = useState(false);

  const {
    revealedSeed,
    start: startSession,
    settle: settleSession,
    achievements,
  } = useWagerSession("arcade-scratch");

  // ─── Canvas foil refs ────────────────────────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerRef = useRef<number | null>(null);
  const clearedRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  // Which cells of the coarse grid the finger has wiped, and how many.
  const coverRef = useRef(new Uint8Array(COVER_COLS * COVER_ROWS));
  const coverCountRef = useRef(0);
  // What is printed on the foil, and whether the foil is standing (not yet
  // wiped away). Kept in refs so a resize repaints the right face.
  const faceRef = useRef({ tier, top: "", bottom: "" });
  const foilUpRef = useRef(true);
  // Latest settled card and stake, mirrored to refs so the pointer callbacks
  // read fresh data without re-subscribing listeners on every settle.
  const cardRef = useRef<SettleResponse | null>(null);
  const stakeRef = useRef(10);
  // Ref-held reveal fn so the pointer handlers can call the latest
  // revealCard without a declaration-order cycle or stale closure.
  const revealCardRef = useRef<() => void>(() => {});

  /* ---------- Paint the foil over the card ---------- */
  // Flat tier paint with the card's name and price printed on it before the
  // buy, "scratch here" once it is in your hand. A fresh foil has no wipe on
  // it, so the coverage grid starts empty.
  const paintFoil = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { width, height } = canvas;
    const unit = width / Math.max(1, canvas.clientWidth);
    const { tier: foilTier, top, bottom } = faceRef.current;
    const paint = FOIL_PAINT[foilTier];

    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = paint.fill;
    ctx.fillRect(0, 0, width, height);

    // Brushed striations.
    ctx.strokeStyle = paint.stripe;
    ctx.lineWidth = 2 * unit;
    for (let y = 0; y < height; y += 7 * unit) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y + 3 * unit);
      ctx.stroke();
    }
    // Hard inner bevel seat.
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 4 * unit;
    ctx.strokeRect(2 * unit, 2 * unit, width - 4 * unit, height - 4 * unit);

    // The ink, centered.
    ctx.fillStyle = paint.ink;
    ctx.globalAlpha = 0.7;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const fs = Math.max(14, Math.min(34, canvas.clientWidth * 0.075)) * unit;
    ctx.font = `800 ${fs}px 'Bungee', ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText(top, width / 2, height / 2 - fs * 0.65);
    ctx.fillText(bottom, width / 2, height / 2 + fs * 0.65);
    ctx.globalAlpha = 1;

    coverRef.current.fill(0);
    coverCountRef.current = 0;
  }, []);

  /* ---------- Size the canvas to its container (DPR-aware) ---------- */
  const sizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const dpr = gameCanvasDpr(rect.width, rect.height);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width === w && canvas.height === h) return;
    // Resizing clears the canvas; a standing foil is laid again.
    canvas.width = w;
    canvas.height = h;
    if (foilUpRef.current) paintFoil();
  }, [paintFoil]);

  /* ---------- Fully clear the foil + show result ---------- */
  const revealCard = useCallback(() => {
    if (clearedRef.current || !cardRef.current) return;
    clearedRef.current = true;
    foilUpRef.current = false;
    pointerRef.current = null;
    setRevealed(true);
    setPhase("result");

    const c = cardRef.current;
    const net = (c.payout ?? 0) - stakeRef.current;
    if (net > 0) {
      SoundManager.play(
        (c.multiplier ?? 0) >= 25 ? "arcadeBigWin" : "arcadeWin",
      );
    } else if ((c.payout ?? 0) > 0) {
      // A match that returns the bet or less: a reveal, not a win.
      SoundManager.play("arcadeReveal");
    } else {
      triggerFeedback("loss");
    }
    void refreshWallet();
  }, [refreshWallet, triggerFeedback]);

  // Keep the ref pointing at the latest revealCard for the pointer handlers.
  useEffect(() => {
    revealCardRef.current = revealCard;
  }, [revealCard]);

  /* ---------- Rub: wipe the foil and count what is wiped ---------- */
  const eraseTo = useCallback((x: number, y: number) => {
    const canvas = canvasRef.current;
    if (!canvas || clearedRef.current) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const cssW = Math.max(1, canvas.clientWidth);
    const cssH = Math.max(1, canvas.clientHeight);
    const scale = canvas.width / cssW;
    // A fingertip covers more than a cursor: never under 18 px.
    const radius = Math.max(18, cssW * 0.06);
    const last = lastPointRef.current ?? { x, y };

    // destination-out removes by the stroke's alpha: it must be opaque.
    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#000";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = radius * 2 * scale;
    ctx.beginPath();
    ctx.moveTo(last.x * scale, last.y * scale);
    ctx.lineTo(x * scale, y * scale);
    ctx.stroke();
    lastPointRef.current = { x, y };

    // Mark the grid cells whose centre this stroke passed over.
    const cellW = cssW / COVER_COLS;
    const cellH = cssH / COVER_ROWS;
    const dx = x - last.x;
    const dy = y - last.y;
    const lenSq = dx * dx + dy * dy;
    const c0 = Math.max(0, Math.floor((Math.min(x, last.x) - radius) / cellW));
    const c1 = Math.min(
      COVER_COLS - 1,
      Math.floor((Math.max(x, last.x) + radius) / cellW),
    );
    const r0 = Math.max(0, Math.floor((Math.min(y, last.y) - radius) / cellH));
    const r1 = Math.min(
      COVER_ROWS - 1,
      Math.floor((Math.max(y, last.y) + radius) / cellH),
    );
    const cover = coverRef.current;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * COVER_COLS + c;
        if (cover[i]) continue;
        const cx = (c + 0.5) * cellW;
        const cy = (r + 0.5) * cellH;
        const t =
          lenSq === 0
            ? 0
            : Math.max(
                0,
                Math.min(1, ((cx - last.x) * dx + (cy - last.y) * dy) / lenSq),
              );
        const px = last.x + dx * t - cx;
        const py = last.y + dy * t - cy;
        if (px * px + py * py <= radius * radius) {
          cover[i] = 1;
          coverCountRef.current++;
        }
      }
    }
    if (coverCountRef.current / cover.length > CLEAR_SHARE) {
      revealCardRef.current();
    }
  }, []);

  /* ---------- Pointer handlers (mouse, pen and touch via Pointer Events) ---------- */
  // touch-action: none on the card keeps the page from scrolling under a
  // finger; the rub never reads pixels back, so a phone keeps up.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || phase !== "scratching") return;

    const toLocal = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const onDown = (e: PointerEvent) => {
      if (pointerRef.current != null) return;
      pointerRef.current = e.pointerId;
      lastPointRef.current = null;
      const p = toLocal(e);
      eraseTo(p.x, p.y);
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      e.preventDefault();
    };
    const onMove = (e: PointerEvent) => {
      if (pointerRef.current !== e.pointerId) return;
      // A finger moves faster than the frame rate: walk every sample.
      const samples =
        typeof e.getCoalescedEvents === "function"
          ? e.getCoalescedEvents()
          : [];
      for (const s of samples.length > 0 ? samples : [e]) {
        const p = toLocal(s);
        eraseTo(p.x, p.y);
      }
      e.preventDefault();
    };
    const onUp = (e: PointerEvent) => {
      if (pointerRef.current !== e.pointerId) return;
      pointerRef.current = null;
      lastPointRef.current = null;
    };
    const noMenu = (e: Event) => e.preventDefault();

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("contextmenu", noMenu);
    return () => {
      pointerRef.current = null;
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("contextmenu", noMenu);
    };
  }, [phase, eraseTo]);

  /* ---------- Size the canvas when the card mounts/resizes ---------- */
  useEffect(() => {
    sizeCanvas();
    const host = canvasRef.current?.parentElement;
    if (!host || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => sizeCanvas());
    ro.observe(host);
    return () => ro.disconnect();
  }, [sizeCanvas]);

  /* ---------- Lay the foil: face-down before the buy, fresh on each card ---------- */
  // The foil stands until a card is revealed. It is laid again the moment
  // the next buy starts, so the old result never shows under a new card.
  useEffect(() => {
    const standing = phase !== "result" || isBuying;
    foilUpRef.current = standing;
    if (!standing) return;
    faceRef.current =
      phase === "scratching"
        ? { tier, top: "scratch", bottom: "here" }
        : {
            tier,
            top: `${tier} card`,
            bottom: `${wager.toLocaleString()} tickets`,
          };
    paintFoil();
  }, [phase, isBuying, tier, wager, paintFoil]);

  /* ---------- Buy a card → start + settle, then enter scratch phase ---------- */
  const handleBuy = useCallback(async () => {
    if (isBuying || balance == null) return;
    setError(null);
    if (wager < ARCADE_MIN_BET) {
      setError(`The smallest bet is ${ARCADE_MIN_BET} tickets.`);
      return;
    }
    if (wager > balance) {
      setError(`You need ${wager} tickets for this bet.`);
      return;
    }

    setIsBuying(true);
    setSettledWager(wager);
    stakeRef.current = wager;
    setRoundId(null);
    // The last card goes back under foil as the new one is bought.
    cardRef.current = null;
    setCard(null);
    setRevealed(false);
    SoundManager.play("arcadeBet");
    adjustCredits(-wager);

    const fail = (message: string) => {
      setError(message);
      setIsBuying(false);
      setPhase("setup");
      void refreshWallet();
    };

    try {
      const session = await startSession(wager, { tier });
      if (!session.ok) {
        fail(machineError(session.error, "The machine could not sell a card."));
        return;
      }

      const settled = await settleSession<SettleResponse>();
      if (!settled.ok) {
        fail(machineError(settled.error, "The card did not print. Try again."));
        return;
      }

      const data = settled.data;
      clearedRef.current = false;
      lastPointRef.current = null;
      pointerRef.current = null;
      cardRef.current = data;
      setCard(data);
      setRoundId(data.roundId ?? null);
      setPhase("scratching");
      setIsBuying(false);
    } catch {
      fail("The machine lost its connection. Try again.");
    }
  }, [
    isBuying,
    wager,
    balance,
    tier,
    refreshWallet,
    startSession,
    settleSession,
    adjustCredits,
  ]);

  /* ---------- Keyboard: Space buys a card, or reveals the one in hand ---------- */
  useMachineKey(
    useMemo(() => {
      if (isBuying) return null;
      if (phase === "scratching") return () => revealCard();
      return () => void handleBuy();
    }, [phase, isBuying, revealCard, handleBuy]),
  );

  /* ---------- Computed ---------- */
  const meta = TIER_META[tier];
  const affordable = balance != null && wager <= balance;
  // A match is three of a kind; what it paid decides if it was a win.
  const match = Boolean(card?.win && (card?.payout ?? 0) > 0);
  const resultMult = card?.multiplier ?? 0;
  const payout = card?.payout ?? 0;
  const net = payout - settledWager;
  const breakEven = match && net === 0;
  const won = match && net > 0;

  /* ---------- The 3x3 grid (always rendered under the foil) ---------- */
  const gridCells = useMemo<string[]>(() => {
    if (card?.grid && card.grid.length === 9) return card.grid;
    return Array.from({ length: 9 }, () => "");
  }, [card]);

  /* ---------- Screen ---------- */
  const statusLine =
    phase === "setup"
      ? `Buy a ${meta.label} card for ${wager.toLocaleString()} tickets. Match 3 symbols to win.`
      : phase === "scratching"
        ? "Rub the foil to scratch, or press reveal."
        : !match
          ? `No match. You lose ${settledWager.toLocaleString()} tickets.`
          : breakEven
            ? `3 of a kind pays ${formatMult(resultMult)}: ${payout.toLocaleString()} back. Break even.`
            : won
              ? `3 of a kind pays ${formatMult(resultMult)}: ${payout.toLocaleString()} back, ${net.toLocaleString()} won.`
              : `3 of a kind pays ${formatMult(resultMult)}: ${payout.toLocaleString()} back, ${(-net).toLocaleString()} lost.`;

  const screen = (
    <div className="arc-machine-fit scratch-stage">
      <p role="status" className="arc-machine-status">
        {statusLine}
      </p>

      {/* The card: the grid sits under the foil, which stands face-down
          from the first look and is rubbed away once the card is bought */}
      <div className="scratch-card-frame">
        <div className="scratch-grid">
          {gridCells.map((sym, i) => {
            const m = sym ? symMeta(sym) : null;
            const isPrize =
              revealed && match && (card?.prizeCells ?? []).includes(i);
            const dim = revealed && match && !isPrize;
            return (
              <div
                key={i}
                className={`scratch-cell${isPrize ? " scratch-cell-prize" : ""}${dim ? " scratch-cell-dim" : ""}`}
                style={{
                  // CSS custom props drive the flat enamel paint.
                  ["--cell-bg" as string]: m?.bg ?? "#2a2118",
                  ["--cell-on" as string]: m?.on ?? "#2a2118",
                  ["--cell-edge" as string]: m?.edge ?? "#1c160d",
                }}
              >
                <span className="scratch-glyph">{m?.glyph ?? ""}</span>
              </div>
            );
          })}
        </div>

        <canvas
          ref={canvasRef}
          className="scratch-foil"
          data-live={phase === "scratching" || undefined}
          data-open={revealed || undefined}
          aria-label={
            phase === "scratching"
              ? "scratch foil, rub to reveal"
              : "face-down scratch card"
          }
        />
      </div>

      <style jsx global>{`
        /* phones: room for a readable card and the receipt over it */
        .arc-shell[data-game="scratch"] .arc-machine-frame:not([data-wide]) {
          --machine-screen-min: 20rem;
        }
        /* Card frame: flat ink plate; the grid + foil stack inside.
           The widest 3 by 2 card the screen holds under the status line. */
        .scratch-card-frame {
          position: relative;
          flex: none;
          width: min(100%, 34rem, (100cqh - 4.5rem) * 1.5);
          aspect-ratio: 3 / 2;
          border-radius: 14px;
          border: 2px solid var(--ink, #1c160d);
          background: #1c140b;
          box-shadow: 0 6px 0 rgba(0, 0, 0, 0.4);
          padding: 4%;
          overflow: hidden;
          touch-action: none;
          user-select: none;
          -webkit-user-select: none;
          -webkit-touch-callout: none;
        }
        .scratch-grid {
          position: absolute;
          inset: 4%;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          grid-template-rows: repeat(3, 1fr);
          gap: 3%;
        }
        .scratch-cell {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 9px;
          border: 2px solid var(--cell-edge);
          background: var(--cell-bg);
          box-shadow: inset 0 -3px 0 rgba(0, 0, 0, 0.25);
          transition: opacity 0.24s ease-out;
        }
        .scratch-glyph {
          font-size: clamp(20px, 7cqw, 46px);
          line-height: 1;
          color: var(--cell-on);
          text-shadow: 0 1px 0 rgba(0, 0, 0, 0.35);
          user-select: none;
        }
        /* A match: the three cells stay, the other six step back. */
        .scratch-cell-dim {
          opacity: 0.4;
        }
        /* Winning cells: hard cream key-edge ring (no glow) + a small pop. */
        .scratch-cell-prize {
          outline: 3px solid #f6eddc;
          outline-offset: -1px;
          z-index: 2;
          animation: scratch-pop 0.32s
            var(--ease-spring, cubic-bezier(0.22, 1, 0.36, 1)) 0.16s both;
        }
        @keyframes scratch-pop {
          0% {
            transform: scale(0.82);
          }
          70% {
            transform: scale(1.07);
          }
          100% {
            transform: scale(1);
          }
        }
        /* Canvas foil sits over the grid, fills the inset window. */
        .scratch-foil {
          position: absolute;
          inset: 4%;
          width: 92%;
          height: 92%;
          border-radius: 9px;
          pointer-events: none;
          touch-action: none;
        }
        .scratch-foil[data-live] {
          pointer-events: auto;
          cursor: grab;
        }
        .scratch-foil[data-live]:active {
          cursor: grabbing;
        }
        /* What is left of the foil lifts off; a new foil snaps back at once. */
        .scratch-foil[data-open] {
          opacity: 0;
          transition: opacity 0.22s ease-out;
        }
        @media (prefers-reduced-motion: reduce) {
          .scratch-cell-prize {
            animation: none;
          }
          .scratch-cell,
          .scratch-foil[data-open] {
            transition: none;
          }
        }
      `}</style>
    </div>
  );

  const glass = (
    <MachineGlass
      name="scratch cards"
      rules={[
        "Match 3 symbols to win. Every symbol pays the card's multiplier.",
        `A ${meta.label} card matches on ${meta.match}% of cards, and ${meta.payback}% pay 1× or more. The odds are for one card.`,
      ]}
      paytable={[
        ...meta.pays.map(({ mult, oneIn }) => ({
          label: `pays ${formatMult(mult)}`,
          value: `1 in ${oneIn.toLocaleString()}`,
        })),
        {
          label: "no match",
          value: `${100 - meta.match}% of cards`,
        },
      ]}
    />
  );

  const action =
    phase === "scratching" ? (
      <MachineButton onClick={revealCard}>reveal</MachineButton>
    ) : (
      <MachineButton
        onClick={() => void handleBuy()}
        disabled={!affordable || wager < ARCADE_MIN_BET}
        aria-disabled={isBuying || undefined}
        aria-label={`buy a ${meta.label} card, ${wager} tickets`}
      >
        buy
      </MachineButton>
    );

  const receipt =
    phase === "result" && card ? (
      <ArcadeWagerResultPlate
        result={{
          payout,
          stake: settledWager,
          multiplier: resultMult,
          jackpot: won && resultMult >= 25,
        }}
        kicker="scratch cards"
        headline={
          !match
            ? "no match"
            : breakEven
              ? "break even"
              : formatMult(resultMult)
        }
        detail={`${meta.label} card`}
        fairness={{ seedHash: null, revealedSeed }}
        achievements={achievements}
        roundId={roundId ?? undefined}
        sound={false}
      />
    ) : null;

  return (
    <GameShell
      game="scratch"
      stat={<GameStat value={formatMult(meta.maxMult)} label="top" />}
      howTo={HOW_TO}
    >
      <ArcadeMachine
        name="scratch cards"
        glass={glass}
        action={action}
        bet={{
          value: wager,
          onChange: setWager,
          balance,
          disabled: roundPlaying,
        }}
        controls={
          <MachineChoice<Tier>
            label="card"
            options={TIER_ITEMS}
            value={tier}
            onChange={setTier}
            disabled={roundPlaying}
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
