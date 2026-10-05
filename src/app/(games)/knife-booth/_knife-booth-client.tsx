'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Target, CircleHelp, Apple, AlertTriangle } from 'lucide-react';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import { PageHeader, GamesWalletCard } from '@/features/arcade/components/shell/page-header';
import { MuteButton } from '@/features/arcade/components/mute-button';
import { EnvMonitor } from '@/features/arcade/lib/game-anti-cheat';
import { usePreventGameGestures, useIsTouchDevice } from '@/features/arcade/lib/game-mobile-utils';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { playHaptic } from '@/features/arcade/lib/game-haptics';
import { gameCanvasDpr } from '@/features/arcade/lib/game-frame-loop';
import { ArcadeRunRewards } from '@/features/arcade/components/results/arcade-run-result';
import { useArcadeRunResult } from '@/features/arcade/lib/run-result';
import type { AccountXpReward } from '@/server/arcade/rewards/types';
import {
  knifeStageSchedule,
  knifeStageBoard,
  knifeAngleFromSchedule,
  knifeApplyThrow,
  knifeInitialState,
  knifeNorm,
  knifeAngularDelta,
  KNIFE_MAX_STAGES,
  KNIFE_MAX_TAPS,
  KNIFE_THROW_ANGLE,
  KNIFE_COLLIDE_ANGLE,
  type KnifeSegment,
  type KnifeStageBoard,
  type KnifeSimState,
} from '@/server/arcade/knife-booth-replay';
import {
  DEFAULT_KNIFE_BOOTH_THEME,
  buildKnifeBoothTheme,
  type InventoryCosmeticResponse,
  type KnifeBoothTheme,
} from './_knife-booth-theme';

import './_knife-booth.css';
import {
  drawCanvasCallout,
  readCanvasCalloutLook,
  type CanvasCalloutTone,
} from '@/features/arcade/components/gameplay/callout-canvas';

// ── Logical stage (the target centered in a wide booth). The canvas fills this
//    space; scale + dpr keep sim coords display-independent.
const BASE_WIDTH = 760;
const BASE_HEIGHT = 520;
const TARGET_FPS = 60;
const FRAME_TIME = 1000 / TARGET_FPS;

const TARGET_CX = BASE_WIDTH / 2;
const TARGET_CY = BASE_HEIGHT / 2 - 26;
const TARGET_RADIUS = 150; // wooden disc radius
const LANE_Y = BASE_HEIGHT - 46; // the throwing lane (ready knife rests here)

const BLADE_LEN = 44;
const HANDLE_LEN = 26;
const KNIFE_HALF_W = 4.5;

const RESTART_GRACE_PERIOD = 450;

const REWARDS_HINT_TEXT =
  'Rewards hint: score points by landing knives — each lodged blade is 1 point, slicing a bonus fruit is +5, and clearing a stage pays a depth-scaled bonus (deeper stages are worth more, doubled on boss targets). Push as far as you can; more points earns more tickets, and rewards taper at higher scores.';

// Distinct existing SoundManager names, mapped to booth moments.
const SFX = {
  thunk: 'arcadeBet', // solid knife-in-wood thunk on a landed knife
  fruit: 'coinCorrect', // bright chime — fruit sliced
  stage: 'arcadeCashout', // stage cleared
  boss: 'arcadeWin', // boss stage cleared
  shatter: 'arcadeCrash', // blade shatters on a lodged knife
  over: 'arcadeLose',
  start: 'arcadeReveal',
} as const;

type GameState = 'idle' | 'playing' | 'gameover' | 'error';

type RecordedThrow = { t: number };

// matter-js is loaded lazily (dynamic import at mount, swerve's pattern) and
// used ONLY for the shattered blade tumbling into the lane. Render-only.
type MatterModule = typeof import('matter-js');

type Debris = {
  body: import('matter-js').Body;
  len: number;
  life: number;
  settledFrames: number;
};

// A render-only knife flight from the lane to the target rim (~90ms streak).
// The sim verdict is already final when the flight starts; this is pure juice.
type Flight = {
  until: number; // performance.now() deadline
  dur: number;
  outcome: 'land' | 'shatter';
  suppressIndex: number; // landedAngles index hidden until the flight arrives
};

// Self-playing idle demo: the target spins and a ghost thrower lands knives,
// teaching the throw-into-gaps loop behind the start overlay.
type DemoState = {
  spin: number;
  lastThrowAt: number;
  knives: number[]; // board angles, like sim.landedAngles
};

// A short-lived spark burst when a knife lands. Render-only.
type Shard = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
};

// Floating verdict plate (the shared callout plate). Render-only. `dim` marks
// the quiet variant (ordinary +1 lands) versus the fruit/stage callouts.
type FloatLabel = {
  text: string;
  tone: CanvasCalloutTone;
  x: number;
  y: number;
  life: number;
  dim?: boolean;
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

// Space/Enter must not throw while focus sits inside a control or a dialog is
// open — the control's own click would double-fire, and a modal should swallow
// keys. Same guard high-striker uses.
const blocksGameKeyboard = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target.isContentEditable ||
    target.closest('input, textarea, select, button, a[href], [role="dialog"]')
  ) return true;
  return Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
};

// ── Paint helpers. Each takes the resolved theme `c` so equipped cosmetics flow
//    straight into the render. Hard bevels + offset shadows; NOTHING glows by
//    default (the knife slot can opt into a subtle blade glow). ──

// The plank booth backdrop + enamel bunting swag across the top. Static.
const paintBooth = (ctx: CanvasRenderingContext2D, c: KnifeBoothTheme) => {
  const bg = ctx.createLinearGradient(0, 0, 0, BASE_HEIGHT);
  bg.addColorStop(0, c.bgTop);
  bg.addColorStop(1, c.bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);

  // Vertical planks.
  ctx.save();
  ctx.globalAlpha = 0.5;
  const plankW = 76;
  for (let x = 0; x <= BASE_WIDTH; x += plankW) {
    ctx.fillStyle = c.plank;
    ctx.globalAlpha = 0.12 + (Math.floor(x / plankW) % 2) * 0.05;
    ctx.fillRect(x, 0, plankW - 3, BASE_HEIGHT);
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = c.plankLine;
    ctx.fillRect(x + plankW - 3, 0, 2, BASE_HEIGHT);
  }
  ctx.restore();

  // Enamel bunting swag across the top (triangular pennants).
  const colors = [c.buntingRed, c.buntingAmber, c.buntingTeal];
  const pennW = 46;
  let i = 0;
  for (let x = 8; x < BASE_WIDTH - 20; x += pennW) {
    const sag = Math.sin((x / BASE_WIDTH) * Math.PI) * 10;
    ctx.fillStyle = colors[i % colors.length]!;
    ctx.beginPath();
    ctx.moveTo(x, 6 + sag);
    ctx.lineTo(x + pennW, 6 + sag);
    ctx.lineTo(x + pennW / 2, 34 + sag);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(x, 5 + sag, pennW, 2);
    i += 1;
  }

  // The throwing lane: a dark slot at the bottom with a hard top rail.
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(0, LANE_Y - 4, BASE_WIDTH, BASE_HEIGHT - LANE_Y + 4);
  ctx.fillStyle = 'rgba(255,246,210,0.10)';
  ctx.fillRect(0, LANE_Y - 4, BASE_WIDTH, 2);
};

// The spinning wooden target: concentric grain rings + a bullseye hub. `spin` is
// the current rotation (rad); ticks/knots rotate with it so the spin reads.
const paintTarget = (
  ctx: CanvasRenderingContext2D,
  c: KnifeBoothTheme,
  spin: number,
) => {
  // Shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.arc(TARGET_CX + 3, TARGET_CY + 5, TARGET_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  // Wood face — radial gradient lit from upper-left.
  const g = ctx.createRadialGradient(
    TARGET_CX - TARGET_RADIUS * 0.4,
    TARGET_CY - TARGET_RADIUS * 0.5,
    TARGET_RADIUS * 0.15,
    TARGET_CX,
    TARGET_CY,
    TARGET_RADIUS * 1.15,
  );
  g.addColorStop(0, c.woodHi);
  g.addColorStop(0.55, c.wood);
  g.addColorStop(1, c.woodLo);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(TARGET_CX, TARGET_CY, TARGET_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  // Dark rim edge.
  ctx.lineWidth = 5;
  ctx.strokeStyle = c.woodEdge;
  ctx.beginPath();
  ctx.arc(TARGET_CX, TARGET_CY, TARGET_RADIUS - 2, 0, Math.PI * 2);
  ctx.stroke();

  // Concentric grain rings.
  ctx.save();
  ctx.strokeStyle = c.ring;
  ctx.globalAlpha = 0.5;
  for (let r = 26; r < TARGET_RADIUS - 8; r += 20) {
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(TARGET_CX, TARGET_CY, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // A rotating grain knot + radial scribe so the spin is legible.
  ctx.save();
  ctx.translate(TARGET_CX, TARGET_CY);
  ctx.rotate(spin);
  ctx.strokeStyle = c.woodEdge;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-TARGET_RADIUS + 14, 0);
  ctx.lineTo(TARGET_RADIUS - 14, 0);
  ctx.stroke();
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = c.woodEdge;
  ctx.beginPath();
  ctx.ellipse(TARGET_RADIUS * 0.5, 0, 6, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Bullseye hub.
  ctx.fillStyle = c.bullEdge;
  ctx.beginPath();
  ctx.arc(TARGET_CX, TARGET_CY, 22, 0, Math.PI * 2);
  ctx.fill();
  const bg = ctx.createRadialGradient(
    TARGET_CX - 6,
    TARGET_CY - 7,
    2,
    TARGET_CX,
    TARGET_CY,
    22,
  );
  bg.addColorStop(0, c.bull);
  bg.addColorStop(1, c.bullEdge);
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(TARGET_CX, TARGET_CY, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.beginPath();
  ctx.arc(TARGET_CX - 5, TARGET_CY - 6, 4, 0, Math.PI * 2);
  ctx.fill();
};

// One knife lodged (or ready) at world `angle` on a ring of radius `R` around
// (cx, cy). Blade points inward (into the wood); handle sticks out.
const paintKnife = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  angle: number,
  R: number,
  blade: string,
  bladeHi: string,
  bladeEdge: string,
  handle: string,
  handleHi: string,
  alpha: number,
) => {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const px = -uy; // perpendicular
  const py = ux;
  const rimX = cx + ux * R;
  const rimY = cy + uy * R;
  const tipX = cx + ux * (R - BLADE_LEN);
  const tipY = cy + uy * (R - BLADE_LEN);
  const handX = cx + ux * (R + HANDLE_LEN);
  const handY = cy + uy * (R + HANDLE_LEN);

  ctx.save();
  ctx.globalAlpha = alpha;

  // Hard offset shadow.
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = KNIFE_HALF_W * 2 + 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(tipX + 1.5, tipY + 2);
  ctx.lineTo(handX + 1.5, handY + 2);
  ctx.stroke();

  // Blade (rim → tip): filled triangle so it tapers to a point.
  ctx.beginPath();
  ctx.moveTo(rimX + px * KNIFE_HALF_W, rimY + py * KNIFE_HALF_W);
  ctx.lineTo(rimX - px * KNIFE_HALF_W, rimY - py * KNIFE_HALF_W);
  ctx.lineTo(tipX, tipY);
  ctx.closePath();
  ctx.fillStyle = blade;
  ctx.fill();
  // Blade top-light streak.
  ctx.strokeStyle = bladeHi;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(rimX + px * (KNIFE_HALF_W - 1.5), rimY + py * (KNIFE_HALF_W - 1.5));
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  // Blade edge.
  ctx.strokeStyle = bladeEdge;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(rimX - px * KNIFE_HALF_W, rimY - py * KNIFE_HALF_W);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();

  // Handle (rim → out): rounded bar.
  ctx.strokeStyle = handle;
  ctx.lineWidth = KNIFE_HALF_W * 2 + 1;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(rimX, rimY);
  ctx.lineTo(handX, handY);
  ctx.stroke();
  // Guard at the rim.
  ctx.strokeStyle = bladeEdge;
  ctx.lineWidth = KNIFE_HALF_W * 2 + 4;
  ctx.beginPath();
  ctx.moveTo(rimX - ux * 1.5, rimY - uy * 1.5);
  ctx.lineTo(rimX + ux * 1.5, rimY + uy * 1.5);
  ctx.stroke();
  // Handle sheen.
  ctx.strokeStyle = handleHi;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(rimX + ux * 3 + px * 2, rimY + uy * 3 + py * 2);
  ctx.lineTo(handX + px * 2, handY + py * 2);
  ctx.stroke();

  ctx.restore();
};

// One bonus fruit pinned to the target rim at world `angle`.
const paintFruit = (
  ctx: CanvasRenderingContext2D,
  c: KnifeBoothTheme,
  cx: number,
  cy: number,
  angle: number,
  R: number,
  pulse: number,
) => {
  const fx = cx + Math.cos(angle) * (R - 12);
  const fy = cy + Math.sin(angle) * (R - 12);
  const rad = 10 + pulse * 1.2;
  ctx.save();
  // Leaf.
  ctx.fillStyle = c.fruitLeaf;
  ctx.beginPath();
  ctx.ellipse(fx + 5, fy - rad, 5, 3, -0.7, 0, Math.PI * 2);
  ctx.fill();
  // Body.
  const g = ctx.createRadialGradient(fx - 3, fy - 4, 1, fx, fy, rad);
  g.addColorStop(0, c.fruitHi);
  g.addColorStop(1, c.fruit);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(fx, fy, rad, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.arc(fx - rad * 0.35, fy - rad * 0.4, rad * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

export default function KnifeBoothClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [gameState, setGameState] = useState<GameState>('idle');
  const [score, setScore] = useState(0);
  const [stageNo, setStageNo] = useState(1);
  const [landed, setLanded] = useState(0);
  const [quota, setQuota] = useState(0);
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
  const [theme, setTheme] = useState<KnifeBoothTheme>(DEFAULT_KNIFE_BOOTH_THEME);
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

  // The authoritative sim state — advanced ONLY through knifeApplyThrow, the same
  // pure state machine the server replays. Never mutate fields directly.
  const simRef = useRef<KnifeSimState>(knifeInitialState(0));
  const scheduleRef = useRef<KnifeSegment[]>([]);
  const boardRef = useRef<KnifeStageBoard | null>(null);
  const stageStartRef = useRef(0); // performance.now() when the current stage began
  const rotationRef = useRef(0); // last rendered target rotation (rad)
  const scoreRef = useRef(0);
  const throwsRef = useRef<RecordedThrow[]>([]);

  const animationRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const accumulatorRef = useRef<number>(0);
  const scaleRef = useRef(1);
  const gameStartTimeRef = useRef(0);
  const gameOverTimeRef = useRef<number>(0);
  const shardsRef = useRef<Shard[]>([]);
  const labelsRef = useRef<FloatLabel[]>([]);
  const matterModRef = useRef<MatterModule | null>(null);
  const matterEngineRef = useRef<import('matter-js').Engine | null>(null);
  const debrisRef = useRef<Debris[]>([]);
  const flightRef = useRef<Flight | null>(null);
  const demoRef = useRef<DemoState>({ spin: 0, lastThrowAt: 0, knives: [] });
  const reducedMotionRef = useRef(false);
  const impactRef = useRef(0); // 0..1 decaying impact pop on a landed knife
  const shakeRef = useRef(0); // 0..1 decaying canvas shake (land / shatter)
  const scorePopRef = useRef(0); // 0..1 pop on the canvas score readout
  const shineRef = useRef(0); // 0..1 stage-clear shine sweep
  const deathRef = useRef(0); // 0..1 red shatter flash on the fatal throw
  const deathAngleRef = useRef<number | null>(null); // world angle of the fatal blade
  const saveScoreRef = useRef<
    ((score: number, throws: RecordedThrow[], durMs: number) => Promise<void>) | null
  >(null);
  const endRunRef = useRef<((died: boolean) => void) | null>(null);
  const drawRef = useRef<((ctx: CanvasRenderingContext2D) => void) | null>(null);
  const bestScoreCacheRef = useRef<number | null>(null);
  const themeRef = useRef<KnifeBoothTheme>(DEFAULT_KNIFE_BOOTH_THEME);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  const paintOnce = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
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
      const response = await fetch('/api/games/knife-booth/score', {
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
      const response = await fetch('/api/store/inventory?gameType=knife-booth', {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = (await response.json()) as InventoryCosmeticResponse;
      setWalletBalances({ credits: payload.wallet?.credits ?? 0 });
      setDailyCreditsProgress({
        earned: payload.dailyGameCredits?.earned ?? 0,
        cap: payload.dailyGameCredits?.cap ?? 300,
      });
      setTheme(buildKnifeBoothTheme(payload));
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
    throws: RecordedThrow[],
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
      const response = await fetch('/api/games/knife-booth/score', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: finalScore,
          sessionToken: sessionTokenRef.current,
          throws,
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
        console.error(`[KnifeBooth] Score rejected (${response.status}): ${reason}`);
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

  const spawnLabel = useCallback((text: string, tone: CanvasCalloutTone, x: number, y: number, dim = false) => {
    labelsRef.current.push({
      text: text.toLowerCase(),
      tone,
      x,
      y,
      life: 1,
      dim,
    });
    if (labelsRef.current.length > 8) labelsRef.current.shift();
  }, []);

  // Spark burst at a world angle on the target rim (render-only).
  const spawnSparks = useCallback((angle: number, count: number, hot: boolean) => {
    if (reducedMotionRef.current) return;
    const c = themeRef.current;
    const nx = TARGET_CX + Math.cos(angle) * TARGET_RADIUS;
    const ny = TARGET_CY + Math.sin(angle) * TARGET_RADIUS;
    for (let s = 0; s < count; s += 1) {
      const dir = angle + Math.PI + (Math.random() - 0.5) * 1.8;
      const speed = 1.6 + Math.random() * 3.2;
      shardsRef.current.push({
        x: nx,
        y: ny,
        vx: Math.cos(dir) * speed,
        vy: Math.sin(dir) * speed,
        life: 1,
        size: 1.5 + Math.random() * 3,
        color:
          Math.random() < 0.5 ? c.sparkHot : hot ? c.fruitHi : c.spark,
      });
    }
  }, []);

  // ── matter-js world for the shattered blade (render-only). Floor = the lane
  //    rail, so the broken knife bounces once and settles in the slot. ──
  const ensureMatterWorld = useCallback((): import('matter-js').Engine | null => {
    const M = matterModRef.current;
    if (!M) return null;
    if (matterEngineRef.current) return matterEngineRef.current;
    const engine = M.Engine.create();
    engine.gravity.y = 1.3;
    const floor = M.Bodies.rectangle(BASE_WIDTH / 2, LANE_Y + 18, BASE_WIDTH * 2, 40, {
      isStatic: true,
      friction: 0.8,
    });
    M.Composite.add(engine.world, floor);
    matterEngineRef.current = engine;
    return engine;
  }, []);

  const clearDebris = useCallback(() => {
    const M = matterModRef.current;
    const engine = matterEngineRef.current;
    if (M && engine) {
      for (const d of debrisRef.current) M.Composite.remove(engine.world, d.body);
    }
    debrisRef.current = [];
  }, []);

  // The rejected blade ricochets off the lodged knife and tumbles into the lane.
  const spawnShatterDebris = useCallback(
    (worldAngle: number) => {
      if (reducedMotionRef.current) return;
      const M = matterModRef.current;
      const engine = ensureMatterWorld();
      if (!M || !engine) return;
      const x = TARGET_CX + Math.cos(worldAngle) * (TARGET_RADIUS + 10);
      const y = TARGET_CY + Math.sin(worldAngle) * (TARGET_RADIUS + 10);
      const body = M.Bodies.rectangle(x, y, 8, BLADE_LEN + HANDLE_LEN, {
        restitution: 0.45,
        friction: 0.5,
        frictionAir: 0.012,
        density: 0.002,
      });
      M.Body.setVelocity(body, { x: (Math.random() - 0.5) * 6, y: -(2 + Math.random() * 3) });
      M.Body.setAngularVelocity(body, (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.2));
      if (debrisRef.current.length >= 3) {
        const oldest = debrisRef.current.shift()!;
        M.Composite.remove(engine.world, oldest.body);
      }
      M.Composite.add(engine.world, body);
      debrisRef.current.push({ body, len: BLADE_LEN + HANDLE_LEN, life: 1, settledFrames: 0 });
    },
    [ensureMatterWorld],
  );

  // ── Load the schedule + board for a stage and reset the stage clock. ──
  const enterStage = useCallback((stage: number) => {
    const seed = seedRef.current;
    if (seed === null) return;
    scheduleRef.current = knifeStageSchedule(seed, stage);
    boardRef.current = knifeStageBoard(seed, stage);
    stageStartRef.current = performance.now();
    rotationRef.current = 0;
  }, []);

  // ── End the run. `died` distinguishes a fatal shatter (freeze + red flash)
  //    from a defensive stop. The authoritative score is the server's replay of
  //    the throw log — we submit scoreRef, which mirrors the validator. ──
  const endRun = useCallback(
    (died: boolean) => {
      if (gameStateRef.current !== 'playing') return;
      const durationMs = performance.now() - gameStartTimeRef.current;
      gameStateRef.current = 'gameover';
      setGameState('gameover');
      gameOverTimeRef.current = performance.now();
      if (died) {
        deathRef.current = 1;
        SoundManager.play(SFX.shatter);
        window.setTimeout(() => SoundManager.play(SFX.over), 260);
      } else {
        SoundManager.play(SFX.over);
      }
      if (scoreRef.current > highScore) setHighScore(scoreRef.current);
      saveScoreRef.current?.(scoreRef.current, throwsRef.current.slice(), durationMs);
      paintOnce();
    },
    [highScore, paintOnce],
  );
  endRunRef.current = endRun;

  // ── The single action: throw a knife at the current target. Every gameplay
  //    verdict comes from knifeApplyThrow — the EXACT function the server
  //    replays — so the on-screen outcome always matches the authoritative one. ──
  const throwKnife = useCallback(() => {
    if (gameStateRef.current !== 'playing') return;
    const seed = seedRef.current;
    const schedule = scheduleRef.current;
    const board = boardRef.current;
    if (seed === null || !board || schedule.length === 0) return;

    const now = performance.now();
    const t = Math.max(0, Math.floor(now - stageStartRef.current));

    // Record EVERY throw so the server sees the full log (including cadence-
    // ignored ones, which both sides skip identically). If the defensive cap is
    // reached the throw must not advance the local sim either — parity is sacred.
    if (throwsRef.current.length >= KNIFE_MAX_TAPS - 2) return;
    throwsRef.current.push({ t });

    const { state, event } = knifeApplyThrow(seed, simRef.current, t, schedule, board);

    if (event.type === 'ignored') return; // under the cadence floor — no-op on both sides
    if (event.type === 'bounds') {
      endRunRef.current?.(false);
      return;
    }

    if (event.type === 'shatter') {
      // Fatal. Freeze + flash the offending blade; the broken knife tumbles
      // into the lane as a physics body.
      const fatalWorld = knifeNorm(event.angle + rotationRef.current);
      deathAngleRef.current = fatalWorld;
      spawnSparks(fatalWorld, 14, false);
      spawnShatterDebris(fatalWorld);
      shakeRef.current = 1;
      playHaptic('failure');
      endRunRef.current?.(true);
      return;
    }

    // Landed — commit the new sim state.
    const prevStage = simRef.current.stage;
    simRef.current = state;
    if (state.score > scoreRef.current) scorePopRef.current = 1;
    scoreRef.current = state.score;
    setScore(state.score);
    impactRef.current = 1;
    shakeRef.current = 0.5;
    // Render-only flight streak: hide the just-lodged knife for ~90ms while a
    // streaking knife travels from the lane to the rim. (Skipped on a stage
    // clear — the whole board resets — and under reduced motion.)
    if (!reducedMotionRef.current && !event.stageCleared) {
      flightRef.current = {
        until: performance.now() + 90,
        dur: 90,
        outcome: 'land',
        suppressIndex: state.landedAngles.length - 1,
      };
    }

    const worldAngle = knifeNorm(event.angle + rotationRef.current);
    spawnSparks(worldAngle, event.slicedFruit >= 0 ? 12 : 7, event.slicedFruit >= 0);
    SoundManager.play(SFX.thunk);
    playHaptic(event.slicedFruit >= 0 ? 'medium' : 'light');

    const labelX = TARGET_CX + Math.cos(worldAngle) * (TARGET_RADIUS + 34);
    const labelY = TARGET_CY + Math.sin(worldAngle) * (TARGET_RADIUS + 34);
    if (event.slicedFruit >= 0) {
      SoundManager.play(SFX.fruit);
      shakeRef.current = 0.85; // fruit hits kick a little harder
      spawnLabel('FRUIT +5', 'score', labelX, labelY);
    } else if (!event.stageCleared) {
      spawnLabel('+1', 'score', labelX, labelY, true);
    }

    if (event.stageCleared) {
      // Stage clear: advance to the next stage, reset the target clock, flourish.
      shineRef.current = 1;
      playHaptic('success');
      if (event.bossCleared) {
        SoundManager.play(SFX.boss);
        spawnLabel('BOSS DOWN', 'combo', TARGET_CX, TARGET_CY - TARGET_RADIUS - 16);
      } else {
        SoundManager.play(SFX.stage);
        spawnLabel(`STAGE ${prevStage + 1} CLEAR`, 'combo', TARGET_CX, TARGET_CY - TARGET_RADIUS - 16);
      }
      if (state.stage >= KNIFE_MAX_STAGES) {
        endRunRef.current?.(false);
        return;
      }
      enterStage(state.stage);
      const nextBoard = boardRef.current;
      setStageNo(state.stage + 1);
      setLanded(0);
      setQuota(nextBoard ? nextBoard.quota : 0);
      return;
    }

    setLanded(state.landed);
  }, [enterStage, spawnLabel, spawnSparks, spawnShatterDebris]);

  // ── One fixed step: advance the target rotation + decay juice envelopes. ──
  const stepSim = useCallback(() => {
    if (gameStateRef.current === 'playing' && scheduleRef.current.length > 0) {
      const t = performance.now() - stageStartRef.current;
      rotationRef.current = knifeAngleFromSchedule(scheduleRef.current, t);
    }
    if (impactRef.current > 0) impactRef.current = Math.max(0, impactRef.current - 0.09);
    if (shakeRef.current > 0) shakeRef.current = Math.max(0, shakeRef.current - 0.06);
    if (scorePopRef.current > 0) scorePopRef.current = Math.max(0, scorePopRef.current - 0.08);
    if (shineRef.current > 0) shineRef.current = Math.max(0, shineRef.current - 0.02);
    if (deathRef.current > 0 && gameStateRef.current === 'gameover') {
      deathRef.current = Math.max(0, deathRef.current - 0.02);
    }
  }, []);

  // ── Render ──
  const draw = useCallback((ctx: CanvasRenderingContext2D) => {
    const c = themeRef.current;
    const now = performance.now();
    const state = gameStateRef.current;
    const sim = simRef.current;
    const board = boardRef.current;
    const isDemo = state === 'idle';
    const spin = isDemo ? demoRef.current.spin : rotationRef.current;
    const impact = reducedMotionRef.current ? 0 : impactRef.current;
    const shake = reducedMotionRef.current ? 0 : shakeRef.current;
    const flight = flightRef.current && now < flightRef.current.until ? flightRef.current : null;
    if (flightRef.current && !flight) flightRef.current = null;

    paintBooth(ctx, c);

    // The target group takes an impact pop + a downward recoil on a landed
    // knife, plus a fast decaying shake (land / fruit / fatal shatter).
    ctx.save();
    if (shake > 0) {
      ctx.translate(Math.sin(now * 0.15) * shake * 5, Math.cos(now * 0.13) * shake * 4);
    }
    if (impact > 0) {
      const s = 1 + impact * 0.05;
      ctx.translate(TARGET_CX, TARGET_CY + impact * 6);
      ctx.scale(s, s);
      ctx.translate(-TARGET_CX, -TARGET_CY);
    }

    paintTarget(ctx, c, spin);

    // Bonus fruit (drawn under the knives so a slicing blade sits on top).
    if (board && (state === 'playing' || state === 'gameover')) {
      const pulse = reducedMotionRef.current ? 0 : 0.5 + 0.5 * Math.sin(now * 0.006);
      for (let i = 0; i < board.fruits.length; i += 1) {
        if (sim.slicedFruit[i]) continue;
        paintFruit(ctx, c, TARGET_CX, TARGET_CY, board.fruits[i]! + spin, TARGET_RADIUS, pulse);
      }
    }

    // Pre-placed obstacle knives (dimmer), then the player's lodged knives.
    if (board) {
      for (const o of board.obstacles) {
        paintKnife(
          ctx,
          TARGET_CX,
          TARGET_CY,
          o + spin,
          TARGET_RADIUS,
          c.obstacleBlade,
          c.bladeHi,
          c.bladeEdge,
          c.obstacleHandle,
          c.handleHi,
          0.92,
        );
      }
    }
    for (let ki = 0; ki < sim.landedAngles.length; ki += 1) {
      // The just-lodged knife stays hidden while its flight streak travels.
      if (flight && flight.outcome === 'land' && ki === flight.suppressIndex) continue;
      paintKnife(
        ctx,
        TARGET_CX,
        TARGET_CY,
        sim.landedAngles[ki]! + spin,
        TARGET_RADIUS,
        c.blade,
        c.bladeHi,
        c.bladeEdge,
        c.handle,
        c.handleHi,
        1,
      );
    }

    // Idle-demo lodged knives (the ghost thrower's board).
    if (isDemo) {
      for (const ka of demoRef.current.knives) {
        paintKnife(
          ctx,
          TARGET_CX,
          TARGET_CY,
          ka + spin,
          TARGET_RADIUS,
          c.blade,
          c.bladeHi,
          c.bladeEdge,
          c.handle,
          c.handleHi,
          0.95,
        );
      }
    }

    // ── Throw-clarity layer (playing only): occupied-zone bands on the rim +
    //    a live SAFE/HIT indicator at the contact point. Uses the EXACT server
    //    collision constant, so the indicator never lies. ──
    if (state === 'playing' && board) {
      const occupied = [...board.obstacles, ...sim.landedAngles];
      ctx.save();
      ctx.lineWidth = 6;
      ctx.strokeStyle = c.buntingRed;
      ctx.globalAlpha = 0.22;
      for (const oa of occupied) {
        const wa = oa + spin;
        ctx.beginPath();
        ctx.arc(TARGET_CX, TARGET_CY, TARGET_RADIUS + 8, wa - KNIFE_COLLIDE_ANGLE, wa + KNIFE_COLLIDE_ANGLE);
        ctx.stroke();
      }
      ctx.restore();

      const contactBoard = knifeNorm(KNIFE_THROW_ANGLE - spin);
      let danger = false;
      for (const oa of occupied) {
        if (knifeAngularDelta(contactBoard, oa) < KNIFE_COLLIDE_ANGLE) {
          danger = true;
          break;
        }
      }
      const bottomY = TARGET_CY + TARGET_RADIUS;
      const indColor = danger ? c.buntingRed : '#57c46a';
      ctx.save();
      // Contact arc at the bottom rim.
      ctx.strokeStyle = indColor;
      ctx.lineWidth = 4;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(TARGET_CX, TARGET_CY, TARGET_RADIUS + 8, Math.PI / 2 - KNIFE_COLLIDE_ANGLE, Math.PI / 2 + KNIFE_COLLIDE_ANGLE);
      ctx.stroke();
      // Pointer diamond just below the rim.
      ctx.globalAlpha = 1;
      ctx.fillStyle = indColor;
      ctx.beginPath();
      ctx.moveTo(TARGET_CX, bottomY + 12);
      ctx.lineTo(TARGET_CX + 7, bottomY + 21);
      ctx.lineTo(TARGET_CX, bottomY + 30);
      ctx.lineTo(TARGET_CX - 7, bottomY + 21);
      ctx.closePath();
      ctx.fill();
      // Dashed aim line from the lane knife up to the contact point.
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = indColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 9]);
      ctx.beginPath();
      ctx.moveTo(TARGET_CX, LANE_Y - 34);
      ctx.lineTo(TARGET_CX, bottomY + 32);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Fatal-shatter flash on the offending blade.
    if (state === 'gameover' && deathRef.current > 0 && deathAngleRef.current !== null) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.85, deathRef.current);
      paintKnife(
        ctx,
        TARGET_CX,
        TARGET_CY,
        deathAngleRef.current,
        TARGET_RADIUS,
        c.buntingRed,
        '#ffd5d5',
        '#5e1a1c',
        c.buntingRed,
        '#ffd5d5',
        1,
      );
      ctx.restore();
    }

    // Stage-clear shine sweep across the target face.
    const shine = shineRef.current;
    if (shine > 0 && !reducedMotionRef.current) {
      const sweepA = -Math.PI / 2 + (1 - shine) * Math.PI * 2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(TARGET_CX, TARGET_CY, TARGET_RADIUS - 4, 0, Math.PI * 2);
      ctx.clip();
      ctx.globalAlpha = 0.26 * Math.min(1, shine * 2);
      ctx.fillStyle = c.sparkHot;
      ctx.beginPath();
      ctx.moveTo(TARGET_CX, TARGET_CY);
      ctx.arc(TARGET_CX, TARGET_CY, TARGET_RADIUS, sweepA - 0.32, sweepA + 0.32);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.restore(); // impact transform

    // Render-only flight streak: a knife blurring from the lane to the rim.
    if (flight) {
      const p = 1 - (flight.until - now) / flight.dur;
      const y0 = LANE_Y - 30;
      const y1 = TARGET_CY + TARGET_RADIUS - 6;
      const fy = y0 + (y1 - y0) * p;
      ctx.save();
      for (let g = 0; g < 3; g += 1) {
        const gy = fy + g * 16;
        if (gy > y0) continue;
        ctx.globalAlpha = 0.85 - g * 0.3;
        ctx.strokeStyle = g === 0 ? c.blade : c.bladeHi;
        ctx.lineWidth = KNIFE_HALF_W * 2 - g;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(TARGET_CX, gy);
        ctx.lineTo(TARGET_CX, Math.min(y0, gy + 30));
        ctx.stroke();
      }
      ctx.restore();
    }

    // Shattered-blade physics debris tumbling in the lane.
    for (const d of debrisRef.current) {
      const { body } = d;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, d.life * 1.4));
      ctx.translate(body.position.x, body.position.y);
      ctx.rotate(body.angle);
      ctx.lineCap = 'round';
      ctx.strokeStyle = c.blade;
      ctx.lineWidth = KNIFE_HALF_W * 2;
      ctx.beginPath();
      ctx.moveTo(0, -d.len / 2);
      ctx.lineTo(0, 2);
      ctx.stroke();
      ctx.strokeStyle = c.handle;
      ctx.lineWidth = KNIFE_HALF_W * 2 + 1;
      ctx.beginPath();
      ctx.moveTo(0, 2);
      ctx.lineTo(0, d.len / 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    // First-throw coaching: one line above the lane until the first knife lands.
    if (state === 'playing' && sim.stage === 0 && sim.landed === 0 && !reducedMotionRef.current) {
      ctx.save();
      ctx.globalAlpha = 0.55 + 0.3 * Math.sin(now / 300);
      ctx.font = "700 13px var(--font-mono-arcade, 'Spline Sans Mono'), ui-monospace, monospace";
      ctx.textAlign = 'center';
      ctx.fillStyle = c.cream;
      ctx.fillText('throw when the marker under the target turns GREEN', TARGET_CX, LANE_Y - 48);
      ctx.restore();
    }

    // The ready knife sitting in the lane, aimed up at the target contact point.
    if (state === 'playing' || isDemo) {
      const glowOn = c.knifeGlowEnabled && !reducedMotionRef.current;
      if (glowOn) {
        ctx.save();
        ctx.shadowColor = c.knifeGlowColor;
        ctx.shadowBlur = 16;
      }
      // Draw a knife pointing up from the lane toward the target's bottom.
      // While playing it bobs gently in place — pure anticipation juice; the
      // throw verdict never reads this offset.
      const laneX = TARGET_CX;
      const bob =
        state === 'playing' && !reducedMotionRef.current
          ? Math.sin(now * 0.004) * 3
          : 0;
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.translate(0, bob);
      // blade up
      ctx.strokeStyle = c.blade;
      ctx.lineWidth = KNIFE_HALF_W * 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(laneX, LANE_Y - 2);
      ctx.lineTo(laneX, LANE_Y - 30);
      ctx.stroke();
      ctx.strokeStyle = c.bladeHi;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(laneX - 1.5, LANE_Y - 4);
      ctx.lineTo(laneX - 1.5, LANE_Y - 28);
      ctx.stroke();
      // handle down
      ctx.strokeStyle = c.handle;
      ctx.lineWidth = KNIFE_HALF_W * 2 + 1;
      ctx.beginPath();
      ctx.moveTo(laneX, LANE_Y - 2);
      ctx.lineTo(laneX, LANE_Y + 14);
      ctx.stroke();
      ctx.restore();
      if (glowOn) ctx.restore();
    }

    // Sparks (render-only).
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

    // Center readout: SCORE headline + stage / progress line.
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const scoreText = state === 'idle' ? '0' : scoreRef.current.toString();
    const scorePop = reducedMotionRef.current ? 0 : scorePopRef.current;
    ctx.font = `800 ${34 + scorePop * 8}px var(--font-mono-arcade, 'Spline Sans Mono'), ui-monospace, monospace`;
    ctx.fillStyle = 'rgba(8,7,4,0.55)';
    ctx.fillText(scoreText, TARGET_CX + 1.5, TARGET_CY + 3);
    ctx.fillStyle = c.cream;
    ctx.fillText(scoreText, TARGET_CX, TARGET_CY + 1.5);
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
      ctx.save();
      if (lb.dim) ctx.globalAlpha *= 0.75;
      drawCanvasCallout(ctx, calloutLook, {
        text: lb.text,
        x: lb.x,
        y: lb.y,
        u: 1 - lb.life,
        tone: lb.tone,
        reducedMotion: reducedMotionRef.current,
        within: { left: 0, top: 0, right: BASE_WIDTH, bottom: BASE_HEIGHT },
      });
      ctx.restore();
    }
  }, []);
  drawRef.current = draw;

  const gameLoop = useCallback(
    (currentTime: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;

      let deltaTime = currentTime - lastTimeRef.current;
      lastTimeRef.current = currentTime;
      if (deltaTime > 100) deltaTime = FRAME_TIME;

      accumulatorRef.current += deltaTime;
      let updates = 0;
      const maxUpdates = 4;
      while (accumulatorRef.current >= FRAME_TIME && updates < maxUpdates) {
        stepSim();
        accumulatorRef.current -= FRAME_TIME;
        updates += 1;
      }
      if (updates >= maxUpdates) accumulatorRef.current = 0;

      // Idle demo: keep the target spinning and land a ghost knife on a loop.
      if (gameStateRef.current === 'idle' && !reducedMotionRef.current) {
        const demo = demoRef.current;
        demo.spin = knifeNorm(demo.spin + (deltaTime / 1000) * 1.7);
        if (currentTime - demo.lastThrowAt > 900) {
          demo.knives.push(knifeNorm(KNIFE_THROW_ANGLE - demo.spin));
          if (demo.knives.length > 7) demo.knives = [];
          demo.lastThrowAt = currentTime;
        }
      }

      // Advance the shattered-blade physics + cull settled pieces.
      const M = matterModRef.current;
      const engine = matterEngineRef.current;
      if (M && engine && debrisRef.current.length > 0) {
        M.Engine.update(engine, Math.min(deltaTime, 33.3));
        const debris = debrisRef.current;
        for (let i = debris.length - 1; i >= 0; i -= 1) {
          const d = debris[i]!;
          const off =
            d.body.position.x < -60 ||
            d.body.position.x > BASE_WIDTH + 60 ||
            d.body.position.y > BASE_HEIGHT + 60;
          const speed = Math.abs(d.body.velocity.x) + Math.abs(d.body.velocity.y);
          if (speed < 0.35) d.settledFrames += 1;
          if (d.settledFrames > 30) d.life -= 0.03;
          if (off || d.life <= 0) {
            M.Composite.remove(engine.world, d.body);
            debris.splice(i, 1);
          }
        }
      }

      ctx.save();
      ctx.scale(scaleRef.current, scaleRef.current);
      draw(ctx);
      ctx.restore();

      if (
        gameStateRef.current === 'playing' ||
        (gameStateRef.current === 'idle' && !reducedMotionRef.current) ||
        (gameStateRef.current === 'gameover' &&
          (shardsRef.current.length > 0 ||
            labelsRef.current.length > 0 ||
            debrisRef.current.length > 0 ||
            deathRef.current > 0.01 ||
            shakeRef.current > 0.01 ||
            shineRef.current > 0.01))
      ) {
        animationRef.current = requestAnimationFrame(gameLoop);
      }
    },
    [draw, stepSim],
  );

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
        body: JSON.stringify({ gameType: 'knife-booth' }),
      });
      if (sessionResponse.ok) {
        setBanIndefinite(false);
        setBanUntilMs(null);
        const sessionData = await sessionResponse.json();
        sessionTokenRef.current = sessionData.token;
        seedRef.current =
          typeof sessionData.knifeBoothSeed === 'number'
            ? sessionData.knifeBoothSeed
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

    const seed = seedRef.current!;
    cancelAnimationFrame(animationRef.current);
    simRef.current = knifeInitialState(seed);
    scoreRef.current = 0;
    setScore(0);
    throwsRef.current = [];
    shardsRef.current = [];
    labelsRef.current = [];
    clearDebris();
    flightRef.current = null;
    impactRef.current = 0;
    shakeRef.current = 0;
    scorePopRef.current = 0;
    shineRef.current = 0;
    deathRef.current = 0;
    deathAngleRef.current = null;
    enterStage(0);
    const board0 = boardRef.current;
    setStageNo(1);
    setLanded(0);
    setQuota(board0 ? board0.quota : 0);
    lastTimeRef.current = performance.now();
    gameStartTimeRef.current = lastTimeRef.current;
    stageStartRef.current = lastTimeRef.current;
    accumulatorRef.current = 0;
    gameStateRef.current = 'playing';
    setGameState('playing');
    SoundManager.play(SFX.start);

    animationRef.current = requestAnimationFrame(gameLoop);
  }, [clearDebris, enterStage, gameLoop, resetRunResult]);

  const primaryAction = useCallback(() => {
    const current = gameStateRef.current;
    if (current === 'playing') {
      throwKnife();
    } else if (current === 'idle' || current === 'error') {
      startGame();
    } else if (current === 'gameover') {
      const since = performance.now() - gameOverTimeRef.current;
      if (since >= RESTART_GRACE_PERIOD) startGame();
    }
  }, [throwKnife, startGame]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'Space' || e.code === 'Enter' || e.key === ' ') {
        if (blocksGameKeyboard(e.target)) return;
        SoundManager.unlock();
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

  const handleStagePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      SoundManager.unlock();
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
      cancelAnimationFrame(animationRef.current);
      monitor.stop();
    };
  }, []);

  // Prefetch matter-js (shatter debris) so it's ready before the first death.
  useEffect(() => {
    let alive = true;
    import('matter-js')
      .then((m) => {
        if (alive) matterModRef.current = m;
      })
      .catch(() => {
        /* the shatter simply skips its debris if the import never lands */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Drive the idle-demo loop (skipped entirely under reduced motion).
  useEffect(() => {
    if (gameState !== 'idle' || reducedMotionRef.current) return;
    cancelAnimationFrame(animationRef.current);
    lastTimeRef.current = performance.now();
    animationRef.current = requestAnimationFrame(gameLoop);
    return () => {
      // On idle→playing the id in animationRef already belongs to the run's
      // loop (startGame scheduled it before this cleanup fires) — cancelling
      // here would freeze the game. Only stop a loop that isn't a live run.
      if (gameStateRef.current !== 'playing') {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [gameState, gameLoop]);

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
    };
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const updateSize = () => {
      const container = containerRef.current;
      if (!container) return;
      const reservedVertical = window.innerHeight < 700 ? 220 : 280;
      const maxWidth = Math.min(window.innerWidth - 24, 940);
      const maxHeight = Math.min(window.innerHeight - reservedVertical, BASE_HEIGHT);
      const scale = Math.min(maxWidth / BASE_WIDTH, maxHeight / BASE_HEIGHT, 1.25);
      const dpr = gameCanvasDpr(BASE_WIDTH * scale, BASE_HEIGHT * scale);
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

  // Idle render whenever size/theme changes and we're not actively looping.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
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
    <div className="knife-booth-midway arc-game-flow">
      <div className="w-full space-y-3 sm:space-y-4">
        <div className="mx-auto w-full max-w-5xl">
          <div className="hidden sm:block">
            <PageHeader
              eyebrow="Arcade"
              icon={<Target aria-hidden className="h-6 w-6" />}
              title="Knife Booth"
              subtitle="Throw the instant the target opens a gap. Fill the quota to clear the stage, slice the fruit for bonus — but land on a lodged blade and it's over."
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
            Stage <span className="font-semibold text-strong">{stageNo}</span>
            {quota > 0 && (
              <span className="text-faint"> ({landed}/{quota})</span>
            )}
          </span>
          <span className="arcade-num text-sm text-body sm:text-base">
            Best <span className="font-semibold text-strong">{highScore}</span>
          </span>
        </div>

        <div ref={containerRef} className="relative touch-none flex justify-center">
          <div
            className="knife-stage relative"
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
                className="knife-overlay absolute inset-0 flex touch-none flex-col items-center justify-center rounded-well px-4"
                style={{
                  // Lighter veil while idle so the spinning-target demo behind
                  // it teaches the loop; full dim for game-over/error text.
                  background: `color-mix(in srgb, var(--scrim) ${
                    gameState === 'idle' ? '55%' : '78%'
                  }, transparent)`,
                }}
                onPointerDown={handleStagePointerDown}
              >
                {gameState === 'idle' && (
                  <>
                    <Target size={56} className="mb-4 text-tickets-text" />
                    <h1 className="arcade-display mb-2 text-center text-2xl text-strong uppercase sm:text-3xl">
                      Knife Booth
                    </h1>
                    <p className="mb-2 text-center text-sm text-strong sm:text-base">
                      {isStartingSession
                        ? 'Starting your run…'
                        : touchDevice
                          ? 'Tap anywhere to start'
                          : 'Press Space or click to start'}
                    </p>
                    <div className="flex max-w-xs flex-col gap-1.5 text-left text-xs text-body sm:text-sm">
                      <span className="flex items-center gap-2">
                        <Target size={14} className="shrink-0 text-tickets-text" aria-hidden />
                        Tap to throw into the spinning target — the marker under
                        it is green when the landing spot is clear.
                      </span>
                      <span className="flex items-center gap-2">
                        <AlertTriangle size={14} className="shrink-0 text-danger-text" aria-hidden />
                        Hit an already-lodged blade and the run ends.
                      </span>
                      <span className="flex items-center gap-2">
                        <Apple size={14} className="shrink-0 text-prize-text" aria-hidden />
                        Slice fruit for +5 · fill the quota to clear the stage.
                      </span>
                    </div>
                  </>
                )}

                {gameState === 'gameover' && (
                  <>
                    <h2 className="arcade-display mb-2 text-2xl text-strong uppercase sm:text-3xl">
                      {deathAngleRef.current !== null ? 'Blade shattered' : 'Run complete'}
                    </h2>
                    <p className="mb-2 max-w-xs text-center text-xs text-body sm:text-sm">
                      {deathAngleRef.current !== null
                        ? 'Your knife hit an already-lodged blade — watch the red zones on the rim.'
                        : 'The run ended at its limit.'}
                    </p>
                    <p className="mb-1 text-xl text-strong sm:text-2xl">
                      Score{' '}
                      <span className="arcade-num font-semibold">{score}</span>{' '}
                      <span className="text-base text-body sm:text-lg">
                        (stage {stageNo})
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

        {/* The one button: a big cream THROW keycap. It IS the control on touch
            and a clear affordance on desktop; the canvas/overlay also accept taps. */}
        <div className="mt-3 flex w-full justify-center">
          <button
            type="button"
            className="knife-throw"
            data-pressed={tapPressed ? 'true' : undefined}
            aria-label={isPlaying ? 'Throw a knife' : 'Start'}
            onPointerDown={handleStagePointerDown}
            onPointerUp={handleStagePointerUp}
            onPointerLeave={handleStagePointerUp}
          >
            <Target aria-hidden size={20} />
            {isPlaying ? 'Throw' : 'Tap'}
          </button>
        </div>

        <p className="mt-3 text-center text-xs text-faint sm:text-sm">
          {touchDevice ? (
            'Tap anywhere to throw a knife'
          ) : (
            <>
              Throw with{' '}
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
        title="Knife Booth board"
        description="Highest run score, and your rank."
      >
        <GameLeaderboard
          gameType="knife-booth"
          maxEntries={5}
          enableFullLeaderboardModal
          fullLeaderboardDisplay="inline"
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>
    </div>
  );
}
