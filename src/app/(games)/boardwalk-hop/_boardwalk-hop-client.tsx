'use client';

import { useState, useRef, useEffect, useCallback, type PointerEvent as ReactPointerEvent } from 'react';
import { Rabbit, CircleHelp } from 'lucide-react';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import { PageHeader, GamesWalletCard } from '@/features/arcade/components/shell/page-header';
import { MuteButton } from '@/features/arcade/components/mute-button';
import { EnvMonitor } from '@/features/arcade/lib/game-anti-cheat';
import { usePreventGameGestures, isTouchDevice } from '@/features/arcade/lib/game-mobile-utils';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import {
  beginArcadeInput,
  markArcadeGameReady,
  type ArcadePerformanceSpan,
} from '@/features/arcade/lib/arcade-performance';
import {
  gameCanvasDpr,
  getGame2dContext,
} from '@/features/arcade/lib/game-frame-loop';
import { ArcadeRunRewards } from '@/features/arcade/components/results/arcade-run-result';
import { useArcadeRunResult } from '@/features/arcade/lib/run-result';
import type { AccountXpReward } from '@/server/arcade/rewards/types';
import {
  rowInfo,
  stepHop,
  dwellDeath,
  playerXAt,
  idleLimitMs,
  replayBoardwalkRun,
  COLS,
  START_COL,
  HOP_COOLDOWN_MS,
  CLOSE_CALL_BONUS,
  CLOSE_CALL_STREAK_CAP,
  type BoardwalkHopEvent,
  type HopDir,
  type RowInfo,
  type HazardRow,
  type PlayerPos,
  type DeathCause,
} from '@/server/arcade/boardwalk-hop-replay';
import {
  DEFAULT_BOARDWALK_THEME,
  buildBoardwalkTheme,
  type BoardwalkCosmeticTheme,
  type BoardwalkInventoryResponse,
} from './_boardwalk-hop-theme';

import './_boardwalk-hop.css';

// matter-js is loaded lazily (dynamic import, prefetched at run start) and used
// ONLY for the render-side crash spectacle — never for game logic.
type MatterModule = typeof import('matter-js');

type GameState = 'idle' | 'playing' | 'gameover' | 'error';

// ── Rendering geometry (logical; dpr + scale keep it display-independent) ──
/** Side gutter (tiles) so logs entering/leaving the grid are visible — matches
 *  the EDGE_KEEP rideable margin in the replay module. */
const GUTTER_TILES = 0.75;
const TILE = 52;
const BASE_WIDTH = Math.round((COLS + GUTTER_TILES * 2) * TILE); // 546
const BASE_HEIGHT = 648;
const ROW_H = 58; // screen height of one grid row
const ANCHOR_Y = BASE_HEIGHT * 0.7; // screen y where the player's row sits
const HOP_ANIM_MS = 140; // hop tween length (render only)
const INPUT_BUFFER_MS = 260; // a queued hop is dropped if older than this
const CRASH_SLOWMO = 0.4; // matter debris sim speed during the spectacle
const MAX_PARTICLES = 180;

/** Screen-x (px) of a tile-space position (0 = center of column 0). */
const xPx = (x: number) => (x + 0.5 + GUTTER_TILES) * TILE;

const REWARDS_HINT_TEXT =
  'Rewards hint: hop forward to climb rows — each new row is +1. Squeak past a cart or catch the very end of a log for a close-call bonus, and chain them (up to ×4) for more. Water is a splash-out, riding a log off the edge sweeps you away, and the gull snatches anyone who stalls. Endless and speeds up; rewards taper at higher scores.';

const SFX = {
  start: 'arcadeReveal',
  hop: 'tetrisPieceMove',
  logLand: 'arcadeBounce',
  closeCall: 'coinStreakMilestone',
  collision: 'arcadeExplode',
  drown: 'arcadeCrash',
  swept: 'lose',
  gull: 'gopherEscape',
} as const;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);

// ── Tiny color utils so every derived shade follows the cosmetic theme ──
const hexToRgb = (hex: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
};
const rgbToHex = (r: number, g: number, b: number) =>
  `#${((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1)}`;
/** Mix a toward b by t (0..1). Returns `a` unchanged if either fails to parse. */
const mix = (a: string, b: string, t: number): string => {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  if (!ca || !cb) return a;
  return rgbToHex(lerp(ca[0], cb[0], t), lerp(ca[1], cb[1], t), lerp(ca[2], cb[2], t));
};
const lighten = (c: string, t: number) => mix(c, '#ffffff', t);
const darken = (c: string, t: number) => mix(c, '#000000', t);
const withAlpha = (c: string, a: number): string => {
  const rgb = hexToRgb(c);
  if (!rgb) return c;
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
};

/** Deterministic per-(row, i) jitter for decorative details (knots, sparkles). */
const detailRand = (row: number, i: number): number => {
  let h = (row * 374761393 + i * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
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

// ── Render-only particles ──
type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  decay: number;
  color: string;
  size: number;
  kind: 'dot' | 'droplet' | 'ripple' | 'bubble' | 'feather' | 'text';
  text?: string;
  spin?: number;
  angle?: number;
};

type DeathAnim = {
  cause: DeathCause;
  startT: number; // run-clock ms
  x: number; // tile-space x at death
  row: number;
};

// ── The player mascot's render pose, derived per frame ──
type HopAnim = {
  fromX: number;
  fromRow: number;
  start: number; // run-clock ms; -1 = none
  dir: HopDir;
};

export default function BoardwalkHopClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [gameState, setGameState] = useState<GameState>('idle');
  const [score, setScore] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const [highScore, setHighScore] = useState(0);
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
  const [deathCause, setDeathCause] = useState<DeathCause | null>(null);
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);
  const [canvasSize, setCanvasSize] = useState({ width: BASE_WIDTH, height: BASE_HEIGHT, dpr: 1 });
  // Touch detection is client-only; keep SSR + first client render identical
  // (false) to avoid a hydration mismatch, then resolve after mount.
  const [isTouch, setIsTouch] = useState(false);

  usePreventGameGestures(gameState === 'playing');

  const bestScoreCacheRef = useRef<number | null>(null);
  const gameStateRef = useRef<GameState>('idle');
  const sessionTokenRef = useRef<string | null>(null);
  const seedRef = useRef<number | null>(null);
  const isGuestRunRef = useRef(false);
  const envMonitorRef = useRef(new EnvMonitor());
  const isStartingRef = useRef(false);
  const themeRef = useRef<BoardwalkCosmeticTheme>(DEFAULT_BOARDWALK_THEME);
  const reducedMotionRef = useRef(false);
  const perfLoadStartedAtRef = useRef<number | undefined>(
    typeof window === 'undefined' ? undefined : performance.now(),
  );
  const perfReadyRef = useRef(false);
  const pendingInputSpanRef = useRef<ArcadePerformanceSpan | null>(null);

  // ── Run state (all authoritative-clock values in ms since run start) ──
  const startPerfRef = useRef(0);
  const hopsRef = useRef<BoardwalkHopEvent[]>([]);
  const posRef = useRef<PlayerPos>({ mode: 'ground', row: 0, col: START_COL });
  const furthestRef = useRef(0);
  const scoreRef = useRef(0);
  const closeStreakRef = useRef(0);
  const lastHopTRef = useRef(-Infinity);
  const lastForwardTRef = useRef(0);
  const lastEventTRef = useRef(0); // when the player entered the CURRENT position
  const cameraRowRef = useRef(0); // smooth camera follow (visual)
  const lastDirRef = useRef<HopDir>('U'); // facing (visual)
  const bufferedHopRef = useRef<{ dir: HopDir; at: number } | null>(null);

  // Render-only animation state.
  const animRef = useRef<HopAnim>({ fromX: START_COL, fromRow: 0, start: -1, dir: 'U' });
  const particlesRef = useRef<Particle[]>([]);
  const flashRef = useRef(0); // close-call flash 0..1
  const shakeRef = useRef(0); // death screen shake 0..1
  const deathAnimRef = useRef<DeathAnim | null>(null);

  // Crash spectacle (matter.js — render only) state.
  const matterModRef = useRef<MatterModule | null>(null);
  const crashRef = useRef<{
    engine: import('matter-js').Engine;
    bodies: import('matter-js').Body[];
    colors: string[];
    born: number;
  } | null>(null);

  const animationRef = useRef(0);
  const lastFrameRef = useRef(0);
  const saveScoreRef = useRef<((s: number, hops: BoardwalkHopEvent[], durMs: number) => Promise<void>) | null>(null);
  const endRunRef = useRef<((cause: DeathCause, at?: number) => void) | null>(null);

  // ── Data loads ──
  const fetchUserBestScore = useCallback(async () => {
    if (bestScoreCacheRef.current !== null) {
      setHighScore(bestScoreCacheRef.current);
      return;
    }
    try {
      const response = await fetch('/api/games/boardwalk-hop/score', { cache: 'no-store' });
      if (response.ok) {
        const data = await response.json();
        if (data.bestScore !== undefined) {
          setHighScore(data.bestScore);
          bestScoreCacheRef.current = data.bestScore;
        }
      }
    } catch {
      /* best-effort */
    }
  }, []);

  const loadWallet = useCallback(async () => {
    try {
      const response = await fetch('/api/store/inventory?gameType=boardwalk-hop', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = (await response.json()) as BoardwalkInventoryResponse;
      setWalletBalances({ credits: payload.wallet?.credits ?? 0 });
      setDailyCreditsProgress({
        earned: payload.dailyGameCredits?.earned ?? 0,
        cap: payload.dailyGameCredits?.cap ?? 300,
      });
      themeRef.current = buildBoardwalkTheme(payload);
    } catch {
      /* best-effort */
    }
  }, []);

  useEffect(() => {
    fetchUserBestScore();
    loadWallet();
  }, [fetchUserBestScore, loadWallet]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { reducedMotionRef.current = mq.matches; };
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => { setIsTouch(isTouchDevice()); }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (perfReadyRef.current || !canvasRef.current) return;
      perfReadyRef.current = true;
      markArcadeGameReady('boardwalk-hop', perfLoadStartedAtRef.current, {
        renderer: 'canvas-2d',
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // ── Responsive canvas sizing ──
  useEffect(() => {
    const updateSize = () => {
      const container = containerRef.current;
      const maxW = container ? container.clientWidth : BASE_WIDTH;
      const availH = Math.max(360, window.innerHeight - 260);
      const scale = Math.min(1, maxW / BASE_WIDTH, availH / BASE_HEIGHT);
      const width = Math.floor(BASE_WIDTH * scale);
      const height = Math.floor(BASE_HEIGHT * scale);
      const dpr = gameCanvasDpr(width, height);
      setCanvasSize({ width, height, dpr });
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // ── Submit ──
  const saveScore = async (finalScore: number, hops: BoardwalkHopEvent[], durationMs: number) => {
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
      const response = await fetch('/api/games/boardwalk-hop/score', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: finalScore,
          sessionToken: sessionTokenRef.current,
          hops,
          clientDurationMs: Math.max(0, durationMs),
          env: envMonitorRef.current.getFingerprint(),
        }),
      });
      const rawText = await response.text();
      let data: Record<string, unknown> | null = null;
      try { data = rawText ? JSON.parse(rawText) : null; } catch { data = null; }
      if (!response.ok) {
        const errData = data as { error?: string; details?: string; retryAfterSec?: number } | null;
        const reason = errData?.details || errData?.error || `HTTP ${response.status}`;
        console.error(`[BoardwalkHop] Score rejected (${response.status}): ${reason}`);
        setSubmitError(getSubmitErrorMessage(response.status, errData));
        return;
      }
      captureRunResult(data);
      const reward = data?.reward as
        | { awardedCredits?: number; wantedCredits?: number; capRemaining?: number; earnedTodayTotal?: number; balanceAfter?: number; account?: AccountXpReward }
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
            : Math.max(0, prev.credits + (Number.isFinite(awardedCredits) ? Math.max(0, awardedCredits) : 0)),
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
        if (Number.isFinite(Number(reward.earnedTodayTotal)) && Number.isFinite(Number(reward.capRemaining))) {
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

  // ── Death spectacle helpers (render only) ──
  const spawnCrashDebris = useCallback((xTile: number, row: number) => {
    const M = matterModRef.current;
    if (!M || reducedMotionRef.current) return;
    const th = themeRef.current;
    const cx = xPx(xTile);
    const cy = ANCHOR_Y - (row - cameraRowRef.current) * ROW_H - ROW_H * 0.42;
    const engine = M.Engine.create();
    engine.gravity.y = 1;
    const floor = M.Bodies.rectangle(cx, cy + ROW_H * 0.55, BASE_WIDTH * 2, 20, { isStatic: true });
    const bodies: import('matter-js').Body[] = [];
    const colors: string[] = [];
    const palette = [th.cartBody, th.cartShade, th.hopperBody, th.hopperBelly, lighten(th.cartBody, 0.4)];
    for (let i = 0; i < 12; i += 1) {
      const w = 5 + detailRand(row, i) * 9;
      const h = 4 + detailRand(row, i + 40) * 7;
      const b = M.Bodies.rectangle(cx + (detailRand(row, i + 80) - 0.5) * 20, cy + (detailRand(row, i + 120) - 0.5) * 14, w, h, {
        restitution: 0.55,
        frictionAir: 0.02,
      });
      const a = detailRand(row, i + 160) * Math.PI * 2;
      const sp = 4 + detailRand(row, i + 200) * 7;
      M.Body.setVelocity(b, { x: Math.cos(a) * sp, y: -Math.abs(Math.sin(a)) * sp - 3 });
      M.Body.setAngularVelocity(b, (detailRand(row, i + 240) - 0.5) * 0.5);
      bodies.push(b);
      colors.push(palette[i % palette.length]);
    }
    M.Composite.add(engine.world, [floor, ...bodies]);
    crashRef.current = { engine, bodies, colors, born: performance.now() };
  }, []);

  const endRun = useCallback((cause: DeathCause, at?: number) => {
    if (gameStateRef.current !== 'playing') return;
    const durationMs = performance.now() - startPerfRef.current;
    const t = at ?? durationMs;
    const seed = seedRef.current ?? 0;
    gameStateRef.current = 'gameover';
    setGameState('gameover');
    setDeathCause(cause);

    const x = playerXAt(seed, posRef.current, t);
    deathAnimRef.current = { cause, startT: t, x, row: posRef.current.row };
    shakeRef.current = cause === 'collision' ? 1 : 0.5;

    const th = themeRef.current;
    if (cause === 'collision') {
      SoundManager.play(SFX.collision);
      spawnCrashDebris(x, posRef.current.row);
      spawnBurst(particlesRef.current, reducedMotionRef.current, x, posRef.current.row, cameraRowRef.current, th.cartBody, 'dot');
      spawnBurst(particlesRef.current, reducedMotionRef.current, x, posRef.current.row, cameraRowRef.current, th.hopperBelly, 'feather');
    } else if (cause === 'drown') {
      SoundManager.play(SFX.drown);
      spawnSplashRing(particlesRef.current, reducedMotionRef.current, x, posRef.current.row, cameraRowRef.current, th);
    } else if (cause === 'swept') {
      SoundManager.play(SFX.swept);
      spawnSplashRing(particlesRef.current, reducedMotionRef.current, x, posRef.current.row, cameraRowRef.current, th);
    } else {
      SoundManager.play(SFX.gull);
      spawnBurst(particlesRef.current, reducedMotionRef.current, x, posRef.current.row, cameraRowRef.current, th.hopperBelly, 'feather');
    }

    // AUTHORITATIVE score: recompute from the recorded hops with the shared
    // replay module — guarantees the number we submit equals the server's.
    const result = replayBoardwalkRun(hopsRef.current.slice(), durationMs, seed);
    const finalScore = result.score;
    scoreRef.current = finalScore;
    setScore(finalScore);
    setFurthest(result.furthest);
    if (finalScore > highScore) setHighScore(finalScore);
    saveScoreRef.current?.(finalScore, hopsRef.current.slice(), durationMs);
  }, [highScore, spawnCrashDebris]);
  endRunRef.current = endRun;

  // ── Hop input (the ONE place a move is accepted + recorded) ──
  const doHop = useCallback((dir: HopDir, atOverride?: number) => {
    if (gameStateRef.current !== 'playing') return;
    const seed = seedRef.current ?? 0;
    const t = atOverride ?? performance.now() - startPerfRef.current;

    // Cadence floor: buffer one input during the cooldown so rapid play feels
    // responsive; the buffered hop is released by the frame loop at the exact
    // cooldown boundary (a legal, honest timestamp).
    if (lastHopTRef.current !== -Infinity && t - lastHopTRef.current < HOP_COOLDOWN_MS) {
      bufferedHopRef.current = { dir, at: t };
      return;
    }

    // Mirror the replay's pre-hop checks: if the current dwell (or the idle
    // gull) should already have killed us, die instead of accepting the hop —
    // this keeps the client's judgement byte-identical to the server replay.
    const dwell = dwellDeath(seed, posRef.current, lastEventTRef.current, t);
    if (dwell) {
      endRunRef.current?.(dwell.cause, dwell.t);
      return;
    }
    if (t - lastForwardTRef.current > idleLimitMs(furthestRef.current)) {
      endRunRef.current?.('gull', t);
      return;
    }

    const out = stepHop(seed, posRef.current, dir, t);
    if (!out.ok) return; // off-grid: ignored, never recorded

    // Accept + record.
    pendingInputSpanRef.current?.cancel();
    pendingInputSpanRef.current = beginArcadeInput('boardwalk-hop:hop', {
      direction: dir,
      buffered: atOverride !== undefined,
    });
    hopsRef.current.push({ dir, t });
    lastHopTRef.current = t;
    lastDirRef.current = dir;

    const fromX = playerXAt(seed, posRef.current, t);
    animRef.current = { fromX, fromRow: posRef.current.row, start: t, dir };

    posRef.current = out.pos;
    lastEventTRef.current = t;

    const th = themeRef.current;
    if (out.died) {
      endRunRef.current?.(out.died, t);
      return;
    }

    const dest = rowInfo(seed, out.pos.row);
    if (out.pos.mode === 'riding') {
      SoundManager.play(SFX.logLand);
      spawnSplashRing(particlesRef.current, reducedMotionRef.current, playerXAt(seed, out.pos, t), out.pos.row, cameraRowRef.current, th, 0.5);
    } else if (dest.kind !== 'flume') {
      SoundManager.play(SFX.hop);
      spawnDust(particlesRef.current, reducedMotionRef.current, playerXAt(seed, out.pos, t), out.pos.row, cameraRowRef.current, th);
    }

    // Scoring — only a NEW furthest row scores (mirrors the replay exactly).
    if (out.pos.row > furthestRef.current) {
      furthestRef.current = out.pos.row;
      lastForwardTRef.current = t;
      let pts = 1;
      if (out.closeCall) {
        closeStreakRef.current += 1;
        pts += CLOSE_CALL_BONUS * Math.min(closeStreakRef.current, CLOSE_CALL_STREAK_CAP);
        flashRef.current = 1;
        SoundManager.play(SFX.closeCall);
        spawnBurst(particlesRef.current, reducedMotionRef.current, playerXAt(seed, out.pos, t), out.pos.row, cameraRowRef.current, th.accent, 'dot');
      } else {
        closeStreakRef.current = 0;
      }
      scoreRef.current += pts;
      setScore(scoreRef.current);
      setFurthest(out.pos.row);
      spawnScorePop(particlesRef.current, reducedMotionRef.current, playerXAt(seed, out.pos, t), out.pos.row, cameraRowRef.current, th, pts);
    }
  }, []);

  // ── Input wiring ──
  const pointerStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const handlePointerDown = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (gameStateRef.current !== 'playing') return;
    pointerStartRef.current = { x: e.clientX, y: e.clientY, t: performance.now() };
  }, []);
  const handlePointerUp = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (gameStateRef.current !== 'playing') return;
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    const SWIPE = 24;
    if (adx < SWIPE && ady < SWIPE) {
      doHop('U'); // tap = hop forward
    } else if (adx > ady) {
      doHop(dx > 0 ? 'R' : 'L');
    } else {
      doHop(dy > 0 ? 'D' : 'U');
    }
  }, [doHop]);

  const handlePrimaryAction = useCallback(() => {
    const s = gameStateRef.current;
    if (s === 'playing') return;
    if (s === 'idle' || s === 'gameover' || s === 'error') startGameRef.current?.();
  }, []);

  const startGameRef = useRef<(() => void) | null>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const k = e.key;
    if (gameStateRef.current === 'playing') {
      if (k === 'ArrowUp' || k === 'w' || k === 'W') { e.preventDefault(); doHop('U'); }
      else if (k === 'ArrowDown' || k === 's' || k === 'S') { e.preventDefault(); doHop('D'); }
      else if (k === 'ArrowLeft' || k === 'a' || k === 'A') { e.preventDefault(); doHop('L'); }
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') { e.preventDefault(); doHop('R'); }
    } else if (k === ' ' || k === 'Enter') {
      e.preventDefault();
      handlePrimaryAction();
    }
  }, [doHop, handlePrimaryAction]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // ── Game loop ──
  const gameLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = getGame2dContext(canvas, { alpha: false });
    if (!ctx) return;
    const now = performance.now();
    const dt = Math.min(48, now - lastFrameRef.current);
    lastFrameRef.current = now;
    const t = now - startPerfRef.current;
    const seed = seedRef.current ?? 0;

    if (gameStateRef.current === 'playing') {
      // Release a buffered hop the moment the cooldown expires.
      const buf = bufferedHopRef.current;
      if (buf) {
        const readyAt = lastHopTRef.current + HOP_COOLDOWN_MS;
        if (t - buf.at > INPUT_BUFFER_MS) {
          bufferedHopRef.current = null;
        } else if (t >= readyAt) {
          bufferedHopRef.current = null;
          doHop(buf.dir, Math.max(readyAt, buf.at));
        }
      }

      // ── Death checks (mirror the replay exactly, at analytic times) ──
      const dwell = dwellDeath(seed, posRef.current, lastEventTRef.current, t);
      if (dwell && dwell.t <= t) {
        endRunRef.current?.(dwell.cause, dwell.t);
      } else if (t - lastForwardTRef.current > idleLimitMs(furthestRef.current)) {
        endRunRef.current?.('gull', t);
      }
    }

    // Smooth camera follow.
    cameraRowRef.current = lerp(cameraRowRef.current, posRef.current.row, Math.min(1, dt / 140));
    if (flashRef.current > 0) flashRef.current = Math.max(0, flashRef.current - dt / 260);
    if (shakeRef.current > 0) shakeRef.current = Math.max(0, shakeRef.current - dt / 420);

    // Advance the crash debris sim (slow-mo while fresh).
    const crash = crashRef.current;
    if (crash && matterModRef.current) {
      const age = now - crash.born;
      if (age > 2600) {
        matterModRef.current.Engine.clear(crash.engine);
        crashRef.current = null;
      } else {
        const speed = age < 900 ? CRASH_SLOWMO : 1;
        matterModRef.current.Engine.update(crash.engine, Math.max(1, dt * speed));
      }
    }

    if (particlesRef.current.length > MAX_PARTICLES) {
      particlesRef.current.splice(0, particlesRef.current.length - MAX_PARTICLES);
    }

    drawScene(ctx, {
      t,
      now,
      seed,
      dt,
      th: themeRef.current,
      cw: canvasSizeRef.current.width,
      chh: canvasSizeRef.current.height,
      dpr: canvasSizeRef.current.dpr,
      cameraRow: cameraRowRef.current,
      flash: flashRef.current,
      shake: shakeRef.current,
      particles: particlesRef.current,
      reduced: reducedMotionRef.current,
      playing: gameStateRef.current === 'playing',
      pos: posRef.current,
      anim: animRef.current,
      facing: lastDirRef.current,
      idleFrac:
        gameStateRef.current === 'playing'
          ? clamp((t - lastForwardTRef.current) / idleLimitMs(furthestRef.current), 0, 1)
          : 0,
      closeStreak: closeStreakRef.current,
      death: deathAnimRef.current,
      crash: crashRef.current,
    });

    const pendingInput = pendingInputSpanRef.current;
    if (pendingInput) {
      pendingInputSpanRef.current = null;
      pendingInput.end({ response: 'canvas-frame' });
    }

    const death = deathAnimRef.current;
    const deathAnimating = Boolean(death && t - death.startT < 1200);
    if (
      gameStateRef.current === 'playing' ||
      crashRef.current !== null ||
      particlesRef.current.length > 0 ||
      deathAnimating ||
      flashRef.current > 0.01 ||
      shakeRef.current > 0.01
    ) {
      animationRef.current = requestAnimationFrame(gameLoop);
    }
  }, [doHop]);

  const canvasSizeRef = useRef(canvasSize);
  useEffect(() => { canvasSizeRef.current = canvasSize; }, [canvasSize]);

  // ── Start ──
  const startGame = useCallback(async () => {
    resetRunResult();
    if (isStartingRef.current) return;
    isStartingRef.current = true;
    isGuestRunRef.current = false;
    sessionTokenRef.current = null;
    seedRef.current = null;
    setStartError(null);
    setSubmitError(null);
    setRunRewardMessage(null);
    setRunAccountXp(null);
    setDeathCause(null);
    setIsStartingSession(true);

    // Prefetch matter.js for the crash spectacle (non-blocking; the crash
    // falls back to plain particles if it never loads).
    if (!matterModRef.current) {
      import('matter-js')
        .then((m) => {
          matterModRef.current = (m as { default?: MatterModule }).default ?? (m as MatterModule);
        })
        .catch(() => {});
    }

    let sessionSuccess = false;
    try {
      const sessionResponse = await fetch('/api/games/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameType: 'boardwalk-hop' }),
      });
      const data = await sessionResponse.json();
      if (sessionResponse.ok && data?.token) {
        sessionTokenRef.current = data.token;
        seedRef.current = typeof data.boardwalkSeed === 'number' ? data.boardwalkSeed : null;
        if (seedRef.current === null) {
          setStartError('The game could not start a valid session.');
        } else {
          sessionSuccess = true;
        }
      } else if (sessionResponse.status === 401) {
        // Guest fallback — play locally, scores not saved.
        sessionTokenRef.current = null;
        seedRef.current = Math.floor(Math.random() * 0x7fffffff) >>> 0;
        isGuestRunRef.current = true;
        sessionSuccess = true;
      } else {
        setStartError(getSubmitErrorMessage(sessionResponse.status, data));
      }
    } catch {
      setStartError('The game could not reach the server.');
    } finally {
      setIsStartingSession(false);
      isStartingRef.current = false;
    }

    if (!sessionSuccess || (!sessionTokenRef.current && !isGuestRunRef.current)) {
      gameStateRef.current = 'error';
      setGameState('error');
      return;
    }

    // Reset run state.
    hopsRef.current = [];
    posRef.current = { mode: 'ground', row: 0, col: START_COL };
    furthestRef.current = 0;
    scoreRef.current = 0;
    closeStreakRef.current = 0;
    lastHopTRef.current = -Infinity;
    lastForwardTRef.current = 0;
    lastEventTRef.current = 0;
    cameraRowRef.current = 0;
    lastDirRef.current = 'U';
    bufferedHopRef.current = null;
    animRef.current = { fromX: START_COL, fromRow: 0, start: -1, dir: 'U' };
    particlesRef.current = [];
    flashRef.current = 0;
    shakeRef.current = 0;
    deathAnimRef.current = null;
    if (crashRef.current && matterModRef.current) {
      matterModRef.current.Engine.clear(crashRef.current.engine);
    }
    crashRef.current = null;
    setScore(0);
    setFurthest(0);

    envMonitorRef.current = new EnvMonitor();
    envMonitorRef.current.start();
    startPerfRef.current = performance.now();
    lastFrameRef.current = startPerfRef.current;
    gameStateRef.current = 'playing';
    setGameState('playing');
    SoundManager.play(SFX.start);
    cancelAnimationFrame(animationRef.current);
    animationRef.current = requestAnimationFrame(gameLoop);
  }, [gameLoop, resetRunResult]);
  startGameRef.current = startGame;

  useEffect(
    () => () => {
      cancelAnimationFrame(animationRef.current);
      pendingInputSpanRef.current?.cancel();
      pendingInputSpanRef.current = null;
    },
    [],
  );

  const walletCard = {
    credits: walletBalances.credits,
    progress: { label: 'Daily tickets', current: dailyCreditsProgress.earned, max: dailyCreditsProgress.cap },
  };

  const isPlaying = gameState === 'playing';

  const DEATH_HEADLINES: Record<DeathCause, string> = {
    collision: 'Splat!',
    drown: 'Splash!',
    swept: 'Swept away!',
    gull: 'Snatched!',
  };
  const DEATH_BLURBS: Record<DeathCause, string> = {
    collision: 'A carnival cart got you.',
    drown: 'Missed the log — straight into the flume.',
    swept: 'The log carried you off the boardwalk.',
    gull: 'You stalled too long and the gull swooped.',
  };

  return (
    <div className="bh-midway arc-game-flow">
      <div className="w-full space-y-3 sm:space-y-4">
        <div className="mx-auto w-full max-w-5xl">
          <div className="hidden sm:block">
            <PageHeader
              eyebrow="Arcade"
              icon={<Rabbit aria-hidden className="h-6 w-6" />}
              title="Boardwalk Hop"
              subtitle="Hop the carnival boardwalk row by row — dodge the carts, ride the flume logs, and keep moving before the gull swoops. Catch a log by its very end for close-call bonuses."
              wallet={walletCard}
            />
          </div>
          <div className="sm:hidden">
            <GamesWalletCard wallet={walletCard} compact />
          </div>
        </div>

        <div ref={containerRef} className="relative flex w-full justify-center">
          <div className="bh-stage relative" style={{ width: canvasSize.width }}>
            <div className="bh-hud">
              <span className="bh-hud-stat">Score <b>{score}</b></span>
              <span className="bh-hud-stat">Row <b>{furthest}</b></span>
              <span className="bh-hud-stat">Best <b>{highScore}</b></span>
            </div>

            <div className="bh-field">
              <canvas
                ref={canvasRef}
                className="bh-canvas"
                width={Math.floor(canvasSize.width * canvasSize.dpr)}
                height={Math.floor(canvasSize.height * canvasSize.dpr)}
                style={{ width: canvasSize.width, height: canvasSize.height, touchAction: 'none' }}
                onPointerDown={handlePointerDown}
                onPointerUp={handlePointerUp}
                aria-label="Boardwalk Hop grid"
              />

              {!isPlaying && (
                <div
                  className="bh-overlay absolute inset-0 flex touch-none flex-col items-center justify-center rounded-well px-4"
                  style={{ background: 'color-mix(in srgb, var(--scrim) 80%, transparent)' }}
                  onPointerDown={(e) => { e.preventDefault(); handlePrimaryAction(); }}
                >
                  {gameState === 'idle' && (
                    <>
                      <Rabbit size={56} className="mb-4 text-tickets-text" />
                      <h1 className="arcade-display mb-2 text-center text-2xl text-strong uppercase sm:text-3xl">Boardwalk Hop</h1>
                      <p className="mb-2 text-center text-sm text-strong sm:text-base">
                        {isStartingSession ? 'Starting your run…' : isTouch ? 'Tap to start' : 'Press Space or click to start'}
                      </p>
                      <p className="max-w-xs text-center text-xs text-body sm:text-sm">
                        Tap to hop forward, swipe to dodge. Cross the cart roads on foot and the water by riding the logs — the water itself is a splash-out, and a log will carry you while you stand on it. Keep moving: the gull snatches stragglers.
                      </p>
                    </>
                  )}

                  {gameState === 'gameover' && (
                    <>
                      <h2 className="arcade-display mb-1 text-2xl text-strong uppercase sm:text-3xl">
                        {deathCause ? DEATH_HEADLINES[deathCause] : 'Splat!'}
                      </h2>
                      <p className="mb-2 text-center text-xs text-body sm:text-sm">
                        {deathCause ? DEATH_BLURBS[deathCause] : ''}
                      </p>
                      <p className="mb-1 text-xl text-strong sm:text-2xl">Score <span className="arcade-num font-semibold">{score}</span></p>
                      <p className="mb-4 text-base text-body sm:text-lg">
                        Reached row <span className="arcade-num">{furthest}</span> · Best <span className="arcade-num">{highScore}</span>
                      </p>
                      <ArcadeRunRewards reward={runResult.reward} achievements={runResult.achievements} saving={isSubmitting} error={submitError} guest={runRewardMessage?.startsWith('Guest run')} className="mb-4 max-w-xs" />
                      <p className="text-center text-sm text-body sm:text-base">{isTouch ? 'Tap to play again' : 'Press Space to play again'}</p>
                    </>
                  )}

                  {gameState === 'error' && (
                    <>
                      <h2 className="arcade-display mb-2 text-2xl text-danger-text uppercase sm:text-3xl">Could not start</h2>
                      <p className="mb-4 text-center text-sm text-strong sm:text-base">{startError ?? 'The game could not reach the server.'}</p>
                      <p className="text-center text-sm text-body sm:text-base">Tap or press Space to retry</p>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <p className="mt-3 text-center text-xs text-faint sm:text-sm">
          {isTouch ? (
            'Tap to hop · swipe to dodge · logs carry you'
          ) : (
            <>
              Hop with{' '}
              <kbd className="arcade-card-inset px-2 py-1 text-strong">W</kbd>
              <kbd className="arcade-card-inset px-2 py-1 text-strong">A</kbd>
              <kbd className="arcade-card-inset px-2 py-1 text-strong">S</kbd>
              <kbd className="arcade-card-inset px-2 py-1 text-strong">D</kbd> or the arrow keys · logs carry you
            </>
          )}
        </p>

        <div className="mt-2 flex flex-col items-center gap-3 sm:mt-4 sm:gap-4">
          <div className="flex w-full flex-wrap items-center justify-center gap-2 pb-1 sm:gap-4">
            <GameLeaderboardButton
              onClick={(e) => { e.stopPropagation(); setShowLeaderboard(true); }}
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
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowRewardsHint((p) => !p); }}
              >
                <CircleHelp size={18} />
              </ArcadeButton>
              <span
                className={`pointer-events-none absolute right-0 bottom-full z-20 mb-2 w-[calc(100vw-2rem)] max-w-sm arcade-card-inset px-3 py-2 text-left text-xs leading-relaxed text-body transition-opacity duration-150 sm:w-80 ${
                  showRewardsHint ? 'opacity-100' : 'opacity-0 peer-hover:opacity-100 peer-focus:opacity-100'
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
        title="Boardwalk Hop board"
        description="Furthest hop + close-call bonuses, and your rank."
      >
        <GameLeaderboard
          gameType="boardwalk-hop"
          maxEntries={5}
          enableFullLeaderboardModal
          fullLeaderboardDisplay="inline"
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// ── Particle spawners (render only) ─────────────────────────────────────────

const rowScreenY = (row: number, cameraRow: number) => ANCHOR_Y - (row - cameraRow) * ROW_H;

function spawnBurst(
  particles: Particle[],
  reduced: boolean,
  x: number,
  row: number,
  cameraRow: number,
  color: string,
  kind: 'dot' | 'feather',
) {
  if (reduced) return;
  const y = rowScreenY(row, cameraRow) - ROW_H * 0.4;
  const n = kind === 'feather' ? 6 : 10;
  for (let i = 0; i < n; i += 1) {
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.5;
    const sp = kind === 'feather' ? 30 + Math.random() * 60 : 60 + Math.random() * 130;
    particles.push({
      x: xPx(x),
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - (kind === 'feather' ? 20 : 50),
      life: 1,
      decay: kind === 'feather' ? 900 : 520,
      color,
      size: kind === 'feather' ? 5 + Math.random() * 3 : 3 + Math.random() * 3,
      kind: kind === 'feather' ? 'feather' : 'dot',
      spin: (Math.random() - 0.5) * 6,
      angle: Math.random() * Math.PI * 2,
    });
  }
}

function spawnDust(
  particles: Particle[],
  reduced: boolean,
  x: number,
  row: number,
  cameraRow: number,
  th: BoardwalkCosmeticTheme,
) {
  if (reduced) return;
  const y = rowScreenY(row, cameraRow) - 8;
  for (let i = 0; i < 4; i += 1) {
    const a = Math.PI + (Math.random() - 0.5) * 1.6;
    particles.push({
      x: xPx(x) + (Math.random() - 0.5) * 14,
      y,
      vx: Math.cos(a) * 20,
      vy: -12 - Math.random() * 18,
      life: 0.7,
      decay: 380,
      color: withAlpha(lighten(th.plankLight, 0.3), 0.8),
      size: 2.5 + Math.random() * 2.5,
      kind: 'dot',
    });
  }
}

function spawnSplashRing(
  particles: Particle[],
  reduced: boolean,
  x: number,
  row: number,
  cameraRow: number,
  th: BoardwalkCosmeticTheme,
  scale = 1,
) {
  if (reduced) return;
  const y = rowScreenY(row, cameraRow) - ROW_H * 0.3;
  const splashColor = lighten(th.flumeTop, 0.55);
  particles.push({
    x: xPx(x), y, vx: 0, vy: 0, life: 1, decay: 460 / scale,
    color: withAlpha(splashColor, 0.9), size: 8 * scale, kind: 'ripple',
  });
  const n = Math.round(8 * scale);
  for (let i = 0; i < n; i += 1) {
    const a = -Math.PI * (0.15 + Math.random() * 0.7);
    const sp = (50 + Math.random() * 110) * scale;
    particles.push({
      x: xPx(x) + (Math.random() - 0.5) * 16,
      y,
      vx: Math.cos(a) * sp * 0.6,
      vy: Math.sin(a) * sp,
      life: 1,
      decay: 520,
      color: splashColor,
      size: 2.5 + Math.random() * 3,
      kind: 'droplet',
    });
  }
}

function spawnDrownBubbles(
  particles: Particle[],
  reduced: boolean,
  xp: number,
  y: number,
  th: BoardwalkCosmeticTheme,
) {
  if (reduced) return;
  for (let i = 0; i < 2; i += 1) {
    particles.push({
      x: xp + (Math.random() - 0.5) * 18,
      y: y + Math.random() * 8,
      vx: (Math.random() - 0.5) * 8,
      vy: -22 - Math.random() * 20,
      life: 1,
      decay: 700,
      color: withAlpha(lighten(th.flumeTop, 0.6), 0.85),
      size: 2 + Math.random() * 3,
      kind: 'bubble',
    });
  }
}

function spawnScorePop(
  particles: Particle[],
  reduced: boolean,
  x: number,
  row: number,
  cameraRow: number,
  th: BoardwalkCosmeticTheme,
  pts: number,
) {
  if (reduced) return;
  particles.push({
    x: xPx(x),
    y: rowScreenY(row, cameraRow) - ROW_H * 0.95,
    vx: 0,
    vy: -34,
    life: 1,
    decay: 720,
    color: pts > 1 ? th.accent : lighten(th.plankLight, 0.55),
    size: pts > 1 ? 17 : 13,
    kind: 'text',
    text: `+${pts}`,
  });
}

// ── Pure render helpers (module scope so the rAF loop's useCallback stays
//    dependency-free; all state is passed in explicitly). ──

type DrawState = {
  t: number;
  now: number;
  seed: number;
  dt: number;
  th: BoardwalkCosmeticTheme;
  cw: number;
  chh: number;
  dpr: number;
  cameraRow: number;
  flash: number;
  shake: number;
  particles: Particle[];
  reduced: boolean;
  playing: boolean;
  pos: PlayerPos;
  anim: HopAnim;
  facing: HopDir;
  idleFrac: number; // 0..1 progress toward the gull deadline
  closeStreak: number;
  death: DeathAnim | null;
  crash: { engine: import('matter-js').Engine; bodies: import('matter-js').Body[]; colors: string[]; born: number } | null;
};

function drawSky(ctx: CanvasRenderingContext2D, s: DrawState) {
  const { th } = s;
  const sky = ctx.createLinearGradient(0, 0, 0, BASE_HEIGHT);
  sky.addColorStop(0, th.skyTop);
  sky.addColorStop(0.6, th.skyBottom);
  sky.addColorStop(1, th.horizon);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);

  // Sun with a soft halo.
  const sunX = BASE_WIDTH * 0.82;
  const sunY = BASE_HEIGHT * 0.1;
  const halo = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 70);
  halo.addColorStop(0, withAlpha(lighten(th.accent, 0.5), 0.9));
  halo.addColorStop(1, withAlpha(lighten(th.accent, 0.5), 0));
  ctx.fillStyle = halo;
  ctx.fillRect(sunX - 70, sunY - 70, 140, 140);
  ctx.fillStyle = lighten(th.accent, 0.65);
  ctx.beginPath();
  ctx.arc(sunX, sunY, 22, 0, Math.PI * 2);
  ctx.fill();

  // Drifting clouds (skip under reduced motion — they'd still be static shapes).
  const cloudColor = withAlpha(lighten(th.skyBottom, 0.6), 0.85);
  ctx.fillStyle = cloudColor;
  for (let i = 0; i < 3; i += 1) {
    const speed = s.reduced ? 0 : 0.006 + i * 0.003;
    const cx = ((i * 210 + s.t * speed) % (BASE_WIDTH + 160)) - 80;
    const cy = 34 + i * 38;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 34, 11, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + 22, cy - 7, 22, 9, 0, 0, Math.PI * 2);
    ctx.ellipse(cx - 24, cy - 4, 18, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Distant midway silhouettes: a ferris wheel + tents on the horizon band.
  const silCol = withAlpha(darken(th.horizon, 0.35), 0.5);
  ctx.strokeStyle = silCol;
  ctx.fillStyle = silCol;
  const fwX = BASE_WIDTH * 0.16;
  const fwY = BASE_HEIGHT * 0.12;
  const fwR = 30;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(fwX, fwY, fwR, 0, Math.PI * 2);
  ctx.stroke();
  const spin = s.reduced ? 0 : s.t * 0.0002;
  for (let i = 0; i < 6; i += 1) {
    const a = spin + (Math.PI * 2 * i) / 6;
    ctx.beginPath();
    ctx.moveTo(fwX, fwY);
    ctx.lineTo(fwX + Math.cos(a) * fwR, fwY + Math.sin(a) * fwR);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(fwX + Math.cos(a) * fwR, fwY + Math.sin(a) * fwR, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(fwX - 16, fwY + fwR + 18);
  ctx.lineTo(fwX, fwY + 6);
  ctx.lineTo(fwX + 16, fwY + fwR + 18);
  ctx.stroke();
  // Tents.
  for (let i = 0; i < 3; i += 1) {
    const tx = BASE_WIDTH * (0.32 + i * 0.16);
    const ty = BASE_HEIGHT * 0.145 + fwR;
    ctx.beginPath();
    ctx.moveTo(tx - 20, ty);
    ctx.lineTo(tx, ty - 22);
    ctx.lineTo(tx + 20, ty);
    ctx.closePath();
    ctx.fill();
  }
}

function drawPlankRow(ctx: CanvasRenderingContext2D, th: BoardwalkCosmeticTheme, row: number, yTop: number) {
  const frontH = 10; // 2.5D front face
  // Full-width planks (the gutters are planked too — the boardwalk continues).
  const plankW = TILE;
  for (let i = -1; i * plankW < BASE_WIDTH + plankW; i += 1) {
    const px = i * plankW + ((row % 2) * plankW) / 2; // stagger alternate rows
    ctx.fillStyle = (i + row) % 2 === 0 ? th.plankLight : th.plankDark;
    ctx.fillRect(px, yTop, plankW, ROW_H - frontH);
    // Grain lines.
    ctx.strokeStyle = withAlpha(darken(th.plankDark, 0.25), 0.35);
    ctx.lineWidth = 1;
    for (let g = 0; g < 2; g += 1) {
      const gy = yTop + 12 + g * 18 + detailRand(row, i * 7 + g) * 8;
      ctx.beginPath();
      ctx.moveTo(px + 4, gy);
      ctx.lineTo(px + plankW - 6, gy + (detailRand(row, i * 13 + g) - 0.5) * 4);
      ctx.stroke();
    }
    // Nails at the plank ends.
    ctx.fillStyle = withAlpha(darken(th.laneEdge, 0.1), 0.8);
    ctx.beginPath();
    ctx.arc(px + 6, yTop + ROW_H - frontH - 6, 1.6, 0, Math.PI * 2);
    ctx.arc(px + plankW - 6, yTop + ROW_H - frontH - 6, 1.6, 0, Math.PI * 2);
    ctx.fill();
    // Occasional knot.
    if (detailRand(row, i * 31) < 0.14) {
      ctx.strokeStyle = withAlpha(darken(th.plankDark, 0.3), 0.5);
      ctx.beginPath();
      ctx.arc(px + plankW * (0.3 + detailRand(row, i * 37) * 0.4), yTop + ROW_H * 0.4, 3, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // Front face.
  ctx.fillStyle = darken(th.plankDark, 0.3);
  ctx.fillRect(0, yTop + ROW_H - frontH, BASE_WIDTH, frontH);
  ctx.fillStyle = withAlpha('#000000', 0.12);
  ctx.fillRect(0, yTop + ROW_H - frontH, BASE_WIDTH, 3);
}

function drawRoadRow(ctx: CanvasRenderingContext2D, th: BoardwalkCosmeticTheme, row: number, yTop: number) {
  const frontH = 10;
  ctx.fillStyle = th.roadSide;
  ctx.fillRect(0, yTop + ROW_H - frontH, BASE_WIDTH, frontH);
  const deck = ctx.createLinearGradient(0, yTop, 0, yTop + ROW_H - frontH);
  deck.addColorStop(0, lighten(th.roadTop, 0.06));
  deck.addColorStop(1, th.roadTop);
  ctx.fillStyle = deck;
  ctx.fillRect(0, yTop, BASE_WIDTH, ROW_H - frontH);
  // Dashed center line.
  ctx.strokeStyle = withAlpha(lighten(th.roadTop, 0.5), 0.55);
  ctx.lineWidth = 3;
  ctx.setLineDash([14, 12]);
  ctx.beginPath();
  ctx.moveTo(0, yTop + (ROW_H - frontH) / 2);
  ctx.lineTo(BASE_WIDTH, yTop + (ROW_H - frontH) / 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // Tire wear streaks.
  ctx.fillStyle = withAlpha(darken(th.roadTop, 0.3), 0.25);
  for (let i = 0; i < 5; i += 1) {
    const wx = detailRand(row, i * 3) * BASE_WIDTH;
    const wy = yTop + 6 + detailRand(row, i * 5 + 1) * (ROW_H - frontH - 14);
    ctx.fillRect(wx, wy, 16 + detailRand(row, i * 9 + 2) * 26, 2.5);
  }
}

function drawWaterRow(ctx: CanvasRenderingContext2D, th: BoardwalkCosmeticTheme, row: number, yTop: number, t: number, reduced: boolean) {
  const frontH = 10;
  ctx.fillStyle = th.flumeSide;
  ctx.fillRect(0, yTop + ROW_H - frontH, BASE_WIDTH, frontH);
  const water = ctx.createLinearGradient(0, yTop, 0, yTop + ROW_H - frontH);
  water.addColorStop(0, lighten(th.flumeTop, 0.1));
  water.addColorStop(1, darken(th.flumeTop, 0.18));
  ctx.fillStyle = water;
  ctx.fillRect(0, yTop, BASE_WIDTH, ROW_H - frontH);

  // Two layers of drifting wave highlights.
  const waveCol = withAlpha(lighten(th.flumeTop, 0.4), 0.4);
  ctx.strokeStyle = waveCol;
  ctx.lineWidth = 2;
  const phase = reduced ? 0 : t * 0.0011;
  for (let layer = 0; layer < 2; layer += 1) {
    const dirSign = layer === 0 ? 1 : -0.6;
    const yBase = yTop + 14 + layer * 18;
    ctx.beginPath();
    for (let px2 = -20; px2 <= BASE_WIDTH + 20; px2 += 10) {
      const yy = yBase + Math.sin(px2 * 0.045 + phase * dirSign * 4 + row * 2.1) * 3.2;
      if (px2 === -20) ctx.moveTo(px2, yy);
      else ctx.lineTo(px2, yy);
    }
    ctx.stroke();
  }
  // Twinkling sparkles.
  for (let i = 0; i < 7; i += 1) {
    const sx = detailRand(row, i * 11) * BASE_WIDTH;
    const sy = yTop + 6 + detailRand(row, i * 17 + 3) * (ROW_H - frontH - 12);
    const tw = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t * 0.004 + i * 2.2 + row);
    ctx.fillStyle = withAlpha(lighten(th.flumeTop, 0.65), 0.25 + tw * 0.4);
    ctx.fillRect(sx, sy, 5, 1.6);
  }
}

/** Hazard lattice positions (tile-space centers) visible on screen at time t. */
function hazardCenters(h: HazardRow, t: number): number[] {
  const vel = h.dir * h.velTilesPerMs;
  const base = h.phase + vel * t;
  const half = h.len / 2;
  const lo = -GUTTER_TILES - half - 1;
  const hi = COLS - 1 + GUTTER_TILES + half + 1;
  const kMin = Math.ceil((lo - base) / h.spacing);
  const kMax = Math.floor((hi - base) / h.spacing);
  const out: number[] = [];
  for (let k = kMin; k <= kMax; k += 1) out.push(base + k * h.spacing);
  return out;
}

function drawCart(ctx: CanvasRenderingContext2D, th: BoardwalkCosmeticTheme, h: HazardRow, cx: number, yTop: number) {
  const w = h.len * TILE - 12;
  const hgt = ROW_H - 24;
  const x = xPx(cx) - w / 2;
  const y = yTop + 7;
  // Shadow.
  ctx.fillStyle = th.tileShadow;
  ctx.beginPath();
  ctx.ellipse(xPx(cx), y + hgt + 2, w * 0.52, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  // Skirt (dark under-body).
  ctx.fillStyle = th.cartShade;
  roundRect(ctx, x, y + 6, w, hgt - 2, 9);
  ctx.fill();
  // Body.
  const bodyGrad = ctx.createLinearGradient(0, y, 0, y + hgt);
  bodyGrad.addColorStop(0, lighten(th.cartBody, 0.18));
  bodyGrad.addColorStop(1, th.cartBody);
  ctx.fillStyle = bodyGrad;
  roundRect(ctx, x, y, w, hgt - 4, 9);
  ctx.fill();
  // Canopy stripe.
  ctx.fillStyle = withAlpha(lighten(th.cartBody, 0.55), 0.9);
  roundRect(ctx, x + 4, y + 3, w - 8, 8, 4);
  ctx.fill();
  // Bumper ring.
  ctx.strokeStyle = darken(th.cartShade, 0.2);
  ctx.lineWidth = 2;
  roundRect(ctx, x + 1.5, y + 1.5, w - 3, hgt - 7, 8);
  ctx.stroke();
  // Headlight on the leading edge.
  const lead = h.dir > 0 ? x + w - 5 : x + 5;
  ctx.fillStyle = lighten(th.accent, 0.4);
  ctx.beginPath();
  ctx.arc(lead, y + hgt * 0.45, 3.4, 0, Math.PI * 2);
  ctx.fill();
  // Wheels peeking under the skirt.
  ctx.fillStyle = darken(th.laneEdge, 0.1);
  const wheelY = y + hgt + 1;
  ctx.beginPath();
  ctx.arc(x + w * 0.22, wheelY, 4, 0, Math.PI * 2);
  ctx.arc(x + w * 0.78, wheelY, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawLog(ctx: CanvasRenderingContext2D, th: BoardwalkCosmeticTheme, h: HazardRow, cx: number, yTop: number, t: number, reduced: boolean, k: number) {
  const w = h.len * TILE - 8;
  const hgt = ROW_H - 26;
  const bob = reduced ? 0 : Math.sin(t * 0.0032 + k * 1.7) * 1.8;
  const x = xPx(cx) - w / 2;
  const y = yTop + 10 + bob;
  // Wake ripple behind the log.
  if (!reduced) {
    const tail = h.dir > 0 ? x - 3 : x + w + 3;
    ctx.strokeStyle = withAlpha(lighten(th.flumeTop, 0.55), 0.5);
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 2; i += 1) {
      const off = (h.dir > 0 ? -1 : 1) * (5 + i * 8 + ((t * 0.02) % 8));
      ctx.beginPath();
      ctx.moveTo(tail + off, y + 4);
      ctx.quadraticCurveTo(tail + off + (h.dir > 0 ? -4 : 4), y + hgt / 2, tail + off, y + hgt - 4);
      ctx.stroke();
    }
  }
  // Body.
  const grad = ctx.createLinearGradient(0, y, 0, y + hgt);
  grad.addColorStop(0, lighten(th.logBody, 0.15));
  grad.addColorStop(0.55, th.logBody);
  grad.addColorStop(1, th.logShade);
  ctx.fillStyle = grad;
  roundRect(ctx, x, y, w, hgt, hgt / 2);
  ctx.fill();
  // Bark stripes.
  ctx.strokeStyle = withAlpha(th.logShade, 0.75);
  ctx.lineWidth = 1.6;
  for (let i = 1; i <= h.len * 2 - 1; i += 1) {
    const bx = x + (w * i) / (h.len * 2) + (detailRand(h.row, k * 5 + i) - 0.5) * 6;
    ctx.beginPath();
    ctx.moveTo(bx, y + 3);
    ctx.quadraticCurveTo(bx + 3, y + hgt / 2, bx, y + hgt - 3);
    ctx.stroke();
  }
  // Cut end with rings on the trailing side.
  const endX = h.dir > 0 ? x + hgt * 0.42 : x + w - hgt * 0.42;
  ctx.fillStyle = lighten(th.logBody, 0.35);
  ctx.beginPath();
  ctx.ellipse(endX, y + hgt / 2, hgt * 0.32, hgt * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = withAlpha(th.logShade, 0.8);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.ellipse(endX, y + hgt / 2, hgt * 0.18, hgt * 0.26, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(endX, y + hgt / 2, hgt * 0.07, hgt * 0.11, 0, 0, Math.PI * 2);
  ctx.stroke();
  // Wet sheen.
  ctx.fillStyle = withAlpha('#ffffff', 0.14);
  roundRect(ctx, x + 6, y + 2.5, w - 12, 5, 3);
  ctx.fill();
}

/** The duckling mascot. `pose` controls limbs; all colors come from the theme. */
function drawDuck(
  ctx: CanvasRenderingContext2D,
  th: BoardwalkCosmeticTheme,
  xp: number, // screen px center
  yp: number, // screen px of feet
  opts: {
    t: number;
    reduced: boolean;
    hopPhase: number; // 0..1 through a hop (1 = grounded)
    facing: HopDir;
    riding: boolean;
    sink?: number; // 0..1 drown progress
    flat?: boolean; // collision squish
    fade?: number; // 0..1 alpha fade-out
  },
) {
  const { t, reduced, hopPhase, facing, riding } = opts;
  const squash = reduced ? 0 : Math.sin(hopPhase * Math.PI);
  const lift = squash * 22;
  const idleBob = reduced || hopPhase < 1 ? 0 : Math.sin(t * 0.004) * 1.6;
  const rideRock = riding && !reduced ? Math.sin(t * 0.0032) * 0.06 : 0;
  const sink = opts.sink ?? 0;
  const flat = opts.flat ?? false;

  const w = TILE * 0.66 * (1 + squash * 0.1) * (flat ? 1.35 : 1);
  const hgt = TILE * 0.72 * (1 - squash * 0.12) * (flat ? 0.4 : 1) * (1 - sink * 0.5);
  const lean =
    facing === 'L' ? -0.12 : facing === 'R' ? 0.12 : facing === 'D' ? 0.05 : 0;

  ctx.save();
  if (opts.fade !== undefined) ctx.globalAlpha = clamp(1 - opts.fade, 0, 1);

  // Shadow (fades with lift; hidden while sinking).
  if (sink === 0) {
    ctx.fillStyle = th.tileShadow;
    ctx.beginPath();
    ctx.ellipse(xp, yp, (w * 0.5) * (1 - squash * 0.25), 6 * (1 - squash * 0.3), 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.translate(xp, yp - hgt * 0.52 - lift + idleBob + sink * hgt * 0.8);
  ctx.rotate(lean + rideRock);

  if (th.hopperGlow && th.hopperGlowIntensity > 0) {
    ctx.shadowColor = th.hopperGlow;
    ctx.shadowBlur = 16 * th.hopperGlowIntensity;
  }

  // Feet (tucked while airborne).
  if (!flat && sink < 0.5) {
    const feetSpread = w * (0.22 - squash * 0.1);
    const feetY = hgt * 0.5 - squash * 4;
    ctx.fillStyle = mix(th.hopperFace, th.accent, 0.5);
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sgn * feetSpread, feetY, w * 0.12, 3.4, sgn * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Tail nub.
  ctx.fillStyle = th.hopperShade;
  ctx.beginPath();
  ctx.ellipse(-w * 0.42, hgt * 0.05, w * 0.16, hgt * 0.13, -0.5, 0, Math.PI * 2);
  ctx.fill();

  // Body (2.5D: shaded under-half + lit top).
  ctx.fillStyle = th.hopperShade;
  ctx.beginPath();
  ctx.ellipse(0, hgt * 0.1, w * 0.5, hgt * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  const bodyGrad = ctx.createLinearGradient(0, -hgt * 0.4, 0, hgt * 0.45);
  bodyGrad.addColorStop(0, lighten(th.hopperBody, 0.12));
  bodyGrad.addColorStop(1, th.hopperBody);
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.5, hgt * 0.44, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Belly.
  ctx.fillStyle = th.hopperBelly;
  ctx.beginPath();
  ctx.ellipse(0, hgt * 0.16, w * 0.3, hgt * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();

  // Wings — flap while airborne, rest against the body when grounded.
  const flap = squash * 0.9;
  ctx.fillStyle = th.hopperShade;
  for (const sgn of [-1, 1]) {
    ctx.save();
    ctx.translate(sgn * w * 0.42, -hgt * 0.02);
    ctx.rotate(sgn * (0.25 + flap));
    ctx.beginPath();
    ctx.ellipse(0, 0, w * 0.17, hgt * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (!flat) {
    // Head.
    const headY = -hgt * 0.42;
    ctx.fillStyle = lighten(th.hopperBody, 0.16);
    ctx.beginPath();
    ctx.ellipse(0, headY, w * 0.32, hgt * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    // Beak (uses the face accent color).
    const beakDir = facing === 'L' ? -1 : facing === 'R' ? 1 : 0;
    ctx.fillStyle = mix(th.hopperFace, th.accent, 0.55);
    ctx.beginPath();
    if (beakDir === 0) {
      ctx.ellipse(0, headY + hgt * 0.06, w * 0.14, hgt * 0.07, 0, 0, Math.PI * 2);
    } else {
      ctx.ellipse(beakDir * w * 0.24, headY + hgt * 0.04, w * 0.15, hgt * 0.07, beakDir * 0.25, 0, Math.PI * 2);
    }
    ctx.fill();
    // Eyes (blink every ~3.4s).
    const blink = reduced ? 1 : Math.min(1, Math.abs(((t % 3400) / 3400) - 0.5) * 14);
    ctx.fillStyle = th.hopperFace;
    for (const sgn of [-1, 1]) {
      if (beakDir !== 0 && sgn !== beakDir) continue; // profile view: one eye
      ctx.beginPath();
      ctx.ellipse(sgn * w * 0.13 + beakDir * w * 0.06, headY - hgt * 0.03, w * 0.055, hgt * 0.07 * blink, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Cheek blush.
    ctx.fillStyle = withAlpha(mix(th.hopperBody, '#ff6b5e', 0.55), 0.35);
    for (const sgn of [-1, 1]) {
      if (beakDir !== 0 && sgn !== beakDir) continue;
      ctx.beginPath();
      ctx.ellipse(sgn * w * 0.22, headY + hgt * 0.07, w * 0.06, hgt * 0.04, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // Squished: X eyes.
    ctx.strokeStyle = th.hopperFace;
    ctx.lineWidth = 2;
    for (const sgn of [-1, 1]) {
      const ex = sgn * w * 0.14;
      const ey = -hgt * 0.1;
      ctx.beginPath();
      ctx.moveTo(ex - 3, ey - 3);
      ctx.lineTo(ex + 3, ey + 3);
      ctx.moveTo(ex + 3, ey - 3);
      ctx.lineTo(ex - 3, ey + 3);
      ctx.stroke();
    }
  }

  ctx.restore();
}

/** The gull: circles tighter as the idle clock runs down; dives on a catch. */
function drawGull(ctx: CanvasRenderingContext2D, s: DrawState, px: number, py: number) {
  const { th, idleFrac, t } = s;
  const death = s.death;
  const catching = death?.cause === 'gull';
  if (!catching && idleFrac < 0.45) return;

  let gx: number;
  let gy: number;
  let wingRate = 0.012;
  if (catching && death) {
    // Dive in, then carry the duck up and away.
    const p = clamp((t - death.startT) / 900, 0, 1);
    const dive = easeOut(Math.min(1, p * 2));
    const carry = clamp((p - 0.5) * 2, 0, 1);
    gx = lerp(px + 150, px, dive) + carry * 220;
    gy = lerp(py - 260, py - 24, dive) - carry * 300;
    wingRate = 0.03;
  } else {
    // Circle overhead, closing in as the deadline nears.
    const urgency = clamp((idleFrac - 0.45) / 0.55, 0, 1);
    const rad = lerp(150, 44, urgency);
    const ang = s.reduced ? 0.8 : t * (0.0016 + urgency * 0.0012);
    gx = px + Math.cos(ang) * rad;
    gy = py - 190 + Math.sin(ang * 1.3) * 22 + urgency * 90;
    wingRate = 0.012 + urgency * 0.014;
    // Its shadow sweeps the boardwalk — the "get moving" tell.
    ctx.fillStyle = withAlpha('#000000', 0.1 + urgency * 0.14);
    ctx.beginPath();
    ctx.ellipse(gx, py + 4, 16 + urgency * 10, 4.5 + urgency * 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const flap = s.reduced ? 0.4 : Math.sin(t * wingRate * 1000 * 0.001 * Math.PI * 2) * 0.9;
  ctx.save();
  ctx.translate(gx, gy);
  // Body.
  ctx.fillStyle = th.gullBody;
  ctx.beginPath();
  ctx.ellipse(0, 0, 15, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  // Head + beak.
  ctx.beginPath();
  ctx.ellipse(11, -5, 7, 5.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = th.gullBeak;
  ctx.beginPath();
  ctx.moveTo(16, -6);
  ctx.lineTo(24, -4);
  ctx.lineTo(16, -2.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = th.hopperFace;
  ctx.beginPath();
  ctx.arc(12.5, -6, 1.4, 0, Math.PI * 2);
  ctx.fill();
  // Wings.
  ctx.fillStyle = th.gullWing;
  for (const sgn of [-1, 1]) {
    ctx.save();
    ctx.rotate(sgn * flap * 0.5);
    ctx.beginPath();
    ctx.ellipse(-3, sgn * 2, 17, 5.5, sgn * (0.5 + flap * 0.3), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // Tail.
  ctx.fillStyle = th.gullWing;
  ctx.beginPath();
  ctx.moveTo(-13, 0);
  ctx.lineTo(-21, -3);
  ctx.lineTo(-21, 3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawScene(ctx: CanvasRenderingContext2D, s: DrawState) {
  const { th, seed } = s;
  ctx.save();
  ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  ctx.scale(s.cw / BASE_WIDTH, s.chh / BASE_HEIGHT);
  if (s.shake > 0 && !s.reduced) {
    const mag = s.shake * 6;
    ctx.translate((Math.sin(s.now * 0.11) * mag), (Math.cos(s.now * 0.13) * mag));
  }

  drawSky(ctx, s);

  const camRow = s.cameraRow;
  const screenY = (row: number) => rowScreenY(row, camRow);
  const topRow = Math.ceil(camRow + ANCHOR_Y / ROW_H) + 1;
  const botRow = Math.floor(camRow - (BASE_HEIGHT - ANCHOR_Y) / ROW_H) - 1;

  // Sand strip below row 0 (the beach behind the start of the boardwalk).
  if (botRow < 0) {
    const sandTop = screenY(0);
    ctx.fillStyle = mix(th.plankLight, th.horizon, 0.55);
    ctx.fillRect(0, sandTop, BASE_WIDTH, BASE_HEIGHT - sandTop);
    ctx.fillStyle = withAlpha(darken(th.horizon, 0.2), 0.4);
    for (let i = 0; i < 14; i += 1) {
      ctx.beginPath();
      ctx.arc(detailRand(-1, i) * BASE_WIDTH, sandTop + 12 + detailRand(-2, i) * 80, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Row decks, far → near.
  for (let row = topRow; row >= Math.max(0, botRow); row -= 1) {
    const info = rowInfo(seed, row);
    const yTop = screenY(row) - ROW_H;
    if (info.kind === 'safe') drawPlankRow(ctx, th, row, yTop);
    else if (info.kind === 'road') drawRoadRow(ctx, th, row, yTop);
    else drawWaterRow(ctx, th, row, yTop, s.t, s.reduced);
  }

  // ── Player pose (computed before hazards so the log under the player and
  //    the player can be layered correctly). ──
  const anim = s.anim;
  const liveX = playerXAt(seed, s.pos, s.t);
  const liveRow = s.pos.row;
  let prog = 1;
  if (anim.start >= 0) prog = s.reduced ? 1 : clamp((s.t - anim.start) / HOP_ANIM_MS, 0, 1);
  const e = easeOut(prog);
  const drawX = lerp(anim.fromX, liveX, e);
  const drawRow = lerp(anim.fromRow, liveRow, e);
  const duckPx = xPx(drawX);

  // Hazards + player, far → near so nearer rows overlap correctly.
  const death = s.death;
  for (let row = topRow; row >= Math.max(0, botRow); row -= 1) {
    const info: RowInfo = rowInfo(seed, row);
    const yTop = screenY(row) - ROW_H;
    if (info.kind === 'road') {
      for (const c of hazardCenters(info.hazard, s.t)) drawCart(ctx, th, info.hazard, c, yTop);
    } else if (info.kind === 'flume') {
      const centers = hazardCenters(info.hazard, s.t);
      const base = info.hazard.phase + info.hazard.dir * info.hazard.velTilesPerMs * s.t;
      for (const c of centers) {
        const k = Math.round((c - base) / info.hazard.spacing);
        drawLog(ctx, th, info.hazard, c, yTop, s.t, s.reduced, k);
      }
    }

    // Draw the duck right after its own row's hazards (standing ON the log).
    if (Math.round(drawRow) === row) {
      const feetY = screenY(drawRow) - ROW_H * 0.3;
      const riding = s.pos.mode === 'riding' && prog >= 1;
      const rideBob =
        riding && !s.reduced && s.pos.mode === 'riding'
          ? Math.sin(s.t * 0.0032 + s.pos.k * 1.7) * 1.8
          : 0;

      if (death) {
        const dp = clamp((s.t - death.startT) / 1000, 0, 1);
        if (death.cause === 'drown') {
          drawDuck(ctx, th, duckPx, feetY + rideBob, {
            t: s.t, reduced: s.reduced, hopPhase: 1, facing: s.facing, riding: false,
            sink: dp, fade: dp,
          });
          if (dp < 0.9) spawnDrownBubbles(s.particles, s.reduced, duckPx, feetY - 10, th);
        } else if (death.cause === 'collision') {
          drawDuck(ctx, th, duckPx, feetY, {
            t: s.t, reduced: s.reduced, hopPhase: 1, facing: s.facing, riding: false,
            flat: true, fade: dp * 0.6,
          });
        } else if (death.cause === 'swept') {
          const sweepX = duckPx + (duckPx > BASE_WIDTH / 2 ? 1 : -1) * dp * 90;
          drawDuck(ctx, th, sweepX, feetY + rideBob + dp * 8, {
            t: s.t, reduced: s.reduced, hopPhase: 1, facing: s.facing, riding: true,
            fade: dp,
          });
        } else {
          // Gull carry: the gull renderer moves the duck.
          const p = clamp((s.t - death.startT) / 900, 0, 1);
          const carry = clamp((p - 0.5) * 2, 0, 1);
          if (carry > 0) {
            drawDuck(ctx, th, duckPx + carry * 220, feetY - carry * 300, {
              t: s.t, reduced: s.reduced, hopPhase: 0.4, facing: s.facing, riding: false,
              fade: carry * 0.7,
            });
          } else {
            drawDuck(ctx, th, duckPx, feetY, {
              t: s.t, reduced: s.reduced, hopPhase: 1, facing: s.facing, riding: false,
            });
          }
        }
      } else {
        drawDuck(ctx, th, duckPx, feetY + rideBob, {
          t: s.t, reduced: s.reduced, hopPhase: prog, facing: s.facing, riding,
        });
      }
    }
  }

  // Crash debris (matter.js render-only bodies).
  if (s.crash) {
    const age = s.now - s.crash.born;
    const fade = clamp(1 - age / 2600, 0, 1);
    for (let i = 0; i < s.crash.bodies.length; i += 1) {
      const b = s.crash.bodies[i];
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(b.position.x, b.position.y);
      ctx.rotate(b.angle);
      const bb = b.bounds;
      const bw = bb.max.x - bb.min.x;
      const bh = bb.max.y - bb.min.y;
      ctx.fillStyle = s.crash.colors[i];
      ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
      ctx.restore();
    }
  }

  // Gull (warning circle / catch dive).
  drawGull(ctx, s, duckPx, screenY(drawRow) - ROW_H * 0.3);

  // Gull-pressure vignette in the last stretch of the idle window.
  if (s.playing && s.idleFrac > 0.72) {
    const u = (s.idleFrac - 0.72) / 0.28;
    const pulse = s.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(s.t * 0.012);
    const vg = ctx.createRadialGradient(
      BASE_WIDTH / 2, BASE_HEIGHT / 2, BASE_HEIGHT * 0.35,
      BASE_WIDTH / 2, BASE_HEIGHT / 2, BASE_HEIGHT * 0.75,
    );
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, withAlpha(darken(th.cartBody, 0.2), 0.16 + u * pulse * 0.2));
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
  }

  // Particles.
  const parts = s.particles;
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const p = parts[i];
    p.life -= s.dt / p.decay;
    if (p.life <= 0) { parts.splice(i, 1); continue; }
    p.x += (p.vx * s.dt) / 1000;
    p.y += (p.vy * s.dt) / 1000;
    if (p.kind === 'droplet' || p.kind === 'dot') p.vy += (620 * s.dt) / 1000;
    if (p.kind === 'feather') {
      p.vy += (90 * s.dt) / 1000;
      p.vx += Math.sin((p.angle ?? 0) + p.y * 0.06) * 0.5;
      p.angle = (p.angle ?? 0) + ((p.spin ?? 0) * s.dt) / 1000;
    }
    ctx.globalAlpha = clamp(p.life, 0, 1);
    if (p.kind === 'ripple') {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2;
      const r = p.size + (1 - p.life) * 26;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r, r * 0.38, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (p.kind === 'bubble') {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.stroke();
    } else if (p.kind === 'feather') {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle ?? 0);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size, p.size * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (p.kind === 'text') {
      ctx.fillStyle = p.color;
      ctx.font = `800 ${p.size}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 3;
      ctx.strokeText(p.text ?? '', p.x, p.y);
      ctx.fillText(p.text ?? '', p.x, p.y);
    } else {
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
  }
  ctx.globalAlpha = 1;

  if (s.flash > 0) {
    ctx.globalAlpha = s.flash * 0.3;
    ctx.fillStyle = th.accent;
    ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
