'use client';

import { useState, useRef, useEffect, useCallback, type CSSProperties } from 'react';
import { Crosshair, CircleHelp } from 'lucide-react';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
import { GameLeaderboardButton } from '@/features/arcade/components/game-leaderboard-button';
import {
  PageHeader,
  GamesWalletCard,
} from '@/features/arcade/components/shell/page-header';
import { MuteButton } from '@/features/arcade/components/mute-button';
import { EnvMonitor } from '@/features/arcade/lib/game-anti-cheat';
import {
  usePreventGameGestures,
  useIsTouchDevice,
} from '@/features/arcade/lib/game-mobile-utils';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { playHaptic } from '@/features/arcade/lib/game-haptics';
import {
  createGameFrameLoop,
  gameCanvasDpr,
  type GameFrameLoop,
} from '@/features/arcade/lib/game-frame-loop';
import {
  applyMidwayEnvironment,
  disposeSceneDeep,
  emitSpriteParticles,
  expDamp,
  makePlankTextures,
  makeSoftDiscTexture,
  makeSparkTexture,
  makeSpriteParticlePool,
  resetSpriteParticles,
  setupMidwayRenderer,
  stepSpriteParticles,
  tuneMidwayKeyShadow,
  type SpriteParticle,
} from '@/features/arcade/lib/midway-three';
import { ArcadeRunRewards } from '@/features/arcade/components/results/arcade-run-result';
import { useArcadeRunResult } from '@/features/arcade/lib/run-result';
import type { AccountXpReward } from '@/server/arcade/rewards/types';
import * as THREE from 'three';
import {
  GUNRUSH_MAX_ROWS,
  HARD_MAX_COUNT,
  ROW_SPACING,
  TRACK_HALF_WIDTH,
  applyGate,
  gateRowScore,
  gatesForRow,
  initialRunState,
  isWaveRow,
  packSizeForRow,
  resolveWave,
  speedForRow,
  squadDps,
  waveForRow,
  waveRowScore,
  weaponForTier,
  type GunrushGate,
  type GunrushPick,
  type GunrushRunState,
  type GunrushWave,
} from '@/server/arcade/gunrush-replay';
import {
  DEFAULT_GUNRUSH_THEME,
  buildGunrushTheme,
  type GunrushCosmeticTheme,
  type GunrushInventoryResponse,
} from './_gunrush-theme';

import './_gunrush.css';
import { useFeelReducedMotion } from '@/features/arcade/lib/use-game-feedback';
import { calloutLifeMs, isNumericLabel } from '@/features/arcade/components/gameplay/callout-motion';

// ── Logical stage (the canvas fills this space; the 3D camera fills the rest) ──
const BASE_WIDTH = 520;
const BASE_HEIGHT = 620;

const RESTART_GRACE_PERIOD = 500;

// ── World layout ───────────────────────────────────────────────────────────
// The squad stays parked at z = 0 and the WORLD slides toward the camera: an
// object belonging to row r sits at z = −(r * ROW_SPACING − distanceTravelled).
// Keeping the player at the origin means no float drift on a long run.
//
// The track recedes into −z with the camera parked at +z looking down it. That
// orientation is not cosmetic: three.js builds the camera basis as X = Y × Z,
// so a camera looking toward +z would put world −x on the RIGHT of the screen
// and mirror both the steering and the left/right gates. Looking down −z keeps
// world +x on screen-right, which is what every helper below assumes.
const forwardZ = (aheadUnits: number) => -aheadUnits;
const GATE_HALF_SPAN = 4.6; // outer edge of each gate panel
const GATE_DIVIDER = 0.62; // |x| under this threads BETWEEN the gates
const GATE_PANEL_W = GATE_HALF_SPAN - GATE_DIVIDER;
const GATE_PANEL_H = 3.1;
const GATE_ROW_POOL = 4; // gate rows kept instantiated ahead of the squad
const FOG_NEAR = 26;
const FOG_FAR = 132; // ≈1.8 rows of telegraph — the next gate is always readable
const PLANK_SCROLL = 0.0065; // deck texture scroll per world unit

// Steering: the anchor eases toward the pointer/key target so a flick reads as
// the whole squad leaning, not teleporting.
const STEER_RATE = 9.5; // exponential damp rate toward targetX
const KEY_STEER_SPEED = 11.5; // world units/s while a steer key is held
const DRAG_GAIN = 1.4; // touch drag → world units (matches the house feel)

// ── Squad rendering ────────────────────────────────────────────────────────
const SQUAD_COLS = 7;
const SQUAD_SPACING_X = 0.82;
const SQUAD_SPACING_Z = 0.86;
const GUNNER_CAP = HARD_MAX_COUNT; // instance budget = the hard squad ceiling
const ENEMY_CAP = 140;
const TRACER_CAP = 96;
const PARTICLE_CAP = 220;

// ── Wave (arena) framing ───────────────────────────────────────────────────
const ARENA_RADIUS = 24;
// The sim's fightSeconds can resolve almost instantly for an overbuilt squad;
// hold the arena a beat longer so the horde is legible and the recorded pick
// clock always clears the replay's per-wave timing floor.
const WAVE_MIN_VISUAL_S = 1.5;
const WAVE_INTRO_S = 0.55;
const WAVE_OUTRO_S = 0.5;

// Camera poses, lerped when the run enters/leaves an arena. The run pose sits
// far enough back that a maxed-out squad (nine rows deep) still clears the
// bottom edge of the stage.
const CAM_RUN = { y: 7.2, z: 13.5, fov: 58 };
const CAM_WAVE = { y: 14.5, z: 17, fov: 62 };

const REWARDS_HINT_TEXT =
  'Rewards hint: tickets scale with your final score. Waves pay far more than gate rows, and a wave payout grows with the squad still standing and the tier it is holding — so building wide AND evolving both pay.';

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

// 'wave' = the arena fight; steering is dead and the outcome is already decided
// by the shared sim — the animation just shows the player what their build did.
type GameState = 'idle' | 'playing' | 'wave' | 'gameover' | 'error';

// Distinct existing SoundManager cues (we never modify SoundManager).
const SFX = {
  start: 'arcadeBet',
  steer: 'arcadeReelTick',
  gateGood: 'score',
  gateBad: 'arcadeLose',
  evolve: 'arcadeBigWin',
  waveStart: 'strikerWhoosh',
  waveHit: 'strikerImpact',
  waveClear: 'arcadeWin',
  wipe: 'arcadeCrash',
} as const;

// A gate row instantiated in the world: the seeded pair plus its pooled meshes.
type LiveGateRow = {
  row: number;
  gates: readonly [GunrushGate, GunrushGate];
  /** Index of the pooled visual slot rendering this row. */
  slot: number;
  resolved: boolean;
  /** Which side (0 or 1) carries the barricade, or -1 when the row is clear. */
  barricade: number;
  barricadeHit: boolean;
};

// One pooled gate row's meshes (two panels + frames + labels + a barricade).
type GateVisual = {
  group: THREE.Group;
  panels: {
    group: THREE.Group;
    glass: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    frame: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>[];
    label: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    canvas: HTMLCanvasElement;
    texture: THREE.CanvasTexture;
  }[];
  barricade: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
};

// A live arena enemy (wave phase only). Enemies converge on the ring and pop.
type LiveEnemy = {
  angle: number;
  radius: number;
  speed: number;
  elite: boolean;
  /** Sim seconds at which this enemy dies (pre-scheduled from the outcome). */
  dieAt: number;
  alive: boolean;
  bob: number;
};

// Floating combat text (presentation only; projected from world space).
type Floater = {
  id: number;
  text: string;
  tone: 'good' | 'bad' | 'evolve';
  x: number; // 0..1 across the stage
  y: number; // 0..1 down the stage
};

/** Paint a gate label into its pooled canvas. Reuses the canvas + texture so a
 *  long run never churns GPU memory — only `needsUpdate` is flipped. */
const paintGateLabel = (
  canvas: HTMLCanvasElement,
  texture: THREE.CanvasTexture,
  text: string,
  color: string,
) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const size = text.length > 8 ? h * 0.42 : h * 0.56;
  ctx.font = `bold ${size.toFixed(0)}px ui-monospace, "SFMono-Regular", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  ctx.fillText(text, w / 2, h / 2 + Math.max(3, h * 0.045));
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2);
  texture.needsUpdate = true;
};

export default function GunrushClient() {
  const touchDevice = useIsTouchDevice();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [gameState, setGameState] = useState<GameState>('idle');
  const [score, setScore] = useState(0);
  const [squadCount, setSquadCount] = useState(0);
  const [weaponName, setWeaponName] = useState(weaponForTier(1).name);
  const [weaponTier, setWeaponTier] = useState(1);
  const [rowsCleared, setRowsCleared] = useState(0);
  const [kills, setKills] = useState(0);
  const [statChips, setStatChips] = useState({ damage: 1, rate: 1 });
  const [waveBanner, setWaveBanner] = useState<string | null>(null);
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
  const {
    result: runResult,
    capture: captureRunResult,
    reset: resetRunResult,
  } = useArcadeRunResult();
  const [showRewardsHint, setShowRewardsHint] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [banUntilMs, setBanUntilMs] = useState<number | null>(null);
  const [banIndefinite, setBanIndefinite] = useState(false);
  const [banNowMs, setBanNowMs] = useState(0);
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);
  const [webglError, setWebglError] = useState(false);
  const [canvasSize, setCanvasSize] = useState({
    width: BASE_WIDTH,
    height: BASE_HEIGHT,
    dpr: 1,
  });
  // Equipped cosmetics (squad / arsenal / track). Seeded with the exact current
  // palette so the idle render is unchanged before inventory loads.
  const [theme, setTheme] = useState<GunrushCosmeticTheme>(DEFAULT_GUNRUSH_THEME);

  usePreventGameGestures(gameState === 'playing' || gameState === 'wave');

  // ── Refs (mutable sim state; no re-render) ──
  const gameStateRef = useRef<GameState>('idle');
  const sessionTokenRef = useRef<string | null>(null);
  const seedRef = useRef<number | null>(null);
  const envMonitorRef = useRef(new EnvMonitor());
  const floaterIdRef = useRef(0);
  const isGuestRunRef = useRef(false);
  const isStartingRef = useRef(false);
  const reducedMotionRef = useRef(false);
  const gameStartTimeRef = useRef(0);
  const gameOverTimeRef = useRef(0);
  const bestScoreCacheRef = useRef<number | null>(null);

  // Run state mirrors the shared sim EXACTLY — every mutation goes through
  // applyGate / resolveWave from the replay module, so the score the player
  // watches climb is the score the server independently recomputes.
  const runStateRef = useRef<GunrushRunState>(initialRunState());
  const picksRef = useRef<GunrushPick[]>([]);
  const distanceRef = useRef(0); // world units travelled
  const elapsedMsRef = useRef(0); // sim clock; the recorded pick `t`
  const nextRowRef = useRef(1); // the next row the squad will reach
  const spawnedRowRef = useRef(0); // highest row instantiated in the world
  const liveRowsRef = useRef<LiveGateRow[]>([]);
  const freeSlotsRef = useRef<number[]>([]);
  const endRowRef = useRef(0);

  // Steering.
  const anchorXRef = useRef(0);
  const targetXRef = useRef(0);
  const keyDirRef = useRef(0);
  const dragRef = useRef<{ pointerId: number; startX: number; startAnchor: number } | null>(
    null,
  );

  // Wave phase.
  const waveRef = useRef<{
    wave: GunrushWave;
    losses: number;
    cleared: boolean;
    duration: number; // total arena seconds including intro/outro
    fightSeconds: number;
    elapsed: number;
    enemies: LiveEnemy[];
    killed: number;
    lost: number;
    startCount: number;
  } | null>(null);

  // ── three.js scene refs (built once; updated per frame by render3D) ──
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const envDisposeRef = useRef<(() => void) | null>(null);
  const frameLoopRef = useRef<GameFrameLoop | null>(null);
  const deckRef = useRef<THREE.Mesh<
    THREE.PlaneGeometry,
    THREE.MeshStandardMaterial
  > | null>(null);
  const gunnerBodyRef = useRef<THREE.InstancedMesh | null>(null);
  const gunnerHeadRef = useRef<THREE.InstancedMesh | null>(null);
  const gunBodyRef = useRef<THREE.InstancedMesh | null>(null);
  const gunBarrelRef = useRef<THREE.InstancedMesh | null>(null);
  const enemyBodyRef = useRef<THREE.InstancedMesh | null>(null);
  const enemyHeadRef = useRef<THREE.InstancedMesh | null>(null);
  const tracerRef = useRef<THREE.InstancedMesh | null>(null);
  const gateVisualsRef = useRef<GateVisual[]>([]);
  const railsRef = useRef<THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>[]>(
    [],
  );
  const postsRef = useRef<THREE.Group[]>([]);
  const muzzleLightRef = useRef<THREE.PointLight | null>(null);
  const particlesRef = useRef<SpriteParticle[]>([]);
  const themeRef = useRef<GunrushCosmeticTheme>(DEFAULT_GUNRUSH_THEME);
  const themeMatsRef = useRef<{
    deck: THREE.MeshStandardMaterial;
    rail: THREE.MeshStandardMaterial;
    railTop: THREE.MeshStandardMaterial;
    gunnerBody: THREE.MeshStandardMaterial;
    gunnerHead: THREE.MeshStandardMaterial;
    gunBody: THREE.MeshStandardMaterial;
    gunBarrel: THREE.MeshStandardMaterial;
    enemyBody: THREE.MeshStandardMaterial;
    enemyHead: THREE.MeshStandardMaterial;
    tracer: THREE.MeshBasicMaterial;
    hemi: THREE.HemisphereLight;
  } | null>(null);

  const shakeRef = useRef(0);
  const camYRef = useRef(CAM_RUN.y);
  const camZRef = useRef(CAM_RUN.z);
  const camFovRef = useRef(CAM_RUN.fov);
  const camXRef = useRef(0);
  const fireFlashRef = useRef(0);
  const bobRef = useRef(0);

  // Preallocated scratch — the render path must never allocate.
  const tmpMatrix = useRef(new THREE.Matrix4()).current;
  const tmpQuat = useRef(new THREE.Quaternion()).current;
  const tmpPos = useRef(new THREE.Vector3()).current;
  const tmpScale = useRef(new THREE.Vector3(1, 1, 1)).current;
  const tmpColor = useRef(new THREE.Color()).current;

  const saveScoreRef = useRef<
    ((finalScore: number, picks: GunrushPick[], endRow: number) => Promise<void>) | null
  >(null);

  // ── Networking ────────────────────────────────────────────────────────────

  const fetchUserBestScore = useCallback(async () => {
    if (bestScoreCacheRef.current !== null) {
      setHighScore(bestScoreCacheRef.current);
      return;
    }
    try {
      const response = await fetch('/api/games/gunrush/score', {
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
      const response = await fetch('/api/store/inventory?gameType=gunrush', {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = (await response.json()) as GunrushInventoryResponse;
      setWalletBalances({ credits: payload.wallet?.credits ?? 0 });
      setDailyCreditsProgress({
        earned: payload.dailyGameCredits?.earned ?? 0,
        cap: payload.dailyGameCredits?.cap ?? 300,
      });
      setTheme(buildGunrushTheme(payload));
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

  const saveScore = async (
    finalScore: number,
    picks: GunrushPick[],
    endRow: number,
  ) => {
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
      // No `keepalive`: the pick log grows with every gate row and a marathon
      // run can exceed the 64KB keepalive body quota, which would silently fail
      // the save. This POST happens on game-over with the page alive, so it
      // does not need unload semantics.
      const response = await fetch('/api/games/gunrush/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: finalScore,
          sessionToken: sessionTokenRef.current,
          picks,
          endRow,
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
        const reason =
          errData?.details || errData?.error || `HTTP ${response.status}`;
        console.error(`[Gunrush] Score rejected (${response.status}): ${reason}`);
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
                  (Number.isFinite(awardedCredits)
                    ? Math.max(0, awardedCredits)
                    : 0),
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

  // ── Floating combat text (presentation only) ──
  const addFloater = useCallback(
    (text: string, tone: Floater['tone'], x: number, y: number) => {
      const id = (floaterIdRef.current += 1);
      setFloaters((prev) => [...prev.slice(-4), { id, text, tone, x, y }]);
      window.setTimeout(() => {
        setFloaters((prev) => prev.filter((f) => f.id !== id));
      }, calloutLifeMs(reducedMotionRef.current, 1000));
    },
    [],
  );

  // ── Scene construction ────────────────────────────────────────────────────

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
    setupMidwayRenderer(renderer, 1.25);
    rendererRef.current = renderer;

    canvas.addEventListener(
      'webglcontextlost',
      (event) => {
        event.preventDefault();
        frameLoopRef.current?.stop();
        envDisposeRef.current?.();
        envDisposeRef.current = null;
        if (sceneRef.current) disposeSceneDeep(sceneRef.current);
        sceneRef.current = null;
        cameraRef.current = null;
        deckRef.current = null;
        gunnerBodyRef.current = null;
        gunnerHeadRef.current = null;
        gunBodyRef.current = null;
        gunBarrelRef.current = null;
        enemyBodyRef.current = null;
        enemyHeadRef.current = null;
        tracerRef.current = null;
        gateVisualsRef.current = [];
        railsRef.current = [];
        postsRef.current = [];
        particlesRef.current = [];
        themeMatsRef.current = null;
        muzzleLightRef.current = null;
        setWebglError(true);
        renderer.dispose();
        rendererRef.current = null;
      },
      { once: true },
    );

    const t = themeRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(t.skyColor);
    scene.fog = new THREE.Fog(t.fogColor, FOG_NEAR, FOG_FAR);
    envDisposeRef.current = applyMidwayEnvironment(renderer, scene, 0.26);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(CAM_RUN.fov, 1, 0.1, 240);
    camera.position.set(0, CAM_RUN.y, CAM_RUN.z);
    cameraRef.current = camera;

    // ── Lighting: one warm key with a tight shadow frustum over the squad,
    //    plus a hemisphere fill that the `track` cosmetic slot recolors. ──
    const key = new THREE.DirectionalLight(0xffd9a3, 1.5);
    key.position.set(-7, 16, 6);
    key.target.position.set(0, 0, forwardZ(6));
    tuneMidwayKeyShadow(key);
    const shadowCam = key.shadow.camera as THREE.OrthographicCamera;
    shadowCam.left = -14;
    shadowCam.right = 14;
    shadowCam.top = 20;
    shadowCam.bottom = -12;
    shadowCam.near = 1;
    shadowCam.far = 46;
    shadowCam.updateProjectionMatrix();
    scene.add(key, key.target);

    const hemi = new THREE.HemisphereLight(t.accentColor, t.groundColor, 0.55);
    scene.add(hemi);

    // A single shared point light doubles as every muzzle flash in the squad —
    // its intensity is driven by the fire cadence instead of per-gunner lights.
    const muzzleLight = new THREE.PointLight(t.muzzleColor, 0, 22, 2);
    muzzleLight.position.set(0, 1.5, forwardZ(2));
    scene.add(muzzleLight);
    muzzleLightRef.current = muzzleLight;

    // ── Deck: one long plank plane scrolled by texture offset. Cheaper and
    //    drift-free compared with recycling segment meshes. ──
    const planks = makePlankTextures(9, 3, 26);
    const deckMat = new THREE.MeshStandardMaterial({
      color: t.laneColor,
      map: planks.map,
      roughnessMap: planks.roughnessMap,
      roughness: 0.86,
      metalness: 0.04,
    });
    const deck = new THREE.Mesh(
      new THREE.PlaneGeometry(TRACK_HALF_WIDTH * 2 + 1.6, 320),
      deckMat,
    );
    deck.rotation.x = -Math.PI / 2;
    deck.position.set(0, 0, forwardZ(118));
    deck.receiveShadow = true;
    scene.add(deck);
    deckRef.current = deck;

    // ── Side rails ──
    const railMat = new THREE.MeshStandardMaterial({
      color: t.railColor,
      roughness: 0.72,
      metalness: 0.12,
    });
    const railTopMat = new THREE.MeshStandardMaterial({
      color: t.railTopColor,
      roughness: 0.44,
      metalness: 0.45,
    });
    const rails: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>[] = [];
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, 1.1, 320),
        railMat,
      );
      post.position.set(side * (TRACK_HALF_WIDTH + 0.75), 0.55, forwardZ(118));
      scene.add(post);
      rails.push(post);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 320), railTopMat);
      cap.position.set(side * (TRACK_HALF_WIDTH + 0.75), 1.16, forwardZ(118));
      scene.add(cap);
      rails.push(cap);
    }
    railsRef.current = rails;

    // ── Roadside light posts: a regularly spaced eye-speedometer. ──
    const bulbGeo = new THREE.SphereGeometry(0.16, 10, 8);
    const bulbMat = new THREE.MeshStandardMaterial({
      color: t.accentColor,
      emissive: new THREE.Color(t.accentColor),
      emissiveIntensity: 0.9,
      roughness: 0.5,
    });
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.09, 3.1, 6);
    const posts: THREE.Group[] = [];
    for (let i = 0; i < 16; i += 1) {
      const group = new THREE.Group();
      const pole = new THREE.Mesh(poleGeo, railMat);
      pole.position.y = 1.55;
      const bulb = new THREE.Mesh(bulbGeo, bulbMat);
      bulb.position.y = 3.2;
      group.add(pole, bulb);
      group.position.x = (i % 2 === 0 ? -1 : 1) * (TRACK_HALF_WIDTH + 1.1);
      scene.add(group);
      posts.push(group);
    }
    postsRef.current = posts;

    // ── Squad: four instanced meshes (torso, head, gun body, gun barrel). ──
    const gunnerBodyMat = new THREE.MeshStandardMaterial({
      color: t.squadBody,
      roughness: 0.6,
      metalness: 0.15,
    });
    const gunnerHeadMat = new THREE.MeshStandardMaterial({
      color: t.squadHead,
      roughness: 0.7,
      metalness: 0.05,
    });
    const gunBodyMat = new THREE.MeshStandardMaterial({
      color: t.gunBody,
      roughness: 0.45,
      metalness: 0.55,
    });
    const gunBarrelMat = new THREE.MeshStandardMaterial({
      color: t.gunAccent,
      roughness: 0.35,
      metalness: 0.7,
    });

    const gunnerBody = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.44, 0.72, 0.34),
      gunnerBodyMat,
      GUNNER_CAP,
    );
    const gunnerHead = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.3, 0.28, 0.3),
      gunnerHeadMat,
      GUNNER_CAP,
    );
    const gunBody = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.16, 0.16, 0.5),
      gunBodyMat,
      GUNNER_CAP,
    );
    const gunBarrel = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.06, 0.06, 1, 6),
      gunBarrelMat,
      GUNNER_CAP,
    );
    for (const mesh of [gunnerBody, gunnerHead, gunBody, gunBarrel]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      scene.add(mesh);
    }
    gunnerBodyRef.current = gunnerBody;
    gunnerHeadRef.current = gunnerHead;
    gunBodyRef.current = gunBody;
    gunBarrelRef.current = gunBarrel;

    // ── Enemies: instanced tin bodies, per-instance colored so brutes read
    //    darker/redder without a second draw call. ──
    const enemyBodyMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.68,
      metalness: 0.1,
    });
    const enemyHeadMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.7,
      metalness: 0.08,
    });
    const enemyBody = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.5, 0.8, 0.38),
      enemyBodyMat,
      ENEMY_CAP,
    );
    const enemyHead = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.32, 0.3, 0.32),
      enemyHeadMat,
      ENEMY_CAP,
    );
    for (const mesh of [enemyBody, enemyHead]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      scene.add(mesh);
    }
    enemyBodyRef.current = enemyBody;
    enemyHeadRef.current = enemyHead;

    // ── Tracers: stretched additive quads, recycled every frame. ──
    const tracerMat = new THREE.MeshBasicMaterial({
      color: t.tracerColor,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const tracer = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.05, 0.05, 1),
      tracerMat,
      TRACER_CAP,
    );
    tracer.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    tracer.frustumCulled = false;
    tracer.count = 0;
    scene.add(tracer);
    tracerRef.current = tracer;

    // ── Gate rows: a pool of four, each two panels + a barricade. ──
    const gateVisuals: GateVisual[] = [];
    for (let i = 0; i < GATE_ROW_POOL; i += 1) {
      const group = new THREE.Group();
      group.visible = false;
      const panels: GateVisual['panels'] = [];
      for (const side of [-1, 1]) {
        const panelGroup = new THREE.Group();
        const centre = side * (GATE_DIVIDER + GATE_PANEL_W / 2);
        panelGroup.position.set(centre, 0, 0);

        const glass = new THREE.Mesh(
          new THREE.PlaneGeometry(GATE_PANEL_W, GATE_PANEL_H),
          new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.17,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        glass.position.y = GATE_PANEL_H / 2 + 0.05;
        panelGroup.add(glass);

        // Frame: two uprights + a lintel, recolored per gate polarity.
        const frameMat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: new THREE.Color(0xffffff),
          emissiveIntensity: 0.75,
          roughness: 0.4,
          metalness: 0.3,
        });
        const frame: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>[] = [];
        for (const edge of [-1, 1]) {
          const upright = new THREE.Mesh(
            new THREE.BoxGeometry(0.14, GATE_PANEL_H + 0.2, 0.14),
            frameMat,
          );
          upright.position.set(edge * (GATE_PANEL_W / 2), (GATE_PANEL_H + 0.2) / 2, 0);
          panelGroup.add(upright);
          frame.push(upright);
        }
        const lintel = new THREE.Mesh(
          new THREE.BoxGeometry(GATE_PANEL_W + 0.14, 0.16, 0.14),
          frameMat,
        );
        lintel.position.y = GATE_PANEL_H + 0.2;
        panelGroup.add(lintel);
        frame.push(lintel);

        const labelCanvas = document.createElement('canvas');
        labelCanvas.width = 256;
        labelCanvas.height = 96;
        const labelTexture = new THREE.CanvasTexture(labelCanvas);
        labelTexture.colorSpace = THREE.SRGBColorSpace;
        const label = new THREE.Mesh(
          new THREE.PlaneGeometry(GATE_PANEL_W * 0.86, GATE_PANEL_W * 0.86 * (96 / 256)),
          new THREE.MeshBasicMaterial({
            map: labelTexture,
            transparent: true,
            depthWrite: false,
          }),
        );
        label.position.set(0, GATE_PANEL_H * 0.56, 0.06);
        panelGroup.add(label);

        group.add(panelGroup);
        panels.push({
          group: panelGroup,
          glass,
          frame,
          label,
          canvas: labelCanvas,
          texture: labelTexture,
        });
      }

      // The barricade guards the richer lane on "small vs big" rows: shoot it
      // down with a big enough squad or get shoved off the line.
      const barricade = new THREE.Mesh(
        new THREE.BoxGeometry(GATE_PANEL_W * 0.78, 0.9, 0.42),
        new THREE.MeshStandardMaterial({
          color: 0x7c5430,
          roughness: 0.8,
          metalness: 0.1,
        }),
      );
      barricade.position.y = 0.45;
      barricade.castShadow = true;
      barricade.visible = false;
      group.add(barricade);

      scene.add(group);
      gateVisuals.push({ group, panels, barricade });
    }
    gateVisualsRef.current = gateVisuals;
    freeSlotsRef.current = gateVisuals.map((_, index) => index);

    // ── Particles: one shared sprite pool for muzzle sparks, gate shatter and
    //    enemy poofs. ──
    particlesRef.current = makeSpriteParticlePool({
      scene,
      count: PARTICLE_CAP,
      texture: makeSparkTexture(64),
      colors: [t.muzzleColor, t.tracerColor, '#ffffff'],
      size: 0.3,
      blending: THREE.AdditiveBlending,
    });

    // A soft ground disc under the squad keeps it readable against the deck.
    const discTexture = makeSoftDiscTexture(128);
    const disc = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 7),
      new THREE.MeshBasicMaterial({
        map: discTexture,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        color: 0x000000,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(0, 0.02, 0.4);
    scene.add(disc);

    themeMatsRef.current = {
      deck: deckMat,
      rail: railMat,
      railTop: railTopMat,
      gunnerBody: gunnerBodyMat,
      gunnerHead: gunnerHeadMat,
      gunBody: gunBodyMat,
      gunBarrel: gunBarrelMat,
      enemyBody: enemyBodyMat,
      enemyHead: enemyHeadMat,
      tracer: tracerMat,
      hemi,
    };
  }, []);

  const resize3D = useCallback((width: number, height: number) => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!renderer || !camera) return;
    renderer.setPixelRatio(gameCanvasDpr(width, height));
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  }, []);

  // ── Rendering ─────────────────────────────────────────────────────────────

  const render3D = useCallback(() => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera) return;

    const state = runStateRef.current;
    const wave = waveRef.current;
    const inWave = gameStateRef.current === 'wave' && wave !== null;
    const distance = distanceRef.current;
    const anchorX = anchorXRef.current;

    // ── Camera: chase pose on the run, elevated 3/4 in the arena. ──
    const targetY = inWave ? CAM_WAVE.y : CAM_RUN.y;
    const targetZ = inWave ? CAM_WAVE.z : CAM_RUN.z;
    const targetFov = inWave ? CAM_WAVE.fov : CAM_RUN.fov;
    const camDt = 1 / 60;
    camYRef.current = expDamp(camYRef.current, targetY, 3.4, camDt);
    camZRef.current = expDamp(camZRef.current, targetZ, 3.4, camDt);
    camFovRef.current = expDamp(camFovRef.current, targetFov, 3.4, camDt);
    camXRef.current = expDamp(
      camXRef.current,
      inWave ? 0 : anchorX * 0.55,
      6,
      camDt,
    );

    const shake = shakeRef.current;
    const shakeX = shake > 0 ? (Math.random() - 0.5) * shake * 0.7 : 0;
    const shakeY = shake > 0 ? (Math.random() - 0.5) * shake * 0.5 : 0;
    camera.position.set(
      camXRef.current + shakeX,
      camYRef.current + shakeY,
      camZRef.current,
    );
    camera.fov = camFovRef.current;
    camera.updateProjectionMatrix();
    camera.lookAt(
      inWave ? 0 : anchorX * 0.3,
      inWave ? 0.6 : 1.9,
      forwardZ(inWave ? 2 : 15),
    );

    // ── Deck scroll + rail/post recycling (the sense of speed). ──
    const deck = deckRef.current;
    if (deck?.material.map) {
      deck.material.map.offset.y = distance * PLANK_SCROLL;
      if (deck.material.roughnessMap) {
        deck.material.roughnessMap.offset.y = distance * PLANK_SCROLL;
      }
    }
    const posts = postsRef.current;
    const postSpacing = 14;
    const postSpan = posts.length * postSpacing;
    for (let i = 0; i < posts.length; i += 1) {
      const base = i * postSpacing - distance;
      const ahead = ((base % postSpan) + postSpan * 1.5) % postSpan;
      posts[i]!.position.z = forwardZ(ahead - 12);
    }

    // ── Gate rows ──
    const visuals = gateVisualsRef.current;
    for (const visual of visuals) visual.group.visible = false;
    const t = themeRef.current;
    for (const live of liveRowsRef.current) {
      const visual = visuals[live.slot];
      if (!visual) continue;
      visual.group.visible = true;
      visual.group.position.z = forwardZ(live.row * ROW_SPACING - distance);
      // A resolved row keeps drifting past the camera with its panels shattered
      // (the glass is hidden) so the pass reads as "through", not "vanished".
      for (let side = 0; side < 2; side += 1) {
        const panel = visual.panels[side]!;
        panel.glass.visible = !live.resolved;
        const gate = live.gates[side]!;
        const color =
          gate.kind === 'evolve' || gate.kind === 'devolve'
            ? t.gateWeaponColor
            : gate.good
              ? t.gateGoodColor
              : t.gateBadColor;
        tmpColor.set(color);
        panel.glass.material.color.copy(tmpColor);
        const frameMat = panel.frame[0]!.material;
        frameMat.color.copy(tmpColor);
        frameMat.emissive.copy(tmpColor);
        // Bad gates flicker; good gates breathe. Reduced motion holds both flat.
        frameMat.emissiveIntensity = reducedMotionRef.current
          ? 0.7
          : gate.good
            ? 0.62 + Math.sin(bobRef.current * 2.6 + side) * 0.18
            : 0.5 + Math.abs(Math.sin(bobRef.current * 7.5 + side)) * 0.5;
      }
      visual.barricade.visible = live.barricade >= 0 && !live.barricadeHit;
      if (visual.barricade.visible) {
        visual.barricade.position.x =
          (live.barricade === 0 ? -1 : 1) * (GATE_DIVIDER + GATE_PANEL_W / 2);
        // The barricade stands 7 units in FRONT of its gate (closer to the
        // squad), which is +z in local space now that the track recedes into −z.
        visual.barricade.position.z = 7;
      }
    }

    // ── Squad ──
    const gunnerBody = gunnerBodyRef.current;
    const gunnerHead = gunnerHeadRef.current;
    const gunBody = gunBodyRef.current;
    const gunBarrel = gunBarrelRef.current;
    if (gunnerBody && gunnerHead && gunBody && gunBarrel) {
      const count = Math.min(GUNNER_CAP, Math.max(0, Math.floor(state.count)));
      const weapon = weaponForTier(state.tier);
      // Barrel length + girth grow with the tier so the silhouette telegraphs
      // the arsenal from the chase cam without a per-tier model swap.
      const barrelLen = 0.36 + state.tier * 0.075;
      const barrelR = 0.7 + state.tier * 0.13;
      const bob = bobRef.current;
      const ringRadius = Math.min(6, 1.5 + count * 0.08);

      for (let i = 0; i < count; i += 1) {
        let px: number;
        let pz: number;
        let facing = 0;
        if (inWave) {
          // Arena: an outward-facing ring whose radius grows with the squad.
          // `facing` is chosen so (sin f, cos f) is the outward radial — the
          // same convention the gun offset and barrel rotation below use.
          const a = (i / count) * Math.PI * 2;
          px = Math.cos(a) * ringRadius;
          pz = Math.sin(a) * ringRadius + forwardZ(2);
          facing = Math.PI / 2 - a;
        } else {
          const col = (i % SQUAD_COLS) - (SQUAD_COLS - 1) / 2;
          const rowIndex = Math.floor(i / SQUAD_COLS);
          px = anchorX + col * SQUAD_SPACING_X;
          // Later ranks trail BEHIND the leader, which is +z down the track.
          pz = rowIndex * SQUAD_SPACING_Z;
          facing = Math.PI; // (sin π, cos π) = (0, −1) — straight down the lane
        }
        const phase = i * 0.7;
        const hop = reducedMotionRef.current
          ? 0
          : Math.abs(Math.sin(bob * 9 + phase)) * 0.12;

        tmpQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), facing);
        tmpPos.set(px, 0.36 + hop, pz);
        tmpScale.set(1, 1, 1);
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
        gunnerBody.setMatrixAt(i, tmpMatrix);

        tmpPos.set(px, 0.88 + hop, pz);
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
        gunnerHead.setMatrixAt(i, tmpMatrix);

        const gunForward = 0.28;
        const gx = px + Math.sin(facing) * gunForward;
        const gz = pz + Math.cos(facing) * gunForward;
        tmpPos.set(gx, 0.52 + hop, gz);
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
        gunBody.setMatrixAt(i, tmpMatrix);

        // The barrel cylinder is authored along +Y. Rx(π/2) swings it onto +z,
        // then Ry(facing) aims it along (sin f, 0, cos f) — the same heading the
        // gun offset uses. YXZ order applies Ry AFTER Rx, which is what we want.
        tmpQuat.setFromEuler(new THREE.Euler(Math.PI / 2, facing, 0, 'YXZ'));
        tmpPos.set(
          px + Math.sin(facing) * (gunForward + barrelLen / 2),
          0.52 + hop,
          pz + Math.cos(facing) * (gunForward + barrelLen / 2),
        );
        tmpScale.set(barrelR, barrelLen, barrelR);
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
        gunBarrel.setMatrixAt(i, tmpMatrix);
        tmpScale.set(1, 1, 1);
      }
      gunnerBody.count = count;
      gunnerHead.count = count;
      gunBody.count = count;
      gunBarrel.count = count;
      gunnerBody.instanceMatrix.needsUpdate = true;
      gunnerHead.instanceMatrix.needsUpdate = true;
      gunBody.instanceMatrix.needsUpdate = true;
      gunBarrel.instanceMatrix.needsUpdate = true;

      // ── Tracers: a sample of gunners draw a streak toward what they shoot. ──
      const tracer = tracerRef.current;
      if (tracer) {
        const firing = inWave || nextRowRef.current > 1;
        const tracerCount = firing
          ? Math.min(TRACER_CAP, Math.max(3, Math.floor(count * 0.55)))
          : 0;
        for (let i = 0; i < tracerCount; i += 1) {
          const gunnerIndex = Math.floor((i / Math.max(1, tracerCount)) * count);
          let ox: number;
          let oz: number;
          let dirX: number;
          let dirZ: number;
          if (inWave) {
            const a = (gunnerIndex / Math.max(1, count)) * Math.PI * 2;
            ox = Math.cos(a) * ringRadius;
            oz = Math.sin(a) * ringRadius + forwardZ(2);
            dirX = Math.cos(a);
            dirZ = Math.sin(a);
          } else {
            const col = (gunnerIndex % SQUAD_COLS) - (SQUAD_COLS - 1) / 2;
            ox = anchorX + col * SQUAD_SPACING_X;
            oz = Math.floor(gunnerIndex / SQUAD_COLS) * SQUAD_SPACING_Z;
            dirX = 0;
            dirZ = -1; // straight down the lane
          }
          // Stagger each streak along its flight so the stream reads continuous.
          const travel = ((bob * weapon.fireRate * 6 + i * 1.7) % 1) * weapon.range;
          const len = 1.4 + state.tier * 0.12;
          tmpQuat.setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            new THREE.Vector3(dirX, 0, dirZ).normalize(),
          );
          tmpPos.set(ox + dirX * travel, 0.55, oz + dirZ * travel);
          tmpScale.set(1, 1, len);
          tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
          tracer.setMatrixAt(i, tmpMatrix);
          tmpScale.set(1, 1, 1);
        }
        tracer.count = tracerCount;
        tracer.instanceMatrix.needsUpdate = true;
      }

      // Muzzle light pulses with the fire cadence and the squad's size.
      const muzzle = muzzleLightRef.current;
      if (muzzle) {
        const pulse = reducedMotionRef.current
          ? 0.5
          : 0.5 + 0.5 * Math.sin(bob * weapon.fireRate * 3.2);
        muzzle.intensity =
          (inWave ? 5 : 2.2) * pulse * Math.min(2.4, 0.5 + count / 26) +
          fireFlashRef.current * 8;
        muzzle.position.set(inWave ? 0 : anchorX, 1.4, forwardZ(inWave ? 2 : 1.6));
      }
    }

    // ── Arena enemies ──
    const enemyBody = enemyBodyRef.current;
    const enemyHead = enemyHeadRef.current;
    if (enemyBody && enemyHead) {
      let drawn = 0;
      if (inWave && wave) {
        for (const enemy of wave.enemies) {
          if (!enemy.alive || drawn >= ENEMY_CAP) continue;
          const px = Math.cos(enemy.angle) * enemy.radius;
          const pz = Math.sin(enemy.angle) * enemy.radius + forwardZ(2);
          const scale = enemy.elite ? 1.6 : 1;
          const hop = reducedMotionRef.current
            ? 0
            : Math.abs(Math.sin(bobRef.current * 7 + enemy.bob)) * 0.1;
          tmpQuat.setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            -enemy.angle - Math.PI / 2,
          );
          tmpPos.set(px, 0.4 * scale + hop, pz);
          tmpScale.set(scale, scale, scale);
          tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
          enemyBody.setMatrixAt(drawn, tmpMatrix);
          tmpPos.set(px, 0.95 * scale + hop, pz);
          tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
          enemyHead.setMatrixAt(drawn, tmpMatrix);
          tmpColor.set(enemy.elite ? t.enemyEliteColor : t.enemyColor);
          enemyBody.setColorAt(drawn, tmpColor);
          enemyHead.setColorAt(drawn, tmpColor);
          tmpScale.set(1, 1, 1);
          drawn += 1;
        }
      }
      enemyBody.count = drawn;
      enemyHead.count = drawn;
      enemyBody.instanceMatrix.needsUpdate = true;
      enemyHead.instanceMatrix.needsUpdate = true;
      if (enemyBody.instanceColor) enemyBody.instanceColor.needsUpdate = true;
      if (enemyHead.instanceColor) enemyHead.instanceColor.needsUpdate = true;
    }

    renderer.render(scene, camera);
  }, [tmpColor, tmpMatrix, tmpPos, tmpQuat, tmpScale]);

  // ── Sim helpers ───────────────────────────────────────────────────────────

  /** Publish the sim state into React so the HUD tracks it (once per row, not
   *  per frame — the HUD is DOM and must not re-render at 60 Hz). */
  const syncHud = useCallback(() => {
    const state = runStateRef.current;
    setScore(Math.floor(state.score));
    setSquadCount(state.count);
    setKills(state.kills);
    setWeaponTier(state.tier);
    setWeaponName(weaponForTier(state.tier).name);
    setStatChips({ damage: state.damageMult, rate: state.rateMult });
  }, []);

  /** Instantiate every row that has come into view, and retire the ones the
   *  squad has left behind. Pooled — no allocation beyond the live-row array. */
  const refreshRows = useCallback(() => {
    const distance = distanceRef.current;
    const live = liveRowsRef.current;

    // Retire rows that have fallen well behind the camera.
    for (let i = live.length - 1; i >= 0; i -= 1) {
      const entry = live[i]!;
      if (entry.row * ROW_SPACING - distance < -24) {
        freeSlotsRef.current.push(entry.slot);
        live.splice(i, 1);
      }
    }

    // Spawn ahead while a pooled slot is free and the row is within view.
    const seed = seedRef.current ?? 0;
    while (freeSlotsRef.current.length > 0) {
      const row = spawnedRowRef.current + 1;
      if (row > GUNRUSH_MAX_ROWS) break;
      if (row * ROW_SPACING - distance > FOG_FAR + ROW_SPACING) break;
      spawnedRowRef.current = row;
      if (isWaveRow(row)) continue; // waves have no gates to instantiate

      const slot = freeSlotsRef.current.pop()!;
      const gates = gatesForRow(seed, row);
      // The "small vs big" archetype is the only one that offers two plain +N
      // gates; guard the richer lane so the payoff costs something.
      const barricade =
        gates[0].kind === 'add' &&
        gates[1].kind === 'add' &&
        Math.abs(gates[0].value - gates[1].value) >= 3
          ? gates[0].value > gates[1].value
            ? 0
            : 1
          : -1;
      const entry: LiveGateRow = {
        row,
        gates,
        slot,
        resolved: false,
        barricade,
        barricadeHit: false,
      };
      live.push(entry);

      const visual = gateVisualsRef.current[slot];
      if (visual) {
        const t = themeRef.current;
        for (let side = 0; side < 2; side += 1) {
          const gate = gates[side]!;
          const panel = visual.panels[side]!;
          const color =
            gate.kind === 'evolve' || gate.kind === 'devolve'
              ? t.gateWeaponColor
              : gate.good
                ? t.gateGoodColor
                : t.gateBadColor;
          paintGateLabel(panel.canvas, panel.texture, gate.label, color);
        }
      }
    }
  }, []);

  const endRun = useCallback(
    (endRow: number) => {
      if (gameStateRef.current === 'gameover') return;
      endRowRef.current = endRow;
      gameStateRef.current = 'gameover';
      frameLoopRef.current?.stop();
      runStateRef.current.count = 0;
      shakeRef.current = 1;
      setWaveBanner(null);
      syncHud();
      setSquadCount(0);
      setGameState('gameover');
      gameOverTimeRef.current = performance.now();
      SoundManager.play(SFX.wipe);
      playHaptic('failure');

      const finalScore = Math.floor(runStateRef.current.score);
      // Functional update on purpose: reading `highScore` here would make this
      // callback change identity every time a personal best lands, which would
      // tear down and rebuild the frame loop between runs.
      setHighScore((prev) => Math.max(prev, finalScore));
      void saveScoreRef.current?.(finalScore, picksRef.current, endRow);
    },
    [syncHud],
  );

  /** Resolve the gate row the squad just crossed: record the pick, apply the
   *  gate through the SHARED sim, and bank the row's score. */
  const resolveGateRow = useCallback(
    (entry: LiveGateRow) => {
      entry.resolved = true;
      const anchorX = anchorXRef.current;
      const lane = anchorX < -GATE_DIVIDER ? 0 : anchorX > GATE_DIVIDER ? 2 : 1;
      picksRef.current.push({
        row: entry.row,
        lane,
        t: Math.round(elapsedMsRef.current),
      });

      if (lane !== 1) {
        const gate = entry.gates[lane === 0 ? 0 : 1]!;
        const before = runStateRef.current;
        runStateRef.current = applyGate(before, gate);
        const after = runStateRef.current;

        const x = lane === 0 ? 0.28 : 0.72;
        if (gate.kind === 'evolve') {
          addFloater(gate.label, 'evolve', x, 0.42);
          SoundManager.play(SFX.evolve);
          playHaptic('success');
          fireFlashRef.current = 1;
        } else if (gate.good) {
          const delta = after.count - before.count;
          addFloater(delta > 0 ? `+${delta}` : gate.label, 'good', x, 0.42);
          SoundManager.play(SFX.gateGood);
          playHaptic('light');
        } else {
          const delta = before.count - after.count;
          addFloater(delta > 0 ? `−${delta}` : gate.label, 'bad', x, 0.42);
          SoundManager.play(SFX.gateBad);
          playHaptic('medium');
          shakeRef.current = Math.min(1, shakeRef.current + 0.5);
        }

        const particles = particlesRef.current;
        if (particles.length && !reducedMotionRef.current) {
          emitSpriteParticles(particles, 14, {
            origin: [
              (lane === 0 ? -1 : 1) * (GATE_DIVIDER + GATE_PANEL_W / 2),
              1.5,
              forwardZ(0.5),
            ],
            spread: 1.6,
            speed: [2, 7],
            up: [1.5, 5],
            ttl: [0.35, 0.75],
            size: [0.5, 1.3],
            grow: 0.6,
            spin: 5,
          });
        }
      }

      if (runStateRef.current.count <= 0) {
        endRun(entry.row);
        return;
      }

      runStateRef.current.kills += packSizeForRow(entry.row);
      runStateRef.current.score += gateRowScore(entry.row);
      setRowsCleared(entry.row);
      syncHud();
    },
    [addFloater, endRun, syncHud],
  );

  /** Enter the arena at a wave row. The OUTCOME is decided immediately by the
   *  shared sim; the animation below only performs it. */
  const beginWave = useCallback(
    (row: number) => {
      const seed = seedRef.current ?? 0;
      const wave = waveForRow(seed, row);
      const outcome = resolveWave(runStateRef.current, wave);
      const fightSeconds = Math.max(WAVE_MIN_VISUAL_S, outcome.fightSeconds);

      const enemies: LiveEnemy[] = [];
      const total = Math.min(ENEMY_CAP, wave.enemies);
      for (let i = 0; i < total; i += 1) {
        const angle = (i / total) * Math.PI * 2 + (i % 3) * 0.11;
        enemies.push({
          angle,
          radius: ARENA_RADIUS * (0.72 + ((i * 37) % 100) / 340),
          speed: 2.4 + ((i * 53) % 100) / 90,
          elite: i % 9 === 0,
          // Kills are spread across the fight so the horde visibly melts at the
          // rate the squad's DPS actually earned.
          dieAt: WAVE_INTRO_S + ((i + 1) / total) * fightSeconds,
          alive: true,
          bob: i * 0.6,
        });
      }

      waveRef.current = {
        wave,
        losses: outcome.losses,
        cleared: outcome.cleared,
        fightSeconds,
        duration: WAVE_INTRO_S + fightSeconds + WAVE_OUTRO_S,
        elapsed: 0,
        enemies,
        killed: 0,
        lost: 0,
        startCount: runStateRef.current.count,
      };

      gameStateRef.current = 'wave';
      setGameState('wave');
      setWaveBanner(`HORDE — ${wave.enemies} INCOMING`);
      SoundManager.play(SFX.waveStart);
      playHaptic('medium');
    },
    [],
  );

  /** Advance the arena animation. Returns nothing; ends the run or resumes the
   *  track when the fight is over. */
  const stepWave = useCallback(
    (dtSeconds: number) => {
      const active = waveRef.current;
      if (!active) return;
      active.elapsed += dtSeconds;
      const now = active.elapsed;

      // Converge, then pop on the pre-scheduled kill clock.
      let killedNow = 0;
      for (const enemy of active.enemies) {
        if (!enemy.alive) continue;
        if (now >= enemy.dieAt) {
          enemy.alive = false;
          killedNow += 1;
          const particles = particlesRef.current;
          if (particles.length && !reducedMotionRef.current) {
            emitSpriteParticles(particles, 3, {
              origin: [
                Math.cos(enemy.angle) * enemy.radius,
                0.6,
                Math.sin(enemy.angle) * enemy.radius + forwardZ(2),
              ],
              spread: 0.5,
              speed: [1, 3.5],
              up: [1, 3],
              ttl: [0.25, 0.5],
              size: [0.4, 0.9],
              grow: 0.5,
            });
          }
          continue;
        }
        // Close on the ring but never walk through it.
        enemy.radius = Math.max(3.2, enemy.radius - enemy.speed * dtSeconds);
      }
      if (killedNow > 0) {
        active.killed += killedNow;
        fireFlashRef.current = Math.min(1, fireFlashRef.current + 0.25);
        if (active.killed % 6 === 0) SoundManager.play(SFX.waveHit);
      }

      // Bleed the squad down over the fight so the cost is felt, not announced.
      const fightProgress = Math.max(
        0,
        Math.min(1, (now - WAVE_INTRO_S) / active.fightSeconds),
      );
      const shouldHaveLost = Math.min(
        active.losses,
        Math.floor(active.losses * fightProgress),
      );
      if (shouldHaveLost > active.lost) {
        const lost = shouldHaveLost - active.lost;
        active.lost = shouldHaveLost;
        runStateRef.current.count = Math.max(
          0,
          active.startCount - active.lost,
        );
        setSquadCount(runStateRef.current.count);
        shakeRef.current = Math.min(1, shakeRef.current + 0.12 * lost);
        playHaptic('light');
      }

      if (now < active.duration) return;

      // ── Fight over: settle exactly on the shared sim's numbers. ──
      const wave = active.wave;
      runStateRef.current.count = Math.max(
        0,
        active.startCount - active.losses,
      );
      if (!active.cleared || runStateRef.current.count <= 0) {
        waveRef.current = null;
        endRun(wave.row);
        return;
      }

      runStateRef.current.kills += wave.enemies;
      runStateRef.current.score += waveRowScore(
        wave.row,
        wave.enemies,
        runStateRef.current.count,
        runStateRef.current.tier,
      );
      waveRef.current = null;
      setRowsCleared(wave.row);
      setWaveBanner(null);
      syncHud();
      addFloater('HORDE CLEARED', 'good', 0.5, 0.36);
      SoundManager.play(SFX.waveClear);
      gameStateRef.current = 'playing';
      setGameState('playing');
    },
    [addFloater, endRun, syncHud],
  );

  /** One fixed simulation step (60 Hz). Everything that decides the score
   *  happens here, on the same clock the recorded pick timestamps use. */
  const simulate = useCallback(
    (stepMs: number) => {
      const phase = gameStateRef.current;
      if (phase !== 'playing' && phase !== 'wave') return false;

      const dt = stepMs / 1000;
      elapsedMsRef.current += stepMs;
      bobRef.current += dt;
      shakeRef.current = Math.max(0, shakeRef.current - dt * 2.4);
      fireFlashRef.current = Math.max(0, fireFlashRef.current - dt * 3.2);

      if (particlesRef.current.length) {
        stepSpriteParticles(particlesRef.current, dt, 7, 0.7);
      }

      if (phase === 'wave') {
        stepWave(dt);
        return true;
      }

      // ── Steering ──
      if (keyDirRef.current !== 0) {
        targetXRef.current = Math.max(
          -TRACK_HALF_WIDTH,
          Math.min(
            TRACK_HALF_WIDTH,
            targetXRef.current + keyDirRef.current * KEY_STEER_SPEED * dt,
          ),
        );
      }
      anchorXRef.current = expDamp(
        anchorXRef.current,
        targetXRef.current,
        STEER_RATE,
        dt,
      );

      // ── Advance ──
      const row = nextRowRef.current;
      const speed = speedForRow(row - 1);
      distanceRef.current += speed * dt;

      // Barricades shove the squad off the guarded line unless it is big enough
      // to blow through. They never cost gunners — the only consequence is the
      // gate you end up taking, which is exactly what the replay records.
      for (const entry of liveRowsRef.current) {
        if (entry.barricade < 0 || entry.barricadeHit || entry.resolved) continue;
        const z = entry.row * ROW_SPACING - distanceRef.current - 7;
        if (z > 1.2 || z < -1.2) continue;
        const side = entry.barricade === 0 ? -1 : 1;
        const centre = side * (GATE_DIVIDER + GATE_PANEL_W / 2);
        if (Math.abs(anchorXRef.current - centre) > GATE_PANEL_W * 0.42) continue;
        entry.barricadeHit = true;
        // A heavy squad smashes straight through; a light one gets deflected.
        if (squadDps(runStateRef.current) < 90 + entry.row * 26) {
          targetXRef.current = anchorXRef.current - side * 2.4;
          shakeRef.current = Math.min(1, shakeRef.current + 0.45);
          SoundManager.play(SFX.waveHit);
          playHaptic('medium');
        } else {
          shakeRef.current = Math.min(1, shakeRef.current + 0.2);
        }
        if (particlesRef.current.length && !reducedMotionRef.current) {
          emitSpriteParticles(particlesRef.current, 10, {
            origin: [centre, 0.7, forwardZ(0.4)],
            spread: 1.1,
            speed: [2, 6],
            up: [1.5, 4],
            ttl: [0.3, 0.6],
            size: [0.4, 1],
            grow: 0.5,
            spin: 6,
          });
        }
      }

      // ── Row crossing ──
      if (distanceRef.current >= row * ROW_SPACING) {
        nextRowRef.current = row + 1;
        if (isWaveRow(row)) {
          beginWave(row);
        } else {
          const entry = liveRowsRef.current.find((live) => live.row === row);
          if (entry) resolveGateRow(entry);
        }
      }

      refreshRows();
      return true;
    },
    [beginWave, refreshRows, resolveGateRow, stepWave],
  );

  // ── Run lifecycle ─────────────────────────────────────────────────────────

  const resetRun = useCallback(() => {
    runStateRef.current = initialRunState();
    picksRef.current = [];
    distanceRef.current = 0;
    elapsedMsRef.current = 0;
    nextRowRef.current = 1;
    spawnedRowRef.current = 0;
    endRowRef.current = 0;
    liveRowsRef.current = [];
    freeSlotsRef.current = gateVisualsRef.current.map((_, index) => index);
    for (const visual of gateVisualsRef.current) visual.group.visible = false;
    waveRef.current = null;
    anchorXRef.current = 0;
    targetXRef.current = 0;
    keyDirRef.current = 0;
    dragRef.current = null;
    shakeRef.current = 0;
    fireFlashRef.current = 0;
    camYRef.current = CAM_RUN.y;
    camZRef.current = CAM_RUN.z;
    camFovRef.current = CAM_RUN.fov;
    camXRef.current = 0;
    resetSpriteParticles(particlesRef.current);
    gameStartTimeRef.current = performance.now();
    setRowsCleared(0);
    setWaveBanner(null);
    setFloaters([]);
    syncHud();
    refreshRows();
  }, [refreshRows, syncHud]);

  const startGame = useCallback(async () => {
    if (isStartingRef.current) return;
    // Without this guard a Space press would open a server session and wedge
    // the state machine in 'playing' with nothing to render.
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
    resetRunResult();

    let sessionSuccess = false;
    try {
      const sessionResponse = await fetch('/api/games/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameType: 'gunrush' }),
      });
      if (sessionResponse.ok) {
        setBanIndefinite(false);
        setBanUntilMs(null);
        const sessionData = await sessionResponse.json();
        sessionTokenRef.current = sessionData.token;
        seedRef.current =
          typeof sessionData.gunrushSeed === 'number'
            ? sessionData.gunrushSeed
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
        // Guest run — local seed, scores not saved (mirrors the other solo games).
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
    frameLoopRef.current?.resetClock();
    frameLoopRef.current?.start();
  }, [resetRun, resetRunResult]);

  const primaryAction = useCallback(() => {
    const current = gameStateRef.current;
    if (current === 'idle' || current === 'error') {
      void startGame();
    } else if (current === 'gameover') {
      const since = performance.now() - gameOverTimeRef.current;
      if (since >= RESTART_GRACE_PERIOD) void startGame();
    }
  }, [startGame]);

  // ── Input: keyboard ───────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        if (gameStateRef.current === 'playing') {
          e.preventDefault();
          if (keyDirRef.current !== -1) SoundManager.play(SFX.steer);
          keyDirRef.current = -1;
        }
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        if (gameStateRef.current === 'playing') {
          e.preventDefault();
          if (keyDirRef.current !== 1) SoundManager.play(SFX.steer);
          keyDirRef.current = 1;
        }
      } else if (
        e.code === 'Space' ||
        e.code === 'ArrowUp' ||
        e.code === 'Enter'
      ) {
        if (e.repeat) return;
        if (gameStateRef.current !== 'playing' && gameStateRef.current !== 'wave') {
          e.preventDefault();
          primaryAction();
        }
      }
    },
    [primaryAction],
  );

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      if (keyDirRef.current === -1) keyDirRef.current = 0;
    } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      if (keyDirRef.current === 1) keyDirRef.current = 0;
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  // ── Input: pointer (mouse drag + touch drag, one unified path) ────────────

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // Unlock audio inside the trusted gesture so later cues actually play.
      SoundManager.unlock();
      e.preventDefault();
      e.stopPropagation();
      if (gameStateRef.current === 'wave') return;
      if (gameStateRef.current !== 'playing') {
        primaryAction();
        return;
      }
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startAnchor: anchorXRef.current,
      };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [primaryAction],
  );

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (gameStateRef.current !== 'playing') return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Map screen pixels to world units through the stage width so the same
    // flick travels the same distance on a phone and a desktop.
    const rect = canvas.getBoundingClientRect();
    const perPixel = (TRACK_HALF_WIDTH * 2 * DRAG_GAIN) / Math.max(1, rect.width);
    const next = drag.startAnchor + (e.clientX - drag.startX) * perPixel;
    targetXRef.current = Math.max(
      -TRACK_HALF_WIDTH,
      Math.min(TRACK_HALF_WIDTH, next),
    );
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (drag && drag.pointerId === e.pointerId) dragRef.current = null;
  }, []);

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    setBanNowMs(Date.now());
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

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      reducedMotionRef.current = mq.matches;
    };
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    void fetchUserBestScore();
    void loadWallet();
  }, [fetchUserBestScore, loadWallet]);

  // Responsive sizing — the canvas fills the tall stage (mirrors swerve).
  useEffect(() => {
    const updateSize = () => {
      const container = containerRef.current;
      if (!container) return;
      const reservedVertical = window.innerHeight < 700 ? 210 : 270;
      const maxWidth = Math.min(window.innerWidth - 24, 560);
      const maxHeight = Math.min(
        window.innerHeight - reservedVertical,
        BASE_HEIGHT,
      );
      const scale = Math.min(maxWidth / BASE_WIDTH, maxHeight / BASE_HEIGHT, 1.25);
      const width = Math.floor(BASE_WIDTH * scale);
      const height = Math.floor(BASE_HEIGHT * scale);
      setCanvasSize({ width, height, dpr: gameCanvasDpr(width, height) });
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Build the three.js scene once, then keep it sized + rendered to the stage.
  useEffect(() => {
    buildScene();
    resize3D(canvasSize.width, canvasSize.height);
    if (gameStateRef.current !== 'playing' && gameStateRef.current !== 'wave') {
      render3D();
    }
  }, [buildScene, resize3D, render3D, canvasSize]);

  // Latest sim/render callbacks, read through refs by the frame loop below so
  // the loop itself is built exactly once. Rebuilding it mid-session would
  // silently leave a stopped loop behind and freeze the next run.
  const simulateRef = useRef(simulate);
  const render3DRef = useRef(render3D);
  simulateRef.current = simulate;
  render3DRef.current = render3D;

  // The shared fixed-timestep loop: 60 Hz sim, paint every rAF, auto-paused
  // when the tab is hidden (so a backgrounded run can't drift its sim clock).
  useEffect(() => {
    const loop = createGameFrameLoop({
      simulate: (stepMs) => simulateRef.current(stepMs),
      render: () => render3DRef.current(),
    });
    frameLoopRef.current = loop;
    return () => {
      loop.destroy();
      frameLoopRef.current = null;
    };
  }, []);

  // Apply equipped cosmetics to the live scene. Runs after inventory loads (or
  // an equip change) and recolors materials/lights/fog in place. A still frame
  // is re-rendered when idle so the change shows immediately.
  useEffect(() => {
    themeRef.current = theme;
    const mats = themeMatsRef.current;
    const scene = sceneRef.current;
    if (!mats || !scene) return;
    mats.deck.color.set(theme.laneColor);
    mats.rail.color.set(theme.railColor);
    mats.railTop.color.set(theme.railTopColor);
    mats.gunnerBody.color.set(theme.squadBody);
    mats.gunnerHead.color.set(theme.squadHead);
    if (theme.squadGlow) {
      mats.gunnerBody.emissive.set(theme.squadGlow);
      mats.gunnerBody.emissiveIntensity = theme.squadGlowIntensity;
    } else {
      mats.gunnerBody.emissive.set(0x000000);
      mats.gunnerBody.emissiveIntensity = 0;
    }
    mats.gunBody.color.set(theme.gunBody);
    mats.gunBarrel.color.set(theme.gunAccent);
    mats.tracer.color.set(theme.tracerColor);
    mats.hemi.color.set(theme.accentColor);
    mats.hemi.groundColor.set(theme.groundColor);
    if (scene.background instanceof THREE.Color) {
      scene.background.set(theme.skyColor);
    }
    if (scene.fog instanceof THREE.Fog) scene.fog.color.set(theme.fogColor);
    const muzzle = muzzleLightRef.current;
    if (muzzle) muzzle.color.set(theme.muzzleColor);
    if (gameStateRef.current !== 'playing' && gameStateRef.current !== 'wave') {
      render3D();
    }
  }, [render3D, theme]);

  // Tear the scene down on unmount (the frame loop owns its own cleanup).
  useEffect(() => {
    return () => {
      envDisposeRef.current?.();
      envDisposeRef.current = null;
      for (const visual of gateVisualsRef.current) {
        for (const panel of visual.panels) panel.texture.dispose();
      }
      if (sceneRef.current) disposeSceneDeep(sceneRef.current);
      rendererRef.current?.dispose();
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
    };
  }, []);

  const walletCard = {
    credits: walletBalances.credits,
    progress: {
      label: 'Daily tickets',
      current: dailyCreditsProgress.earned,
      max: dailyCreditsProgress.cap,
    },
  };

  const damageChip = Math.round(statChips.damage * 100) / 100;
  const rateChip = Math.round(statChips.rate * 100) / 100;

  return (
    <div className="gunrush-midway arc-game-flow">
      <div className="w-full space-y-3 sm:space-y-4">
        <div className="mx-auto w-full max-w-3xl">
          <div className="hidden sm:block">
            <PageHeader
              eyebrow="Arcade"
              icon={<Crosshair aria-hidden className="h-6 w-6" />}
              title="Gunrush"
              subtitle="Steer your squad through the gates, evolve the arsenal, and hold the ring when the horde arrives."
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
            className="gunrush-stage relative"
            style={{ width: canvasSize.width, height: canvasSize.height }}
          >
            {webglError ? (
              <div
                className="flex flex-col items-center justify-center rounded-well border-2 border-ink px-6 text-center"
                style={{ width: canvasSize.width, height: canvasSize.height }}
              >
                <p className="text-sm text-strong">
                  Gunrush needs WebGL, which this browser or device has disabled.
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
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  className="block cursor-pointer rounded-well border-2 border-ink"
                  style={{
                    touchAction: 'none',
                    width: canvasSize.width,
                    height: canvasSize.height,
                  }}
                />

                {(gameState === 'playing' || gameState === 'wave') && (
                  <>
                    {/* Squad strength badge — the number the whole run is about. */}
                    <div className="gunrush-squad arcade-num" aria-hidden>
                      <span className="gunrush-squad-count" key={squadCount}>
                        {squadCount}
                      </span>
                      <span className="gunrush-squad-label">GUNNERS</span>
                    </div>

                    {/* Arsenal + active multipliers. */}
                    <div className="gunrush-arsenal" aria-hidden>
                      <span className="gunrush-arsenal-tier arcade-num">
                        T{weaponTier}
                      </span>
                      <span className="gunrush-arsenal-name">{weaponName}</span>
                    </div>
                    <div className="gunrush-chips" aria-hidden>
                      {damageChip !== 1 && (
                        <span className="gunrush-chip arcade-num">
                          DMG ×{damageChip}
                        </span>
                      )}
                      {rateChip !== 1 && (
                        <span className="gunrush-chip arcade-num">
                          RATE ×{rateChip}
                        </span>
                      )}
                    </div>

                    {waveBanner && (
                      <div className="gunrush-wave-banner arcade-num" aria-hidden>
                        {waveBanner}
                      </div>
                    )}
                  </>
                )}

                {/* Floating combat plate (presentation only). */}
                {floaters.map((f) => (
                  <span
                    key={f.id}
                    aria-hidden
                    className="arc-floater"
                    data-tone={f.tone === 'bad' ? 'warning' : f.tone === 'evolve' ? 'combo' : 'score'}
                    data-numeric={isNumericLabel(f.text) || undefined}
                    style={
                      {
                        left: `${f.x * 100}%`,
                        top: `${f.y * 100}%`,
                        '--callout-ms': `${calloutLifeMs(reducedMotion, 1000)}ms`,
                      } as CSSProperties
                    }
                  >
                    <span className="arc-floater-label">{f.text.toLowerCase()}</span>
                  </span>
                ))}
              </>
            )}

            {gameState !== 'playing' && gameState !== 'wave' && !webglError && (
              <div
                className="gunrush-overlay absolute inset-0 flex touch-none flex-col items-center justify-center rounded-well px-4"
                style={{
                  background:
                    'color-mix(in srgb, var(--scrim) 78%, transparent)',
                }}
                onPointerDown={handlePointerDown}
              >
                {gameState === 'idle' && (
                  <>
                    <Crosshair size={56} className="mb-4 text-tickets-text" />
                    <h1 className="arcade-display mb-2 text-center text-2xl text-strong uppercase sm:text-3xl">
                      Gunrush
                    </h1>
                    <p className="mb-2 text-center text-sm text-strong sm:text-base">
                      {isStartingSession
                        ? 'Starting your run…'
                        : touchDevice
                          ? 'Tap to start — drag left/right to steer'
                          : 'Press Space or click to start'}
                    </p>
                    <p className="max-w-xs text-center text-xs text-body sm:text-sm">
                      Blue gates grow the squad, red ones cut it down, and purple
                      ones evolve your gun. Every fifth gate is a horde — your
                      build decides who walks out.
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
                      Squad wiped
                    </h2>
                    <p className="mb-1 text-xl text-strong sm:text-2xl">
                      Scored{' '}
                      <span className="arcade-num font-semibold">{score}</span>
                    </p>
                    <p className="mb-4 text-base text-body sm:text-lg">
                      {rowsCleared} gates · {kills} kills · Best{' '}
                      <span className="arcade-num">{highScore}</span>
                    </p>
                    <ArcadeRunRewards
                      reward={runResult.reward}
                      achievements={runResult.achievements}
                      saving={isSubmitting}
                      error={submitError}
                      guest={runRewardMessage?.startsWith('Guest run')}
                      className="mb-4 max-w-xs"
                    />
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

        <p className="mt-3 text-center text-xs text-faint sm:text-sm">
          {touchDevice ? (
            'Drag left or right to steer the squad through a gate'
          ) : (
            <>
              Steer with{' '}
              <kbd className="arcade-card-inset px-2 py-1 text-strong">←</kbd>{' '}
              <kbd className="arcade-card-inset px-2 py-1 text-strong">→</kbd> or
              A / D — or drag the stage
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
        title="Gunrush board"
        description="Deepest runs down the gauntlet, and your rank."
      >
        <GameLeaderboard
          gameType="gunrush"
          maxEntries={5}
          enableFullLeaderboardModal
          fullLeaderboardDisplay="inline"
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>
    </div>
  );
}
