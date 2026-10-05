'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
import { GameInventoryModal } from '@/features/arcade/components/game-inventory-modal';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { GameInventoryButton } from '@/features/arcade/components/game-inventory-button';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import {
  GameShell,
  GameStage,
  GameStageNotice,
  GameStat,
  type GameHint,
  type GameHowTo,
  type GamePhase,
  type GameStageSize,
} from '@/features/arcade/components/shell/game-shell';
import { ArcadeGameplayCallouts } from '@/features/arcade/components/gameplay/arcade-game-hud';
import {
  ArcadeRematchButton,
  ArcadeRunResult,
} from '@/features/arcade/components/results/arcade-run-result';
import { EnvMonitor } from '@/features/arcade/lib/game-anti-cheat';
import { connectGameWs, type GameWsHandle } from '@/features/arcade/lib/game-ws';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { playHaptic } from '@/features/arcade/lib/game-haptics';
import { useArcadeRunResult } from '@/features/arcade/lib/run-result';
import {
  useFeelReducedMotion,
  useGameFeedback,
  usePitchLadder,
} from '@/features/arcade/lib/use-game-feedback';
import { squashAt } from '@/features/arcade/lib/game-feel';
import {
  isControlTarget,
  isDialogOpen,
  type GameInput,
} from '@/features/arcade/lib/use-first-input';
import { useGameplayCallouts, useNewBestMoment } from '@/features/arcade/lib/use-gameplay-callouts';
import {
  drawCanvasCallout,
  readCanvasCalloutLook,
} from '@/features/arcade/components/gameplay/callout-canvas';
import {
  createGameFrameLoop,
  gameCanvasDpr,
  type GameFrameLoop,
} from '@/features/arcade/lib/game-frame-loop';
import type { AccountXpReward } from '@/server/arcade/rewards/types';

import type {
  Position,
  Direction,
  SnakeCosmeticTheme,
  InventoryCosmeticResponse,
  SnakeScoreSubmitResponse,
} from './_snake-types';
import {
  DEFAULT_SNAKE_THEME,
  buildSnakeTheme,
  resolveMidwaySnakeTheme,
} from './_snake-theme';
import { SnakeFx } from './_snake-effects';
import { drawSkinBody, drawSkinFood } from './_snake-skin-draw';
import {
  ensureSnakeBoardLayer,
  type SnakeBoardImageLoadState,
  type SnakeBoardThemeSnapshot,
} from './_snake-board-layer';
import {
  GRID_SIZE,
  CELL_SIZE,
  BASE_WIDTH,
  BASE_HEIGHT,
  INITIAL_TICK_RATE,
  WINNING_SNAKE_LENGTH,
  FOOD_SCORE,
  isNewBest,
  SPEED_RAMP_APPLES,
  tickRateForApples,
  getSubmitErrorMessage,
  GUEST_RUN_MESSAGE,
  createSnakeRng,
  pushDirection,
  generateFoodPosition,
  DIRECTION_VECTORS,
  OPPOSITE_DIRECTIONS,
  SNAKE_DIRECTION_LETTER,
} from './_snake-helpers';

// The ? sheet's picture, in the tixy palette: an ink board, an amber snake
// (you) and a paper apple.
function HowToPicture() {
  const grid = [];
  for (let i = 1; i < 8; i += 1) {
    grid.push(<line key={`v${i}`} x1={i * 20} y1='0' x2={i * 20} y2='100' stroke='#F4EBDC' strokeOpacity='0.08' />);
  }
  for (let i = 1; i < 5; i += 1) {
    grid.push(<line key={`h${i}`} x1='0' y1={i * 20} x2='160' y2={i * 20} stroke='#F4EBDC' strokeOpacity='0.08' />);
  }
  return (
    <svg viewBox='0 0 160 100' width={320} height={200} role='img' aria-label='A snake on a grid, turning toward an apple.'>
      <rect width='160' height='100' fill='#2A231D' />
      {grid}
      <path
        d='M 22 70 L 62 70 L 62 30 L 102 30 L 102 50'
        fill='none'
        stroke='#F2A33C'
        strokeWidth='11'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <circle cx='102' cy='54' r='7.5' fill='#F2A33C' />
      <circle cx='99' cy='52' r='2.3' fill='#F4EBDC' />
      <circle cx='105' cy='52' r='2.3' fill='#F4EBDC' />
      <circle cx='99' cy='52.6' r='1' fill='#1F1A16' />
      <circle cx='105' cy='52.6' r='1' fill='#1F1A16' />
      <circle cx='128' cy='72' r='9' fill='#F4EBDC' />
      <path d='M 128 63 L 130 57' stroke='#B8A98F' strokeWidth='2' strokeLinecap='round' />
      <ellipse cx='134' cy='58' rx='5' ry='2.4' fill='#7FB069' transform='rotate(-20 134 58)' />
    </svg>
  );
}

// The shell's first-frame hint and ? sheet (docs/design/tixy-rebrand/SHELL.md).
const HINT: GameHint = {
  touch: 'Swipe to move.',
  pointer: 'Press an arrow key to move.',
};
const HOW_TO: GameHowTo = {
  lines: [
    'Swipe or press an arrow key to steer, and eat the apples.',
    `A wall or your own tail ends the run, and the snake speeds up every ${SPEED_RAMP_APPLES} apples.`,
    'A score of 50 pays 27 tickets, and 100 pays 47.',
  ],
  picture: <HowToPicture />,
};

// Keys that start a run. A move key also makes the first move.
const CODE_DIRECTIONS: Record<string, Direction> = {
  ArrowUp: 'UP',
  KeyW: 'UP',
  ArrowDown: 'DOWN',
  KeyS: 'DOWN',
  ArrowLeft: 'LEFT',
  KeyA: 'LEFT',
  ArrowRight: 'RIGHT',
  KeyD: 'RIGHT',
};
const KEY_DIRECTIONS: Record<string, Direction> = {
  arrowup: 'UP',
  w: 'UP',
  arrowdown: 'DOWN',
  s: 'DOWN',
  arrowleft: 'LEFT',
  a: 'LEFT',
  arrowright: 'RIGHT',
  d: 'RIGHT',
};
const START_KEYS = ['Space', 'Enter', ...Object.keys(CODE_DIRECTIONS)] as const;
const directionFromKey = (key: string): Direction | null => KEY_DIRECTIONS[key] ?? null;
const directionFromInput = (input: GameInput): Direction | undefined =>
  input.kind === 'key' ? CODE_DIRECTIONS[input.code] : undefined;

// A run that just ended ignores the restart keys for this long.
const RESTART_GRACE_MS = 500;

// Swipes shorter than this (CSS px) are taps.
const SWIPE_MIN_PX = 20;

// The direction a swipe points, or null for a tap.
const swipeDirection = (dx: number, dy: number): Direction | null => {
  if (Math.abs(dx) < SWIPE_MIN_PX && Math.abs(dy) < SWIPE_MIN_PX) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'RIGHT' : 'LEFT';
  return dy > 0 ? 'DOWN' : 'UP';
};

// ---------------------------------------------------------------------------
// Color utilities for gradient body modes — module scope so the per-frame
// draw path never re-creates these closures.
// ---------------------------------------------------------------------------
const hexToRgb = (hex: string) => {
  const h = hex.replace('#', '');
  const e =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  const v = Number.parseInt(e, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255] as const;
};
const rgbToHex = (r: number, g: number, b: number) =>
  `#${[r, g, b]
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
const lerpHex = (a: string, b: string, t: number) => {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(
    ar + (br - ar) * t,
    ag + (bg - ag) * t,
    ab + (bb - ab) * t,
  );
};

// Scratch buffer for per-pearl cumulative distances — reused every frame so
// the draw path does not allocate a new array per frame.
const pearlDistsScratch: number[] = [];

export default function SnakePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The element the kit shakes on a collision. Canvas and HUD sit inside it.
  const stageRef = useRef<HTMLDivElement>(null);
  const [gameState, setGameState] = useState<
    'idle' | 'playing' | 'gameover' | 'won' | 'error'
  >('idle');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showInventory, setShowInventory] = useState(false);
  // Seed with the static Midway default for SSR; an effect re-resolves the
  // live tokens on mount before inventory loads so the idle render is on-theme.
  const [snakeTheme, setSnakeTheme] =
    useState<SnakeCosmeticTheme>(DEFAULT_SNAKE_THEME);
  // A skin set's sound tint colours this game's cues while it is open.
  const skinSound = snakeTheme.skin?.sound ?? 'house';
  useEffect(() => {
    SoundManager.setTint(skinSound);
    return () => SoundManager.setTint('house');
  }, [skinSound]);
  const [walletBalances, setWalletBalances] = useState({
    credits: 0,
  });
  // The daily cap still comes back with each save; the shell doesn't show it.
  const [, setDailyCreditsProgress] = useState({ earned: 0, cap: 300 });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [runRewardMessage, setRunRewardMessage] = useState<string | null>(null);
  const [, setRunRewardIsCapHit] = useState(false);
  const [, setRunAccountXp] = useState<AccountXpReward | null>(null);
  const { result: runResult, capture: captureRunResult, reset: resetRunResult } = useArcadeRunResult();
  const [hasLoadedSnakeTheme, setHasLoadedSnakeTheme] = useState(false);
  const [pendingThemeRefresh, setPendingThemeRefresh] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [banUntilMs, setBanUntilMs] = useState<number | null>(null);
  const [banIndefinite, setBanIndefinite] = useState(false);
  const [banNowMs, setBanNowMs] = useState(Date.now());
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);
  const {
    items: gameplayCallouts,
    push: pushGameplayCallout,
    clear: clearGameplayCallouts,
  } = useGameplayCallouts();
  // The new-best moment, once a run: when the score first passes the best
  // the run started with.
  const { check: checkNewBest, reset: resetNewBest } = useNewBestMoment(pushGameplayCallout, {
    y: 22,
    unit: 'points',
  });
  const isPausedRef = useRef(false);
  const isGuestRunRef = useRef(false);
  const bestScoreCacheRef = useRef<number | null>(null);
  const [canvasSize, setCanvasSize] = useState({
    width: BASE_WIDTH,
    height: BASE_HEIGHT,
  });
  // Reduced motion follows the OS, through the feel kit.
  const reducedMotion = useFeelReducedMotion();
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  // Sound, haptics and the death shake. Press first on every input; a tick on
  // each apple; the pitch ladder climbs per apple and resets when the run
  // breaks.
  const { trigger } = useGameFeedback({ stage: stageRef });
  const triggerRef = useRef(trigger);
  triggerRef.current = trigger;
  const appleLadder = usePitchLadder();

  // Game state refs (mutable, not triggering re-renders)
  const gameStateRef = useRef<'idle' | 'playing' | 'gameover' | 'won' | 'error'>(
    'idle',
  );
  const sessionTokenRef = useRef<string | null>(null);
  const envMonitorRef = useRef(new EnvMonitor());

  // Snake state with sub-grid positioning for smooth movement
  const snakeRef = useRef<
    Array<{
      x: number;
      y: number;
      dx: number;
      dy: number;
      tx: number;
      ty: number;
    }>
  >([
    { x: 4, y: 9, dx: 1, dy: 0, tx: 4, ty: 9 },
    { x: 3, y: 9, dx: 1, dy: 0, tx: 3, ty: 9 },
    { x: 2, y: 9, dx: 1, dy: 0, tx: 2, ty: 9 },
  ]);
  const prevSnakeRef = useRef<
    Array<{
      x: number;
      y: number;
      dx: number;
      dy: number;
      tx: number;
      ty: number;
    }>
  >([]);
  const bulgeRef = useRef<{ startTick: number } | null>(null);
  const tickCountRef = useRef(0);
  // persistent list of body "pearl" positions.
  // New pearls are added when the head moves far enough from the last pearl.
  // Tail pearls are removed to maintain the correct body length.
  const bodyPearlsRef = useRef<Array<{ x: number; y: number }>>([]);

  const directionRef = useRef<Direction>('RIGHT');
  const directionQueueRef = useRef<Direction[]>([]);
  // Every turn the queue took, with the tick count it was queued on. The score
  // route replays these from the session's seed to score the run.
  const turnLogRef = useRef<Array<[number, string]>>([]);
  const foodRef = useRef<Position>({ x: 14, y: 9 });
  const scoreRef = useRef(0);
  const bestAtRunStartRef = useRef(0);
  const tickRateRef = useRef(INITIAL_TICK_RATE);
  const gameStartTimeRef = useRef(0);

  // Timing refs for smooth animation
  const lastTickTimeRef = useRef<number>(0);
  const frameLoopRef = useRef<GameFrameLoop | null>(null);
  const lastFrameTimeRef = useRef<number>(0);

  const isStartingRef = useRef(false);
  const interpolationRef = useRef<number>(0);
  const drawGameRef = useRef<(interpolation: number) => void>(() => {});
  const fxRef = useRef(new SnakeFx());

  const saveScoreRef = useRef<((score: number) => Promise<void>) | null>(null);
  const wsRef = useRef<GameWsHandle | null>(null);
  const snakeSeedRef = useRef<number | null>(null);
  const nextRandomRef = useRef<() => number>(() => Math.random());
  const boardLayerRef = useRef<HTMLCanvasElement | null>(null);
  const boardImageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const boardImageLoadStateRef = useRef<Map<string, SnakeBoardImageLoadState>>(
    new Map(),
  );
  const boardLayerThemeRef = useRef<SnakeBoardThemeSnapshot | null>(null);
  const documentHiddenRef = useRef(false);
  const lastHiddenDrawTimeRef = useRef(0);

  // Touch handling refs
  const touchStartRef = useRef<Position | null>(null);
  // The turn that started the run (an arrow key or a swipe): applied as soon
  // as the session is ready, so the first input is also the first move.
  const firstDirectionRef = useRef<Direction | null>(null);
  // performance.now() of the last apple, for the head squash.
  const eatenAtRef = useRef(-Infinity);
  // When the run ended, for the restart grace period.
  const endedAtRef = useRef(0);
  // The stored best's request, so a run that starts before it lands waits for
  // it (briefly) and doesn't take 0 as the score to beat.
  const bestLoadRef = useRef<Promise<void> | null>(null);
  const fetchUserBestScore = useCallback(async () => {
    if (bestScoreCacheRef.current !== null) {
      const cached = bestScoreCacheRef.current;
      setHighScore((prev) => Math.max(prev, cached));
      return;
    }
    const load = (async () => {
      try {
        const response = await fetch('/api/games/snake/score', {
          cache: 'no-store',
        });
        if (response.ok) {
          const data = await response.json();
          if (typeof data.bestScore === 'number') {
            setHighScore((prev) => Math.max(prev, data.bestScore));
            bestScoreCacheRef.current = data.bestScore;
          }
        }
      } catch (error) {
        console.error('Failed to fetch user best score:', error);
      }
    })();
    bestLoadRef.current = load;
    await load;
  }, []);

  const loadSnakeTheme = useCallback(async () => {
    try {
      const response = await fetch('/api/store/inventory?gameType=snake', {
        cache: 'no-store',
      });
      if (!response.ok) {
        setSnakeTheme(resolveMidwaySnakeTheme());
        return;
      }
      const payload = (await response.json()) as InventoryCosmeticResponse;
      setWalletBalances({
        credits: payload.wallet?.credits ?? 0,
      });
      setDailyCreditsProgress({
        earned: payload.dailyGameCredits?.earned ?? 0,
        cap: payload.dailyGameCredits?.cap ?? 300,
      });
      setSnakeTheme(buildSnakeTheme(payload));
      setHasLoadedSnakeTheme(true);
      setPendingThemeRefresh(false);
    } catch {
      setWalletBalances({ credits: 0 });
      setDailyCreditsProgress({ earned: 0, cap: 300 });
      setSnakeTheme(resolveMidwaySnakeTheme());
      setHasLoadedSnakeTheme(true);
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

  const saveScore = async (finalScore: number) => {
    if (isGuestRunRef.current) {
      setRunRewardMessage(GUEST_RUN_MESSAGE);
      setRunRewardIsCapHit(false);
      setRunAccountXp(null);
      return;
    }
    if (finalScore <= 0 || !sessionTokenRef.current) return;

    envMonitorRef.current.stop();
    setSubmitError(null);
    setRunRewardMessage(null);
    setRunAccountXp(null);
    setRunRewardIsCapHit(false);
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/games/snake/score', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: finalScore,
          sessionToken: sessionTokenRef.current,
          inputs: turnLogRef.current,
          clientDurationMs: Math.max(
            0,
            performance.now() - gameStartTimeRef.current,
          ),
          env: envMonitorRef.current.getFingerprint(),
        }),
      });

      const rawBody = await response.text();
      let data: SnakeScoreSubmitResponse | null = null;
      if (rawBody.trim().length > 0) {
        try {
          data = JSON.parse(rawBody) as SnakeScoreSubmitResponse;
        } catch {
          data = null;
        }
      }
      if (!response.ok) {
        const retryAfterHeader = response.headers.get('retry-after');
        const retryAfterSecFromHeader = retryAfterHeader
          ? Number.parseInt(retryAfterHeader, 10)
          : NaN;
        const normalizedData =
          data ??
          (response.status === 429
            ? {
                error: 'Too many runs.',
                retryAfterSec: Number.isFinite(retryAfterSecFromHeader)
                  ? retryAfterSecFromHeader
                  : undefined,
              }
            : null);
        if (response.status === 429) {
          console.info('Snake score submission rate-limited:', {
            status: response.status,
            body: rawBody || null,
            data: normalizedData,
          });
        } else {
          console.error('Snake score submission failed:', {
            status: response.status,
            statusText: response.statusText,
            body: rawBody || null,
            data: normalizedData,
          });
        }
        setSubmitError(getSubmitErrorMessage(response.status, normalizedData));
        return;
      }

      captureRunResult(data);
      const reward = data?.reward;
      if (reward) {
        setRunAccountXp(reward.account ?? null);
        const awardedCredits = Number(reward?.awardedCredits ?? 0);
        const wantedCredits = Number(reward?.wantedCredits ?? 0);
        const capRemaining = Number(reward?.capRemaining ?? 0);
        const balanceAfter = Number(reward?.balanceAfter);
        setWalletBalances((prev) => ({
          credits: Number.isFinite(balanceAfter)
              ? Math.max(0, Math.floor(balanceAfter))
              : Math.max(
                  0,
                  prev.credits +
                    (Number.isFinite(awardedCredits)
                      ? Math.max(0, awardedCredits)
                      : 0),
                ),
        }));
        if (Number.isFinite(awardedCredits) && awardedCredits > 0) {
          setRunRewardMessage(`+${awardedCredits} tickets this run.`);
          setRunRewardIsCapHit(false);
        } else if (wantedCredits > 0 && capRemaining <= 0) {
          setRunRewardMessage(
            'Daily ticket cap reached. No tickets this run.',
          );
          setRunRewardIsCapHit(true);
        } else {
          setRunRewardMessage('No tickets this run.');
          setRunRewardIsCapHit(false);
        }
        if (
          reward &&
          Number.isFinite(Number(reward.earnedTodayTotal)) &&
          Number.isFinite(Number(reward.capRemaining))
        ) {
          const earned = Math.max(0, Number(reward.earnedTodayTotal));
          const cap = earned + Math.max(0, Number(reward.capRemaining));
          setDailyCreditsProgress({
            earned,
            cap,
          });
        }
      }

      setLeaderboardRefreshKey((prev) => prev + 1);
    } catch (error) {
      console.error('Failed to save score:', error);
      setSubmitError('Could not save your run. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  saveScoreRef.current = saveScore;

  const generateFood = useCallback((): Position => {
    return generateFoodPosition(snakeRef.current, nextRandomRef.current);
  }, []);

  // Draw function tuned for a Google Snake-like visual style.
  const drawGame = useCallback(
    (interpolation: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctxValue = canvas.getContext('2d');
      if (!ctxValue) return;
      const ctx: CanvasRenderingContext2D = ctxValue;
      const now = Date.now();
      const snake = snakeRef.current;
      const prevSnake = prevSnakeRef.current;
      const isPlaying = gameStateRef.current === 'playing';

      const cssW = canvas.clientWidth || BASE_WIDTH;
      const cssH = canvas.clientHeight || BASE_HEIGHT;
      // Adaptive cap keeps the large board crisp without over-shading on
      // constrained/high-DPR devices.
      const dpr = gameCanvasDpr(cssW, cssH);
      if (
        canvas.width !== Math.round(cssW * dpr) ||
        canvas.height !== Math.round(cssH * dpr)
      ) {
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
      }
      // Keep drawing coordinates in BASE_* space, then scale to the responsive canvas.
      // This prevents clipping/misalignment when the CSS size is smaller than the base board.
      const scaleX = cssW / BASE_WIDTH;
      const scaleY = cssH / BASE_HEIGHT;
      ctx.setTransform(dpr * scaleX, 0, 0, dpr * scaleY, 0, 0);

      // The board layer is built at the canvas's own pixel size (quarter
      // steps, at most 3x), so a big stage stays sharp and a resize rebuilds it.
      const layerScale = Math.min(3, Math.ceil((canvas.width / BASE_WIDTH) * 4) / 4);
      ensureSnakeBoardLayer({
        scale: layerScale,
        snakeTheme,
        boardLayerRef,
        boardLayerThemeRef,
        boardImageCacheRef,
        boardImageLoadStateRef,
        onAsyncTextureReady: () => {
          drawGameRef.current(1);
        },
      });

      ctx.save();
      ctx.imageSmoothingEnabled = true;
      // The board's colour under a cell, for a skin's cut-outs.
      const boardFillAt = (cellX: number, cellY: number) =>
        snakeTheme.skin?.material === 'planks'
          ? cellY % 2
            ? snakeTheme.boardTileColorB2
            : snakeTheme.boardColorA
          : (cellX + cellY) % 2 === 0
            ? snakeTheme.boardColorA
            : snakeTheme.boardColorB;
      if (boardLayerRef.current) {
        ctx.drawImage(boardLayerRef.current, 0, 0, BASE_WIDTH, BASE_HEIGHT);
      }

      // ---Apple ---
      const food = foodRef.current;
      const foodCx = food.x * CELL_SIZE + CELL_SIZE / 2;
      const foodCy = food.y * CELL_SIZE + CELL_SIZE / 2;
      const pulseFactor = 1 + (snakeTheme.foodPulse / 100) * 0.08 * Math.sin(now / 220);
      const appleR = CELL_SIZE * 0.42 * (snakeTheme.foodSize / 100) * pulseFactor;

      // Shadow under apple — a soft black drop reads on the dark screen well.
      ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
      ctx.beginPath();
      ctx.arc(foodCx, foodCy + appleR * 0.15, appleR * 0.9, 0, Math.PI * 2);
      ctx.fill();

      const skinLook = snakeTheme.skin;
      if (skinLook && skinLook.shape !== 'tube') {
        drawSkinFood(ctx, skinLook, foodCx, foodCy, appleR, snakeTheme, boardFillAt(food.x, food.y));
      } else {
        if (snakeTheme.foodGlowEnabled) {
          ctx.save();
          ctx.shadowColor = snakeTheme.foodGlowColor;
          ctx.shadowBlur = appleR * (0.4 + snakeTheme.foodGlowSize / 70);
          ctx.fillStyle = snakeTheme.foodGlowColor;
          ctx.globalAlpha = 0.65;
          ctx.beginPath();
          ctx.arc(foodCx, foodCy, appleR * 0.92, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.restore();
        }

        if (snakeTheme.foodShape === 'orb') {
          const orbGrad = ctx.createRadialGradient(
            foodCx - appleR * 0.2,
            foodCy - appleR * 0.25,
            appleR * 0.15,
            foodCx,
            foodCy,
            appleR * 1.05,
          );
          orbGrad.addColorStop(0, snakeTheme.foodHighlight);
          orbGrad.addColorStop(1, snakeTheme.foodPrimary);
          ctx.fillStyle = orbGrad;
          ctx.beginPath();
          ctx.arc(foodCx, foodCy, appleR, 0, Math.PI * 2);
          ctx.fill();
        } else if (snakeTheme.foodShape === 'diamond') {
          ctx.fillStyle = snakeTheme.foodPrimary;
          ctx.beginPath();
          ctx.moveTo(foodCx, foodCy - appleR * 1.05);
          ctx.lineTo(foodCx + appleR * 0.92, foodCy);
          ctx.lineTo(foodCx, foodCy + appleR * 1.05);
          ctx.lineTo(foodCx - appleR * 0.92, foodCy);
          ctx.closePath();
          ctx.fill();
        } else {
          // Main apple body
          ctx.fillStyle = snakeTheme.foodPrimary;
          ctx.beginPath();
          ctx.arc(foodCx, foodCy, appleR, 0, Math.PI * 2);
          ctx.fill();

          // Stem
          ctx.strokeStyle = snakeTheme.foodStemColor;
          ctx.lineWidth = CELL_SIZE * 0.07;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(foodCx, foodCy - appleR * 0.8);
          ctx.lineTo(foodCx - appleR * 0.05, foodCy - appleR * 1.35);
          ctx.stroke();

          // Leaf
          ctx.fillStyle = snakeTheme.foodLeafColor;
          ctx.beginPath();
          ctx.ellipse(
            foodCx + appleR * 0.35,
            foodCy - appleR * 1.2,
            appleR * 0.38,
            appleR * 0.16,
            Math.PI * 0.18,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }

        // Highlight
        ctx.fillStyle = snakeTheme.foodHighlight;
        ctx.globalAlpha = 0.62;
        ctx.beginPath();
        if (snakeTheme.foodShape === 'diamond') {
          ctx.moveTo(foodCx - appleR * 0.2, foodCy - appleR * 0.45);
          ctx.lineTo(foodCx + appleR * 0.2, foodCy - appleR * 0.05);
          ctx.lineTo(foodCx, foodCy + appleR * 0.35);
          ctx.closePath();
        } else {
          ctx.arc(
            foodCx - appleR * 0.25,
            foodCy - appleR * 0.22,
            appleR * 0.38,
            0,
            Math.PI * 2,
          );
        }
        ctx.fill();
        ctx.globalAlpha = 1;

      }

      // --- Interpolation helpers ---
      const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
      type Seg = { x: number; y: number };
      const getPos = (segment: Seg, prev: Seg | undefined) => {
        if (!isPlaying || !prev) return { x: segment.x, y: segment.y };
        return {
          x: lerp(prev.x, segment.x, interpolation),
          y: lerp(prev.y, segment.y, interpolation),
        };
      };

      // --- Snake proportions (all relative to CELL_SIZE) ---
      const C = CELL_SIZE;
      const bodyRadius = C * 0.35; // body diameter ~80% of cell
      const shadowOffsetY = C * 0.12;

      // Interpolated head for smooth movement
      const headPos = getPos(snake[0], prevSnake[0]);
      const headPx = { px: headPos.x * C + C / 2, py: headPos.y * C + C / 2 };

      // --- Snake pearl-tracking body ---
      // Update the persistent pearl list: prepend new pearls as the head moves,
      // trim tail pearls to maintain the correct body length.
      const pearlSpacing = bodyRadius * 0.3;
      const pearls = bodyPearlsRef.current;

      if (isPlaying && pearls.length > 0) {
        // Add new pearls at the head end when the head moves far enough
        const hx = headPx.px,
          hy = headPx.py;
        const first = pearls[0];
        const distToFirst = Math.sqrt(
          (hx - first.x) ** 2 + (hy - first.y) ** 2,
        );

        if (distToFirst >= pearlSpacing) {
          // Insert pearls between the current head and the first pearl
          const numNew = Math.floor(distToFirst / pearlSpacing);
          for (let n = numNew; n >= 1; n--) {
            const t = (n * pearlSpacing) / distToFirst;
            pearls.unshift({
              x: hx + (first.x - hx) * t,
              y: hy + (first.y - hy) * t,
            });
          }
        }
        // Always keep the head as the first pearl
        pearls.unshift({ x: hx, y: hy });

        // Compute desired body length in pixels
        const targetLen = (snake.length - 1) * C;

        // Walk pearls from head, accumulate distance, trim at targetLen
        let accum = 0;
        let trimIdx = pearls.length - 1;
        for (let i = 1; i < pearls.length; i++) {
          const dx = pearls[i].x - pearls[i - 1].x;
          const dy = pearls[i].y - pearls[i - 1].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (accum + d >= targetLen) {
            // Interpolate the final pearl position
            const remaining = targetLen - accum;
            const t = d > 0 ? remaining / d : 1;
            pearls[i] = {
              x: lerp(pearls[i - 1].x, pearls[i].x, t),
              y: lerp(pearls[i - 1].y, pearls[i].y, t),
            };
            trimIdx = i;
            break;
          }
          accum += d;
        }
        // Remove pearls beyond the trim point
        if (trimIdx < pearls.length - 1) {
          pearls.length = trimIdx + 1;
        }
      } else if (!isPlaying && pearls.length === 0) {
        // Initialize densely spaced pearls for idle display
        for (let si = 0; si < snake.length - 1; si++) {
          const ax = snake[si].x * C + C / 2;
          const ay = snake[si].y * C + C / 2;
          const bx = snake[si + 1].x * C + C / 2;
          const by = snake[si + 1].y * C + C / 2;
          const segLen = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2);
          const steps = Math.max(1, Math.ceil(segLen / pearlSpacing));
          for (let j = 0; j < steps; j++) {
            const t = j / steps;
            pearls.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t });
          }
        }
        const last = snake[snake.length - 1];
        pearls.push({ x: last.x * C + C / 2, y: last.y * C + C / 2 });
      }

      // --- Color utilities for gradient modes ---
      // (hexToRgb / rgbToHex / lerpHex are hoisted to module scope so this
      // per-frame path never re-creates closures.)

      const drawBodyFlat = (color: string, yOff: number) => {
        if (pearls.length < 1) return;
        ctx.fillStyle = color;
        ctx.beginPath();
        for (let i = 0; i < pearls.length; i++) {
          ctx.moveTo(pearls[i].x + bodyRadius, pearls[i].y + yOff);
          ctx.arc(pearls[i].x, pearls[i].y + yOff, bodyRadius, 0, Math.PI * 2);
        }
        ctx.fill();
      };

      const gradMode = snakeTheme.bodyGradient;
      const pri = snakeTheme.bodyPrimary;
      const sec = snakeTheme.bodySecondary;

      // --- Body glow effect (drawn first so it sits behind the snake) ---
      if (
        snakeTheme.bodyGlowEnabled &&
        snakeTheme.bodyGlowStyle !== 'none' &&
        pearls.length > 0
      ) {
        const baseGlowColor = snakeTheme.bodyGlowColor;
        const altGlowColor = snakeTheme.bodyGlowColorAlt;
        const glowSizeFactor = snakeTheme.bodyGlowSize / 50;
        const glowBlur = bodyRadius * (0.9 + glowSizeFactor * 1.25);
        let glowAlpha = 0.82;
        let glowColor = baseGlowColor;

        if (snakeTheme.bodyGlowStyle === 'pulse') {
          const speed = snakeTheme.bodyGlowSpeed / 50;
          const time = performance.now() / 1000;
          glowAlpha =
            0.35 + 0.6 * (0.5 + 0.5 * Math.sin(time * speed * Math.PI * 2));
        } else if (snakeTheme.bodyGlowStyle === 'pulse-dual') {
          const speed = snakeTheme.bodyGlowSpeed / 50;
          const time = performance.now() / 1000;
          const mix = 0.5 + 0.5 * Math.sin(time * speed * Math.PI * 2);
          glowAlpha = 0.72;
          glowColor = lerpHex(baseGlowColor, altGlowColor, mix);
        }

        ctx.save();
        ctx.globalAlpha = glowAlpha;
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = glowBlur;
        ctx.strokeStyle = glowColor;
        ctx.lineWidth = bodyRadius * 2.45;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(pearls[pearls.length - 1].x, pearls[pearls.length - 1].y);
        for (let i = pearls.length - 2; i >= 0; i--) {
          ctx.lineTo(pearls[i].x, pearls[i].y);
        }
        ctx.stroke();
        ctx.restore();
      }

      // --- Swallowing bulge: compute per-pearl radius scale ---
      const bulge = bulgeRef.current;
      let bulgeCenterDist = -1;
      let bulgeStrength = 0;
      const bulgeSpread = C * 1.0; // how wide the swelling wave is
      if (bulge && isPlaying && pearls.length > 1) {
        const ticksElapsed = tickCountRef.current - bulge.startTick;
        const bulgePos = (ticksElapsed + interpolation) * 1.5;
        const bulgeLifeSegs = Math.max(4, 4 + 3 * Math.log2(snake.length));
        if (bulgePos >= bulgeLifeSegs) {
          bulgeRef.current = null;
        } else if (bulgePos > 0) {
          bulgeCenterDist = bulgePos * C;
          const progress = bulgePos / bulgeLifeSegs;
          bulgeStrength = 0.55 * (1 - progress) * (1 - progress);
        }
      }
      // Cumulative distances from head for each pearl — reuse the module
      // scratch buffer instead of allocating a new array every frame.
      const pearlDists = pearlDistsScratch;
      pearlDists.length = 0;
      pearlDists.push(0);
      for (let i = 1; i < pearls.length; i++) {
        const dx = pearls[i].x - pearls[i - 1].x;
        const dy = pearls[i].y - pearls[i - 1].y;
        pearlDists.push(pearlDists[i - 1] + Math.sqrt(dx * dx + dy * dy));
      }
      const pearlR = (idx: number) => {
        if (bulgeCenterDist < 0 || bulgeStrength <= 0) return bodyRadius;
        const dist = Math.abs(pearlDists[idx] - bulgeCenterDist);
        if (dist >= bulgeSpread) return bodyRadius;
        const t = dist / bulgeSpread;
        const bell = 0.5 + 0.5 * Math.cos(t * Math.PI);
        return bodyRadius * (1 + bulgeStrength * bell);
      };

      if (skinLook && skinLook.shape !== 'tube') {
        // A skin set's body: its signature shape, one piece per cell along
        // the same path, same size and place as the tube it replaces.
        drawSkinBody(ctx, skinLook, snakeTheme, pearls, pearlDists, pearlR, C, shadowOffsetY, boardFillAt);
      } else {
      // Shadow pass (always flat) — neutral black drop on the dark screen well
      drawBodyFlat('rgba(0, 0, 0, 0.38)', shadowOffsetY);

      // Body pass — gradient-aware (with per-pearl bulge radius)
      if (gradMode === 'flat' || pearls.length < 1) {
        if (bulgeCenterDist < 0) {
          drawBodyFlat(pri, 0);
        } else {
          for (let i = 0; i < pearls.length; i++) {
            const r = pearlR(i);
            ctx.fillStyle = pri;
            ctx.beginPath();
            ctx.arc(pearls[i].x, pearls[i].y, r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else {
        const total = Math.max(1, pearls.length - 1);
        for (let i = 0; i < pearls.length; i++) {
          const px = pearls[i].x;
          const py = pearls[i].y;
          const r = pearlR(i);
          const t = i / total; // 0 at head, 1 at tail

          if (gradMode === 'linear') {
            ctx.fillStyle = lerpHex(pri, sec, t);
            ctx.beginPath();
            ctx.arc(px, py, r, 0, Math.PI * 2);
            ctx.fill();
          } else if (gradMode === 'radial') {
            const grad = ctx.createRadialGradient(
              px - r * 0.3,
              py - r * 0.3,
              r * 0.1,
              px,
              py,
              r,
            );
            grad.addColorStop(0, lerpHex(pri, '#ffffff', 0.25));
            grad.addColorStop(0.6, pri);
            grad.addColorStop(1, sec);
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(px, py, r, 0, Math.PI * 2);
            ctx.fill();
          } else {
            // combined: head-to-tail color shift + radial shading
            const baseColor = lerpHex(pri, sec, t);
            const grad = ctx.createRadialGradient(
              px - r * 0.3,
              py - r * 0.3,
              r * 0.1,
              px,
              py,
              r,
            );
            grad.addColorStop(0, lerpHex(baseColor, '#ffffff', 0.25));
            grad.addColorStop(0.6, baseColor);
            grad.addColorStop(1, lerpHex(baseColor, sec, 0.5));
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(px, py, r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      }

      if (
        snakeTheme.bodyPatternStyle !== 'none' &&
        snakeTheme.bodyPatternIntensity > 0
      ) {
        const alpha = Math.min(
          0.9,
          0.12 + (snakeTheme.bodyPatternIntensity / 100) * 0.78,
        );
        for (let i = 1; i < pearls.length; i++) {
          const px = pearls[i].x;
          const py = pearls[i].y;
          const r = pearlR(i);
          ctx.save();
          ctx.strokeStyle = snakeTheme.bodyPatternColor;
          ctx.fillStyle = snakeTheme.bodyPatternColor;
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.clip();

          if (snakeTheme.bodyPatternStyle === 'stripes') {
            ctx.lineWidth = Math.max(
              1,
              r * (0.08 + snakeTheme.bodyPatternIntensity / 800),
            );
            const gap = Math.max(
              3,
              r * (0.35 - snakeTheme.bodyPatternIntensity / 700),
            );
            for (let k = -r * 2; k <= r * 2; k += gap) {
              ctx.beginPath();
              ctx.moveTo(px + k - r, py - r);
              ctx.lineTo(px + k + r, py + r);
              ctx.stroke();
            }
          } else if (snakeTheme.bodyPatternStyle === 'dots') {
            const dotR = Math.max(
              1,
              r * (0.08 + snakeTheme.bodyPatternIntensity / 650),
            );
            ctx.beginPath();
            ctx.arc(px - r * 0.2, py - r * 0.15, dotR, 0, Math.PI * 2);
            ctx.arc(px + r * 0.25, py + r * 0.1, dotR, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
      }

      // --- Head ---
      if (snake.length > 0) {
        const hx = headPx.px;
        const hy = headPx.py;
        const renderDir = DIRECTION_VECTORS[directionRef.current];
        const dirX = renderDir.x;
        const dirY = renderDir.y;
        const sideX = -dirY;
        const sideY = dirX;

        // Eating squashes the head: flat along the way it faces, wide across,
        // then a spring back (the feel kit's squash; none under reduced
        // motion). The bulge below carries the growth down the tail.
        const squash = squashAt(performance.now() - eatenAtRef.current, {
          force: 1,
          reduced: reducedMotionRef.current,
        });
        const squashing = squash.scaleX !== 1 || squash.scaleY !== 1;
        if (squashing) {
          const facing = Math.atan2(dirY, dirX);
          ctx.save();
          ctx.translate(hx, hy);
          ctx.rotate(facing);
          ctx.scale(squash.scaleY, squash.scaleX);
          ctx.rotate(-facing);
          ctx.translate(-hx, -hy);
        }

        // Head geometry
        const lobeR = C * 0.28; // lobe radius — subtle bump
        const lobeOff = C * 0.25; // lobe center offset (perpendicular)
        const headFwd = C * 0.08; // head center pushed forward
        const snoutR = C * 0.28; // snout — nearly as wide as body
        const snoutFwd = C * 0.34; // snout center forward from head center
        const eyeR = C * 0.2; // eye white radius
        const irisR = eyeR * 0.62;
        const pupilR = irisR * 0.5;

        const hcx = hx + dirX * headFwd;
        const hcy = hy + dirY * headFwd;

        // Lobe centers
        const l1x = hcx + sideX * lobeOff;
        const l1y = hcy + sideY * lobeOff;
        const l2x = hcx - sideX * lobeOff;
        const l2y = hcy - sideY * lobeOff;

        // Snout center
        const sx = hcx + dirX * snoutFwd;
        const sy = hcy + dirY * snoutFwd;

        // Helper: draw a single filled circle
        const fillCircle = (cx: number, cy: number, r: number) => {
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
        };

        // Head glow (behind head fill)
        if (snakeTheme.bodyGlowEnabled && snakeTheme.bodyGlowStyle !== 'none') {
          const baseGlowColor = snakeTheme.bodyGlowColor;
          const altGlowColor = snakeTheme.bodyGlowColorAlt;
          const glowSizeFactor = snakeTheme.bodyGlowSize / 50;
          const glowBlur = bodyRadius * (0.9 + glowSizeFactor * 1.25);
          let glowAlpha = 0.82;
          let glowColor = baseGlowColor;
          if (snakeTheme.bodyGlowStyle === 'pulse') {
            const speed = snakeTheme.bodyGlowSpeed / 50;
            const time = performance.now() / 1000;
            glowAlpha =
              0.35 + 0.6 * (0.5 + 0.5 * Math.sin(time * speed * Math.PI * 2));
          } else if (snakeTheme.bodyGlowStyle === 'pulse-dual') {
            const speed = snakeTheme.bodyGlowSpeed / 50;
            const time = performance.now() / 1000;
            const mix = 0.5 + 0.5 * Math.sin(time * speed * Math.PI * 2);
            glowAlpha = 0.72;
            glowColor = lerpHex(baseGlowColor, altGlowColor, mix);
          }
          ctx.save();
          ctx.globalAlpha = glowAlpha;
          ctx.shadowColor = glowColor;
          ctx.shadowBlur = glowBlur;
          ctx.fillStyle = glowColor;
          ctx.beginPath();
          ctx.arc(hcx, hcy, bodyRadius, 0, Math.PI * 2);
          ctx.arc(l1x, l1y, lobeR, 0, Math.PI * 2);
          ctx.arc(l2x, l2y, lobeR, 0, Math.PI * 2);
          ctx.arc(sx, sy, snoutR, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // Head shadow (each part separately to avoid path artifacts)
        ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
        fillCircle(hcx, hcy + shadowOffsetY, bodyRadius);
        fillCircle(l1x, l1y + shadowOffsetY, lobeR);
        fillCircle(l2x, l2y + shadowOffsetY, lobeR);
        fillCircle(sx, sy + shadowOffsetY, snoutR);

        // Head fill: center (body width) + lobes + snout
        ctx.fillStyle = snakeTheme.bodyPrimary;
        fillCircle(hcx, hcy, bodyRadius);
        fillCircle(l1x, l1y, lobeR);
        fillCircle(l2x, l2y, lobeR);
        fillCircle(sx, sy, snoutR);

        // Eyes — pupils track the apple while alive; X eyes on death.
        const isDead = gameStateRef.current === 'gameover';
        const food = foodRef.current;
        const foodPx = food.x * C + C / 2;
        const foodPy = food.y * C + C / 2;
        const maxIrisOff = eyeR - irisR; // keep iris inside eye white
        const maxPupilOff = eyeR - pupilR; // keep pupil inside eye white

        const eyeLook = (ex: number, ey: number) => {
          const toFoodX = foodPx - ex;
          const toFoodY = foodPy - ey;
          const dist = Math.sqrt(toFoodX * toFoodX + toFoodY * toFoodY);
          if (dist < 0.1) return { ix: 0, iy: 0, px: 0, py: 0 };
          const nx = toFoodX / dist;
          const ny = toFoodY / dist;
          return {
            ix: nx * maxIrisOff * 0.7,
            iy: ny * maxIrisOff * 0.7,
            px: nx * maxPupilOff * 0.8,
            py: ny * maxPupilOff * 0.8,
          };
        };

        const look1 = eyeLook(l1x, l1y);
        const look2 = eyeLook(l2x, l2y);

        // Eye whites
        ctx.fillStyle = '#ffffff';
        fillCircle(l1x, l1y, eyeR);
        fillCircle(l2x, l2y, eyeR);

        if (isDead) {
          // X eyes — two crossed strokes per eye, no apple tracking.
          ctx.strokeStyle = lerpHex(snakeTheme.bodySecondary, '#000000', 0.55);
          ctx.lineWidth = Math.max(1.5, C * 0.05);
          ctx.lineCap = 'round';
          const xArm = eyeR * 0.55;
          for (const [ex, ey] of [
            [l1x, l1y],
            [l2x, l2y],
          ] as const) {
            ctx.beginPath();
            ctx.moveTo(ex - xArm, ey - xArm);
            ctx.lineTo(ex + xArm, ey + xArm);
            ctx.moveTo(ex + xArm, ey - xArm);
            ctx.lineTo(ex - xArm, ey + xArm);
            ctx.stroke();
          }
        } else {
          // Irises (track apple)
          ctx.fillStyle = snakeTheme.bodySecondary;
          fillCircle(l1x + look1.ix, l1y + look1.iy, irisR);
          fillCircle(l2x + look2.ix, l2y + look2.iy, irisR);

          // Pupils (track apple)
          ctx.fillStyle = lerpHex(snakeTheme.bodySecondary, '#000000', 0.55);
          fillCircle(l1x + look1.px, l1y + look1.py, pupilR);
          fillCircle(l2x + look2.px, l2y + look2.py, pupilR);
        }

        // Nostrils
        const nostrilOff = snoutR * 0.38;
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        fillCircle(sx + sideX * nostrilOff, sy + sideY * nostrilOff, C * 0.022);
        fillCircle(sx - sideX * nostrilOff, sy - sideY * nostrilOff, C * 0.022);

        // Tongue — flicks out every ~5s for 250ms
        const tonguePhase = (now % 5000) / 5000;
        const tongueVisible = tonguePhase < 0.08; // ~500ms out of 5000ms
        if (tongueVisible) {
          const tongueT = tonguePhase / 0.08; // 0→1 during flick
          const tongueExtend = Math.sin(tongueT * Math.PI); // ease in/out
          const tongueLen = C * 0.48 * tongueExtend;
          const forkLen = C * 0.18 * tongueExtend;
          const forkSpread = C * 0.09;

          // Tongue base: tip of snout
          const tbx = sx + dirX * snoutR;
          const tby = sy + dirY * snoutR;
          // Tongue tip
          const ttx = tbx + dirX * tongueLen;
          const tty = tby + dirY * tongueLen;

          ctx.strokeStyle = '#cc3333';
          ctx.lineWidth = C * 0.045;
          ctx.lineCap = 'round';

          // Main tongue
          ctx.beginPath();
          ctx.moveTo(tbx, tby);
          ctx.lineTo(ttx, tty);
          ctx.stroke();

          // Fork left
          ctx.beginPath();
          ctx.moveTo(ttx, tty);
          ctx.lineTo(
            ttx + dirX * forkLen + sideX * forkSpread,
            tty + dirY * forkLen + sideY * forkSpread,
          );
          ctx.stroke();

          // Fork right
          ctx.beginPath();
          ctx.moveTo(ttx, tty);
          ctx.lineTo(
            ttx + dirX * forkLen - sideX * forkSpread,
            tty + dirY * forkLen - sideY * forkSpread,
          );
          ctx.stroke();
        }
        if (squashing) ctx.restore();
      }

      // --- Cosmetic feedback layer (eat bursts, score popups, death flash) ---
      const fx = fxRef.current;
      if (fx.flashAlpha > 0) {
        ctx.fillStyle = fx.flashColor;
        ctx.globalAlpha = fx.flashAlpha;
        ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
        ctx.globalAlpha = 1;
      }
      fx.forEachParticle((p, alpha) => {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      // The "+10": the tixy callout plate, one cell above the apple, kept
      // inside the board.
      const unit = 1 / scaleX;
      fx.forEachPopup((p, u) => {
        drawCanvasCallout(ctx, readCanvasCalloutLook(canvas), {
          text: p.text,
          x: p.x,
          y: p.y - CELL_SIZE * 0.9,
          u,
          unit,
          reducedMotion: fx.reducedMotion,
          within: { left: 0, top: 0, right: BASE_WIDTH, bottom: BASE_HEIGHT },
        });
      });
      ctx.globalAlpha = 1;

      ctx.restore();
    },
    [snakeTheme],
  );
  drawGameRef.current = drawGame;

  // `?skinShot=1` (scripts/capture-skin-shots.mts): the snake waits as a
  // long snake winding round the board, so the prize counter's shot of a
  // skin shows its body. Only the board before a run changes; a run starts
  // from the usual three cells.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('skinShot') !== '1') return;
    const path: Array<[number, number]> = [
      [11, 6], [10, 6], [9, 6], [8, 6], [7, 6], [6, 6], [5, 6], [5, 7], [5, 8], [5, 9], [5, 10], [5, 11],
      [6, 11], [7, 11], [8, 11], [9, 11], [10, 11], [11, 11], [12, 11],
    ];
    snakeRef.current = path.map(([x, y], i) => {
      const [nx, ny] = path[i - 1] ?? [x + 1, y];
      return { x, y, dx: Math.sign(nx - x), dy: Math.sign(ny - y), tx: x, ty: y };
    });
    prevSnakeRef.current = [];
    bodyPearlsRef.current = [];
    directionRef.current = 'RIGHT';
    foodRef.current = { x: 14, y: 6 };
    drawGameRef.current(1);
  }, []);

  // Game logic update (fixed timestep)
  const updateGame = useCallback(() => {
    if (gameStateRef.current !== 'playing') return false;

    // Store previous positions for interpolation
    tickCountRef.current++;
    prevSnakeRef.current = snakeRef.current.map((s) => ({ ...s }));

    const snake = snakeRef.current;

    // Process direction queue - get next valid direction
    if (directionQueueRef.current.length > 0) {
      const nextDir = directionQueueRef.current.shift()!;
      // Validate against current direction (not queued)
      if (nextDir !== OPPOSITE_DIRECTIONS[directionRef.current]) {
        directionRef.current = nextDir;
      }
    }

    const direction = directionRef.current;
    const vector = DIRECTION_VECTORS[direction];

    // Calculate new head position
    const head = {
      x: snake[0].x + vector.x,
      y: snake[0].y + vector.y,
      dx: vector.x,
      dy: vector.y,
      tx: snake[0].x + vector.x,
      ty: snake[0].y + vector.y,
    };

    // Check wall collision
    if (
      head.x < 0 ||
      head.x >= GRID_SIZE ||
      head.y < 0 ||
      head.y >= GRID_SIZE
    ) {
      SoundManager.play('die');
      playHaptic('failure');
      appleLadder.reset();
      // The biggest impact in the game: the stage shakes. No hit-stop; the
      // run is over and nothing is left to freeze.
      triggerRef.current('impact', { sound: false, motion: false, shake: 1 });
      endedAtRef.current = performance.now();
      // Impact burst at the point of contact (head may be just off-grid —
      // clamp so the burst stays on the board).
      fxRef.current.onDeath(
        Math.max(0, Math.min(GRID_SIZE - 1, snake[0].x)) * CELL_SIZE +
          CELL_SIZE / 2,
        Math.max(0, Math.min(GRID_SIZE - 1, snake[0].y)) * CELL_SIZE +
          CELL_SIZE / 2,
        snakeTheme.bodyPrimary,
      );
      wsRef.current?.close();
      gameStateRef.current = 'gameover';
      setGameState('gameover');
      if (scoreRef.current > highScore) {
        setHighScore(scoreRef.current);
      }
      saveScoreRef.current?.(scoreRef.current);
      return false;
    }

    // Check self collision (exclude tail if not growing)
    const checkSnake = snake.slice(0, -1); // Tail will move, so exclude it
    if (
      checkSnake.some(
        (segment: Position) => segment.x === head.x && segment.y === head.y,
      )
    ) {
      SoundManager.play('die');
      playHaptic('failure');
      appleLadder.reset();
      // The biggest impact in the game: the stage shakes. No hit-stop; the
      // run is over and nothing is left to freeze.
      triggerRef.current('impact', { sound: false, motion: false, shake: 1 });
      endedAtRef.current = performance.now();
      fxRef.current.onDeath(
        head.x * CELL_SIZE + CELL_SIZE / 2,
        head.y * CELL_SIZE + CELL_SIZE / 2,
        snakeTheme.bodyPrimary,
      );
      wsRef.current?.close();
      gameStateRef.current = 'gameover';
      setGameState('gameover');
      if (scoreRef.current > highScore) {
        setHighScore(scoreRef.current);
      }
      saveScoreRef.current?.(scoreRef.current);
      return false;
    }

    // Add new head
    snake.unshift(head);

    // Check food collision
    const food = foodRef.current;
    if (head.x === food.x && head.y === food.y) {
      // A tick per apple, and the sound climbs a semitone each time.
      triggerRef.current('collect', {
        motion: false,
        haptic: true,
        pitch: appleLadder.next(),
      });
      eatenAtRef.current = performance.now();
      scoreRef.current += FOOD_SCORE;
      setScore(scoreRef.current);
      // Speed ramps every SPEED_RAMP_APPLES apples (see _snake-helpers.ts).
      const applesEaten = scoreRef.current / FOOD_SCORE;
      const nextTickRate = tickRateForApples(applesEaten);
      if (nextTickRate !== tickRateRef.current) {
        tickRateRef.current = nextTickRate;
        pushGameplayCallout({
          label: 'faster',
          detail: `${Math.round(nextTickRate * 10) / 10} moves a second`,
          tone: 'neutral',
          y: 14,
          duration: 1100,
          announce: `Faster. ${Math.round(nextTickRate * 10) / 10} moves a second.`,
        });
      }
      checkNewBest(scoreRef.current, bestAtRunStartRef.current);
      fxRef.current.onEat(
        food.x * CELL_SIZE + CELL_SIZE / 2,
        food.y * CELL_SIZE + CELL_SIZE / 2,
        snakeTheme.foodPrimary,
        `+${FOOD_SCORE}`,
      );
      if (snake.length >= WINNING_SNAKE_LENGTH) {
        SoundManager.play('win');
        playHaptic('success');
        fxRef.current.onWin(
          head.x * CELL_SIZE + CELL_SIZE / 2,
          head.y * CELL_SIZE + CELL_SIZE / 2,
          [snakeTheme.foodPrimary, snakeTheme.bodyPrimary, snakeTheme.bodySecondary],
        );
        wsRef.current?.close();
        endedAtRef.current = performance.now();
        gameStateRef.current = 'won';
        setGameState('won');
        if (scoreRef.current > highScore) {
          setHighScore(scoreRef.current);
        }
        saveScoreRef.current?.(scoreRef.current);
        return false;
      }
      foodRef.current = generateFood();

      // Don't pop tail - snake grows. The swelling ripples down the body;
      // under reduced motion there is no ripple.
      bulgeRef.current = reducedMotionRef.current
        ? null
        : { startTick: tickCountRef.current };
    } else {
      snake.pop();
    }

    return true;
  }, [appleLadder, checkNewBest, generateFood, highScore, pushGameplayCallout, snakeTheme]);

  // Runtime-owned frame callback. Snake's logical tick interval changes with
  // speed, so its existing wall-clock accumulator stays authoritative here.
  const runFrame = useCallback(
    (timestamp: number) => {
      if (gameStateRef.current !== 'playing') {
        // Post-game: keep drawing while death/win effects are still alive so
        // bursts and the flash animate out instead of freezing on contact.
        const fx = fxRef.current;
        const idleDt = Math.min(
          100,
          timestamp - (lastFrameTimeRef.current || timestamp),
        );
        lastFrameTimeRef.current = timestamp;
        fx.update(idleDt);
        drawGame(1);
        if (!fx.isActive) frameLoopRef.current?.stop();
        return;
      }

      // Pause: keep rendering but skip game updates
      if (isPausedRef.current) {
        drawGame(interpolationRef.current);
        lastTickTimeRef.current = timestamp;
        lastFrameTimeRef.current = timestamp;
        return;
      }

      const frameDt = Math.min(
        100,
        timestamp - (lastFrameTimeRef.current || timestamp),
      );
      lastFrameTimeRef.current = timestamp;
      fxRef.current.update(frameDt);

      // Calculate delta time
      const tickInterval = 1000 / tickRateRef.current;
      const deltaTime = timestamp - lastTickTimeRef.current;

      // Fixed timestep catch-up updates to avoid visible square jumps on frame drops.
      if (deltaTime >= tickInterval) {
        const maxSubsteps = 4;
        const dueSteps = Math.min(
          maxSubsteps,
          Math.floor(deltaTime / tickInterval),
        );
        for (let step = 0; step < dueSteps; step++) {
          updateGame();
          lastTickTimeRef.current += tickInterval;
        }
        if (timestamp - lastTickTimeRef.current > tickInterval * maxSubsteps) {
          lastTickTimeRef.current = timestamp;
        }
      }

      // Calculate interpolation for smooth rendering
      const timeSinceLastTick = timestamp - lastTickTimeRef.current;
      interpolationRef.current = Math.min(1, timeSinceLastTick / tickInterval);

      if (documentHiddenRef.current) {
        if (timestamp - lastHiddenDrawTimeRef.current >= 90) {
          drawGame(interpolationRef.current);
          lastHiddenDrawTimeRef.current = timestamp;
        }
      } else {
        // Render at display frame rate with interpolation.
        drawGame(interpolationRef.current);
      }
    },
    [drawGame, updateGame],
  );

  const startGame = useCallback(async (firstDirection?: Direction) => {
    resetRunResult();
    if (isStartingRef.current) return;
    isStartingRef.current = true;
    // A turn that started the run waits here until the session is ready.
    firstDirectionRef.current = firstDirection ?? null;
    isGuestRunRef.current = false;
    setIsStartingSession(true);
    setSubmitError(null);
    setStartError(null);
    setRunRewardMessage(null);
    setRunAccountXp(null);
    setRunRewardIsCapHit(false);
    // Request a game session token before starting
    let sessionSuccess = false;
    try {
      const sessionResponse = await fetch('/api/games/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameType: 'snake' }),
      });
      if (sessionResponse.ok) {
        setBanIndefinite(false);
        setBanUntilMs(null);
        const sessionData = await sessionResponse.json();
        sessionTokenRef.current = sessionData.token;
        snakeSeedRef.current =
          typeof sessionData.snakeSeed === 'number'
            ? sessionData.snakeSeed
            : null;
        if (snakeSeedRef.current === null) {
          setGameState('error');
          isStartingRef.current = false;
          return;
        }
        // Deterministic run RNG — same seed, same food sequence (replay).
        nextRandomRef.current = createSnakeRng(snakeSeedRef.current);
        // Start anti-cheat monitoring
        envMonitorRef.current.start();
        try {
          wsRef.current?.close();
          wsRef.current = await connectGameWs(sessionData.token);
          wsRef.current.onDisconnect((reason) => {
            console.error('Snake socket disconnected:', reason);
            gameStateRef.current = 'error';
            setGameState('error');
            frameLoopRef.current?.stop();
          });
        } catch (error) {
          console.warn('Snake realtime channel unavailable; continuing over HTTP.', error);
          wsRef.current = null;
        }
        sessionSuccess = true;
      } else if (sessionResponse.status === 401) {
        // Not signed in — allow a guest/practice run; scores won't be saved.
        sessionTokenRef.current = null;
        const guestSeed = (Math.floor(Math.random() * 0xffffffff)) >>> 0;
        snakeSeedRef.current = guestSeed;
        nextRandomRef.current = createSnakeRng(guestSeed);
        wsRef.current = null;
        isGuestRunRef.current = true;
        sessionSuccess = true;
      } else {
        const data = await sessionResponse.json().catch(() => null);
        console.error('Failed to start game session:', data);
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
      setStartError('Could not reach the server. Try again.');
    } finally {
      isStartingRef.current = false;
      setIsStartingSession(false);
    }

    // Don't start the game if session failed (guest runs pass this gate)
    if (!sessionSuccess || (!sessionTokenRef.current && !isGuestRunRef.current)) {
      setGameState('error');
      return;
    }

    // The score to beat is the stored best. If its request is still out,
    // wait for it (at most 1.5 s) rather than start against 0.
    if (bestLoadRef.current && bestScoreCacheRef.current === null) {
      await Promise.race([
        bestLoadRef.current,
        new Promise<void>((resolve) => setTimeout(resolve, 1500)),
      ]);
    }

    snakeRef.current = [
      { x: 4, y: 9, dx: 1, dy: 0, tx: 4, ty: 9 },
      { x: 3, y: 9, dx: 1, dy: 0, tx: 3, ty: 9 },
      { x: 2, y: 9, dx: 1, dy: 0, tx: 2, ty: 9 },
    ];
    prevSnakeRef.current = snakeRef.current.map((segment) => ({ ...segment }));
    directionRef.current = 'RIGHT';
    directionQueueRef.current = [];
    turnLogRef.current = [];
    foodRef.current = generateFood();
    scoreRef.current = 0;
    tickRateRef.current = INITIAL_TICK_RATE;
    tickCountRef.current = 0;
    bulgeRef.current = null;
    fxRef.current.reset();
    clearGameplayCallouts();
    bestAtRunStartRef.current = Math.max(highScore, bestScoreCacheRef.current ?? 0);
    resetNewBest();
    // Initialize pearls along the starting snake body
    {
      const C = CELL_SIZE;
      const pearlSpacing = C * 0.4 * 0.3; // bodyRadius * 0.3
      const pearls: Array<{ x: number; y: number }> = [];
      const startSnake = snakeRef.current;
      // Walk from head to tail, placing pearls
      for (let si = 0; si < startSnake.length - 1; si++) {
        const ax = startSnake[si].x * C + C / 2;
        const ay = startSnake[si].y * C + C / 2;
        const bx = startSnake[si + 1].x * C + C / 2;
        const by = startSnake[si + 1].y * C + C / 2;
        const segLen = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2);
        const steps = Math.ceil(segLen / pearlSpacing);
        for (let j = 0; j < steps; j++) {
          const t = j / steps;
          pearls.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t });
        }
      }
      // Add final tail point
      const last = startSnake[startSnake.length - 1];
      pearls.push({ x: last.x * C + C / 2, y: last.y * C + C / 2 });
      bodyPearlsRef.current = pearls;
    }
    isPausedRef.current = false;
    lastTickTimeRef.current = performance.now();
    lastFrameTimeRef.current = lastTickTimeRef.current;
    gameStartTimeRef.current = lastTickTimeRef.current;
    interpolationRef.current = 0;
    setScore(0);
    gameStateRef.current = 'playing';
    setGameState('playing');
    appleLadder.reset();

    frameLoopRef.current?.destroy();
    frameLoopRef.current = createGameFrameLoop({
      // Snake owns a dynamic logical tick rate below; the shared runtime owns
      // scheduling, clamping, and lifecycle without quantizing that timer.
      simulate: () => undefined,
      render: (_alpha, frame) => runFrame(frame.nowMs),
      // Preserve the legacy resume behavior: browser-throttled hidden frames
      // feed the same capped catch-up clock when they resume.
      pauseWhenHidden: false,
    });
    frameLoopRef.current.start();

    // The first input is also the first move: an arrow key or a swipe that
    // started the run turns the snake once the run is on.
    const firstTurn = firstDirectionRef.current;
    firstDirectionRef.current = null;
    if (firstTurn) queueDirectionRef.current(firstTurn);
  }, [
    appleLadder,
    clearGameplayCallouts,
    generateFood,
    highScore,
    resetNewBest,
    resetRunResult,
    runFrame,
  ]);

  // Direction queue handler - validates and queues directions instantly
  // Using ref callback for zero-latency input
  const queueDirectionRef = useRef<(newDir: Direction) => void>(() => {});

  queueDirectionRef.current = (newDir: Direction) => {
    if (gameStateRef.current !== 'playing') return;
    // Press first: every turn answers this frame, before any checks.
    triggerRef.current('press', { motion: false });

    // Shared queue contract (validated against last queued, then current).
    const queued = pushDirection(
      directionQueueRef.current,
      directionRef.current,
      newDir,
    );
    if (queued) {
      turnLogRef.current.push([tickCountRef.current, SNAKE_DIRECTION_LETTER[newDir]]);
    }
  };

  const queueDirection = useCallback((newDir: Direction) => {
    queueDirectionRef.current?.(newDir);
  }, []);

  // Use ref for handlers to avoid recreating event listener
  const handleKeyDownRef = useRef<(e: KeyboardEvent) => void>(() => {});

  useEffect(() => {
    handleKeyDownRef.current = (e: KeyboardEvent) => {
      // This listener runs in the capture phase, ahead of the shell's key
      // guard, so it leaves a control's keys (the ? button, a result button)
      // and an open sheet's keys alone itself.
      if (isControlTarget(e.target) || isDialogOpen()) return;
      const key = e.key.toLowerCase();
      if (e.repeat && (key === ' ' || key === 'enter')) {
        return;
      }

      // Always prevent arrow keys from scrolling
      if (
        ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)
      ) {
        e.preventDefault();
      }

      // Space or Enter plays again. After a run it waits out the grace
      // period, so keys still held from the last turn can't skip the result.
      if (key === ' ' || key === 'enter') {
        const state = gameStateRef.current;
        const afterRun = state === 'gameover' || state === 'won';
        if (afterRun && performance.now() - endedAtRef.current < RESTART_GRACE_MS) {
          return;
        }
        if (state === 'idle' || afterRun || state === 'error') {
          startGame();
        }
        return;
      }

      // Arrow keys / WASD start a run from the first frame (the shell
      // normally swallows that press and calls startGame with the turn).
      const isDirectionKey = [
        'arrowup',
        'arrowdown',
        'arrowleft',
        'arrowright',
        'w',
        'a',
        's',
        'd',
      ].includes(key);
      if (isDirectionKey && gameStateRef.current === 'idle') {
        startGame(directionFromKey(key) ?? undefined);
        return;
      }

      if (gameStateRef.current !== 'playing') return;
      // A held key repeats; the turn was already queued by the first press.
      if (e.repeat) return;

      // Map keys to directions and queue immediately
      if (key === 'arrowup' || key === 'w') {
        queueDirection('UP');
      } else if (key === 'arrowdown' || key === 's') {
        queueDirection('DOWN');
      } else if (key === 'arrowleft' || key === 'a') {
        queueDirection('LEFT');
      } else if (key === 'arrowright' || key === 'd') {
        queueDirection('RIGHT');
      }
    };
  }, [startGame, queueDirection]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    handleKeyDownRef.current?.(e);
  }, []);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };

      if (
        gameStateRef.current === 'idle' ||
        gameStateRef.current === 'gameover' ||
        gameStateRef.current === 'won' ||
        gameStateRef.current === 'error'
      ) {
        startGame();
      }
    },
    [startGame],
  );

  // Detect the swipe while the finger is still moving, for a faster turn. A
  // swipe that starts the run is read the same way: the shell swallows the
  // press that starts it, so the turn waits in firstDirectionRef until the
  // session is ready.
  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      // The first touch of a run is swallowed by the shell, so a swipe can
      // begin without a touchstart: track from the first move instead.
      if (!touchStartRef.current) {
        touchStartRef.current = { x: touch.clientX, y: touch.clientY };
        return;
      }
      const state = gameStateRef.current;
      const starting = state === 'idle' && isStartingRef.current;
      if (state !== 'playing' && !starting) return;

      const turn = swipeDirection(
        touch.clientX - touchStartRef.current.x,
        touch.clientY - touchStartRef.current.y,
      );
      if (!turn) return;
      if (state === 'playing') {
        queueDirection(turn);
      } else if (!firstDirectionRef.current) {
        firstDirectionRef.current = turn;
      }

      // Reset touch start to allow chained swipes
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    },
    [queueDirection],
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const start = touchStartRef.current;
      touchStartRef.current = null;
      const state = gameStateRef.current;
      const starting = state === 'idle' && isStartingRef.current;
      if (!start || (state !== 'playing' && !starting)) return;

      const touch = e.changedTouches[0];
      if (!touch) return;
      // Final swipe detection on release
      const turn = swipeDirection(touch.clientX - start.x, touch.clientY - start.y);
      if (!turn) return;
      if (state === 'playing') {
        queueDirection(turn);
      } else if (!firstDirectionRef.current) {
        firstDirectionRef.current = turn;
      }
    },
    [queueDirection],
  );

  // Canvas sizing: the shell's stage reports its screen size and the board
  // fills it (BASE_WIDTH x BASE_HEIGHT logical, scaled to fit). Even pixel
  // sizes keep the grid lines crisp.
  const fitCanvas = useCallback(({ width, height }: GameStageSize) => {
    const snapToEvenPx = (value: number) => {
      const floored = Math.floor(value);
      const even = floored % 2 === 0 ? floored : floored - 1;
      return Math.max(2, even);
    };
    const scale = Math.min(width / BASE_WIDTH, height / BASE_HEIGHT);
    setCanvasSize({
      width: snapToEvenPx(BASE_WIDTH * scale),
      height: snapToEvenPx(BASE_HEIGHT * scale),
    });
  }, []);

  useEffect(() => {
    drawGame(1);
    // Use capture phase for faster response
    window.addEventListener('keydown', handleKeyDown, {
      capture: true,
      passive: false,
    });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [handleKeyDown, drawGame, canvasSize]);

  useEffect(() => {
    return () => {
      frameLoopRef.current?.destroy();
      frameLoopRef.current = null;
    };
  }, []);

  useEffect(() => {
    fetchUserBestScore();
  }, [fetchUserBestScore]);

  // Resolve the live Midway tokens once mounted so the idle/default render
  // is on-theme before the inventory fetch resolves (and on every sub-theme).
  useEffect(() => {
    setSnakeTheme((prev) =>
      prev === DEFAULT_SNAKE_THEME ? resolveMidwaySnakeTheme() : prev,
    );
  }, []);

  useEffect(() => {
    if (!hasLoadedSnakeTheme && gameStateRef.current !== 'playing') {
      void loadSnakeTheme();
      return;
    }
    if (pendingThemeRefresh && gameStateRef.current !== 'playing') {
      void loadSnakeTheme();
    }
  }, [hasLoadedSnakeTheme, loadSnakeTheme, pendingThemeRefresh]);

  useEffect(() => {
    const handleInventoryUpdate = () => {
      if (gameStateRef.current === 'playing') {
        setPendingThemeRefresh(true);
        return;
      }
      void loadSnakeTheme();
    };
    window.addEventListener('store-inventory-updated', handleInventoryUpdate);
    return () => {
      window.removeEventListener(
        'store-inventory-updated',
        handleInventoryUpdate,
      );
    };
  }, [loadSnakeTheme]);

  useEffect(() => {
    const handleVisibility = () => {
      documentHiddenRef.current = document.hidden;
    };
    handleVisibility();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // Reduced motion (from the feel kit) suppresses particle bursts, popups
  // and the flash wash.
  useEffect(() => {
    fxRef.current.reducedMotion = reducedMotion;
  }, [reducedMotion]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setBanNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!banUntilMs) return;
    if (banNowMs >= banUntilMs) {
      setBanUntilMs(null);
      setBanIndefinite(false);
    }
  }, [banNowMs, banUntilMs]);

  useEffect(() => {
    const preventAccidentalSubmit = (event: Event) => {
      const submitEvent = event as SubmitEvent;
      const target = submitEvent.target as HTMLFormElement | null;
      if (!target || target.tagName !== 'FORM') return;
      const action = target.getAttribute('action') ?? '';
      if (action.endsWith('/snake') || action === '/snake') {
        submitEvent.preventDefault();
      }
    };
    window.addEventListener('submit', preventAccidentalSubmit, true);
    return () => {
      window.removeEventListener('submit', preventAccidentalSubmit, true);
    };
  }, []);

  // The shell's phase: the first frame, the run, then the result or an error
  // over the stage.
  const phase: GamePhase =
    gameState === 'idle'
      ? 'ready'
      : gameState === 'gameover' || gameState === 'won' || gameState === 'error'
        ? 'over'
        : 'playing';
  const inRun = phase === 'playing';
  const applesEaten = score / FOOD_SCORE;
  // A run the server turned down didn't change the stored best.
  const isBest = !submitError && isNewBest(score, bestAtRunStartRef.current);

  const result = (title: string, tone: 'neutral' | 'win' | 'best') => (
    <ArcadeRunResult
      title={title}
      tone={tone}
      stats={[
        { label: 'score', value: score, highlight: isBest },
        { label: 'apples', value: applesEaten },
        {
          label: 'top speed',
          value: `${Math.round(tickRateForApples(applesEaten) * 10) / 10}/s`,
        },
      ]}
      reward={runResult.reward}
      achievements={runResult.achievements}
      saving={isSubmitting}
      error={submitError}
      guest={runRewardMessage === GUEST_RUN_MESSAGE}
      actions={<ArcadeRematchButton onClick={() => void startGame()} />}
    />
  );

  const end =
    gameState === 'gameover' ? (
      result(isBest ? 'New best' : 'Run over', isBest ? 'best' : 'neutral')
    ) : gameState === 'won' ? (
      result('Board cleared', 'win')
    ) : gameState === 'error' ? (
      <GameStageNotice
        title={banIndefinite || banUntilMs ? 'Banned from games' : 'Connection lost'}
        action={
          <ArcadeButton
            tone='primary'
            onClick={() => void startGame()}
            disabled={isStartingSession}
          >
            retry
          </ArcadeButton>
        }
      >
        {banIndefinite || banUntilMs ? (
          <p>
            {banIndefinite
              ? 'You are banned until an admin lifts it.'
              : `Ban ends in ${formatBanCountdown(banUntilMs!)}.`}
          </p>
        ) : (
          <p>{startError ?? 'Could not reach the server. Try again.'}</p>
        )}
      </GameStageNotice>
    ) : null;

  return (
    <GameShell
      game='snake'
      // The live score sits in the strip during a run, where it never covers
      // the board; it goes back to your best on the result.
      stat={<GameStat value={inRun ? score : highScore} label={inRun ? 'score' : 'best'} />}
      howTo={HOW_TO}
      tickets={walletBalances.credits}
      below={
        <div className='flex flex-wrap items-center justify-center gap-2'>
          <GameLeaderboardButton onClick={() => setShowLeaderboard(true)} />
          <GameInventoryButton onClick={() => setShowInventory(true)} />
        </div>
      }
    >
      <GameStage
        phase={phase}
        hint={HINT}
        busy={isStartingSession ? 'Starting your run.' : null}
        onStart={(input) => void startGame(directionFromInput(input))}
        startKeys={START_KEYS}
        aspect={BASE_WIDTH / BASE_HEIGHT}
        onSize={fitCanvas}
        end={end}
      >
        <div ref={stageRef} className='absolute inset-0 flex items-center justify-center'>
          <canvas
            ref={canvasRef}
            width={BASE_WIDTH}
            height={BASE_HEIGHT}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            className='cursor-pointer'
            style={{
              width: canvasSize.width,
              height: canvasSize.height,
              touchAction: 'none',
              imageRendering: 'auto',
            }}
          />

          {inRun && <ArcadeGameplayCallouts items={gameplayCallouts} />}
        </div>
      </GameStage>

      <GameLeaderboardModal
        open={showLeaderboard}
        onOpenChange={setShowLeaderboard}
        title='Snake board'
        description='Top runs and your rank.'
      >
        <GameLeaderboard
          gameType='snake'
          maxEntries={5}
          enableFullLeaderboardModal
          fullLeaderboardDisplay='inline'
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>

      <GameInventoryModal
        open={showInventory}
        onOpenChange={setShowInventory}
        gameType='snake'
        title='Snake inventory'
        description='Equip snake body, food, and board visuals.'
      />
    </GameShell>
  );
}
