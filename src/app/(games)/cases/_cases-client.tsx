"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Package } from "lucide-react";
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
import {
  createGameFrameLoop,
  getGame2dContext,
} from "@/features/arcade/lib/game-frame-loop";
import {
  CASE_RARITY_COLORS,
  type CaseRarity as Rarity,
} from "@/features/arcade/lib/loot-rarity";
import { useWagerSession } from "@/features/arcade/lib/use-wager-session";
import { ARCADE_MIN_BET } from "@/server/arcade/arcade-constants";
import {
  CASE_ENAMELS,
  readReelPalette,
  hexToRgb,
  DEFAULT_REEL_PALETTE,
  type ReelPalette,
} from "./_cases-midway-theme";
import "./_cases-midway.css";

/* ===========================================================================
 *  Types + constants
 * ========================================================================= */

type Phase = "setup" | "opening" | "result";
type Risk = "low" | "medium" | "high";

type StripItem = { mult: number; rarity: Rarity };

type SettleResponse = {
  payout: number;
  multiplier: number;
  seed: number;
  roundId?: string | null;
  itemIndex?: number;
  rarity?: Rarity;
  risk?: Risk;
  error?: string;
};

type AnimState = {
  items: StripItem[];
  startT: number;
  currentOffset: number;
  targetOffset: number;
  durationMs: number;
  lastTickIndex: number;
  finished: boolean;
  winningIndex: number;
  winRarity: Rarity;
  resultReady: boolean;
  palette: ReelPalette;
};

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/* ---- Canvas geometry ---- */
const CANVAS_W = 640;
const CANVAS_H = 220;
const ITEM_W = 100;
const ITEM_H = 140;
const ITEM_MARGIN = 6;
const STRIP_LEN = 80;
/** The winning item sits here so there's a few items of context behind it. */
const WINNING_INDEX = 68;
const ANIM_DURATION_MS = 5400;

/* ---- Risk tier definitions (mirror server — tuned for 97% RTP) ---- */
const WIN_BUCKETS: Record<
  Risk,
  { mult: number; weight: number; rarity: Rarity }[]
> = {
  low: [
    { mult: 0.5, weight: 2500, rarity: "common" },
    { mult: 1, weight: 2500, rarity: "common" },
    { mult: 1.5, weight: 1500, rarity: "uncommon" },
    { mult: 2, weight: 800, rarity: "uncommon" },
    { mult: 3, weight: 400, rarity: "rare" },
    { mult: 5, weight: 200, rarity: "rare" },
    { mult: 10, weight: 100, rarity: "mythic" },
  ],
  medium: [
    { mult: 0.5, weight: 2000, rarity: "common" },
    { mult: 1, weight: 1500, rarity: "common" },
    { mult: 2, weight: 1000, rarity: "uncommon" },
    { mult: 5, weight: 500, rarity: "rare" },
    { mult: 10, weight: 250, rarity: "rare" },
    { mult: 25, weight: 100, rarity: "mythic" },
    { mult: 50, weight: 40, rarity: "mythic" },
    { mult: 100, weight: 10, rarity: "legendary" },
  ],
  high: [
    { mult: 0.5, weight: 800, rarity: "common" },
    { mult: 1, weight: 500, rarity: "common" },
    { mult: 2, weight: 400, rarity: "uncommon" },
    { mult: 5, weight: 200, rarity: "rare" },
    { mult: 10, weight: 150, rarity: "rare" },
    { mult: 25, weight: 100, rarity: "mythic" },
    { mult: 50, weight: 60, rarity: "mythic" },
    { mult: 100, weight: 35, rarity: "legendary" },
    { mult: 250, weight: 15, rarity: "legendary" },
    { mult: 500, weight: 12, rarity: "legendary" },
    { mult: 1000, weight: 8, rarity: "covert" },
  ],
};

const RTP = 0.97;

/** Derive the loss weight so EV lands exactly on RTP. */
function computeLossWeight(risk: Risk): number {
  const buckets = WIN_BUCKETS[risk];
  let winEV = 0;
  let winWeight = 0;
  for (const b of buckets) {
    winEV += b.mult * b.weight;
    winWeight += b.weight;
  }
  return Math.max(0, Math.round(winEV / RTP - winWeight));
}

/** Full weighted pool (loss + wins) for a risk tier. */
function riskPool(
  risk: Risk,
): { mult: number; weight: number; rarity: Rarity }[] {
  return [
    { mult: 0, weight: computeLossWeight(risk), rarity: "loss" },
    ...WIN_BUCKETS[risk],
  ];
}

function pickRandom(pool: ReturnType<typeof riskPool>): StripItem {
  const total = pool.reduce((s, it) => s + it.weight, 0);
  const r = Math.random() * total;
  let cum = 0;
  for (const it of pool) {
    cum += it.weight;
    if (r < cum) return { mult: it.mult, rarity: it.rarity };
  }
  const last = pool[pool.length - 1]!;
  return { mult: last.mult, rarity: last.rarity };
}

function generateStrip(risk: Risk, winning: StripItem): StripItem[] {
  const pool = riskPool(risk);
  const strip: StripItem[] = [];
  for (let i = 0; i < STRIP_LEN; i++) {
    if (i === WINNING_INDEX) {
      strip.push(winning);
    } else {
      strip.push(pickRandom(pool));
    }
  }
  return strip;
}

function formatMult(m: number): string {
  if (m === 0) return "BUST";
  if (m >= 1000) return `${m.toLocaleString()}x`;
  if (m >= 100) return `${m.toFixed(0)}x`;
  return `${m.toFixed(2)}x`;
}

/** A multiplier for the machine's words and glass. */
function fmtMult(m: number): string {
  return `${m.toLocaleString("en-US", { maximumFractionDigits: 2 })}×`;
}

function fmtProb(p: number): string {
  return p >= 0.001
    ? `${(p * 100).toFixed(2)}%`
    : `1 in ${Math.round(1 / p).toLocaleString()}`;
}

function probabilityFor(risk: Risk, mult: number): number {
  const pool = riskPool(risk);
  const total = pool.reduce((s, it) => s + it.weight, 0);
  const bucket = pool.find((it) => it.mult === mult);
  return bucket ? bucket.weight / total : 0;
}

/* ---- Risk tiers ---- */
const RISKS: Risk[] = ["low", "medium", "high"];
const RISK_MAX: Record<Risk, number> = { low: 10, medium: 100, high: 1000 };

const HOW_TO: GameHowTo = {
  lines: [
    "Pick a risk and press open to spin the strip.",
    "The item that stops under the pointer is the prize, as a multiple of your bet.",
    "Low pays up to 10×, medium 100× and high 1,000×, and every risk returns 97%.",
  ],
};

/* ===========================================================================
 *  Component
 * ========================================================================= */

export default function CasesClient() {
  const { trigger: triggerFeedback } = useGameFeedback();
  const {
    wallet,
    loaded: walletLoaded,
    refresh: refreshWallet,
    adjustCredits,
  } = useGamesWallet();
  const balance = walletLoaded ? wallet.credits : null;
  const [risk, setRisk] = useState<Risk>("medium");

  const [phase, setPhase] = useState<Phase>("setup");
  const [isOpening, setIsOpening] = useState(false);
  const [wager, setWager] = useMachineBet(balance, 10, { locked: isOpening });
  /* The stake and risk the case was bought with; the receipt prints them. */
  const [roundStake, setRoundStake] = useState(0);
  const [roundRisk, setRoundRisk] = useState<Risk>("medium");
  const [roundId, setRoundId] = useState<string | null>(null);
  const [winningItem, setWinningItem] = useState<StripItem | null>(null);
  const [payout, setPayout] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const {
    revealedSeed,
    start: startSession,
    settle: settleSession,
    achievements,
  } = useWagerSession("arcade-cases");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<AnimState | null>(null);

  /* ---------- Game loop ---------- */
  useEffect(() => {
    if (phase !== "opening") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = getGame2dContext(canvas);
    if (!ctx) return;

    const loop = createGameFrameLoop({
      simulate: () => animRef.current?.finished !== true,
      render: (_alpha, frame) => {
        const anim = animRef.current;
        if (!anim) return;
        updateAnim(anim, frame.nowMs);
        drawStrip(ctx, anim);
      },
    });
    loop.start();
    return () => loop.destroy();
  }, [phase]);

  /* ---------- Open case ---------- */
  const handleOpen = useCallback(async () => {
    if (isOpening) return;
    if (balance == null) return;
    setError(null);
    if (wager > balance) {
      setError(`You need ${wager} tickets for this bet.`);
      return;
    }

    setRoundId(null);
    setRoundStake(wager);
    setRoundRisk(risk);
    setIsOpening(true);
    SoundManager.play("arcadeBet");
    adjustCredits(-wager);

    try {
      // 1. Create session
      const session = await startSession(wager, { risk });
      if (!session.ok) {
        setError(
          machineError(session.error, "The machine could not open the case."),
        );
        setIsOpening(false);
        void refreshWallet();
        return;
      }

      // 2. Settle immediately
      const settled = await settleSession<SettleResponse>();
      if (!settled.ok) {
        setError(
          machineError(settled.error, "The case did not open. Try again."),
        );
        setIsOpening(false);
        void refreshWallet();
        return;
      }
      const settleData = settled.data;

      // 3. Build strip: the winning item lands at WINNING_INDEX
      const winning: StripItem = {
        mult: settleData.multiplier,
        rarity: settleData.rarity ?? "loss",
      };
      const items = generateStrip(risk, winning);

      // 4. Compute target offset: winning-item center under the ticker
      //    with a small random jitter so each spin feels different.
      const reduced = prefersReducedMotion();
      const winCenterWorld = WINNING_INDEX * ITEM_W + ITEM_W / 2;
      // Reduced motion: settle straight to the winning item — no jitter, no
      // spin — so the strip is parked exactly on the result.
      const jitter = reduced ? 0 : (Math.random() - 0.5) * (ITEM_W * 0.6);
      const targetOffset = CANVAS_W / 2 - winCenterWorld + jitter;
      const durationMs = reduced ? 0 : ANIM_DURATION_MS;

      animRef.current = {
        items,
        startT: performance.now(),
        currentOffset: reduced ? targetOffset : 0,
        targetOffset,
        durationMs,
        lastTickIndex: -1,
        finished: reduced,
        winningIndex: WINNING_INDEX,
        winRarity: winning.rarity,
        resultReady: reduced,
        palette: readReelPalette(canvasRef.current),
      };

      setWinningItem(winning);
      setPayout(settleData.payout);
      setRoundId(settleData.roundId ?? null);
      setPhase("opening");

      // 5. Once the animation finishes, transition to result phase and
      //    play the rarity-appropriate sound. Using setTimeout keeps the
      //    React state transition decoupled from the rAF loop.
      window.setTimeout(() => {
        const anim = animRef.current;
        if (anim) anim.resultReady = true;
        if (settleData.payout === 0) {
          triggerFeedback("loss");
        } else if (settleData.multiplier >= 25) {
          triggerFeedback("jackpot");
        } else if (settleData.multiplier >= 2) {
          triggerFeedback("round-win");
        } else {
          triggerFeedback("cashout");
        }
        setPhase("result");
        setIsOpening(false);
        void refreshWallet();
      }, durationMs + 80);
    } catch {
      setError("The machine lost its connection. Try again.");
      setIsOpening(false);
      void refreshWallet();
    }
  }, [
    isOpening,
    wager,
    balance,
    risk,
    refreshWallet,
    startSession,
    settleSession,
    adjustCredits,
    triggerFeedback,
  ]);

  /* ---------- Space opens a case ---------- */
  useMachineKey(isOpening ? null : () => void handleOpen());

  /* ---------- Computed ---------- */
  const affordable = balance != null && wager <= balance;
  const lossPct =
    (computeLossWeight(risk) /
      (computeLossWeight(risk) +
        WIN_BUCKETS[risk].reduce((s, b) => s + b.weight, 0))) *
    100;

  const statusLine =
    phase === "setup"
      ? isOpening
        ? "Opening."
        : "Pick a risk, then press open."
      : phase === "opening"
        ? "Opening."
        : winningItem && winningItem.mult > 0
          ? `${fmtMult(winningItem.mult)} on the pointer.`
          : "Empty case.";

  /* ---------- Screen ---------- */
  const screen = (
    <div className="arc-machine-fit cases-midway">
      {phase === "setup" ? (
        <Package size={40} aria-hidden className="text-faint" />
      ) : (
        <div
          className="cases-window relative"
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
          <ArcadeChip className="cases-tier-chip pointer-events-none absolute left-2.5 top-2.5">
            {roundRisk} risk
          </ArcadeChip>
        </div>
      )}
      <p role="status" className="arc-machine-status">
        {statusLine}
      </p>
    </div>
  );

  const glass = (
    <MachineGlass
      name="cases"
      rules={[
        `On ${risk} risk, ${Math.round(lossPct)}% of cases are empty.`,
      ]}
      paytable={WIN_BUCKETS[risk].map((b) => ({
        label: fmtMult(b.mult),
        value: fmtProb(probabilityFor(risk, b.mult)),
        lit:
          phase === "result" &&
          roundRisk === risk &&
          winningItem?.mult === b.mult,
      }))}
    />
  );

  const action = (
    <MachineButton
      onClick={() => void handleOpen()}
      disabled={!affordable || wager < ARCADE_MIN_BET}
      aria-disabled={isOpening || undefined}
      aria-label={`open, ${wager} tickets`}
    >
      open
    </MachineButton>
  );

  const receipt =
    phase === "result" && winningItem ? (
      <ArcadeWagerResultPlate
        result={{
          payout,
          stake: roundStake,
          multiplier: winningItem.mult,
          jackpot: winningItem.mult >= 25,
        }}
        kicker="cases"
        headline={winningItem.mult === 0 ? "empty" : fmtMult(winningItem.mult)}
        detail={`${roundRisk} risk, ${CASE_RARITY_COLORS[winningItem.rarity].label.toLowerCase()}`}
        fairness={{ seedHash: null, revealedSeed }}
        achievements={achievements}
        roundId={roundId ?? undefined}
        sound={false}
      />
    ) : null;

  return (
    <GameShell
      game="cases"
      stat={<GameStat value={fmtMult(RISK_MAX[risk])} label="top" />}
      howTo={HOW_TO}
    >
      <ArcadeMachine
        name="cases"
        glass={glass}
        action={action}
        bet={{ value: wager, onChange: setWager, balance, disabled: isOpening }}
        controls={
          <MachineChoice<Risk>
            label="risk"
            options={RISKS.map((key) => ({ value: key, label: key }))}
            value={risk}
            onChange={setRisk}
            disabled={isOpening}
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
 *  Animation + drawing
 * ========================================================================= */

function updateAnim(anim: AnimState, nowMs: number) {
  // Reduced motion / zero-duration: park on the result immediately, no juice.
  if (anim.durationMs <= 0) {
    anim.currentOffset = anim.targetOffset;
    anim.finished = true;
    return;
  }
  const t = Math.min(1, (nowMs - anim.startT) / anim.durationMs);
  // easeOutQuint — strong deceleration at the end
  const eased = 1 - Math.pow(1 - t, 5);
  anim.currentOffset = anim.targetOffset * eased;

  // Tick sound when a new item slides under the ticker. To avoid spamming
  // early when the strip is flying, only tick below a certain velocity.
  const velocity =
    (Math.abs(anim.targetOffset) * 5 * Math.pow(1 - t, 4)) /
    (anim.durationMs / 1000);
  const centerWorldX = CANVAS_W / 2 - anim.currentOffset;
  const currentIdx = Math.floor(centerWorldX / ITEM_W);
  if (
    currentIdx !== anim.lastTickIndex &&
    anim.lastTickIndex !== -1 &&
    t < 0.99
  ) {
    // velocity threshold: only play ticks once things slow below ~1500 px/s
    // (the start velocity is way above this so ticks are silent at first)
    if (velocity < 1500) {
      SoundManager.play("arcadeReveal");
    }
  }
  anim.lastTickIndex = currentIdx;

  if (t >= 1) {
    anim.finished = true;
  }
}

function drawStrip(ctx: CanvasRenderingContext2D, anim: AnimState) {
  const pal = anim.palette ?? DEFAULT_REEL_PALETTE;
  // Background — recessed dark glass well (warm wood-cabinet tones)
  const bgGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  bgGrad.addColorStop(0, pal.wellTop);
  bgGrad.addColorStop(1, pal.wellBottom);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Subtle horizontal "shelf" track behind the strip
  ctx.fillStyle = pal.shelf;
  ctx.fillRect(0, 28, CANVAS_W, CANVAS_H - 56);
  // Faint engraved track lines top + bottom of the shelf
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(0, 28, CANVAS_W, 1);
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(0, CANVAS_H - 28, CANVAS_W, 1);

  // Visible range of items — only draw the ones on-screen
  const firstVisible = Math.max(
    0,
    Math.floor(-anim.currentOffset / ITEM_W) - 1,
  );
  const lastVisible = Math.min(
    anim.items.length - 1,
    Math.ceil((-anim.currentOffset + CANVAS_W) / ITEM_W) + 1,
  );
  for (let i = firstVisible; i <= lastVisible; i++) {
    const item = anim.items[i];
    if (!item) continue;
    const screenX = i * ITEM_W + anim.currentOffset;
    const highlight = anim.finished && i === anim.winningIndex;
    drawItem(
      ctx,
      screenX + ITEM_MARGIN / 2,
      40,
      ITEM_W - ITEM_MARGIN,
      ITEM_H,
      item,
      highlight,
    );
  }

  // Edge fade so items appear to slide off into the dark cabinet
  const [fr, fg, fb] = hexToRgb(pal.fade);
  const leftFade = ctx.createLinearGradient(0, 0, 140, 0);
  leftFade.addColorStop(0, `rgba(${fr}, ${fg}, ${fb}, 1)`);
  leftFade.addColorStop(1, `rgba(${fr}, ${fg}, ${fb}, 0)`);
  ctx.fillStyle = leftFade;
  ctx.fillRect(0, 28, 140, CANVAS_H - 56);

  const rightFade = ctx.createLinearGradient(CANVAS_W - 140, 0, CANVAS_W, 0);
  rightFade.addColorStop(0, `rgba(${fr}, ${fg}, ${fb}, 0)`);
  rightFade.addColorStop(1, `rgba(${fr}, ${fg}, ${fb}, 1)`);
  ctx.fillStyle = rightFade;
  ctx.fillRect(CANVAS_W - 140, 28, 140, CANVAS_H - 56);

  // Ticker line — an enamel amber pointer. Flat paint, no pulse/glow.
  const tickerX = CANVAS_W / 2;
  const [tr, tg, tb] = hexToRgb(pal.ticker);
  // hard dark seat behind the pointer so it reads as a physical rail
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(tickerX - 3, 18, 6, CANVAS_H - 36);
  ctx.fillStyle = `rgb(${tr}, ${tg}, ${tb})`;
  ctx.fillRect(tickerX - 1.5, 18, 3, CANVAS_H - 36);

  // Ticker arrows (top + bottom) — solid enamel pointer
  ctx.fillStyle = `rgb(${tr}, ${tg}, ${tb})`;
  ctx.beginPath();
  ctx.moveTo(tickerX - 10, 2);
  ctx.lineTo(tickerX + 10, 2);
  ctx.lineTo(tickerX, 18);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(tickerX - 10, CANVAS_H - 2);
  ctx.lineTo(tickerX + 10, CANVAS_H - 2);
  ctx.lineTo(tickerX, CANVAS_H - 18);
  ctx.closePath();
  ctx.fill();
}

function drawItem(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  item: StripItem,
  highlight: boolean,
) {
  const enamel = CASE_ENAMELS[item.rarity];
  const label = CASE_RARITY_COLORS[item.rarity].label;
  const [hr, hg, hb] = hexToRgb(enamel.hi);
  const [br, bg, bb] = hexToRgb(enamel.base);
  const [dr, dg, db] = hexToRgb(enamel.deep);
  const [er, eg, eb] = hexToRgb(enamel.edge);
  const radius = 10;

  // Enamel face — flat lacquer gradient, top paint → base paint. No glow.
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, `rgb(${hr}, ${hg}, ${hb})`);
  g.addColorStop(0.52, `rgb(${br}, ${bg}, ${bb})`);
  g.addColorStop(1, `rgb(${dr}, ${dg}, ${db})`);
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, radius);
  ctx.fill();

  // Hard painted edge
  ctx.strokeStyle = `rgb(${er}, ${eg}, ${eb})`;
  ctx.lineWidth = highlight ? 2.5 : 1.5;
  roundRect(ctx, x + 0.75, y + 0.75, w - 1.5, h - 1.5, radius - 1);
  ctx.stroke();

  // Inset top bevel highlight (physical enamel sheen, not glow)
  const gloss = ctx.createLinearGradient(x, y, x, y + 30);
  gloss.addColorStop(0, "rgba(255,255,255,0.30)");
  gloss.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gloss;
  roundRect(ctx, x + 2.5, y + 2.5, w - 5, 24, radius - 4);
  ctx.fill();

  // Winning card: hard double bevel ring + cream key-edge (no blur).
  if (highlight) {
    ctx.strokeStyle = "rgba(246,237,220,0.92)";
    ctx.lineWidth = 2;
    roundRect(ctx, x - 2.5, y - 2.5, w + 5, h + 5, radius + 2);
    ctx.stroke();
    ctx.strokeStyle = `rgba(${er}, ${eg}, ${eb}, 0.9)`;
    ctx.lineWidth = 1.5;
    roundRect(ctx, x - 4.5, y - 4.5, w + 9, h + 9, radius + 4);
    ctx.stroke();
  }

  // Main mult text (center) — mono numerics with a hard offset shadow
  const text = formatMult(item.mult);
  ctx.textAlign = "center";
  const fontSize = text.length >= 7 ? 19 : text.length >= 5 ? 23 : 27;
  ctx.font = `700 ${fontSize}px 'Spline Sans Mono', ui-monospace, monospace`;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillText(text, x + w / 2 + 1.5, y + h / 2 + 8.5);
  ctx.fillStyle = enamel.on;
  ctx.fillText(text, x + w / 2, y + h / 2 + 7);

  // Rarity label at bottom — display-cased, enamel ink
  ctx.fillStyle = enamel.on;
  ctx.globalAlpha = 0.82;
  ctx.font = "700 9px 'Bungee', ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(label, x + w / 2, y + h - 11);
  ctx.globalAlpha = 1;
}

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
