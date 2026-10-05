'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Cherry, CircleHelp } from 'lucide-react';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import { PageHeader, GamesWalletCard } from '@/features/arcade/components/shell/page-header';
import { MuteButton } from '@/features/arcade/components/mute-button';
import { EnvMonitor } from '@/features/arcade/lib/game-anti-cheat';
import { playHaptic } from '@/features/arcade/lib/game-haptics';
import { usePreventGameGestures, useIsTouchDevice } from '@/features/arcade/lib/game-mobile-utils';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import {
  createAdaptiveGameQuality,
  createGameFrameLoop,
  gameCanvasDpr,
  getGame2dContext,
  type GameFrameLoop,
} from '@/features/arcade/lib/game-frame-loop';
import { isNewBest } from '@/features/arcade/lib/new-best';
import { ArcadeRematchButton, ArcadeRunResult } from '@/features/arcade/components/results/arcade-run-result';
import { useArcadeRunResult } from '@/features/arcade/lib/run-result';
import type { AccountXpReward } from '@/server/arcade/rewards/types';
import {
  deriveMelonSchedule,
  melonFruitPosAtMs,
  scoreSwipe,
  MELON_RUN_MS,
  MELON_TICK_MS,
  MELON_PLAY_SIZE,
  MELON_GRACE_MS,
  MELON_MAX_SWIPE_POINTS,
  MELON_MAX_SWIPES,
  type MelonFruit,
  type MelonSwipe,
  type MelonSwipePoint,
} from '@/server/arcade/melon-chop-replay';
import {
  DEFAULT_MELON_CHOP_THEME,
  buildMelonChopTheme,
  type InventoryCosmeticResponse,
  type MelonChopTheme,
} from './_melon-chop-theme';

import './_melon-chop.css';
import {
  drawCanvasCallout,
  readCanvasCalloutLook,
  type CanvasCalloutTone,
} from '@/features/arcade/components/gameplay/callout-canvas';

// The canvas paints the normalized 1000×1000 play-space 1:1; scale + dpr keep
// sim coords display-independent, so a swipe's normalized coords match exactly
// what the server re-simulates.
const BASE = MELON_PLAY_SIZE;
const FRUIT_R = 42; // render radius (hit radius is a touch larger, server-side)

const RESTART_GRACE_PERIOD = 450;

const REWARDS_HINT_TEXT =
  'Rewards hint: swipe to slice the fruit lobbed up over 60 seconds — each fruit is worth points, and slicing several with one stroke multiplies the combo. Slicing a bomb ends the run. Bigger scores earn more tickets, and rewards taper at higher scores.';

// Distinct existing SoundManager names, mapped to booth moments.
const SFX = {
  slice: 'arcadeBet', // wet chop on a sliced fruit
  combo: 'coinCorrect', // bright chime — multi-fruit combo
  bomb: 'arcadeCrash', // bomb sliced
  over: 'arcadeLose',
  start: 'arcadeReveal',
  tick: 'arcadeCashout', // last-seconds countdown blip
} as const;

type GameState = 'idle' | 'playing' | 'gameover' | 'error';

// Keys pressed inside form controls, buttons or an open modal belong to that
// UI, not to the game.
const blocksGameKeyboard = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target.isContentEditable ||
    target.closest('input, textarea, select, button, a[href], [role="dialog"]')
  ) return true;
  return Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
};

// A short-lived juice droplet, impact ring or fruit half. Render-only.
type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
  ring?: boolean; // expanding impact ring at a slice point
  half?: { variant: number; hi: string; rot: number; spin: number };
};

// Floating verdict plate (the shared callout plate). Render-only.
type FloatLabel = {
  text: string;
  tone: CanvasCalloutTone;
  x: number;
  y: number;
  life: number;
};

// A fading blade-trail vertex. Render-only.
type TrailPoint = { x: number; y: number; life: number };

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

// ── Paint helpers. Each takes the resolved theme `c` so equipped cosmetics flow
//    straight into the render. Hard bevels + offset shadows; NOTHING glows by
//    default (the blade slot can opt into a subtle trail glow). ──

const paintBooth = (ctx: CanvasRenderingContext2D, c: MelonChopTheme) => {
  const bg = ctx.createLinearGradient(0, 0, 0, BASE);
  bg.addColorStop(0, c.bgTop);
  bg.addColorStop(1, c.bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, BASE, BASE);

  // Chopping-board planks across the bottom third.
  ctx.save();
  const boardTop = BASE * 0.72;
  ctx.fillStyle = c.board;
  ctx.fillRect(0, boardTop, BASE, BASE - boardTop);
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = c.boardLine;
  ctx.lineWidth = 3;
  for (let x = 90; x < BASE; x += 128) {
    ctx.beginPath();
    ctx.moveTo(x, boardTop);
    ctx.lineTo(x, BASE);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, boardTop, BASE, 3);
  ctx.restore();

  // Enamel bunting swag across the top (triangular pennants).
  const colors = [c.buntingRed, c.buntingAmber, c.buntingTeal];
  const pennW = 62;
  let i = 0;
  for (let x = 10; x < BASE - 24; x += pennW) {
    const sag = Math.sin((x / BASE) * Math.PI) * 14;
    ctx.fillStyle = colors[i % colors.length]!;
    ctx.beginPath();
    ctx.moveTo(x, 8 + sag);
    ctx.lineTo(x + pennW, 8 + sag);
    ctx.lineTo(x + pennW / 2, 46 + sag);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(x, 7 + sag, pennW, 3);
    i += 1;
  }
};

// One fruit at (x, y), rotated by `angle`, of the given variant.
const paintFruit = (
  ctx: CanvasRenderingContext2D,
  c: MelonChopTheme,
  x: number,
  y: number,
  angle: number,
  variant: number,
) => {
  const body = c.fruitBody[variant % c.fruitBody.length]!;
  const hi = c.fruitHi[variant % c.fruitHi.length]!;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  // Shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.arc(2, 4, FRUIT_R, 0, Math.PI * 2);
  ctx.fill();
  // Rind ring.
  ctx.fillStyle = c.fruitRind;
  ctx.beginPath();
  ctx.arc(0, 0, FRUIT_R, 0, Math.PI * 2);
  ctx.fill();
  // Body.
  const g = ctx.createRadialGradient(-FRUIT_R * 0.35, -FRUIT_R * 0.4, 3, 0, 0, FRUIT_R);
  g.addColorStop(0, hi);
  g.addColorStop(1, body);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, FRUIT_R - 5, 0, Math.PI * 2);
  ctx.fill();
  // Sheen.
  ctx.fillStyle = 'rgba(255,255,255,0.42)';
  ctx.beginPath();
  ctx.arc(-FRUIT_R * 0.34, -FRUIT_R * 0.36, FRUIT_R * 0.2, 0, Math.PI * 2);
  ctx.fill();
  // Leaf.
  ctx.fillStyle = c.leaf;
  ctx.beginPath();
  ctx.ellipse(FRUIT_R * 0.5, -FRUIT_R * 0.75, 12, 6, -0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

// One bomb at (x, y). Bombs never re-skin — a bomb must always read as danger.
const paintBomb = (
  ctx: CanvasRenderingContext2D,
  c: MelonChopTheme,
  x: number,
  y: number,
  angle: number,
  now: number,
) => {
  ctx.save();
  ctx.translate(x, y);
  // Shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.arc(2, 4, FRUIT_R, 0, Math.PI * 2);
  ctx.fill();
  // Body.
  const g = ctx.createRadialGradient(-FRUIT_R * 0.35, -FRUIT_R * 0.4, 3, 0, 0, FRUIT_R);
  g.addColorStop(0, c.bombBodyHi);
  g.addColorStop(1, c.bombBody);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, FRUIT_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, FRUIT_R - 1, 0, Math.PI * 2);
  ctx.stroke();
  // Warning stripe.
  ctx.fillStyle = c.buntingRed;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(-FRUIT_R + 6, -6, FRUIT_R * 2 - 12, 12);
  ctx.globalAlpha = 1;
  // Fuse cap + fuse.
  ctx.rotate(angle * 0.4);
  ctx.strokeStyle = c.bombFuse;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, -FRUIT_R);
  ctx.quadraticCurveTo(18, -FRUIT_R - 22, 6, -FRUIT_R - 40);
  ctx.stroke();
  // Spark.
  const sparkR = 5 + 2.5 * (0.5 + 0.5 * Math.sin(now * 0.03));
  ctx.fillStyle = c.bombSpark;
  ctx.beginPath();
  ctx.arc(6, -FRUIT_R - 42, sparkR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

export default function MelonChopClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [gameState, setGameState] = useState<GameState>('idle');
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(60);
  const [bestCombo, setBestCombo] = useState(0);
  const [highScore, setHighScore] = useState(0);

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
  const [theme, setTheme] = useState<MelonChopTheme>(DEFAULT_MELON_CHOP_THEME);
  const [canvasSize, setCanvasSize] = useState({
    width: BASE,
    height: BASE,
    dpr: 1,
  });
  const [newBest, setNewBest] = useState(false);
  const [diedByBomb, setDiedByBomb] = useState(false);
  const [comboBadge, setComboBadge] = useState(0);

  usePreventGameGestures(gameState === 'playing');
  const touchDevice = useIsTouchDevice();

  // ── Refs (mutable sim state; no re-render) ──
  const gameStateRef = useRef<GameState>('idle');
  const sessionTokenRef = useRef<string | null>(null);
  const seedRef = useRef<number | null>(null);
  const envMonitorRef = useRef(new EnvMonitor());
  const isStartingRef = useRef(false);
  const isGuestRunRef = useRef(false);

  // The authoritative run state — swipes are scored ONLY through scoreSwipe, the
  // same pure primitive the server replays. Never score any other way.
  const scheduleRef = useRef<MelonFruit[]>([]);
  const slicedRef = useRef<Set<number>>(new Set());
  const swipesRef = useRef<MelonSwipe[]>([]);
  const activeSwipeRef = useRef<MelonSwipePoint[] | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const runStartRef = useRef(0); // performance.now() when the run began
  const scoreRef = useRef(0);
  const bestComboRef = useRef(0);

  const frameLoopRef = useRef<GameFrameLoop | null>(null);
  const scaleRef = useRef(1);
  const gameOverTimeRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const adaptiveQualityRef = useRef(createAdaptiveGameQuality());
  const labelsRef = useRef<FloatLabel[]>([]);
  const trailRef = useRef<TrailPoint[]>([]);
  const reducedMotionRef = useRef(false);
  const shakeRef = useRef(0); // decaying screen-shake magnitude
  const flashRef = useRef(0); // decaying combo flash
  const deathRef = useRef(0); // decaying bomb flash
  const hitStopRef = useRef(0); // render-only freeze frames left (big combos)
  const comboBadgeTimerRef = useRef(0); // hides the HUD combo badge
  const lastTickSecRef = useRef(60);
  const saveScoreRef = useRef<
    ((score: number, swipes: MelonSwipe[], durMs: number) => Promise<void>) | null
  >(null);
  const endRunRef = useRef<((died: boolean) => void) | null>(null);
  const drawRef = useRef<((ctx: CanvasRenderingContext2D) => void) | null>(null);
  const bestScoreCacheRef = useRef<number | null>(null);
  const themeRef = useRef<MelonChopTheme>(DEFAULT_MELON_CHOP_THEME);

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
      const response = await fetch('/api/games/melon-chop/score', {
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
      const response = await fetch('/api/store/inventory?gameType=melon-chop', {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = (await response.json()) as InventoryCosmeticResponse;
      setWalletBalances({ credits: payload.wallet?.credits ?? 0 });
      setDailyCreditsProgress({
        earned: payload.dailyGameCredits?.earned ?? 0,
        cap: payload.dailyGameCredits?.cap ?? 300,
      });
      setTheme(buildMelonChopTheme(payload));
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
    swipes: MelonSwipe[],
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
      const response = await fetch('/api/games/melon-chop/score', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: finalScore,
          sessionToken: sessionTokenRef.current,
          swipes,
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
        console.error(`[MelonChop] Score rejected (${response.status}): ${reason}`);
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

  const spawnLabel = useCallback(
    (text: string, tone: CanvasCalloutTone, x: number, y: number) => {
      labelsRef.current.push({
        text: text.toLowerCase(),
        tone,
        x,
        y,
        life: 1,
      });
      if (labelsRef.current.length > 10) labelsRef.current.shift();
    },
    [],
  );

  // Juice burst + two fruit halves at a slice position (render-only).
  const spawnSlice = useCallback(
    (x: number, y: number, variant: number, isBomb: boolean) => {
      if (reducedMotionRef.current) return;
      const c = themeRef.current;
      const dropletColor = isBomb ? c.bombSpark : c.juice;
      const dropletHi = isBomb ? '#ffffff' : c.juiceHi;
      const count = Math.max(
        isBomb ? 8 : 5,
        Math.round(
          (isBomb ? 22 : 12) * adaptiveQualityRef.current.particleScale(),
        ),
      );
      for (let s = 0; s < count; s += 1) {
        const dir = Math.random() * Math.PI * 2;
        const speed = 3 + Math.random() * (isBomb ? 12 : 7);
        particlesRef.current.push({
          x,
          y,
          vx: Math.cos(dir) * speed,
          vy: Math.sin(dir) * speed - 2,
          life: 1,
          size: 4 + Math.random() * 7,
          color: Math.random() < 0.5 ? dropletHi : dropletColor,
        });
      }
      // Impact ring: a quick scale-pop at the slice point.
      particlesRef.current.push({
        x,
        y,
        vx: 0,
        vy: 0,
        life: 1,
        size: FRUIT_R * 1.15,
        color: dropletHi,
        ring: true,
      });
      if (!isBomb) {
        // two halves flying apart
        for (let h = -1; h <= 1; h += 2) {
          particlesRef.current.push({
            x,
            y,
            vx: h * (4 + Math.random() * 3),
            vy: -3 - Math.random() * 3,
            life: 1,
            size: FRUIT_R,
            color: c.fruitBody[variant % c.fruitBody.length]!,
            half: {
              variant,
              hi: c.fruitHi[variant % c.fruitHi.length]!,
              rot: Math.random() * Math.PI,
              spin: h * (0.12 + Math.random() * 0.1),
            },
          });
        }
      }
      if (particlesRef.current.length > 260) {
        particlesRef.current.splice(0, particlesRef.current.length - 260);
      }
    },
    [],
  );

  // ── End the run. `died` distinguishes a fatal bomb (flash + shake) from the
  //    60-second timeout. The authoritative score is the server's replay of the
  //    swipe log; we submit scoreRef, which mirrors scoreSwipe. ──
  const endRun = useCallback(
    (died: boolean) => {
      if (gameStateRef.current !== 'playing') return;
      const durationMs = performance.now() - runStartRef.current;
      gameStateRef.current = 'gameover';
      setGameState('gameover');
      gameOverTimeRef.current = performance.now();
      activeSwipeRef.current = null;
      activePointerRef.current = null;
      if (died) {
        deathRef.current = 1;
        if (!reducedMotionRef.current) shakeRef.current = 1;
        SoundManager.play(SFX.bomb, { volume: 0.9 });
        window.setTimeout(() => SoundManager.play(SFX.over, { volume: 0.8 }), 240);
        playHaptic('failure');
      } else {
        SoundManager.play(SFX.over, { volume: 0.8 });
      }
      setDiedByBomb(died);
      window.clearTimeout(comboBadgeTimerRef.current);
      setComboBadge(0);
      if (scoreRef.current > highScore) {
        setHighScore(scoreRef.current);
        setNewBest(isNewBest(scoreRef.current, highScore));
      }
      saveScoreRef.current?.(scoreRef.current, swipesRef.current.slice(), durationMs);
      paintOnce();
    },
    [highScore, paintOnce],
  );
  endRunRef.current = endRun;

  // ── Convert a pointer event to normalized play-space coords. ──
  const toPlaySpace = useCallback((e: React.PointerEvent): MelonSwipePoint => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * BASE;
    const ny = ((e.clientY - rect.top) / rect.height) * BASE;
    const t = Math.max(0, Math.round(performance.now() - runStartRef.current));
    return { x: nx, y: ny, t };
  }, []);

  // ── Finalize the active swipe: score it through the SAME pure primitive the
  //    server replays, so the on-screen outcome always matches the authoritative
  //    one. Handles fruit juice, combos and the fatal bomb. ──
  const finishSwipe = useCallback(() => {
    const pts = activeSwipeRef.current;
    activeSwipeRef.current = null;
    activePointerRef.current = null;
    if (gameStateRef.current !== 'playing') return;
    const seed = seedRef.current;
    if (seed === null || !pts || pts.length < 2) return;
    if (swipesRef.current.length >= MELON_MAX_SWIPES - 1) return;

    const swipe: MelonSwipe = { points: pts };
    swipesRef.current.push(swipe);

    const windowMs = MELON_RUN_MS + MELON_GRACE_MS;
    const res = scoreSwipe(scheduleRef.current, swipe, slicedRef.current, windowMs);

    // Convert normalized event coords to logical canvas coords (BASE==play size).
    for (const ev of res.events) {
      const fruit = scheduleRef.current[ev.id];
      const variant = fruit ? fruit.variant : 0;
      spawnSlice(ev.x, ev.y, variant, ev.isBomb);
    }

    if (res.bomb) {
      const b = res.events.find((e) => e.isBomb);
      if (b) spawnLabel('BOOM', 'warning', b.x, b.y - 30);
      endRunRef.current?.(true);
      return;
    }

    if (res.comboCount > 0) {
      scoreRef.current += res.points;
      setScore(scoreRef.current);
      // Slice thock climbs a touch with the combo tier (restrained ladder).
      SoundManager.play(SFX.slice, {
        volume: 0.75,
        pitch: 1 + Math.min(res.comboCount - 1, 5) * 0.05,
      });
      playHaptic(res.comboCount >= 3 ? 'success' : res.comboCount >= 2 ? 'medium' : 'light');
      const last = res.events[res.events.length - 1]!;
      if (res.comboCount >= 2) {
        SoundManager.play(SFX.combo, { volume: 0.85 });
        if (res.comboCount > bestComboRef.current) {
          bestComboRef.current = res.comboCount;
          setBestCombo(res.comboCount);
        }
        // HUD combo badge — cosmetic echo of the swipe's combo, self-hides.
        setComboBadge(res.comboCount);
        window.clearTimeout(comboBadgeTimerRef.current);
        comboBadgeTimerRef.current = window.setTimeout(() => setComboBadge(0), 1200);
        spawnLabel(
          `${res.comboCount}× COMBO +${res.points}`,
          'combo',
          BASE / 2,
          BASE * 0.34,
        );
        if (res.comboCount >= 3) {
          flashRef.current = 1; // combo flash (slow-mo cue; sim time unaffected)
          if (!reducedMotionRef.current) {
            shakeRef.current = Math.min(1, 0.5 + res.comboCount * 0.1);
            // Fake hit-stop: freeze juice decay for ~4 frames. Sim time and
            // fruit positions (pure functions of elapsed) are untouched.
            hitStopRef.current = 4;
          }
        }
      } else {
        spawnLabel(`+${res.points}`, 'score', last.x, last.y - 24);
      }
    }
  }, [spawnLabel, spawnSlice]);

  // ── Render ──
  const draw = useCallback((ctx: CanvasRenderingContext2D) => {
    const c = themeRef.current;
    const now = performance.now();
    const state = gameStateRef.current;
    const elapsed = state === 'playing' ? now - runStartRef.current : MELON_RUN_MS;

    // Fake hit-stop: freeze juice decay for a few frames on big combos. Fruit
    // positions below are pure functions of elapsed, so they keep moving.
    const frozen = hitStopRef.current > 0;
    if (frozen) hitStopRef.current -= 1;

    // Screen shake.
    let shakeX = 0;
    let shakeY = 0;
    if (shakeRef.current > 0 && !reducedMotionRef.current) {
      const m = shakeRef.current * 14;
      shakeX = (Math.random() - 0.5) * m;
      shakeY = (Math.random() - 0.5) * m;
    }
    ctx.save();
    ctx.translate(shakeX, shakeY);

    paintBooth(ctx, c);

    // Fruit + bombs at their simulated positions (pure functions of elapsed).
    if (state === 'playing' || state === 'gameover') {
      const schedule = scheduleRef.current;
      const sliced = slicedRef.current;
      for (let i = 0; i < schedule.length; i += 1) {
        const f = schedule[i]!;
        if (sliced.has(f.index)) continue;
        const pos = melonFruitPosAtMs(f, elapsed);
        if (!pos) continue;
        const dt = elapsed / MELON_TICK_MS - f.spawnTick;
        const angle = f.spin * dt;
        if (f.isBomb) paintBomb(ctx, c, pos.x, pos.y, angle, now);
        else paintFruit(ctx, c, pos.x, pos.y, angle, f.variant);
      }
    }

    // Particles (juice droplets + fruit halves).
    const parts = particlesRef.current;
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const p = parts[i]!;
      if (!frozen) {
        p.life -= p.ring ? 0.09 : p.half ? 0.02 : 0.04;
        if (!p.ring) {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.55;
        }
      }
      if (p.life <= 0) {
        parts.splice(i, 1);
        continue;
      }
      if (p.ring) {
        // Impact ring: expands + thins as it fades.
        const t = 1 - p.life;
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life) * 0.8;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.5 + p.life * 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.4 + t * 1.5), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (p.half) {
        p.half.rot += p.half.spin;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
        ctx.translate(p.x, p.y);
        ctx.rotate(p.half.rot);
        // a half-disc
        const grd = ctx.createLinearGradient(0, -FRUIT_R, 0, FRUIT_R);
        grd.addColorStop(0, p.half.hi);
        grd.addColorStop(1, p.color);
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(0, 0, FRUIT_R - 4, -Math.PI / 2, Math.PI / 2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(-2, -(FRUIT_R - 4), 4, (FRUIT_R - 4) * 2);
        ctx.restore();
      } else {
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * Math.max(0.3, p.life), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // Blade trail (fading polyline through the recent gesture points).
    const trail = trailRef.current;
    if (!frozen) {
      for (let i = trail.length - 1; i >= 0; i -= 1) {
        trail[i]!.life -= 0.08;
        if (trail[i]!.life <= 0) trail.splice(i, 1);
      }
    }
    if (trail.length >= 2) {
      const glow = c.bladeGlowEnabled && !reducedMotionRef.current;
      ctx.save();
      if (glow) {
        ctx.shadowColor = c.bladeGlowColor;
        ctx.shadowBlur = 18;
      }
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 1; i < trail.length; i += 1) {
        const a = trail[i - 1]!;
        const b = trail[i]!;
        const life = (a.life + b.life) / 2;
        ctx.strokeStyle = c.trail;
        ctx.globalAlpha = Math.max(0, life) * 0.55;
        ctx.lineWidth = 2 + life * 16;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.strokeStyle = c.trailCore;
        ctx.globalAlpha = Math.max(0, life) * 0.9;
        ctx.lineWidth = 1 + life * 5;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // Combo flash (the triple+ "slow-mo" cue — a white vignette pulse; the sim
    // clock is untouched, so determinism holds).
    if (flashRef.current > 0) {
      flashRef.current = Math.max(0, flashRef.current - 0.05);
      if (!reducedMotionRef.current) {
        ctx.save();
        ctx.globalAlpha = flashRef.current * 0.28;
        ctx.fillStyle = c.juiceHi;
        ctx.fillRect(0, 0, BASE, BASE);
        ctx.restore();
      }
    }

    // Bomb death flash.
    if (state === 'gameover' && deathRef.current > 0) {
      deathRef.current = Math.max(0, deathRef.current - 0.03);
      ctx.save();
      ctx.globalAlpha = deathRef.current * 0.5;
      ctx.fillStyle = c.buntingRed;
      ctx.fillRect(0, 0, BASE, BASE);
      ctx.restore();
    }

    // Floating verdict plates.
    const labels = labelsRef.current;
    const calloutLook = readCanvasCalloutLook(ctx.canvas);
    for (let i = labels.length - 1; i >= 0; i -= 1) {
      const lb = labels[i]!;
      if (!frozen) lb.life -= 0.02;
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
        within: { left: 0, top: 0, right: BASE, bottom: BASE },
      });
    }

    ctx.restore(); // shake transform

    if (shakeRef.current > 0) shakeRef.current = Math.max(0, shakeRef.current - 0.06);
  }, []);
  drawRef.current = draw;

  const renderFrame = useCallback(
    (currentTime: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas ? getGame2dContext(canvas, { alpha: false }) : null;
      if (!canvas || !ctx) return;

      if (gameStateRef.current === 'playing') {
        const elapsed = currentTime - runStartRef.current;
        const remaining = Math.max(0, Math.ceil((MELON_RUN_MS - elapsed) / 1000));
        if (remaining !== lastTickSecRef.current) {
          lastTickSecRef.current = remaining;
          setTimeLeft(remaining);
          if (remaining <= 5 && remaining > 0) SoundManager.play(SFX.tick, { volume: 0.6 });
        }
        if (elapsed >= MELON_RUN_MS) {
          // finalize any in-progress swipe, then end on the timer.
          if (activeSwipeRef.current) finishSwipe();
          endRunRef.current?.(false);
        }
      }

      ctx.save();
      ctx.scale(scaleRef.current, scaleRef.current);
      draw(ctx);
      ctx.restore();

    },
    [draw, finishSwipe],
  );

  const shouldAnimate = useCallback(
    () =>
      gameStateRef.current === 'playing' ||
      (gameStateRef.current === 'gameover' &&
        (particlesRef.current.length > 0 ||
          labelsRef.current.length > 0 ||
          trailRef.current.length > 0 ||
          deathRef.current > 0.01 ||
          shakeRef.current > 0.01)),
    [],
  );

  useEffect(() => {
    const loop = createGameFrameLoop({
      simulate: () => shouldAnimate(),
      render: (_alpha, frame) => renderFrame(frame.nowMs),
      onFrame: (frame) =>
        adaptiveQualityRef.current.sample(frame.deltaMs, frame.nowMs),
    });
    frameLoopRef.current = loop;
    return () => {
      loop.destroy();
      if (frameLoopRef.current === loop) frameLoopRef.current = null;
    };
  }, [renderFrame, shouldAnimate]);

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
        body: JSON.stringify({ gameType: 'melon-chop' }),
      });
      if (sessionResponse.ok) {
        setBanIndefinite(false);
        setBanUntilMs(null);
        const sessionData = await sessionResponse.json();
        sessionTokenRef.current = sessionData.token;
        seedRef.current =
          typeof sessionData.melonChopSeed === 'number'
            ? sessionData.melonChopSeed
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
    frameLoopRef.current?.stop();
    scheduleRef.current = deriveMelonSchedule(seed);
    slicedRef.current = new Set();
    swipesRef.current = [];
    activeSwipeRef.current = null;
    activePointerRef.current = null;
    scoreRef.current = 0;
    bestComboRef.current = 0;
    setScore(0);
    setBestCombo(0);
    setNewBest(false);
    setDiedByBomb(false);
    window.clearTimeout(comboBadgeTimerRef.current);
    setComboBadge(0);
    setTimeLeft(60);
    lastTickSecRef.current = 60;
    particlesRef.current = [];
    labelsRef.current = [];
    trailRef.current = [];
    shakeRef.current = 0;
    flashRef.current = 0;
    deathRef.current = 0;
    hitStopRef.current = 0;
    runStartRef.current = performance.now();
    gameStateRef.current = 'playing';
    setGameState('playing');
    SoundManager.play(SFX.start, { volume: 0.8 });

    frameLoopRef.current?.start();
  }, [resetRunResult]);

  // ── Primary action: start / restart the run (keyboard + keycap click) ──
  const primaryAction = useCallback(() => {
    SoundManager.unlock();
    const current = gameStateRef.current;
    if (current === 'idle' || current === 'error') {
      startGame();
    } else if (current === 'gameover') {
      const since = performance.now() - gameOverTimeRef.current;
      if (since >= RESTART_GRACE_PERIOD) startGame();
    }
  }, [startGame]);

  // ── Keyboard: Space / Enter starts or restarts the run. During play the
  //    canvas is swipe-only; the key press just stays off the page scroll. ──
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.code !== 'Enter') return;
      if (e.repeat) return;
      if (blocksGameKeyboard(e.target)) return;
      e.preventDefault();
      if (gameStateRef.current === 'playing') return;
      primaryAction();
    },
    [primaryAction],
  );

  // ── Pointer / swipe handlers ──
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      SoundManager.unlock();
      const current = gameStateRef.current;
      if (current === 'playing') {
        // Single active swipe at a time — ignore extra pointers so the recorded
        // swipe order is strictly sequential (guarantees client/server parity).
        if (activePointerRef.current !== null) return;
        activePointerRef.current = e.pointerId;
        const p = toPlaySpace(e);
        activeSwipeRef.current = [p];
        trailRef.current.push({ x: p.x, y: p.y, life: 1 });
        playHaptic('tap');
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          /* capture is best-effort */
        }
      } else if (current === 'idle' || current === 'error') {
        startGame();
      } else if (current === 'gameover') {
        const since = performance.now() - gameOverTimeRef.current;
        if (since >= RESTART_GRACE_PERIOD) startGame();
      }
    },
    [startGame, toPlaySpace],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (gameStateRef.current !== 'playing') return;
      if (activePointerRef.current !== e.pointerId) return;
      const active = activeSwipeRef.current;
      if (!active) return;
      e.preventDefault();
      const p = toPlaySpace(e);
      // Cap points per swipe exactly as the server sanitizer does (first N),
      // so the arrays the two sides score are identical.
      if (active.length < MELON_MAX_SWIPE_POINTS) {
        // Only record if it advanced in time (strictly increasing t) + moved.
        const prev = active[active.length - 1]!;
        if (p.t > prev.t) {
          active.push(p);
          trailRef.current.push({ x: p.x, y: p.y, life: 1 });
          if (trailRef.current.length > 48) trailRef.current.shift();
        }
      }
    },
    [toPlaySpace],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (activePointerRef.current !== e.pointerId) return;
      finishSwipe();
    },
    [finishSwipe],
  );

  // ── Effects ──
  useEffect(() => {
    const monitor = envMonitorRef.current;
    return () => {
      window.clearTimeout(comboBadgeTimerRef.current);
      monitor.stop();
    };
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

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
      const reservedVertical = window.innerHeight < 700 ? 240 : 300;
      const maxWidth = Math.min(window.innerWidth - 24, 620);
      const maxHeight = Math.min(window.innerHeight - reservedVertical, 620);
      const side = Math.max(240, Math.min(maxWidth, maxHeight));
      const dpr = gameCanvasDpr(side, side);
      scaleRef.current = (side / BASE) * dpr;
      setCanvasSize({
        width: Math.floor(side),
        height: Math.floor(side),
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
    <div className="melon-chop-midway arc-game-flow">
      <div className="w-full space-y-3 sm:space-y-4">
        <div className="mx-auto w-full max-w-5xl">
          <div className="hidden sm:block">
            <PageHeader
              eyebrow="Arcade"
              icon={<Cherry aria-hidden className="h-6 w-6" />}
              title="Melon Chop"
              subtitle="Swipe to slice the fruit as it flies — chain several in one stroke for a combo. Slice a bomb and the run is over. 60 seconds, one blade."
              wallet={walletCard}
            />
          </div>
          <div className="sm:hidden">
            <GamesWalletCard wallet={walletCard} compact />
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3 px-1">
          <span className="arcade-num relative text-sm text-body sm:text-base">
            Score{' '}
            <span
              key={score}
              className={`font-semibold text-strong${isPlaying && score > 0 ? ' melon-score-pop' : ''}`}
            >
              {score}
            </span>
            {comboBadge >= 2 && (
              <span key={comboBadge} className="melon-combo-badge" aria-hidden>
                {comboBadge}× combo
              </span>
            )}
          </span>
          <span className="arcade-num text-sm text-body sm:text-base">
            Time <span className="font-semibold text-strong">{timeLeft}s</span>
            {bestCombo >= 2 && (
              <span className="text-faint"> · {bestCombo}× best</span>
            )}
          </span>
          <span className="arcade-num text-sm text-body sm:text-base">
            Best <span className="font-semibold text-strong">{highScore}</span>
          </span>
        </div>

        <div ref={containerRef} className="relative touch-none flex justify-center">
          <div
            className="melon-stage relative"
            style={{ width: canvasSize.width, height: canvasSize.height }}
          >
            <canvas
              ref={canvasRef}
              width={Math.floor(canvasSize.width * canvasSize.dpr)}
              height={Math.floor(canvasSize.height * canvasSize.dpr)}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onPointerLeave={handlePointerUp}
              className="block cursor-crosshair rounded-well border-2 border-ink"
              style={{
                touchAction: 'none',
                width: canvasSize.width,
                height: canvasSize.height,
              }}
            />

            {!isPlaying && (
              <div
                className="melon-overlay absolute inset-0 flex touch-none flex-col items-center justify-center rounded-well px-4"
                style={{
                  background:
                    'color-mix(in srgb, var(--scrim) 78%, transparent)',
                }}
                onPointerDown={handlePointerDown}
              >
                {gameState === 'idle' && (
                  <>
                    <Cherry size={56} className="mb-4 text-tickets-text" />
                    <h1 className="arcade-display mb-2 text-center text-2xl text-strong uppercase sm:text-3xl">
                      Melon Chop
                    </h1>
                    <p className="mb-2 text-center text-sm text-strong sm:text-base">
                      {isStartingSession
                        ? 'Starting your run…'
                        : touchDevice
                          ? 'Tap to start, then swipe to slice'
                          : 'Click to start, then drag to slice'}
                    </p>
                    <p className="max-w-xs text-center text-xs text-body sm:text-sm">
                      Swipe through the flying fruit to slice it. Chain several in
                      one stroke for a combo multiplier. Avoid the bombs — one
                      cut ends the run.
                    </p>
                  </>
                )}

                {gameState === 'gameover' && (
                  <div onPointerDown={(event) => event.stopPropagation()} className="flex max-h-full w-full justify-center">
                    <ArcadeRunResult
                      title={newBest ? 'new best' : diedByBomb ? 'bomb sliced' : 'time is up'}
                      tone={newBest ? 'best' : 'neutral'}
                      stats={[
                        { label: 'score', value: score, highlight: newBest },
                        { label: 'best', value: Math.max(highScore, score) },
                        ...(bestCombo >= 2 ? [{ label: 'combo', value: `${bestCombo}×` }] : []),
                      ]}
                      reward={runResult.reward}
                      achievements={runResult.achievements}
                      saving={isSubmitting}
                      error={submitError}
                      guest={runRewardMessage?.startsWith('Guest run')}
                      actions={<ArcadeRematchButton onClick={() => startGame()}>play again</ArcadeRematchButton>}
                    />
                  </div>
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
                      Tap or click to retry
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* The start keycap. On touch it starts the run (then the canvas takes
            swipes); during play the canvas itself is the control. */}
        {!isPlaying && (
          <div className="mt-3 flex w-full justify-center">
            <button
              type="button"
              className="melon-start"
              aria-label="Start"
              onPointerDown={handlePointerDown}
              onClick={primaryAction}
            >
              <Cherry aria-hidden size={20} />
              Tap
            </button>
          </div>
        )}

        <p className="mt-3 text-center text-xs text-faint sm:text-sm">
          {touchDevice
            ? 'Swipe across the fruit to slice — chain them for combos'
            : 'Click and drag across the fruit to slice — chain them for combos'}
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
        title="Melon Chop board"
        description="Highest run score, and your rank."
      >
        <GameLeaderboard
          gameType="melon-chop"
          maxEntries={5}
          enableFullLeaderboardModal
          fullLeaderboardDisplay="inline"
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>
    </div>
  );
}
