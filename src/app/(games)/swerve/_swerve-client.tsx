'use client';

import { useState, useRef, useEffect, useCallback, type CSSProperties } from 'react';
import { Navigation, CircleHelp } from 'lucide-react';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import { PageHeader, GamesWalletCard } from '@/features/arcade/components/shell/page-header';
import { MuteButton } from '@/features/arcade/components/mute-button';
import { EnvMonitor } from '@/features/arcade/lib/game-anti-cheat';
import { usePreventGameGestures, useIsTouchDevice } from '@/features/arcade/lib/game-mobile-utils';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { gameCanvasDpr } from '@/features/arcade/lib/game-frame-loop';
import { ArcadeRunRewards } from '@/features/arcade/components/results/arcade-run-result';
import { useArcadeRunResult } from '@/features/arcade/lib/run-result';
import type { AccountXpReward } from '@/server/arcade/rewards/types';
import * as THREE from 'three';
import {
  LANE_COUNT,
  SWERVE_BASE_ROW_INTERVAL_MS,
  SWERVE_LANE_CHANGE_MS,
  SWERVE_LEAD_IN_MS,
  createSwerveLayout,
  rowIntervalMs,
  minTimeForRowMs,
  type SwerveLayout,
  type SwerveRowInfo,
  type SwervePassEvent,
} from '@/server/arcade/swerve-replay';
import {
  DEFAULT_SWERVE_THEME,
  buildSwerveTheme,
  type SwerveCosmeticTheme,
  type SwerveInventoryResponse,
} from './_swerve-theme';

import './_swerve.css';
import { calloutLifeMs } from '@/features/arcade/components/gameplay/callout-motion';
import { useFeelReducedMotion } from '@/features/arcade/lib/use-game-feedback';

// matter-js is loaded lazily (dynamic import, prefetched at run start) and used
// ONLY for the crash-debris spectacle — never for steering or judging.
type MatterModule = typeof import('matter-js');

// ── Logical stage (the canvas fills this space; the 3D camera fills the rest). ──
const BASE_WIDTH = 520;
const BASE_HEIGHT = 620;
const TARGET_FPS = 60;
const FRAME_TIME = 1000 / TARGET_FPS;

// SCHEDULE-DRIVEN traffic: the highway is positioned purely from the run's
// elapsed time. Row r is scheduled to reach the player's line EXACTLY at
// t = minTimeForRowMs(r) + SWERVE_LEAD_IN_MS (relative to run start); its world
// depth is a pure function of (scheduledT − elapsed). This makes the rendered
// arrival cadence byte-equal to the server replay's per-row schedule — no
// geometric-spacing drift — so an honest pass's recorded `t` always satisfies
// the replay's timing bounds.
const RESTART_GRACE_PERIOD = 500;

// How many rows ahead of the player we keep instantiated. Sized so traffic
// materializes out of the fog well past the ≥2 s telegraph rule.
const VISIBLE_ROW_LOOKAHEAD = 14;

const REWARDS_HINT_TEXT =
  'Rewards hint: every traffic row you clear is +1, and threading a forced gap (two lanes blocked) pays a close-call bonus that grows with your streak. Tickets taper at higher scores.';

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

// 'crashing' = the matter.js debris slow-mo between collision and the results
// overlay. Steering is dead, the score is already submitted, restarts wait.
type GameState = 'idle' | 'playing' | 'crashing' | 'gameover' | 'error';

// A live traffic row: the seed-derived row info + its scheduled arrival on the
// sim clock. World depth is derived each frame from (scheduledT − elapsed).
type ObstacleRow = {
  info: SwerveRowInfo;
  scheduledT: number;
  scored: boolean; // already judged (don't double count)
};

// Floating bonus text (presentation only).
type Floater = { id: number; text: string; lane: number; kind: 'bonus' | 'combo' };

// Distinct existing SoundManager names (we never modify SoundManager).
const SFX = {
  move: 'arcadeReelTick',
  pass: 'score',
  whoosh: 'arcadeSpin', // near-miss "whoosh" on forced-gap threads
  crash: 'arcadeCrash',
  debris: 'arcadeExplode',
  start: 'arcadeBet',
} as const;

// ── 3D world (three.js) ────────────────────────────────────────────────────
// Chase-cam highway. The SIM stays on the row schedule; render3D() maps the
// car's lane float + each row's (scheduledT − elapsed) into world space. The
// WORLD moves toward the player (player x-only) — no floating-point drift.
const LANE_SPACING = 2.15; // world-x between lane centres
const ROAD_HALF_W = LANE_SPACING * 1.5 + 0.55; // road edge past the outer lanes
// Base depth (−z) a row gains per ms of look-ahead. Scaled by the live speed
// factor so approach speed visibly rises while row spacing stays constant.
const BASE_UNITS_PER_MS = 0.0066;
const FOG_NEAR = 14;
const FOG_FAR = 48; // ≥ 4.5 s of telegraph even at the speed cap (≥2 s rule)
const TIE_COUNT = 12; // scrolling road stripes (sell forward speed)
const TIE_SPACING = 4.2;
const POST_PAIRS = 8; // roadside posts (regular spacing = an eye speedometer)
const POST_SPACING = 9;
// The player's collision line: a row is judged at scheduledT (z = 0). The car
// sits just behind it so traffic meets the car's nose exactly as it's judged.
const CAR_Z = 1.35;
const TRAFFIC_POOL = LANE_COUNT * (VISIBLE_ROW_LOOKAHEAD + 2);
const HINT_POOL = 10; // safe-gap marker dots on forced rows (presentation)
const DEBRIS_COUNT = 12;
const CRASH_DURATION_MS = 1500;
const CRASH_SLOWMO = 0.34; // matter sim runs at ~1/3 speed during the spectacle

// Camera framing (chase cam, player in the lower third, FOV widens with speed).
const CAM_HEIGHT = 3.4;
const CAM_BACK = 5.5; // behind the car
const CAM_FOV_BASE = 58;
const CAM_FOV_SPAN = 15;

// Non-themeable palette (hex ints for three materials).
const C3 = {
  wheel: 0x14100b,
  hub: 0x8a7a55,
  headlight: 0xfff0cc,
  taillight: 0xe0454a,
  trafficCabin: 0x1d2b2e,
} as const;

// One pooled low-poly traffic car (body material swaps red/teal per row).
type TrafficCar = { group: THREE.Group; body: THREE.Mesh; cabin: THREE.Mesh };

type DebrisPiece = {
  mesh: THREE.Mesh;
  arcAmp: number; // fake vertical bounce height (matter sim is top-down 2D)
  spin: number; // extra tumble around x
  baseY: number;
};

export default function SwerveClient() {
  const touchDevice = useIsTouchDevice();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [gameState, setGameState] = useState<GameState>('idle');
  const [score, setScore] = useState(0);
  const [rowsCleared, setRowsCleared] = useState(0);
  const [combo, setCombo] = useState(0);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const reducedMotion = useFeelReducedMotion();
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
  const [webglError, setWebglError] = useState(false);
  const [canvasSize, setCanvasSize] = useState({
    width: BASE_WIDTH,
    height: BASE_HEIGHT,
    dpr: 1,
  });
  // Equipped cosmetics (cart / track / environment). Seeded with the exact
  // current palette so the idle render is unchanged before inventory loads.
  const [swerveTheme, setSwerveTheme] =
    useState<SwerveCosmeticTheme>(DEFAULT_SWERVE_THEME);

  usePreventGameGestures(gameState === 'playing' || gameState === 'crashing');

  // ── Refs (mutable sim state; no re-render) ──
  const gameStateRef = useRef<GameState>('idle');
  const sessionTokenRef = useRef<string | null>(null);
  const seedRef = useRef<number | null>(null);
  const layoutRef = useRef<SwerveLayout | null>(null);
  const envMonitorRef = useRef(new EnvMonitor());
  const scoreRef = useRef(0);
  const floaterIdRef = useRef(0);

  // Car lane (0..LANE_COUNT-1) target + the eased lane FLOAT the renderer uses.
  // The tween covers SWERVE_LANE_CHANGE_MS per lane — the same constant the
  // seeded generator budgets with, so what the player can do on screen is
  // exactly what generation assumes (the passability contract).
  const laneRef = useRef(1);
  const laneFloatRef = useRef(1);
  const tweenFromRef = useRef(1);
  const tweenStartRef = useRef(-1_000);
  const tweenDurRef = useRef(SWERVE_LANE_CHANGE_MS);
  const prevLaneFloatRef = useRef(1);
  const passesRef = useRef<SwervePassEvent[]>([]);

  // Obstacle schedule state. `elapsedMsRef` is the run-relative sim clock
  // (advanced by the fixed step, so it tracks the recorded pass `t` exactly).
  const rowsRef = useRef<ObstacleRow[]>([]);
  const nextSpawnRowRef = useRef(1); // next row index to instantiate
  const elapsedMsRef = useRef(0);
  // Visual speed factor (1 → ~1.6 at the ramp floor), smoothed per sim step.
  const speedRef = useRef(1);
  const phaseRef = useRef(0); // accumulated scroll distance for ties/posts

  // ── three.js scene refs (built once; updated per frame by render3D) ──
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const carRef = useRef<THREE.Group | null>(null);
  const tiesRef = useRef<THREE.Mesh[]>([]);
  const postsRef = useRef<THREE.Group[]>([]);
  const trafficPoolRef = useRef<TrafficCar[]>([]);
  const hintPoolRef = useRef<THREE.Mesh[]>([]);
  const debrisRef = useRef<DebrisPiece[]>([]);
  const blockMatsRef = useRef<{
    red: THREE.MeshStandardMaterial;
    teal: THREE.MeshStandardMaterial;
  } | null>(null);
  // Themeable scene materials/lights, captured at build time so applySwerveTheme
  // can recolor them when an equipped skin arrives after the scene is built.
  const themeRef = useRef<SwerveCosmeticTheme>(DEFAULT_SWERVE_THEME);
  const themeMatsRef = useRef<{
    road: THREE.MeshStandardMaterial;
    rail: THREE.MeshStandardMaterial;
    railTop: THREE.MeshStandardMaterial;
    dividerRed: THREE.MeshStandardMaterial;
    dividerTeal: THREE.MeshStandardMaterial;
    tie: THREE.MeshStandardMaterial;
    carBody: THREE.MeshStandardMaterial;
    carRoof: THREE.MeshStandardMaterial;
    carStripe: THREE.MeshStandardMaterial;
    carGlass: THREE.MeshStandardMaterial;
    hint: THREE.MeshStandardMaterial;
    hemi: THREE.HemisphereLight;
  } | null>(null);
  const shakeRef = useRef(0); // collision camera-shake (0..1, decays)
  const fovKickRef = useRef(0); // near-miss micro FOV kick (0..1, decays)
  const camXRef = useRef(0); // lagged camera x (eased lateral follow)
  const currentFovRef = useRef(CAM_FOV_BASE);

  // Crash spectacle (matter.js) state.
  const matterModRef = useRef<MatterModule | null>(null);
  const crashRafRef = useRef(0);
  const crashStateRef = useRef<{
    engine: import('matter-js').Engine;
    bodies: import('matter-js').Body[];
    start: number;
    last: number;
    carX: number;
  } | null>(null);
  const crashTimeoutRef = useRef<number>(0);

  const animationRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const accumulatorRef = useRef<number>(0);
  const gameStartTimeRef = useRef(0); // performance.now() when the run began
  const gameOverTimeRef = useRef<number>(0);
  const isStartingRef = useRef(false);
  const isGuestRunRef = useRef(false);
  const reducedMotionRef = useRef(false);
  const saveScoreRef = useRef<
    ((score: number, passes: SwervePassEvent[]) => Promise<void>) | null
  >(null);
  const endRunRef = useRef<(() => void) | null>(null);
  const bestScoreCacheRef = useRef<number | null>(null);

  const fetchUserBestScore = useCallback(async () => {
    if (bestScoreCacheRef.current !== null) {
      setHighScore(bestScoreCacheRef.current);
      return;
    }
    try {
      const response = await fetch('/api/games/swerve/score', {
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
      const response = await fetch('/api/store/inventory?gameType=swerve', {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = (await response.json()) as SwerveInventoryResponse;
      setWalletBalances({ credits: payload.wallet?.credits ?? 0 });
      setDailyCreditsProgress({
        earned: payload.dailyGameCredits?.earned ?? 0,
        cap: payload.dailyGameCredits?.cap ?? 300,
      });
      setSwerveTheme(buildSwerveTheme(payload));
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

  const saveScore = async (finalScore: number, passes: SwervePassEvent[]) => {
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
      // No `keepalive`: the pass log grows with every row and long runs can
      // exceed the 64KB keepalive body quota, which would silently fail the
      // save. This POST happens on game-over with the page alive, so it does
      // not need unload semantics.
      const response = await fetch('/api/games/swerve/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: finalScore,
          sessionToken: sessionTokenRef.current,
          passes,
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
        console.error(`[Swerve] Score rejected (${response.status}): ${reason}`);
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

  // ── Floating bonus text (presentation only) ──
  const addFloater = useCallback(
    (text: string, lane: number, kind: Floater['kind']) => {
      const id = (floaterIdRef.current += 1);
      setFloaters((prev) => [...prev.slice(-5), { id, text, lane, kind }]);
      window.setTimeout(() => {
        setFloaters((prev) => prev.filter((f) => f.id !== id));
      }, calloutLifeMs(reducedMotionRef.current, 950));
    },
    [],
  );

  // ── Crash spectacle (matter.js debris during slow-mo) ──────────────────────
  const finishCrash = useCallback(() => {
    const crash = crashStateRef.current;
    if (crash) {
      const M = matterModRef.current;
      if (M) M.Engine.clear(crash.engine);
      crashStateRef.current = null;
    }
    cancelAnimationFrame(crashRafRef.current);
    window.clearTimeout(crashTimeoutRef.current);
    // Debris stays visible — the wreck sits under the results overlay until the
    // next run resets it.
    gameOverTimeRef.current = performance.now();
    gameStateRef.current = 'gameover';
    setGameState('gameover');
  }, []);

  const crashLoop = useCallback(
    (now: number) => {
      const crash = crashStateRef.current;
      const camera = cameraRef.current;
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const M = matterModRef.current;
      if (!crash || !camera || !renderer || !scene || !M) {
        finishCrash();
        return;
      }
      const progress = Math.min(1, (now - crash.start) / CRASH_DURATION_MS);
      const dt = Math.min(50, now - crash.last);
      crash.last = now;

      // Slow-mo 2D tumble; positions map onto the 3D debris meshes below.
      M.Engine.update(crash.engine, Math.max(1, dt * CRASH_SLOWMO));

      const debris = debrisRef.current;
      for (let i = 0; i < debris.length && i < crash.bodies.length; i += 1) {
        const piece = debris[i]!;
        const body = crash.bodies[i]!;
        piece.mesh.position.x = body.position.x;
        piece.mesh.position.z = body.position.y;
        // Fake vertical arc (the matter sim is a top-down plane).
        const arc = Math.sin(Math.min(1, progress * 1.6) * Math.PI);
        piece.mesh.position.y = piece.baseY + piece.arcAmp * arc * (1 - progress * 0.6);
        piece.mesh.rotation.y = -body.angle;
        piece.mesh.rotation.x = piece.spin * progress * 6;
      }

      // Camera: pull back + orbit the wreck while the shake decays.
      const angle = progress * 0.9;
      const radius = CAM_BACK + 1.4 + progress * 2.2;
      const shake = shakeRef.current;
      camera.position.set(
        crash.carX * 0.4 + Math.sin(angle) * radius * 0.55 + (shake > 0 ? Math.sin(now * 0.09) * shake * 0.5 : 0),
        CAM_HEIGHT + 0.6 + progress * 1.3,
        CAR_Z + Math.cos(angle) * radius,
      );
      camera.lookAt(crash.carX, 0.5, 0);
      if (shake > 0) shakeRef.current = Math.max(0, shake - 0.05);

      renderer.render(scene, camera);

      if (progress >= 1) {
        finishCrash();
        return;
      }
      crashRafRef.current = requestAnimationFrame(crashLoop);
    },
    [finishCrash],
  );

  const beginCrash = useCallback(() => {
    const M = matterModRef.current;
    const car = carRef.current;
    const debris = debrisRef.current;
    // Reduced motion / matter unavailable → brief pause, straight to results.
    if (!M || !car || debris.length === 0 || reducedMotionRef.current) {
      shakeRef.current = reducedMotionRef.current ? 0 : 1;
      crashTimeoutRef.current = window.setTimeout(finishCrash, 420);
      return;
    }

    const carX = (laneFloatRef.current - (LANE_COUNT - 1) / 2) * LANE_SPACING;
    car.visible = false;

    // Top-down 2D matter world: x = world x, matter y = world z. Static walls
    // at the rails so debris ricochets off the road edges.
    const engine = M.Engine.create();
    engine.gravity.x = 0;
    engine.gravity.y = 0;
    const wallL = M.Bodies.rectangle(-ROAD_HALF_W - 0.25, CAR_Z, 0.5, 40, { isStatic: true });
    const wallR = M.Bodies.rectangle(ROAD_HALF_W + 0.25, CAR_Z, 0.5, 40, { isStatic: true });
    const bodies: import('matter-js').Body[] = [];
    for (let i = 0; i < debris.length; i += 1) {
      const piece = debris[i]!;
      const isWreck = i === 0;
      const size = isWreck ? [1.4, 2.2] : [0.35, 0.35];
      const body = M.Bodies.rectangle(
        carX + (isWreck ? 0 : (Math.random() - 0.5) * 1.2),
        CAR_Z + (isWreck ? 0 : (Math.random() - 0.5) * 1.4),
        size[0]!,
        size[1]!,
        { frictionAir: 0.028, restitution: 0.55, friction: 0.05 },
      );
      // Impact: the wreck skids back toward the camera, shards spray outward.
      M.Body.setVelocity(body, {
        x: (Math.random() - 0.5) * (isWreck ? 0.06 : 0.16),
        y: (isWreck ? 0.05 : 0.03 + Math.random() * 0.13),
      });
      M.Body.setAngularVelocity(body, (Math.random() - 0.5) * (isWreck ? 0.12 : 0.3));
      bodies.push(body);
      piece.mesh.visible = true;
      piece.mesh.position.set(body.position.x, piece.baseY, body.position.y);
    }
    M.Composite.add(engine.world, [wallL, wallR, ...bodies]);

    const now = performance.now();
    crashStateRef.current = { engine, bodies, start: now, last: now, carX };
    shakeRef.current = 1;
    crashRafRef.current = requestAnimationFrame(crashLoop);
  }, [crashLoop, finishCrash]);

  // ── End the run (collision) ──
  const endRun = useCallback(() => {
    if (gameStateRef.current !== 'playing') return;
    SoundManager.play(SFX.crash);
    setTimeout(() => SoundManager.play(SFX.debris), 90);
    gameStateRef.current = 'crashing';
    setGameState('crashing');
    setCombo(0);
    cancelAnimationFrame(animationRef.current);
    if (scoreRef.current > highScore) setHighScore(scoreRef.current);
    setRowsCleared(passesRef.current.length);
    saveScoreRef.current?.(scoreRef.current, passesRef.current.slice());
    beginCrash();
  }, [beginCrash, highScore]);
  endRunRef.current = endRun;

  // Instantiate upcoming rows so the next VISIBLE_ROW_LOOKAHEAD scheduled rows
  // always exist for rendering. Row geometry/points come from the seeded layout
  // (the same createSwerveLayout the server verifier walks).
  const ensureRowsSpawned = useCallback(() => {
    const layout = layoutRef.current;
    if (!layout) return;
    const rows = rowsRef.current;
    const judged = passesRef.current.length;
    const target = judged + 1 + VISIBLE_ROW_LOOKAHEAD;
    while (nextSpawnRowRef.current <= target) {
      const rowIndex = nextSpawnRowRef.current;
      rows.push({
        info: layout.rowInfo(rowIndex),
        scheduledT: minTimeForRowMs(rowIndex) + SWERVE_LEAD_IN_MS,
        scored: false,
      });
      nextSpawnRowRef.current = rowIndex + 1;
    }
  }, []);

  // ── One fixed sim step (FRAME_TIME ms of run time) ──
  const stepSim = useCallback(() => {
    const rows = rowsRef.current;

    // Advance the run-relative sim clock by exactly one fixed step. The recorded
    // pass `t` is read from this clock, so it stays byte-aligned with the
    // schedule the server replay validates (no wall-clock jitter).
    elapsedMsRef.current += FRAME_TIME;
    const elapsed = elapsedMsRef.current;

    // Eased lane tween (SWERVE_LANE_CHANGE_MS per lane — the generation contract).
    const target = laneRef.current;
    const dur = Math.max(1, tweenDurRef.current);
    const p = Math.min(1, (elapsed - tweenStartRef.current) / dur);
    const ease = 1 - (1 - p) * (1 - p) * (1 - p); // easeOutCubic
    laneFloatRef.current =
      tweenFromRef.current + (target - tweenFromRef.current) * ease;

    // Visual speed factor eases toward the ramp's current pace.
    const nextRow = passesRef.current.length + 1;
    const speedTarget = SWERVE_BASE_ROW_INTERVAL_MS / rowIntervalMs(nextRow);
    speedRef.current += (speedTarget - speedRef.current) * 0.03;
    phaseRef.current += FRAME_TIME * BASE_UNITS_PER_MS * speedRef.current;

    // Resolve any row that has reached the player's line this step (elapsed has
    // caught up to its scheduled arrival time). Rows are instantiated in order,
    // so judging by scheduledT keeps passes sequential 1,2,3,…
    const carLane = laneRef.current;
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i]!;
      if (r.scored) continue;
      if (elapsed >= r.scheduledT) {
        r.scored = true;
        if (r.info.blocked.includes(carLane)) {
          endRun();
          return;
        }
        // Safe pass → credit the row's seed-derived points and record
        // { row, lane } for the authoritative replay. `t` is the row's
        // scheduled arrival on the sim clock (== the server's
        // minTimeForRowMs(row) + the constant lead-in), so the recorded log
        // always clears the replay's earliest-arrival + per-row-interval bounds.
        scoreRef.current += r.info.points;
        setScore(scoreRef.current);
        setCombo(r.info.streak);
        if (r.info.forced) {
          SoundManager.play(SFX.whoosh, { volume: 0.7 });
          SoundManager.play(SFX.pass, { pitch: 1 + 0.08 * Math.min(4, r.info.streak) });
          fovKickRef.current = 1;
          addFloater(
            `+${r.info.points} CLOSE CALL${r.info.streak > 1 ? ` ×${r.info.streak}` : ''}`,
            carLane,
            r.info.streak > 1 ? 'combo' : 'bonus',
          );
        } else {
          SoundManager.play(SFX.pass);
        }
        passesRef.current.push({
          row: r.info.row,
          lane: carLane,
          t: Math.max(0, r.scheduledT),
        });
      }
    }

    // Drop rows well past the player + keep the lookahead full.
    if (rows.length > 0) {
      rowsRef.current = rows.filter((r) => elapsed - r.scheduledT < 900);
    }
    ensureRowsSpawned();
  }, [addFloater, endRun, ensureRowsSpawned]);

  // ── Build the three.js scene once (road, lights, car, traffic pool, debris). ──
  const buildScene = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || rendererRef.current) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch {
      setWebglError(true);
      return;
    }
    renderer.setPixelRatio(gameCanvasDpr(BASE_WIDTH, BASE_HEIGHT));
    renderer.shadowMap.enabled = true; // default PCF (PCFSoft is deprecated in r185)
    rendererRef.current = renderer;

    // Mobile Safari can evict the GL context under memory pressure or app
    // switching. Save the in-flight run, swap to the fallback panel, and
    // block new runs (startGame guards on rendererRef) instead of wedging
    // on a blank canvas.
    canvas.addEventListener(
      'webglcontextlost',
      (e) => {
        e.preventDefault();
        endRunRef.current?.();
        setWebglError(true);
        rendererRef.current = null;
        renderer.dispose();
      },
      { once: true },
    );

    const t = themeRef.current;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(t.skyColor);
    scene.fog = new THREE.Fog(new THREE.Color(t.fogColor).getHex(), FOG_NEAR, FOG_FAR);
    sceneRef.current = scene;

    // Chase camera: behind + above the car, player in the lower third, most of
    // the frame is upcoming road. FOV widens with speed in render3D.
    const camera = new THREE.PerspectiveCamera(CAM_FOV_BASE, 1, 0.1, 220);
    camera.position.set(0, CAM_HEIGHT, CAR_Z + CAM_BACK);
    camera.lookAt(0, 0.7, -9);
    cameraRef.current = camera;

    // Warm key light + soft fill. The hemisphere light's sky tint = environment
    // accent, ground bounce = environment groundColor.
    const hemi = new THREE.HemisphereLight(
      new THREE.Color(t.accentColor).getHex(),
      new THREE.Color(t.groundColor).getHex(),
      0.75,
    );
    scene.add(hemi);
    scene.add(new THREE.AmbientLight(0xfff0d8, 0.3));
    const key = new THREE.DirectionalLight(0xfff1d6, 1.2);
    key.position.set(-7, 13, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 60;
    key.shadow.camera.left = -10;
    key.shadow.camera.right = 10;
    key.shadow.camera.top = 14;
    key.shadow.camera.bottom = -40;
    scene.add(key);

    const railLen = FOG_FAR + 26;
    const roadZ = -railLen / 2 + 10;

    // Road deck (track slot: trackColor).
    const roadMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(t.roadColor),
      roughness: 0.9,
      metalness: 0.04,
    });
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_HALF_W * 2, railLen),
      roadMat,
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, roadZ);
    road.receiveShadow = true;
    scene.add(road);

    // Shoulder strips outside the rails, in the environment ground color, so
    // the road reads as a ribbon through the fogged world.
    const shoulderMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(t.groundColor),
      roughness: 1,
    });
    for (const sx of [-1, 1]) {
      const shoulder = new THREE.Mesh(
        new THREE.PlaneGeometry(6, railLen),
        shoulderMat,
      );
      shoulder.rotation.x = -Math.PI / 2;
      shoulder.position.set(sx * (ROAD_HALF_W + 3.2), -0.02, roadZ);
      scene.add(shoulder);
    }

    // Side rails (raised guard rail + bright top cap; track slot: edgeColor).
    const railMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(t.railColor),
      roughness: 0.85,
    });
    const railTopMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(t.railTopColor),
      roughness: 0.7,
    });
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, railLen), railMat);
      rail.position.set(sx * ROAD_HALF_W, 0.32, roadZ);
      rail.castShadow = true;
      rail.receiveShadow = true;
      scene.add(rail);
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(0.56, 0.12, railLen),
        railTopMat,
      );
      cap.position.set(sx * ROAD_HALF_W, 0.7, roadZ);
      scene.add(cap);
    }

    // Continuous lane dividers (track slot: laneLineColor recolors both).
    const dividerRedMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(t.laneLineRed),
      roughness: 0.5,
    });
    const dividerTealMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(t.laneLineTeal),
      roughness: 0.5,
    });
    const dividers: Array<[number, THREE.MeshStandardMaterial]> = [
      [-LANE_SPACING / 2, dividerRedMat],
      [LANE_SPACING / 2, dividerTealMat],
    ];
    for (const [dx, mat] of dividers) {
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.06, railLen),
        mat,
      );
      strip.position.set(dx, 0.04, roadZ);
      scene.add(strip);
    }

    // Scrolling road stripes (sell forward speed; recycled in render3D).
    const tieGeo = new THREE.BoxGeometry(ROAD_HALF_W * 2 - 0.4, 0.05, 0.42);
    const tieMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(t.tieColor),
      roughness: 0.9,
    });
    const ties: THREE.Mesh[] = [];
    for (let i = 0; i < TIE_COUNT; i += 1) {
      const tie = new THREE.Mesh(tieGeo, tieMat);
      tie.position.set(0, 0.03, 0);
      tie.receiveShadow = true;
      scene.add(tie);
      ties.push(tie);
    }
    tiesRef.current = ties;

    // Roadside posts with warm lamp heads (regular spacing = speedometer for
    // the eye; recycled in render3D like the ties).
    const headMatShared = new THREE.MeshStandardMaterial({
      color: C3.headlight,
      emissive: C3.headlight,
      emissiveIntensity: 0.5,
      roughness: 0.4,
    });
    const posts: THREE.Group[] = [];
    for (let i = 0; i < POST_PAIRS * 2; i += 1) {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.7, 0.14), railTopMat);
      pole.position.y = 0.85;
      g.add(pole);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 0.24), headMatShared);
      lamp.position.y = 1.78;
      g.add(lamp);
      g.position.set((i % 2 === 0 ? -1 : 1) * (ROAD_HALF_W + 0.9), 0, 0);
      scene.add(g);
      posts.push(g);
    }
    postsRef.current = posts;

    // ── Traffic car pool (low-poly oncoming cars; body swaps red/teal). ──
    const red = new THREE.MeshStandardMaterial({ color: new THREE.Color(t.blockRed), roughness: 0.38, metalness: 0.12 });
    const teal = new THREE.MeshStandardMaterial({ color: new THREE.Color(t.blockTeal), roughness: 0.38, metalness: 0.12 });
    blockMatsRef.current = { red, teal };
    const cabinMat = new THREE.MeshStandardMaterial({ color: C3.trafficCabin, roughness: 0.3, metalness: 0.3 });
    const wheelMatShared = new THREE.MeshStandardMaterial({ color: C3.wheel, roughness: 0.85 });
    const bodyGeo = new THREE.BoxGeometry(1.5, 0.52, 2.3);
    const cabinGeo = new THREE.BoxGeometry(1.16, 0.4, 1.05);
    const wheelsGeo = new THREE.BoxGeometry(1.62, 0.32, 0.5);
    const lightGeo = new THREE.BoxGeometry(1.24, 0.12, 0.07);
    const traffic: TrafficCar[] = [];
    for (let i = 0; i < TRAFFIC_POOL; i += 1) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, red);
      body.position.y = 0.56;
      body.castShadow = true;
      group.add(body);
      const cabin = new THREE.Mesh(cabinGeo, cabinMat);
      cabin.position.set(0, 1.0, 0.14);
      cabin.castShadow = true;
      group.add(cabin);
      const wheelsF = new THREE.Mesh(wheelsGeo, wheelMatShared);
      wheelsF.position.set(0, 0.3, 0.72);
      group.add(wheelsF);
      const wheelsB = new THREE.Mesh(wheelsGeo, wheelMatShared);
      wheelsB.position.set(0, 0.3, -0.72);
      group.add(wheelsB);
      // Oncoming: headlights face the player (+z).
      const lights = new THREE.Mesh(lightGeo, headMatShared);
      lights.position.set(0, 0.56, 1.18);
      group.add(lights);
      group.visible = false;
      scene.add(group);
      traffic.push({ group, body, cabin });
    }
    trafficPoolRef.current = traffic;

    // Safe-gap hint dots (presentation): mark the open lane of forced rows.
    const hintMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(t.accentColor),
      emissive: new THREE.Color(t.accentColor),
      emissiveIntensity: 0.8,
      roughness: 0.4,
    });
    const hintGeo = new THREE.SphereGeometry(0.1, 8, 8);
    const hints: THREE.Mesh[] = [];
    for (let i = 0; i < HINT_POOL; i += 1) {
      const dot = new THREE.Mesh(hintGeo, hintMat);
      dot.visible = false;
      scene.add(dot);
      hints.push(dot);
    }
    hintPoolRef.current = hints;

    // ── The player's car (built from primitives, seen from behind). ──
    const car = new THREE.Group();
    // Cart slot: cartPrimary (body) / cartSecondary (roof) + optional cartGlow
    // emissive (neutral/off by default).
    const bodyMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(t.cartBody),
      roughness: 0.45,
      metalness: 0.16,
      emissive: new THREE.Color(t.cartGlow || '#000000'),
      emissiveIntensity: t.cartGlow ? t.cartGlowIntensity : 0,
    });
    const roofMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(t.cartRoof),
      roughness: 0.5,
      metalness: 0.1,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(t.cartGlass),
      roughness: 0.12,
      metalness: 0.45,
    });
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 2.6), bodyMat);
    chassis.position.y = 0.5;
    chassis.castShadow = true;
    car.add(chassis);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 1.3), roofMat);
    cabin.position.set(0, 0.95, 0.06);
    cabin.castShadow = true;
    car.add(cabin);
    for (const [gz, label] of [[0.68, 'rear'], [-0.58, 'front']] as const) {
      const glass = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.36, 0.08), glassMat);
      glass.position.set(0, 0.98, gz);
      glass.userData.label = label;
      car.add(glass);
    }
    const stripeMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(t.cartStripe),
      roughness: 0.4,
    });
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 1.1), stripeMat);
    stripe.position.set(0, 0.77, -0.85);
    car.add(stripe);
    const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.28, 16);
    const wheelMat = new THREE.MeshStandardMaterial({ color: C3.wheel, roughness: 0.85 });
    const hubMat = new THREE.MeshStandardMaterial({ color: C3.hub, roughness: 0.5, metalness: 0.5 });
    for (const wx of [-0.82, 0.82]) {
      for (const wz of [-0.86, 0.96]) {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(wx, 0.34, wz);
        w.castShadow = true;
        car.add(w);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.3, 10), hubMat);
        hub.rotation.z = Math.PI / 2;
        hub.position.set(wx + (wx > 0 ? 0.01 : -0.01), 0.34, wz);
        car.add(hub);
      }
    }
    const tailMat = new THREE.MeshStandardMaterial({ color: C3.taillight, emissive: C3.taillight, emissiveIntensity: 0.55, roughness: 0.4 });
    for (const lx of [-0.5, 0.5]) {
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.06), tailMat);
      tail.position.set(lx, 0.52, 1.32);
      car.add(tail);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.06), headMatShared);
      head.position.set(lx, 0.5, -1.32);
      car.add(head);
    }
    car.position.set(0, 0, CAR_Z); // nose at the judge line (z ≈ 0)
    carRef.current = car;
    scene.add(car);

    // ── Crash debris pool (driven by the matter.js sim; hidden until a crash). ──
    const debrisDims: Array<[number, number, number]> = [
      [1.4, 0.45, 2.2], // the wreck body (index 0)
      [0.42, 0.2, 0.34], [0.3, 0.16, 0.42], [0.36, 0.2, 0.3], [0.26, 0.14, 0.3],
      [0.4, 0.18, 0.26], [0.3, 0.2, 0.36], [0.24, 0.14, 0.4], [0.34, 0.16, 0.28],
      [0.28, 0.2, 0.32], [0.38, 0.14, 0.24], [0.26, 0.18, 0.34],
    ];
    const debrisMats = [bodyMat, roofMat, red, wheelMat];
    const debris: DebrisPiece[] = [];
    for (let i = 0; i < DEBRIS_COUNT; i += 1) {
      const dims = debrisDims[i % debrisDims.length]!;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(dims[0], dims[1], dims[2]),
        i === 0 ? bodyMat : debrisMats[i % debrisMats.length]!,
      );
      mesh.castShadow = true;
      mesh.visible = false;
      scene.add(mesh);
      debris.push({
        mesh,
        arcAmp: i === 0 ? 0.12 : 0.5 + (i % 5) * 0.28,
        spin: i === 0 ? 0.1 : ((i % 3) - 1) * 1.4,
        baseY: i === 0 ? 0.4 : 0.24,
      });
    }
    debrisRef.current = debris;

    // Capture themeable materials/lights so applySwerveTheme() can recolor them
    // live when an equipped skin loads after the scene is built.
    themeMatsRef.current = {
      road: roadMat,
      rail: railMat,
      railTop: railTopMat,
      dividerRed: dividerRedMat,
      dividerTeal: dividerTealMat,
      tie: tieMat,
      carBody: bodyMat,
      carRoof: roofMat,
      carStripe: stripeMat,
      carGlass: glassMat,
      hint: hintMat,
      hemi,
    };
  }, []);

  // ── Recolor the live scene from the current theme (idempotent). Called after
  //    buildScene and whenever the equipped cosmetics change. ──
  const applySwerveTheme = useCallback(() => {
    const scene = sceneRef.current;
    const mats = themeMatsRef.current;
    const t = themeRef.current;
    if (scene) {
      if (scene.background instanceof THREE.Color) {
        scene.background.set(t.skyColor);
      } else {
        scene.background = new THREE.Color(t.skyColor);
      }
      if (scene.fog instanceof THREE.Fog) scene.fog.color.set(t.fogColor);
    }
    if (mats) {
      mats.road.color.set(t.roadColor);
      mats.rail.color.set(t.railColor);
      mats.railTop.color.set(t.railTopColor);
      mats.dividerRed.color.set(t.laneLineRed);
      mats.dividerTeal.color.set(t.laneLineTeal);
      mats.tie.color.set(t.tieColor);
      mats.carBody.color.set(t.cartBody);
      mats.carRoof.color.set(t.cartRoof);
      mats.carStripe.color.set(t.cartStripe);
      mats.carGlass.color.set(t.cartGlass);
      mats.carBody.emissive.set(t.cartGlow || '#000000');
      mats.carBody.emissiveIntensity = t.cartGlow ? t.cartGlowIntensity : 0;
      mats.hint.color.set(t.accentColor);
      mats.hint.emissive.set(t.accentColor);
      mats.hemi.color.set(t.accentColor);
      mats.hemi.groundColor.set(t.groundColor);
    }
    const blocks = blockMatsRef.current;
    if (blocks) {
      blocks.red.color.set(t.blockRed);
      blocks.teal.color.set(t.blockTeal);
    }
  }, []);

  // ── Per-frame: map the car's lane float + each row's (scheduledT − elapsed)
  //    into the 3D scene, then render. Purely cosmetic — the sim drives it. ──
  const render3D = useCallback(() => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const car = carRef.current;
    if (!renderer || !scene || !camera || !car) return;
    if (gameStateRef.current === 'crashing') return; // crashLoop renders

    const elapsed = elapsedMsRef.current;
    const reduced = reducedMotionRef.current;
    const speed = speedRef.current;
    const unitsPerMs = BASE_UNITS_PER_MS * speed;
    const speedNorm = Math.max(0, Math.min(1, (speed - 1) / 0.6));

    // Car lateral position + lane-change bank/lean with spring-back.
    const laneFloat = laneFloatRef.current;
    const carX = (laneFloat - (LANE_COUNT - 1) / 2) * LANE_SPACING;
    const vel = laneFloat - prevLaneFloatRef.current; // lanes per sim step
    prevLaneFloatRef.current = laneFloat;
    car.position.x = carX;
    car.position.y = reduced ? 0 : Math.sin(elapsed * 0.006) * 0.02;
    const lean = Math.max(-0.42, Math.min(0.42, vel * (reduced ? 0.8 : 2.6)));
    car.rotation.z = -lean;
    car.rotation.y = lean * 0.55;

    // Chase camera: eased lateral follow + speed shake + widening FOV.
    const shake = shakeRef.current;
    camXRef.current += (carX * 0.55 - camXRef.current) * 0.12;
    const idleShake = reduced ? 0 : 0.02 * speedNorm;
    const sx = (shake > 0 ? Math.sin(elapsed * 0.09) * shake * 0.5 : 0) + Math.sin(elapsed * 0.021) * idleShake;
    const sy = (shake > 0 ? Math.sin(elapsed * 0.13) * shake * 0.35 : 0) + Math.sin(elapsed * 0.017) * idleShake;
    camera.position.set(camXRef.current + sx, CAM_HEIGHT + sy, CAR_Z + CAM_BACK);
    camera.lookAt(camXRef.current * 0.6, 0.7, -9);
    camera.rotation.z += -lean * 0.12; // small roll into the swerve
    if (shake > 0) shakeRef.current = Math.max(0, shake - 0.08);

    // FOV widens with speed (+ a near-miss micro kick), eased.
    const fovKick = fovKickRef.current;
    const fovTarget =
      CAM_FOV_BASE + (reduced ? 0 : CAM_FOV_SPAN * speedNorm + fovKick * 3.5);
    currentFovRef.current += (fovTarget - currentFovRef.current) * 0.08;
    if (Math.abs(camera.fov - currentFovRef.current) > 0.02) {
      camera.fov = currentFovRef.current;
      camera.updateProjectionMatrix();
    }
    if (fovKick > 0) fovKickRef.current = Math.max(0, fovKick - 0.06);

    // Scrolling road stripes + roadside posts (move toward the camera, wrap).
    const phase = reduced ? 0 : phaseRef.current;
    const ties = tiesRef.current;
    const tieSpan = TIE_COUNT * TIE_SPACING;
    for (let i = 0; i < ties.length; i += 1) {
      const z = ((((i * TIE_SPACING + phase) % tieSpan) + tieSpan) % tieSpan) - tieSpan + 10;
      ties[i]!.position.z = z;
    }
    const posts = postsRef.current;
    const postSpan = POST_PAIRS * POST_SPACING;
    for (let i = 0; i < posts.length; i += 1) {
      const pairIndex = Math.floor(i / 2);
      const z =
        ((((pairIndex * POST_SPACING + phase) % postSpan) + postSpan) % postSpan) -
        postSpan +
        10;
      posts[i]!.position.z = z;
    }

    // Traffic cars from the visible rows (each row's depth from its schedule).
    const pool = trafficPoolRef.current;
    const mats = blockMatsRef.current;
    const hints = hintPoolRef.current;
    const rows = rowsRef.current;
    let p = 0;
    let h = 0;
    if (mats) {
      for (let i = 0; i < rows.length; i += 1) {
        const r = rows[i]!;
        const z = -(r.scheduledT - elapsed) * unitsPerMs;
        // Skip cars beyond the fog or already past the player's rear bumper.
        if (z > CAR_Z + 2.6 || z < -(FOG_FAR + 5)) continue;
        const mat = r.info.row % 2 === 1 ? mats.teal : mats.red;
        for (const lane of r.info.blocked) {
          if (p >= pool.length) break;
          const t = pool[p]!;
          t.group.visible = true;
          t.body.material = mat;
          t.group.position.set(
            (lane - (LANE_COUNT - 1) / 2) * LANE_SPACING,
            0,
            z,
          );
          p += 1;
        }
        // Safe-gap hint dot on forced rows still ahead (presentation only —
        // the safe lane is seed-derived, the same data the server verifies).
        if (r.info.forced && z < -4 && h < hints.length) {
          const safe = r.info.safeReachableLanes[0] ?? 1;
          const dot = hints[h]!;
          dot.visible = true;
          dot.position.set(
            (safe - (LANE_COUNT - 1) / 2) * LANE_SPACING,
            0.14 + (reduced ? 0 : Math.sin(elapsed * 0.008 + r.info.row) * 0.05),
            z,
          );
          h += 1;
        }
      }
    }
    for (let i = p; i < pool.length; i += 1) pool[i]!.group.visible = false;
    for (let i = h; i < hints.length; i += 1) hints[i]!.visible = false;

    renderer.render(scene, camera);
  }, []);

  // Resize the renderer + camera to the stage box (CSS size kept by the JSX).
  const resize3D = useCallback((w: number, h: number) => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!renderer || !camera) return;
    renderer.setPixelRatio(gameCanvasDpr(w, h));
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }, []);

  const gameLoop = useCallback(
    (currentTime: number) => {
      if (!rendererRef.current) return;

      let deltaTime = currentTime - lastTimeRef.current;
      lastTimeRef.current = currentTime;
      if (deltaTime > 100) deltaTime = FRAME_TIME;

      accumulatorRef.current += deltaTime;
      let updates = 0;
      const maxUpdates = 4;
      while (accumulatorRef.current >= FRAME_TIME && updates < maxUpdates) {
        stepSim();
        if (gameStateRef.current !== 'playing') {
          // endRun fired inside stepSim; the crash loop owns rendering now.
          accumulatorRef.current = 0;
          return;
        }
        accumulatorRef.current -= FRAME_TIME;
        updates += 1;
      }
      if (updates >= maxUpdates) accumulatorRef.current = 0;

      render3D();

      animationRef.current = requestAnimationFrame(gameLoop);
    },
    [render3D, stepSim],
  );

  const resetRun = useCallback(() => {
    cancelAnimationFrame(animationRef.current);
    cancelAnimationFrame(crashRafRef.current);
    window.clearTimeout(crashTimeoutRef.current);
    crashStateRef.current = null;
    scoreRef.current = 0;
    setScore(0);
    setRowsCleared(0);
    setCombo(0);
    setFloaters([]);
    laneRef.current = 1;
    laneFloatRef.current = 1;
    prevLaneFloatRef.current = 1;
    tweenFromRef.current = 1;
    tweenStartRef.current = -1_000;
    tweenDurRef.current = SWERVE_LANE_CHANGE_MS;
    passesRef.current = [];
    rowsRef.current = [];
    nextSpawnRowRef.current = 1;
    elapsedMsRef.current = 0;
    speedRef.current = 1;
    phaseRef.current = 0;
    shakeRef.current = 0;
    fovKickRef.current = 0;
    camXRef.current = 0;
    currentFovRef.current = CAM_FOV_BASE;
    const car = carRef.current;
    if (car) {
      car.visible = true;
      car.rotation.set(0, 0, 0);
    }
    for (const d of debrisRef.current) d.mesh.visible = false;
    layoutRef.current =
      seedRef.current !== null ? createSwerveLayout(seedRef.current) : null;
    ensureRowsSpawned();
    lastTimeRef.current = performance.now();
    gameStartTimeRef.current = lastTimeRef.current;
    accumulatorRef.current = 0;
  }, [ensureRowsSpawned]);

  const startGame = useCallback(async () => {
    resetRunResult();
    if (isStartingRef.current) return;
    // No renderer → WebGL is unavailable (the fallback panel is showing).
    // Without this guard a Space press would still open a server session and
    // wedge the state machine in 'playing' with nothing to render.
    if (!rendererRef.current) return;
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

    // Prefetch matter.js for the crash spectacle (non-blocking; crash falls
    // back to a simple cut if it hasn't landed yet).
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
        body: JSON.stringify({ gameType: 'swerve' }),
      });
      if (sessionResponse.ok) {
        setBanIndefinite(false);
        setBanUntilMs(null);
        const sessionData = await sessionResponse.json();
        sessionTokenRef.current = sessionData.token;
        seedRef.current =
          typeof sessionData.swerveSeed === 'number'
            ? sessionData.swerveSeed
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

    resetRun();
    gameStateRef.current = 'playing';
    setGameState('playing');
    SoundManager.play(SFX.start);
    animationRef.current = requestAnimationFrame(gameLoop);
  }, [gameLoop, resetRun, resetRunResult]);

  // ── Steering. Buffered by design: steering re-targets the eased tween from
  //    the car's CURRENT visual position, so inputs mid-tween chain smoothly.
  const steer = useCallback(
    (dir: -1 | 1) => {
      if (gameStateRef.current !== 'playing') return;
      const next = Math.max(0, Math.min(LANE_COUNT - 1, laneRef.current + dir));
      if (next !== laneRef.current) {
        laneRef.current = next;
        tweenFromRef.current = laneFloatRef.current;
        tweenStartRef.current = elapsedMsRef.current;
        tweenDurRef.current = Math.max(
          60,
          SWERVE_LANE_CHANGE_MS * Math.abs(next - laneFloatRef.current),
        );
        SoundManager.play(SFX.move);
      }
    },
    [],
  );

  // ── Generic "primary action": start / restart ──
  const primaryAction = useCallback(() => {
    const current = gameStateRef.current;
    if (current === 'idle' || current === 'error') {
      startGame();
    } else if (current === 'gameover') {
      const since = performance.now() - gameOverTimeRef.current;
      if (since >= RESTART_GRACE_PERIOD) startGame();
    }
  }, [startGame]);

  // ── Keyboard ──
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        if (gameStateRef.current === 'playing') {
          e.preventDefault();
          steer(-1);
        }
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        if (gameStateRef.current === 'playing') {
          e.preventDefault();
          steer(1);
        }
      } else if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'Enter') {
        if (e.repeat) return;
        if (gameStateRef.current !== 'playing' && gameStateRef.current !== 'crashing') {
          e.preventDefault();
          primaryAction();
        }
      }
    },
    [primaryAction, steer],
  );

  // ── Touch: tap left/right half to steer; swipe also steers. Tap on overlay
  //    starts/restarts (handled by the overlay's own pointer handler). ──
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (gameStateRef.current === 'crashing') return;
      if (gameStateRef.current !== 'playing') {
        primaryAction();
        return;
      }
      touchStartXRef.current = e.clientX;
      touchStartYRef.current = e.clientY;
      // Immediate tap-to-steer based on which half of the canvas was pressed.
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const rel = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
        steer(rel < 0.5 ? -1 : 1);
      }
    },
    [primaryAction, steer],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (gameStateRef.current !== 'playing') return;
      const sx = touchStartXRef.current;
      const sy = touchStartYRef.current;
      touchStartXRef.current = null;
      touchStartYRef.current = null;
      if (sx === null || sy === null) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      // A clear horizontal swipe steers in that direction (in addition to the
      // tap-to-steer already applied on down — but only if it's a fresh lane).
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
        steer(dx < 0 ? -1 : 1);
      }
    },
    [steer],
  );

  // ── Effects ──
  // Reduced-motion preference (crash spectacle, shakes, and FOV play only).
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

  // Responsive sizing — the canvas fills the tall stage (mirrors breakout).
  useEffect(() => {
    const updateSize = () => {
      const container = containerRef.current;
      if (!container) return;
      const reservedVertical = window.innerHeight < 700 ? 200 : 260;
      const maxWidth = Math.min(window.innerWidth - 24, 560);
      const maxHeight = Math.min(window.innerHeight - reservedVertical, BASE_HEIGHT);
      const scale = Math.min(maxWidth / BASE_WIDTH, maxHeight / BASE_HEIGHT, 1.25);
      const width = Math.floor(BASE_WIDTH * scale);
      const height = Math.floor(BASE_HEIGHT * scale);
      const dpr = gameCanvasDpr(width, height);
      setCanvasSize({
        width,
        height,
        dpr,
      });
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Build the three.js scene once, then keep it sized + rendered to the stage.
  useEffect(() => {
    buildScene();
    resize3D(canvasSize.width, canvasSize.height);
    if (gameStateRef.current !== 'playing' && gameStateRef.current !== 'crashing') {
      render3D();
    }
  }, [buildScene, resize3D, render3D, canvasSize]);

  // Apply equipped cosmetics to the live scene. Runs after inventory loads (or
  // an equip change) and recolors materials/lights/fog in place. A still frame
  // is re-rendered when idle so the change shows immediately.
  useEffect(() => {
    themeRef.current = swerveTheme;
    applySwerveTheme();
    if (gameStateRef.current !== 'playing' && gameStateRef.current !== 'crashing') {
      render3D();
    }
  }, [swerveTheme, applySwerveTheme, render3D]);

  // Keyboard listeners.
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      cancelAnimationFrame(animationRef.current);
    };
  }, [handleKeyDown]);

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
    const monitor = envMonitorRef.current;
    return () => {
      cancelAnimationFrame(animationRef.current);
      cancelAnimationFrame(crashRafRef.current);
      window.clearTimeout(crashTimeoutRef.current);
      monitor.stop();
      // Dispose the three.js scene (geometries/materials/renderer) on unmount.
      const scene = sceneRef.current;
      if (scene) {
        scene.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
          const mat = mesh.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else if (mat) (mat as THREE.Material).dispose();
        });
      }
      rendererRef.current?.dispose();
      rendererRef.current = null;
      sceneRef.current = null;
    };
  }, []);

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
    <div className="swerve-midway arc-game-flow">
      <div className="w-full space-y-3 sm:space-y-4">
        <div className="mx-auto w-full max-w-3xl">
          <div className="hidden sm:block">
            <PageHeader
              eyebrow="Arcade"
              icon={<Navigation aria-hidden className="h-6 w-6" />}
              title="Swerve"
              subtitle="Weave through oncoming traffic. Thread the forced gaps for close-call streak bonuses."
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
            Best <span className="font-semibold text-strong">{highScore}</span>
          </span>
        </div>

        <div ref={containerRef} className="relative touch-none flex justify-center">
          <div
            className="swerve-stage relative"
            style={{ width: canvasSize.width, height: canvasSize.height }}
          >
            {webglError ? (
              <div
                className="flex flex-col items-center justify-center rounded-well border-2 border-ink px-6 text-center"
                style={{ width: canvasSize.width, height: canvasSize.height }}
              >
                <p className="text-sm text-strong">
                  Swerve needs WebGL, which this browser or device has disabled.
                </p>
                <p className="mt-2 text-xs text-body">
                  Enable hardware acceleration or try another browser to play.
                </p>
              </div>
            ) : (
              <>
                {/* three.js renders into this canvas (it manages the drawing buffer). */}
                <canvas
                  ref={canvasRef}
                  onPointerDown={handlePointerDown}
                  onPointerUp={handlePointerUp}
                  className="block cursor-pointer rounded-well border-2 border-ink"
                  style={{
                    touchAction: 'none',
                    width: canvasSize.width,
                    height: canvasSize.height,
                  }}
                />

                {/* Close-call combo chip (presentation only). */}
                {(gameState === 'playing' || gameState === 'crashing') && combo >= 2 && (
                  <div className="swerve-combo arcade-num" aria-hidden>
                    CLOSE CALLS ×{combo}
                  </div>
                )}

                {/* Floating bonus plate at the player's lane (presentation only). */}
                {floaters.map((f) => (
                  <span
                    key={f.id}
                    aria-hidden
                    className="arc-floater"
                    data-tone={f.kind === 'combo' ? 'combo' : 'score'}
                    style={
                      {
                        left: `${50 + (f.lane - 1) * 22}%`,
                        top: '64%',
                        '--callout-ms': `${calloutLifeMs(reducedMotion, 950)}ms`,
                      } as CSSProperties
                    }
                  >
                    <span className="arc-floater-label">{f.text.toLowerCase()}</span>
                  </span>
                ))}
              </>
            )}

            {gameState !== 'playing' && gameState !== 'crashing' && !webglError && (
              <div
                className="swerve-overlay absolute inset-0 flex touch-none flex-col items-center justify-center rounded-well px-4"
                style={{
                  background:
                    'color-mix(in srgb, var(--scrim) 78%, transparent)',
                }}
                onPointerDown={handlePointerDown}
              >
                {gameState === 'idle' && (
                  <>
                    <Navigation size={56} className="mb-4 text-tickets-text" />
                    <h1 className="arcade-display mb-2 text-center text-2xl text-strong uppercase sm:text-3xl">
                      Swerve
                    </h1>
                    <p className="mb-2 text-center text-sm text-strong sm:text-base">
                      {isStartingSession
                        ? 'Starting your run…'
                        : touchDevice
                          ? 'Tap to start — tap or swipe left/right to steer'
                          : 'Press Space or click to start'}
                    </p>
                    <p className="max-w-xs text-center text-xs text-body sm:text-sm">
                      Dodge the oncoming traffic. Threading a two-car gap is a
                      close call — chain them for bonus points.
                    </p>
                    {isStartingSession && (
                      <p className="mt-3 text-center text-xs text-body sm:text-sm">
                        Connecting to the game…
                      </p>
                    )}
                  </>
                )}

                {gameState === 'gameover' && (
                  <>
                    <h2 className="arcade-display mb-2 text-2xl text-strong uppercase sm:text-3xl">
                      Crashed
                    </h2>
                    <p className="mb-1 text-xl text-strong sm:text-2xl">
                      Scored <span className="arcade-num font-semibold">{score}</span>
                    </p>
                    <p className="mb-4 text-base text-body sm:text-lg">
                      {rowsCleared} rows dodged · Best{' '}
                      <span className="arcade-num">{highScore}</span>
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

        <p className="mt-3 text-center text-xs text-faint sm:text-sm">
          {touchDevice ? (
            'Tap or swipe left/right to switch lanes'
          ) : (
            <>
              Switch lanes with{' '}
              <kbd className="arcade-card-inset px-2 py-1 text-strong">←</kbd>{' '}
              <kbd className="arcade-card-inset px-2 py-1 text-strong">→</kbd> or
              A / D
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
        title="Swerve board"
        description="Highest traffic-dodging scores, and your rank."
      >
        <GameLeaderboard
          gameType="swerve"
          maxEntries={5}
          enableFullLeaderboardModal
          fullLeaderboardDisplay="inline"
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>
    </div>
  );
}
