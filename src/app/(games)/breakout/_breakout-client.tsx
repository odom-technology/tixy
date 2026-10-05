'use client';

import { renameGameNamesInText } from '@/features/arcade/lib/game-renames';
import { useState, useRef, useEffect, useCallback } from 'react';
import { Blocks, CircleHelp } from 'lucide-react';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import { PageHeader, GamesWalletCard } from '@/features/arcade/components/shell/page-header';
import { MuteButton } from '@/features/arcade/components/mute-button';
import { EnvMonitor } from '@/features/arcade/lib/game-anti-cheat';
import { connectGameWs, type GameWsHandle } from '@/features/arcade/lib/game-ws';
import { usePreventGameGestures, useIsTouchDevice } from '@/features/arcade/lib/game-mobile-utils';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { ArcadeRunRewards } from '@/features/arcade/components/results/arcade-run-result';
import { ArcadeGameplayCallouts } from '@/features/arcade/components/gameplay/arcade-game-hud';
import { useArcadeRunResult } from '@/features/arcade/lib/run-result';
import { useGameplayCallouts, useNewBestMoment } from '@/features/arcade/lib/use-gameplay-callouts';
import type { AccountXpReward } from '@/server/arcade/rewards/types';
import {
  BRICK_COLS,
  BRICK_ROWS,
  ROW_POINTS,
  generateBreakoutLevel,
} from './_breakout-shared';
import {
  buildBreakoutTheme,
  resolveBreakoutTheme,
  type BreakoutCosmeticTheme,
  type InventoryCosmeticResponse,
} from './_breakout-theme';
import {
  PHYSICS_DT_MS,
  createGameFrameLoop,
  getGame2dContext,
  gameCanvasDpr,
  lerp,
  type GameFrameLoop,
} from '@/features/arcade/lib/game-frame-loop';

import './_breakout-midway.css';
import {
  drawCanvasCallout,
  readCanvasCalloutLook,
} from '@/features/arcade/components/gameplay/callout-canvas';

// ── Logical playfield (wide cabinet stage). The canvas fills this space;
//    scale + dpr keep the sim coordinates display-independent. ──
const BASE_WIDTH = 800;
const BASE_HEIGHT = 520;
/** Fixed sim rate; paint runs every rAF for 120 Hz panels. */
const FRAME_TIME = PHYSICS_DT_MS;

// Brick grid geometry (within the logical space).
const FIELD_PADDING_X = 40;
const BRICK_TOP = 70;
const BRICK_GAP = 6;
const BRICK_AREA_W = BASE_WIDTH - FIELD_PADDING_X * 2;
const BRICK_W = (BRICK_AREA_W - BRICK_GAP * (BRICK_COLS - 1)) / BRICK_COLS;
const BRICK_H = 24;

// Paddle.
const PADDLE_W = 120;
const PADDLE_H = 16;
const PADDLE_Y = BASE_HEIGHT - 44;
const PADDLE_SPEED = 9; // keyboard px/frame

// Ball.
const BALL_R = 8;
const BALL_BASE_SPEED = 5.4; // px/frame at level 1
const BALL_SPEED_PER_LEVEL = 0.55;
const BALL_MAX_SPEED = 11;

const STARTING_LIVES = 3;
const RESTART_GRACE_PERIOD = 500;

const REWARDS_HINT_TEXT =
  'Rewards hint: clear bricks for points (top rows worth more) and bank a level-clear bonus each level. Tickets taper at higher scores.';

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

type Brick = {
  col: number;
  row: number;
  x: number;
  y: number;
  alive: boolean;
};

// A short-lived visual shard burst when a brick breaks. Render-only — never
// touches the sim. (Midway: a hard flash/shard via opacity + transform, no glow.)
type Shard = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
};

// A single expanding enamel plate-flash centred on a broken brick. Render-only,
// event-driven (one per break) — never touches the sim, no per-frame allocs.
type Flash = {
  x: number;
  y: number;
  life: number;
  color: string;
};

// A floating "+points" popup that rises ~40px and fades over ~700ms where a
// brick broke. Render-only; the array is capped (oldest dropped first).
type Popup = {
  x: number;
  y: number;
  text: string;
  life: number;
};

const MAX_POPUPS = 8;

// Ghost of a lost ball: a brief (~500ms) fade/shrink where it fell. The real
// ball is already reset on the paddle — this is purely the death-beat ceremony.
type GhostBall = {
  x: number;
  y: number;
  life: number;
};

// Deterministic enamel-confetti pieces for the game-over ceremony (module-level
// so the array is stable across renders — no per-render allocation). CSS drives
// the fall; reduced motion hides the whole strip.
const GAMEOVER_CONFETTI = Array.from({ length: 16 }, (_, i) => {
  const palette = ['#c73538', '#2fb8a6', '#f6eddc', '#e8b04b'];
  return {
    left: `${(i * 6.1 + 4) % 96}%`,
    color: palette[i % palette.length]!,
    delay: `${(i % 6) * 90}ms`,
    dur: `${1300 + (i % 5) * 130}ms`,
  };
});

export default function BreakoutClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [gameState, setGameState] = useState<
    'idle' | 'playing' | 'gameover' | 'error'
  >('idle');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const {
    items: gameplayCallouts,
    push: pushGameplayCallout,
    clear: clearGameplayCallouts,
  } = useGameplayCallouts();
  const { check: newBestCheck, reset: resetNewBest } = useNewBestMoment(pushGameplayCallout, { unit: 'points' });
  const [, setLives] = useState(STARTING_LIVES);
  const [level, setLevel] = useState(1);
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
  const [theme, setTheme] = useState<BreakoutCosmeticTheme>(resolveBreakoutTheme);
  const [canvasSize, setCanvasSize] = useState({
    width: BASE_WIDTH,
    height: BASE_HEIGHT,
    dpr: 1,
  });

  usePreventGameGestures(gameState === 'playing');
  const touchDevice = useIsTouchDevice();

  // ── Refs (mutable sim state; no re-render) ──
  const gameStateRef = useRef<'idle' | 'playing' | 'gameover' | 'error'>('idle');
  const sessionTokenRef = useRef<string | null>(null);
  const envMonitorRef = useRef(new EnvMonitor());
  const scoreRef = useRef(0);
  const highScoreRef = useRef(0);
  const nextScoreMilestoneRef = useRef(500);
  const livesRef = useRef(STARTING_LIVES);
  const levelRef = useRef(1);
  const paddleXRef = useRef(BASE_WIDTH / 2 - PADDLE_W / 2);
  const pointerTargetRef = useRef<number | null>(null);
  const keyLeftRef = useRef(false);
  const keyRightRef = useRef(false);
  const ballRef = useRef({ x: BASE_WIDTH / 2, y: PADDLE_Y - BALL_R - 1, vx: 0, vy: 0 });
  // Render-only samples for 120 Hz interpolation between 60 Hz physics steps.
  const prevBallRef = useRef({ x: BASE_WIDTH / 2, y: PADDLE_Y - BALL_R - 1 });
  const prevPaddleXRef = useRef(BASE_WIDTH / 2 - PADDLE_W / 2);
  const displayBallRef = useRef({ x: BASE_WIDTH / 2, y: PADDLE_Y - BALL_R - 1 });
  const displayPaddleXRef = useRef(BASE_WIDTH / 2 - PADDLE_W / 2);
  const ballLaunchedRef = useRef(false);
  const bricksRef = useRef<Brick[]>([]);
  const bricksAliveRef = useRef(0);
  const shardsRef = useRef<Shard[]>([]);
  const flashesRef = useRef<Flash[]>([]);
  // More render-only juice: score popups, paddle-hit squash, screen shake,
  // level banner, lost-ball ghost, and HUD pulses. None of these touch the sim.
  const popupsRef = useRef<Popup[]>([]);
  const paddleHitRef = useRef(0);
  const shakeMagRef = useRef(0);
  const levelBannerRef = useRef<{ level: number; life: number } | null>(null);
  const lostBallRef = useRef<GhostBall | null>(null);
  const scorePulseRef = useRef(0);
  const livesPulseRef = useRef(0);
  // Independent render-only PRNG: screen shake cannot perturb ball launch or
  // guest-session fallback randomness.
  const fxSeedRef = useRef(0x1f123bb5);
  const fxRandom = useCallback(() => {
    let x = fxSeedRef.current | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    fxSeedRef.current = x >>> 0;
    return fxSeedRef.current / 0x100000000;
  }, []);
  const frameLoopRef = useRef<GameFrameLoop | null>(null);
  const scaleRef = useRef(1);
  const gameOverTimeRef = useRef<number>(0);
  const isStartingRef = useRef(false);
  const isGuestRunRef = useRef(false);
  const wsRef = useRef<GameWsHandle | null>(null);
  const gameStartTimeRef = useRef(0);
  const breakoutSeedRef = useRef<number | null>(null);
  const reducedMotionRef = useRef(false);
  const saveScoreRef = useRef<((score: number) => Promise<void>) | null>(null);
  const themeRef = useRef<BreakoutCosmeticTheme>(theme);
  const bestScoreCacheRef = useRef<number | null>(null);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  useEffect(() => {
    highScoreRef.current = highScore;
  }, [highScore]);

  const fetchUserBestScore = useCallback(async () => {
    if (bestScoreCacheRef.current !== null) {
      setHighScore(bestScoreCacheRef.current);
      return;
    }
    try {
      const response = await fetch('/api/games/breakout/score', {
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
      const response = await fetch('/api/store/inventory?gameType=breakout', {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = (await response.json()) as InventoryCosmeticResponse;
      setWalletBalances({ credits: payload.wallet?.credits ?? 0 });
      setDailyCreditsProgress({
        earned: payload.dailyGameCredits?.earned ?? 0,
        cap: payload.dailyGameCredits?.cap ?? 300,
      });
      // Fold any equipped cosmetics onto the token-resolved default look. Empty
      // loadout resolves to the original Midway palette.
      setTheme(buildBreakoutTheme(payload));
    } catch {
      setWalletBalances({ credits: 0 });
      setDailyCreditsProgress({ earned: 0, cap: 300 });
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

  // ── Build the brick grid for a level from the server seed ──
  const buildLevel = useCallback((lvl: number) => {
    const seed = breakoutSeedRef.current ?? 1;
    const grid = generateBreakoutLevel(seed, lvl);
    const bricks: Brick[] = [];
    let alive = 0;
    for (let r = 0; r < BRICK_ROWS; r += 1) {
      for (let c = 0; c < BRICK_COLS; c += 1) {
        if (!grid[r]![c]) continue;
        bricks.push({
          col: c,
          row: r,
          x: FIELD_PADDING_X + c * (BRICK_W + BRICK_GAP),
          y: BRICK_TOP + r * (BRICK_H + BRICK_GAP),
          alive: true,
        });
        alive += 1;
      }
    }
    bricksRef.current = bricks;
    bricksAliveRef.current = alive;
  }, []);

  // ── Reset the ball to rest on the paddle (awaiting launch). Launch speed is
  //    derived from levelRef.current at launch time, so no arg is needed. ──
  const resetBall = useCallback(() => {
    ballRef.current = {
      x: paddleXRef.current + PADDLE_W / 2,
      y: PADDLE_Y - BALL_R - 1,
      vx: 0,
      vy: 0,
    };
    ballLaunchedRef.current = false;
  }, []);

  const announceScoreProgress = useCallback(
    (_previousScore: number, nextScore: number) => {
      if (nextScore >= nextScoreMilestoneRef.current) {
        const reachedMilestone = Math.floor(nextScore / 500) * 500;
        nextScoreMilestoneRef.current = reachedMilestone + 500;
        pushGameplayCallout({
          label: `${reachedMilestone.toLocaleString()} points`,
          detail: 'milestone',
          tone: 'score',
          x: 50,
          y: 20,
          duration: 900,
          announce: `${reachedMilestone.toLocaleString()} point milestone`,
        });
      }

      newBestCheck(nextScore, bestScoreCacheRef.current === null ? null : highScoreRef.current);
    },
    [newBestCheck, pushGameplayCallout],
  );

  const launchBall = useCallback(() => {
    if (ballLaunchedRef.current) return;
    const speed = Math.min(
      BALL_MAX_SPEED,
      BALL_BASE_SPEED + (levelRef.current - 1) * BALL_SPEED_PER_LEVEL,
    );
    // Launch up at a slight angle (toward the side the paddle leans).
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.6;
    ballRef.current.vx = Math.cos(angle) * speed;
    ballRef.current.vy = Math.sin(angle) * speed;
    ballLaunchedRef.current = true;
    SoundManager.play('arcadeBet');
  }, []);

  const saveScore = async (finalScore: number) => {
    if (isGuestRunRef.current) {
      setRunRewardMessage('Guest run — sign in to save scores and earn tickets.');
      setRunAccountXp(null);
      setRunRewardIsCapHit(false);
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
      const response = await fetch('/api/games/breakout/score', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: finalScore,
          sessionToken: sessionTokenRef.current,
          clientDurationMs: Math.max(
            0,
            performance.now() - gameStartTimeRef.current,
          ),
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
        console.error(`[Breakout] Score rejected (${response.status}): ${reason}`);
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

  // ── End the run (death) ──
  const endRun = useCallback(() => {
    SoundManager.play('hit');
    setTimeout(() => SoundManager.play('fall'), 80);
    wsRef.current?.close();
    gameStateRef.current = 'gameover';
    setGameState('gameover');
    frameLoopRef.current?.stop();
    gameOverTimeRef.current = performance.now();
    if (scoreRef.current > highScore) {
      setHighScore(scoreRef.current);
    }
    saveScoreRef.current?.(scoreRef.current);
  }, [highScore]);

  // ── One fixed physics step (kept simple; the SERVER does NOT re-sim this —
  //    the authoritative score is the validated sum of brick/level events). ──
  const stepPhysics = useCallback(() => {
    // Paddle movement (keyboard).
    if (keyLeftRef.current) paddleXRef.current -= PADDLE_SPEED;
    if (keyRightRef.current) paddleXRef.current += PADDLE_SPEED;
    // Pointer drag target.
    if (pointerTargetRef.current !== null) {
      paddleXRef.current = pointerTargetRef.current - PADDLE_W / 2;
    }
    // Clamp paddle.
    paddleXRef.current = Math.max(
      0,
      Math.min(BASE_WIDTH - PADDLE_W, paddleXRef.current),
    );

    const ball = ballRef.current;

    if (!ballLaunchedRef.current) {
      // Ball rides the paddle until launched.
      ball.x = paddleXRef.current + PADDLE_W / 2;
      ball.y = PADDLE_Y - BALL_R - 1;
      return;
    }

    ball.x += ball.vx;
    ball.y += ball.vy;

    // Wall collisions.
    if (ball.x - BALL_R < 0) {
      ball.x = BALL_R;
      ball.vx = Math.abs(ball.vx);
      SoundManager.play('arcadeBounce');
    } else if (ball.x + BALL_R > BASE_WIDTH) {
      ball.x = BASE_WIDTH - BALL_R;
      ball.vx = -Math.abs(ball.vx);
      SoundManager.play('arcadeBounce');
    }
    if (ball.y - BALL_R < 0) {
      ball.y = BALL_R;
      ball.vy = Math.abs(ball.vy);
      SoundManager.play('arcadeBounce');
    }

    // Paddle collision.
    if (
      ball.vy > 0 &&
      ball.y + BALL_R >= PADDLE_Y &&
      ball.y - BALL_R <= PADDLE_Y + PADDLE_H &&
      ball.x >= paddleXRef.current - BALL_R &&
      ball.x <= paddleXRef.current + PADDLE_W + BALL_R
    ) {
      const speed = Math.min(
        BALL_MAX_SPEED,
        BALL_BASE_SPEED + (levelRef.current - 1) * BALL_SPEED_PER_LEVEL,
      );
      // Render-only impact feedback: squash the paddle for a couple of frames
      // and kick a micro screen shake scaled by how hard the ball came down.
      const impact = Math.min(1, Math.abs(ball.vy) / BALL_MAX_SPEED);
      paddleHitRef.current = 1;
      shakeMagRef.current = Math.max(shakeMagRef.current, 2 + impact * 2);
      // Bounce angle depends on where it hit the paddle (-1..1).
      const hit = (ball.x - (paddleXRef.current + PADDLE_W / 2)) / (PADDLE_W / 2);
      const clamped = Math.max(-1, Math.min(1, hit));
      const angle = -Math.PI / 2 + clamped * (Math.PI / 3); // ±60°
      ball.vx = Math.cos(angle) * speed;
      ball.vy = Math.sin(angle) * speed;
      ball.y = PADDLE_Y - BALL_R - 1;
      SoundManager.play('arcadeBounce');
    }

    // Brick collisions — resolve at most one per step (closest by center).
    const bricks = bricksRef.current;
    for (let i = 0; i < bricks.length; i += 1) {
      const brick = bricks[i]!;
      if (!brick.alive) continue;
      if (
        ball.x + BALL_R > brick.x &&
        ball.x - BALL_R < brick.x + BRICK_W &&
        ball.y + BALL_R > brick.y &&
        ball.y - BALL_R < brick.y + BRICK_H
      ) {
        brick.alive = false;
        bricksAliveRef.current -= 1;

        // Decide bounce axis: compare overlap on each axis.
        const overlapX = Math.min(
          ball.x + BALL_R - brick.x,
          brick.x + BRICK_W - (ball.x - BALL_R),
        );
        const overlapY = Math.min(
          ball.y + BALL_R - brick.y,
          brick.y + BRICK_H - (ball.y - BALL_R),
        );
        if (overlapX < overlapY) {
          ball.vx = -ball.vx;
        } else {
          ball.vy = -ball.vy;
        }

        const points = ROW_POINTS[brick.row]!;
        const scoreBeforeBrick = scoreRef.current;
        scoreRef.current += points;
        setScore(scoreRef.current);
        announceScoreProgress(scoreBeforeBrick, scoreRef.current);
        SoundManager.play('score');

        // Floating "+points" popup + score-HUD pulse + a tiny shake scaled by
        // the row's point value (all render-only).
        const cx = brick.x + BRICK_W / 2;
        const cy = brick.y + BRICK_H / 2;
        popupsRef.current.push({ x: cx, y: cy, text: `+${points}`, life: 1 });
        if (popupsRef.current.length > MAX_POPUPS) {
          popupsRef.current.splice(0, popupsRef.current.length - MAX_POPUPS);
        }
        scorePulseRef.current = 1;
        shakeMagRef.current = Math.max(
          shakeMagRef.current,
          0.6 + (points / 70) * 1.4,
        );

        // Visual shard burst (render-only).
        if (!reducedMotionRef.current) {
          const color = themeRef.current.rowFill[brick.row] ?? '#f6eddc';
          flashesRef.current.push({ x: cx, y: cy, life: 1, color });
          for (let s = 0; s < 5; s += 1) {
            shardsRef.current.push({
              x: cx,
              y: cy,
              vx: (Math.random() - 0.5) * 5,
              vy: (Math.random() - 0.5) * 5 - 1,
              life: 1,
              size: 2 + Math.random() * 3,
              color,
            });
          }
        }

        // Authoritative scoring event.
        wsRef.current?.sendEvent('brick', {
          t: Math.max(0, performance.now() - gameStartTimeRef.current),
          points,
        });

        // Level clear?
        if (bricksAliveRef.current <= 0) {
          const clearedLevel = levelRef.current;
          wsRef.current?.sendEvent('level', {
            t: Math.max(0, performance.now() - gameStartTimeRef.current),
            level: clearedLevel,
          });
          // Deterministic level-clear bonus (mirrors server levelClearBonus).
          const scoreBeforeBonus = scoreRef.current;
          scoreRef.current += 100 * clearedLevel;
          setScore(scoreRef.current);
          announceScoreProgress(scoreBeforeBonus, scoreRef.current);
          SoundManager.play('arcadeWin');
          levelRef.current = clearedLevel + 1;
          setLevel(levelRef.current);
          pushGameplayCallout({
            label: `level ${levelRef.current}`,
            detail: `+${(100 * clearedLevel).toLocaleString()} clear bonus`,
            tone: 'success',
            x: 50,
            y: 42,
            duration: 1150,
            announce: `Level ${levelRef.current}`,
          });
          buildLevel(levelRef.current);
          resetBall();
          // Render-only "LEVEL N" banner for the fresh grid (~1.2s).
          levelBannerRef.current = { level: levelRef.current, life: 1 };
        }
        break;
      }
    }

    // Ball lost below the paddle.
    if (ball.y - BALL_R > BASE_HEIGHT) {
      livesRef.current -= 1;
      setLives(livesRef.current);
      if (livesRef.current <= 0) {
        endRun();
        return;
      }
      pushGameplayCallout({
        label: `${livesRef.current} ${livesRef.current === 1 ? 'life' : 'lives'} left`,
        detail: 'ball lost',
        tone: livesRef.current === 1 ? 'danger' : 'warning',
        x: 50,
        y: 72,
        duration: 900,
        announce: `${livesRef.current} ${livesRef.current === 1 ? 'life' : 'lives'} remaining`,
      });
      SoundManager.play('fall');
      // Render-only death beat: a ghost of the ball fades/shrinks where it
      // fell and the lives HUD pops, while the real ball resets instantly.
      lostBallRef.current = {
        x: ball.x,
        y: BASE_HEIGHT - BALL_R * 1.5,
        life: 1,
      };
      livesPulseRef.current = 1;
      shakeMagRef.current = Math.max(shakeMagRef.current, 2.5);
      resetBall();
    }
  }, [announceScoreProgress, buildLevel, endRun, pushGameplayCallout, resetBall]);

  // ── Render (decoupled from sim) ──
  const draw = useCallback((ctx: CanvasRenderingContext2D) => {
    const t = themeRef.current;

    // Screen-shake decay (applied as a translate in the game loop).
    shakeMagRef.current *= 0.85;
    if (shakeMagRef.current < 0.2) shakeMagRef.current = 0;

    // Recessed cabinet screen background.
    const bg = ctx.createLinearGradient(0, 0, 0, BASE_HEIGHT);
    bg.addColorStop(0, t.well);
    bg.addColorStop(1, t.bgBottom);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);

    // Faint side rails (hard bevel framing, no glow).
    ctx.fillStyle = t.accent;
    ctx.fillRect(0, 0, 3, BASE_HEIGHT);
    ctx.fillRect(BASE_WIDTH - 3, 0, 3, BASE_HEIGHT);

    // Bricks — enamel plates with a hard top highlight + offset bottom shadow.
    const bricks = bricksRef.current;
    for (let i = 0; i < bricks.length; i += 1) {
      const brick = bricks[i]!;
      if (!brick.alive) continue;
      const fill = t.rowFill[brick.row] ?? '#c73538';
      const edge = t.rowEdge[brick.row] ?? '#7e2225';
      // Offset shadow plate.
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(brick.x + 2, brick.y + 3, BRICK_W, BRICK_H);
      // Body.
      ctx.fillStyle = fill;
      ctx.fillRect(brick.x, brick.y, BRICK_W, BRICK_H);
      // Hard top highlight strip.
      ctx.fillStyle = 'rgba(255,255,255,0.20)';
      ctx.fillRect(brick.x, brick.y, BRICK_W, 3);
      // Bottom enamel edge.
      ctx.fillStyle = edge;
      ctx.fillRect(brick.x, brick.y + BRICK_H - 3, BRICK_W, 3);
    }

    // Brick plate-flash — a quick expanding, fading enamel square + white core
    // punched out where the brick was. Render-only.
    const flashes = flashesRef.current;
    for (let i = flashes.length - 1; i >= 0; i -= 1) {
      const fl = flashes[i]!;
      fl.life -= 0.12;
      if (fl.life <= 0) {
        flashes.splice(i, 1);
        continue;
      }
      const grow = 1 - fl.life; // 0 → 1 as it expands
      const half = (BRICK_W / 2) * (0.6 + grow * 0.9);
      const halfH = (BRICK_H / 2) * (0.6 + grow * 1.4);
      ctx.globalAlpha = Math.max(0, fl.life) * 0.6;
      ctx.fillStyle = fl.color;
      ctx.fillRect(fl.x - half, fl.y - halfH, half * 2, halfH * 2);
      ctx.globalAlpha = Math.max(0, fl.life) * 0.85;
      ctx.fillStyle = '#fff';
      const ch = half * 0.5;
      const cv = halfH * 0.5;
      ctx.fillRect(fl.x - ch, fl.y - cv, ch * 2, cv * 2);
    }
    ctx.globalAlpha = 1;

    // Brick shards (render-only flash).
    const shards = shardsRef.current;
    for (let i = shards.length - 1; i >= 0; i -= 1) {
      const sh = shards[i]!;
      sh.life -= 0.06;
      sh.x += sh.vx;
      sh.y += sh.vy;
      sh.vy += 0.25;
      if (sh.life <= 0) {
        shards.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = Math.max(0, sh.life);
      ctx.fillStyle = sh.color;
      ctx.fillRect(sh.x - sh.size / 2, sh.y - sh.size / 2, sh.size, sh.size);
    }
    ctx.globalAlpha = 1;

    // Floating score popups: the shared callout plate at the broken brick's
    // spot. Render-only.
    const popups = popupsRef.current;
    for (let i = popups.length - 1; i >= 0; i -= 1) {
      const p = popups[i]!;
      p.life -= 1 / 42;
      if (p.life <= 0) {
        popups.splice(i, 1);
        continue;
      }
      drawCanvasCallout(ctx, readCanvasCalloutLook(ctx.canvas), {
        text: p.text,
        x: p.x,
        y: p.y,
        u: 1 - p.life,
        reducedMotion: reducedMotionRef.current,
        within: { left: 0, top: 0, right: BASE_WIDTH, bottom: BASE_HEIGHT },
      });
    }
    ctx.globalAlpha = 1;

    // Paddle — cream keycap with hard bevel + offset shadow. On a ball hit it
    // squashes for a couple of frames with a quick flash (render-only).
    const hit = reducedMotionRef.current ? 0 : paddleHitRef.current;
    paddleHitRef.current = Math.max(0, paddleHitRef.current - 0.25);
    const squashW = PADDLE_W * (1 + hit * 0.06);
    // High-refresh display sample for the paddle (falls back to sim).
    const paddleDrawX = displayPaddleXRef.current;
    const squashH = PADDLE_H * (1 - hit * 0.35);
    const px = paddleDrawX - (squashW - PADDLE_W) / 2;
    const py = PADDLE_Y + (PADDLE_H - squashH);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(px + 2, py + 3, squashW, squashH);
    // Optional, OFF-by-default paddle glow (paddle-slot cosmetic effect).
    if (t.paddleGlowEnabled) {
      ctx.save();
      ctx.shadowColor = t.paddleGlowColor;
      ctx.shadowBlur = 16;
      ctx.fillStyle = t.paddle;
      ctx.fillRect(px, py, squashW, squashH);
      ctx.restore();
    }
    ctx.fillStyle = t.paddle;
    ctx.fillRect(px, py, squashW, squashH);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(px, py, squashW, 3);
    ctx.fillStyle = t.paddleEdge;
    ctx.fillRect(px, py + squashH - 3, squashW, 3);
    if (hit > 0) {
      ctx.globalAlpha = hit * 0.4;
      ctx.fillStyle = '#fff';
      ctx.fillRect(px, py, squashW, squashH);
      ctx.globalAlpha = 1;
    }

    // Lost-ball ghost (render-only death beat): fades and shrinks where the
    // ball fell while the real ball already rests on the paddle again.
    const ghost = lostBallRef.current;
    if (ghost) {
      ghost.life -= 1 / 30; // ~500ms at 60fps
      if (ghost.life <= 0 || reducedMotionRef.current) {
        lostBallRef.current = null;
      } else {
        ctx.globalAlpha = ghost.life * 0.8;
        ctx.fillStyle = t.ball;
        ctx.beginPath();
        ctx.arc(
          ghost.x,
          ghost.y,
          Math.max(0.5, BALL_R * ghost.life),
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // Ball — cream chip with a hard offset shadow.
    // Prefer display sample (interpolated for high-refresh panels).
    const ballSim = ballRef.current;
    const ball = displayBallRef.current;
    // Optional, OFF-by-default motion trail (ball-slot cosmetic effect): a few
    // fading echoes behind the ball's velocity vector.
    if (t.ballTrailEnabled && ballLaunchedRef.current && !reducedMotionRef.current) {
      ctx.save();
      ctx.fillStyle = t.ball;
      for (let i = 1; i <= 4; i += 1) {
        ctx.globalAlpha = 0.16 * (1 - i / 5);
        ctx.beginPath();
        ctx.arc(ball.x - ballSim.vx * i, ball.y - ballSim.vy * i, BALL_R, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.arc(ball.x + 2, ball.y + 2, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    // Optional, OFF-by-default ball glow (ball-slot cosmetic effect).
    if (t.ballGlowEnabled) {
      ctx.save();
      ctx.shadowColor = t.ballGlowColor;
      ctx.shadowBlur = 18;
      ctx.fillStyle = t.ball;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = t.ball;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.arc(ball.x - 2, ball.y - 2, BALL_R / 2.4, 0, Math.PI * 2);
    ctx.fill();

    // HUD — score (center), lives (left), level (right). Hard offset shadow.
    // Score pulses on brick breaks; the lives chip pops on a ball loss
    // (render-only; static under reduced motion).
    const scorePulse = reducedMotionRef.current ? 0 : scorePulseRef.current;
    scorePulseRef.current = Math.max(0, scorePulseRef.current - 0.08);
    const livesPulse = reducedMotionRef.current ? 0 : livesPulseRef.current;
    livesPulseRef.current = Math.max(0, livesPulseRef.current - 0.06);
    ctx.save();
    ctx.font = `600 ${30 + scorePulse * 7}px var(--font-mono-arcade, 'Spline Sans Mono'), ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = scoreRef.current.toString();
    ctx.fillStyle = 'rgba(8,7,4,0.9)';
    ctx.fillText(text, BASE_WIDTH / 2 + 2, 32);
    ctx.fillStyle = '#f6eddc';
    ctx.fillText(text, BASE_WIDTH / 2, 30);

    ctx.font = `600 ${16 + livesPulse * 5}px var(--font-mono-arcade, 'Spline Sans Mono'), ui-monospace, monospace`;
    ctx.textAlign = 'left';
    ctx.fillStyle = livesPulse > 0.4 ? '#f6eddc' : '#cdbfa6';
    ctx.fillText(`LIVES ${livesRef.current}`, FIELD_PADDING_X, 30);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#cdbfa6';
    ctx.fillText(`LEVEL ${levelRef.current}`, BASE_WIDTH - FIELD_PADDING_X, 30);
    ctx.restore();

    // "LEVEL N" banner — sweeps in and fades over ~1.2s when a fresh grid
    // appears (static fade under reduced motion). Render-only.
    const banner = levelBannerRef.current;
    if (banner) {
      banner.life -= 1 / 72;
      if (banner.life <= 0) {
        levelBannerRef.current = null;
      } else {
        const progress = 1 - banner.life;
        const easeIn = Math.min(1, progress * 4);
        ctx.save();
        ctx.globalAlpha = Math.min(1, banner.life * 2.5, progress * 6);
        ctx.font =
          "700 44px var(--font-mono-arcade, 'Spline Sans Mono'), ui-monospace, monospace";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (!reducedMotionRef.current) {
          const sweep = (1 - easeIn) * -80;
          const scale = 0.8 + easeIn * 0.2;
          ctx.translate(BASE_WIDTH / 2 + sweep, BASE_HEIGHT / 2 - 40);
          ctx.scale(scale, scale);
        } else {
          ctx.translate(BASE_WIDTH / 2, BASE_HEIGHT / 2 - 40);
        }
        const label = `LEVEL ${banner.level}`;
        ctx.fillStyle = 'rgba(8,7,4,0.9)';
        ctx.fillText(label, 3, 3);
        ctx.fillStyle = '#f6eddc';
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    }
  }, []);

  const paintFrame = useCallback(
    (alpha: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas ? getGame2dContext(canvas, { alpha: false }) : null;
      if (!canvas || !ctx) return;
      displayBallRef.current = {
        x: lerp(prevBallRef.current.x, ballRef.current.x, alpha),
        y: lerp(prevBallRef.current.y, ballRef.current.y, alpha),
      };
      displayPaddleXRef.current = lerp(
        prevPaddleXRef.current,
        paddleXRef.current,
        alpha,
      );

      ctx.save();
      ctx.scale(scaleRef.current, scaleRef.current);
      // Micro screen shake (render-only, gated behind reduced motion).
      const shake = reducedMotionRef.current ? 0 : shakeMagRef.current;
      if (shake > 0) {
        ctx.translate(
          (fxRandom() - 0.5) * 2 * shake,
          (fxRandom() - 0.5) * 2 * shake,
        );
      }
      draw(ctx);
      ctx.restore();
    },
    [draw, fxRandom],
  );

  const startGame = useCallback(async () => {
    resetRunResult();
    if (isStartingRef.current) return;
    isStartingRef.current = true;
    isGuestRunRef.current = false;
    sessionTokenRef.current = null;
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
        body: JSON.stringify({ gameType: 'breakout' }),
      });
      if (sessionResponse.ok) {
        setBanIndefinite(false);
        setBanUntilMs(null);
        const sessionData = await sessionResponse.json();
        sessionTokenRef.current = sessionData.token;
        breakoutSeedRef.current =
          typeof sessionData.breakoutSeed === 'number'
            ? sessionData.breakoutSeed
            : null;
        if (breakoutSeedRef.current === null) {
          setGameState('error');
          isStartingRef.current = false;
          setIsStartingSession(false);
          return;
        }
        envMonitorRef.current.start();
        try {
          wsRef.current?.close();
          wsRef.current = await connectGameWs(sessionData.token);
          wsRef.current.onDisconnect((reason) => {
            console.error('Breakout socket disconnected:', reason);
            gameStateRef.current = 'error';
            setGameState('error');
            frameLoopRef.current?.stop();
          });
        } catch (error) {
          console.warn('Breakout realtime channel unavailable; continuing over HTTP.', error);
          wsRef.current = null;
        }
        sessionSuccess = true;
      } else if (sessionResponse.status === 401) {
        sessionTokenRef.current = null;
        breakoutSeedRef.current = Math.floor(Math.random() * 0xffffffff) >>> 0;
        wsRef.current = null;
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
      return;
    }

    frameLoopRef.current?.destroy();
    frameLoopRef.current = null;
    scoreRef.current = 0;
    setScore(0);
    nextScoreMilestoneRef.current = 500;
    resetNewBest();
    clearGameplayCallouts();
    livesRef.current = STARTING_LIVES;
    setLives(STARTING_LIVES);
    levelRef.current = 1;
    setLevel(1);
    paddleXRef.current = BASE_WIDTH / 2 - PADDLE_W / 2;
    pointerTargetRef.current = null;
    keyLeftRef.current = false;
    keyRightRef.current = false;
    shardsRef.current = [];
    flashesRef.current = [];
    popupsRef.current = [];
    paddleHitRef.current = 0;
    shakeMagRef.current = 0;
    levelBannerRef.current = null;
    lostBallRef.current = null;
    scorePulseRef.current = 0;
    livesPulseRef.current = 0;
    buildLevel(1);
    resetBall();
    gameStartTimeRef.current = performance.now();
    gameStateRef.current = 'playing';
    setGameState('playing');
    // Auto-launch shortly so the ball is in motion immediately on play.
    launchBall();

    frameLoopRef.current = createGameFrameLoop({
      stepMs: FRAME_TIME,
      beforeSimulate: () => {
        prevBallRef.current = { x: ballRef.current.x, y: ballRef.current.y };
        prevPaddleXRef.current = paddleXRef.current;
      },
      simulate: () => {
        stepPhysics();
        return gameStateRef.current === 'playing';
      },
      render: (alpha) => paintFrame(alpha),
    });
    frameLoopRef.current.start();
  }, [buildLevel, clearGameplayCallouts, launchBall, paintFrame, resetBall, resetNewBest, resetRunResult, stepPhysics]);

  // ── Generic "primary action": start / launch / restart ──
  const primaryAction = useCallback(() => {
    if (gameStateRef.current === 'playing') {
      launchBall();
    } else if (gameStateRef.current === 'idle') {
      startGame();
    } else if (gameStateRef.current === 'gameover') {
      const since = performance.now() - gameOverTimeRef.current;
      if (since >= RESTART_GRACE_PERIOD) startGame();
    } else if (gameStateRef.current === 'error') {
      startGame();
    }
  }, [launchBall, startGame]);

  // ── Input handlers ──
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        keyLeftRef.current = true;
        if (gameStateRef.current === 'playing') e.preventDefault();
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        keyRightRef.current = true;
        if (gameStateRef.current === 'playing') e.preventDefault();
      } else if (e.code === 'Space' || e.code === 'ArrowUp') {
        if (e.repeat) return;
        e.preventDefault();
        primaryAction();
      }
    },
    [primaryAction],
  );

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') keyLeftRef.current = false;
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') keyRightRef.current = false;
  }, []);

  const pointerXToLogical = useCallback((clientX: number): number => {
    const canvas = canvasRef.current;
    if (!canvas) return BASE_WIDTH / 2;
    const rect = canvas.getBoundingClientRect();
    const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
    return Math.max(0, Math.min(1, ratio)) * BASE_WIDTH;
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (gameStateRef.current === 'playing') {
        pointerTargetRef.current = pointerXToLogical(e.clientX);
        launchBall();
      } else {
        primaryAction();
      }
    },
    [launchBall, pointerXToLogical, primaryAction],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (gameStateRef.current !== 'playing') return;
      // Only steer while a pointer is down (drag) OR a mouse hovers the canvas.
      if (e.pointerType === 'mouse' || e.buttons > 0) {
        pointerTargetRef.current = pointerXToLogical(e.clientX);
      }
    },
    [pointerXToLogical],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') {
      // Touch/pen: stop steering when lifted so keyboard can take over.
      pointerTargetRef.current = null;
    }
  }, []);

  // ── Effects ──
  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  // Reduced-motion preference (decorative shards only).
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

  // Responsive sizing — the canvas fills the wide stage.
  useEffect(() => {
    const updateSize = () => {
      const container = containerRef.current;
      if (!container) return;
      const reservedVertical = window.innerHeight < 700 ? 200 : 260;
      const maxWidth = Math.min(window.innerWidth - 24, 980);
      const maxHeight = Math.min(window.innerHeight - reservedVertical, BASE_HEIGHT);
      const scale = Math.min(maxWidth / BASE_WIDTH, maxHeight / BASE_HEIGHT, 1.25);
      const cssW = Math.floor(BASE_WIDTH * scale);
      const cssH = Math.floor(BASE_HEIGHT * scale);
      const dpr = gameCanvasDpr(cssW, cssH);
      scaleRef.current = scale * dpr;
      setCanvasSize({
        width: cssW,
        height: cssH,
        dpr,
      });
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Initial idle render + key listeners.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      if (bricksRef.current.length === 0 && breakoutSeedRef.current !== null) {
        buildLevel(levelRef.current);
      }
      ctx.save();
      ctx.scale(scaleRef.current, scaleRef.current);
      draw(ctx);
      ctx.restore();
    }
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      frameLoopRef.current?.destroy();
      frameLoopRef.current = null;
    };
  }, [buildLevel, canvasSize, draw, handleKeyDown, handleKeyUp, theme]);

  useEffect(() => {
    fetchUserBestScore();
  }, [fetchUserBestScore]);

  useEffect(() => {
    void loadWallet();
  }, [loadWallet]);

  // Resolve live Midway tokens once mounted so the idle render is on-theme.
  useEffect(() => {
    setTheme(resolveBreakoutTheme());
  }, []);

  // Re-pull theme (and wallet) when a cosmetic is equipped elsewhere.
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

  return (
    <div className="breakout-midway arc-game-flow">
      <div className="w-full space-y-3 sm:space-y-4">
        <div className="mx-auto w-full max-w-5xl">
          <div className="hidden sm:block">
            <PageHeader
              eyebrow="tixy"
              icon="blocks"
              title={renameGameNamesInText('Breakout')}
              subtitle="Clear every brick, climb the levels, push your best run."
              wallet={walletCard}
            />
          </div>
          <div className="sm:hidden">
            <GamesWalletCard wallet={walletCard} compact />
          </div>
        </div>

        <div ref={containerRef} className="relative touch-none flex justify-center">
          <div
            className="breakout-stage relative"
            style={{ width: canvasSize.width, height: canvasSize.height }}
          >
            <canvas
              ref={canvasRef}
              width={Math.floor(canvasSize.width * canvasSize.dpr)}
              height={Math.floor(canvasSize.height * canvasSize.dpr)}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              className="block cursor-pointer rounded-well border-2 border-ink"
              style={{
                touchAction: 'none',
                width: canvasSize.width,
                height: canvasSize.height,
              }}
            />

            {gameState === 'playing' ? (
              <ArcadeGameplayCallouts items={gameplayCallouts} />
            ) : null}

            {gameState !== 'playing' && (
              <div
                className="breakout-overlay absolute inset-0 flex touch-none flex-col items-center justify-center rounded-well px-4"
                style={{
                  background:
                    'color-mix(in srgb, var(--scrim) 78%, transparent)',
                }}
                onPointerDown={handlePointerDown}
              >
                {gameState === 'idle' && (
                  <>
                    <Blocks size={56} className="mb-4 text-tickets-text" />
                    <h1 className="arcade-display mb-2 text-center text-2xl text-strong uppercase sm:text-3xl">
                      {renameGameNamesInText('Breakout')}
                    </h1>
                    <p className="mb-6 text-center text-sm text-strong sm:text-base">
                      {isStartingSession
                        ? 'Starting your run…'
                        : touchDevice
                          ? 'Tap to start — drag to move the paddle'
                          : 'Press Space or click to start'}
                    </p>
                    {isStartingSession && (
                      <p className="mb-4 text-center text-xs text-body sm:text-sm">
                        Connecting to the game…
                      </p>
                    )}
                  </>
                )}

                {gameState === 'gameover' && (
                  <>
                    <div className="breakout-confetti" aria-hidden>
                      {GAMEOVER_CONFETTI.map((c, i) => (
                        <span
                          key={i}
                          style={{
                            left: c.left,
                            background: c.color,
                            animationDelay: c.delay,
                            animationDuration: c.dur,
                          }}
                        />
                      ))}
                    </div>
                    <h2 className="breakout-runover-pop arcade-display mb-2 text-2xl text-strong uppercase sm:text-3xl">
                      Run over
                    </h2>
                    <p
                      className="breakout-line-rise mb-1 text-xl text-strong sm:text-2xl"
                      style={{ animationDelay: '140ms' }}
                    >
                      Score <span className="arcade-num font-semibold">{score}</span>
                    </p>
                    <p
                      className="breakout-line-rise mb-1 text-base text-body sm:text-lg"
                      style={{ animationDelay: '260ms' }}
                    >
                      Reached level <span className="arcade-num">{level}</span>
                    </p>
                    <p
                      className="breakout-line-rise mb-4 text-base text-body sm:text-lg"
                      style={{ animationDelay: '380ms' }}
                    >
                      Best <span className="arcade-num">{highScore}</span>
                    </p>
                    <ArcadeRunRewards reward={runResult.reward} achievements={runResult.achievements} saving={isSubmitting} error={submitError} guest={runRewardMessage?.startsWith('Guest run')} className="mb-4 max-w-xs" />
                    <p className="text-center text-sm text-body sm:text-base">
                      {touchDevice ? 'Tap to play again' : 'Press Space to play again'}
                    </p>
                  </>
                )}

                {gameState === 'error' && (
                  <>
                    <h2 className="arcade-display mb-2 text-2xl text-danger-text uppercase sm:text-3xl">
                      Connection error
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

        <p className="mt-3 text-center text-xs text-faint sm:text-sm">
          {touchDevice ? (
            'Drag to move the paddle'
          ) : (
            <>
              Move with{' '}
              <kbd className="arcade-card-inset px-2 py-1 text-strong">←</kbd>{' '}
              <kbd className="arcade-card-inset px-2 py-1 text-strong">→</kbd> or
              the mouse
            </>
          )}
        </p>

        <div className="mt-4 sm:mt-6 flex flex-col items-center gap-3 sm:gap-4 w-full">
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
        title={renameGameNamesInText('Breakout board')}
        description="Top runs and your rank."
      >
        <GameLeaderboard
          gameType="breakout"
          maxEntries={5}
          enableFullLeaderboardModal
          fullLeaderboardDisplay="inline"
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>
    </div>
  );
}
