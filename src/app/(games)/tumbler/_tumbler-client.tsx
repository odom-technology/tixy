'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { LockKeyhole, CircleHelp } from 'lucide-react';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import { PageHeader, GamesWalletCard } from '@/features/arcade/components/shell/page-header';
import { MuteButton } from '@/features/arcade/components/mute-button';
import { EnvMonitor } from '@/features/arcade/lib/game-anti-cheat';
import { usePreventGameGestures, useIsTouchDevice } from '@/features/arcade/lib/game-mobile-utils';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import {
  PHYSICS_DT_MS,
  createGameFrameLoop,
  getGame2dContext,
  gameCanvasDpr,
  type GameFrameLoop,
} from '@/features/arcade/lib/game-frame-loop';
import { ArcadeRunRewards } from '@/features/arcade/components/results/arcade-run-result';
import { useArcadeRunResult } from '@/features/arcade/lib/run-result';
import type { AccountXpReward } from '@/server/arcade/rewards/types';
import {
  tumblerPinFor,
  tumblerMarkerAngle,
  tumblerApplyTap,
  tumblerInitialState,
  tumblerLayerFor,
  TUMBLER_MAX_PINS,
  TUMBLER_MAX_TAPS,
  TUMBLER_PINS_PER_LAYER,
  TUMBLER_CLEAN_STREAK_MIN,
  type TumblerPin,
  type TumblerSimState,
} from '@/server/arcade/tumbler-replay';
import {
  DEFAULT_TUMBLER_THEME,
  buildTumblerTheme,
  type InventoryCosmeticResponse,
  type TumblerCosmeticTheme,
} from './_tumbler-theme';

import './_tumbler.css';
import {
  drawCanvasCallout,
  readCanvasCalloutLook,
  type CanvasCalloutTone,
} from '@/features/arcade/components/gameplay/callout-canvas';

// ── Logical stage (square-ish lock plate centered in a wide cabinet screen).
//    The canvas fills this space; scale + dpr keep sim coords display-independent.
const BASE_WIDTH = 760;
const BASE_HEIGHT = 520;
const FRAME_TIME = PHYSICS_DT_MS;

// Lock-ring geometry within the logical space.
const RING_CX = BASE_WIDTH / 2;
const RING_CY = BASE_HEIGHT / 2 + 6;
const RING_RADIUS = 168; // centerline radius of the brass channel
const RING_THICKNESS = 30; // channel width the marker rides in
const MARKER_R = 16; // enamel marker dot radius
const LAMP_RADIUS = 136; // ring of pin-set indicator rivets
const TIER_RADII = [112, 78] as const; // inner vault tiers waiting to unlock
const KNOB_RADIUS = 52; // central knob (score engraving)

const RESTART_GRACE_PERIOD = 450;

const REWARDS_HINT_TEXT =
  'Rewards hint: score points by popping pins — a dead-center CLEAN PICK pays 2 (3 once a clean streak of 3+ is hot), an edge graze pays 1, and rare double-tap sticky pins pay a +1 bonus. Every 5 pins cracks a lock layer. More points earns more tickets; rewards taper at higher scores.';

// Distinct existing SoundManager names, mapped to lock-mechanism moments.
const SFX = {
  click: 'arcadeBet', // tactile pick click under every hit
  graze: 'arcadeReelStop', // dull clunk — edge graze
  clean: 'coinCorrect', // bright chime — clean pick
  streak: 'arcadeCashout', // higher two-note chime — clean streak 3+
  milestone: 'coinStreakMilestone', // sparkle arpeggio every 5-clean streak
  sticky: 'arcadeReveal', // first hit of a double-tap pin seats halfway
  layerClunk: 'arcadeReelStop', // multi-clunk while a layer opens
  layerOpen: 'arcadeWin', // the layer swings open
  miss: 'coinWrong', // dead tap thud
  rattle: 'arcadeCrash', // harsh mechanism rattle on the fatal miss
  start: 'arcadeReveal',
  over: 'arcadeLose',
} as const;

type GameState = 'idle' | 'playing' | 'gameover' | 'error';

type RecordedTap = { t: number };

// A short-lived spark/shard burst when a pin pops. Render-only — never touches
// the sim. (Midway: a hard flash via opacity + transform, no glow.)
type Shard = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
};

// Floating verdict plate ("clean +2", "graze +1", "layer 2 cracked"): the
// shared callout plate. Render-only.
type FloatLabel = {
  text: string;
  tone: CanvasCalloutTone;
  x: number;
  y: number;
  life: number;
};

const getSubmitErrorMessage = (
  status: number,
  data: { error?: string; details?: string; retryAfterSec?: number } | null,
) => {
  if (status === 429) {
    const retry =
      typeof data?.retryAfterSec === 'number'
        ? ` Try again in ${data.retryAfterSec}s.`
        : '';
    return `${data?.error ?? 'Too many score submissions.'}${retry}`;
  }
  if (typeof data?.details === 'string' && data.details.trim()) {
    return data.details;
  }
  if (typeof data?.error === 'string' && data.error.trim()) {
    return data.error;
  }
  return 'Could not save the run. Try again.';
};

// ── Midway palette — the canvas paints with literals from a TumblerCosmeticTheme.
//    The lock is a lacquered-walnut plate holding a polished concentric brass
//    safe-dial, art-deco enamel banding in the corners, an enamel-red marker
//    bead, and a gold lit notch (public/games/tumbler/poster.webp). The default
//    theme (empty loadout) keeps NOTHING glowing; equipped skins recolor per
//    slot and may opt into a subtle marker-bead glow. Each paint helper takes the
//    resolved theme `c` so equipped cosmetics flow straight into the render. ──

// Rounded-rect path helper (used by the wood-frame window + deco brackets).
const roundRectPath = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) => {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
};

// One art-deco corner bracket: three nested enamel chevrons (teal/amber/red)
// hugging a corner of the wood frame, mirroring the poster's banding.
const paintDecoCorner = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  flipX: number,
  flipY: number,
  c: TumblerCosmeticTheme,
) => {
  const bands: Array<[string, number, number]> = [
    [c.enamelTeal, 30, 7],
    [c.enamelAmber, 46, 6],
    [c.enamelRed, 60, 6],
  ];
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [color, reach, width] of bands) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(cx + flipX * reach, cy);
    ctx.lineTo(cx + flipX * 12, cy + flipY * 12);
    ctx.lineTo(cx, cy + flipY * reach);
    ctx.stroke();
    // Hard top sheen on each enamel band (no glow).
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx + flipX * reach, cy - flipY * (width / 2 - 1));
    ctx.lineTo(cx + flipX * 12, cy + flipY * (12 - width / 2 + 1));
    ctx.stroke();
  }
  ctx.restore();
};

// The lacquered-walnut frame + deco corners + recessed dark window. Static — the
// dial, notch, and marker paint on top each frame.
const paintTumblerFrame = (
  ctx: CanvasRenderingContext2D,
  c: TumblerCosmeticTheme,
) => {
  // Walnut base fill (vertical sheen, darker at the bottom).
  const wood = ctx.createLinearGradient(0, 0, 0, BASE_HEIGHT);
  wood.addColorStop(0, c.woodHi);
  wood.addColorStop(0.5, c.woodMid);
  wood.addColorStop(1, c.woodLo);
  ctx.fillStyle = wood;
  ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);

  // Faint horizontal grain.
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.strokeStyle = c.woodGrain;
  ctx.lineWidth = 1;
  for (let y = 14; y < BASE_HEIGHT; y += 13) {
    const wobble = Math.sin(y * 0.13) * 3;
    ctx.beginPath();
    ctx.moveTo(0, y + wobble);
    ctx.lineTo(BASE_WIDTH, y - wobble);
    ctx.stroke();
  }
  ctx.restore();

  // Deco corner brackets (inset from the edges).
  const m = 26;
  paintDecoCorner(ctx, m, m, 1, 1, c);
  paintDecoCorner(ctx, BASE_WIDTH - m, m, -1, 1, c);
  paintDecoCorner(ctx, m, BASE_HEIGHT - m, 1, -1, c);
  paintDecoCorner(ctx, BASE_WIDTH - m, BASE_HEIGHT - m, -1, -1, c);

  // Recessed dark window holding the dial — hard bevel (light top-left, dark
  // bottom-right) then a dark gradient fill.
  const inset = 18;
  const winX = inset;
  const winY = inset;
  const winW = BASE_WIDTH - inset * 2;
  const winH = BASE_HEIGHT - inset * 2;
  const radius = 26;
  // Outer bevel.
  roundRectPath(ctx, winX - 2, winY - 2, winW + 4, winH + 4, radius + 2);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fill();
  roundRectPath(ctx, winX, winY, winW, winH, radius);
  ctx.fillStyle = c.woodHi;
  ctx.fill();
  roundRectPath(ctx, winX + 2, winY + 2, winW - 3, winH - 3, radius - 1);
  const well = ctx.createRadialGradient(
    RING_CX,
    RING_CY - 40,
    40,
    RING_CX,
    RING_CY,
    BASE_WIDTH * 0.6,
  );
  well.addColorStop(0, c.well);
  well.addColorStop(1, c.wellEdge);
  ctx.fillStyle = well;
  ctx.fill();
  // Inner top shadow line for recess depth.
  ctx.save();
  roundRectPath(ctx, winX + 2, winY + 2, winW - 3, winH - 3, radius - 1);
  ctx.clip();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(winX, winY, winW, 8);
  ctx.restore();
};

// One raised brass plateau: a metal disk lit from the upper-left, with a hard
// top-highlight rim and a dark bottom rim that fake its height, ringed by a
// recessed groove. Returns nothing — paints at (RING_CX, RING_CY).
const paintBrassTier = (
  ctx: CanvasRenderingContext2D,
  radius: number,
  lift: number,
  c: TumblerCosmeticTheme,
) => {
  // Recessed groove around the tier (separates it from the tier below).
  ctx.fillStyle = c.brassGroove;
  ctx.beginPath();
  ctx.arc(RING_CX, RING_CY, radius + 3, 0, Math.PI * 2);
  ctx.fill();
  // Dark bottom rim (offset down) reads as the tier's vertical edge.
  ctx.fillStyle = c.brassDeep;
  ctx.beginPath();
  ctx.arc(RING_CX, RING_CY + lift, radius, 0, Math.PI * 2);
  ctx.fill();
  // Metal face — radial gradient with the highlight focus toward upper-left.
  const g = ctx.createRadialGradient(
    RING_CX - radius * 0.4,
    RING_CY - radius * 0.5,
    radius * 0.1,
    RING_CX,
    RING_CY,
    radius * 1.25,
  );
  g.addColorStop(0, c.brassHi);
  g.addColorStop(0.35, c.brass);
  g.addColorStop(0.72, c.brassMid);
  g.addColorStop(1, c.brassLo);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(RING_CX, RING_CY, radius, 0, Math.PI * 2);
  ctx.fill();
  // Hard top-light rim arc + dark bottom rim arc (bevel).
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,246,210,0.55)';
  ctx.beginPath();
  ctx.arc(RING_CX, RING_CY, radius - 1, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.arc(RING_CX, RING_CY, radius - 1, Math.PI * 0.08, Math.PI * 0.92);
  ctx.stroke();
};

// Machined radial tick marks engraved on a vault tier ring, rotated by `spin`
// (the layer-open flourish turns the inner tiers like a vault wheel).
const paintTierTicks = (
  ctx: CanvasRenderingContext2D,
  radius: number,
  ticks: number,
  spin: number,
  unlockedTint: number,
) => {
  ctx.save();
  for (let i = 0; i < ticks; i += 1) {
    const a = spin + (i / ticks) * Math.PI * 2;
    const r0 = radius - 7;
    const r1 = radius - 2;
    ctx.lineWidth = 1.4;
    ctx.strokeStyle =
      unlockedTint > 0
        ? `rgba(246,224,154,${0.25 + unlockedTint * 0.35})`
        : 'rgba(36,26,11,0.5)';
    ctx.beginPath();
    ctx.moveTo(RING_CX + Math.cos(a) * r0, RING_CY + Math.sin(a) * r0);
    ctx.lineTo(RING_CX + Math.cos(a) * r1, RING_CY + Math.sin(a) * r1);
    ctx.stroke();
  }
  ctx.restore();
};

// The full concentric brass safe-dial behind the marker track: the big turned
// face, two stepped vault tiers (which spin as layers unlock), and the central
// knob. Score + layer engrave on top later.
const paintBrassDial = (
  ctx: CanvasRenderingContext2D,
  c: TumblerCosmeticTheme,
  tierSpin: number,
  layersOpen: number,
) => {
  // Big turned face (fills inside the marker channel).
  paintBrassTier(ctx, RING_RADIUS - RING_THICKNESS / 2 - 4, 4, c);
  // Lathe-turned concentric scribe lines for craft.
  ctx.save();
  ctx.lineWidth = 1;
  for (let r = 44; r < RING_RADIUS - RING_THICKNESS / 2 - 10; r += 11) {
    ctx.strokeStyle = 'rgba(36,26,11,0.32)';
    ctx.beginPath();
    ctx.arc(RING_CX, RING_CY, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,246,210,0.10)';
    ctx.beginPath();
    ctx.arc(RING_CX, RING_CY, r + 1.2, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  }
  ctx.restore();
  // Stepped vault tiers rising toward the centre — each engraved with machined
  // ticks that spin (in opposite directions) when a layer cracks open. Tiers the
  // player has already unlocked show warm lit ticks; locked tiers stay dark.
  paintBrassTier(ctx, TIER_RADII[0], 3, c);
  paintTierTicks(ctx, TIER_RADII[0], 28, tierSpin, layersOpen >= 1 ? 1 : 0);
  paintBrassTier(ctx, TIER_RADII[1], 3, c);
  paintTierTicks(ctx, TIER_RADII[1], 18, -tierSpin * 1.4, layersOpen >= 2 ? 1 : 0);
  // Central knob (brightest, slightly domed) — score engraves here.
  paintBrassTier(ctx, KNOB_RADIUS, 2, c);
};

// The marker channel (the outer track the bead orbits) + a ring of dial ticks.
const paintMarkerTrack = (
  ctx: CanvasRenderingContext2D,
  c: TumblerCosmeticTheme,
) => {
  // Dark recessed channel.
  ctx.lineWidth = RING_THICKNESS;
  ctx.strokeStyle = c.brassGroove;
  ctx.beginPath();
  ctx.arc(RING_CX, RING_CY, RING_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  // Brass rails: bright outer, dark inner.
  ctx.lineWidth = 3;
  ctx.strokeStyle = c.brassHi;
  ctx.beginPath();
  ctx.arc(RING_CX, RING_CY, RING_RADIUS + RING_THICKNESS / 2 - 1.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = c.brassDeep;
  ctx.beginPath();
  ctx.arc(RING_CX, RING_CY, RING_RADIUS - RING_THICKNESS / 2 + 1.5, 0, Math.PI * 2);
  ctx.stroke();
  // Dial ticks around the channel (engraved gauge marks).
  ctx.save();
  ctx.strokeStyle = 'rgba(246,224,154,0.5)';
  for (let i = 0; i < 48; i += 1) {
    const a = (i / 48) * Math.PI * 2;
    const major = i % 4 === 0;
    const r0 = RING_RADIUS + RING_THICKNESS / 2 - (major ? 9 : 5);
    const r1 = RING_RADIUS + RING_THICKNESS / 2 - 2;
    ctx.lineWidth = major ? 1.6 : 0.8;
    ctx.beginPath();
    ctx.moveTo(RING_CX + Math.cos(a) * r0, RING_CY + Math.sin(a) * r0);
    ctx.lineTo(RING_CX + Math.cos(a) * r1, RING_CY + Math.sin(a) * r1);
    ctx.stroke();
  }
  ctx.restore();
};

// One notch arc seated in the marker channel. `mode` picks the paint:
// 'active' = the lit target (pulsing sheen), 'armed' = a sticky pin's waiting
// second target (faint outline), 'set' = a sticky pin's already-hit first notch.
const paintNotch = (
  ctx: CanvasRenderingContext2D,
  c: TumblerCosmeticTheme,
  angle: number,
  half: number,
  mode: 'active' | 'armed' | 'set',
  pulse: number,
  flash: number,
) => {
  ctx.save();
  ctx.lineCap = 'round';
  if (mode === 'armed') {
    // Waiting second target: a dim seat with a dashed cream rim.
    ctx.lineWidth = RING_THICKNESS - 8;
    ctx.strokeStyle = 'rgba(154,98,26,0.5)';
    ctx.beginPath();
    ctx.arc(RING_CX, RING_CY, RING_RADIUS, angle - half, angle + half);
    ctx.stroke();
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,241,207,0.55)';
    ctx.beginPath();
    ctx.arc(
      RING_CX,
      RING_CY,
      RING_RADIUS + RING_THICKNESS / 2 - 6,
      angle - half,
      angle + half,
    );
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (mode === 'set') {
    // Already-seated first notch of a sticky pin: dark burnished gold.
    ctx.lineWidth = RING_THICKNESS - 6;
    ctx.strokeStyle = c.notchEdge;
    ctx.beginPath();
    ctx.arc(RING_CX, RING_CY, RING_RADIUS, angle - half, angle + half);
    ctx.stroke();
    ctx.restore();
    return;
  }
  // Active target: bright enamel plug + pulsing top sheen.
  ctx.lineWidth = RING_THICKNESS - 4;
  ctx.strokeStyle = c.notch;
  ctx.beginPath();
  ctx.arc(RING_CX, RING_CY, RING_RADIUS, angle - half, angle + half);
  ctx.stroke();
  ctx.lineWidth = 4;
  ctx.strokeStyle = flash > 0 ? c.notchHit : c.notchHi;
  ctx.globalAlpha = Math.min(1, 0.6 + pulse * 0.3 + flash * 0.3);
  ctx.beginPath();
  ctx.arc(
    RING_CX,
    RING_CY,
    RING_RADIUS + RING_THICKNESS / 2 - 6,
    angle - half,
    angle + half,
  );
  ctx.stroke();
  ctx.globalAlpha = 1;
  // Dark inner edge for seating depth.
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = c.notchEdge;
  ctx.beginPath();
  ctx.arc(
    RING_CX,
    RING_CY,
    RING_RADIUS - RING_THICKNESS / 2 + 5,
    angle - half,
    angle + half,
  );
  ctx.stroke();
  ctx.restore();
};

export default function TumblerClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [gameState, setGameState] = useState<GameState>('idle');
  const [score, setScore] = useState(0);
  const [pins, setPins] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [tapPressed, setTapPressed] = useState(false);

  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [walletBalances, setWalletBalances] = useState({ credits: 0 });
  const [dailyCreditsProgress, setDailyCreditsProgress] = useState({
    earned: 0,
    cap: 300,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [runRewardMessage, setRunRewardMessage] = useState<string | null>(null);
  const [, setRunRewardIsCapHit] = useState(false);
  const [, setRunAccountXp] = useState<AccountXpReward | null>(null);
  const { result: runResult, capture: captureRunResult, reset: resetRunResult } = useArcadeRunResult();
  const [showRewardsHint, setShowRewardsHint] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [banUntilMs, setBanUntilMs] = useState<number | null>(null);
  const [banIndefinite, setBanIndefinite] = useState(false);
  const [banNowMs, setBanNowMs] = useState(Date.now());
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);
  const [tumblerTheme, setTumblerTheme] =
    useState<TumblerCosmeticTheme>(DEFAULT_TUMBLER_THEME);
  const [canvasSize, setCanvasSize] = useState({
    width: BASE_WIDTH,
    height: BASE_HEIGHT,
    dpr: 1,
  });

  usePreventGameGestures(gameState === 'playing');
  const touchDevice = useIsTouchDevice();

  // ── Refs (mutable sim state; no re-render) ──
  const gameStateRef = useRef<GameState>('idle');
  const sessionTokenRef = useRef<string | null>(null);
  const seedRef = useRef<number | null>(null);
  const envMonitorRef = useRef(new EnvMonitor());
  const isStartingRef = useRef(false);
  const isGuestRunRef = useRef(false);

  // The authoritative sim state — advanced ONLY through tumblerApplyTap, the
  // same pure state machine the server replays. Never mutate fields directly.
  const simRef = useRef<TumblerSimState>(tumblerInitialState());
  const scoreRef = useRef(0);
  const pinRef = useRef<TumblerPin | null>(null);
  const pinStartRef = useRef(0); // performance.now() when the current pin began
  const markerAngleRef = useRef(0); // last sim marker angle (radians)
  const tapsRef = useRef<RecordedTap[]>([]);

  const frameLoopRef = useRef<GameFrameLoop | null>(null);
  const scaleRef = useRef(1);
  const gameStartTimeRef = useRef(0);
  const gameOverTimeRef = useRef<number>(0);
  const shardsRef = useRef<Shard[]>([]);
  const labelsRef = useRef<FloatLabel[]>([]);
  const reducedMotionRef = useRef(false);
  const hitFlashRef = useRef(0); // 0..1 decaying flash on a successful pop
  const recoilRef = useRef(0); // 0..1 mechanical recoil (dial micro-pulse)
  const shineRef = useRef(0); // 0..1 layer-open shine sweep progress
  const missFlashRef = useRef(0); // 0..1 red target flash + marker stagger
  const tierSpinRef = useRef(0); // eased vault-tier rotation (rad)
  const tierSpinTargetRef = useRef(0);
  const missAngleRef = useRef<number | null>(null); // marker angle frozen at the fatal miss
  const missTargetRef = useRef<number | null>(null); // notch angle of the fatal miss
  const saveScoreRef = useRef<
    ((score: number, taps: RecordedTap[], durMs: number) => Promise<void>) | null
  >(null);
  const endRunRef = useRef<((missed: boolean) => void) | null>(null);
  // Always holds the latest draw() so endRun (declared earlier) can paint one
  // final frozen-marker frame without a hook-ordering dependency on draw.
  const drawRef = useRef<((ctx: CanvasRenderingContext2D) => void) | null>(null);
  const bestScoreCacheRef = useRef<number | null>(null);
  // Latest resolved cosmetic theme — read by the (stable) draw/clickPin loops so
  // an equip change repaints without re-creating the animation callbacks.
  const themeRef = useRef<TumblerCosmeticTheme>(DEFAULT_TUMBLER_THEME);

  useEffect(() => {
    themeRef.current = tumblerTheme;
  }, [tumblerTheme]);

  // Paint a single frame right now (used to settle the frozen marker on a miss,
  // since the animation loop is cancelled the instant the run ends).
  const paintOnce = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas ? getGame2dContext(canvas, { alpha: false }) : null;
    if (!canvas || !ctx || !drawRef.current) return;
    ctx.save();
    ctx.scale(scaleRef.current, scaleRef.current);
    drawRef.current(ctx);
    ctx.restore();
  }, []);

  const fetchUserBestScore = useCallback(async () => {
    if (bestScoreCacheRef.current !== null) {
      setHighScore(bestScoreCacheRef.current);
      return;
    }
    try {
      const response = await fetch('/api/games/tumbler/score', {
        cache: 'no-store',
      });
      if (response.ok) {
        const data = await response.json();
        if (data.bestScore !== undefined) {
          setHighScore(data.bestScore);
          bestScoreCacheRef.current = data.bestScore;
        }
      }
    } catch (error) {
      console.error('Failed to fetch user best score:', error);
    }
  }, []);

  const loadWallet = useCallback(async () => {
    try {
      const response = await fetch('/api/store/inventory?gameType=tumbler', {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = (await response.json()) as InventoryCosmeticResponse;
      setWalletBalances({ credits: payload.wallet?.credits ?? 0 });
      setDailyCreditsProgress({
        earned: payload.dailyGameCredits?.earned ?? 0,
        cap: payload.dailyGameCredits?.cap ?? 300,
      });
      // Fold any equipped cosmetics onto the default Midway palette. Empty
      // loadout resolves byte-identically to DEFAULT_TUMBLER_THEME.
      setTumblerTheme(buildTumblerTheme(payload));
    } catch {
      /* wallet + theme are best-effort; default look stays in place */
    }
  }, []);

  const formatBanCountdown = (targetMs: number) => {
    const totalSeconds = Math.max(0, Math.floor((targetMs - banNowMs) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const saveScore = async (
    finalScore: number,
    taps: RecordedTap[],
    durationMs: number,
  ) => {
    if (isGuestRunRef.current) {
      setRunRewardMessage('Guest run — sign in to save scores and earn tickets.');
      setRunAccountXp(null);
      setRunRewardIsCapHit(false);
      return;
    }
    if (!sessionTokenRef.current) return;

    envMonitorRef.current.stop();
    setSubmitError(null);
    setRunRewardMessage(null);
    setRunAccountXp(null);
    setRunRewardIsCapHit(false);
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/games/tumbler/score', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: finalScore,
          sessionToken: sessionTokenRef.current,
          taps,
          clientDurationMs: Math.max(0, durationMs),
          env: envMonitorRef.current.getFingerprint(),
        }),
      });

      const rawText = await response.text();
      let data: Record<string, unknown> | null = null;
      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch {
        data = null;
      }
      if (!response.ok) {
        const errData = data as
          | { error?: string; details?: string; retryAfterSec?: number }
          | null;
        const reason = errData?.details || errData?.error || `HTTP ${response.status}`;
        console.error(`[Tumbler] Score rejected (${response.status}): ${reason}`);
        setSubmitError(getSubmitErrorMessage(response.status, errData));
        return;
      }

      captureRunResult(data);
      const reward = data?.reward as
        | {
            awardedCredits?: number;
            wantedCredits?: number;
            capRemaining?: number;
            earnedTodayTotal?: number;
            balanceAfter?: number;
            account?: AccountXpReward;
          }
        | undefined;
      if (reward) {
        setRunAccountXp(reward.account ?? null);
        const awardedCredits = Number(reward.awardedCredits ?? 0);
        const wantedCredits = Number(reward.wantedCredits ?? 0);
        const capRemaining = Number(reward.capRemaining ?? 0);
        const balanceAfter = Number(reward.balanceAfter);
        setWalletBalances((prev) => ({
          ...prev,
          credits: Number.isFinite(balanceAfter)
            ? Math.max(0, Math.floor(balanceAfter))
            : Math.max(
                0,
                prev.credits +
                  (Number.isFinite(awardedCredits) ? Math.max(0, awardedCredits) : 0),
              ),
        }));
        if (Number.isFinite(awardedCredits) && awardedCredits > 0) {
          setRunRewardMessage(`+${awardedCredits} tickets this run.`);
          setRunRewardIsCapHit(false);
        } else if (wantedCredits > 0 && capRemaining <= 0) {
          setRunRewardMessage('Daily ticket cap reached — no tickets this run.');
          setRunRewardIsCapHit(true);
        } else {
          setRunRewardMessage('No tickets this run.');
          setRunRewardIsCapHit(false);
        }
        if (
          Number.isFinite(Number(reward.earnedTodayTotal)) &&
          Number.isFinite(Number(reward.capRemaining))
        ) {
          const earned = Math.max(0, Number(reward.earnedTodayTotal));
          const cap = earned + Math.max(0, Number(reward.capRemaining));
          setDailyCreditsProgress({ earned, cap });
        }
      }

      setLeaderboardRefreshKey((prev) => prev + 1);
    } catch (error) {
      console.error('Failed to save score:', error);
      setSubmitError('Network error while saving your run. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  };
  saveScoreRef.current = saveScore;

  // Spawn a floating verdict plate (render-only). Reduced motion: it fades in place.
  const spawnLabel = useCallback((text: string, tone: CanvasCalloutTone, x: number, y: number) => {
    labelsRef.current.push({
      text: text.toLowerCase(),
      tone,
      x,
      y,
      life: 1,
    });
    if (labelsRef.current.length > 8) labelsRef.current.shift();
  }, []);

  // Spark burst at an angle on the ring (render-only, biased along the marker's
  // travel tangent so hits read as metal striking metal).
  const spawnSparks = useCallback((angle: number, dir: 1 | -1, count: number) => {
    if (reducedMotionRef.current) return;
    const c = themeRef.current;
    const nx = RING_CX + Math.cos(angle) * RING_RADIUS;
    const ny = RING_CY + Math.sin(angle) * RING_RADIUS;
    // Tangent of travel at the notch (direction the marker was moving).
    const tx = -Math.sin(angle) * dir;
    const ty = Math.cos(angle) * dir;
    for (let s = 0; s < count; s += 1) {
      const spread = (Math.random() - 0.5) * 2.4;
      const speed = 1.8 + Math.random() * 3.4;
      shardsRef.current.push({
        x: nx,
        y: ny,
        vx: tx * speed + Math.cos(angle) * spread,
        vy: ty * speed + Math.sin(angle) * spread,
        life: 1,
        size: 1.5 + Math.random() * 3,
        color:
          Math.random() < 0.4 ? '#fff6d8' : Math.random() < 0.5 ? c.notch : c.notchHit,
      });
    }
  }, []);

  // ── Advance to a new pin (deterministic from the seed). The marker always
  //    restarts at the top of the ring (angle 0) so the recorded `t` for the
  //    next click maps cleanly to a marker angle the server can reconstruct.
  //    (Sticky pins do NOT re-enter here between their two hits — one clock.) ──
  const spawnPin = useCallback((index: number) => {
    const seed = seedRef.current;
    if (seed === null) return;
    pinRef.current = tumblerPinFor(seed, index);
    pinStartRef.current = performance.now();
    markerAngleRef.current = 0;
  }, []);

  // ── End the run. `missed` distinguishes a fatal mis-tap (freeze marker, thud)
  //    from a defensive stop. The authoritative score is the server's replay of
  //    the tap log — we submit scoreRef, which mirrors the validator. ──
  const endRun = useCallback(
    (missed: boolean) => {
      if (gameStateRef.current !== 'playing') return;
      const durationMs = performance.now() - gameStartTimeRef.current;
      gameStateRef.current = 'gameover';
      setGameState('gameover');
      gameOverTimeRef.current = performance.now();
      if (missed) {
        missAngleRef.current = markerAngleRef.current;
        missFlashRef.current = 1;
        SoundManager.play(SFX.miss);
        window.setTimeout(() => SoundManager.play(SFX.rattle), 70);
        window.setTimeout(() => SoundManager.play(SFX.over), 320);
      } else {
        SoundManager.play(SFX.over);
      }
      // Keep the loop running briefly (gated in the shared frame runtime) so
      // the red flash, marker stagger, and sparks settle; then it self-cancels.
      if (scoreRef.current > highScore) setHighScore(scoreRef.current);
      saveScoreRef.current?.(scoreRef.current, tapsRef.current.slice(), durationMs);
      paintOnce();
    },
    [highScore, paintOnce],
  );
  endRunRef.current = endRun;

  // ── The single action: register a tap on the current pin. Every gameplay
  //    verdict comes from tumblerApplyTap — the EXACT function the server
  //    replays — so the on-screen outcome always matches the authoritative one. ──
  const clickPin = useCallback(() => {
    if (gameStateRef.current !== 'playing') return;
    const pin = pinRef.current;
    const seed = seedRef.current;
    if (!pin || seed === null) return;

    const now = performance.now();
    const t = Math.max(0, Math.floor(now - pinStartRef.current));

    // Record EVERY tap so the server sees the full log. If the defensive cap is
    // ever reached, the tap must not advance the local sim either — the server
    // can only replay taps it receives, and parity is sacred.
    if (tapsRef.current.length >= TUMBLER_MAX_TAPS - 2) return;
    tapsRef.current.push({ t });

    const { state, event } = tumblerApplyTap(seed, simRef.current, t);

    if (event.type === 'ignored') return; // under the cadence floor — no-op on both sides
    if (event.type === 'bounds') {
      endRunRef.current?.(false);
      return;
    }

    if (event.type === 'miss') {
      // Fatal. Freeze the marker + flash the missed target; near-misses get a
      // sympathetic "SO CLOSE" so the player knows they grazed the edge.
      missTargetRef.current = event.target;
      if (event.nearMiss) {
        const lx = RING_CX + Math.cos(event.target) * (RING_RADIUS + 40);
        const ly = RING_CY + Math.sin(event.target) * (RING_RADIUS + 40);
        spawnLabel('SO CLOSE', 'warning', lx, ly);
      }
      endRunRef.current?.(true);
      return;
    }

    // Hit — commit the new sim state.
    simRef.current = state;
    scoreRef.current = state.score;
    setScore(state.score);
    setPins(state.pins);
    hitFlashRef.current = 1;
    recoilRef.current = 1;
    SoundManager.play(SFX.click);

    const labelX = RING_CX + Math.cos(event.target) * (RING_RADIUS + 40);
    const labelY = RING_CY + Math.sin(event.target) * (RING_RADIUS + 40);
    spawnSparks(event.target, pin.dir, event.clean ? 10 : 6);

    if (event.stickyStage) {
      // First hit of a double-tap pin: the notch seats halfway, the second
      // target lights up, the marker keeps sweeping on the SAME clock.
      SoundManager.play(SFX.sticky);
      spawnLabel('1 OF 2', 'score', labelX, labelY);
      return;
    }

    // Pin fully set — verdict + escalating audio for clean streaks.
    if (!event.clean) {
      SoundManager.play(SFX.graze);
      spawnLabel(`GRAZE +${event.points}`, 'score', labelX, labelY);
    } else if (event.cleanStreak >= TUMBLER_CLEAN_STREAK_MIN) {
      SoundManager.play(SFX.streak);
      spawnLabel(
        `CLEAN ×${event.cleanStreak} +${event.points}`,
        'combo',
        labelX,
        labelY,
      );
      if (event.cleanStreak % 5 === 0) SoundManager.play(SFX.milestone);
    } else {
      SoundManager.play(SFX.clean);
      spawnLabel(`CLEAN +${event.points}`, 'score', labelX, labelY);
    }

    if (event.layerOpened) {
      // Macro-beat: a lock layer cracks open. Vault tiers turn, a shine sweeps
      // the dial, and a multi-clunk plays under the flourish.
      shineRef.current = 1;
      tierSpinTargetRef.current += Math.PI / TUMBLER_PINS_PER_LAYER;
      const layer = tumblerLayerFor(state.pins);
      spawnLabel(`LAYER ${layer} CRACKED`, 'combo', RING_CX, RING_CY - RING_RADIUS - 14);
      window.setTimeout(() => SoundManager.play(SFX.layerClunk), 0);
      window.setTimeout(() => SoundManager.play(SFX.layerClunk), 100);
      window.setTimeout(() => SoundManager.play(SFX.layerClunk), 200);
      window.setTimeout(() => SoundManager.play(SFX.layerOpen), 280);
    }

    if (state.pins >= TUMBLER_MAX_PINS) {
      endRunRef.current?.(false);
      return;
    }

    spawnPin(state.pinIndex);
  }, [spawnPin, spawnLabel, spawnSparks]);

  // ── One fixed step: advance the marker + decay the juice envelopes. ──
  const stepSim = useCallback(() => {
    const pin = pinRef.current;
    if (pin && gameStateRef.current === 'playing') {
      // Angle is derived from elapsed time (NOT integrated per-frame) so it stays
      // byte-identical to the server's `dir * speed * t`. This makes a dropped
      // frame or a tab-throttle harmless to fairness.
      const t = performance.now() - pinStartRef.current;
      markerAngleRef.current = tumblerMarkerAngle(pin, t);
    }
    if (hitFlashRef.current > 0) {
      hitFlashRef.current = Math.max(0, hitFlashRef.current - 0.08);
    }
    if (recoilRef.current > 0) {
      recoilRef.current = Math.max(0, recoilRef.current - 0.09);
    }
    if (shineRef.current > 0) {
      shineRef.current = Math.max(0, shineRef.current - 0.016);
    }
    if (missFlashRef.current > 0 && gameStateRef.current === 'gameover') {
      missFlashRef.current = Math.max(0, missFlashRef.current - 0.025);
    }
    // Ease the vault tiers toward their post-layer-open rotation.
    const spinDelta = tierSpinTargetRef.current - tierSpinRef.current;
    if (Math.abs(spinDelta) > 0.0005) {
      tierSpinRef.current += spinDelta * (reducedMotionRef.current ? 1 : 0.08);
    }
  }, []);

  // ── Render ──
  const draw = useCallback((ctx: CanvasRenderingContext2D) => {
    const c = themeRef.current;
    const now = performance.now();
    const state = gameStateRef.current;
    const sim = simRef.current;
    const pin = pinRef.current;
    const flash = hitFlashRef.current;
    const recoil = reducedMotionRef.current ? 0 : recoilRef.current;
    const layersOpen = tumblerLayerFor(sim.pins);

    // Lacquered-walnut frame + deco corners + recessed window (static).
    paintTumblerFrame(ctx, c);

    // The dial group takes a mechanical micro-pulse on recoil: a hard scale
    // snap that decays over a few frames (no easing in — it's a CLUNK).
    ctx.save();
    if (recoil > 0) {
      const s = 1 + recoil * 0.012;
      ctx.translate(RING_CX, RING_CY);
      ctx.scale(s, s);
      ctx.translate(-RING_CX, -RING_CY);
    }

    paintBrassDial(ctx, c, tierSpinRef.current, layersOpen);
    paintMarkerTrack(ctx, c);

    // Pin-set indicator rivets: one lamp per pin in the CURRENT layer, filling
    // as picks land; they all light for a beat when the layer cracks open.
    {
      let lit = sim.pins % TUMBLER_PINS_PER_LAYER;
      if (lit === 0 && sim.pins > 0 && shineRef.current > 0.4) {
        lit = TUMBLER_PINS_PER_LAYER;
      }
      for (let i = 0; i < TUMBLER_PINS_PER_LAYER; i += 1) {
        const a = -Math.PI / 2 + (i / TUMBLER_PINS_PER_LAYER) * Math.PI * 2;
        const lx = RING_CX + Math.cos(a) * LAMP_RADIUS;
        const ly = RING_CY + Math.sin(a) * LAMP_RADIUS;
        // Drilled seat.
        ctx.fillStyle = c.brassGroove;
        ctx.beginPath();
        ctx.arc(lx, ly, 6.5, 0, Math.PI * 2);
        ctx.fill();
        if (i < lit) {
          // Gold dome — a set pin.
          const dome = ctx.createRadialGradient(lx - 2, ly - 2, 1, lx, ly, 6);
          dome.addColorStop(0, c.notchHi);
          dome.addColorStop(0.55, c.notch);
          dome.addColorStop(1, c.notchEdge);
          ctx.fillStyle = dome;
          ctx.beginPath();
          ctx.arc(lx, ly, 5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Empty machined hole with a top shadow.
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.beginPath();
          ctx.arc(lx, ly, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,246,210,0.22)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(lx, ly + 0.6, 4.4, Math.PI * 0.15, Math.PI * 0.85);
          ctx.stroke();
        }
      }
    }

    // The lit gold NOTCH(es). Sticky pins show both targets: the active one
    // pulses; the waiting second target sits dim + dashed until armed.
    if (pin && (state === 'playing' || state === 'gameover')) {
      const half = pin.window;
      const pulse = reducedMotionRef.current
        ? 0.5
        : 0.5 + 0.5 * Math.sin(now * 0.008);
      if (pin.sticky) {
        if (sim.stage === 0) {
          paintNotch(ctx, c, pin.notch, half, 'active', pulse, flash);
          paintNotch(ctx, c, pin.notch2, half, 'armed', pulse, 0);
        } else {
          paintNotch(ctx, c, pin.notch, half * 0.7, 'set', pulse, 0);
          paintNotch(ctx, c, pin.notch2, half, 'active', pulse, flash);
        }
      } else {
        paintNotch(ctx, c, pin.notch, half, 'active', pulse, flash);
      }

      // Fatal-miss feedback: the missed target flashes enamel-red and cools.
      const missFlash = missFlashRef.current;
      if (state === 'gameover' && missFlash > 0 && missTargetRef.current !== null) {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineWidth = RING_THICKNESS - 4;
        ctx.strokeStyle = c.enamelRed;
        ctx.globalAlpha = Math.min(0.85, missFlash);
        ctx.beginPath();
        ctx.arc(
          RING_CX,
          RING_CY,
          RING_RADIUS,
          missTargetRef.current - half,
          missTargetRef.current + half,
        );
        ctx.stroke();
        ctx.restore();
      }
    }

    // Sparks (render-only flash) — drawn under the marker.
    const shards = shardsRef.current;
    for (let i = shards.length - 1; i >= 0; i -= 1) {
      const sh = shards[i]!;
      sh.life -= 0.05;
      sh.x += sh.vx;
      sh.y += sh.vy;
      sh.vy += 0.18;
      if (sh.life <= 0) {
        shards.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = Math.max(0, sh.life);
      ctx.fillStyle = sh.color;
      ctx.fillRect(sh.x - sh.size / 2, sh.y - sh.size / 2, sh.size, sh.size);
    }
    ctx.globalAlpha = 1;

    // The orbiting enamel-red MARKER bead + a fading motion trail. On game-over
    // it freezes at the miss angle (with a brief mechanical stagger) so the
    // player sees exactly where the bad tap landed.
    // While playing, recompute from wall-clock every paint frame so ProMotion /
    // 120 Hz panels get a smooth sweep (angle is time-derived, not stepped).
    if (pin && (state === 'playing' || state === 'gameover')) {
      let angle: number;
      if (state === 'gameover' && missAngleRef.current !== null) {
        angle = missAngleRef.current;
      } else {
        const t = Math.max(0, now - pinStartRef.current);
        angle = tumblerMarkerAngle(pin, t);
        markerAngleRef.current = angle;
      }
      if (
        state === 'gameover' &&
        missAngleRef.current !== null &&
        !reducedMotionRef.current &&
        missFlashRef.current > 0
      ) {
        // Stagger: the jammed marker rattles in place and settles.
        angle += Math.sin(now * 0.09) * 0.03 * missFlashRef.current;
      }
      // Motion trail: ghost beads along the recent sweep (render-only).
      if (state === 'playing' && !reducedMotionRef.current) {
        for (let k = 1; k <= 7; k += 1) {
          const ga = angle - pin.dir * pin.speed * k * 0.016;
          const gx = RING_CX + Math.cos(ga) * RING_RADIUS;
          const gy = RING_CY + Math.sin(ga) * RING_RADIUS;
          ctx.globalAlpha = 0.26 * (1 - k / 8);
          ctx.fillStyle = c.marker;
          ctx.beginPath();
          ctx.arc(gx, gy, MARKER_R * (0.8 - k * 0.08), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      const mx = RING_CX + Math.cos(angle) * RING_RADIUS;
      const my = RING_CY + Math.sin(angle) * RING_RADIUS;
      // Optional, OFF-by-default marker glow (dial-slot cosmetic effect): a soft
      // halo trailing the bead. Default loadout never enables this.
      if (c.dialGlowEnabled && state === 'playing' && !reducedMotionRef.current) {
        ctx.save();
        ctx.shadowColor = c.dialGlowColor;
        ctx.shadowBlur = 22;
        ctx.fillStyle = c.dialGlowColor;
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.arc(mx, my, MARKER_R * 0.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      // Hard offset shadow.
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.arc(mx + 2, my + 3, MARKER_R, 0, Math.PI * 2);
      ctx.fill();
      // Glossy enamel body — radial gradient lit from the upper-left.
      const bead = ctx.createRadialGradient(
        mx - MARKER_R * 0.4,
        my - MARKER_R * 0.5,
        MARKER_R * 0.15,
        mx,
        my,
        MARKER_R * 1.15,
      );
      bead.addColorStop(0, c.markerHi);
      bead.addColorStop(0.45, c.marker);
      bead.addColorStop(1, c.markerEdge);
      ctx.fillStyle = bead;
      ctx.beginPath();
      ctx.arc(mx, my, MARKER_R, 0, Math.PI * 2);
      ctx.fill();
      // Tight specular dot.
      ctx.fillStyle = 'rgba(255,255,255,0.78)';
      ctx.beginPath();
      ctx.arc(mx - MARKER_R * 0.34, my - MARKER_R * 0.4, MARKER_R / 4, 0, Math.PI * 2);
      ctx.fill();
      // Dark enamel ring.
      ctx.lineWidth = 2;
      ctx.strokeStyle = c.markerEdge;
      ctx.beginPath();
      ctx.arc(mx, my, MARKER_R - 0.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Layer-open shine: a bright machined-glint wedge sweeping the dial face
    // once (suppressed on reduced motion — the lamps + tier ticks still tell).
    const shine = shineRef.current;
    if (shine > 0 && !reducedMotionRef.current) {
      const sweepA = -Math.PI / 2 + (1 - shine) * Math.PI * 2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(RING_CX, RING_CY, RING_RADIUS - RING_THICKNESS / 2 - 4, 0, Math.PI * 2);
      ctx.clip();
      ctx.globalAlpha = 0.28 * Math.min(1, shine * 2);
      ctx.fillStyle = '#fff6d8';
      ctx.beginPath();
      ctx.moveTo(RING_CX, RING_CY);
      ctx.arc(RING_CX, RING_CY, RING_RADIUS, sweepA - 0.32, sweepA + 0.32);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.restore(); // recoil transform

    // Engraved center readout: SCORE headline, layer + double-pin status lines.
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const scoreText = state === 'idle' ? '0' : scoreRef.current.toString();
    ctx.font =
      "800 40px var(--font-mono-arcade, 'Spline Sans Mono'), ui-monospace, monospace";
    ctx.fillStyle = 'rgba(8,7,4,0.55)';
    ctx.fillText(scoreText, RING_CX + 1.5, RING_CY + 3.5);
    ctx.fillStyle = c.cream;
    ctx.fillText(scoreText, RING_CX, RING_CY + 2);
    ctx.font =
      "700 10px var(--font-mono-arcade, 'Spline Sans Mono'), ui-monospace, monospace";
    ctx.fillStyle = 'rgba(36,26,11,0.8)';
    ctx.fillText('SCORE', RING_CX, RING_CY - 26);
    ctx.font =
      "700 9px var(--font-mono-arcade, 'Spline Sans Mono'), ui-monospace, monospace";
    if (pin?.sticky && state === 'playing') {
      ctx.fillStyle = c.enamelAmber;
      ctx.fillText(sim.stage === 0 ? 'DOUBLE PIN' : 'ONCE MORE!', RING_CX, RING_CY + 28);
    } else {
      ctx.fillStyle = 'rgba(36,26,11,0.8)';
      ctx.fillText(`LAYER ${layersOpen + 1}`, RING_CX, RING_CY + 28);
    }
    // Hot-streak engraving on the dial face (between the vault tiers).
    if (state === 'playing' && sim.cleanStreak >= TUMBLER_CLEAN_STREAK_MIN) {
      ctx.font =
        "800 12px var(--font-mono-arcade, 'Spline Sans Mono'), ui-monospace, monospace";
      ctx.fillStyle = c.notchHi;
      ctx.fillText(`CLEAN ×${sim.cleanStreak}`, RING_CX, RING_CY - 94);
    }
    ctx.restore();

    // Floating verdict plates (topmost).
    const labels = labelsRef.current;
    const calloutLook = readCanvasCalloutLook(ctx.canvas);
    for (let i = labels.length - 1; i >= 0; i -= 1) {
      const lb = labels[i]!;
      lb.life -= 0.022;
      if (lb.life <= 0) {
        labels.splice(i, 1);
        continue;
      }
      drawCanvasCallout(ctx, calloutLook, {
        text: lb.text,
        x: lb.x,
        y: lb.y,
        u: 1 - lb.life,
        tone: lb.tone,
        reducedMotion: reducedMotionRef.current,
        within: { left: 0, top: 0, right: BASE_WIDTH, bottom: BASE_HEIGHT },
      });
    }
  }, []);
  drawRef.current = draw;

  const startGame = useCallback(async () => {
    resetRunResult();
    if (isStartingRef.current) return;
    isStartingRef.current = true;
    isGuestRunRef.current = false;
    sessionTokenRef.current = null;
    seedRef.current = null;
    setIsStartingSession(true);
    setSubmitError(null);
    setStartError(null);
    setRunRewardMessage(null);
    setRunAccountXp(null);
    setRunRewardIsCapHit(false);

    let sessionSuccess = false;
    try {
      const sessionResponse = await fetch('/api/games/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameType: 'tumbler' }),
      });
      if (sessionResponse.ok) {
        setBanIndefinite(false);
        setBanUntilMs(null);
        const sessionData = await sessionResponse.json();
        sessionTokenRef.current = sessionData.token;
        seedRef.current =
          typeof sessionData.tumblerSeed === 'number'
            ? sessionData.tumblerSeed
            : null;
        if (seedRef.current === null) {
          setGameState('error');
          gameStateRef.current = 'error';
          setStartError('The game could not start a valid run. Try again.');
          isStartingRef.current = false;
          setIsStartingSession(false);
          return;
        }
        envMonitorRef.current.start();
        sessionSuccess = true;
      } else if (sessionResponse.status === 401) {
        // Guest run — local seed, scores not saved (mirrors other solo games).
        sessionTokenRef.current = null;
        seedRef.current = Math.floor(Math.random() * 0x7fffffff) >>> 0;
        isGuestRunRef.current = true;
        setBanIndefinite(false);
        setBanUntilMs(null);
        sessionSuccess = true;
      } else {
        const data = await sessionResponse.json().catch(() => null);
        console.error('Failed to start game session', data);
        if (sessionResponse.status === 403) {
          setBanIndefinite(Boolean(data?.isIndefinite));
          setBanUntilMs(
            typeof data?.retryAfterSec === 'number'
              ? Date.now() + data.retryAfterSec * 1000
              : null,
          );
        } else {
          setBanIndefinite(false);
          setBanUntilMs(null);
        }
        setStartError(getSubmitErrorMessage(sessionResponse.status, data));
      }
    } catch (error) {
      console.error('Failed to start game session:', error);
      setStartError('Network error while starting the run. Try again.');
    } finally {
      isStartingRef.current = false;
      setIsStartingSession(false);
    }

    if (!sessionSuccess || (!sessionTokenRef.current && !isGuestRunRef.current)) {
      setGameState('error');
      gameStateRef.current = 'error';
      return;
    }

    // Reset run state.
    frameLoopRef.current?.destroy();
    frameLoopRef.current = null;
    simRef.current = tumblerInitialState();
    scoreRef.current = 0;
    setScore(0);
    setPins(0);
    tapsRef.current = [];
    shardsRef.current = [];
    labelsRef.current = [];
    hitFlashRef.current = 0;
    recoilRef.current = 0;
    shineRef.current = 0;
    missFlashRef.current = 0;
    tierSpinRef.current = 0;
    tierSpinTargetRef.current = 0;
    missAngleRef.current = null;
    missTargetRef.current = null;
    gameStartTimeRef.current = performance.now();
    spawnPin(0);
    gameStateRef.current = 'playing';
    setGameState('playing');
    SoundManager.play(SFX.start);

    frameLoopRef.current = createGameFrameLoop({
      stepMs: FRAME_TIME,
      simulate: () => stepSim(),
      render: () => {
        paintOnce();
        const settling =
          gameStateRef.current === 'gameover' &&
          (shardsRef.current.length > 0 ||
            labelsRef.current.length > 0 ||
            missFlashRef.current > 0.01 ||
            shineRef.current > 0.01);
        if (gameStateRef.current !== 'playing' && !settling) {
          frameLoopRef.current?.stop();
        }
      },
    });
    frameLoopRef.current.start();
  }, [paintOnce, resetRunResult, spawnPin, stepSim]);

  // ── Generic "primary action": tap the pin while playing; start / restart
  //    otherwise (with a short grace after game-over to avoid a mis-fire). ──
  const primaryAction = useCallback(() => {
    const current = gameStateRef.current;
    if (current === 'playing') {
      clickPin();
    } else if (current === 'idle' || current === 'error') {
      startGame();
    } else if (current === 'gameover') {
      const since = performance.now() - gameOverTimeRef.current;
      if (since >= RESTART_GRACE_PERIOD) startGame();
    }
  }, [clickPin, startGame]);

  // ── Input: Space/Enter/click/tap. While playing these click the pin; from an
  //    overlay they start / restart. ──
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'Space' || e.code === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (gameStateRef.current === 'playing') setTapPressed(true);
        primaryAction();
      }
    },
    [primaryAction],
  );

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    if (e.code === 'Space' || e.code === 'Enter' || e.key === ' ') {
      setTapPressed(false);
    }
  }, []);

  // Pointer on the stage (canvas + overlay) is the primary tap surface.
  const handleStagePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (gameStateRef.current === 'playing') setTapPressed(true);
      primaryAction();
    },
    [primaryAction],
  );

  const handleStagePointerUp = useCallback(() => {
    setTapPressed(false);
  }, []);

  // ── Effects ──
  useEffect(() => {
    const monitor = envMonitorRef.current;
    return () => {
      frameLoopRef.current?.destroy();
      frameLoopRef.current = null;
      monitor.stop();
    };
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  // Reduced-motion preference (decorative juice only — the orbit itself is the
  // game and must keep moving).
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      reducedMotionRef.current = mq.matches;
    };
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Responsive sizing — the lock fills the wide stage.
  useEffect(() => {
    const updateSize = () => {
      const container = containerRef.current;
      if (!container) return;
      const reservedVertical = window.innerHeight < 700 ? 220 : 280;
      const maxWidth = Math.min(window.innerWidth - 24, 940);
      const maxHeight = Math.min(window.innerHeight - reservedVertical, BASE_HEIGHT);
      const scale = Math.min(maxWidth / BASE_WIDTH, maxHeight / BASE_HEIGHT, 1.25);
      const cssWidth = Math.floor(BASE_WIDTH * scale);
      const cssHeight = Math.floor(BASE_HEIGHT * scale);
      const dpr = gameCanvasDpr(cssWidth, cssHeight);
      scaleRef.current = scale * dpr;
      setCanvasSize({
        width: cssWidth,
        height: cssHeight,
        dpr,
      });
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Idle render whenever size/best changes and we're not actively looping.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas ? getGame2dContext(canvas, { alpha: false }) : null;
    if (!canvas || !ctx) return;
    if (gameStateRef.current === 'playing') return;
    ctx.save();
    ctx.scale(scaleRef.current, scaleRef.current);
    draw(ctx);
    ctx.restore();
  }, [canvasSize, draw, tumblerTheme]);

  useEffect(() => {
    fetchUserBestScore();
  }, [fetchUserBestScore]);

  useEffect(() => {
    void loadWallet();
  }, [loadWallet]);

  useEffect(() => {
    const handleInventoryUpdate = () => {
      void loadWallet();
    };
    window.addEventListener('store-inventory-updated', handleInventoryUpdate);
    return () =>
      window.removeEventListener('store-inventory-updated', handleInventoryUpdate);
  }, [loadWallet]);

  useEffect(() => {
    const timer = window.setInterval(() => setBanNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!banUntilMs) return;
    if (banNowMs >= banUntilMs) {
      setBanUntilMs(null);
      setBanIndefinite(false);
    }
  }, [banNowMs, banUntilMs]);

  const walletCard = {
    credits: walletBalances.credits,
    progress: {
      label: 'Daily tickets',
      current: dailyCreditsProgress.earned,
      max: dailyCreditsProgress.cap,
    },
  };

  const isPlaying = gameState === 'playing';

  return (
    <div className="tumbler-midway arc-game-flow">
      <div className="w-full space-y-3 sm:space-y-4">
        <div className="mx-auto w-full max-w-5xl">
          <div className="hidden sm:block">
            <PageHeader
              eyebrow="Arcade"
              icon={<LockKeyhole aria-hidden className="h-6 w-6" />}
              title="Tumbler"
              subtitle="Crack the safe — tap as the marker crosses the gold notch. Dead-center CLEAN PICKS pay extra, and every 5 pins opens a lock layer."
              wallet={walletCard}
            />
          </div>
          <div className="sm:hidden">
            <GamesWalletCard wallet={walletCard} compact />
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3 px-1">
          <span className="arcade-num text-sm text-body sm:text-base">
            Score <span className="font-semibold text-strong">{score}</span>
          </span>
          <span className="arcade-num text-sm text-body sm:text-base">
            Pins <span className="font-semibold text-strong">{pins}</span>
          </span>
          <span className="arcade-num text-sm text-body sm:text-base">
            Best <span className="font-semibold text-strong">{highScore}</span>
          </span>
        </div>

        <div ref={containerRef} className="relative touch-none flex justify-center">
          <div
            className="tumbler-stage relative"
            style={{ width: canvasSize.width, height: canvasSize.height }}
          >
            <canvas
              ref={canvasRef}
              width={Math.floor(canvasSize.width * canvasSize.dpr)}
              height={Math.floor(canvasSize.height * canvasSize.dpr)}
              onPointerDown={handleStagePointerDown}
              onPointerUp={handleStagePointerUp}
              onPointerLeave={handleStagePointerUp}
              className="block cursor-pointer rounded-well border-2 border-ink"
              style={{
                touchAction: 'none',
                width: canvasSize.width,
                height: canvasSize.height,
              }}
            />

            {!isPlaying && (
              <div
                className="tumbler-overlay absolute inset-0 flex touch-none flex-col items-center justify-center rounded-well px-4"
                style={{
                  background:
                    'color-mix(in srgb, var(--scrim) 78%, transparent)',
                }}
                onPointerDown={handleStagePointerDown}
              >
                {gameState === 'idle' && (
                  <>
                    <LockKeyhole size={56} className="mb-4 text-tickets-text" />
                    <h1 className="arcade-display mb-2 text-center text-2xl text-strong uppercase sm:text-3xl">
                      Tumbler
                    </h1>
                    <p className="mb-2 text-center text-sm text-strong sm:text-base">
                      {isStartingSession
                        ? 'Starting your run…'
                        : touchDevice
                          ? 'Tap anywhere to start'
                          : 'Press Space or click to start'}
                    </p>
                    <p className="max-w-xs text-center text-xs text-body sm:text-sm">
                      Tap the instant the red marker crosses the gold notch.
                      Dead-center = CLEAN PICK (2pts, 3 on a hot streak); edge
                      graze = 1. Watch for rare double-tap pins. One bad tap
                      jams the lock.
                    </p>
                  </>
                )}

                {gameState === 'gameover' && (
                  <>
                    <h2 className="arcade-display mb-2 text-2xl text-strong uppercase sm:text-3xl">
                      Lock jammed
                    </h2>
                    <p className="mb-1 text-xl text-strong sm:text-2xl">
                      Score{' '}
                      <span className="arcade-num font-semibold">{score}</span>{' '}
                      <span className="text-base text-body sm:text-lg">
                        ({pins} {pins === 1 ? 'pin' : 'pins'})
                      </span>
                    </p>
                    <p className="mb-4 text-base text-body sm:text-lg">
                      Best <span className="arcade-num">{highScore}</span>
                    </p>
                    <ArcadeRunRewards reward={runResult.reward} achievements={runResult.achievements} saving={isSubmitting} error={submitError} guest={runRewardMessage?.startsWith('Guest run')} className="mb-4 max-w-xs" />
                    <p className="text-center text-sm text-body sm:text-base">
                      {touchDevice
                        ? 'Tap to play again'
                        : 'Press Space to play again'}
                    </p>
                  </>
                )}

                {gameState === 'error' && (
                  <>
                    <h2 className="arcade-display mb-2 text-2xl text-danger-text uppercase sm:text-3xl">
                      Could not start
                    </h2>
                    <p className="mb-4 text-center text-sm text-strong sm:text-base">
                      {startError ?? 'The game could not reach the server.'}
                    </p>
                    {(banIndefinite || banUntilMs) && (
                      <p className="mb-2 text-center text-xs text-tickets-text sm:text-sm">
                        {banIndefinite
                          ? 'You are banned from games until an admin unbans you.'
                          : `Ban time left: ${formatBanCountdown(banUntilMs!)}`}
                      </p>
                    )}
                    <p className="text-center text-sm text-body sm:text-base">
                      Tap or press Space to retry
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* The one button: a big cream TAP keycap. It IS the control on touch and
            a clear affordance on desktop; the canvas/overlay also accept taps. */}
        <div className="mt-3 flex w-full justify-center">
          <button
            type="button"
            className="tumbler-tap"
            data-pressed={tapPressed ? 'true' : undefined}
            aria-label={isPlaying ? 'Pick the pin' : 'Start'}
            onPointerDown={handleStagePointerDown}
            onPointerUp={handleStagePointerUp}
            onPointerLeave={handleStagePointerUp}
          >
            <LockKeyhole aria-hidden size={20} />
            {isPlaying ? 'Pick' : 'Tap'}
          </button>
        </div>

        <p className="mt-3 text-center text-xs text-faint sm:text-sm">
          {touchDevice ? (
            'Tap anywhere to pick the pin'
          ) : (
            <>
              Pick with{' '}
              <kbd className="arcade-card-inset px-2 py-1 text-strong">Space</kbd>{' '}
              or click
            </>
          )}
        </p>

        <div className="mt-2 flex flex-col items-center gap-3 sm:mt-4 sm:gap-4">
          <div className="flex w-full flex-wrap items-center justify-center gap-2 pb-1 sm:gap-4">
            <GameLeaderboardButton
              onClick={(e) => {
                e.stopPropagation();
                setShowLeaderboard(true);
              }}
              className="h-10 shrink-0 px-3 py-0 text-xs sm:text-sm"
            />
            <MuteButton />
            <div className="relative inline-flex items-center gap-1.5">
              <ArcadeButton
                tone="ghost"
                size="icon"
                className="peer"
                aria-label="Show rewards hint"
                aria-expanded={showRewardsHint}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onTouchStart={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setShowRewardsHint((prev) => !prev);
                }}
              >
                <CircleHelp size={18} />
              </ArcadeButton>
              <span
                className={`pointer-events-none absolute right-0 bottom-full z-20 mb-2 w-[calc(100vw-2rem)] max-w-sm arcade-card-inset px-3 py-2 text-left text-xs leading-relaxed text-body transition-opacity duration-150 sm:w-80 ${
                  showRewardsHint
                    ? 'opacity-100'
                    : 'opacity-0 peer-hover:opacity-100 peer-focus:opacity-100'
                }`}
              >
                {REWARDS_HINT_TEXT}
              </span>
            </div>
          </div>
        </div>
      </div>

      <GameLeaderboardModal
        open={showLeaderboard}
        onOpenChange={setShowLeaderboard}
        title="Tumbler board"
        description="Highest pick score in a single run, and your rank."
      >
        <GameLeaderboard
          gameType="tumbler"
          maxEntries={5}
          enableFullLeaderboardModal
          fullLeaderboardDisplay="inline"
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>
    </div>
  );
}
