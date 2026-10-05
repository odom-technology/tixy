'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import {
  TABLE_WIDTH,
  TABLE_HEIGHT,
  BALL_RADIUS,
  CUSHION_WIDTH,
  POCKETS,
  CORNER_THROAT_RADIUS,
  SIDE_THROAT_RADIUS,
  CORNER_MOUTH_HALF,
  SIDE_MOUTH_HALF,
  HEAD_STRING_X,
  FOOT_SPOT,
  BALL_COLORS,
  BALL_DIAMETER,
  MAX_POWER,
  simulateShot,
  type Ball,
  type ShotInput,
  type SoundEvent,
  type Vec2,
} from '@/features/arcade/lib/pool-physics';
import {
  CUE_BALL_LAUNCH_DELAY_MS,
  CUE_STRIKE_TOTAL_MS,
  POCKET_ANIMATION_MS,
  POCKET_FLASH_MS,
} from './_pool-ui-constants';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import {
  createGameFrameLoop,
  gameCanvasDpr,
} from '@/features/arcade/lib/game-frame-loop';
import type { HitStop, ShakeOffset } from '@/features/arcade/lib/game-feel';
import { useFeelReducedMotion } from '@/features/arcade/lib/use-game-feedback';

const RAIL_WIDTH = CUSHION_WIDTH;
const PHYSICS_FPS = 60;
const PHYSICS_FRAME_MS = 1000 / PHYSICS_FPS;

// Overhead light position (table-space coordinates) for ball specular highlights.
// Matches the existing tableGlow radial gradient center.
const LIGHT_X = TABLE_WIDTH * 0.40;
const LIGHT_Y = TABLE_HEIGHT * 0.35;

type PocketAnimation = {
  ballId: number;
  startPos: Vec2;
  pocketPos: Vec2;
  startTime: number;
  durationMs: number;
};

type PocketFlash = {
  pocketPos: Vec2;
  startTime: number;
  durationMs: number;
};

/** A short warm spark where a ball strikes a cushion (decorative juice). */
type CushionFlash = {
  pos: Vec2;
  startTime: number;
  durationMs: number;
  strength: number;
};

const CUSHION_FLASH_MS = 220;

/** A box at least this much taller than wide gets the table turned upright,
 *  head string at the bottom, so a phone held upright shows bigger balls. */
const UPRIGHT_MIN_RATIO = 1.15;
/** The rack: every object ball within this distance of the foot spot. */
const RACK_CHECK_RADIUS = BALL_DIAMETER * 5;

/** Presentation-only events from a shot animation. They follow the frames
 *  simulateShot already produced, so nothing here can change a result. */
export type PoolFeelEvent =
  | { type: 'strike'; power: number; isBreak: boolean }
  | { type: 'impact'; power: number; isBreak: boolean }
  | { type: 'pot'; ballId: number };

export type PoolCanvasFeel = {
  /** Hit-stop clock from useGameFeedback. The animation clock pauses while
   *  it is frozen; paint keeps running so the shake shows. */
  hitStop?: HitStop;
  /** Shake offset in CSS px from useGameFeedback, added to the camera. */
  shakeOffset?: (now: number) => ShakeOffset;
  onEvent?: (event: PoolFeelEvent) => void;
};

/** True when the balls are a full rack (the break is next). */
export function isRackedTable(balls: Ball[]): boolean {
  let count = 0;
  for (const ball of balls) {
    if (ball.id === 0) continue;
    if (ball.pocketed) return false;
    const dx = ball.pos.x - FOOT_SPOT.x;
    const dy = ball.pos.y - FOOT_SPOT.y;
    if (dx * dx + dy * dy > RACK_CHECK_RADIUS * RACK_CHECK_RADIUS) return false;
    count += 1;
  }
  return count === 15;
}

/** Number face for ball digits: the page's number font when it has one. */
let ballNumberFont: string | null = null;
function getBallNumberFont(): string {
  if (ballNumberFont) return ballNumberFont;
  if (typeof document === 'undefined') return 'sans-serif';
  const value = getComputedStyle(document.documentElement).getPropertyValue('--tixy-font-num').trim();
  ballNumberFont = value || 'sans-serif';
  return ballNumberFont;
}

/**
 * Client-side rolling state for the 2D rotation fake. `phase` is the
 * accumulated roll angle of the stripe pole axis (radians of surface travel
 * over BALL_RADIUS), tracked in the plane spanned by the view axis and the
 * motion direction. `dirX/dirY` is the smoothed motion direction the roll is
 * projected along. Initialised so the first frame matches the static render
 * (stripe band across the center, number disk facing the viewer).
 */
type BallRollState = {
  phase: number;
  dirX: number;
  dirY: number;
  lastX: number;
  lastY: number;
};

/** Half-width of the stripe band as sin of its angular half-width (matches
 *  the static band height of 0.92 * r). */
const STRIPE_SIN_B = 0.46;
const STRIPE_COS_B = Math.sqrt(1 - STRIPE_SIN_B * STRIPE_SIN_B);
/** Samples per stripe-cap edge circle when building the rolled band path. */
const STRIPE_EDGE_SAMPLES = 30;

type CueRenderState = {
  angle: number;
  power: number;
  cuePos: Vec2;
  progress?: number;
  opacity?: number;
  /** Override cue colors for this specific cue (e.g. opponent's skin). */
  cueColor?: string;
  cueTipColor?: string;
  cueGlow?: boolean;
  cueGlowColor?: string;
};

export type PoolCosmeticTheme = {
  feltColor: string;
  feltDark: string;
  railColor: string;
  railBorder: string;
  pocketColor: string;
  cueColor: string;
  cueTipColor: string;
  cueGlow: boolean;
  cueGlowColor: string;
  /** Optional per-ball color overrides keyed by ball ID (1-15). */
  ballColors?: Record<number, string>;
  /** A skin set (SKINS.md): the rail's material, the balls' finish (its
   *  signature shape) and the sight colour. Absent for the house look and
   *  older skins. Ball size, pockets and physics never change. */
  skin?: PoolSkinLook | null;
};

export type PoolSkinLook = {
  material: 'walnut' | 'maple' | 'ink' | 'brass' | 'enamel';
  finish: 'gloss' | 'flat' | 'pearl' | 'ringed';
  sight: string;
  railEdge: string;
};

// Midway default look: the felt reads as a recessed enamel-prize well sunk
// into a warm lacquered-wood cabinet frame. Felt stays in the prize-teal/green
// family (a believable pool cloth that also belongs to the Midway palette);
// rails are espresso cabinet wood matching --surface-raised / --key-side.
// Skins still override every field via the inventory pipeline in page.tsx.
export const DEFAULT_POOL_THEME: PoolCosmeticTheme = {
  feltColor: '#2e7566',
  feltDark: '#245e52',
  railColor: '#2b2119',
  railBorder: '#0f0a06',
  pocketColor: '#0c0907',
  cueColor: '#f0e2c2',
  cueTipColor: '#6b5631',
  cueGlow: false,
  cueGlowColor: '#f6eddc',
};

/** Per-cue cosmetic overrides passed alongside shots (bot/opponent skins). */
export type CueThemeOverride = {
  cueColor: string;
  cueTipColor: string;
  cueGlow: boolean;
  cueGlowColor: string;
};

export type PoolReplayOverlay = {
  topLeftLines?: string[];
  topRightLines?: string[];
  powerRatio?: number | null;
  spin?: { x: number; y: number } | null;
};

type PoolCanvasProps = {
  balls: Ball[];
  theme?: PoolCosmeticTheme;
  animateShot?: ShotInput | null;
  animationSpeed?: number;
  muteAnimationSound?: boolean;
  replayOverlay?: PoolReplayOverlay | null;
  /** Override starting balls for the next animation (bypasses React state propagation).
   *  Used for chained bot shots where React state may not have propagated yet. */
  animBallsOverride?: Ball[] | null;
  /** Cue skin to use for the animated shot (opponent/bot). Falls back to theme. */
  animShotCueTheme?: CueThemeOverride | null;
  onAnimationEnd?: (finalBalls: Ball[]) => void;
  aimGuideEmphasis?: number;
  aimLine?: { start: Vec2; end: Vec2 } | null;
  aimPath?: Vec2[] | null;
  ghostBall?: Vec2 | null;
  targetLine?: { start: Vec2; end: Vec2 } | null;
  cueStick?: { angle: number; power: number; cuePos: Vec2 } | null;
  /** Show a spin indicator dot on the cue ball during aiming. */
  spinIndicator?: { x: number; y: number } | null;
  /** Predicted cue ball direction after first contact (for position play). */
  cueDeflectionLine?: { start: Vec2; end: Vec2 } | null;
  ballInHandPreview?: Vec2 | null;
  ballInHandValid?: boolean;
  ballInHandRestrictedToHeadString?: boolean;
  highlightBallIds?: number[];
  /** Fit the table inside this box (CSS px) instead of the window. A tall
   *  box turns the table upright. The game shell's stage passes its size. */
  fitBox?: { width: number; height: number } | null;
  feel?: PoolCanvasFeel | null;
  /** Classes for the canvas element. */
  canvasClassName?: string;
  onCanvasInteraction?: (tablePos: Vec2, pointerType?: string) => void;
  onCanvasMove?: (tablePos: Vec2) => void;
  onCanvasRelease?: () => void;
  onCanvasCancel?: () => void;
};

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function cloneBall(ball: Ball): Ball {
  return {
    id: ball.id,
    pos: { x: ball.pos.x, y: ball.pos.y },
    vel: { x: ball.vel.x, y: ball.vel.y },
    pocketed: ball.pocketed,
  };
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.max(0, Math.min(radius, width * 0.5, height * 0.5));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawOverlayPanel(
  ctx: CanvasRenderingContext2D,
  linesInput: string[] | undefined,
  opts: {
    x: number;
    y: number;
    align: 'left' | 'right';
    maxWidth: number;
    dpr: number;
  },
) {
  const lines = (linesInput ?? [])
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 8);
  if (!lines.length) return;

  const fontSize = Math.round(11.5 * opts.dpr);
  const lineHeight = Math.round(15 * opts.dpr);
  const padX = Math.round(10 * opts.dpr);
  const padY = Math.round(8 * opts.dpr);
  const minWidth = Math.round(152 * opts.dpr);
  const radius = Math.round(9 * opts.dpr);

  ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
  ctx.textBaseline = 'top';

  let widest = 0;
  for (const line of lines) {
    widest = Math.max(widest, ctx.measureText(line).width);
  }

  const panelWidth = Math.min(opts.maxWidth, Math.max(minWidth, widest + padX * 2));
  const panelHeight = padY * 2 + lineHeight * lines.length;
  const panelX = opts.align === 'right' ? opts.x - panelWidth : opts.x;

  // Midway wooden info plate: dark lacquer fill, warm cabinet edge, cream ink.
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(18,13,8,0.82)';
  drawRoundedRect(ctx, panelX, opts.y, panelWidth, panelHeight, radius);
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,44,26,0.9)';
  ctx.lineWidth = Math.max(1, Math.round(opts.dpr));
  ctx.stroke();
  // Warm top-edge bevel highlight (no glow)
  ctx.strokeStyle = 'rgba(74,56,34,0.55)';
  ctx.lineWidth = Math.max(1, Math.round(opts.dpr));
  ctx.beginPath();
  ctx.moveTo(panelX + radius, opts.y + 0.5 * opts.dpr);
  ctx.lineTo(panelX + panelWidth - radius, opts.y + 0.5 * opts.dpr);
  ctx.stroke();

  ctx.textAlign = opts.align === 'right' ? 'right' : 'left';
  const textX = opts.align === 'right' ? panelX + panelWidth - padX : panelX + padX;
  for (let i = 0; i < lines.length; i++) {
    // First line is a heading → ticket amber; body lines → cream ink.
    ctx.fillStyle = i === 0 ? 'rgba(242,163,60,0.98)' : 'rgba(246,237,220,0.9)';
    ctx.fillText(lines[i], textX, opts.y + padY + i * lineHeight);
  }
}

function drawReplayShotControlDock(
  ctx: CanvasRenderingContext2D,
  opts: {
    x: number;
    y: number;
    dpr: number;
    powerRatio: number | null | undefined;
    spin: { x: number; y: number } | null | undefined;
  },
) {
  const power = opts.powerRatio === null || opts.powerRatio === undefined
    ? null
    : Math.max(0, Math.min(1, opts.powerRatio));
  const spin = opts.spin ?? null;
  if (power === null && !spin) return;

  const panelW = Math.round(248 * opts.dpr);
  const panelH = Math.round(92 * opts.dpr);
  const radius = Math.round(9 * opts.dpr);
  const padX = Math.round(10 * opts.dpr);
  const padY = Math.round(8 * opts.dpr);

  // Midway wooden control plate.
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(18,13,8,0.82)';
  drawRoundedRect(ctx, opts.x, opts.y, panelW, panelH, radius);
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,44,26,0.9)';
  ctx.lineWidth = Math.max(1, Math.round(opts.dpr));
  ctx.stroke();

  const titleFont = Math.round(11 * opts.dpr);
  const labelFont = Math.round(10.5 * opts.dpr);
  const monoFont = Math.round(11 * opts.dpr);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `${titleFont}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
  ctx.fillStyle = 'rgba(242,163,60,0.98)';
  ctx.fillText('SHOT CONTROL', opts.x + padX, opts.y + padY);

  const barX = opts.x + padX;
  const barY = opts.y + padY + Math.round(22 * opts.dpr);
  const barW = Math.round(156 * opts.dpr);
  const barH = Math.round(14 * opts.dpr);
  // Recessed well track
  drawRoundedRect(ctx, barX, barY, barW, barH, Math.round(4 * opts.dpr));
  ctx.fillStyle = 'rgba(8,5,3,0.92)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,44,26,0.7)';
  ctx.lineWidth = Math.max(1, Math.round(0.9 * opts.dpr));
  ctx.stroke();

  if (power !== null) {
    const fillW = Math.max(Math.round(2 * opts.dpr), Math.round(barW * power));
    // Enamel power ramp: prize teal → ticket amber → CTA red (matches the
    // live DOM power meter tokens). Flat enamel paints, no neon.
    const grad = ctx.createLinearGradient(barX, barY, barX + barW, barY);
    grad.addColorStop(0, 'rgba(47,184,166,0.96)');
    grad.addColorStop(0.55, 'rgba(242,163,60,0.96)');
    grad.addColorStop(1, 'rgba(199,53,56,0.98)');
    ctx.fillStyle = grad;
    drawRoundedRect(ctx, barX, barY, fillW, barH, Math.round(4 * opts.dpr));
    ctx.fill();
  }

  ctx.font = `${labelFont}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
  ctx.fillStyle = 'rgba(246,237,220,0.9)';
  ctx.fillText(
    `Power: ${power === null ? '-' : `${Math.round(power * 100)}%`}`,
    barX,
    barY + barH + Math.round(5 * opts.dpr),
  );

  const cueCx = opts.x + panelW - Math.round(44 * opts.dpr);
  const cueCy = opts.y + Math.round(46 * opts.dpr);
  const cueR = Math.round(18 * opts.dpr);
  ctx.beginPath();
  ctx.arc(cueCx, cueCy, cueR, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(247,243,233,0.98)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(15,10,6,0.72)';
  ctx.lineWidth = Math.max(1, Math.round(1.2 * opts.dpr));
  ctx.stroke();

  if (spin) {
    const sx = Math.max(-1, Math.min(1, spin.x));
    const sy = Math.max(-1, Math.min(1, spin.y));
    const offset = cueR * 0.5;
    const dotX = cueCx + sx * offset;
    const dotY = cueCy - sy * offset;
    const dotR = Math.max(2, Math.round(4 * opts.dpr));
    // Enamel danger (follow) / info (draw) / prize (english) — matches the
    // DOM spin selector strike-point tokens.
    const dotColor = Math.abs(sy) > 0.05
      ? (sy > 0 ? 'rgba(199,53,56,0.9)' : 'rgba(108,143,224,0.9)')
      : 'rgba(47,184,166,0.9)';
    ctx.beginPath();
    ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.fill();
    ctx.strokeStyle = 'rgba(15,10,6,0.7)';
    ctx.lineWidth = Math.max(1, Math.round(0.8 * opts.dpr));
    ctx.stroke();
  }

  ctx.font = `${monoFont}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
  ctx.fillStyle = 'rgba(246,237,220,0.9)';
  ctx.fillText(
    `Spin: ${spin ? `${spin.x.toFixed(2)}, ${spin.y.toFixed(2)}` : '-'}`,
    opts.x + padX,
    opts.y + panelH - Math.round(18 * opts.dpr),
  );
}

export function PoolCanvas({
  balls,
  theme: themeInput,
  animateShot,
  animationSpeed = 1,
  muteAnimationSound = false,
  replayOverlay = null,
  animBallsOverride,
  animShotCueTheme,
  onAnimationEnd,
  aimGuideEmphasis = 1,
  aimLine,
  aimPath,
  ghostBall,
  targetLine,
  cueStick,
  spinIndicator,
  cueDeflectionLine,
  ballInHandPreview,
  ballInHandValid = true,
  ballInHandRestrictedToHeadString = false,
  highlightBallIds,
  fitBox = null,
  feel = null,
  canvasClassName,
  onCanvasInteraction,
  onCanvasMove,
  onCanvasRelease,
  onCanvasCancel,
}: PoolCanvasProps) {
  // Read through a ref so a new callback doesn't restart a running shot.
  const feelRef = useRef<PoolCanvasFeel | null>(feel);
  feelRef.current = feel;
  const theme = themeInput ?? DEFAULT_POOL_THEME;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isAnimatingRef = useRef(false);
  // Draw felt cloth texture directly using line draws in table-space.
  // This avoids the canvas pattern tiling/transform issues and works
  // correctly at any DPI scale.
  const drawFeltTexture = useCallback((ctx: CanvasRenderingContext2D) => {
    const TW = TABLE_WIDTH;
    const TH = TABLE_HEIGHT;
    const weaveSpacing = 8; // table-space pixels between weave lines

    // Horizontal weave lines — faint lighter rows simulating cloth grain.
    // Stronger than the cross-weave to suggest a brushed nap direction.
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let py = 0; py < TH; py += weaveSpacing) {
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(TW, py);
      ctx.stroke();
    }

    // Vertical cross-weave — even fainter perpendicular lines
    ctx.strokeStyle = 'rgba(255,255,255,0.018)';
    for (let px = 0; px < TW; px += weaveSpacing) {
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, TH);
      ctx.stroke();
    }

    // Diagonal sheen pass — wide-spaced 45° strokes that catch the
    // overhead light, giving the cloth a soft directional lustre.
    ctx.strokeStyle = 'rgba(255,255,255,0.012)';
    for (let d = -TH; d < TW; d += weaveSpacing * 4) {
      ctx.beginPath();
      ctx.moveTo(d, 0);
      ctx.lineTo(d + TH, TH);
      ctx.stroke();
    }
  }, []);
  const tableCacheRef = useRef<{
    canvas: HTMLCanvasElement;
    key: string;
    draw: (ctx: CanvasRenderingContext2D) => void;
  } | null>(null);
  const pocketAnimsRef = useRef<Map<number, PocketAnimation>>(new Map());
  const pocketFlashesRef = useRef<PocketFlash[]>([]);
  // Transient cushion-impact ripples (juice). Fixed-capacity pool, written in
  // place during the shot animation so the render loop allocates nothing.
  const cushionFlashesRef = useRef<CushionFlash[]>([]);
  const seenPocketedRef = useRef<Set<number>>(new Set());
  // Honor prefers-reduced-motion: when set, all decorative juice (cushion
  // ripples, pot ring bursts, ball highlight pulse) is suppressed; only the
  // functional pocket-drop motion remains. Read once, kept current via listener.
  const reduceMotionRef = useRef(false);
  // Accumulated rolling rotation per ball id, fed by the shot animation and
  // read by drawBall. Persists after a shot so balls keep their final
  // orientation at rest; cleared when the next shot starts.
  const ballRollRef = useRef<Map<number, BallRollState>>(new Map());
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 440, upright: false });
  const uprightRef = useRef(false);
  uprightRef.current = canvasSize.upright;
  const fitWidth = fitBox?.width ?? 0;
  const fitHeight = fitBox?.height ?? 0;

  useEffect(() => {
    if (fitWidth <= 0 || fitHeight <= 0) return;
    const totalW = TABLE_WIDTH + RAIL_WIDTH * 2;
    const totalH = TABLE_HEIGHT + RAIL_WIDTH * 2;
    const upright = fitHeight > fitWidth * UPRIGHT_MIN_RATIO;
    const across = upright ? totalH : totalW;
    const down = upright ? totalW : totalH;
    const scale = Math.min(fitWidth / across, fitHeight / down);
    const width = Math.max(1, Math.floor(across * scale));
    const height = Math.max(1, Math.floor(down * scale));
    setCanvasSize((prev) =>
      prev.width === width && prev.height === height && prev.upright === upright
        ? prev
        : { width, height, upright },
    );
  }, [fitWidth, fitHeight]);

  useEffect(() => {
    if (fitWidth > 0 && fitHeight > 0) return;
    const update = () => {
      const container = containerRef.current;
      if (!container) return;
      const totalW = TABLE_WIDTH + RAIL_WIDTH * 2;
      const totalH = TABLE_HEIGHT + RAIL_WIDTH * 2;
      const maxW = Math.min(container.clientWidth, 960);
      // Adaptive vertical reserve: on mobile landscape (short + wide), reduce
      // chrome aggressively so the table fills the screen. On tall/desktop
      // viewports, keep room for the HUD and controls.
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const isLandscape = vw > vh;
      const reservedV = isLandscape && vh < 500
        ? 60                   // mobile landscape: minimal chrome
        : vw < 640
          ? 160                // mobile portrait
          : 260;               // desktop / tablet
      const maxH = Math.min(vh - reservedV, maxW * (totalH / totalW));
      const scale = Math.min(maxW / totalW, maxH / totalH);
      // Ensure a minimum playable size (300px wide)
      const minScale = 300 / totalW;
      const finalScale = Math.max(scale, minScale);
      setCanvasSize({
        width: Math.round(totalW * finalScale),
        height: Math.round(totalH * finalScale),
        upright: false,
      });
    };

    update();
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, [fitWidth, fitHeight]);

  const reducedMotion = useFeelReducedMotion();
  useEffect(() => {
    reduceMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  const screenToTable = useCallback((clientX: number, clientY: number): Vec2 | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const totalW = TABLE_WIDTH + RAIL_WIDTH * 2;
    const totalH = TABLE_HEIGHT + RAIL_WIDTH * 2;
    if (uprightRef.current) {
      // Upright: screen x runs along the table's y, and screen y runs from
      // the foot rail (top) down to the head rail (bottom).
      const u = ((clientX - rect.left) / rect.width) * totalH;
      const v = ((clientY - rect.top) / rect.height) * totalW;
      return { x: totalW - v - RAIL_WIDTH, y: u - RAIL_WIDTH };
    }
    const x = ((clientX - rect.left) / rect.width) * totalW - RAIL_WIDTH;
    const y = ((clientY - rect.top) / rect.height) * totalH - RAIL_WIDTH;
    return { x, y };
  }, []);

  const adjustHex = useCallback((hex: string, amount: number) => {
    if (!hex.startsWith('#') || (hex.length !== 7 && hex.length !== 4)) {
      return hex;
    }

    const expanded = hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex;
    const channels = [1, 3, 5].map((index) => {
      const value = Number.parseInt(expanded.slice(index, index + 2), 16);
      return Math.max(0, Math.min(255, value + amount));
    });
    return `#${channels.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  }, []);

  const drawTable = useCallback((ctx: CanvasRenderingContext2D) => {
    const CW = RAIL_WIDTH; // cushion width alias
    const TW = TABLE_WIDTH;
    const TH = TABLE_HEIGHT;

    // ── Outer rail wood ──────────────────────────────────────
    const outerRail = ctx.createLinearGradient(-CW, -CW, TW + CW, TH + CW);
    outerRail.addColorStop(0, adjustHex(theme.railColor, 22));
    outerRail.addColorStop(0.45, theme.railColor);
    outerRail.addColorStop(1, adjustHex(theme.railColor, -28));
    ctx.fillStyle = outerRail;
    ctx.fillRect(-CW, -CW, TW + CW * 2, TH + CW * 2);

    // Warm top-edge bevel highlight on the cabinet frame (Midway --bevel-hi):
    // a single bright line along the upper-left edge so the wood reads as a
    // lit lacquered panel rather than a flat fill — nothing glows, it sits.
    ctx.strokeStyle = 'rgba(74,56,34,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-CW + 1, TH + CW - 1);
    ctx.lineTo(-CW + 1, -CW + 1);
    ctx.lineTo(TW + CW - 1, -CW + 1);
    ctx.stroke();

    // Hard dark outer border (crisp Midway edge, no blur)
    ctx.strokeStyle = adjustHex(theme.railBorder, -4);
    ctx.lineWidth = 8;
    ctx.strokeRect(-CW + 4, -CW + 4, TW + CW * 2 - 8, TH + CW * 2 - 8);

    // Thin warm inlay line just inside the dark border — picks up the cabinet
    // trim language used across the Midway panels.
    ctx.strokeStyle = adjustHex(theme.railColor, 30);
    ctx.lineWidth = 1;
    ctx.strokeRect(-CW + 9, -CW + 9, TW + CW * 2 - 18, TH + CW * 2 - 18);

    // A skin set's rail material, drawn flat on the rail band.
    const skinLook = theme.skin;
    if (skinLook) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(-CW, -CW, TW + CW * 2, TH + CW * 2);
      ctx.rect(0, 0, TW, TH);
      ctx.clip('evenodd');
      ctx.fillStyle = theme.railColor;
      ctx.fillRect(-CW, -CW, TW + CW * 2, TH + CW * 2);
      if (skinLook.material === 'walnut' || skinLook.material === 'maple') {
        // Grain: long, slightly wavy lines along each rail.
        ctx.strokeStyle = skinLook.railEdge;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 1.2;
        for (let i = 0; i < 6; i++) {
          const o = -CW + 6 + i * ((CW - 8) / 5);
          ctx.beginPath();
          for (let x = -CW; x <= TW + CW; x += 40) {
            const wave = Math.sin(x / 70 + i * 1.7) * 2;
            if (x === -CW) ctx.moveTo(x, o + wave);
            else ctx.lineTo(x, o + wave);
          }
          ctx.stroke();
          ctx.beginPath();
          for (let x = -CW; x <= TW + CW; x += 40) {
            const wave = Math.sin(x / 80 + i * 2.3) * 2;
            if (x === -CW) ctx.moveTo(x, TH + CW - 6 - (o + CW) + wave);
            else ctx.lineTo(x, TH + CW - 6 - (o + CW) + wave);
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      } else if (skinLook.material === 'enamel') {
        // A painted pinstripe round the rail.
        ctx.strokeStyle = skinLook.railEdge;
        ctx.lineWidth = 3;
        ctx.strokeRect(-CW + 10, -CW + 10, TW + CW * 2 - 20, TH + CW * 2 - 20);
      } else if (skinLook.material === 'brass') {
        // One darker band where the brass meets the cushion.
        ctx.strokeStyle = skinLook.railEdge;
        ctx.lineWidth = 4;
        ctx.strokeRect(-6, -6, TW + 12, TH + 12);
      }
      ctx.strokeStyle = skinLook.railEdge;
      ctx.lineWidth = 6;
      ctx.strokeRect(-CW + 3, -CW + 3, TW + CW * 2 - 6, TH + CW * 2 - 6);
      ctx.restore();
    }

    // ── Pocket holes (drawn into the rail, before felt) ──────
    // Corner pocket cuts — larger circles that cut into the rail
    const cornerPocketR = CORNER_THROAT_RADIUS + 12;
    const sidePocketR = SIDE_THROAT_RADIUS + 8;
    const corners = [POCKETS[0], POCKETS[2], POCKETS[3], POCKETS[5]];
    const sides = [POCKETS[1], POCKETS[4]];

    // Draw pocket holes as dark circles punched into the rail
    for (const c of corners) {
      ctx.fillStyle = theme.pocketColor;
      ctx.beginPath();
      ctx.arc(c.x, c.y, cornerPocketR, 0, Math.PI * 2);
      ctx.fill();
      // Depth gradient
      const pG = ctx.createRadialGradient(c.x, c.y, cornerPocketR * 0.1, c.x, c.y, cornerPocketR);
      pG.addColorStop(0, 'rgba(0,0,0,0.95)');
      pG.addColorStop(0.6, 'rgba(10,10,10,0.85)');
      pG.addColorStop(1, 'rgba(20,20,20,0.3)');
      ctx.fillStyle = pG;
      ctx.beginPath();
      ctx.arc(c.x, c.y, cornerPocketR, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const s of sides) {
      ctx.fillStyle = theme.pocketColor;
      ctx.beginPath();
      ctx.arc(s.x, s.y, sidePocketR, 0, Math.PI * 2);
      ctx.fill();
      const pG = ctx.createRadialGradient(s.x, s.y, sidePocketR * 0.1, s.x, s.y, sidePocketR);
      pG.addColorStop(0, 'rgba(0,0,0,0.95)');
      pG.addColorStop(0.6, 'rgba(10,10,10,0.85)');
      pG.addColorStop(1, 'rgba(20,20,20,0.3)');
      ctx.fillStyle = pG;
      ctx.beginPath();
      ctx.arc(s.x, s.y, sidePocketR, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Felt surface ─────────────────────────────────────────
    const feltGrad = ctx.createLinearGradient(0, 0, TW, TH);
    feltGrad.addColorStop(0, adjustHex(theme.feltDark, -6));
    feltGrad.addColorStop(0.28, theme.feltColor);
    feltGrad.addColorStop(0.72, adjustHex(theme.feltColor, 8));
    feltGrad.addColorStop(1, theme.feltDark);
    ctx.fillStyle = feltGrad;
    ctx.fillRect(0, 0, TW, TH);

    // Felt fabric texture — directional weave lines
    drawFeltTexture(ctx);

    // Subtle overhead light glow
    const tableGlow = ctx.createRadialGradient(
      TW * 0.38, TH * 0.32, TW * 0.04,
      TW * 0.4, TH * 0.46, TW * 0.72,
    );
    tableGlow.addColorStop(0, 'rgba(255,252,240,0.12)');
    tableGlow.addColorStop(0.6, 'rgba(255,252,240,0.05)');
    tableGlow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = tableGlow;
    ctx.fillRect(0, 0, TW, TH);

    // Inner shadow along cushion edges — soft gradients reading as the
    // cushion rubber casting onto the felt, instead of flat strips.
    const edgeShadow = 20;
    const topSh = ctx.createLinearGradient(0, 0, 0, edgeShadow);
    topSh.addColorStop(0, 'rgba(0,0,0,0.28)');
    topSh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = topSh;
    ctx.fillRect(0, 0, TW, edgeShadow);
    const botSh = ctx.createLinearGradient(0, TH, 0, TH - edgeShadow);
    botSh.addColorStop(0, 'rgba(0,0,0,0.28)');
    botSh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = botSh;
    ctx.fillRect(0, TH - edgeShadow, TW, edgeShadow);
    const leftSh = ctx.createLinearGradient(0, 0, edgeShadow, 0);
    leftSh.addColorStop(0, 'rgba(0,0,0,0.28)');
    leftSh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = leftSh;
    ctx.fillRect(0, 0, edgeShadow, TH);
    const rightSh = ctx.createLinearGradient(TW, 0, TW - edgeShadow, 0);
    rightSh.addColorStop(0, 'rgba(0,0,0,0.28)');
    rightSh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rightSh;
    ctx.fillRect(TW - edgeShadow, 0, edgeShadow, TH);

    // ── Pocket openings on the felt (visible holes) ──────────
    // These are drawn ON TOP of the felt to create the pocket hole illusion
    // Leather collar ring drawn around each pocket mouth: a dark band
    // derived from the rail trim plus a thin worn-edge highlight.
    const drawPocketOpening = (px: number, py: number, r: number) => {
      ctx.fillStyle = theme.pocketColor;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      const pG = ctx.createRadialGradient(px, py, r * 0.15, px, py, r);
      pG.addColorStop(0, 'rgba(0,0,0,0.94)');
      pG.addColorStop(0.7, 'rgba(15,15,15,0.8)');
      pG.addColorStop(1, 'rgba(20,20,20,0.15)');
      ctx.fillStyle = pG;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = adjustHex(theme.railBorder, -14);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(px, py, r + 1.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,235,200,0.16)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(px, py, r + 4, 0, Math.PI * 2);
      ctx.stroke();
    };
    for (const c of corners) {
      drawPocketOpening(c.x, c.y, CORNER_THROAT_RADIUS);
    }
    // Side pocket openings — positioned ON the cushion edge, not above/below
    for (const s of sides) {
      drawPocketOpening(s.x, s.y, SIDE_THROAT_RADIUS);
    }

    // ── Cushion nose (breaks at pockets) ─────────────────────
    // Three stroke passes over the same segments build a rubber bevel:
    // a soft shadow cast on the felt, the lit nose itself, and a thin
    // bright top edge on the rail side.
    const sideM = SIDE_MOUTH_HALF;
    const cornerM = CORNER_MOUTH_HALF;
    const cornerInset = POCKETS[0].x;
    // Traces every cushion segment offset by `off` toward the felt
    // (positive values move the line into the playing surface).
    const traceNose = (off: number) => {
      ctx.beginPath();
      // Top rail — broken at corners and side pocket
      ctx.moveTo(cornerInset + cornerM, CW - 1 + off);
      ctx.lineTo(TW / 2 - sideM, CW - 1 + off);
      ctx.moveTo(TW / 2 + sideM, CW - 1 + off);
      ctx.lineTo(TW - cornerInset - cornerM, CW - 1 + off);
      // Bottom rail
      ctx.moveTo(cornerInset + cornerM, TH - CW + 1 - off);
      ctx.lineTo(TW / 2 - sideM, TH - CW + 1 - off);
      ctx.moveTo(TW / 2 + sideM, TH - CW + 1 - off);
      ctx.lineTo(TW - cornerInset - cornerM, TH - CW + 1 - off);
      // Left rail
      ctx.moveTo(CW - 1 + off, cornerInset + cornerM);
      ctx.lineTo(CW - 1 + off, TH - cornerInset - cornerM);
      // Right rail
      ctx.moveTo(TW - CW + 1 - off, cornerInset + cornerM);
      ctx.lineTo(TW - CW + 1 - off, TH - cornerInset - cornerM);
    };

    // Shadow the rubber casts onto the felt
    traceNose(3);
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Main cushion nose — warm lacquered cushion rail, cream-on-cocoa
    const noseGrad = ctx.createLinearGradient(0, 0, 0, TH);
    noseGrad.addColorStop(0, 'rgba(214,196,154,0.85)');
    noseGrad.addColorStop(1, 'rgba(132,102,64,0.62)');
    traceNose(0);
    ctx.strokeStyle = noseGrad;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Bright top edge of the rubber, catching the overhead light (warm cream)
    traceNose(-2);
    ctx.strokeStyle = 'rgba(246,237,220,0.24)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // ── Head string + foot spot ──────────────────────────────
    ctx.strokeStyle = 'rgba(255,255,255,0.11)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(HEAD_STRING_X, CW);
    ctx.lineTo(HEAD_STRING_X, TH - CW);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath();
    ctx.arc(FOOT_SPOT.x, FOOT_SPOT.y, 3, 0, Math.PI * 2);
    ctx.fill();

    // ── Rail diamonds ────────────────────────────────────────
    const topBottomDiamonds = [TW * 0.2, TW * 0.4, TW * 0.6, TW * 0.8];
    const sideDiamonds = [TH * 0.25, TH * 0.5, TH * 0.75];
    const drawDiamond = (x: number, y: number, rotation: number) => {
      if (theme.skin) {
        // A skin's sights: rivets on brass and ink, diamonds on wood, bars
        // on enamel. Flat, in the sight colour.
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = theme.skin.sight;
        ctx.beginPath();
        if (theme.skin.material === 'brass' || theme.skin.material === 'ink') {
          ctx.arc(0, 0, 3.6, 0, Math.PI * 2);
        } else if (theme.skin.material === 'enamel') {
          ctx.rotate(rotation === 0 ? 0 : Math.PI / 2);
          ctx.roundRect(-2, -6, 4, 12, 2);
        } else {
          ctx.rotate(rotation);
          ctx.moveTo(0, -5);
          ctx.lineTo(5, 0);
          ctx.lineTo(0, 5);
          ctx.lineTo(-5, 0);
          ctx.closePath();
        }
        ctx.fill();
        ctx.restore();
        return;
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      // Recessed seat in the rail wood
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.moveTo(0.8, -4.6);
      ctx.lineTo(5.8, 0.4);
      ctx.lineTo(0.8, 5.4);
      ctx.lineTo(-4.2, 0.4);
      ctx.closePath();
      ctx.fill();
      // Pearl inlay with a soft top-left sheen
      const pearl = ctx.createLinearGradient(-4, -4, 4, 4);
      pearl.addColorStop(0, 'rgba(255,250,238,0.98)');
      pearl.addColorStop(0.55, 'rgba(243,229,196,0.92)');
      pearl.addColorStop(1, 'rgba(208,186,148,0.9)');
      ctx.fillStyle = pearl;
      ctx.beginPath();
      ctx.moveTo(0, -5);
      ctx.lineTo(5, 0);
      ctx.lineTo(0, 5);
      ctx.lineTo(-5, 0);
      ctx.closePath();
      ctx.fill();
      // Crisp bevel edge
      ctx.strokeStyle = 'rgba(120,90,50,0.55)';
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.restore();
    };
    for (const x of topBottomDiamonds) {
      drawDiamond(x, -CW * 0.42, 0);
      drawDiamond(x, TH + CW * 0.42, 0);
    }
    for (const y of sideDiamonds) {
      drawDiamond(-CW * 0.42, y, Math.PI / 4);
      drawDiamond(TW + CW * 0.42, y, Math.PI / 4);
    }

    // Subtle outer felt edge
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, TW - 1, TH - 1);
  }, [adjustHex, drawFeltTexture, theme]);

  const drawBall = useCallback((ctx: CanvasRenderingContext2D, ball: Ball, alpha = 1, highlight = false) => {
    if (ball.pocketed) return;

    const { x, y } = ball.pos;
    const r = BALL_RADIUS;

    // Position-dependent lighting: the specular highlight dot shifts
    // subtly based on the ball's position relative to the overhead light.
    // Only the small specular dot and shine gradient shift — the body
    // gradient stays fixed so ball colors render correctly everywhere.
    const lightDx = (LIGHT_X - x) / TABLE_WIDTH;  // -0.5..+0.5
    const lightDy = (LIGHT_Y - y) / TABLE_HEIGHT;
    const hlBaseX = -r * 0.34;
    const hlBaseY = -r * 0.38;
    const hlShift = r * 0.18; // max shift in pixels — very subtle
    const hlOffX = hlBaseX + lightDx * hlShift;
    const hlOffY = hlBaseY + lightDy * hlShift;
    const baseInfo = BALL_COLORS[ball.id] ?? { fill: '#888', stripe: false };
    const info = theme.ballColors?.[ball.id]
      ? { fill: theme.ballColors[ball.id], stripe: baseInfo.stripe }
      : baseInfo;
    // Rolling state from the shot animation; the cue ball has no markings
    // to roll, so it always takes the static path.
    const roll = ball.id > 0 ? ballRollRef.current.get(ball.id) : undefined;
    // A skin set's ball finish: flat fills, a pearl rim or a ring round the
    // number. The ball's size and place are the physics' own.
    const finish = theme.skin?.finish ?? 'gloss';
    const flat = finish === 'flat';
    ctx.globalAlpha = alpha;

    if (highlight && alpha >= 0.95) {
      // Steady ring under reduced motion; gentle pulse otherwise.
      const pulse = reduceMotionRef.current ? 0.85 : 0.7 + 0.3 * Math.sin(performance.now() / 400);
      ctx.save();
      // Outer glow ring
      const glowGrad = ctx.createRadialGradient(x, y, r, x, y, r + 14);
      glowGrad.addColorStop(0, info.fill);
      glowGrad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalAlpha = 0.35 * pulse;
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(x, y, r + 14, 0, Math.PI * 2);
      ctx.fill();
      // Inner bright ring
      ctx.shadowColor = info.fill;
      ctx.shadowBlur = 22;
      ctx.globalAlpha = 0.5 * pulse;
      ctx.strokeStyle = info.fill;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, r + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = alpha;
    }

    // Two-layer contact shadow under the ball: a wide soft penumbra plus
    // a tighter dark core where the ball meets the felt.
    const shGrad = ctx.createRadialGradient(x + 2, y + r * 0.45, r * 0.2, x + 2, y + r * 0.45, r * 1.25);
    shGrad.addColorStop(0, 'rgba(0,0,0,0.34)');
    shGrad.addColorStop(0.55, 'rgba(0,0,0,0.16)');
    shGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shGrad;
    ctx.beginPath();
    ctx.ellipse(x + 2, y + r * 0.45, r * 1.25, r * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();

    const ballBody = ctx.createRadialGradient(
      x - r * 0.45,
      y - r * 0.45,
      r * 0.15,
      x + r * 0.15,
      y + r * 0.2,
      r * 1.05,
    );
    if (ball.id === 0) {
      ballBody.addColorStop(0, flat ? '#f7f2e8' : '#ffffff');
      ballBody.addColorStop(0.45, flat ? '#f7f2e8' : '#f7f7f7');
      ballBody.addColorStop(1, flat ? '#f7f2e8' : '#d7d7d7');
      ctx.fillStyle = ballBody;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    } else if (info.stripe) {
      ballBody.addColorStop(0, flat ? '#f7f2e8' : '#ffffff');
      ballBody.addColorStop(0.55, flat ? '#f7f2e8' : '#f8f8f8');
      ballBody.addColorStop(1, flat ? '#f7f2e8' : '#dadada');
      ctx.fillStyle = ballBody;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.clip();
      const stripeGrad = ctx.createLinearGradient(x - r, y - r * 0.46, x + r, y + r * 0.46);
      stripeGrad.addColorStop(0, flat ? info.fill : adjustHex(info.fill, 34));
      stripeGrad.addColorStop(0.52, info.fill);
      stripeGrad.addColorStop(1, flat ? info.fill : adjustHex(info.fill, -34));
      if (!roll) {
        // Upright table: turn the band so it still runs across the screen.
        if (uprightRef.current) {
          ctx.translate(x, y);
          ctx.rotate(Math.PI / 2);
          ctx.translate(-x, -y);
        }
        // Stripe band with curved edges so it appears to wrap around the
        // sphere instead of being painted flat across it.
        const bandH = r * 0.92;
        const bow = r * 0.16; // how much the band edges bulge at center
        ctx.fillStyle = stripeGrad;
        ctx.beginPath();
        ctx.moveTo(x - r, y - bandH / 2);
        ctx.quadraticCurveTo(x, y - bandH / 2 - bow, x + r, y - bandH / 2);
        ctx.lineTo(x + r, y + bandH / 2);
        ctx.quadraticCurveTo(x, y + bandH / 2 + bow, x - r, y + bandH / 2);
        ctx.closePath();
        ctx.fill();
      } else {
        // Rolling: paint the stripe across the whole face, then re-paint the
        // two white polar caps over it. Each cap edge is a small circle on
        // the sphere around the stripe pole; its samples are projected into
        // screen space, with far-hemisphere points pushed radially past the
        // limb so the ball-circle clip closes the path along the silhouette.
        ctx.fillStyle = stripeGrad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();

        const mx = roll.dirX;
        const my = roll.dirY;
        const sp = Math.sin(roll.phase);
        const cp = Math.cos(roll.phase);
        ctx.fillStyle = ballBody;
        for (const sgn of [1, -1]) {
          let anyVisible = false;
          ctx.beginPath();
          for (let i = 0; i <= STRIPE_EDGE_SAMPLES; i++) {
            const t = (i / STRIPE_EDGE_SAMPLES) * Math.PI * 2;
            const ct = Math.cos(t);
            // Cap edge point in (motion, perpendicular, view) coordinates.
            let qm = sgn * STRIPE_SIN_B * sp + STRIPE_COS_B * ct * cp;
            let qp = STRIPE_COS_B * Math.sin(t);
            const qz = sgn * STRIPE_SIN_B * cp - STRIPE_COS_B * ct * sp;
            if (qz >= 0) {
              anyVisible = true;
            } else {
              const n = Math.hypot(qm, qp) || 1;
              qm = (qm / n) * 1.06;
              qp = (qp / n) * 1.06;
            }
            const px = x + (qm * mx - qp * my) * r;
            const py = y + (qm * my + qp * mx) * r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          // A cap entirely on the far hemisphere contributes nothing.
          if (anyVisible) ctx.fill();
        }
      }
      ctx.restore();
    } else {
      ballBody.addColorStop(0, flat ? info.fill : adjustHex(info.fill, 36));
      ballBody.addColorStop(0.52, info.fill);
      ballBody.addColorStop(1, flat ? info.fill : adjustHex(info.fill, -34));
      ctx.fillStyle = ballBody;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Number disk. While rolling, the two disks ride the stripe equator at
    // ±90° from the stripe pole: the visible one slides along the motion
    // direction and foreshortens as it rotates over the horizon, then the
    // twin re-emerges from the opposite limb.
    // Big enough to read on a phone: the disk is 60% of the ball and the
    // digit is set in the number face, as tall as the disk.
    const numR = r * 0.6;
    let diskOffX = 0;
    let diskOffY = 0;
    let diskSquash = 1;
    if (roll) {
      const psi = roll.phase - Math.PI / 2;
      let c = Math.cos(psi);
      let s = Math.sin(psi);
      if (c < 0) {
        // The opposite pole is the one facing the viewer.
        c = -c;
        s = -s;
      }
      diskSquash = c;
      diskOffX = roll.dirX * r * s;
      diskOffY = roll.dirY * r * s;
    }
    if (diskSquash > 0.06) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.translate(x + diskOffX, y + diskOffY);
      if (roll && diskSquash < 0.999) {
        // Foreshorten along the motion direction only, keeping the digits
        // upright: rotate into the motion frame, squash, rotate back.
        const mAngle = Math.atan2(roll.dirY, roll.dirX);
        ctx.rotate(mAngle);
        ctx.scale(diskSquash, 1);
        ctx.rotate(-mAngle);
      }
      const numberPad = ctx.createRadialGradient(-numR * 0.25, -numR * 0.25, numR * 0.18, 0, 0, numR);
      numberPad.addColorStop(0, flat ? '#f7f2e8' : '#ffffff');
      numberPad.addColorStop(1, flat ? '#f7f2e8' : '#e2e2e2');
      ctx.fillStyle = numberPad;
      ctx.beginPath();
      ctx.arc(0, 0, numR, 0, Math.PI * 2);
      ctx.fill();
      if (finish === 'ringed' && ball.id > 0) {
        // A ring of the ball's colour round the number.
        ctx.strokeStyle = info.fill;
        ctx.lineWidth = r * 0.1;
        ctx.beginPath();
        ctx.arc(0, 0, numR * 0.86, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Faint seat line where the number disk meets the lacquer
      ctx.strokeStyle = 'rgba(0,0,0,0.14)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(0, 0, numR, 0, Math.PI * 2);
      ctx.stroke();

      // Drop the digits once the disk is steeply foreshortened — they would
      // smear illegibly at the horizon.
      if (ball.id > 0 && diskSquash > 0.3) {
        // Upright table: turn the digit back so it reads the right way up.
        if (uprightRef.current) ctx.rotate(Math.PI / 2);
        ctx.fillStyle = '#1F1A16';
        ctx.font = `800 ${(r * 1.18).toFixed(1)}px ${getBallNumberFont()}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ball.id.toString(), 0, r * 0.06);
      }
      ctx.restore();
    }

    if (flat) {
      // Flat: one hard edge line instead of light.
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, r - 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }
    if (finish === 'pearl') {
      // Pearl: a pale rim all the way round.
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = r * 0.16;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.9, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Soft specular lobe — a tight gradient dot instead of a hard circle,
    // so the lacquer reads as glossy rather than stickered.
    const specDot = ctx.createRadialGradient(
      x + hlOffX, y + hlOffY, 0,
      x + hlOffX, y + hlOffY, r * 0.3,
    );
    specDot.addColorStop(0, 'rgba(255,255,255,0.85)');
    specDot.addColorStop(0.4, 'rgba(255,255,255,0.4)');
    specDot.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = specDot;
    ctx.beginPath();
    ctx.arc(x + hlOffX, y + hlOffY, r * 0.3, 0, Math.PI * 2);
    ctx.fill();

    // Broad sheen falling off across the upper hemisphere
    const spec = ctx.createRadialGradient(x + hlOffX, y + hlOffY, 0, x, y, r);
    spec.addColorStop(0, 'rgba(255,255,255,0.32)');
    spec.addColorStop(0.48, 'rgba(255,255,255,0.06)');
    spec.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = spec;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    // Lower-hemisphere ambient occlusion: a crescent of darkening along
    // the bottom edge that grounds the sphere.
    const ao = ctx.createRadialGradient(
      x - hlOffX * 0.6, y - hlOffY * 0.6, r * 0.55,
      x - hlOffX * 0.6, y - hlOffY * 0.6, r * 1.02,
    );
    ao.addColorStop(0, 'rgba(0,0,0,0)');
    ao.addColorStop(0.75, 'rgba(0,0,0,0.08)');
    ao.addColorStop(1, 'rgba(0,0,0,0.26)');
    ctx.fillStyle = ao;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1;
  }, [adjustHex, theme.ballColors, theme.skin]);

  const drawCueStickShape = useCallback((ctx: CanvasRenderingContext2D, cue: CueRenderState) => {
    const { angle, power, cuePos } = cue;
    const progress = cue.progress ?? 0;
    const opacity = cue.opacity ?? 1;
    const stickLen = 232;
    const pullBack = power * 78;
    const strikeTravel = pullBack + 20;
    const followThrough = lerp(0, strikeTravel, easeOutCubic(progress));
    const gap = BALL_RADIUS + 4 + pullBack - followThrough;

    // Per-cue color overrides (e.g. opponent/bot skin) fall back to global theme
    const cColor = cue.cueColor ?? theme.cueColor;
    const tColor = cue.cueTipColor ?? theme.cueTipColor;
    const glow = cue.cueGlow ?? theme.cueGlow;
    const glowColor = cue.cueGlowColor ?? theme.cueGlowColor;

    const tipX = cuePos.x - Math.cos(angle) * gap;
    const tipY = cuePos.y - Math.sin(angle) * gap;
    const buttX = tipX - Math.cos(angle) * stickLen;
    const buttY = tipY - Math.sin(angle) * stickLen;
    const perpX = -Math.sin(angle);
    const perpY = Math.cos(angle);
    const tipHalf = 2.5;
    const buttHalf = 4.5;

    ctx.save();
    ctx.globalAlpha = opacity;

    ctx.shadowColor = 'rgba(0,0,0,0.22)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;

    if (glow) {
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 6 + power * 12;
    }

    const cueGrad = ctx.createLinearGradient(buttX, buttY, tipX, tipY);
    cueGrad.addColorStop(0, adjustHex(cColor, -32));
    cueGrad.addColorStop(0.28, adjustHex(cColor, -8));
    cueGrad.addColorStop(0.72, adjustHex(cColor, 18));
    cueGrad.addColorStop(1, adjustHex(cColor, 34));
    ctx.fillStyle = cueGrad;
    ctx.beginPath();
    ctx.moveTo(tipX + perpX * tipHalf, tipY + perpY * tipHalf);
    ctx.lineTo(buttX + perpX * buttHalf, buttY + perpY * buttHalf);
    ctx.lineTo(buttX - perpX * buttHalf, buttY - perpY * buttHalf);
    ctx.lineTo(tipX - perpX * tipHalf, tipY - perpY * tipHalf);
    ctx.closePath();
    ctx.fill();

    // Thin highlight running along the shaft spine — sells the cue as a
    // turned cylinder under the table light rather than a flat trapezoid.
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(tipX - perpX * tipHalf * 0.35, tipY - perpY * tipHalf * 0.35);
    ctx.lineTo(buttX - perpX * buttHalf * 0.35, buttY - perpY * buttHalf * 0.35);
    ctx.stroke();

    const wrapStart = 138;
    const wrapEnd = 205;
    const wsx = tipX - Math.cos(angle) * wrapStart;
    const wsy = tipY - Math.sin(angle) * wrapStart;
    const wex = tipX - Math.cos(angle) * wrapEnd;
    const wey = tipY - Math.sin(angle) * wrapEnd;
    const wrapWidthStart = tipHalf + (buttHalf - tipHalf) * (wrapStart / stickLen);
    const wrapWidthEnd = tipHalf + (buttHalf - tipHalf) * (wrapEnd / stickLen);
    ctx.fillStyle = adjustHex(tColor, -6);
    ctx.beginPath();
    ctx.moveTo(wsx + perpX * wrapWidthStart, wsy + perpY * wrapWidthStart);
    ctx.lineTo(wex + perpX * wrapWidthEnd, wey + perpY * wrapWidthEnd);
    ctx.lineTo(wex - perpX * wrapWidthEnd, wey - perpY * wrapWidthEnd);
    ctx.lineTo(wsx - perpX * wrapWidthStart, wsy - perpY * wrapWidthStart);
    ctx.closePath();
    ctx.fill();

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    const ferruleStart = 10;
    const ferruleLen = 6;
    const fsx = tipX - Math.cos(angle) * ferruleStart;
    const fsy = tipY - Math.sin(angle) * ferruleStart;
    const fex = tipX - Math.cos(angle) * (ferruleStart + ferruleLen);
    const fey = tipY - Math.sin(angle) * (ferruleStart + ferruleLen);
    const ferruleWidth = tipHalf + (buttHalf - tipHalf) * (ferruleStart / stickLen);
    // Cylindrical sheen across the ferrule: bright spine, darker edges
    const ferruleGrad = ctx.createLinearGradient(
      fsx + perpX * ferruleWidth, fsy + perpY * ferruleWidth,
      fsx - perpX * ferruleWidth, fsy - perpY * ferruleWidth,
    );
    ferruleGrad.addColorStop(0, '#b8b8b8');
    ferruleGrad.addColorStop(0.45, '#f4f4f4');
    ferruleGrad.addColorStop(1, '#a8a8a8');
    ctx.fillStyle = ferruleGrad;
    ctx.beginPath();
    ctx.moveTo(fsx + perpX * ferruleWidth, fsy + perpY * ferruleWidth);
    ctx.lineTo(fex + perpX * ferruleWidth, fey + perpY * ferruleWidth);
    ctx.lineTo(fex - perpX * ferruleWidth, fey - perpY * ferruleWidth);
    ctx.lineTo(fsx - perpX * ferruleWidth, fsy - perpY * ferruleWidth);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = tColor;
    ctx.beginPath();
    ctx.arc(tipX, tipY, tipHalf + 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }, [adjustHex, theme]);

  const drawAiming = useCallback((
    ctx: CanvasRenderingContext2D,
    transientCue: CueRenderState | null = null,
  ) => {
    const guideAlpha = (alpha: number) => Math.max(0.04, Math.min(1, alpha * aimGuideEmphasis));

    if (ballInHandRestrictedToHeadString) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(0, 0, HEAD_STRING_X, TABLE_HEIGHT);
      // Solid boundary line with soft glow
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(HEAD_STRING_X, CUSHION_WIDTH);
      ctx.lineTo(HEAD_STRING_X, TABLE_HEIGHT - CUSHION_WIDTH);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(HEAD_STRING_X, CUSHION_WIDTH);
      ctx.lineTo(HEAD_STRING_X, TABLE_HEIGHT - CUSHION_WIDTH);
      ctx.stroke();
      ctx.restore();
    }

    // Aim guides use solid lines with a soft glow outer stroke.
    // This eliminates the visual shimmer that dashed lines cause on
    // subpixel coordinates when the angle changes by tiny amounts.
    if (aimPath && aimPath.length > 1) {
      // Soft outer glow
      ctx.strokeStyle = `rgba(255,255,255,${guideAlpha(0.10)})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(aimPath[0].x, aimPath[0].y);
      for (let i = 1; i < aimPath.length; i++) ctx.lineTo(aimPath[i].x, aimPath[i].y);
      ctx.stroke();
      // Solid core
      ctx.strokeStyle = `rgba(255,255,255,${guideAlpha(0.35)})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(aimPath[0].x, aimPath[0].y);
      for (let i = 1; i < aimPath.length; i++) ctx.lineTo(aimPath[i].x, aimPath[i].y);
      ctx.stroke();
    }

    if (aimLine) {
      ctx.strokeStyle = `rgba(255,255,255,${guideAlpha(0.08)})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(aimLine.start.x, aimLine.start.y);
      ctx.lineTo(aimLine.end.x, aimLine.end.y);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${guideAlpha(0.25)})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(aimLine.start.x, aimLine.start.y);
      ctx.lineTo(aimLine.end.x, aimLine.end.y);
      ctx.stroke();
    }

    if (ghostBall) {
      // Subtle fill
      ctx.fillStyle = `rgba(255,255,255,${guideAlpha(0.06)})`;
      ctx.beginPath();
      ctx.arc(ghostBall.x, ghostBall.y, BALL_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      // Solid outline (no dashes)
      ctx.strokeStyle = `rgba(255,255,255,${guideAlpha(0.30)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(ghostBall.x, ghostBall.y, BALL_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (targetLine) {
      // Soft glow + solid core
      ctx.strokeStyle = `rgba(255,255,255,${guideAlpha(0.06)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(targetLine.start.x, targetLine.start.y);
      ctx.lineTo(targetLine.end.x, targetLine.end.y);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${guideAlpha(0.20)})`;
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.moveTo(targetLine.start.x, targetLine.start.y);
      ctx.lineTo(targetLine.end.x, targetLine.end.y);
      ctx.stroke();
      // Endpoint dot
      ctx.fillStyle = `rgba(255,255,255,${guideAlpha(0.16)})`;
      ctx.beginPath();
      ctx.arc(targetLine.end.x, targetLine.end.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Cue deflection line — solid glow + core, matching the other guides.
    if (cueDeflectionLine) {
      ctx.strokeStyle = `rgba(120,200,255,${guideAlpha(0.08)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cueDeflectionLine.start.x, cueDeflectionLine.start.y);
      ctx.lineTo(cueDeflectionLine.end.x, cueDeflectionLine.end.y);
      ctx.stroke();
      ctx.strokeStyle = `rgba(120,200,255,${guideAlpha(0.22)})`;
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.moveTo(cueDeflectionLine.start.x, cueDeflectionLine.start.y);
      ctx.lineTo(cueDeflectionLine.end.x, cueDeflectionLine.end.y);
      ctx.stroke();
    }

    if (cueStick) {
      drawCueStickShape(ctx, cueStick);
    }

    if (transientCue) {
      drawCueStickShape(ctx, transientCue);
    }
  }, [aimGuideEmphasis, aimLine, aimPath, ballInHandRestrictedToHeadString, ghostBall, targetLine, cueDeflectionLine, cueStick, drawCueStickShape]);

  const render = useCallback((
    currentBalls: Ball[],
    options?: { transientCue?: CueRenderState | null },
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = gameCanvasDpr(canvasSize.width, canvasSize.height);
    const targetW = Math.round(canvasSize.width * dpr);
    const targetH = Math.round(canvasSize.height * dpr);
    // Only reassign canvas dimensions when they actually change.
    // Setting canvas.width/height (even to the same value) resets the
    // entire backing store, which is expensive and causes stutter.
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    const totalW = TABLE_WIDTH + RAIL_WIDTH * 2;
    const totalH = TABLE_HEIGHT + RAIL_WIDTH * 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const now = performance.now();
    // Shake is a camera offset only (CSS px); the balls' table positions
    // are the simulation's.
    const shake = feelRef.current?.shakeOffset?.(now) ?? { x: 0, y: 0 };
    const shakeX = shake.x * dpr;
    const shakeY = shake.y * dpr;
    if (canvasSize.upright) {
      const scaleValue = (canvasSize.width * dpr) / totalH;
      ctx.setTransform(
        0, -scaleValue, scaleValue, 0,
        RAIL_WIDTH * scaleValue + shakeX,
        (totalW - RAIL_WIDTH) * scaleValue + shakeY,
      );
    } else {
      const scaleValue = (canvasSize.width * dpr) / totalW;
      ctx.setTransform(
        scaleValue, 0, 0, scaleValue,
        RAIL_WIDTH * scaleValue + shakeX,
        RAIL_WIDTH * scaleValue + shakeY,
      );
    }

    // The table never changes during a shot, so it is drawn once into a
    // bitmap the size of the canvas and copied each frame. Drawing it every
    // frame (gradients and about 300 felt strokes) cost most of a frame on
    // a 4x throttled phone. Shake moves the copy with the camera.
    const tableKey = `${canvas.width}x${canvas.height}:${canvasSize.upright ? 1 : 0}`;
    let tableCache = tableCacheRef.current;
    if (!tableCache || tableCache.key !== tableKey || tableCache.draw !== drawTable) {
      const bitmap = tableCache?.canvas ?? document.createElement('canvas');
      bitmap.width = canvas.width;
      bitmap.height = canvas.height;
      const bctx = bitmap.getContext('2d');
      if (bctx) {
        const m = ctx.getTransform();
        bctx.setTransform(m.a, m.b, m.c, m.d, m.e - shakeX, m.f - shakeY);
        drawTable(bctx);
      }
      tableCache = { canvas: bitmap, key: tableKey, draw: drawTable };
      tableCacheRef.current = tableCache;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, shakeX, shakeY);
    ctx.drawImage(tableCache.canvas, 0, 0);
    ctx.restore();

    for (const ball of currentBalls) {
      if (ball.pocketed && !seenPocketedRef.current.has(ball.id)) {
        seenPocketedRef.current.add(ball.id);
        let nearestPocket = POCKETS[0];
        let nearestDist = Infinity;
        for (const pocket of POCKETS) {
          const dist = distanceSq(ball.pos, pocket);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearestPocket = pocket;
          }
        }
        pocketAnimsRef.current.set(ball.id, {
          ballId: ball.id,
          startPos: { x: ball.pos.x, y: ball.pos.y },
          pocketPos: { x: nearestPocket.x, y: nearestPocket.y },
          startTime: now,
          durationMs: POCKET_ANIMATION_MS,
        });
        pocketFlashesRef.current.push({
          pocketPos: { x: nearestPocket.x, y: nearestPocket.y },
          startTime: now,
          durationMs: POCKET_FLASH_MS,
        });
      }
    }

    for (const [id, anim] of pocketAnimsRef.current) {
      const progress = Math.min(1, (now - anim.startTime) / anim.durationMs);
      if (progress >= 1) {
        pocketAnimsRef.current.delete(id);
        continue;
      }

      const eased = easeOutCubic(progress);
      const current = {
        x: lerp(anim.startPos.x, anim.pocketPos.x, eased),
        y: lerp(anim.startPos.y, anim.pocketPos.y, eased),
      };
      const scaleAmount = 1 - eased * 0.85;
      const alpha = 1 - eased * 0.9;
      const ghostBallData = currentBalls.find((ball) => ball.id === id);
      const renderBall = ghostBallData
        ? { ...cloneBall(ghostBallData), pos: current, pocketed: false }
        : { id, pos: current, vel: { x: 0, y: 0 }, pocketed: false };

      ctx.save();
      ctx.translate(current.x, current.y);
      ctx.scale(scaleAmount, scaleAmount);
      ctx.translate(-current.x, -current.y);
      drawBall(ctx, renderBall, alpha);
      ctx.globalAlpha = alpha * 0.25;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.arc(anim.pocketPos.x, anim.pocketPos.y, BALL_RADIUS * (0.85 + eased * 0.15), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    pocketFlashesRef.current = pocketFlashesRef.current.filter((flash) => now - flash.startTime < flash.durationMs);
    for (const flash of pocketFlashesRef.current) {
      const progress = Math.min(1, (now - flash.startTime) / flash.durationMs);
      const radius = BALL_RADIUS * (0.7 + progress * 1.8);
      const alpha = 0.26 * (1 - progress);
      const flashGrad = ctx.createRadialGradient(
        flash.pocketPos.x,
        flash.pocketPos.y,
        radius * 0.2,
        flash.pocketPos.x,
        flash.pocketPos.y,
        radius,
      );
      flashGrad.addColorStop(0, `rgba(255,244,214,${alpha})`);
      flashGrad.addColorStop(1, 'rgba(255,244,214,0)');
      ctx.fillStyle = flashGrad;
      ctx.beginPath();
      ctx.arc(flash.pocketPos.x, flash.pocketPos.y, radius, 0, Math.PI * 2);
      ctx.fill();

      // Pot juice: a thin ticket-amber ring snapping outward from the pocket.
      // Suppressed under reduced motion (functional drop + soft flash remain).
      if (!reduceMotionRef.current) {
        const ringR = BALL_RADIUS * (0.6 + easeOutCubic(progress) * 2.1);
        const ringA = 0.5 * (1 - progress);
        ctx.strokeStyle = `rgba(242,163,60,${ringA})`;
        ctx.lineWidth = 2 * (1 - progress) + 0.6;
        ctx.beginPath();
        ctx.arc(flash.pocketPos.x, flash.pocketPos.y, ringR, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // ── Cushion impact ripples (juice) ──────────────────────────────────
    // In-place compaction (no per-frame array allocation): keep only live
    // entries, then draw each as a brief warm radial spark on the rail line.
    {
      const flashes = cushionFlashesRef.current;
      let w = 0;
      for (let i = 0; i < flashes.length; i++) {
        const f = flashes[i];
        if (now - f.startTime < f.durationMs) {
          if (w !== i) flashes[w] = f;
          w++;
        }
      }
      flashes.length = w;
      for (let i = 0; i < flashes.length; i++) {
        const f = flashes[i];
        const progress = Math.min(1, (now - f.startTime) / f.durationMs);
        const radius = BALL_RADIUS * (0.4 + easeOutCubic(progress) * (0.9 + f.strength * 0.9));
        const alpha = (0.32 + f.strength * 0.2) * (1 - progress);
        const grad = ctx.createRadialGradient(f.pos.x, f.pos.y, 0, f.pos.x, f.pos.y, radius);
        grad.addColorStop(0, `rgba(246,237,220,${alpha})`);
        grad.addColorStop(0.6, `rgba(214,196,154,${alpha * 0.5})`);
        grad.addColorStop(1, 'rgba(214,196,154,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(f.pos.x, f.pos.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const highlightSet = highlightBallIds ? new Set(highlightBallIds) : null;
    const sortedBalls = [...currentBalls]
      .filter((ball) => !ball.pocketed)
      .sort((a, b) => a.pos.y - b.pos.y);
    for (const ball of sortedBalls) {
      drawBall(ctx, ball, 1, highlightSet?.has(ball.id) ?? false);
    }

    // Spin indicator — small colored dot on the cue ball showing strike point.
    // Research: Miniclip 8 Ball Pool shows the strike point on the cue ball
    // during aiming, reinforcing the spin selection and building intuition.
    if (spinIndicator && (Math.abs(spinIndicator.x) > 0.05 || Math.abs(spinIndicator.y) > 0.05)) {
      const cueBall = currentBalls.find((b) => b.id === 0 && !b.pocketed);
      if (cueBall) {
        const dotR = BALL_RADIUS * 0.22;
        const offsetScale = BALL_RADIUS * 0.55;
        // The dot sits where the spin control shows it on screen: right for
        // right english, up for follow. On the upright table, screen right
        // is the table's +y and screen up is its +x.
        const dotX = uprightRef.current
          ? cueBall.pos.x + spinIndicator.y * offsetScale
          : cueBall.pos.x + spinIndicator.x * offsetScale;
        const dotY = uprightRef.current
          ? cueBall.pos.y + spinIndicator.x * offsetScale
          : cueBall.pos.y - spinIndicator.y * offsetScale;
        // Enamel danger / info / prize — matches the spin selector tokens.
        const dotColor = Math.abs(spinIndicator.y) > 0.05
          ? (spinIndicator.y > 0 ? 'rgba(199,53,56,0.75)' : 'rgba(108,143,224,0.75)')
          : 'rgba(47,184,166,0.75)';
        ctx.fillStyle = dotColor;
        ctx.beginPath();
        ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    }

    if (ballInHandPreview) {
      const pulse = 0.9 + Math.sin(now / 140) * 0.05;
      if (ballInHandValid) {
        ctx.save();
        ctx.translate(ballInHandPreview.x, ballInHandPreview.y);
        ctx.scale(pulse, pulse);
        ctx.translate(-ballInHandPreview.x, -ballInHandPreview.y);
        drawBall(ctx, {
          id: 0,
          pos: ballInHandPreview,
          vel: { x: 0, y: 0 },
          pocketed: false,
        }, 0.52);
        ctx.restore();
      } else {
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = '#c73538';
        ctx.beginPath();
        ctx.arc(ballInHandPreview.x, ballInHandPreview.y, BALL_RADIUS * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#98262a';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    drawAiming(ctx, options?.transientCue ?? null);
    if (replayOverlay) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const margin = Math.round(12 * dpr);
      const maxPanelWidth = canvas.width * 0.46;
      drawOverlayPanel(ctx, replayOverlay.topLeftLines, {
        x: margin,
        y: margin,
        align: 'left',
        maxWidth: maxPanelWidth,
        dpr,
      });
      drawOverlayPanel(ctx, replayOverlay.topRightLines, {
        x: canvas.width - margin,
        y: margin,
        align: 'right',
        maxWidth: maxPanelWidth,
        dpr,
      });
      drawReplayShotControlDock(ctx, {
        x: margin,
        y: canvas.height - margin - Math.round(92 * dpr),
        dpr,
        powerRatio: replayOverlay.powerRatio,
        spin: replayOverlay.spin,
      });
    }
  }, [
    ballInHandPreview,
    ballInHandValid,
    canvasSize,
    drawAiming,
    drawBall,
    drawTable,
    highlightBallIds,
    replayOverlay,
    spinIndicator,
  ]);

  useEffect(() => {
    if (!isAnimatingRef.current) {
      // Between chained bot shots, use override balls so the static frame
      // doesn't flash the pre-chain ball positions.
      render(animBallsOverride ?? balls);
    }
  }, [balls, animBallsOverride, render, ballInHandPreview, cueStick, aimLine, aimPath, ghostBall, targetLine, cueDeflectionLine, spinIndicator]);

  useEffect(() => {
    if (!animateShot) {
      isAnimatingRef.current = false;
      return;
    }

    isAnimatingRef.current = true;
    // Use override balls (from chained bot shots) if provided, otherwise use prop balls.
    // This bypasses React state propagation timing issues between chained animations.
    const animBalls = animBallsOverride ?? balls;
    seenPocketedRef.current = new Set(animBalls.filter((ball) => ball.pocketed).map((ball) => ball.id));
    pocketAnimsRef.current.clear();
    pocketFlashesRef.current = [];
    cushionFlashesRef.current = [];
    ballRollRef.current.clear();

    const result = simulateShot(animBalls, animateShot);
    const frames = result.frames;
    const soundEvents: SoundEvent[] = result.events ?? [];
    let nextSoundIdx = 0;
    let cueStrikePlayed = false;
    let firstImpactSent = false;
    const isBreak = isRackedTable(animBalls);
    // Time the hit-stop held the clock. Subtracted from the elapsed time,
    // so the animation resumes where it paused, with no catch-up burst.
    let frozenMs = 0;
    let lastTickAt: number | null = null;
    const cueBall = animBalls.find((ball) => ball.id === 0);
    const cuePos = animateShot.cuePosition ?? cueBall?.pos ?? { x: TABLE_WIDTH / 4, y: TABLE_HEIGHT / 2 };
    const animationStart = performance.now();

    // Accumulate the 2D rolling fake from interpolated displacement: the
    // roll angle advances by surface travel over BALL_RADIUS, about the axis
    // perpendicular to the motion direction.
    const updateRollStates = (interpolated: Ball[]) => {
      for (const b of interpolated) {
        if (b.id === 0 || b.pocketed) continue;
        const st = ballRollRef.current.get(b.id);
        if (!st) {
          // Start in the orientation the static render shows: stripe band
          // across the center, number disk facing the viewer.
          ballRollRef.current.set(b.id, {
            phase: Math.PI / 2,
            dirX: 0,
            dirY: 1,
            lastX: b.pos.x,
            lastY: b.pos.y,
          });
          continue;
        }
        const dx = b.pos.x - st.lastX;
        const dy = b.pos.y - st.lastY;
        const dist = Math.hypot(dx, dy);
        st.lastX = b.pos.x;
        st.lastY = b.pos.y;
        if (dist < 0.05) continue;
        st.phase = (st.phase + dist / BALL_RADIUS) % (Math.PI * 2);
        // Ease the roll axis toward the current motion direction so cushion
        // bounces reorient the markings smoothly instead of snapping.
        const blend = Math.min(1, dist / (BALL_RADIUS * 1.5));
        let nx = st.dirX + (dx / dist - st.dirX) * blend;
        let ny = st.dirY + (dy / dist - st.dirY) * blend;
        const n = Math.hypot(nx, ny);
        if (n < 0.05) {
          // Direction reversed through zero (straight cushion bounce-back).
          nx = dx / dist;
          ny = dy / dist;
        } else {
          nx /= n;
          ny /= n;
        }
        st.dirX = nx;
        st.dirY = ny;
      }
    };

    const buildInterpolatedBalls = (frameIndex: number, alpha: number): Ball[] => {
      const currentFrame = frames[Math.min(frameIndex, frames.length - 1)] ?? [];
      const nextFrame = frames[Math.min(frameIndex + 1, frames.length - 1)] ?? currentFrame;

      const interpolated = animBalls.map((ball) => {
        const current = currentFrame.find((entry) => entry.id === ball.id);
        const next = nextFrame.find((entry) => entry.id === ball.id);

        if (current && next) {
          return {
            id: ball.id,
            pos: {
              x: lerp(current.x, next.x, alpha),
              y: lerp(current.y, next.y, alpha),
            },
            vel: { x: 0, y: 0 },
            pocketed: false,
          };
        }

        if (current) {
          return {
            id: ball.id,
            pos: { x: current.x, y: current.y },
            vel: { x: 0, y: 0 },
            pocketed: true,
          };
        }

        return { ...cloneBall(ball), pocketed: true, vel: { x: 0, y: 0 } };
      });
      updateRollStates(interpolated);
      return interpolated;
    };

    const speed = Number.isFinite(animationSpeed)
      ? Math.max(0.25, Math.min(120, animationSpeed))
      : 1;

    const emit = (event: PoolFeelEvent) => {
      if (speed > 4) return; // fast replay export: no feel
      feelRef.current?.onEvent?.(event);
    };

    const tick = (now: number) => {
      const hitStop = speed <= 4 ? feelRef.current?.hitStop : undefined;
      if (hitStop && lastTickAt !== null) frozenMs += hitStop.frozenWithin(lastTickAt, now);
      lastTickAt = now;
      const rawElapsed = Math.max(0, now - animationStart - frozenMs);
      const elapsed = rawElapsed * speed;
      const cueProgress = Math.min(1, elapsed / CUE_STRIKE_TOTAL_MS);
      const simElapsed = Math.max(0, elapsed - CUE_BALL_LAUNCH_DELAY_MS);
      const framePosition = simElapsed / PHYSICS_FRAME_MS;
      const frameIndex = Math.floor(framePosition);
      const alpha = framePosition - frameIndex;

      // ── Sound playback ──────────────────────────────────────
      if (!cueStrikePlayed && elapsed >= CUE_BALL_LAUNCH_DELAY_MS) {
        // The crack scales with the hit: a soft tap is a third of a break.
        if (!muteAnimationSound) {
          const cueStrikeVol = Math.min(1, 0.3 + Math.pow(animateShot.power, 0.8) * 0.75);
          SoundManager.play('cueStrike', { volume: cueStrikeVol });
        }
        cueStrikePlayed = true;
        emit({ type: 'strike', power: animateShot.power, isBreak });
      }
      // Drain events up to the current frame. Sound is gated on mute; the
      // decorative cushion ripple is gated on reduced-motion + playback speed
      // (skipped during fast replay export) but is independent of mute so the
      // visual still fires when sound is suppressed.
      const wantJuice = !reduceMotionRef.current && speed <= 4;
      while (nextSoundIdx < soundEvents.length && soundEvents[nextSoundIdx].frame <= frameIndex) {
        const evt = soundEvents[nextSoundIdx++];
        if (evt.type === 'ballCollision') {
          if (!firstImpactSent) {
            firstImpactSent = true;
            emit({ type: 'impact', power: animateShot.power, isBreak });
          }
          if (!muteAnimationSound) {
            const speedNorm = Math.min(1, evt.speed / (MAX_POWER * 0.82));
            const vol = Math.min(1, Math.max(0.12, Math.pow(speedNorm, 0.75) * (0.84 + animateShot.power * 0.28)));
            SoundManager.play('ballCollision', { volume: vol });
          }
        } else if (evt.type === 'cushionHit') {
          const speedNorm = Math.min(1, evt.speed / (MAX_POWER * 0.7));
          if (!muteAnimationSound) {
            const vol = Math.min(1, Math.max(0.1, Math.pow(speedNorm, 0.8) * (0.74 + animateShot.power * 0.22)));
            SoundManager.play('cushionHit', { volume: vol });
          }
          // Spark at the impact: take the striking ball's frame position and
          // snap it to the nearest cushion line, then push a transient flash.
          if (wantJuice && evt.ballIds.length > 0) {
            const evtFrame = frames[Math.min(evt.frame, frames.length - 1)];
            const hitBall = evtFrame?.find((b) => b.id === evt.ballIds[0]);
            if (hitBall) {
              const px = Math.max(CUSHION_WIDTH, Math.min(TABLE_WIDTH - CUSHION_WIDTH, hitBall.x));
              const py = Math.max(CUSHION_WIDTH, Math.min(TABLE_HEIGHT - CUSHION_WIDTH, hitBall.y));
              const dLeft = px - CUSHION_WIDTH;
              const dRight = TABLE_WIDTH - CUSHION_WIDTH - px;
              const dTop = py - CUSHION_WIDTH;
              const dBottom = TABLE_HEIGHT - CUSHION_WIDTH - py;
              const minD = Math.min(dLeft, dRight, dTop, dBottom);
              const fx = minD === dLeft ? CUSHION_WIDTH : minD === dRight ? TABLE_WIDTH - CUSHION_WIDTH : px;
              const fy = minD === dTop ? CUSHION_WIDTH : minD === dBottom ? TABLE_HEIGHT - CUSHION_WIDTH : py;
              const flashes = cushionFlashesRef.current;
              // Fixed-capacity ring buffer (8) — overwrite the oldest, never grow.
              const slot = flashes.length < 8 ? flashes.length : nextSoundIdx % 8;
              const entry: CushionFlash = {
                pos: { x: fx, y: fy },
                startTime: now,
                durationMs: CUSHION_FLASH_MS,
                strength: speedNorm,
              };
              if (slot < flashes.length) flashes[slot] = entry;
              else flashes.push(entry);
            }
          }
        } else if (evt.type === 'pocketed') {
          if (!muteAnimationSound) SoundManager.play('poolPocket');
          const potted = evt.ballIds[0];
          if (typeof potted === 'number') emit({ type: 'pot', ballId: potted });
        }
      }

      const transientCue = cueProgress < 1
        ? {
            angle: animateShot.angle,
            power: animateShot.power,
            cuePos,
            progress: cueProgress,
            opacity: 1 - Math.max(0, cueProgress - 0.78) / 0.22,
            ...(animShotCueTheme ? {
              cueColor: animShotCueTheme.cueColor,
              cueTipColor: animShotCueTheme.cueTipColor,
              cueGlow: animShotCueTheme.cueGlow,
              cueGlowColor: animShotCueTheme.cueGlowColor,
            } : {}),
          }
        : null;

      if (frameIndex >= frames.length - 1) {
        render(buildInterpolatedBalls(frames.length - 1, 0), { transientCue });
        if (pocketAnimsRef.current.size > 0 && speed <= 4) {
          return;
        }
        // High-speed/export playback: don't stall on pocket FX tails.
        if (speed > 4) {
          pocketAnimsRef.current.clear();
          pocketFlashesRef.current = [];
        }
        isAnimatingRef.current = false;
        frameLoop.stop();
        onAnimationEnd?.(result.finalBalls);
        return;
      }

      render(buildInterpolatedBalls(frameIndex, alpha), { transientCue });
    };

    const frameLoop = createGameFrameLoop({
      // Pool physics is deterministically precomputed by simulateShot at 60 Hz;
      // the shared loop owns visibility/lifecycle and paints interpolated frames.
      stepMs: PHYSICS_FRAME_MS,
      simulate: () => true,
      render: (_alpha, info) => tick(info.nowMs),
    });
    frameLoop.start();
    return () => frameLoop.destroy();
  }, [animateShot, animationSpeed, muteAnimationSound, animShotCueTheme, balls, animBallsOverride, render, onAnimationEnd]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (isAnimatingRef.current) return;
    e.preventDefault(); // prevent scroll/zoom on touch devices
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const pos = screenToTable(e.clientX, e.clientY);
    if (pos) onCanvasInteraction?.(pos, e.pointerType);
  }, [screenToTable, onCanvasInteraction]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (isAnimatingRef.current) return;
    const pos = screenToTable(e.clientX, e.clientY);
    if (pos) onCanvasMove?.(pos);
  }, [screenToTable, onCanvasMove]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (isAnimatingRef.current) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    onCanvasRelease?.();
  }, [onCanvasRelease]);

  const handlePointerCancel = useCallback((e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    // Cancel aborts the shot — does NOT fire onCanvasRelease (which submits)
    onCanvasCancel?.();
  }, [onCanvasCancel]);

  return (
    <div ref={containerRef} className={fitBox ? 'grid h-full w-full place-items-center' : 'w-full'}>
      <canvas
        ref={canvasRef}
        className={canvasClassName ?? 'mx-auto block cursor-crosshair rounded-cabinet'}
        style={fitBox ? {
          width: canvasSize.width,
          height: canvasSize.height,
          touchAction: 'none',
        } : {
          width: canvasSize.width,
          height: canvasSize.height,
          touchAction: 'none',
          // Midway cabinet: hard offset shadow + warm top-edge bevel, no glow.
          border: '1px solid var(--border-ink)',
          boxShadow:
            'inset 0 1px 0 var(--bevel-hi), 0 8px 0 var(--shadow-color), 0 12px 28px rgba(0,0,0,0.55)',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      />
    </div>
  );
}
