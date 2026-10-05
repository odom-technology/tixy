'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
import { GameLeaderboardModal } from '@/features/arcade/components/game-leaderboard-modal';
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
import { isControlTarget, isDialogOpen } from '@/features/arcade/lib/use-first-input';
import { EnvMonitor } from '@/features/arcade/lib/game-anti-cheat';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { playHaptic } from '@/features/arcade/lib/game-haptics';
import {
  useFeelReducedMotion,
  useGameFeedback,
  usePitchLadder,
} from '@/features/arcade/lib/use-game-feedback';
import { settleEase } from '@/features/arcade/lib/game-feel';
import {
  createGameFrameLoop,
  type GameFrameInfo,
  type GameFrameLoop,
} from "@/features/arcade/lib/game-frame-loop";
import {
  beginArcadeInput,
  markArcadeGameReady,
  type ArcadePerformanceSpan,
} from "@/features/arcade/lib/arcade-performance";
import {
  MIDWAY_PALETTE,
  applyMidwayTier,
  createMidwayDeferredTextures,
  createMidwayLightRig,
  createMidwayQualityController,
  createMidwayRenderer,
  disposeSceneDeep,
  emitSpriteParticles,
  expDamp,
  makeMidwayMaterial,
  markMidwayFirstFrame,
  midwayCanvasFont,
  midwayParticleCount,
  makeSoftDiscTexture,
  makeSparkTexture,
  makeSpriteParticlePool,
  makeStripeTexture,
  paintStripes,
  resetSpriteParticles,
  stepSpriteParticles,
  type MidwayDeferredTextures,
  type MidwayLightRig,
  type MidwayQualityController,
  type MidwayRendererHandle,
  type SpriteParticle,
} from '@/features/arcade/lib/midway-three';
import { MidwayStill } from '@/features/arcade/components/midway-still';
import { ArcadeRematchButton, ArcadeRunResult } from '@/features/arcade/components/results/arcade-run-result';
import { useArcadeRunResult } from '@/features/arcade/lib/run-result';
import type { AccountXpReward } from '@/server/arcade/rewards/types';
import * as THREE from 'three';
import {
  strikerDisplayLeadMs,
  strikerFlightTimes,
  strikerGaugeValue,
  strikerInitialState,
  strikerJudgeHold,
  strikerPuckKind,
  strikerRoundFor,
  strikerRunDone,
  STRIKER_DROP_MS_MAX,
  STRIKER_DROP_MS_MIN,
  STRIKER_LATE_GRACE_MS,
  type StrikerRound,
  type StrikerSimState,
  type StrikerSwing,
} from '@/server/arcade/high-striker-replay';
import {
  DEFAULT_HIGH_STRIKER_THEME,
  buildHighStrikerTheme,
  type HighStrikerCosmeticTheme,
  type InventoryCosmeticResponse,
} from './_high-striker-theme';
import { makePuckGeometry, makePuckMarkGeometry, paintTowerFace } from './_high-striker-skin';

/* ──────────────────────────────────────────────────────────────────────────
   HIGH STRIKER: the midway strongman tower, in three.js. Rules 3, endless.

   Hold to wind up, let go to swing. The mallet draws back as you hold, the
   tower's channel fills, and a tone rises with it. The fill climbs to the
   top and falls back: let go while it is over the line and the puck clears
   it; let go in the red band at the very top and the bell rings. Let go
   under the line, early or late, and the run ends. Every swing the window
   narrows and the fill gets quicker (high-striker-replay.ts has the curve).

   The strength is a pure function of the time held. The swing's `t` is the
   time between the press and the release, read from the two events' own
   timestamps, so a slow frame can't move it. The fill is drawn one frame
   ahead (the display lead), so what you see when you let go is what you
   get. The client judges the swing with the same state machine the server
   replays, and sends the same `{ t }` list.

   Flat look: ink and walnut tower, enamel stripes, brass rails, one lamp. The
   score is on the cabinet's own display, painted on the first frame. No DOM
   over the stage. Reduced motion: no shake, hit-stop, squash, particles,
   tremble, camera move or bell sway; the wind-up and the flight still play
   (that motion is the game).
   ────────────────────────────────────────────────────────────────────────── */

// The canvas keeps this portrait shape; the shell scales it to the stage.
const BASE_WIDTH = 340;
const BASE_HEIGHT = 640;

const RESTART_GRACE_PERIOD = 400;
/** The result comes up this long after the missed swing's puck lands. */
const RESULT_DELAY_MS = 650;
/** Every this many hits the display marks the depth. */
const MILESTONE_EVERY = 10;

const GUEST_RUN_MESSAGE = 'Sign in to save scores and earn tickets.';

const HINT: GameHint = {
  touch: 'Hold, and let go at the top.',
  pointer: 'Hold space or click, let go at the top.',
};
const HOW_TO: GameHowTo = {
  lines: [
    'Hold to fill the tower, and let go in the red band.',
    'Let go under the line and the run ends.',
    'A hit scores 1, a bell 3 to 8, and 50 points pay 48 tickets.',
  ],
  picture: <HowToPicture />,
};

/** The ? sheet's picture: the tower mid-hold, the fill in the red band over the line. */
function HowToPicture() {
  const P = MIDWAY_PALETTE;
  return (
    <svg viewBox='0 0 160 110' width={320} height={220} role='img' aria-label='The tower with the fill over the line and in the red band at the top.'>
      <rect width='160' height='110' fill={P.ink} />
      <rect x='60' y='14' width='40' height='86' rx='2' fill='#5b3a24' />
      <rect x='64' y='16' width='7' height='82' fill={P.red} />
      <rect x='89' y='16' width='7' height='82' fill={P.paper} />
      <rect x='73' y='18' width='14' height='80' fill='#2b2119' />
      <rect x='73' y='18' width='14' height='18' fill='#4a3f35' />
      <rect x='73' y='18' width='14' height='4' fill={P.red} />
      <rect x='75' y='36' width='10' height='62' fill={P.ticket} opacity={0.45} />
      <rect x='75' y='22' width='10' height='14' fill={P.ticket} />
      <rect x='75' y='19' width='10' height='3' fill={P.paper} />
      <rect x='68' y='35' width='24' height='2.4' fill={P.paper} />
      <path d='M66 13 Q80 -1 94 13 Z' fill={P.brass} />
      <path d='M106 94 L124 72' stroke={P.brass} strokeWidth='3' strokeLinecap='round' />
      <rect x='117' y='62' width='16' height='10' rx='2' fill='#8a5a3a' transform='rotate(40 125 67)' />
    </svg>
  );
}

// Scene geometry (world units).
const TOWER_BASE_Y = 1.12;
const TOWER_HEIGHT = 8.4;
const TOWER_TOP_Y = TOWER_BASE_Y + TOWER_HEIGHT;
const PUCK_REST_Y = TOWER_BASE_Y + 0.24;
const PUCK_BELL_Y = TOWER_TOP_Y - 0.28;
const PUCK_SPAN = PUCK_BELL_Y - PUCK_REST_Y;
const BELL_Y = TOWER_TOP_Y + 0.5;
// The brass strike plate the mallet actually lands on.
const PLATE_X = 0.1;
const PLATE_Y = TOWER_BASE_Y + 0.1;
const PLATE_Z = 0.86;

// Camera: the whole tower, from the plinth to the bell's yoke, fills the
// portrait canvas. Fixed, since the canvas keeps one shape at every size.
const CAM_FOV = 40;
const CAM_Z = 16.2;
const CAM_REST_Y = 4.8;
const LOOK_REST_Y = 5.65;
/** While the puck climbs the camera eases in and up by this much. */
const CAM_PUSH_Z = 3.2;
const CAM_PUSH_Y = 1.3;
const CAM_PUSH_LOOK = 1.3;
/** How far the camera pushes in for each kind of climb. Every hit reaches
 *  the top of the tower now, so only the bell gets the whole push. */
const ZOOM_BY_KIND: Record<'weak' | 'normal' | 'near' | 'bell', number> = {
  weak: 0,
  normal: 0.3,
  near: 0.55,
  bell: 1,
};
/** Shake: px from the feel kit to world units at the tower. */
const SHAKE_UNITS_PER_PX = 0.0175;

// The mallet pivots at the striker's shoulder beside the plate. NEGATIVE
// rotation lifts the head, so rest and wind-up are negative and the strike
// frame is level with the plate.
const HAMMER_PIVOT: [number, number, number] = [1.92, 1.48, PLATE_Z];
const HAMMER_ARM_LEN = 1.82;
const HAMMER_REST_ROT = -0.86;
/** Drawn all the way back: the head is overhead. */
const HAMMER_FULL_ROT = -1.75;
const HAMMER_STRIKE_ROT = 0.03;
/** The drop from a full draw takes STRIKER_DROP_MS_MAX; a short draw is quicker. */
const HAMMER_BACK_MS = 520;

// The puck's flight times come from the shared replay module (strikerFlightTimes),
// which the reward curve is priced on.
/** The haptic ramp: ticks come every this many ms, from empty to full. */
const TICK_SLOW_MS = 230;
const TICK_FAST_MS = 55;

const SFX = {
  start: 'arcadeReveal',
  whoosh: 'strikerWhoosh', // the mallet head cutting the air on the way down
  strike: 'strikerImpact', // mallet onto the brass plate
  graze: 'arcadeBet', // modest clack: just over the line
  clean: 'coinCorrect', // bright chime: crushed hit
  streak: 'arcadeCashout', // two-note: crushed streak 3+
  bell: 'strikerBell', // the brass bell, struck and left ringing
  jackpot: 'coinStreakMilestone', // the jackpot stinger over the bell
  land: 'strikerPuckLand', // the puck dropping back onto its stop
  thud: 'strikerThud', // a weak swing: dull, no ring
  tick: 'arcadeTick', // the channel's line, crossed
  win: 'arcadeWin',
  over: 'arcadeLose',
};

type GameState = 'idle' | 'playing' | 'gameover' | 'error';
type Phase = 'aim' | 'resolve' | 'over';

type DisplayMessage = { text: string; sub?: string; tone: 'ticket' | 'red'; until: number };
type DisplayState = {
  /** The score as shown (it rolls). */
  score: number;
  /** The swing being played, from 1: the depth. */
  swing: number;
  message: DisplayMessage | null;
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
  return 'Could not save your run. Try again.';
};

const easeInQuad = (x: number) => x * x;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** The cabinet's display: the score, the round, and a result in passing. */
function paintDisplay(canvas: HTMLCanvasElement, state: DisplayState, now: number): string {
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const w = canvas.width;
  const h = canvas.height;
  const P = MIDWAY_PALETTE;
  ctx.fillStyle = P.ink;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = P.brass;
  ctx.lineWidth = h * 0.035;
  ctx.strokeRect(h * 0.03, h * 0.03, w - h * 0.06, h - h * 0.06);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const message = state.message && now < state.message.until ? state.message : null;
  const numFont = midwayCanvasFont('num', 800, h * 0.52);
  // Left: the score, or a weak swing's reason.
  if (message && message.tone === 'red') {
    ctx.font = midwayCanvasFont('text', 800, h * 0.4);
    ctx.fillStyle = '#e0533f';
    ctx.fillText(message.text, w * 0.33, h * 0.5, w * 0.56);
  } else {
    ctx.font = midwayCanvasFont('text', 700, h * 0.23);
    ctx.fillStyle = P.paper;
    ctx.fillText('score', w * 0.33, h * 0.26, w * 0.5);
    ctx.font = numFont;
    ctx.fillStyle = P.ticket;
    ctx.fillText(String(Math.round(state.score)), w * 0.33, h * 0.68, w * 0.56);
  }
  // Right: the round, or what the swing scored.
  ctx.fillStyle = P.rail;
  ctx.fillRect(w * 0.64, h * 0.14, w * 0.32, h * 0.72);
  const lit = message && message.tone === 'ticket';
  if (lit) {
    ctx.font = midwayCanvasFont('num', 800, h * 0.5);
    ctx.fillStyle = P.ticket;
    ctx.fillText(message.text, w * 0.8, h * 0.44, w * 0.28);
    if (message.sub) {
      ctx.font = midwayCanvasFont('text', 800, h * 0.17);
      ctx.fillStyle = P.paper;
      ctx.fillText(message.sub, w * 0.8, h * 0.74, w * 0.28);
    }
  } else {
    ctx.font = midwayCanvasFont('text', 700, h * 0.23);
    ctx.fillStyle = P.paper;
    ctx.fillText('swing', w * 0.8, h * 0.27, w * 0.28);
    ctx.font = midwayCanvasFont('num', 800, h * 0.4);
    ctx.fillStyle = P.paper;
    ctx.fillText(String(state.swing), w * 0.8, h * 0.68, w * 0.28);
  }
  return numFont;
}

type WindTone = { set: (level: number) => void; stop: (fadeMs?: number) => void };

/** A hold in progress. `startMs` is the press event's own timestamp. */
type WindState = {
  startMs: number;
  source: 'pointer' | 'key';
  pointerId: number;
  round: StrikerRound;
  value: number;
  lastTickAt: number;
  aboveLine: boolean;
  inBell: boolean;
  /** The fill has been over the line on this hold. */
  wasAbove: boolean;
  tone: WindTone;
};

type PuckKind = 'weak' | 'normal' | 'near' | 'bell';

/** What a judged swing will show, once the mallet lands. */
type PendingSwing = {
  kind: PuckKind;
  strength: number;
  /** The run ends when this puck lands (a miss, or the top). */
  last: boolean;
  points: number;
  /** Bells in a row after this swing. */
  bellStreak: number;
  scoreAfter: number;
  /** Hits so far, after this swing. */
  hitsAfter: number;
  /** The swing number the display shows after this one. */
  swingAfter: number;
  /** A miss: let go before the peak or after it. */
  side: 'early' | 'late' | null;
};

type SwingAnim = {
  dropStartAt: number;
  dropMs: number;
  fromRot: number;
  struck: boolean;
  pending: PendingSwing;
};

type PuckAnim = {
  launchAt: number;
  from: number;
  to: number;
  riseMs: number;
  power: number;
  holdMs: number;
  downMs: number;
  endAt: number;
  stage: 'rise' | 'hold' | 'down';
  apexed: boolean;
  pending: PendingSwing;
};

const TICKET_DIM = new THREE.Color(MIDWAY_PALETTE.ticket).lerp(new THREE.Color(MIDWAY_PALETTE.ink), 0.5);
const TICKET_COLOR = new THREE.Color(MIDWAY_PALETTE.ticket);
const PAPER_COLOR = new THREE.Color(MIDWAY_PALETTE.paper);
const WINDOW_COLOR = new THREE.Color('#5a4a3c');
const LINE_RED = new THREE.Color('#e0533f');

export default function HighStrikerClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [gameState, setGameState] = useState<GameState>('idle');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState<number | null>(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [walletBalances, setWalletBalances] = useState({ credits: 0 });
  const [, setDailyCreditsProgress] = useState({ earned: 0, cap: 300 });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [runRewardMessage, setRunRewardMessage] = useState<string | null>(null);
  const [, setRunRewardIsCapHit] = useState(false);
  const [, setRunAccountXp] = useState<AccountXpReward | null>(null);
  const { result: runResult, capture: captureRunResult, reset: resetRunResult } = useArcadeRunResult();
  const [startError, setStartError] = useState<string | null>(null);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [banUntilMs, setBanUntilMs] = useState<number | null>(null);
  const [banIndefinite, setBanIndefinite] = useState(false);
  const [banNowMs, setBanNowMs] = useState(Date.now());
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);
  const [webglError, setWebglError] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [resultAnnouncement, setResultAnnouncement] = useState('');
  const [runStats, setRunStats] = useState({ rounds: 0, bells: 0, bestStreak: 0 });
  // Null until the stage reports its size: the renderer is sized once,
  // before the first render.
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);
  // Equipped cosmetics (tower / puck / background). Seeded with the exact
  // default palette so the idle render is unchanged before inventory loads.
  const [strikerTheme, setStrikerTheme] =
    useState<HighStrikerCosmeticTheme>(DEFAULT_HIGH_STRIKER_THEME);
  // A skin set's sound tint colours this game's cues while it is open.
  const skinSound = strikerTheme.skin?.sound ?? 'house';
  useEffect(() => {
    SoundManager.setTint(skinSound);
    return () => SoundManager.setTint('house');
  }, [skinSound]);

  const reducedMotion = useFeelReducedMotion();
  const { trigger, hitStopClock, shakeOffset } = useGameFeedback();
  const ladder = usePitchLadder();

  // ── Refs (mutable sim state; no re-render) ──
  const gameStateRef = useRef<GameState>('idle');
  const phaseRef = useRef<Phase>('aim');
  const sessionTokenRef = useRef<string | null>(null);
  const seedRef = useRef<number | null>(null);
  const envMonitorRef = useRef(new EnvMonitor());
  const scoreRef = useRef(0);
  const runStatsRef = useRef({ rounds: 0, bells: 0, bestStreak: 0 });
  const simRef = useRef<StrikerSimState>(strikerInitialState());
  const swingsRef = useRef<StrikerSwing[]>([]);

  // ── three.js scene refs (built once; updated per frame by renderScene) ──
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const puckRef = useRef<THREE.Group | null>(null);
  const hammerRef = useRef<THREE.Group | null>(null);
  const hammerHeadRef = useRef<THREE.Group | null>(null);
  const bellRef = useRef<THREE.Group | null>(null);
  const clapperRef = useRef<THREE.Group | null>(null);
  const plateRef = useRef<THREE.Group | null>(null);
  const themeRef = useRef<HighStrikerCosmeticTheme>(DEFAULT_HIGH_STRIKER_THEME);
  // The puck's parts, so a skin set can swap its shape and put the house disc back.
  const puckPartsRef = useRef<{
    key: string;
    body: THREE.Mesh;
    cap: THREE.Mesh;
    mark: THREE.Mesh;
    markMat: THREE.MeshStandardMaterial;
    houseGeo: THREE.BufferGeometry;
  } | null>(null);
  const themeMatsRef = useRef<{
    wood: THREE.MeshStandardMaterial;
    face: THREE.MeshStandardMaterial;
    channel: THREE.MeshStandardMaterial;
    tick: THREE.MeshStandardMaterial;
    trim: THREE.MeshStandardMaterial;
    bell: THREE.MeshStandardMaterial;
    puck: THREE.MeshStandardMaterial;
    hammerWood: THREE.MeshStandardMaterial;
    hammerHead: THREE.MeshStandardMaterial;
    pad: THREE.MeshStandardMaterial;
    ground: THREE.MeshBasicMaterial;
    hemi: THREE.HemisphereLight;
  } | null>(null);

  // The input and the swing. All times in the swing's own effect clock
  // (wall time with hit-stop taken out) except the wind-up's, which is the
  // press event's timestamp on the performance.now() clock.
  const windRef = useRef<WindState | null>(null);
  const swingRef = useRef<SwingAnim | null>(null);
  const puckAnimRef = useRef<PuckAnim | null>(null);
  const riseToneRef = useRef<WindTone | null>(null);
  const whooshAtRef = useRef<{ at: number; force: number } | null>(null);
  const bellAnimRef = useRef<{ start: number; amp: number } | null>(null);
  const puckLandRef = useRef<{ start: number } | null>(null);
  const shockwaveAnimRef = useRef<{ start: number } | null>(null);
  const plateHitRef = useRef<{ start: number; force: number } | null>(null);
  const malletRotRef = useRef(HAMMER_REST_ROT);
  const meterRef = useRef(0);
  const camZoomRef = useRef(0);
  const resultTimerRef = useRef<number>(0);
  const lastWallRef = useRef(0);
  const frozenTotalRef = useRef(0);
  const lastEffectRef = useRef(0);
  const phaseAttrRef = useRef('');
  // The tower's meter: the fill rides the channel; the line and the zones
  // are set once per round from the round's qualifier.
  const fillLowRef = useRef<THREE.Mesh | null>(null);
  const fillHighRef = useRef<THREE.Mesh | null>(null);
  const qualifierLine3DRef = useRef<THREE.Mesh | null>(null);
  // The window (line to the bell band) and the bell band, both resized per swing.
  const windowZoneRef = useRef<THREE.Mesh | null>(null);
  const bellZoneRef = useRef<THREE.Mesh | null>(null);
  const meterRoundRef = useRef(-1);
  const meterTargetRef = useRef({ set: false, lineY: PUCK_REST_Y, bellY: PUCK_BELL_Y, bellH: 0.0001 });
  /** The line's flash on a milestone (effect clock). */
  const lineFlashRef = useRef<{ start: number; red: boolean } | null>(null);
  /** A smoothed frame interval, ms, for the display lead. */
  const frameIntervalRef = useRef(1000 / 60);
  /** releaseWindup, for the frame that lets go of a hold held past its window. */
  const autoReleaseRef = useRef<(upMs: number) => void>(() => {});
  // The cabinet's display.
  const displayRef = useRef<{
    canvas: HTMLCanvasElement;
    texture: THREE.CanvasTexture;
    painted: string;
  } | null>(null);
  const displayStateRef = useRef<DisplayState>({ score: 0, swing: 1, message: null });
  const scoreRollRef = useRef<{ from: number; to: number; start: number } | null>(null);
  // Particle pools: pad dust and hot sparks on the strike, enamel confetti on
  // the bell. All three are fixed-size and stepped allocation-free.
  const dustRef = useRef<SpriteParticle[]>([]);
  const sparkRef = useRef<SpriteParticle[]>([]);
  const confettiRef = useRef<SpriteParticle[]>([]);
  const shockwaveRef = useRef<THREE.Mesh | null>(null);
  const shockwaveMatRef = useRef<THREE.MeshBasicMaterial | null>(null);

  const frameLoopRef = useRef<GameFrameLoop | null>(null);
  const renderSceneRef = useRef<(frame?: GameFrameInfo) => void>(() => {});
  // The 3D kit: quality tier, light rig, renderer handle, deferred textures.
  const qualityRef = useRef<MidwayQualityController | null>(null);
  const rigRef = useRef<MidwayLightRig | null>(null);
  const rendererHandleRef = useRef<MidwayRendererHandle | null>(null);
  const deferredRef = useRef<MidwayDeferredTextures | null>(null);
  const deferredStartedRef = useRef(false);
  const gameStartTimeRef = useRef(0);
  const gameOverTimeRef = useRef<number>(0);
  const isStartingRef = useRef(false);
  const isGuestRunRef = useRef(false);
  const reducedMotionRef = useRef(false);
  const saveScoreRef = useRef<((score: number, swings: StrikerSwing[]) => Promise<void>) | null>(null);
  const bestScoreCacheRef = useRef<number | null>(null);
  const perfLoadStartedAtRef = useRef<number | undefined>(
    typeof window === "undefined" ? undefined : performance.now(),
  );
  const perfReadyRef = useRef(false);
  const pendingInputSpanRef = useRef<ArcadePerformanceSpan | null>(null);

  /** The effect clock: performance.now() with every hit-stop taken out. */
  const effectNow = useCallback(() => {
    const wall = performance.now();
    const last = lastWallRef.current || wall;
    frozenTotalRef.current += hitStopClock.frozenWithin(last, wall);
    lastWallRef.current = wall;
    return wall - frozenTotalRef.current;
  }, [hitStopClock]);

  const fetchUserBestScore = useCallback(async () => {
    if (bestScoreCacheRef.current !== null) {
      setHighScore(bestScoreCacheRef.current);
      return;
    }
    try {
      const response = await fetch('/api/games/high-striker/score', {
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
      const response = await fetch('/api/store/inventory?gameType=high-striker', {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = (await response.json()) as InventoryCosmeticResponse;
      setWalletBalances({ credits: payload.wallet?.credits ?? 0 });
      setDailyCreditsProgress({
        earned: payload.dailyGameCredits?.earned ?? 0,
        cap: payload.dailyGameCredits?.cap ?? 300,
      });
      setStrikerTheme(buildHighStrikerTheme(payload));
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

  const saveScore = async (finalScore: number, swings: StrikerSwing[]) => {
    if (isGuestRunRef.current) {
      setRunRewardMessage(GUEST_RUN_MESSAGE);
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
      const response = await fetch('/api/games/high-striker/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: finalScore,
          sessionToken: sessionTokenRef.current,
          swings,
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
        console.error(`[HighStriker] Score rejected (${response.status}): ${reason}`);
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
          setRunRewardMessage('Daily ticket cap reached. No tickets this run.');
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
      if (finalScore > (bestScoreCacheRef.current ?? 0)) {
        bestScoreCacheRef.current = finalScore;
        setHighScore(finalScore);
      }
    } catch (error) {
      console.error('Failed to save score:', error);
      setSubmitError('Could not save your run. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  };
  saveScoreRef.current = saveScore;

  // ── Scene construction ──
  const buildScene = useCallback((width: number, height: number) => {
    const canvas = canvasRef.current;
    if (!canvas || rendererRef.current) return;

    const quality =
      qualityRef.current ?? createMidwayQualityController({ game: 'high-striker' });
    qualityRef.current = quality;
    const tier = quality.tier();

    // When the context is lost for good: drop the scene and show the still.
    const fallBack = () => {
      frameLoopRef.current?.stop();
      deferredRef.current?.dispose();
      deferredRef.current = null;
      rigRef.current?.dispose();
      rigRef.current = null;
      const currentScene = sceneRef.current;
      if (currentScene) disposeSceneDeep(currentScene);
      sceneRef.current = null;
      cameraRef.current = null;
      puckRef.current = null;
      puckPartsRef.current = null;
      hammerRef.current = null;
      hammerHeadRef.current = null;
      bellRef.current = null;
      clapperRef.current = null;
      plateRef.current = null;
      shockwaveRef.current = null;
      shockwaveMatRef.current = null;
      themeMatsRef.current = null;
      dustRef.current = [];
      sparkRef.current = [];
      confettiRef.current = [];
      displayRef.current = null;
      setWebglError(true);
      rendererRef.current = null;
      rendererHandleRef.current?.dispose();
      rendererHandleRef.current = null;
    };
    const rendererHandle = createMidwayRenderer({
      canvas,
      tier,
      exposure: 1.3,
      width,
      height,
      onPause: () => frameLoopRef.current?.stop(),
      onRestore: () => {
        rigRef.current?.refreshEnvironment();
        renderSceneRef.current();
        if (gameStateRef.current === 'playing') frameLoopRef.current?.start();
      },
      onFallback: fallBack,
    });
    if (!rendererHandle) {
      setWebglError(true);
      return;
    }
    const renderer = rendererHandle.renderer;
    rendererHandleRef.current = rendererHandle;
    rendererRef.current = renderer;

    const t = themeRef.current;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(t.skyBottom);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 120);
    camera.position.set(0, CAM_REST_Y, CAM_Z);
    camera.lookAt(0, LOOK_REST_Y, 0);
    cameraRef.current = camera;

    // The kit's night-boardwalk rig; the hemisphere follows the background skin.
    const rig = createMidwayLightRig(renderer, scene, {
      tier,
      target: [0, 5.4, 0],
      radius: 8,
      camera: [0, CAM_REST_Y, CAM_Z],
      sky: t.skyTop,
      ground: t.groundColor,
    });
    rigRef.current = rig;
    const hemi = rig.hemi;
    quality.onChange((next) => {
      // Runs only when no decision is live (see the hold in the frame loop),
      // and pays the shader recompile now, between swings.
      applyMidwayTier(renderer, rig, next, { scene, camera });
      if (gameStateRef.current !== 'playing') renderSceneRef.current();
    });

    // The shader warm-up runs after the first frame.
    const deferred = createMidwayDeferredTextures('high-striker', { quality });
    deferredRef.current = deferred;

    // ── Materials (captured for theme recolor) ──
    // Procedural grain + roughness give the tower real lacquered depth; the
    // near-white map multiplies the theme color so cosmetics still recolor it.
    const woodMat = new THREE.MeshStandardMaterial({
      color: t.woodMid,
      roughness: 0.62,
    });
    const channelMat = new THREE.MeshStandardMaterial({ color: t.channel, roughness: 0.9 });
    const tickMat = new THREE.MeshStandardMaterial({ color: t.tick, roughness: 0.55 });
    const trimMat = new THREE.MeshStandardMaterial({ color: t.trim, roughness: 0.8 });
    const bellMat = new THREE.MeshStandardMaterial({
      color: t.bell,
      roughness: 0.26,
      metalness: 0.72,
    });
    // Aged brass for the guide rails, rivets, strike plate and bell yoke.
    const brassMat = makeMidwayMaterial('brass');
    // The tower's painted livery: enamel stripes with a gold pinstripe between
    // each pair. Near-white so the theme's tick/puck colors still drive it.
    const faceMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.42,
      metalness: 0.03,
      map: makeStripeTexture({
        stripeA: t.puck,
        stripeB: t.tick,
        pinstripe: MIDWAY_PALETTE.brass,
        stripes: 6,
      }),
    });
    const puckMat = new THREE.MeshStandardMaterial({ color: t.puck, roughness: 0.38 });
    const hammerWoodMat = new THREE.MeshStandardMaterial({
      color: t.hammerWood,
      roughness: 0.66,
    });
    const hammerHeadMat = new THREE.MeshStandardMaterial({ color: t.hammerHead, roughness: 0.55 });
    const gripMat = new THREE.MeshStandardMaterial({ color: '#4a2c17', roughness: 0.78 });
    const padMat = new THREE.MeshStandardMaterial({ color: t.pad, roughness: 0.85 });
    // Weathered boardwalk decking under the whole midway.
    const groundMat = new THREE.MeshBasicMaterial({ color: t.groundColor });
    // A flat deck under the cabinet. It ends at the plinth's edge, so the
    // canvas has no horizon line to show where the picture stops.
    const ground = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.1, 3.6), groundMat);
    ground.position.set(0, -0.05, 0.1);
    ground.receiveShadow = true;
    scene.add(ground);

    // ── The striker tower ──
    const tower = new THREE.Group();

    const board = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, TOWER_HEIGHT, 0.62),
      woodMat,
    );
    board.position.set(0, TOWER_BASE_Y + TOWER_HEIGHT / 2, 0);
    board.castShadow = true;
    board.receiveShadow = true;
    tower.add(board);

    // The painted face: enamel stripes with gold pinstriping, proud of the
    // walnut carcass, framed by brass beading down both flanks.
    const face = new THREE.Mesh(
      new THREE.BoxGeometry(1.62, TOWER_HEIGHT - 0.1, 0.05),
      faceMat,
    );
    face.position.set(0, TOWER_BASE_Y + TOWER_HEIGHT / 2, 0.33);
    face.receiveShadow = true;
    tower.add(face);
    const beadGeo = new THREE.BoxGeometry(0.05, TOWER_HEIGHT - 0.1, 0.09);
    for (const side of [-1, 1]) {
      const bead = new THREE.Mesh(beadGeo, brassMat);
      bead.position.set(side * 0.83, TOWER_BASE_Y + TOWER_HEIGHT / 2, 0.34);
      tower.add(bead);
    }

    // Dark channel the puck rides (slightly proud of the painted face).
    const channel = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, TOWER_HEIGHT - 0.5, 0.1),
      channelMat,
    );
    channel.position.set(0, TOWER_BASE_Y + TOWER_HEIGHT / 2, 0.35);
    tower.add(channel);

    // Riveted brass guide rails either side of the channel. The rivets are one
    // InstancedMesh — 40 studs for the cost of a single draw call.
    const railGeo = new THREE.CylinderGeometry(0.045, 0.045, TOWER_HEIGHT - 0.5, 8);
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(railGeo, brassMat);
      rail.position.set(side * 0.31, TOWER_BASE_Y + TOWER_HEIGHT / 2, 0.42);
      rail.castShadow = true;
      tower.add(rail);
    }
    const RIVETS_PER_RAIL = 20;
    const rivets = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.035, 8, 6),
      brassMat,
      RIVETS_PER_RAIL * 2,
    );
    const rivetAnchor = new THREE.Object3D();
    let rivetIndex = 0;
    for (const side of [-1, 1]) {
      for (let i = 0; i < RIVETS_PER_RAIL; i += 1) {
        const frac = (i + 0.5) / RIVETS_PER_RAIL;
        rivetAnchor.position.set(
          side * 0.31,
          TOWER_BASE_Y + 0.25 + frac * (TOWER_HEIGHT - 0.5),
          0.47,
        );
        rivetAnchor.updateMatrix();
        rivets.setMatrixAt(rivetIndex, rivetAnchor.matrix);
        rivetIndex += 1;
      }
    }
    rivets.instanceMatrix.needsUpdate = true;
    tower.add(rivets);

    // Graduated height ticks every 10% of the climb, with brass majors at the
    // quarters — the tower now reads as a measuring scale, not a plain board.
    const tickMinorGeo = new THREE.BoxGeometry(0.18, 0.05, 0.06);
    const tickMajorGeo = new THREE.BoxGeometry(0.3, 0.075, 0.07);
    for (let i = 1; i < 10; i += 1) {
      const frac = i / 10;
      const major = i % 5 === 0 || i === 2 || i === 7;
      for (const side of [-1, 1]) {
        const tick = new THREE.Mesh(
          major ? tickMajorGeo : tickMinorGeo,
          major ? brassMat : tickMat,
        );
        tick.position.set(
          side * (major ? 0.6 : 0.55),
          TOWER_BASE_Y + TOWER_HEIGHT * frac,
          0.37,
        );
        tower.add(tick);
      }
    }

    // ── Scroll-cut crown: an ornamental cap carrying the bell yoke ──
    const crownShape = new THREE.Shape();
    crownShape.moveTo(-1.15, 0);
    crownShape.lineTo(-1.15, 0.26);
    crownShape.quadraticCurveTo(-0.98, 0.72, -0.6, 0.78);
    crownShape.quadraticCurveTo(-0.3, 0.82, -0.22, 1.12);
    crownShape.quadraticCurveTo(0, 1.4, 0.22, 1.12);
    crownShape.quadraticCurveTo(0.3, 0.82, 0.6, 0.78);
    crownShape.quadraticCurveTo(0.98, 0.72, 1.15, 0.26);
    crownShape.lineTo(1.15, 0);
    crownShape.closePath();
    const crown = new THREE.Mesh(
      new THREE.ExtrudeGeometry(crownShape, {
        depth: 0.42,
        bevelEnabled: true,
        bevelThickness: 0.03,
        bevelSize: 0.03,
        bevelSegments: 2,
        curveSegments: 8,
      }),
      woodMat,
    );
    crown.position.set(0, TOWER_TOP_Y + 0.02, -0.21);
    crown.castShadow = true;
    tower.add(crown);
    // Gold volutes tucked into the crown's shoulders.
    for (const side of [-1, 1]) {
      const volute = new THREE.Mesh(
        new THREE.TorusGeometry(0.17, 0.035, 8, 18, Math.PI * 1.5),
        brassMat,
      );
      volute.rotation.z = side * 0.4;
      volute.position.set(side * 0.72, TOWER_TOP_Y + 0.5, 0.22);
      tower.add(volute);
    }

    // Trim cap + base cabinet.
    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.22, 0.78), trimMat);
    cap.position.set(0, TOWER_TOP_Y + 0.08, 0);
    tower.add(cap);
    const capBead = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 2.02, 8),
      brassMat,
    );
    capBead.rotation.z = Math.PI / 2;
    capBead.position.set(0, TOWER_TOP_Y - 0.05, 0.4);
    tower.add(capBead);

    // The base cabinet: plinth, a body panel carrying the score display, corner
    // posts and a moulded cap. This is what the mallet lands on.
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.22, 1.9), trimMat);
    plinth.position.set(0, 0.11, 0);
    plinth.receiveShadow = true;
    tower.add(plinth);
    const bodyH = TOWER_BASE_Y - 0.22 - 0.06;
    const cabinet = new THREE.Mesh(new THREE.BoxGeometry(3.6, bodyH, 1.62), woodMat);
    cabinet.position.set(0, 0.22 + bodyH / 2, 0);
    cabinet.castShadow = true;
    cabinet.receiveShadow = true;
    tower.add(cabinet);
    const cabinetCap = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.12, 1.78), trimMat);
    cabinetCap.position.set(0, TOWER_BASE_Y + 0.1, 0);
    cabinetCap.castShadow = true;
    tower.add(cabinetCap);
    // The score display carries game information, so it paints before the
    // first frame, never deferred. Self-lit, like a real display, and outside
    // tone mapping so the amber stays the token.
    const displayCanvas = document.createElement('canvas');
    displayCanvas.width = 1024;
    displayCanvas.height = 256;
    const displayTex = new THREE.CanvasTexture(displayCanvas);
    displayTex.colorSpace = THREE.SRGBColorSpace;
    displayTex.anisotropy = 4;
    const displayFont = paintDisplay(displayCanvas, displayStateRef.current, performance.now());
    displayRef.current = { canvas: displayCanvas, texture: displayTex, painted: '' };
    if (typeof document !== 'undefined' && displayFont && !document.fonts.check(displayFont)) {
      void document.fonts.load(displayFont).then(() => {
        if (displayRef.current) displayRef.current.painted = '';
      }).catch(() => undefined);
    }
    const displayFrame = new THREE.Mesh(new THREE.BoxGeometry(3.04, 0.8, 0.06), brassMat);
    displayFrame.position.set(0, 0.62, 0.82);
    tower.add(displayFrame);
    const displayFace = new THREE.Mesh(
      new THREE.PlaneGeometry(2.9, 0.725),
      new THREE.MeshBasicMaterial({ map: displayTex, toneMapped: false }),
    );
    displayFace.position.set(0, 0.62, 0.855);
    tower.add(displayFace);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, bodyH, 0.16),
        brassMat,
      );
      post.position.set(side * 1.76, 0.22 + bodyH / 2, 0.75);
      tower.add(post);
    }

    // The strike plate: a brass disc on a hardwood block, ringed by a raised
    // collar. Scaled on impact by the render loop so the blow compresses it.
    const plateBlock = new THREE.Mesh(
      new THREE.BoxGeometry(1.05, 0.16, 0.9),
      padMat,
    );
    plateBlock.position.set(PLATE_X, TOWER_BASE_Y - 0.06, PLATE_Z);
    plateBlock.receiveShadow = true;
    tower.add(plateBlock);
    const plate = new THREE.Group();
    const plateDisc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.46, 0.12, 24),
      brassMat,
    );
    plate.add(plateDisc);
    const plateCollar = new THREE.Mesh(
      new THREE.TorusGeometry(0.44, 0.035, 8, 26),
      brassMat,
    );
    plateCollar.rotation.x = Math.PI / 2;
    plateCollar.position.y = 0.05;
    plate.add(plateCollar);
    plate.position.set(PLATE_X, PLATE_Y, PLATE_Z);
    tower.add(plate);
    plateRef.current = plate;
    // The linkage the plate drives: a short brass rod running back to the
    // tower's channel, so the puck's launch has a visible mechanical cause.
    const linkage = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.95, 8),
      brassMat,
    );
    linkage.rotation.x = Math.PI / 2;
    linkage.position.set(PLATE_X * 0.4, TOWER_BASE_Y - 0.02, PLATE_Z / 2);
    tower.add(linkage);

    scene.add(tower);

    // ── The brass bell, slung in a yoke under the crown so it can swing ──
    const bellYoke = new THREE.Group();
    for (const side of [-1, 1]) {
      const strap = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.62, 0.09),
        brassMat,
      );
      strap.position.set(side * 0.64, BELL_Y + 0.5, 0);
      bellYoke.add(strap);
    }
    const yokePin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 1.42, 8),
      brassMat,
    );
    yokePin.rotation.z = Math.PI / 2;
    yokePin.position.set(0, BELL_Y + 0.78, 0);
    bellYoke.add(yokePin);
    scene.add(bellYoke);

    const bell = new THREE.Group();
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.62, 22, 14, 0, Math.PI * 2, 0, Math.PI / 2),
      bellMat,
    );
    dome.castShadow = true;
    bell.add(dome);
    const bellWaist = new THREE.Mesh(
      new THREE.CylinderGeometry(0.62, 0.6, 0.26, 22, 1, true),
      bellMat,
    );
    bellWaist.position.y = -0.13;
    bell.add(bellWaist);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.09, 10, 26), bellMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.24;
    bell.add(rim);
    const crownRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.24, 0.028, 8, 20),
      bellMat,
    );
    crownRing.rotation.x = Math.PI / 2;
    crownRing.position.y = 0.5;
    bell.add(crownRing);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), bellMat);
    knob.position.y = 0.64;
    bell.add(knob);
    const hanger = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.5, 8),
      brassMat,
    );
    hanger.position.y = 0.86;
    bell.add(hanger);
    // The clapper swings with a lag of its own after the bell is struck.
    const clapper = new THREE.Group();
    const clapperRod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, 0.44, 6),
      brassMat,
    );
    clapperRod.position.y = -0.22;
    clapper.add(clapperRod);
    const clapperBall = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 12, 10),
      brassMat,
    );
    clapperBall.position.y = -0.46;
    clapper.add(clapperBall);
    clapper.position.y = 0.24;
    bell.add(clapper);
    clapperRef.current = clapper;
    bell.position.set(0, BELL_Y, 0);
    scene.add(bell);
    bellRef.current = bell;

    // ── The enamel puck, with brass shoes gripping the guide rails ──
    const puckGroup = new THREE.Group();
    const puckBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.29, 0.29, 0.22, 24),
      puckMat,
    );
    puckBody.castShadow = true;
    puckGroup.add(puckBody);
    // A skin shape's mark (the inset star, the perforation); hidden for the house disc.
    const puckMarkMat = new THREE.MeshStandardMaterial({ color: t.puck, roughness: 0.38 });
    const puckMark = new THREE.Mesh(puckBody.geometry, puckMarkMat);
    puckMark.visible = false;
    puckGroup.add(puckMark);
    const puckCap = new THREE.Mesh(
      new THREE.TorusGeometry(0.29, 0.035, 8, 24),
      brassMat,
    );
    puckCap.rotation.x = Math.PI / 2;
    puckCap.position.y = 0.1;
    puckGroup.add(puckCap);
    for (const side of [-1, 1]) {
      const shoe = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.16, 0.2),
        brassMat,
      );
      shoe.position.set(side * 0.31, 0, 0.08);
      puckGroup.add(shoe);
    }
    puckGroup.position.set(0, PUCK_REST_Y, 0.34);
    scene.add(puckGroup);
    puckRef.current = puckGroup;
    puckPartsRef.current = {
      key: 'puck',
      body: puckBody,
      cap: puckCap,
      mark: puckMark,
      markMat: puckMarkMat,
      houseGeo: puckBody.geometry,
    };

    // ── The mallet: a barrel head with brass bands on a tapered ash handle
    //    with a leather grip, pivoting at the striker's shoulder. ──
    const hammer = new THREE.Group();
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.075, HAMMER_ARM_LEN, 10),
      hammerWoodMat,
    );
    handle.rotation.z = Math.PI / 2;
    handle.position.set(-HAMMER_ARM_LEN / 2, 0, 0);
    handle.castShadow = true;
    hammer.add(handle);
    const grip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.082, 0.082, 0.52, 10),
      gripMat,
    );
    grip.rotation.z = Math.PI / 2;
    grip.position.set(-0.24, 0, 0);
    hammer.add(grip);
    const ferrule = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 0.09, 10),
      brassMat,
    );
    ferrule.rotation.z = Math.PI / 2;
    ferrule.position.set(-0.54, 0, 0);
    hammer.add(ferrule);
    // The head is one group so the impact can squash it along the swing axis.
    const hammerHead = new THREE.Group();
    const headBarrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.27, 0.27, 0.52, 20),
      hammerHeadMat,
    );
    headBarrel.rotation.x = Math.PI / 2;
    headBarrel.castShadow = true;
    hammerHead.add(headBarrel);
    for (const bandZ of [-0.19, 0.19]) {
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(0.275, 0.032, 8, 22),
        brassMat,
      );
      band.position.z = bandZ;
      hammerHead.add(band);
    }
    hammerHead.position.set(-HAMMER_ARM_LEN - 0.06, 0, 0);
    hammer.add(hammerHead);
    hammerHeadRef.current = hammerHead;
    hammer.position.set(...HAMMER_PIVOT);
    hammer.rotation.z = HAMMER_REST_ROT; // resting: head raised over the shoulder
    scene.add(hammer);
    hammerRef.current = hammer;

    // ── The meter lives in the tower's channel: a fill that rises with the
    //    hold (dim until it clears the line, then bright, then paper in the
    //    bell zone), the round's line across the rails, and two quiet zones.
    //    All of it follows the SAME deterministic gauge the validator replays.
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    unitBox.translate(0, 0.5, 0);
    const fillLow = new THREE.Mesh(
      unitBox,
      new THREE.MeshBasicMaterial({ color: TICKET_DIM, toneMapped: false }),
    );
    fillLow.scale.set(0.34, 0.0001, 0.02);
    fillLow.position.set(0, PUCK_REST_Y, 0.412);
    fillLow.visible = false;
    scene.add(fillLow);
    fillLowRef.current = fillLow;
    const fillHigh = new THREE.Mesh(
      unitBox,
      new THREE.MeshBasicMaterial({ color: TICKET_COLOR.clone(), toneMapped: false }),
    );
    fillHigh.scale.set(0.34, 0.0001, 0.02);
    fillHigh.position.set(0, PUCK_REST_Y, 0.416);
    fillHigh.visible = false;
    scene.add(fillHigh);
    fillHighRef.current = fillHigh;
    // The window: a lighter strip from the line up to the bell band. Let go
    // while the fill is in it and the puck clears the line.
    const windowZone = new THREE.Mesh(
      unitBox,
      new THREE.MeshBasicMaterial({ color: WINDOW_COLOR, toneMapped: false }),
    );
    windowZone.scale.set(0.42, 1, 0.01);
    windowZone.position.set(0, PUCK_REST_Y, 0.404);
    windowZone.visible = false;
    scene.add(windowZone);
    windowZoneRef.current = windowZone;
    // The bell band at the top of the channel: let go in it to ring the bell.
    const bellZone = new THREE.Mesh(
      unitBox,
      new THREE.MeshBasicMaterial({ color: MIDWAY_PALETTE.red, toneMapped: false }),
    );
    bellZone.scale.set(0.42, 0.0001, 0.012);
    bellZone.position.set(0, PUCK_BELL_Y, 0.406);
    bellZone.visible = false;
    scene.add(bellZone);
    bellZoneRef.current = bellZone;
    const qualifierLine = new THREE.Mesh(
      new THREE.BoxGeometry(0.66, 0.05, 0.03),
      new THREE.MeshBasicMaterial({ color: PAPER_COLOR.clone(), toneMapped: false }),
    );
    qualifierLine.position.set(0, PUCK_REST_Y, 0.47);
    qualifierLine.visible = false;
    scene.add(qualifierLine);
    qualifierLine3DRef.current = qualifierLine;

    // ── Impact particle pools (strike frame) ──
    const dustTex = makeSoftDiscTexture();
    dustRef.current = makeSpriteParticlePool({
      scene,
      count: 14,
      texture: dustTex,
      colors: ['#8a6a45', '#a3835c', '#6f5334'],
      size: 0.26,
    });
    sparkRef.current = makeSpriteParticlePool({
      scene,
      count: 14,
      texture: makeSparkTexture(),
      colors: [t.bellHi, '#ffd28a', t.bulbAmber],
      size: 0.12,
      blending: THREE.AdditiveBlending,
    });

    // ── Bell shockwave: one expanding cream ring at the bell ──
    const shockMat = new THREE.MeshBasicMaterial({
      color: '#f7eedd',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const shockwave = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.7, 48), shockMat);
    shockwave.position.set(0, BELL_Y + 0.1, 0.4);
    shockwave.visible = false;
    scene.add(shockwave);
    shockwaveRef.current = shockwave;
    shockwaveMatRef.current = shockMat;

    // ── Confetti pool (bell only) — matte enamel chips, no glow ──
    confettiRef.current = makeSpriteParticlePool({
      scene,
      count: 26,
      texture: null,
      colors: [t.bulbAmber, t.bulbRed, t.bulbTeal, '#f2e5c8'],
      size: 0.09,
    });

    themeMatsRef.current = {
      wood: woodMat,
      face: faceMat,
      channel: channelMat,
      tick: tickMat,
      trim: trimMat,
      bell: bellMat,
      puck: puckMat,
      hammerWood: hammerWoodMat,
      hammerHead: hammerHeadMat,
      pad: padMat,
      ground: groundMat,
      hemi,
    };

    // One lamp over the tower. The hemisphere and the key come from the rig.
    rig.addPractical([-1.8, 6.4, 3.4], { intensity: 3.2, distance: 14 });

    // Things that first appear mid-run (the meter, particles, the shockwave)
    // would compile their shaders on the frame they show up: a visible
    // hitch on the first swing. Compile them while the page is idle.
    deferred.add(
      () => {
        const hidden: THREE.Object3D[] = [];
        scene.traverse((object) => {
          if (!object.visible) {
            hidden.push(object);
            object.visible = true;
          }
        });
        renderer.compile(scene, camera);
        for (const object of hidden) object.visible = false;
        return null;
      },
      () => undefined,
    );
  }, []);


  // ── Recolor the live scene when an equipped skin arrives ──
  const applyStrikerTheme = useCallback(() => {
    const t = themeRef.current;
    const mats = themeMatsRef.current;
    const scene = sceneRef.current;
    if (!mats || !scene) return;
    scene.background = new THREE.Color(t.skyBottom);
    mats.wood.color.set(t.woodMid);
    mats.channel.color.set(t.channel);
    mats.tick.color.set(t.tick);
    mats.trim.color.set(t.trim);
    mats.bell.color.set(t.bell);
    mats.puck.color.set(t.puck);
    mats.hammerWood.color.set(t.hammerWood);
    mats.hammerHead.color.set(t.hammerHead);
    mats.pad.color.set(t.pad);
    mats.ground.color.set(t.groundColor);
    mats.hemi.color.set(t.skyTop);
    mats.hemi.groundColor.set(t.groundColor);
    // Repaint the tower's face in place (no new texture allocated): the
    // house livery, or a skin set's material tiled up the tower.
    const faceMap = mats.face.map;
    const faceCanvas = faceMap?.image as HTMLCanvasElement | undefined;
    if (faceCanvas && faceMap) {
      if (t.skin) {
        paintTowerFace(faceCanvas, t.skin);
        faceMap.repeat.set(1, 5);
      } else {
        paintStripes(faceCanvas, {
          stripeA: t.puck,
          stripeB: t.tick,
          pinstripe: MIDWAY_PALETTE.brass,
          stripes: 6,
        });
        faceMap.repeat.set(1, 1);
      }
      faceMap.needsUpdate = true;
    }
    // The puck's shape. Only the drawn shape changes; it rides the same
    // rails to the same height.
    const parts = puckPartsRef.current;
    if (parts) {
      const key = t.skin?.shape ?? 'puck';
      if (parts.key !== key) {
        parts.key = key;
        const bodyGeo = t.skin ? makePuckGeometry(t.skin.shape) : null;
        const markGeo = t.skin ? makePuckMarkGeometry(t.skin.shape) : null;
        const oldBody = parts.body.geometry;
        const oldMark = parts.mark.geometry;
        parts.body.geometry = bodyGeo ?? parts.houseGeo;
        parts.cap.visible = !bodyGeo;
        parts.mark.geometry = markGeo ?? parts.houseGeo;
        parts.mark.visible = Boolean(markGeo);
        if (oldBody !== parts.houseGeo && oldBody !== parts.body.geometry) oldBody.dispose();
        if (oldMark !== parts.houseGeo && oldMark !== parts.mark.geometry) oldMark.dispose();
      }
      parts.markMat.color.set(t.skin?.puckMark ?? t.puck);
    }
  }, []);

  // ── The tower's meter for a swing: the line, the window and the bell band.
  //    They ease to the next swing's heights as the last puck lands. ──
  const syncRoundMeter = useCallback((roundIndex: number, snap = false) => {
    const seed = seedRef.current;
    if (seed === null || meterRoundRef.current === roundIndex) return;
    meterRoundRef.current = roundIndex;
    const round = strikerRoundFor(seed, roundIndex);
    const t = meterTargetRef.current;
    const first = !t.set;
    t.set = true;
    t.lineY = PUCK_REST_Y + round.qualifier * PUCK_SPAN;
    t.bellY = PUCK_REST_Y + round.bellLine * PUCK_SPAN;
    t.bellH = Math.max(0.0001, PUCK_BELL_Y - t.bellY);
    const line = qualifierLine3DRef.current;
    const windowZone = windowZoneRef.current;
    const bellZone = bellZoneRef.current;
    if (line) line.visible = true;
    if (windowZone) windowZone.visible = true;
    if (bellZone) bellZone.visible = true;
    if (first || snap || reducedMotionRef.current) {
      if (line) line.position.y = t.lineY;
      if (bellZone) {
        bellZone.position.y = t.bellY;
        bellZone.scale.y = t.bellH;
      }
      if (windowZone) {
        windowZone.position.y = t.lineY;
        windowZone.scale.y = Math.max(0.0001, t.bellY - t.lineY);
      }
    }
    // For the QA bot: when the next swing's fill peaks, ms after the press.
    const canvasEl = canvasRef.current;
    if (canvasEl) canvasEl.dataset.hsNext = `${roundIndex}:${round.peakMs.toFixed(2)}:${round.windowMs.toFixed(1)}:${round.bellWindowMs.toFixed(1)}`;
  }, []);

  const setDisplayMessage = useCallback((message: Omit<DisplayMessage, 'until'>, ms: number) => {
    displayStateRef.current.message = { ...message, until: performance.now() + ms };
  }, []);

  // ── The three moments of a swing. The render loop calls them at the right
  //    time on the effect clock; they only start sounds and set state. ──
  const finishRun = useCallback(() => {
    if (gameStateRef.current !== 'playing') return;
    gameStateRef.current = 'gameover';
    setRunStats({ ...runStatsRef.current });
    setGameState('gameover');
    gameOverTimeRef.current = performance.now();
    SoundManager.play(SFX.over);
    void saveScoreRef.current?.(scoreRef.current, swingsRef.current);
  }, []);

  /** The strike frame: the mallet lands, and the puck leaves. */
  const strikeNow = useCallback(
    (swing: SwingAnim, now: number) => {
      const p = swing.pending;
      const rm = reducedMotionRef.current;
      const tier = qualityRef.current?.tier() ?? 'medium';
      const weak = p.kind === 'weak';
      const force = clamp01(weak ? p.strength * 0.6 : p.strength);
      SoundManager.play(SFX.strike, {
        volume: weak ? 0.55 : 0.75 + force * 0.45,
        pitch: weak ? 0.7 : 0.86 + force * 0.3,
      });
      playHaptic(weak ? 'light' : force > 0.7 ? 'success' : 'medium');
      trigger('impact', { sound: false, motion: false, shake: weak ? 0.2 : 0.25 + force * 0.5 });
      plateHitRef.current = { start: now, force };
      if (!rm) {
        emitSpriteParticles(
          dustRef.current,
          midwayParticleCount(6 + Math.round(force * 6), tier),
          {
            origin: [PLATE_X, PLATE_Y + 0.08, PLATE_Z],
            spread: 0.5,
            speed: [0.5, 1.4 + force],
            up: [0.6, 1.4 + force * 0.8],
            ttl: [0.42, 0.8],
            size: [0.8, 1.6],
            grow: 1.8,
            fade: 0.3 + force * 0.18,
            spin: 2,
          },
        );
        // Sparks only when the blow is genuinely hard: a weak tap throws no metal.
        if (force > 0.32 && !weak) {
          emitSpriteParticles(
            sparkRef.current,
            midwayParticleCount(4 + Math.round(force * 8), tier),
            {
              origin: [PLATE_X, PLATE_Y + 0.06, PLATE_Z],
              spread: 0.24,
              speed: [1.4, 3.4 + force * 2],
              up: [1.0, 2.6 + force * 1.6],
              ttl: [0.22, 0.44],
              size: [0.55, 1.1],
              grow: -0.4,
              fade: 0.55 + force * 0.35,
              spin: 12,
            },
          );
        }
      }
      // The puck leaves on the strike frame.
      const puck = puckRef.current;
      const from = puck ? puck.position.y : PUCK_REST_Y;
      const s = clamp01(p.strength);
      const to = p.kind === 'bell' ? PUCK_BELL_Y : PUCK_REST_Y + s * PUCK_SPAN;
      const { riseMs, power, holdMs, downMs } = strikerFlightTimes(p.kind, s);
      puckAnimRef.current = {
        launchAt: now,
        from,
        to,
        riseMs,
        power,
        holdMs,
        downMs,
        endAt: now + riseMs + holdMs + downMs,
        stage: 'rise',
        apexed: false,
        pending: p,
      };
      // The climb toward a ring keeps the tone going, rising into the bell.
      if (p.kind === 'near' || p.kind === 'bell') {
        riseToneRef.current?.stop(20);
        riseToneRef.current = SoundManager.startHoldTone({ volume: 0.8 });
      }
    },
    [trigger],
  );

  /** The puck reaches the top of its climb: the result moment. */
  const apexNow = useCallback(
    (anim: PuckAnim, now: number) => {
      const p = anim.pending;
      const rm = reducedMotionRef.current;
      const tier = qualityRef.current?.tier() ?? 'medium';
      if (p.kind === 'weak') return;
      riseToneRef.current?.stop(p.kind === 'bell' ? 60 : 260);
      riseToneRef.current = null;
      const st = displayStateRef.current;
      scoreRollRef.current = { from: st.score, to: p.scoreAfter, start: now };
      st.swing = p.swingAfter;
      if (p.kind === 'bell') {
        // The one hit-stop in the game, then the ring. The stinger climbs a
        // semitone with every bell in the streak.
        const pitch = ladder.next();
        trigger('impact', { sound: false, motion: false, shake: 1, hitStop: true });
        SoundManager.play(SFX.bell);
        SoundManager.play(SFX.jackpot, { volume: 0.6, pitch });
        playHaptic('win');
        setDisplayMessage(
          { text: `+${p.points}`, sub: p.bellStreak >= 2 ? `${p.bellStreak} bells` : 'bell', tone: 'ticket' },
          1200,
        );
        if (!rm) {
          bellAnimRef.current = { start: now, amp: 0.32 };
          shockwaveAnimRef.current = { start: now };
          emitSpriteParticles(sparkRef.current, midwayParticleCount(10, tier), {
            origin: [0, BELL_Y - 0.1, 0.34],
            spread: 0.5,
            speed: [1.6, 3.6],
            up: [0.4, 2.2],
            ttl: [0.24, 0.46],
            size: [0.6, 1.2],
            grow: -0.35,
            fade: 0.9,
            spin: 14,
          });
          emitSpriteParticles(confettiRef.current, midwayParticleCount(26, tier), {
            origin: [0, BELL_Y + 0.3, 0.3],
            spread: 0.3,
            speed: [1.2, 3.4],
            up: [1.6, 4.0],
            ttl: [1.2, 1.9],
            size: [0.75, 1.4],
            grow: 0,
            fade: 1,
            spin: 12,
          });
        }
        return;
      }
      // A hit under the bell: a chime, and the bell streak is over.
      ladder.reset();
      SoundManager.play(SFX.clean, { volume: 0.6 });
      playHaptic('tick');
      if (p.kind === 'near' && !rm && !bellAnimRef.current) {
        // The bell answers a near miss with a faint sympathetic sway.
        bellAnimRef.current = { start: now, amp: 0.07 };
      }
      if (p.kind === 'near') SoundManager.play(SFX.bell, { volume: 0.22 });
      setDisplayMessage(
        { text: `+${p.points}`, sub: p.kind === 'near' ? 'so close' : undefined, tone: 'ticket' },
        900,
      );
    },
    [ladder, setDisplayMessage, trigger],
  );

  /** The puck lands. */
  const landNow = useCallback(
    (anim: PuckAnim, now: number) => {
      const p = anim.pending;
      const rm = reducedMotionRef.current;
      puckLandRef.current = { start: now };
      if (p.kind === 'weak') {
        // The miss: a dull thud, no ring, the line flashes red. The run ends.
        SoundManager.play(SFX.thud);
        playHaptic('failure');
        trigger('impact', { sound: false, motion: false, shake: 0.15 });
        ladder.reset();
        lineFlashRef.current = { start: now, red: true };
        setDisplayMessage({ text: p.side === 'early' ? 'too early' : 'too late', tone: 'red' }, 4000);
        window.clearTimeout(resultTimerRef.current);
        resultTimerRef.current = window.setTimeout(finishRun, RESULT_DELAY_MS);
        return;
      }
      SoundManager.play(SFX.land, { volume: 0.8 });
      playHaptic('light');
      trigger('impact', { sound: false, motion: false, shake: 0.12 });
      if (!rm) {
        emitSpriteParticles(dustRef.current, midwayParticleCount(3, qualityRef.current?.tier() ?? 'medium'), {
          origin: [0, PUCK_REST_Y - 0.16, 0.42],
          spread: 0.3,
          speed: [0.25, 0.7],
          up: [0.2, 0.6],
          ttl: [0.3, 0.5],
          size: [0.6, 1.0],
          grow: 1.6,
          fade: 0.2,
          spin: 1.5,
        });
      }
      if (p.last) {
        window.clearTimeout(resultTimerRef.current);
        resultTimerRef.current = window.setTimeout(finishRun, RESULT_DELAY_MS);
        return;
      }
      // Every tenth hit: the depth punches in on the display and the line
      // flashes as the next, quicker swing's line eases into place.
      if (p.hitsAfter > 0 && p.hitsAfter % MILESTONE_EVERY === 0) {
        SoundManager.play(SFX.start, { pitch: Math.min(2, 1 + p.hitsAfter / 100) });
        lineFlashRef.current = { start: now, red: false };
        setDisplayMessage({ text: String(p.hitsAfter), sub: 'faster', tone: 'ticket' }, 1100);
      }
      // The next swing's gauge is ready.
      if (phaseRef.current === 'resolve') phaseRef.current = 'aim';
      syncRoundMeter(simRef.current.roundIndex);
    },
    [finishRun, ladder, setDisplayMessage, syncRoundMeter, trigger],
  );

  // ── Per-frame render + stepping. Input is event driven; this only draws
  //    the state the events set, so a slow frame can't move a swing. ──
  const renderScene = useCallback((frame?: GameFrameInfo) => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera) return;

    const wall = performance.now();
    const now = effectNow();
    const lastEffect = lastEffectRef.current || now;
    const rawDt = (now - lastEffect) / 1000;
    const dt = Math.min(0.05, Math.max(0.001, frame ? Math.min(rawDt, frame.deltaMs / 1000) : rawDt));
    lastEffectRef.current = now;
    const rm = reducedMotionRef.current;

    // The display lead follows the measured refresh: a smoothed frame
    // interval, so 60 and 120 Hz each draw one of their own frames ahead.
    if (frame && frame.deltaMs > 2 && frame.deltaMs < 100) {
      frameIntervalRef.current += (frame.deltaMs - frameIntervalRef.current) * 0.1;
    }

    // ── The hold: gauge value from the press timestamp, every frame, drawn
    //    one frame ahead so the fill on screen is the strength you'd get. ──
    let wind = windRef.current;
    if (wind && wall - wind.startMs > wind.round.lateMs + STRIKER_LATE_GRACE_MS) {
      // Held past the window: the fill has fallen back under the line, and
      // the mallet slips. The swing is a miss whatever the exact time.
      autoReleaseRef.current(wall);
      wind = windRef.current;
    }
    if (wind) {
      const lead = strikerDisplayLeadMs(frameIntervalRef.current);
      const value = strikerGaugeValue(wind.round, wall - wind.startMs + lead);
      wind.value = value;
      meterRef.current = value;
      const q = wind.round.qualifier;
      // Crossing the line, and the bell band, on the way up: a tick each.
      if (!wind.aboveLine && value >= q) {
        wind.aboveLine = true;
        wind.wasAbove = true;
        SoundManager.play(SFX.tick, { volume: 0.9, pitch: 1.25 });
        playHaptic('tick');
      } else if (wind.aboveLine && value < q - 0.015) {
        wind.aboveLine = false;
      }
      if (!wind.inBell && value >= wind.round.bellLine) {
        wind.inBell = true;
        SoundManager.play(SFX.tick, { volume: 1, pitch: 2 });
        playHaptic('medium');
      } else if (wind.inBell && value < wind.round.bellLine - 0.01) {
        wind.inBell = false;
      }
      // The tone and the haptic ramp climb with the draw.
      wind.tone.set(value);
      if (value > 0.04 && wall - wind.lastTickAt >= lerp(TICK_SLOW_MS, TICK_FAST_MS, value)) {
        wind.lastTickAt = wall;
        playHaptic('tick');
      }
    } else {
      meterRef.current = expDamp(meterRef.current, 0, 14, dt);
    }
    const meterValue = meterRef.current;
    const fillLow = fillLowRef.current;
    const fillHigh = fillHighRef.current;
    const playing = gameStateRef.current === 'playing';
    if (fillLow && fillHigh) {
      const showFill = playing && meterValue > 0.002;
      fillLow.visible = showFill;
      fillHigh.visible = showFill && !!wind && meterValue > wind.round.qualifier;
      if (showFill) {
        const qv = wind ? wind.round.qualifier : 1;
        const lowTop = Math.min(meterValue, qv);
        fillLow.scale.y = Math.max(0.0001, lowTop * PUCK_SPAN);
        if (wind && meterValue > qv) {
          fillHigh.position.y = PUCK_REST_Y + qv * PUCK_SPAN;
          fillHigh.scale.y = Math.max(0.0001, (meterValue - qv) * PUCK_SPAN);
          (fillHigh.material as THREE.MeshBasicMaterial).color.copy(
            meterValue >= wind.round.bellLine ? PAPER_COLOR : TICKET_COLOR,
          );
        }
        // After release the fill drains: the energy went into the puck.
        if (!wind) {
          fillLow.scale.y = Math.max(0.0001, meterValue * PUCK_SPAN);
          fillHigh.visible = false;
          (fillLow.material as THREE.MeshBasicMaterial).color.copy(TICKET_COLOR);
        } else {
          (fillLow.material as THREE.MeshBasicMaterial).color.copy(TICKET_DIM);
        }
      }
    }

    // ── The mallet. Held: drawn back with the gauge. Released: it drops and
    //    recovers. Tapped or cancelled: it settles back to rest. ──
    const hammer = hammerRef.current;
    const hammerHead = hammerHeadRef.current;
    const swingAnim = swingRef.current;
    if (hammer) {
      let rot = malletRotRef.current;
      if (wind) {
        const target = lerp(HAMMER_REST_ROT, HAMMER_FULL_ROT, wind.value);
        // A little strain near the top of the draw.
        const strain = rm ? 0 : clamp01((wind.value - 0.8) / 0.2) * 0.014 * Math.sin(wall * 0.11);
        rot = expDamp(rot, target, 30, dt) + strain;
      } else if (swingAnim) {
        const el = now - swingAnim.dropStartAt;
        if (el < 0) {
          rot = swingAnim.fromRot;
        } else if (el < swingAnim.dropMs) {
          const k = el / swingAnim.dropMs;
          rot = swingAnim.fromRot + (HAMMER_STRIKE_ROT - swingAnim.fromRot) * easeInQuad(k);
        } else {
          if (!swingAnim.struck) {
            // The strike frame: the blow lands, and the puck leaves.
            swingAnim.struck = true;
            strikeNow(swingAnim, now);
          }
          const k = (el - swingAnim.dropMs) / HAMMER_BACK_MS;
          if (k >= 1) {
            rot = HAMMER_REST_ROT;
            swingRef.current = null;
          } else {
            const rebound = rm ? 0 : Math.sin(k * Math.PI * 1.6) * 0.1 * (1 - k);
            rot =
              HAMMER_STRIKE_ROT +
              (HAMMER_REST_ROT - HAMMER_STRIKE_ROT) * (1 - Math.pow(1 - k, 3)) -
              rebound;
          }
        }
      } else {
        rot = expDamp(rot, HAMMER_REST_ROT, 14, dt);
      }
      malletRotRef.current = rot;
      hammer.rotation.z = rot;
    }

    // The mallet's air, timed to peak into the contact.
    const whoosh = whooshAtRef.current;
    if (whoosh && now >= whoosh.at) {
      whooshAtRef.current = null;
      SoundManager.play(SFX.whoosh, { volume: 0.65 + whoosh.force * 0.5 });
    }

    // Strike-plate compression: the plate takes the blow, squashes, and springs
    // back with a short damped ring. The hammer head squashes with it.
    const plate = plateRef.current;
    const plateHit = plateHitRef.current;
    if (plate && plateHit) {
      const k = rm ? 1 : (now - plateHit.start) / 260;
      if (k >= 1) {
        plate.scale.set(1, 1, 1);
        plate.position.y = PLATE_Y;
        plateHitRef.current = null;
        if (hammerHead) hammerHead.scale.set(1, 1, 1);
      } else {
        const squash =
          Math.sin(k * Math.PI * 2.2) * Math.exp(-4.5 * k) * (0.16 + plateHit.force * 0.2);
        plate.scale.set(1 + squash * 0.4, 1 - squash, 1 + squash * 0.4);
        plate.position.y = PLATE_Y - squash * 0.09;
        if (hammerHead) {
          const headSquash = squash * 0.55;
          hammerHead.scale.set(1 - headSquash, 1 + headSquash * 0.5, 1 + headSquash * 0.5);
        }
      }
    }

    // Pad dust drifts up and out; sparks fall fast and die young.
    stepSpriteParticles(dustRef.current, dt, 2.4, 1.1);
    stepSpriteParticles(sparkRef.current, dt, 7.5, 2.2);

    // ── Puck flight: up on a curve that slows toward the top, a hold, then
    //    the drop. Squash and stretch keyed to each phase. ──
    const puck = puckRef.current;
    let puckScaleY = 1;
    let zoomTarget = 0;
    if (puck) {
      const anim = puckAnimRef.current;
      if (anim) {
        const el = now - anim.launchAt;
        const riseMs = rm ? anim.riseMs * 0.6 : anim.riseMs;
        const downMs = rm ? anim.downMs * 0.6 : anim.downMs;
        const holdMs = rm ? Math.min(anim.holdMs, 160) : anim.holdMs;
        anim.endAt = anim.launchAt + riseMs + holdMs + downMs;
        if (el < riseMs) {
          const k = clamp01(el / riseMs);
          const progress = 1 - Math.pow(1 - k, anim.power);
          puck.position.y = anim.from + (anim.to - anim.from) * progress;
          // Squashed flat by the strike, stretching as it climbs.
          puckScaleY = rm ? 1 : 0.74 + Math.min(1, el / 150) * 0.34;
          zoomTarget = clamp01((puck.position.y - 4) / 5) * ZOOM_BY_KIND[anim.pending.kind];
          const riseTone = riseToneRef.current;
          if (riseTone) riseTone.set(0.9 + 0.8 * Math.pow(progress, 1.4));
        } else if (el < riseMs + holdMs) {
          puck.position.y = anim.to;
          anim.stage = 'hold';
          zoomTarget = clamp01((anim.to - 4) / 5) * ZOOM_BY_KIND[anim.pending.kind];
          puckScaleY = rm ? 1 : 1 + 0.08 * Math.max(0, 1 - (el - riseMs) / 140);
          if (!anim.apexed) {
            anim.apexed = true;
            apexNow(anim, now);
          }
        } else if (el < riseMs + holdMs + downMs) {
          anim.stage = 'down';
          const k = easeInQuad((el - riseMs - holdMs) / downMs);
          puck.position.y = anim.to + (anim.from - anim.to) * k;
          puckScaleY = rm ? 1 : 1.04;
          zoomTarget = 0;
        } else {
          puck.position.y = anim.from;
          puckAnimRef.current = null;
          landNow(anim, now);
        }
      }

      // Landing squash: a short recover bounce whenever the puck touches down.
      const land = puckLandRef.current;
      if (land) {
        const k = rm ? 1 : (now - land.start) / 170;
        if (k >= 1) {
          puckLandRef.current = null;
        } else {
          puckScaleY = 0.76 + 0.24 * (1 - Math.pow(1 - clamp01(k), 3));
        }
      }
      const sxz = 1 + (1 - puckScaleY) * 0.5;
      puck.scale.set(sxz, puckScaleY, sxz);
    }

    // Bell wobble (decaying swing after a ring; gentler amp on a near-miss).
    // The clapper lags the bell by a quarter cycle and swings wider, the way a
    // free-hung clapper actually does.
    const bell = bellRef.current;
    const clapper = clapperRef.current;
    if (bell) {
      const anim = bellAnimRef.current;
      if (anim) {
        const el = (now - anim.start) / 1000;
        if (el >= 0) {
          const decay = Math.exp(-3.2 * el);
          bell.rotation.z = Math.sin(el * 22) * anim.amp * decay;
          if (clapper) {
            clapper.rotation.z =
              Math.sin(el * 22 - Math.PI * 0.45) * anim.amp * 1.5 * decay;
          }
          if (decay < 0.02) {
            bell.rotation.z = 0;
            if (clapper) clapper.rotation.z = 0;
            bellAnimRef.current = null;
          }
        }
      }
    }

    // Bell shockwave: one expanding, fading cream ring.
    const swAnim = shockwaveAnimRef.current;
    const shockwave = shockwaveRef.current;
    const shockMat = shockwaveMatRef.current;
    if (swAnim && shockwave && shockMat) {
      const k = (now - swAnim.start) / 550;
      if (k >= 1) {
        shockwave.visible = false;
        shockMat.opacity = 0;
        shockwaveAnimRef.current = null;
      } else {
        shockwave.visible = true;
        const grow = 1 + k * 2.3;
        shockwave.scale.set(grow, grow, 1);
        shockMat.opacity = 0.55 * (1 - k);
      }
    }

    // Confetti chips: tumble, fall, fade near the end.
    stepSpriteParticles(confettiRef.current, dt, 3.2, 0.35);

    // ── Camera: the whole tower at rest; while a hit climbs, it eases in and
    //    up toward the top. dt-based, so frame rate never changes the feel. ──
    camZoomRef.current = expDamp(camZoomRef.current, rm ? 0 : zoomTarget, 4, dt);
    const zoom = camZoomRef.current;
    const shake = rm ? { x: 0, y: 0 } : shakeOffset(wall);
    camera.position.set(
      shake.x * SHAKE_UNITS_PER_PX,
      CAM_REST_Y + zoom * CAM_PUSH_Y + shake.y * SHAKE_UNITS_PER_PX,
      CAM_Z - zoom * CAM_PUSH_Z,
    );
    camera.lookAt(0, LOOK_REST_Y + zoom * CAM_PUSH_LOOK, 0);

    // ── The cabinet's display: the score rolls; a result shows in passing. ──
    const disp = displayRef.current;
    if (disp) {
      const st = displayStateRef.current;
      const roll = scoreRollRef.current;
      if (roll) {
        const k = rm ? 1 : clamp01((now - roll.start) / 600);
        st.score = lerp(roll.from, roll.to, settleEase(k));
        if (k >= 1) {
          st.score = roll.to;
          scoreRollRef.current = null;
        }
      }
      const msgOn = st.message && wall < st.message.until ? st.message : null;
      const key = `${Math.round(st.score)}|${st.swing}|${msgOn ? msgOn.text + msgOn.sub + msgOn.tone : ''}`;
      if (key !== disp.painted) {
        disp.painted = key;
        paintDisplay(disp.canvas, st, wall);
        disp.texture.needsUpdate = true;
      }
    }

    // The line, the window and the bell band ease to the next swing's
    // heights, and sit exactly on them once a hold has begun.
    {
      const mt = meterTargetRef.current;
      const line = qualifierLine3DRef.current;
      const windowZone = windowZoneRef.current;
      const bellZone = bellZoneRef.current;
      const k = rm || wind ? 1 : 1 - Math.exp(-12 * dt);
      if (mt.set && line) line.position.y += (mt.lineY - line.position.y) * k;
      if (mt.set && bellZone) {
        bellZone.position.y += (mt.bellY - bellZone.position.y) * k;
        bellZone.scale.y += (mt.bellH - bellZone.scale.y) * k;
      }
      if (mt.set && windowZone && line && bellZone) {
        windowZone.position.y = line.position.y;
        windowZone.scale.y = Math.max(0.0001, bellZone.position.y - line.position.y);
      }
      // The line flashes: amber on a milestone, red on the miss.
      const flash = lineFlashRef.current;
      if (line) {
        const color = (line.material as THREE.MeshBasicMaterial).color;
        if (flash) {
          const fk = clamp01((now - flash.start) / (flash.red ? 900 : 500));
          color.copy(flash.red ? LINE_RED : TICKET_COLOR).lerp(PAPER_COLOR, flash.red ? fk * fk * 0.3 : fk);
          if (fk >= 1 && !flash.red) {
            lineFlashRef.current = null;
            color.copy(PAPER_COLOR);
          }
        } else {
          color.copy(PAPER_COLOR);
        }
      }
    }

    // A phase attribute for the QA bot, written only when it changes.
    const canvasEl = canvasRef.current;
    if (canvasEl) {
      const pa = puckAnimRef.current;
      const label = !playing
        ? gameStateRef.current
        : wind
          ? 'wind'
          : phaseRef.current === 'aim'
            ? 'aim'
            : phaseRef.current === 'over'
              ? 'over'
              : pa?.stage === 'down'
                ? 'resolve-down'
                : 'resolve';
      if (phaseAttrRef.current !== label) {
        phaseAttrRef.current = label;
        canvasEl.dataset.hsPhase = label;
      }
    }

    renderer.render(scene, camera);
    const pendingInput = pendingInputSpanRef.current;
    if (pendingInput) {
      pendingInputSpanRef.current = null;
      pendingInput.end({ response: "webgl-frame" });
    }
  }, [effectNow, shakeOffset, strikeNow, apexNow, landNow]);

  renderSceneRef.current = renderScene;

  const resize3D = useCallback((w: number, h: number) => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!renderer || !camera) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }, []);

  // ── The input: hold to wind up, release to swing. ──
  const cancelWindup = useCallback(() => {
    const wind = windRef.current;
    if (!wind) return;
    windRef.current = null;
    wind.tone.stop(60);
    pendingInputSpanRef.current?.cancel();
    pendingInputSpanRef.current = null;
  }, []);

  /** Event timestamps are on the performance.now() clock; a stray one isn't trusted. */
  const stamp = (ts: number) => {
    const now = performance.now();
    return ts > 0 && ts <= now + 2 ? ts : now;
  };

  const startWindup = useCallback(
    (startMs: number, source: 'pointer' | 'key', pointerId: number) => {
      if (gameStateRef.current !== 'playing' || windRef.current) return false;
      const seed = seedRef.current;
      if (seed === null) return false;
      // A new draw can begin once the last puck is on its way down, and never
      // while a released swing is still waiting to strike.
      if (phaseRef.current === 'over' || strikerRunDone(simRef.current)) return false;
      const sw = swingRef.current;
      if (sw && !sw.struck) return false;
      const pa = puckAnimRef.current;
      if (pa && pa.stage !== 'down') return false;
      // Answer in this frame: a click, a tap, the tone, the meter.
      trigger('press', { haptic: true, volume: 0.5 });
      pendingInputSpanRef.current?.cancel();
      pendingInputSpanRef.current = beginArcadeInput('high-striker:wind');
      const roundIdx = simRef.current.roundIndex;
      syncRoundMeter(roundIdx);
      const wall = performance.now();
      windRef.current = {
        startMs,
        source,
        pointerId,
        round: strikerRoundFor(seed, roundIdx),
        value: 0,
        lastTickAt: wall,
        aboveLine: false,
        inBell: false,
        wasAbove: false,
        tone: SoundManager.startHoldTone(),
      };
      return true;
    },
    [syncRoundMeter, trigger],
  );

  const releaseWindup = useCallback(
    (upMs: number) => {
      const wind = windRef.current;
      if (!wind) return;
      windRef.current = null;
      wind.tone.stop(40);
      const seed = seedRef.current;
      // A tap (a hold under STRIKER_MIN_HOLD_MS) is not a swing: the mallet
      // settles back and nothing is counted or sent. The same function the
      // validator's rules come from judges the hold, from the two events'
      // own timestamps.
      if (seed === null || gameStateRef.current !== 'playing') return;
      const judged = strikerJudgeHold(seed, simRef.current, wind.startMs, upMs);
      if (!('event' in judged)) return;
      const holdT = judged.t;
      const event = judged.event;
      if (event.type !== 'hit' && event.type !== 'miss') return;

      // Every judged swing is recorded, the ending miss too: the validator
      // replays them all and only saves a run that ended.
      swingsRef.current.push({ t: holdT });
      const now = effectNow();
      const strength = event.strength;
      // What you see after letting go is the judged strength, not the lead.
      meterRef.current = strength;
      const dropMs = lerp(STRIKER_DROP_MS_MIN, STRIKER_DROP_MS_MAX, clamp01(strength));
      const prevPuck = puckAnimRef.current;
      const strikeAt = Math.max(now + dropMs, prevPuck ? prevPuck.endAt : 0);

      simRef.current = judged.state;
      scoreRef.current = judged.state.score;
      setScore(judged.state.score);
      const last = strikerRunDone(judged.state);
      phaseRef.current = last ? 'over' : 'resolve';
      const swingAfter = judged.state.roundIndex + 1;

      let pending: PendingSwing;
      if (event.type === 'hit') {
        const kind = strikerPuckKind(true, event.bell, event.near);
        pending = {
          kind,
          strength: event.strength,
          last,
          points: event.points,
          bellStreak: event.bellStreak,
          scoreAfter: judged.state.score,
          hitsAfter: judged.state.rounds,
          swingAfter,
          side: null,
        };
        setResultAnnouncement(
          event.bell
            ? `Bell, ${event.points} points.`
            : kind === 'near'
              ? `Just under the bell, ${event.points} point.`
              : `Hit, ${event.points} point.`,
        );
      } else {
        pending = {
          kind: 'weak',
          strength,
          last,
          points: 0,
          bellStreak: 0,
          scoreAfter: judged.state.score,
          hitsAfter: judged.state.rounds,
          swingAfter: judged.state.roundIndex,
          side: event.side,
        };
        setResultAnnouncement(event.side === 'early' ? 'Too early. The run is over.' : 'Too late. The run is over.');
      }
      runStatsRef.current = {
        rounds: judged.state.rounds,
        bells: judged.state.bells,
        bestStreak: judged.state.bestBellStreak,
      };

      const canvasEl = canvasRef.current;
      if (canvasEl) {
        canvasEl.dataset.hsLast = `${judged.state.roundIndex - 1}:${strength.toFixed(3)}:${pending.kind}:${Math.round(holdT)}:${event.offsetMs.toFixed(1)}`;
        if (!last) {
          const next = strikerRoundFor(seed, judged.state.roundIndex);
          canvasEl.dataset.hsNext = `${next.index}:${next.peakMs.toFixed(2)}:${next.windowMs.toFixed(1)}:${next.bellWindowMs.toFixed(1)}`;
        }
      }
      swingRef.current = {
        dropStartAt: strikeAt - dropMs,
        dropMs,
        fromRot: malletRotRef.current,
        struck: false,
        pending,
      };
      whooshAtRef.current = { at: strikeAt - dropMs * 0.7, force: strength };
      playHaptic('tap');
    },
    [effectNow],
  );
  autoReleaseRef.current = releaseWindup;

  const resetRun = useCallback(() => {
    window.clearTimeout(resultTimerRef.current);
    cancelWindup();
    riseToneRef.current?.stop(20);
    riseToneRef.current = null;
    scoreRef.current = 0;
    setScore(0);
    runStatsRef.current = { rounds: 0, bells: 0, bestStreak: 0 };
    setRunStats({ rounds: 0, bells: 0, bestStreak: 0 });
    meterTargetRef.current.set = false;
    lineFlashRef.current = null;
    ladder.reset();
    simRef.current = strikerInitialState();
    swingsRef.current = [];
    phaseRef.current = 'aim';
    swingRef.current = null;
    puckAnimRef.current = null;
    bellAnimRef.current = null;
    whooshAtRef.current = null;
    plateHitRef.current = null;
    puckLandRef.current = null;
    shockwaveAnimRef.current = null;
    scoreRollRef.current = null;
    malletRotRef.current = HAMMER_REST_ROT;
    meterRef.current = 0;
    camZoomRef.current = 0;
    meterRoundRef.current = -1;
    displayStateRef.current = { score: 0, swing: 1, message: null };
    if (displayRef.current) displayRef.current.painted = '';
    const puck = puckRef.current;
    if (puck) {
      puck.position.y = PUCK_REST_Y;
      puck.scale.set(1, 1, 1);
    }
    const hammer = hammerRef.current;
    if (hammer) hammer.rotation.z = HAMMER_REST_ROT;
    const hammerHead = hammerHeadRef.current;
    if (hammerHead) hammerHead.scale.set(1, 1, 1);
    const plate = plateRef.current;
    if (plate) {
      plate.scale.set(1, 1, 1);
      plate.position.y = PLATE_Y;
    }
    resetSpriteParticles(dustRef.current);
    resetSpriteParticles(sparkRef.current);
    resetSpriteParticles(confettiRef.current);
    if (shockwaveRef.current) shockwaveRef.current.visible = false;
    if (shockwaveMatRef.current) shockwaveMatRef.current.opacity = 0;
    const bell = bellRef.current;
    if (bell) bell.rotation.z = 0;
    syncRoundMeter(0, true);
    gameStartTimeRef.current = performance.now();
  }, [cancelWindup, ladder, syncRoundMeter]);

  const startGame = useCallback(async () => {
    resetRunResult();
    if (isStartingRef.current) return;
    // No renderer → WebGL is unavailable (the fallback panel is showing).
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

    let sessionSuccess = false;
    try {
      const sessionResponse = await fetch('/api/games/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameType: 'high-striker' }),
      });
      if (sessionResponse.ok) {
        setBanIndefinite(false);
        setBanUntilMs(null);
        const sessionData = await sessionResponse.json();
        sessionTokenRef.current = sessionData.token;
        seedRef.current =
          typeof sessionData.highStrikerSeed === 'number'
            ? sessionData.highStrikerSeed
            : null;
        if (seedRef.current === null) {
          setGameState('error');
          gameStateRef.current = 'error';
          setStartError('Could not start your run. Try again.');
          isStartingRef.current = false;
          setIsStartingSession(false);
          return;
        }
        envMonitorRef.current.start();
        sessionSuccess = true;
      } else if (sessionResponse.status === 401) {
        // Guest run: local seed, scores not saved (mirrors other solo games).
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
      setStartError('Could not start your run. Try again.');
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
    gameStateRef.current = "playing";
    setGameState("playing");
    frameLoopRef.current?.start();
    SoundManager.unlock();
    SoundManager.play(SFX.start);
  }, [resetRun, resetRunResult]);

  // ── Generic "primary action": start / restart ──
  const primaryAction = useCallback(() => {
    const current = gameStateRef.current;
    if (current === 'idle' || current === 'error') {
      void startGame();
    } else if (current === 'gameover') {
      const since = performance.now() - gameOverTimeRef.current;
      if (since >= RESTART_GRACE_PERIOD) void startGame();
    }
  }, [startGame]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.code !== 'Enter' && e.code !== 'ArrowUp') return;
      if (isControlTarget(e.target) || isDialogOpen()) return;
      // Every press of the game's keys, the repeats a held key sends too, is
      // the game's: none of them scroll the page. (Returning on a repeat before
      // this line let a held space scroll a short window.)
      e.preventDefault();
      if (e.repeat) return;
      SoundManager.unlock();
      if (gameStateRef.current === 'playing') {
        startWindup(stamp(e.timeStamp), 'key', -1);
      } else {
        primaryAction();
      }
    },
    [primaryAction, startWindup],
  );

  const handleKeyUp = useCallback(
    (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.code !== 'Enter' && e.code !== 'ArrowUp') return;
      const wind = windRef.current;
      if (!wind || wind.source !== 'key') return;
      e.preventDefault();
      releaseWindup(stamp(e.timeStamp));
    },
    [releaseWindup],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      SoundManager.unlock();
      e.preventDefault();
      if (gameStateRef.current !== 'playing') return;
      if (startWindup(stamp(e.nativeEvent.timeStamp), 'pointer', e.pointerId)) {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // The release still arrives on the window below.
        }
      }
    },
    [startWindup],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const wind = windRef.current;
      if (!wind || wind.source !== 'pointer' || wind.pointerId !== e.pointerId) return;
      e.preventDefault();
      releaseWindup(stamp(e.nativeEvent.timeStamp));
    },
    [releaseWindup],
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const wind = windRef.current;
      if (wind && wind.source === 'pointer' && wind.pointerId === e.pointerId) cancelWindup();
    },
    [cancelWindup],
  );

  // ── Effects ──
  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  // The stage reports the screen's size; the canvas takes it whole.
  const fitCanvas = useCallback(({ width, height }: GameStageSize) => {
    setCanvasSize((prev) =>
      prev && prev.width === Math.floor(width) && prev.height === Math.floor(height)
        ? prev
        : { width: Math.floor(width), height: Math.floor(height) },
    );
  }, []);

  // Build the scene once the stage has a size (so the renderer is sized once,
  // before the first render), draw the first frame, then compile the rest.
  useEffect(() => {
    if (!canvasSize) return;
    buildScene(canvasSize.width, canvasSize.height);
    // A skin that arrived before the scene existed draws its face and puck now.
    applyStrikerTheme();
    resize3D(canvasSize.width, canvasSize.height);
    renderScene();
    if (rendererRef.current && !deferredStartedRef.current) {
      deferredStartedRef.current = true;
      // The first frame is on screen: record it, then warm the shaders.
      markMidwayFirstFrame('high-striker', qualityRef.current?.tier() ?? 'medium');
      setSceneReady(true);
      deferredRef.current?.start(() => {
        if (gameStateRef.current !== 'playing') renderSceneRef.current();
      });
    }
    if (perfReadyRef.current || !rendererRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      if (perfReadyRef.current || !rendererRef.current) return;
      perfReadyRef.current = true;
      markArcadeGameReady("high-striker", perfLoadStartedAtRef.current, {
        renderer: "webgl",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [buildScene, applyStrikerTheme, resize3D, renderScene, canvasSize]);

  useEffect(() => {
    const loop = createGameFrameLoop({
      // High Striker's state is input and timestamp driven; the runtime owns
      // scheduling while renderScene steps wall-clock tweens on the effect
      // clock (so a hit-stop freezes them).
      simulate: () => {},
      render: (_alpha, frame) => {
        // A tier change waits while the player is drawing: a recompile there
        // would stall the input being timed.
        qualityRef.current?.hold(
          gameStateRef.current === 'playing' && (phaseRef.current === 'aim' || windRef.current !== null),
        );
        qualityRef.current?.frame(frame.nowMs, frame.deltaMs);
        renderSceneRef.current(frame);
        if (gameStateRef.current !== "playing") loop.stop();
      },
    });
    frameLoopRef.current = loop;
    return () => {
      loop.destroy();
      window.clearTimeout(resultTimerRef.current);
      if (frameLoopRef.current === loop) frameLoopRef.current = null;
    };
  }, []);

  // Apply equipped cosmetics to the live scene (and re-render the idle frame).
  useEffect(() => {
    themeRef.current = strikerTheme;
    applyStrikerTheme();
    if (gameStateRef.current !== 'playing') {
      renderScene();
    }
  }, [strikerTheme, applyStrikerTheme, renderScene]);

  // Keyboard listeners, and a draw that loses the page is let go.
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', cancelWindup);
    const onHidden = () => {
      if (document.hidden) cancelWindup();
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', cancelWindup);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [handleKeyDown, handleKeyUp, cancelWindup]);

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
      frameLoopRef.current?.destroy();
      frameLoopRef.current = null;
      pendingInputSpanRef.current?.cancel();
      pendingInputSpanRef.current = null;
      windRef.current?.tone.stop(10);
      windRef.current = null;
      riseToneRef.current?.stop(10);
      riseToneRef.current = null;
      monitor.stop();
      // Dispose the three.js scene: geometries, materials and textures.
      deferredRef.current?.dispose();
      deferredRef.current = null;
      rigRef.current?.dispose();
      rigRef.current = null;
      qualityRef.current?.dispose();
      qualityRef.current = null;
      const scene = sceneRef.current;
      if (scene) disposeSceneDeep(scene);
      rendererHandleRef.current?.dispose();
      rendererHandleRef.current = null;
      rendererRef.current = null;
      sceneRef.current = null;
      displayRef.current = null;
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

  const phase: GamePhase =
    gameState === 'idle' ? 'ready' : gameState === 'gameover' || gameState === 'error' ? 'over' : 'playing';
  const isBest = gameState === 'gameover' && score > 0 && score >= (highScore ?? 0);

  const end =
    gameState === 'gameover' ? (
      <ArcadeRunResult
        title={isBest ? 'New best' : 'Run over'}
        tone={isBest ? 'best' : 'neutral'}
        stats={[
          { label: 'score', value: score, highlight: isBest },
          { label: 'swings', value: runStats.rounds },
          { label: 'bells in a row', value: runStats.bestStreak },
        ]}
        reward={runResult.reward}
        achievements={runResult.achievements}
        saving={isSubmitting}
        error={submitError}
        guest={runRewardMessage === GUEST_RUN_MESSAGE}
        actions={<ArcadeRematchButton onClick={() => void startGame()} />}
      />
    ) : gameState === 'error' ? (
      <GameStageNotice
        title={banIndefinite || banUntilMs ? 'Banned from games' : 'Connection lost'}
        action={
          <ArcadeButton tone='primary' onClick={() => void startGame()} disabled={isStartingSession}>
            retry
          </ArcadeButton>
        }
      >
        <p>{startError ?? 'Could not reach the server. Try again.'}</p>
        {banIndefinite || banUntilMs ? (
          <p>
            {banIndefinite
              ? 'You are banned until an admin lifts it.'
              : `Ban ends in ${formatBanCountdown(banUntilMs!)}.`}
          </p>
        ) : null}
      </GameStageNotice>
    ) : null;

  return (
    <GameShell
      game='high-striker'
      stat={<GameStat value={highScore} label='best' />}
      howTo={HOW_TO}
      tickets={walletBalances.credits}
      below={
        <div className='flex flex-wrap items-center justify-center gap-2'>
          <GameLeaderboardButton onClick={() => setShowLeaderboard(true)} />
        </div>
      }
    >
      <GameStage
        phase={phase}
        hint={HINT}
        busy={
          isStartingSession
            ? 'Starting your run.'
            : !sceneReady && !webglError
              ? 'Loading the cabinet.'
              : null
        }
        onStart={() => void startGame()}
        aspect={BASE_WIDTH / BASE_HEIGHT}
        onSize={fitCanvas}
        end={end}
      >
        {webglError ? (
          <MidwayStill
            game='high-striker'
            alt='A striped tower with a brass bell on top.'
            style={canvasSize ? { width: canvasSize.width, height: canvasSize.height } : undefined}
          />
        ) : (
          <>
            {/* three.js renders into this canvas (it manages the drawing buffer). */}
            <canvas
              ref={canvasRef}
              aria-label='High striker tower. Hold to draw the mallet back and let go to swing. Keyboard players hold space.'
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              className='block cursor-pointer'
              style={{
                touchAction: 'none',
                width: canvasSize?.width ?? '100%',
                height: canvasSize?.height ?? '100%',
              }}
            />
            <p className='sr-only' aria-live='polite' aria-atomic='true'>
              {resultAnnouncement}
            </p>
          </>
        )}
      </GameStage>

      <GameLeaderboardModal
        open={showLeaderboard}
        onOpenChange={setShowLeaderboard}
        title='High striker board'
        description='Highest strongman scores, and your rank.'
      >
        <GameLeaderboard
          gameType='high-striker'
          maxEntries={5}
          enableFullLeaderboardModal
          fullLeaderboardDisplay='inline'
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>
    </GameShell>
  );
}
