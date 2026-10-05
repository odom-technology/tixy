'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Axe, CircleHelp, ChevronLeft, ChevronRight, TreePine, Timer } from 'lucide-react';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import { PageHeader, GamesWalletCard } from '@/features/arcade/components/shell/page-header';
import { MuteButton } from '@/features/arcade/components/mute-button';
import { EnvMonitor } from '@/features/arcade/lib/game-anti-cheat';
import { usePreventGameGestures, useIsTouchDevice } from '@/features/arcade/lib/game-mobile-utils';
import { playHaptic } from '@/features/arcade/lib/game-haptics';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import {
  PHYSICS_DT_MS,
  createGameFrameLoop,
  type GameFrameLoop,
  getGame2dContext,
  gameCanvasDpr,
} from '@/features/arcade/lib/game-frame-loop';
import { ArcadeRunRewards } from '@/features/arcade/components/results/arcade-run-result';
import { useArcadeRunResult } from '@/features/arcade/lib/run-result';
import type { AccountXpReward } from '@/server/arcade/rewards/types';
import {
  logSplitterBranchFor,
  logSplitterApplyChop,
  logSplitterInitialState,
  logSplitterDrainRate,
  LOG_SPLITTER_BAR_MAX,
  LOG_SPLITTER_MAX_CHOPS,
  LOG_SPLITTER_MAX_EVENTS,
  type LogSplitterSide,
  type LogSplitterSimState,
} from '@/server/arcade/log-splitter-replay';
import {
  DEFAULT_LOG_SPLITTER_THEME,
  buildLogSplitterTheme,
  type InventoryCosmeticResponse,
  type LogSplitterCosmeticTheme,
} from './_log-splitter-theme';

import './_log-splitter.css';

// ── Logical stage (portrait — a vertical tree the lumberjack chops from below).
const BASE_WIDTH = 440;
const BASE_HEIGHT = 660;
const FRAME_TIME = PHYSICS_DT_MS;

const CX = BASE_WIDTH / 2;
const TRUNK_W = 96;
const SEG_H = 86;
const GROUND_Y = BASE_HEIGHT - 92; // top of the ground / chopper stance line
const CHOPPER_W = 74;
const BAR_X = 26;
const BAR_Y = 22;
const BAR_W = BASE_WIDTH - 52;
const BAR_H = 20;

const RESTART_GRACE_PERIOD = 420;
const MILESTONE_EVERY = 25;

const REWARDS_HINT_TEXT =
  'Rewards hint: score = logs chopped. Tap the side WITHOUT a branch to chop and switch to that side; every chop refills the draining time bar, which drains faster the deeper you go. One chop into a branch — or letting the bar empty — ends the run. More chops earns more tickets; rewards taper at higher scores.';

// Distinct existing SoundManager names mapped to log-splitter moments.
const SFX = {
  chop: 'arcadeBet',
  switch: 'arcadeReelStop',
  milestone: 'coinStreakMilestone',
  struck: 'coinWrong',
  crash: 'arcadeCrash',
  start: 'arcadeReveal',
  timeout: 'arcadeLose',
  over: 'arcadeLose',
} as const;

type GameState = 'idle' | 'playing' | 'gameover' | 'error';
type DeathCause = 'struck' | 'timeout' | null;

type RecordedChop = { side: LogSplitterSide; t: number };

// matter-js is loaded lazily (dynamic import at mount, same pattern as swerve)
// and used ONLY for render-side debris — chips, chopped log halves and the
// "Timber!" trunk collapse. It never touches the deterministic sim.
type MatterModule = typeof import('matter-js');

// A physics-driven debris piece (render-only). `life` starts counting down once
// the piece has mostly settled, fading it out before removal.
type Debris = {
  body: import('matter-js').Body;
  kind: 'chip' | 'log' | 'segment';
  w: number;
  h: number;
  color: string;
  branch: LogSplitterSide | 'N';
  life: number;
  settledFrames: number;
};

// Self-playing idle demo shown behind the start overlay: it teaches the loop
// (chop the branch-free side) with zero text. Pure render state.
type DemoState = {
  seed: number;
  chops: number;
  side: LogSplitterSide;
  lastChopAt: number;
  swing: number;
  drop: number;
};

// A short-lived wood-chip burst when a log is chopped. Render-only.
type Chip = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  life: number;
  size: number;
  color: string;
};

// A chopped log segment that flies off to the side. Render-only.
type FlyingLog = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  life: number;
  branch: LogSplitterSide | 'N';
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
  if (typeof data?.details === 'string' && data.details.trim()) return data.details;
  if (typeof data?.error === 'string' && data.error.trim()) return data.error;
  return 'Could not save the run. Try again.';
};

// Ignore gameplay keys while real UI owns focus (modal, buttons, inputs) —
// mirrors high-striker so Space/Enter on a focused control can't restart a run.
const blocksGameKeyboard = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target.isContentEditable ||
    target.closest('input, textarea, select, button, a[href], [role="dialog"]')
  ) return true;
  return Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
};

// ── Paint helpers (all take the resolved theme `c` so cosmetics flow straight in).

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

// Sky + distant hills + ground band.
const paintScene = (ctx: CanvasRenderingContext2D, c: LogSplitterCosmeticTheme) => {
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  sky.addColorStop(0, c.skyTop);
  sky.addColorStop(1, c.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, BASE_WIDTH, GROUND_Y);

  // Soft hill silhouette just above the ground.
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = c.groundEdge;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y);
  ctx.quadraticCurveTo(BASE_WIDTH * 0.28, GROUND_Y - 54, BASE_WIDTH * 0.5, GROUND_Y - 18);
  ctx.quadraticCurveTo(BASE_WIDTH * 0.74, GROUND_Y - 60, BASE_WIDTH, GROUND_Y - 12);
  ctx.lineTo(BASE_WIDTH, GROUND_Y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Ground band.
  const g = ctx.createLinearGradient(0, GROUND_Y, 0, BASE_HEIGHT);
  g.addColorStop(0, c.ground);
  g.addColorStop(1, c.groundEdge);
  ctx.fillStyle = g;
  ctx.fillRect(0, GROUND_Y, BASE_WIDTH, BASE_HEIGHT - GROUND_Y);
  // Grass lip.
  ctx.fillStyle = c.accent;
  ctx.globalAlpha = 0.5;
  ctx.fillRect(0, GROUND_Y - 2, BASE_WIDTH, 3);
  ctx.globalAlpha = 1;
};

// One trunk segment with a couple of grain lines + an end-grain ring cap look.
const paintTrunkSegment = (
  ctx: CanvasRenderingContext2D,
  c: LogSplitterCosmeticTheme,
  yCenter: number,
) => {
  const x = CX - TRUNK_W / 2;
  const y = yCenter - SEG_H / 2;
  const bark = ctx.createLinearGradient(x, 0, x + TRUNK_W, 0);
  bark.addColorStop(0, c.barkLo);
  bark.addColorStop(0.2, c.barkColor);
  bark.addColorStop(0.5, c.barkHi);
  bark.addColorStop(0.8, c.barkColor);
  bark.addColorStop(1, c.barkLo);
  ctx.fillStyle = bark;
  ctx.fillRect(x, y, TRUNK_W, SEG_H + 1);
  // Bark grain lines.
  ctx.strokeStyle = c.grain;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.5;
  for (const gx of [0.32, 0.52, 0.72]) {
    ctx.beginPath();
    ctx.moveTo(x + TRUNK_W * gx, y + 4);
    ctx.lineTo(x + TRUNK_W * gx + Math.sin(yCenter * 0.05) * 3, y + SEG_H - 4);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Segment seam (dark line at the top join).
  ctx.strokeStyle = c.barkLo;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + TRUNK_W, y);
  ctx.stroke();
};

// A branch sticking out on one side, with two small twigs. `pulse` (0..1) draws
// a soft danger outline on the row the next chop can hit — pure readability.
const paintBranch = (
  ctx: CanvasRenderingContext2D,
  c: LogSplitterCosmeticTheme,
  yCenter: number,
  side: LogSplitterSide,
  flash: number,
  pulse = 0,
) => {
  const dir = side === 'L' ? -1 : 1;
  const rootX = CX + dir * (TRUNK_W / 2 - 2);
  const len = 96;
  const thick = 22;
  ctx.save();
  ctx.translate(rootX, yCenter);
  ctx.scale(dir, 1);
  // Danger telegraph: pulsing outline behind the limb on the live row.
  if (pulse > 0) {
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = '#e0483a';
    ctx.lineWidth = 6;
    roundRectPath(ctx, -3, -thick / 2 - 3, len + 6, thick + 6, 11);
    ctx.stroke();
    ctx.restore();
  }
  // Main limb.
  const limb = ctx.createLinearGradient(0, -thick / 2, 0, thick / 2);
  limb.addColorStop(0, c.branchHi);
  limb.addColorStop(0.5, c.branchColor);
  limb.addColorStop(1, c.branchEdge);
  ctx.fillStyle = flash > 0 ? '#e0483a' : limb;
  roundRectPath(ctx, 0, -thick / 2, len, thick, 8);
  ctx.fill();
  ctx.strokeStyle = c.branchEdge;
  ctx.lineWidth = 2;
  ctx.stroke();
  // Two upward twigs with leaf clumps.
  ctx.strokeStyle = c.branchColor;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  for (const [tx, ty] of [[len * 0.55, -26], [len * 0.85, -20]] as const) {
    ctx.beginPath();
    ctx.moveTo(tx, -thick / 2 + 2);
    ctx.lineTo(tx + 6, ty);
    ctx.stroke();
    ctx.fillStyle = flash > 0 ? '#e0483a' : c.accent;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(tx + 6, ty - 2, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
};

// The lumberjack + axe on one side of the trunk base. `swing` 0..1 drives the
// axe strike; `hurt` tints the body red on a fatal strike.
const paintChopper = (
  ctx: CanvasRenderingContext2D,
  c: LogSplitterCosmeticTheme,
  side: LogSplitterSide,
  swing: number,
  hurt: number,
  reducedMotion: boolean,
) => {
  const dir = side === 'L' ? -1 : 1;
  // Stand just off the trunk on the chopper's side.
  const footX = CX + dir * (TRUNK_W / 2 + CHOPPER_W / 2 + 4);
  const baseY = GROUND_Y - 4;
  ctx.save();
  ctx.translate(footX, baseY);
  ctx.scale(dir, 1); // face the trunk

  const shirt = hurt > 0 ? '#c33b3c' : c.shirtColor;

  // Legs.
  ctx.fillStyle = c.ink;
  ctx.fillRect(-16, -34, 12, 34);
  ctx.fillRect(4, -34, 12, 34);
  // Boots.
  ctx.fillStyle = c.branchEdge;
  ctx.fillRect(-18, -8, 16, 8);
  ctx.fillRect(2, -8, 16, 8);
  // Torso (flannel).
  ctx.fillStyle = shirt;
  roundRectPath(ctx, -20, -78, 40, 48, 8);
  ctx.fill();
  // Plaid lines.
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 2;
  for (const px of [-10, 2, 12]) {
    ctx.beginPath();
    ctx.moveTo(px, -76);
    ctx.lineTo(px, -32);
    ctx.stroke();
  }
  for (const py of [-64, -50, -38]) {
    ctx.beginPath();
    ctx.moveTo(-18, py);
    ctx.lineTo(18, py);
    ctx.stroke();
  }
  // Head + beanie.
  ctx.fillStyle = c.skinColor;
  ctx.beginPath();
  ctx.arc(6, -90, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = c.branchEdge;
  roundRectPath(ctx, -8, -106, 28, 14, 6);
  ctx.fill();
  // Beard.
  ctx.fillStyle = hurt > 0 ? '#7a2a1a' : c.handleColor;
  ctx.beginPath();
  ctx.arc(9, -82, 9, 0, Math.PI);
  ctx.fill();

  // Arms + axe, rotated by the swing (rest angle raised, strike angle down).
  // The strike itself lands on the tap (zero latency); the RETURN arc is the
  // animation: eased power curve + a small recoil wobble as it re-cocks.
  const rest = -1.15; // radians, axe cocked back/up
  const strike = 0.5;
  const eased = Math.pow(swing, 1.6);
  const wobble = reducedMotion ? 0 : Math.sin((1 - swing) * 9) * 0.07 * swing;
  const ang = reducedMotion ? strike * swing : rest + (strike - rest) * eased + wobble;
  // Motion-blur trail: a translucent wedge sweeping the arc just after impact.
  if (!reducedMotion && swing > 0.35) {
    ctx.save();
    ctx.translate(10, -66);
    ctx.globalAlpha = (swing - 0.35) * 0.5;
    ctx.fillStyle = c.bladeHi;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 76, ang - 0.55 * swing, ang, false);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  ctx.translate(10, -66); // shoulder pivot
  ctx.rotate(ang);
  // Arm.
  ctx.strokeStyle = shirt;
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(30, 6);
  ctx.stroke();
  // Axe handle.
  ctx.strokeStyle = c.handleColor;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(24, 4);
  ctx.lineTo(64, 12);
  ctx.stroke();
  // Axe head.
  if (c.axeGlowEnabled && !reducedMotion) {
    ctx.save();
    ctx.shadowColor = c.axeGlowColor;
    ctx.shadowBlur = 16;
  }
  const blade = ctx.createLinearGradient(58, 0, 78, 24);
  blade.addColorStop(0, c.bladeHi);
  blade.addColorStop(1, c.bladeEdge);
  ctx.fillStyle = blade;
  ctx.beginPath();
  ctx.moveTo(62, 2);
  ctx.lineTo(82, 6);
  ctx.lineTo(84, 22);
  ctx.lineTo(64, 20);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = c.bladeEdge;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Blade shine.
  ctx.strokeStyle = c.bladeHi;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(66, 8);
  ctx.lineTo(80, 11);
  ctx.stroke();
  if (c.axeGlowEnabled && !reducedMotion) ctx.restore();
  ctx.restore();

  ctx.restore();
};

export default function LogSplitterClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [gameState, setGameState] = useState<GameState>('idle');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [leftPressed, setLeftPressed] = useState(false);
  const [rightPressed, setRightPressed] = useState(false);

  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [walletBalances, setWalletBalances] = useState({ credits: 0 });
  const [dailyCreditsProgress, setDailyCreditsProgress] = useState({ earned: 0, cap: 300 });
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
  const [theme, setTheme] = useState<LogSplitterCosmeticTheme>(DEFAULT_LOG_SPLITTER_THEME);
  const [canvasSize, setCanvasSize] = useState({ width: BASE_WIDTH, height: BASE_HEIGHT, dpr: 1 });

  const touchDevice = useIsTouchDevice();

  usePreventGameGestures(gameState === 'playing');

  // ── Refs (mutable sim state; no re-render) ──
  const gameStateRef = useRef<GameState>('idle');
  const sessionTokenRef = useRef<string | null>(null);
  const seedRef = useRef<number | null>(null);
  const envMonitorRef = useRef(new EnvMonitor());
  const isStartingRef = useRef(false);
  const isGuestRunRef = useRef(false);

  // Authoritative sim state — advanced ONLY through logSplitterApplyChop.
  const simRef = useRef<LogSplitterSimState>(logSplitterInitialState());
  const scoreRef = useRef(0);
  const runStartRef = useRef(0); // performance.now() at run start
  const chopsRef = useRef<RecordedChop[]>([]);
  const chopperSideRef = useRef<LogSplitterSide>('L');

  const frameLoopRef = useRef<GameFrameLoop | null>(null);
  const scaleRef = useRef(1);
  const gameOverTimeRef = useRef<number>(0);
  const chipsRef = useRef<Chip[]>([]);
  const flyingRef = useRef<FlyingLog[]>([]);
  const matterModRef = useRef<MatterModule | null>(null);
  const matterEngineRef = useRef<import('matter-js').Engine | null>(null);
  const debrisRef = useRef<Debris[]>([]);
  const impactRef = useRef(0); // 0..1 chop impact flash envelope
  const impactYRef = useRef(0); // cut height of the last impact
  const kickRef = useRef({ x: 0, y: 0 }); // directional camera kick on chop
  const barFlashRef = useRef(0); // 0..1 time-bar refill flash
  const scorePopRef = useRef(0); // 0..1 score bump + "+1" flash on each chop
  const milestoneRef = useRef(0); // 0..1 golden milestone banner envelope
  const milestoneValueRef = useRef(0); // chop count the banner celebrates
  const hitStopRef = useRef(0); // frames to freeze decorative envelopes at peak
  const demoRef = useRef<DemoState>({
    seed: 987654321,
    chops: 0,
    side: 'L',
    lastChopAt: 0,
    swing: 0,
    drop: 0,
  });
  const reducedMotionRef = useRef(false);
  const swingRef = useRef(0); // 0..1 axe strike envelope
  const dropRef = useRef(0); // 0..1 trunk descend ease
  const hurtRef = useRef(0); // 0..1 fatal-strike red tint
  const shakeRef = useRef(0); // 0..1 screen shake on death
  const deathCauseRef = useRef<DeathCause>(null);
  const deathBranchRef = useRef<LogSplitterSide | null>(null);
  const displayBarRef = useRef(LOG_SPLITTER_BAR_MAX);
  const saveScoreRef = useRef<
    ((score: number, chops: RecordedChop[], durMs: number) => Promise<void>) | null
  >(null);
  const endRunRef = useRef<((cause: DeathCause) => void) | null>(null);
  const drawRef = useRef<((ctx: CanvasRenderingContext2D) => void) | null>(null);
  const bestScoreCacheRef = useRef<number | null>(null);
  const themeRef = useRef<LogSplitterCosmeticTheme>(DEFAULT_LOG_SPLITTER_THEME);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

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
      const response = await fetch('/api/games/log-splitter/score', { cache: 'no-store' });
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
      const response = await fetch('/api/store/inventory?gameType=log-splitter', {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = (await response.json()) as InventoryCosmeticResponse;
      setWalletBalances({ credits: payload.wallet?.credits ?? 0 });
      setDailyCreditsProgress({
        earned: payload.dailyGameCredits?.earned ?? 0,
        cap: payload.dailyGameCredits?.cap ?? 300,
      });
      setTheme(buildLogSplitterTheme(payload));
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
    chops: RecordedChop[],
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
      const response = await fetch('/api/games/log-splitter/score', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: finalScore,
          sessionToken: sessionTokenRef.current,
          chops,
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
        console.error(`[LogSplitter] Score rejected (${response.status}): ${reason}`);
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

  // ── matter-js debris world (render-only; the deterministic sim never sees it).
  //    Created lazily once the dynamic import lands; one static ground plane so
  //    chips and log halves bounce, tumble and settle instead of ghosting away.
  const ensureMatterWorld = useCallback((): import('matter-js').Engine | null => {
    const M = matterModRef.current;
    if (!M) return null;
    if (matterEngineRef.current) return matterEngineRef.current;
    const engine = M.Engine.create();
    engine.gravity.y = 1.35;
    const ground = M.Bodies.rectangle(CX, GROUND_Y + 26, BASE_WIDTH * 2.4, 60, {
      isStatic: true,
      friction: 0.9,
    });
    M.Composite.add(engine.world, ground);
    matterEngineRef.current = engine;
    return engine;
  }, []);

  const addDebris = useCallback(
    (piece: Omit<Debris, 'settledFrames'>, capOfKind: number) => {
      const M = matterModRef.current;
      const engine = matterEngineRef.current;
      if (!M || !engine) return;
      const ofKind = debrisRef.current.filter((d) => d.kind === piece.kind);
      if (ofKind.length >= capOfKind) {
        const oldest = ofKind[0]!;
        M.Composite.remove(engine.world, oldest.body);
        const idx = debrisRef.current.indexOf(oldest);
        if (idx >= 0) debrisRef.current.splice(idx, 1);
      }
      M.Composite.add(engine.world, piece.body);
      debrisRef.current.push({ ...piece, settledFrames: 0 });
    },
    [],
  );

  const clearDebris = useCallback(() => {
    const M = matterModRef.current;
    const engine = matterEngineRef.current;
    if (M && engine) {
      for (const d of debrisRef.current) M.Composite.remove(engine.world, d.body);
    }
    debrisRef.current = [];
  }, []);

  // Spawn a wood-chip burst at the trunk base on the chop side. Render-only.
  const spawnChips = useCallback(
    (side: LogSplitterSide, yCenter: number, count: number) => {
      if (reducedMotionRef.current) return;
      const c = themeRef.current;
      const dir = side === 'L' ? -1 : 1;
      const x = CX + dir * (TRUNK_W / 2 - 6);
      const M = matterModRef.current;
      const engine = ensureMatterWorld();
      if (M && engine) {
        for (let i = 0; i < count; i += 1) {
          const size = 4 + Math.random() * 6;
          const body = M.Bodies.rectangle(
            x,
            yCenter + (Math.random() - 0.5) * SEG_H * 0.5,
            size,
            size * 0.66,
            { restitution: 0.35, friction: 0.55, frictionAir: 0.012, density: 0.0008 },
          );
          M.Body.setVelocity(body, {
            x: dir * (2.5 + Math.random() * 5) + (Math.random() - 0.5) * 2,
            y: -(3 + Math.random() * 5),
          });
          M.Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.5);
          addDebris(
            {
              body,
              kind: 'chip',
              w: size,
              h: size * 0.66,
              color: Math.random() < 0.5 ? c.chipColor : c.chipColorAlt,
              branch: 'N',
              life: 1,
            },
            46,
          );
        }
        return;
      }
      // Fallback while the lazy matter import is still in flight (first ~100ms).
      for (let i = 0; i < count; i += 1) {
        chipsRef.current.push({
          x,
          y: yCenter + (Math.random() - 0.5) * SEG_H * 0.5,
          vx: dir * (1.5 + Math.random() * 4) + (Math.random() - 0.5) * 2,
          vy: -2 - Math.random() * 4,
          rot: Math.random() * Math.PI,
          vrot: (Math.random() - 0.5) * 0.6,
          life: 1,
          size: 3 + Math.random() * 5,
          color: Math.random() < 0.5 ? c.chipColor : c.chipColorAlt,
        });
      }
      if (chipsRef.current.length > 90) chipsRef.current.splice(0, chipsRef.current.length - 90);
    },
    [addDebris, ensureMatterWorld],
  );

  // The chopped log flies off to the side opposite the chopper.
  const spawnFlyingLog = useCallback(
    (chopperSide: LogSplitterSide, yCenter: number, branch: LogSplitterSide | 'N') => {
      if (reducedMotionRef.current) return;
      const away = chopperSide === 'L' ? 1 : -1; // fly away from the chopper
      const M = matterModRef.current;
      const engine = ensureMatterWorld();
      if (M && engine) {
        const body = M.Bodies.rectangle(CX, yCenter, TRUNK_W, SEG_H * 0.8, {
          restitution: 0.28,
          friction: 0.6,
          frictionAir: 0.008,
          density: 0.0025,
        });
        M.Body.setVelocity(body, {
          x: away * (7 + Math.random() * 3.5),
          y: -(4.5 + Math.random() * 2.5),
        });
        M.Body.setAngularVelocity(body, away * (0.14 + Math.random() * 0.08));
        addDebris(
          { body, kind: 'log', w: TRUNK_W, h: SEG_H * 0.8, color: '', branch, life: 1 },
          6,
        );
        return;
      }
      flyingRef.current.push({
        x: CX,
        y: yCenter,
        vx: away * (6 + Math.random() * 3),
        vy: -3 - Math.random() * 2,
        rot: 0,
        vrot: away * (0.12 + Math.random() * 0.06),
        life: 1,
        branch,
      });
      if (flyingRef.current.length > 6) flyingRef.current.shift();
    },
    [addDebris, ensureMatterWorld],
  );

  // "Timber!" — on a fatal strike the visible trunk above the cut collapses as
  // real physics bodies toppling away from the chopper. Pure spectacle.
  const spawnTimberCollapse = useCallback(
    (chopperSide: LogSplitterSide) => {
      if (reducedMotionRef.current) return;
      const M = matterModRef.current;
      const engine = ensureMatterWorld();
      if (!M || !engine) return;
      const away = chopperSide === 'L' ? 1 : -1;
      for (let r = 1; r <= 3; r += 1) {
        const yCenter = GROUND_Y - SEG_H * (r + 0.5) - 6;
        const body = M.Bodies.rectangle(CX, yCenter, TRUNK_W, SEG_H * 0.94, {
          restitution: 0.18,
          friction: 0.7,
          frictionAir: 0.006,
          density: 0.003,
        });
        M.Body.setVelocity(body, {
          x: away * (1.2 + r * 1.1 + Math.random()),
          y: -(0.5 + Math.random() * 1.2),
        });
        M.Body.setAngularVelocity(body, away * (0.03 + r * 0.025));
        addDebris(
          { body, kind: 'segment', w: TRUNK_W, h: SEG_H * 0.94, color: '', branch: 'N', life: 1 },
          4,
        );
      }
    },
    [addDebris, ensureMatterWorld],
  );

  const endRun = useCallback(
    (cause: DeathCause) => {
      if (gameStateRef.current !== 'playing') return;
      const durationMs = performance.now() - runStartRef.current;
      gameStateRef.current = 'gameover';
      setGameState('gameover');
      gameOverTimeRef.current = performance.now();
      deathCauseRef.current = cause;
      if (cause === 'struck') {
        hurtRef.current = 1;
        shakeRef.current = 1;
        hitStopRef.current = 6; // ~100ms freeze before the collapse settles
        spawnTimberCollapse(chopperSideRef.current);
        SoundManager.play(SFX.struck);
        playHaptic('failure');
        window.setTimeout(() => SoundManager.play(SFX.crash), 60);
        window.setTimeout(() => SoundManager.play(SFX.over), 300);
      } else {
        SoundManager.play(SFX.timeout);
        // Only a real timeout is a failure — the null-cause path above is a
        // clean event-cap/max-chops finish, so it stays vibration-free.
        if (cause === 'timeout') {
          playHaptic('failure');
          hitStopRef.current = 4;
        }
      }
      if (scoreRef.current > highScore) setHighScore(scoreRef.current);
      saveScoreRef.current?.(scoreRef.current, chopsRef.current.slice(), durationMs);
      paintOnce();
    },
    [highScore, paintOnce, spawnTimberCollapse],
  );
  endRunRef.current = endRun;

  // ── The single action: chop on a side. Every verdict comes from
  //    logSplitterApplyChop — the EXACT function the server replays. ──
  const chop = useCallback(
    (side: LogSplitterSide) => {
      if (gameStateRef.current !== 'playing') return;
      const seed = seedRef.current;
      if (seed === null) return;

      const now = performance.now();
      const t = Math.max(0, Math.floor(now - runStartRef.current));
      const applied = logSplitterApplyChop(seed, simRef.current, t, side);
      const { state, event } = applied;

      // Under the cadence floor — deterministic no-op on both sides. Don't record
      // (the server ignores it too, so skipping keeps the payload tight + parity).
      if (event.type === 'ignored') return;

      if (chopsRef.current.length >= LOG_SPLITTER_MAX_EVENTS - 2) {
        endRunRef.current?.(null);
        return;
      }
      chopsRef.current.push({ side, t });

      if (event.type === 'bounds') {
        endRunRef.current?.(null);
        return;
      }

      // Show the chopper on the tapped side + swing the axe regardless of outcome.
      // Capture the side change BEFORE moving the chopper so the switch cue can
      // differ from a same-side chop (comparing after the move is always true).
      const switched = chopperSideRef.current !== side;
      chopperSideRef.current = side;
      swingRef.current = 1;

      if (event.type === 'timeout') {
        endRunRef.current?.('timeout');
        return;
      }
      if (event.type === 'struck') {
        deathBranchRef.current = event.branch === 'N' ? null : event.branch;
        endRunRef.current?.('struck');
        return;
      }

      // Successful chop.
      const dangerY = GROUND_Y - SEG_H * 0.5 - 6;
      const choppedBranch = logSplitterBranchFor(seed, state.chops - 1);
      simRef.current = state;
      scoreRef.current = state.chops;
      setScore(state.chops);
      displayBarRef.current = state.bar;
      dropRef.current = 1;
      impactRef.current = 1;
      impactYRef.current = dangerY;
      barFlashRef.current = 1;
      scorePopRef.current = 1;
      hitStopRef.current = 3; // ~50ms freeze-frame at 60fps
      if (!reducedMotionRef.current) {
        kickRef.current = { x: (side === 'L' ? 1 : -1) * 3.5, y: 2.5 };
      }
      SoundManager.play(switched ? SFX.switch : SFX.chop);
      playHaptic('tap');
      spawnChips(side, dangerY, 8);
      spawnFlyingLog(side, dangerY, choppedBranch === 'N' ? 'N' : choppedBranch);
      if (state.chops % MILESTONE_EVERY === 0) {
        SoundManager.play(SFX.milestone);
        playHaptic('success');
        milestoneRef.current = 1;
        milestoneValueRef.current = state.chops;
      }

      if (state.chops >= LOG_SPLITTER_MAX_CHOPS) endRunRef.current?.(null);
    },
    [spawnChips, spawnFlyingLog],
  );

  // ── One fixed step: decay juice envelopes + advance the display time bar. ──
  const stepSim = useCallback(() => {
    const sim = simRef.current;
    if (gameStateRef.current === 'playing') {
      const from = sim.lastChopT >= 0 ? sim.lastChopT : 0;
      const curT = performance.now() - runStartRef.current;
      const drained = (curT - from) * logSplitterDrainRate(sim.chops);
      const bar = sim.bar - drained;
      displayBarRef.current = Math.max(0, Math.min(LOG_SPLITTER_BAR_MAX, bar));
      if (bar <= 0) {
        endRunRef.current?.('timeout');
      }
    }
    // Hit-stop freeze-frame: hold every decorative envelope at peak for a few
    // frames after a chop (longer on death). The drain above keeps running —
    // only render juice freezes, never the sim.
    if (hitStopRef.current > 0) {
      hitStopRef.current -= 1;
    } else {
      if (swingRef.current > 0) swingRef.current = Math.max(0, swingRef.current - 0.14);
      if (dropRef.current > 0) dropRef.current = Math.max(0, dropRef.current - 0.16);
      if (hurtRef.current > 0 && gameStateRef.current === 'gameover') {
        hurtRef.current = Math.max(0, hurtRef.current - 0.02);
      }
      if (shakeRef.current > 0) shakeRef.current = Math.max(0, shakeRef.current - 0.05);
      if (impactRef.current > 0) impactRef.current = Math.max(0, impactRef.current - 0.12);
      if (barFlashRef.current > 0) barFlashRef.current = Math.max(0, barFlashRef.current - 0.08);
      if (scorePopRef.current > 0) scorePopRef.current = Math.max(0, scorePopRef.current - 0.09);
      kickRef.current = { x: kickRef.current.x * 0.8, y: kickRef.current.y * 0.8 };
    }
    // The milestone banner outlives the freeze — it decays on its own clock.
    if (milestoneRef.current > 0) {
      milestoneRef.current = Math.max(0, milestoneRef.current - 0.028);
    }
  }, []);

  // ── Render ──
  const draw = useCallback((ctx: CanvasRenderingContext2D) => {
    const c = themeRef.current;
    const state = gameStateRef.current;
    const sim = simRef.current;
    const seed = seedRef.current;
    const reduced = reducedMotionRef.current;
    const barFrac = displayBarRef.current / LOG_SPLITTER_BAR_MAX;

    // Camera: directional kick on each chop + random shake on a fatal strike.
    ctx.save();
    if (!reduced) {
      const k = kickRef.current;
      if (Math.abs(k.x) > 0.05 || Math.abs(k.y) > 0.05) ctx.translate(k.x, k.y);
      if (shakeRef.current > 0) {
        const s = shakeRef.current * 6;
        ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
      }
    }

    paintScene(ctx, c);

    // What the tree renders from: the live run, or the self-playing idle demo
    // (which silently teaches "chop the branch-free side" behind the overlay).
    const demo = demoRef.current;
    const isDemo = state === 'idle';
    const treeSeed = isDemo ? demo.seed : seed;
    const treeChops = isDemo ? demo.chops : sim.chops;
    const treeDrop = isDemo ? demo.drop : dropRef.current;
    // On a "Timber!" death the upper trunk becomes physics debris — skip the
    // static copies so the collapse reads as THE tree falling.
    const collapsed =
      state === 'gameover' &&
      deathCauseRef.current === 'struck' &&
      debrisRef.current.some((d) => d.kind === 'segment');

    // Trunk + branches. Row 0 (danger, index = chops) sits just above the chopper.
    // On a chop the whole tree eases DOWN from one segment up (drop 1→0).
    const dropShift = reduced ? 0 : treeDrop * SEG_H;
    if (treeSeed !== null && (isDemo || state === 'playing' || state === 'gameover')) {
      const rows = Math.ceil(GROUND_Y / SEG_H) + 2;
      for (let r = rows; r >= 0; r -= 1) {
        if (collapsed && r >= 1) continue;
        const yCenter = GROUND_Y - SEG_H * (r + 0.5) - 6 + dropShift;
        if (yCenter < -SEG_H || yCenter > GROUND_Y + SEG_H) continue;
        paintTrunkSegment(ctx, c, yCenter);
        const branch = logSplitterBranchFor(treeSeed, treeChops + r);
        if (branch !== 'N') {
          const flash =
            state === 'gameover' &&
            r === 0 &&
            deathCauseRef.current === 'struck' &&
            deathBranchRef.current === branch
              ? Math.max(hurtRef.current, 0.6)
              : 0;
          // Pulse the branch the NEXT chop can hit — the one that kills you now.
          const pulse =
            r === 0 && state === 'playing' && !reduced
              ? 0.22 + 0.18 * Math.sin(performance.now() / 150)
              : 0;
          paintBranch(ctx, c, yCenter, branch, flash, pulse);
        }
      }
      // Stump cap at the ground (end-grain rings).
      const stumpY = GROUND_Y - 6;
      ctx.fillStyle = c.barkLo;
      ctx.fillRect(CX - TRUNK_W / 2, stumpY, TRUNK_W, GROUND_Y - stumpY + 6);
      ctx.fillStyle = c.ring;
      ctx.beginPath();
      ctx.ellipse(CX, stumpY, TRUNK_W / 2 - 4, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = c.barkLo;
      ctx.lineWidth = 1.5;
      for (const rr of [0.7, 0.42]) {
        ctx.beginPath();
        ctx.ellipse(CX, stumpY, (TRUNK_W / 2 - 4) * rr, 7 * rr, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Chop impact: a bright slash across the cut + an expanding shock ring.
    if (impactRef.current > 0 && !reduced) {
      const imp = impactRef.current;
      const y = impactYRef.current + dropShift * 0.4;
      ctx.save();
      ctx.globalAlpha = imp * 0.9;
      ctx.strokeStyle = c.flashColor;
      ctx.lineWidth = 3 + imp * 3;
      ctx.beginPath();
      ctx.moveTo(CX - TRUNK_W / 2 - 26, y);
      ctx.lineTo(CX + TRUNK_W / 2 + 26, y);
      ctx.stroke();
      ctx.globalAlpha = imp * 0.35;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(CX, y, (1 - imp) * 58 + 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Flying chopped logs.
    const flying = flyingRef.current;
    for (let i = flying.length - 1; i >= 0; i -= 1) {
      const f = flying[i]!;
      f.life -= 0.03;
      f.x += f.vx;
      f.y += f.vy;
      f.vy += 0.5;
      f.rot += f.vrot;
      if (f.life <= 0 || f.y > BASE_HEIGHT + 60) {
        flying.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life * 1.5));
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rot);
      ctx.fillStyle = c.barkColor;
      roundRectPath(ctx, -TRUNK_W / 2, -SEG_H / 2.4, TRUNK_W, SEG_H / 1.2, 8);
      ctx.fill();
      ctx.fillStyle = c.ring;
      ctx.beginPath();
      ctx.ellipse(-TRUNK_W / 2 + 6, 0, 6, SEG_H / 3.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    // Physics debris (matter-js): chips, chopped log halves, collapsed segments.
    for (const d of debrisRef.current) {
      const { body } = d;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, d.life * 1.4));
      ctx.translate(body.position.x, body.position.y);
      ctx.rotate(body.angle);
      if (d.kind === 'chip') {
        ctx.fillStyle = d.color;
        ctx.fillRect(-d.w / 2, -d.h / 2, d.w, d.h);
      } else {
        // Log halves + trunk segments: bark slab with an end-grain ellipse.
        ctx.fillStyle = c.barkColor;
        roundRectPath(ctx, -d.w / 2, -d.h / 2, d.w, d.h, 8);
        ctx.fill();
        ctx.strokeStyle = c.barkLo;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = c.ring;
        ctx.beginPath();
        ctx.ellipse(-d.w / 2 + 7, 0, 6, d.h / 3, 0, 0, Math.PI * 2);
        ctx.fill();
        if (d.branch !== 'N') {
          ctx.fillStyle = c.branchColor;
          const bdir = d.branch === 'L' ? -1 : 1;
          roundRectPath(ctx, bdir === -1 ? -d.w / 2 - 34 : d.w / 2, -8, 34, 16, 6);
          ctx.fill();
        }
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    // The lumberjack — live during a run, scripted during the idle demo.
    if (state === 'playing' || state === 'gameover') {
      paintChopper(
        ctx,
        c,
        chopperSideRef.current,
        swingRef.current,
        state === 'gameover' && deathCauseRef.current === 'struck' ? hurtRef.current : 0,
        reduced,
      );
    } else if (isDemo) {
      paintChopper(ctx, c, demo.side, demo.swing, 0, reduced);
    }

    // First-chops coaching: tap-zone divider + chevrons until the loop clicks.
    if (state === 'playing' && sim.chops < 3) {
      const hintAlpha = (1 - sim.chops / 3) * 0.55;
      ctx.save();
      ctx.globalAlpha = hintAlpha;
      ctx.strokeStyle = c.cream;
      ctx.setLineDash([6, 8]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(CX, GROUND_Y - SEG_H * 2.2);
      ctx.lineTo(CX, GROUND_Y - 8);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "800 15px var(--font-mono-arcade, 'Spline Sans Mono'), ui-monospace, monospace";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = c.cream;
      const hintY = GROUND_Y - SEG_H * 1.6;
      ctx.fillText('◄ LEFT', CX - TRUNK_W * 1.35, hintY);
      ctx.fillText('RIGHT ►', CX + TRUNK_W * 1.35, hintY);
      ctx.font = "700 11px var(--font-mono-arcade, 'Spline Sans Mono'), ui-monospace, monospace";
      ctx.fillText('chop the branch-free side', CX, GROUND_Y + 42);
      ctx.restore();
    }

    // Wood chips (topmost of the scene).
    const chips = chipsRef.current;
    for (let i = chips.length - 1; i >= 0; i -= 1) {
      const ch = chips[i]!;
      ch.life -= 0.045;
      ch.x += ch.vx;
      ch.y += ch.vy;
      ch.vy += 0.35;
      ch.rot += ch.vrot;
      if (ch.life <= 0) {
        chips.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = Math.max(0, ch.life);
      ctx.translate(ch.x, ch.y);
      ctx.rotate(ch.rot);
      ctx.fillStyle = ch.color;
      ctx.fillRect(-ch.size / 2, -ch.size / 3, ch.size, ch.size / 1.5);
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    ctx.restore(); // shake

    // ── HUD: time bar (top) + score (center). ──
    // Wooden gauge frame.
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    roundRectPath(ctx, BAR_X - 4, BAR_Y - 4, BAR_W + 8, BAR_H + 8, 8);
    ctx.fill();
    ctx.fillStyle = c.groundEdge;
    roundRectPath(ctx, BAR_X - 2, BAR_Y - 2, BAR_W + 4, BAR_H + 4, 6);
    ctx.fill();
    // Fill — green→amber→red as it drains. The idle demo shows a gently
    // breathing bar so the gauge's meaning is visible before the first run.
    const shownFrac = isDemo
      ? 0.62 + 0.18 * Math.sin(performance.now() / 700)
      : barFrac;
    const barColor =
      shownFrac > 0.5 ? '#4fae52' : shownFrac > 0.25 ? c.accent : '#d9483b';
    ctx.fillStyle = '#1c130a';
    roundRectPath(ctx, BAR_X, BAR_Y, BAR_W, BAR_H, 5);
    ctx.fill();
    const fillW = Math.max(0, Math.min(1, shownFrac)) * BAR_W;
    if (fillW > 0) {
      ctx.fillStyle = barColor;
      roundRectPath(ctx, BAR_X, BAR_Y, fillW, BAR_H, 5);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      roundRectPath(ctx, BAR_X, BAR_Y + 1, fillW, BAR_H / 2.4, 4);
      ctx.fill();
      // Refill flash: the bar edge glows for a beat on every chop, teaching
      // "chopping = time" without a word of copy.
      if (barFlashRef.current > 0 && !reduced) {
        ctx.save();
        ctx.globalAlpha = barFlashRef.current * 0.85;
        ctx.fillStyle = c.flashColor;
        roundRectPath(ctx, Math.max(BAR_X, BAR_X + fillW - 26), BAR_Y, 26, BAR_H, 5);
        ctx.fill();
        ctx.restore();
      }
    }
    // Critical-time warning ring around the gauge.
    if (state === 'playing' && shownFrac < 0.25 && !reduced) {
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.3 * Math.sin(performance.now() / 120);
      ctx.strokeStyle = '#d9483b';
      ctx.lineWidth = 3;
      roundRectPath(ctx, BAR_X - 6, BAR_Y - 6, BAR_W + 12, BAR_H + 12, 10);
      ctx.stroke();
      ctx.restore();
    }
    // "TIME" label.
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = "700 11px var(--font-mono-arcade, 'Spline Sans Mono'), ui-monospace, monospace";
    ctx.fillStyle = c.cream;
    ctx.fillText('TIME', BAR_X + 2, BAR_Y + BAR_H + 12);
    ctx.restore();

    // Big score readout. Pops with a rising "+1" on each chop; under reduced
    // motion the number simply changes with no animation.
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const scoreText = state === 'idle' ? '0' : scoreRef.current.toString();
    const pop = reduced ? 0 : scorePopRef.current;
    ctx.font = `800 ${46 + pop * 12}px var(--font-mono-arcade, 'Spline Sans Mono'), ui-monospace, monospace`;
    ctx.fillStyle = 'rgba(8,7,4,0.5)';
    ctx.fillText(scoreText, CX + 2, 96 + 2);
    ctx.fillStyle = c.cream;
    ctx.fillText(scoreText, CX, 96);
    if (pop > 0 && state === 'playing') {
      ctx.globalAlpha = pop;
      ctx.font = "800 16px var(--font-mono-arcade, 'Spline Sans Mono'), ui-monospace, monospace";
      ctx.fillStyle = c.accent;
      ctx.fillText('+1', CX + 34 + (scoreText.length - 1) * 13, 96 - (1 - pop) * 22);
      ctx.globalAlpha = 1;
    }
    ctx.font = "700 10px var(--font-mono-arcade, 'Spline Sans Mono'), ui-monospace, monospace";
    ctx.fillStyle = c.cream;
    ctx.globalAlpha = 0.8;
    ctx.fillText('LOGS CHOPPED', CX, 122);
    ctx.restore();

    // Milestone banner: a golden "25!" that swells in over the score and
    // drifts up as it fades. Render-only; decays on milestoneRef.
    if (milestoneRef.current > 0 && !reduced) {
      const m = milestoneRef.current;
      const bannerY = 168 - (1 - m) * 18;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = Math.min(1, m * 1.6);
      ctx.font = `800 ${30 + m * 8}px var(--font-mono-arcade, 'Spline Sans Mono'), ui-monospace, monospace`;
      ctx.fillStyle = 'rgba(8,7,4,0.55)';
      ctx.fillText(`${milestoneValueRef.current}!`, CX + 2, bannerY + 2);
      ctx.fillStyle = c.accent;
      ctx.fillText(`${milestoneValueRef.current}!`, CX, bannerY);
      ctx.restore();
    }
  }, []);
  drawRef.current = draw;

  const renderFrame = useCallback(
    (currentTime: number, deltaTime: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas ? getGame2dContext(canvas, { alpha: false }) : null;
      if (!canvas || !ctx) return;

      // Idle demo: a scripted lumberjack chops the branch-free side on a loop.
      if (gameStateRef.current === 'idle' && !reducedMotionRef.current) {
        const demo = demoRef.current;
        if (currentTime - demo.lastChopAt > 640) {
          const branch = logSplitterBranchFor(demo.seed, demo.chops);
          demo.side =
            branch === 'L' ? 'R' : branch === 'R' ? 'L' : demo.side === 'L' ? 'R' : 'L';
          demo.swing = 1;
          demo.drop = 1;
          demo.chops += 1;
          demo.lastChopAt = currentTime;
        }
        demo.swing = Math.max(0, demo.swing - 0.09);
        demo.drop = Math.max(0, demo.drop - 0.1);
      }

      // Advance the debris physics world (render-only) and cull settled pieces.
      const M = matterModRef.current;
      const engine = matterEngineRef.current;
      if (M && engine && debrisRef.current.length > 0) {
        M.Engine.update(engine, Math.min(deltaTime, 33.3));
        const debris = debrisRef.current;
        for (let i = debris.length - 1; i >= 0; i -= 1) {
          const d = debris[i]!;
          const off =
            d.body.position.x < -90 ||
            d.body.position.x > BASE_WIDTH + 90 ||
            d.body.position.y > BASE_HEIGHT + 90;
          if (off) {
            M.Composite.remove(engine.world, d.body);
            debris.splice(i, 1);
            continue;
          }
          const speed = Math.abs(d.body.velocity.x) + Math.abs(d.body.velocity.y);
          if (speed < 0.35) d.settledFrames += 1;
          if (d.settledFrames > 26) d.life -= d.kind === 'chip' ? 0.05 : 0.028;
          if (d.life <= 0) {
            M.Composite.remove(engine.world, d.body);
            debris.splice(i, 1);
          }
        }
      }

      ctx.save();
      ctx.scale(scaleRef.current, scaleRef.current);
      draw(ctx);
      ctx.restore();
    },
    [draw],
  );

  const shouldAnimate = useCallback(
    () =>
      gameStateRef.current === 'playing' ||
      (gameStateRef.current === 'idle' && !reducedMotionRef.current) ||
      (gameStateRef.current === 'gameover' &&
        (chipsRef.current.length > 0 ||
          flyingRef.current.length > 0 ||
          debrisRef.current.length > 0 ||
          hurtRef.current > 0.01 ||
          milestoneRef.current > 0.01 ||
          shakeRef.current > 0.01)),
    [],
  );

  useEffect(() => {
    const loop = createGameFrameLoop({
      stepMs: FRAME_TIME,
      simulate: () => {
        stepSim();
        return shouldAnimate();
      },
      render: (_alpha, frame) => renderFrame(frame.nowMs, frame.deltaMs),
    });
    frameLoopRef.current = loop;
    if (gameStateRef.current === 'idle' && !reducedMotionRef.current) loop.start();
    return () => {
      loop.destroy();
      if (frameLoopRef.current === loop) frameLoopRef.current = null;
    };
  }, [renderFrame, shouldAnimate, stepSim]);

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
        body: JSON.stringify({ gameType: 'log-splitter' }),
      });
      if (sessionResponse.ok) {
        setBanIndefinite(false);
        setBanUntilMs(null);
        const sessionData = await sessionResponse.json();
        sessionTokenRef.current = sessionData.token;
        seedRef.current =
          typeof sessionData.logSplitterSeed === 'number'
            ? sessionData.logSplitterSeed
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
    frameLoopRef.current?.stop();
    simRef.current = logSplitterInitialState();
    scoreRef.current = 0;
    setScore(0);
    chopsRef.current = [];
    chipsRef.current = [];
    flyingRef.current = [];
    clearDebris();
    impactRef.current = 0;
    barFlashRef.current = 0;
    scorePopRef.current = 0;
    milestoneRef.current = 0;
    hitStopRef.current = 0;
    kickRef.current = { x: 0, y: 0 };
    swingRef.current = 0;
    dropRef.current = 0;
    hurtRef.current = 0;
    shakeRef.current = 0;
    deathCauseRef.current = null;
    deathBranchRef.current = null;
    chopperSideRef.current = 'L';
    displayBarRef.current = simRef.current.bar;
    runStartRef.current = performance.now();
    gameStateRef.current = 'playing';
    setGameState('playing');
    SoundManager.play(SFX.start);

    frameLoopRef.current?.start();
  }, [clearDebris, resetRunResult]);

  // ── Primary action: chop while playing; start / restart otherwise. ──
  const act = useCallback(
    (side: LogSplitterSide) => {
      // Every caller is a trusted tap/key gesture — unlock audio here once so
      // the first chop of a fresh page load is audible.
      SoundManager.unlock();
      const current = gameStateRef.current;
      if (current === 'playing') {
        chop(side);
      } else if (current === 'idle' || current === 'error') {
        startGame();
      } else if (current === 'gameover') {
        const since = performance.now() - gameOverTimeRef.current;
        if (since >= RESTART_GRACE_PERIOD) startGame();
      }
    },
    [chop, startGame],
  );

  // ── Input: Arrow/AD keys + tapping the left/right half of the stage. ──
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (blocksGameKeyboard(e.target)) return;
      const k = e.key.toLowerCase();
      if (e.code === 'ArrowLeft' || k === 'a') {
        e.preventDefault();
        if (gameStateRef.current === 'playing') setLeftPressed(true);
        act('L');
      } else if (e.code === 'ArrowRight' || k === 'd') {
        e.preventDefault();
        if (gameStateRef.current === 'playing') setRightPressed(true);
        act('R');
      } else if (e.code === 'Space' || e.code === 'Enter') {
        // Start / restart only (no ambiguous chop side).
        e.preventDefault();
        if (gameStateRef.current !== 'playing') act('L');
      }
    },
    [act],
  );

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (e.code === 'ArrowLeft' || k === 'a') setLeftPressed(false);
    if (e.code === 'ArrowRight' || k === 'd') setRightPressed(false);
  }, []);

  const handleStagePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (gameStateRef.current !== 'playing') {
        act('L'); // start / restart
        return;
      }
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const side: LogSplitterSide = e.clientX - rect.left < rect.width / 2 ? 'L' : 'R';
      if (side === 'L') setLeftPressed(true);
      else setRightPressed(true);
      act(side);
    },
    [act],
  );

  const handleStagePointerUp = useCallback(() => {
    setLeftPressed(false);
    setRightPressed(false);
  }, []);

  const handleButton = useCallback(
    (side: LogSplitterSide) => (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (side === 'L') setLeftPressed(true);
      else setRightPressed(true);
      act(side);
    },
    [act],
  );

  // ── Effects ──
  useEffect(() => {
    const monitor = envMonitorRef.current;
    return () => {
      monitor.stop();
    };
  }, []);

  // Prefetch matter-js (debris physics) so it's ready before the first chop.
  useEffect(() => {
    let alive = true;
    import('matter-js')
      .then((m) => {
        if (alive) matterModRef.current = m;
      })
      .catch(() => {
        /* debris quietly falls back to the hand-rolled particles */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Drive the idle-demo loop (skipped entirely under reduced motion).
  useEffect(() => {
    if (gameState === 'idle' && !reducedMotionRef.current) {
      frameLoopRef.current?.start();
    } else if (gameState === 'idle' || gameState === 'error') {
      frameLoopRef.current?.stop();
    }
  }, [gameState]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      reducedMotionRef.current = mq.matches;
      if (gameStateRef.current === 'idle') {
        if (mq.matches) frameLoopRef.current?.stop();
        else frameLoopRef.current?.start();
      }
    };
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const updateSize = () => {
      const container = containerRef.current;
      if (!container) return;
      const reservedVertical = window.innerHeight < 700 ? 210 : 260;
      const maxWidth = Math.min(window.innerWidth - 24, 520);
      const maxHeight = Math.min(window.innerHeight - reservedVertical, BASE_HEIGHT);
      const scale = Math.min(maxWidth / BASE_WIDTH, maxHeight / BASE_HEIGHT, 1.1);
      const dpr = gameCanvasDpr(BASE_WIDTH, BASE_HEIGHT);
      scaleRef.current = scale * dpr;
      setCanvasSize({
        width: Math.floor(BASE_WIDTH * scale),
        height: Math.floor(BASE_HEIGHT * scale),
        dpr,
      });
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas ? getGame2dContext(canvas, { alpha: false }) : null;
    if (!canvas || !ctx) return;
    if (gameStateRef.current === 'playing') return;
    ctx.save();
    ctx.scale(scaleRef.current, scaleRef.current);
    draw(ctx);
    ctx.restore();
  }, [canvasSize, draw, theme]);

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
    <div className="log-splitter-midway arc-game-flow">
      <div className="w-full space-y-3 sm:space-y-4">
        <div className="mx-auto w-full max-w-5xl">
          <div className="hidden sm:block">
            <PageHeader
              eyebrow="tixy"
              icon={<Axe aria-hidden className="h-6 w-6" />}
              title="Log Splitter"
              subtitle="Two-button panic rhythm: tap the branch-free side to chop and switch. Every chop refills the draining time bar — speed is survival. One bad side ends it."
              wallet={walletCard}
            />
          </div>
          <div className="sm:hidden">
            <GamesWalletCard wallet={walletCard} compact />
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3 px-1">
          <span className="arcade-num text-sm text-body sm:text-base">
            Logs <span className="font-semibold text-strong">{score}</span>
          </span>
          <span className="arcade-num text-sm text-body sm:text-base">
            Best <span className="font-semibold text-strong">{highScore}</span>
          </span>
        </div>

        <div ref={containerRef} className="relative touch-none flex justify-center">
          <div
            className="log-splitter-stage relative"
            style={{ width: canvasSize.width, height: canvasSize.height }}
          >
            <canvas
              ref={canvasRef}
              width={Math.floor(canvasSize.width * canvasSize.dpr)}
              height={Math.floor(canvasSize.height * canvasSize.dpr)}
              role="img"
              aria-label="Log Splitter game: a lumberjack chops a descending tree — chop the side without a branch before the time bar empties"
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
                className="log-splitter-overlay absolute inset-0 flex touch-none flex-col items-center justify-center rounded-well px-4"
                style={{
                  // Lighter veil while idle so the self-playing demo behind it
                  // teaches the loop; full dim for game-over/error readability.
                  background: `color-mix(in srgb, var(--scrim) ${
                    gameState === 'idle' ? '55%' : '78%'
                  }, transparent)`,
                }}
                onPointerDown={handleStagePointerDown}
              >
                {gameState === 'idle' && (
                  <>
                    <Axe size={56} className="mb-4 text-tickets-text" />
                    <h1 className="arcade-display mb-2 text-center text-2xl text-strong uppercase sm:text-3xl">
                      Log Splitter
                    </h1>
                    <p className="mb-2 text-center text-sm text-strong sm:text-base">
                      {isStartingSession
                        ? 'Starting your run…'
                        : touchDevice
                          ? 'Tap a side to start'
                          : 'Press ← / → or A / D to start'}
                    </p>
                    <div className="flex max-w-xs flex-col gap-1.5 text-left text-xs text-body sm:text-sm">
                      <span className="flex items-center gap-2">
                        <Axe size={14} className="shrink-0 text-tickets-text" aria-hidden />
                        Tap LEFT or RIGHT to chop that side of the trunk.
                      </span>
                      <span className="flex items-center gap-2">
                        <TreePine size={14} className="shrink-0 text-danger-text" aria-hidden />
                        Never chop a side with a branch — that ends the run.
                      </span>
                      <span className="flex items-center gap-2">
                        <Timer size={14} className="shrink-0 text-prize-text" aria-hidden />
                        Every chop refills the draining time bar. Speed is survival.
                      </span>
                    </div>
                  </>
                )}

                {gameState === 'gameover' && (
                  <>
                    <h2 className="arcade-display mb-2 text-2xl text-strong uppercase sm:text-3xl">
                      {deathCauseRef.current === 'timeout' ? 'Out of time' : 'Timber!'}
                    </h2>
                    <p className="mb-2 max-w-xs text-center text-xs text-body sm:text-sm">
                      {deathCauseRef.current === 'struck'
                        ? `You chopped into a branch${
                            deathBranchRef.current
                              ? ` on the ${deathBranchRef.current === 'L' ? 'left' : 'right'}`
                              : ''
                          }.`
                        : 'The time bar hit empty — keep chopping to refill it.'}
                    </p>
                    <p className="mb-1 text-xl text-strong sm:text-2xl">
                      <span className="arcade-num font-semibold">{score}</span>{' '}
                      <span className="text-base text-body sm:text-lg">
                        {score === 1 ? 'log' : 'logs'}
                      </span>
                    </p>
                    <p className="mb-4 text-base text-body sm:text-lg">
                      Best <span className="arcade-num">{highScore}</span>
                    </p>
                    <ArcadeRunRewards reward={runResult.reward} achievements={runResult.achievements} saving={isSubmitting} error={submitError} guest={runRewardMessage?.startsWith('Guest run')} className="mb-4 max-w-xs" />
                    <p className="text-center text-sm text-body sm:text-base">
                      {touchDevice
                        ? 'Tap a side to play again'
                        : 'Press ← / → to play again'}
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
                      Tap or press a key to retry
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* The two chop keycaps: LEFT and RIGHT. They ARE the control on touch and
            clear affordances on desktop; the canvas halves also accept taps. */}
        <div className="mx-auto mt-3 flex w-full max-w-md items-stretch justify-center gap-3 px-1">
          <button
            type="button"
            className="log-splitter-tap"
            data-pressed={leftPressed ? 'true' : undefined}
            aria-label={isPlaying ? 'Chop left' : 'Start'}
            onPointerDown={handleButton('L')}
            onPointerUp={handleStagePointerUp}
            onPointerLeave={handleStagePointerUp}
          >
            <ChevronLeft aria-hidden size={22} />
            Left
          </button>
          <button
            type="button"
            className="log-splitter-tap"
            data-pressed={rightPressed ? 'true' : undefined}
            aria-label={isPlaying ? 'Chop right' : 'Start'}
            onPointerDown={handleButton('R')}
            onPointerUp={handleStagePointerUp}
            onPointerLeave={handleStagePointerUp}
          >
            Right
            <ChevronRight aria-hidden size={22} />
          </button>
        </div>

        <p className="log-splitter-hint mt-3 text-center text-xs text-faint sm:text-sm">
          {touchDevice ? (
            'Tap the left or right half to chop that side'
          ) : (
            <>
              Chop with{' '}
              <kbd className="arcade-card-inset px-2 py-1 text-strong">←</kbd>{' '}
              <kbd className="arcade-card-inset px-2 py-1 text-strong">→</kbd> or{' '}
              <kbd className="arcade-card-inset px-2 py-1 text-strong">A</kbd>{' '}
              <kbd className="arcade-card-inset px-2 py-1 text-strong">D</kbd>
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
        title="Log Splitter board"
        description="Most logs chopped in a single run, and your rank."
      >
        <GameLeaderboard
          gameType="log-splitter"
          maxEntries={5}
          enableFullLeaderboardModal
          fullLeaderboardDisplay="inline"
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>
    </div>
  );
}
