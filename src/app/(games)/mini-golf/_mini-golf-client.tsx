'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { DAILY_BOARD_MODES, GameLeaderboard } from '@/features/arcade/components/game-leaderboard';
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
import {
  ArcadeGameplayCallouts,
  type ArcadeGameplayCallout,
  type ArcadeGameplayCalloutTone,
} from '@/features/arcade/components/gameplay/arcade-game-hud';
import { ArcadeRematchButton, ArcadeRunResult } from '@/features/arcade/components/results/arcade-run-result';
import { MidwayStill } from '@/features/arcade/components/midway-still';
import { isControlTarget, isDialogOpen } from '@/features/arcade/lib/use-first-input';
import { EnvMonitor } from '@/features/arcade/lib/game-anti-cheat';
import { useArcadeRunResult } from '@/features/arcade/lib/run-result';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { playHaptic } from '@/features/arcade/lib/game-haptics';
import { useFeelReducedMotion, useGameFeedback } from '@/features/arcade/lib/use-game-feedback';
import { semitonesToPitch, settleEase, springEase, squashAt } from '@/features/arcade/lib/game-feel';
import { createGameFrameLoop, type GameFrameInfo, type GameFrameLoop } from '@/features/arcade/lib/game-frame-loop';
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
  makeSoftDiscTexture,
  makeSpriteParticlePool,
  markMidwayFirstFrame,
  midwayParticleCount,
  resetSpriteParticles,
  stepSpriteParticles,
  type MidwayDeferredTextures,
  type MidwayLightRig,
  type MidwayQualityController,
  type MidwayRendererHandle,
  type SpriteParticle,
} from '@/features/arcade/lib/midway-three';
import {
  MG_BALL_R,
  MG_HOLES,
  MG_MAX_STROKES,
  MG_PICKUP_SCORE,
  MG_MIN_AIM_MS,
  MG_PACE,
  MG_STEP_MS,
  mgMillTurn,
  mgQuantizePutt,
  mgReplayHole,
  mgSimulatePutt,
  type MgEvent,
  type MgHole,
  type MgPutt,
} from '@/server/arcade/mini-golf-engine';
import { mgBuildHole, mgCourseFor, mgDateKey, mgTemplate, type MgCourse } from '@/server/arcade/mini-golf-course';
import { createMgPlayback, mgAimPath, mgSpeedTrack, type MgPlayback, type MgSample } from './_mini-golf-play';
import {
  HOUSE_LOOK,
  buildHoleScene,
  disposeHoleScene,
  feltHeight,
  loopPoint,
  makeDeckTexture,
  makeMgMaterials,
  toWorld,
  type HoleScene,
  type MgMaterials,
} from './_mini-golf-scene';
import { makeBallSkinTexture, makeFeltSkinTexture, miniGolfLookFrom, type MgInventory, type MgSkinLook } from './_mini-golf-skin';
import './_mini-golf.css';

/* ──────────────────────────────────────────────────────────────────────────
   MINI GOLF: nine boardwalk holes, a new course each day. Feel spec:
   docs/design/tixy-rebrand/MINI_GOLF.md.

   Drag back anywhere to aim and set the pace; the dotted line shows the
   line to the first rail and the ring round the ball shows the pace. Let go
   to putt. The ball is the shared engine (server/arcade/mini-golf-engine.ts)
   stepped live at 240 Hz and drawn between steps, so it rolls the same on
   every screen and stops where the server's replay stops.
   ────────────────────────────────────────────────────────────────────────── */

const BASE_WIDTH = 360;
const BASE_HEIGHT = 600;

const HINT: GameHint = 'Drag back to aim, release to putt.';
const HOW_TO: GameHowTo = {
  lines: [
    'Drag back from anywhere and let go to putt. Back to where you pressed cancels.',
    'Nine holes, a new course daily. A hole ends at six strokes and scores 7.',
    "A hole scores 7 less its strokes, and the day's first round pays up to 75 tickets.",
  ],
};

// Camera: above and behind the tee, looking up the hole.
const CAM_FOV = 38;
const CAM_ELEV = (58 * Math.PI) / 180;
const CAM_DIR = new THREE.Vector3(0, Math.sin(CAM_ELEV), Math.cos(CAM_ELEV));
/** Shake: px to world units at the course. */
const SHAKE_UNITS_PER_PX = 0.004;

// Input. A full-power pull is short enough to make from low on a phone,
// and shorter still when the press leaves less room below it.
const DEAD_PX = 14;
const PULL_MIN_PX = 84;
const PULL_MAX_PX = 170;
/** A pull this close to full is full, so full power is easy to find. */
const FULL_SNAP = 0.97;
const KB_TURN = (1.5 * Math.PI) / 180;
const KB_POWER = 0.04;

const INTRO_MS = 1150;
const HOLED_TO_CARD_MS = 1500;
const PICKUP_TO_CARD_MS = 1200;

/** Pace 0 to 1 → paper, then ticket amber, then red at full pace. */
const PACE_STOPS: Array<[number, [number, number, number]]> = [
  [0, [244, 235, 220]],
  [0.55, [242, 163, 60]],
  [1, [184, 54, 39]],
];
function paceColor(k: number, out: THREE.Color): THREE.Color {
  const t = Math.min(1, Math.max(0, k));
  for (let i = 1; i < PACE_STOPS.length; i += 1) {
    const [p1, c1] = PACE_STOPS[i];
    const [p0, c0] = PACE_STOPS[i - 1];
    if (t <= p1) {
      const f = (t - p0) / (p1 - p0);
      return out.setRGB(
        (c0[0] + (c1[0] - c0[0]) * f) / 255,
        (c0[1] + (c1[1] - c0[1]) * f) / 255,
        (c0[2] + (c1[2] - c0[2]) * f) / 255,
        THREE.SRGBColorSpace,
      );
    }
  }
  return out.setRGB(184 / 255, 54 / 255, 39 / 255, THREE.SRGBColorSpace);
}

/** Drag share to the engine's power: a little finer on short putts. */
const shareToPower = (share: number) => Math.pow(Math.min(1, Math.max(0, share)), 1.2);

/** The pull, in CSS px, that is full power for a press at clientY. */
function fullPullPx(clientY: number): number {
  const vw = window.visualViewport?.width ?? window.innerWidth;
  const vh = window.visualViewport?.height ?? window.innerHeight;
  const base = Math.min(PULL_MAX_PX, Math.max(120, Math.min(vw, vh) * 0.38));
  const room = vh - clientY - DEAD_PX - 10;
  return Math.max(PULL_MIN_PX, Math.min(base, room));
}

type AimDrag = {
  id: number;
  /** The anchor: where the press began, dragged along behind a pull past full. */
  sx: number;
  sy: number;
  /** The finger now. */
  x: number;
  y: number;
  /** Full-power pull for this press, px. */
  pull: number;
  share: number;
  dx: number;
  dy: number;
  live: boolean;
  /** It was a putt at some point: back inside the dead zone is a cancel. */
  armed: boolean;
};

type GameState = 'idle' | 'playing' | 'card' | 'gameover' | 'error';
type RoundMode = 'counted' | 'practice' | 'guest';

/** Today's counted round, as the round route returns it. */
type ServerRound = {
  id: string;
  dateKey: string;
  holesDone: number;
  holes: Array<{ putts: MgPutt[]; score: number }>;
  current?: MgPutt[];
  strokes: number;
  par: number;
  aces: number;
  finished: boolean;
};

/** A friend's round today, for the scorecard. */
export type FriendRound = {
  userId: string;
  name: string;
  scores: number[];
  holesDone: number;
  strokes: number;
  toPar: number;
  finished: boolean;
};
type Phase = 'intro' | 'aim' | 'roll' | 'holed' | 'pickup';

/** A hole's score against par, in words. Sentence case. */
export function scoreName(strokes: number, par: number, holed: boolean): string {
  if (!holed) return 'Picked up';
  if (strokes === 1) return 'Hole in one';
  const d = strokes - par;
  if (d <= -3) return 'Albatross';
  if (d === -2) return 'Eagle';
  if (d === -1) return 'Birdie';
  if (d === 0) return 'Par';
  if (d === 1) return 'Bogey';
  if (d === 2) return 'Double bogey';
  return `+${d}`;
}

/** A round's points: 7 less each hole's strokes, what tickets are paid on. */
function mgRoundPointsOf(scores: number[]): number {
  return scores.reduce((sum, s) => sum + Math.max(0, MG_PICKUP_SCORE - s), 0);
}

/** Round total against par: "E", "+3", "−2". */
export function toParLabel(d: number): string {
  if (d === 0) return 'E';
  return d > 0 ? `+${d}` : `−${-d}`;
}

const SFX = {
  putt: 'golfPutt',
  rail: 'skeeWoodKnock',
  post: 'skeeRimRattle',
  cup: 'golfCup',
  lip: 'skeeRimRattle',
  chime: 'skeeChime',
  whoosh: 'flappyWhoosh',
  best: 'arcadeWin',
  over: 'arcadeReveal',
  pickup: 'arcadeLose',
} as const;

/** QA only (development, or ?mgQa=1): ?mgTemplates=windmill,loop puts those
 *  templates first, so a screenshot can open on any piece. */
function qaCourse(course: MgCourse): MgCourse {
  if (typeof window === 'undefined') return course;
  const params = new URLSearchParams(window.location.search);
  const allowed = process.env.NODE_ENV !== 'production' || params.has('mgQa');
  const ids = params.get('mgTemplates');
  if (!allowed || !ids) return course;
  const holes = [...course.holes];
  ids.split(',').forEach((id, i) => {
    const t = mgTemplate(id);
    if (!t || i >= holes.length) return;
    const options = { ...holes[i].options, slot: t.slot?.[0] ?? 'none' };
    holes[i] = { templateId: id, options, hole: mgBuildHole(t, options) };
  });
  return { ...course, holes, par: holes.reduce((a, h) => a + h.hole.par, 0) };
}

/** A practice round prints a strip that pays nothing. */
const PRACTICE_REWARD = { awardedCredits: 0, wantedCredits: 0, awardedTickets: 0, wantedTickets: 0 };

const SPIN_AXIS = new THREE.Vector3();
const TMP = new THREE.Vector3();
const TMP2 = new THREE.Vector3();
const COLOR = new THREE.Color();
const AIM_TIP = new THREE.Vector3();
const AIM_FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const AIM_TURN = new THREE.Quaternion();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const AIM_M = new THREE.Matrix4();
const AIM_S = new THREE.Vector3();

export default function MiniGolfClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [gameState, setGameState] = useState<GameState>('idle');
  const [holeIndex, setHoleIndex] = useState(0);
  const [scores, setScores] = useState<number[]>([]);
  const [strokesShown, setStrokesShown] = useState(0);
  const [callouts, setCallouts] = useState<ArcadeGameplayCallout[]>([]);
  const [webglError, setWebglError] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [startError, setStartError] = useState<string | null>(null);
  const [course, setCourse] = useState<MgCourse>(() => qaCourse(mgCourseFor(mgDateKey(Date.now()))));
  const courseRef = useRef(course);
  const dateKey = course.dateKey;
  // The day's counted round on the server: 'guest' plays without saving,
  // 'counted' saves every putt, 'practice' is a later round today.
  const [account, setAccount] = useState<'loading' | 'guest' | 'signed'>('loading');
  const [serverRound, setServerRound] = useState<ServerRound | null>(null);
  const [mode, setMode] = useState<RoundMode>('guest');
  const [starting, setStarting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [friends, setFriends] = useState<FriendRound[]>([]);
  const [newBest, setNewBest] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [skinLook, setSkinLook] = useState<MgSkinLook>(() => miniGolfLookFrom(null));
  const skinLookRef = useRef(skinLook);
  const skinPaintRef = useRef<{ key: string; felt: THREE.Texture | null; ball: THREE.Texture | null; deck: THREE.Texture | null }>({
    key: '',
    felt: null,
    ball: null,
    deck: null,
  });
  const [boardMode, setBoardMode] = useState<'daily' | 'alltime'>('daily');
  const { result: runResult, capture: captureRunResult, reset: resetRunResult } = useArcadeRunResult();

  const reducedMotion = useFeelReducedMotion();
  const { trigger, hitStopClock, shakeOffset } = useGameFeedback();

  // ── Refs: the run ──
  const gameStateRef = useRef<GameState>('idle');
  const phaseRef = useRef<Phase>('intro');
  const holeIndexRef = useRef(0);
  const holeRef = useRef<MgHole>(course.holes[0].hole);
  const modeRef = useRef<RoundMode>('guest');
  const roundIdRef = useRef<string | null>(null);
  const postChainRef = useRef<Promise<void>>(Promise.resolve());
  const roundBrokenRef = useRef(false);
  const envMonitorRef = useRef(new EnvMonitor());
  const strokesRef = useRef(0);
  const scoresRef = useRef<number[]>([]);
  const puttsRef = useRef<MgPutt[][]>([]);
  const ballPosRef = useRef({ x: 0, y: 0 });
  const holeClockRef = useRef(0);
  /** The earliest the next putt may be struck on the hole clock. */
  const readyAtRef = useRef(0);
  const introStartRef = useRef(0);
  const phaseAtRef = useRef(0);
  const playRef = useRef<MgPlayback | null>(null);
  const sampleRef = useRef<MgSample>({ x: 0, y: 0, vx: 0, vy: 0, mode: 'rest', s: 0, loop: -1 });
  const stopRollRef = useRef<() => void>(() => {});
  const reducedMotionRef = useRef(false);
  const calloutIdRef = useRef(0);

  // ── Refs: input ──
  const dragRef = useRef<AimDrag | null>(null);
  const kbRef = useRef<{ angle: number; share: number; until: number }>({ angle: Math.PI / 2, share: 0.35, until: 0 });

  // ── Refs: three.js ──
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const handleRef = useRef<MidwayRendererHandle | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rigRef = useRef<MidwayLightRig | null>(null);
  const qualityRef = useRef<MidwayQualityController | null>(null);
  const deferredRef = useRef<MidwayDeferredTextures | null>(null);
  const deferredStartedRef = useRef(false);
  const matsRef = useRef<MgMaterials | null>(null);
  const holeSceneRef = useRef<HoleScene | null>(null);
  const ballRef = useRef<THREE.Group | null>(null);
  const ballSpinRef = useRef<THREE.Mesh | null>(null);
  const shadowRef = useRef<THREE.Mesh | null>(null);
  const dotsRef = useRef<THREE.InstancedMesh | null>(null);
  const ringRef = useRef<THREE.Mesh | null>(null);
  const ringTrackRef = useRef<THREE.Mesh | null>(null);
  const arrowRef = useRef<THREE.Mesh | null>(null);
  // The pull on the glass: anchor, a line to the finger, and the pace read out.
  const pullSvgRef = useRef<SVGSVGElement | null>(null);
  const pullLineRef = useRef<SVGLineElement | null>(null);
  const pullAnchorRef = useRef<SVGCircleElement | null>(null);
  const paceTagRef = useRef<HTMLSpanElement | null>(null);
  const confettiRef = useRef<SpriteParticle[]>([]);
  const dustRef = useRef<SpriteParticle[]>([]);
  const frameLoopRef = useRef<GameFrameLoop | null>(null);
  const renderRef = useRef<(frame?: GameFrameInfo) => void>(() => {});
  const lastWallRef = useRef(0);
  const frozenTotalRef = useRef(0);

  // ── Refs: motion ──
  const camRef = useRef({
    target: new THREE.Vector3(),
    dist: 8,
    fitTarget: new THREE.Vector3(),
    fitDist: 8,
  });
  const squashRef = useRef<{ start: number; force: number } | null>(null);
  const hopRef = useRef<{ start: number; height: number } | null>(null);
  const dropRef = useRef<{ start: number; from: THREE.Vector3 } | null>(null);
  const flagRef = useRef({ lift: 0, pop: -Infinity, spin: 0 });
  const prevBallRef = useRef<THREE.Vector3 | null>(null);
  const nearCupRef = useRef(false);

  const pushCallout = useCallback((label: string, tone: ArcadeGameplayCalloutTone, extra?: Partial<ArcadeGameplayCallout>) => {
    calloutIdRef.current += 1;
    const id = calloutIdRef.current;
    const duration = extra?.duration ?? 1100;
    setCallouts((items) => [...items.slice(-2), { id, label, tone, duration, y: 42, ...extra }]);
    window.setTimeout(() => setCallouts((items) => items.filter((item) => item.id !== id)), duration + 80);
  }, []);

  // ── Camera framing ──
  const fitCamera = useCallback((points: THREE.Vector3[], aspect: number) => {
    const box = new THREE.Box3().setFromPoints(points);
    const target = box.getCenter(new THREE.Vector3());
    const cam = new THREE.PerspectiveCamera(CAM_FOV, aspect, 0.1, 100);
    const fits = (d: number) => {
      cam.position.copy(target).addScaledVector(CAM_DIR, d);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      cam.updateProjectionMatrix();
      for (const p of points) {
        TMP.copy(p).project(cam);
        if (Math.abs(TMP.x) > 0.9 || TMP.y > 0.84 || TMP.y < -0.92 || TMP.z > 1) return false;
      }
      return true;
    };
    let lo = 1;
    let hi = 40;
    for (let i = 0; i < 28; i += 1) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    return { target, dist: hi };
  }, []);

  /** The points that frame a hole: its corners at felt and rail height. */
  const holeFramePoints = useCallback((hole: MgHole) => {
    const pts: THREE.Vector3[] = [];
    for (const c of hole.cells) {
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]) {
        const x = c.col + dx;
        const y = c.row + dy;
        const h = c.level * 0.22;
        pts.push(toWorld(x, y, h - 0.1), toWorld(x, y, h + 0.15));
      }
    }
    for (const m of hole.windmills) pts.push(toWorld(m.x, m.gateY, 1.2));
    return pts;
  }, []);

  // ── A skin set's look on the live materials (or the house look) ──
  const applySkin = useCallback((next: MgSkinLook) => {
    const mats = matsRef.current;
    if (!mats) return;
    const look = next.look;
    const paint = skinPaintRef.current;
    const key = JSON.stringify([next.skin?.material ?? 'house', next.skin?.shape ?? 'house', look]);
    mats.rail.color.set(look.rail);
    mats.railTop.color.set(look.railTop);
    mats.flag.color.set(look.flag);
    if (key === paint.key) return;
    paint.key = key;
    paint.felt?.dispose();
    paint.ball?.dispose();
    paint.deck?.dispose();
    const felt = makeFeltSkinTexture(next);
    const ball = makeBallSkinTexture(next);
    const deck = makeDeckTexture(look);
    paint.felt = felt;
    paint.ball = ball;
    paint.deck = deck;
    // A painted felt carries its own colour; the house felt is a flat one.
    if (felt) {
      mats.felt.map = felt;
      mats.felt.color.set('#ffffff');
    } else {
      mats.felt.map = blankRef.current;
      mats.felt.color.set(look.felt);
    }
    mats.ball.map = ball;
    mats.deck.map = deck;
    mats.deck.color.set('#ffffff');
    renderRef.current();
  }, []);
  const applySkinRef = useRef(applySkin);
  applySkinRef.current = applySkin;
  const blankRef = useRef<THREE.Texture | null>(null);

  // ── Scene setup ──
  const buildScene = useCallback((width: number, height: number) => {
    const canvas = canvasRef.current;
    if (!canvas || rendererRef.current) return;
    const quality = qualityRef.current ?? createMidwayQualityController({ game: 'mini-golf' });
    qualityRef.current = quality;
    const tier = quality.tier();
    const fallBack = () => {
      frameLoopRef.current?.stop();
      deferredRef.current?.dispose();
      deferredRef.current = null;
      rigRef.current?.dispose();
      rigRef.current = null;
      if (sceneRef.current) disposeSceneDeep(sceneRef.current);
      sceneRef.current = null;
      holeSceneRef.current = null;
      rendererRef.current = null;
      handleRef.current?.dispose();
      handleRef.current = null;
      setWebglError(true);
    };
    const handle = createMidwayRenderer({
      canvas,
      tier,
      width,
      height,
      onPause: () => frameLoopRef.current?.stop(),
      onRestore: () => {
        rigRef.current?.refreshEnvironment();
        renderRef.current();
        if (gameStateRef.current === 'playing') frameLoopRef.current?.start();
      },
      onFallback: fallBack,
    });
    if (!handle) {
      setWebglError(true);
      return;
    }
    handleRef.current = handle;
    const renderer = handle.renderer;
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(HOUSE_LOOK.sky);
    sceneRef.current = scene;
    const camera = new THREE.PerspectiveCamera(CAM_FOV, width / Math.max(1, height), 0.1, 100);
    cameraRef.current = camera;

    const hole = holeRef.current;
    const w = hole.cols;
    const h = hole.rows;
    const rig = createMidwayLightRig(renderer, scene, {
      tier,
      target: [w / 2, 0, -h / 2],
      radius: 6,
      camera: [w / 2, 7, 3],
      sky: MIDWAY_PALETTE.nightTop,
      ground: HOUSE_LOOK.deck,
    });
    rigRef.current = rig;
    quality.onChange((next) => {
      applyMidwayTier(renderer, rig, next, { scene, camera });
      if (gameStateRef.current !== 'playing') renderRef.current();
    });

    const deferred = createMidwayDeferredTextures('mini-golf', { quality });
    deferredRef.current = deferred;
    const blank = deferred.placeholder();
    blankRef.current = blank;
    const shadowTex = makeSoftDiscTexture();
    const mats = makeMgMaterials(HOUSE_LOOK, shadowTex, blank);
    matsRef.current = mats;
    // The deck, the ball and a skin's felt paint after the first frame.
    deferred.add(
      () => null,
      () => applySkinRef.current(skinLookRef.current),
    );

    // The ball: the group moves and squashes, the mesh inside it spins.
    const spin = new THREE.Mesh(new THREE.SphereGeometry(MG_BALL_R, 28, 18), mats.ball);
    spin.castShadow = true;
    const ball = new THREE.Group();
    ball.add(spin);
    scene.add(ball);
    ballRef.current = ball;
    ballSpinRef.current = spin;

    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mats.shadow);
    shadow.rotation.x = -Math.PI / 2;
    shadow.renderOrder = 1;
    scene.add(shadow);
    shadowRef.current = shadow;

    // Aim dots: one instanced disc.
    const dots = new THREE.InstancedMesh(new THREE.CircleGeometry(0.026, 12), mats.aim, 48);
    dots.count = 0;
    dots.renderOrder = 3;
    dots.frustumCulled = false;
    scene.add(dots);
    dotsRef.current = dots;
    // An arrowhead at the end of the line, so the way it goes reads at once.
    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(0, 0.08);
    arrowShape.lineTo(-0.06, -0.02);
    arrowShape.lineTo(0, 0.005);
    arrowShape.lineTo(0.06, -0.02);
    arrowShape.closePath();
    const arrow = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape), mats.aim);
    arrow.renderOrder = 3;
    arrow.visible = false;
    scene.add(arrow);
    arrowRef.current = arrow;
    // The pace ring round the ball, drawn up to the pace by its draw range.
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.17, 64, 1, Math.PI / 2, -Math.PI * 2), mats.ring);
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 3;
    ring.visible = false;
    scene.add(ring);
    ringRef.current = ring;
    const track = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.17, 64), mats.ringTrack);
    track.rotation.x = -Math.PI / 2;
    track.renderOrder = 2;
    track.visible = false;
    scene.add(track);
    ringTrackRef.current = track;

    confettiRef.current = makeSpriteParticlePool({
      scene,
      count: 28,
      texture: null,
      colors: [MIDWAY_PALETTE.ticket, MIDWAY_PALETTE.paper, MIDWAY_PALETTE.red],
      size: 0.06,
    });
    dustRef.current = makeSpriteParticlePool({
      scene,
      count: 10,
      texture: shadowTex,
      colors: ['#d9e6cf'],
      size: 0.09,
    });

    // Every material, on a hidden mesh, so the compile below covers the
    // ones a later hole first shows (the mill, the loop) and no hole load
    // compiles a shader.
    const warm = new THREE.Group();
    const warmGeo = new THREE.PlaneGeometry(0.01, 0.01);
    for (const mat of Object.values(mats)) {
      const m = new THREE.Mesh(warmGeo, mat as THREE.Material);
      m.castShadow = true;
      m.receiveShadow = true;
      warm.add(m);
    }
    warm.visible = false;
    warm.position.set(0, -5, 0);
    scene.add(warm);

    // Compile what first shows mid-hole while the page is idle.
    deferred.add(
      () => {
        const hidden: THREE.Object3D[] = [];
        scene.traverse((o) => {
          if (!o.visible) {
            hidden.push(o);
            o.visible = true;
          }
        });
        renderer.compile(scene, camera);
        for (const o of hidden) o.visible = false;
        return null;
      },
      () => undefined,
    );
  }, []);

  /** Swap the course to hole i: dispose the old one, build the new. */
  const loadHole = useCallback(
    (i: number, intro: boolean) => {
      const scene = sceneRef.current;
      const mats = matsRef.current;
      const camera = cameraRef.current;
      const hole = courseRef.current.holes[i].hole;
      holeRef.current = hole;
      holeIndexRef.current = i;
      setHoleIndex(i);
      strokesRef.current = 0;
      setStrokesShown(0);
      puttsRef.current[i] = [];
      ballPosRef.current = { x: hole.tee.x, y: hole.tee.y };
      holeClockRef.current = 0;
      readyAtRef.current = 0;
      playRef.current = null;
      dropRef.current = null;
      hopRef.current = null;
      squashRef.current = null;
      dragRef.current = null;
      nearCupRef.current = false;
      flagRef.current = { lift: 0, pop: -Infinity, spin: 0 };
      kbRef.current = {
        angle: Math.atan2(hole.cup.y - hole.tee.y, hole.cup.x - hole.tee.x),
        share: 0.35,
        until: 0,
      };
      if (!scene || !mats || !camera) return;
      const buildStart = performance.now();
      if (holeSceneRef.current) disposeHoleScene(holeSceneRef.current);
      const built = buildHoleScene(hole, mats);
      scene.add(built.group);
      holeSceneRef.current = built;
      performance.measure('mini-golf hole build', { start: buildStart, end: performance.now() });
      const rig = rigRef.current;
      if (rig) {
        rig.key.target.position.set(hole.cols / 2, 0, -hole.rows / 2);
        rig.key.position.set(hole.cols / 2 - 3, 7, -hole.rows / 2 + 4);
        rig.key.target.updateMatrixWorld();
      }
      const fit = fitCamera(holeFramePoints(hole), camera.aspect);
      const cam = camRef.current;
      cam.fitTarget.copy(fit.target);
      cam.fitDist = fit.dist;
      const rm = reducedMotionRef.current;
      if (intro && !rm) {
        // Start over the cup, close, and pull back to the whole hole.
        cam.target.copy(toWorld(hole.cup.x, hole.cup.y, feltHeight(hole, hole.cup.x, hole.cup.y)));
        cam.dist = fit.dist * 0.42;
        phaseRef.current = 'intro';
      } else {
        cam.target.copy(fit.target);
        cam.dist = fit.dist;
        phaseRef.current = 'aim';
      }
      introStartRef.current = performance.now();
      if (intro) {
        pushCallout(`Hole ${i + 1}`, 'neutral', { detail: `${hole.name}, par ${hole.par}`, duration: 1300, y: 40 });
      }
      prevBallRef.current = null;
      resetSpriteParticles(confettiRef.current);
      resetSpriteParticles(dustRef.current);
      const ball = ballRef.current;
      if (ball) {
        ball.visible = true;
        ball.scale.set(1, 1, 1);
      }
    },
    [fitCamera, holeFramePoints, pushCallout],
  );

  // ── Ball end-of-putt handling ──
  const finishHole = useCallback(
    (holed: boolean) => {
      const i = holeIndexRef.current;
      const hole = holeRef.current;
      const strokes = strokesRef.current;
      const score = holed ? strokes : MG_PICKUP_SCORE;
      scoresRef.current = [...scoresRef.current.slice(0, i), score];
      setScores(scoresRef.current);
      const name = scoreName(strokes, hole.par, holed);
      setAnnouncement(`Hole ${i + 1}. ${name}. ${score} strokes.`);
      if (modeRef.current === 'counted') {
        if (i >= MG_HOLES - 1) setSaving(true);
        postPuttsRef.current(i, puttsRef.current[i] ?? [], true, score);
      }
      const wait = holed ? HOLED_TO_CARD_MS : PICKUP_TO_CARD_MS;
      window.setTimeout(() => {
        if (gameStateRef.current !== 'playing' || holeIndexRef.current !== i) return;
        if (i >= MG_HOLES - 1) {
          gameStateRef.current = 'gameover';
          setGameState('gameover');
          const total = scoresRef.current.reduce((a, b) => a + b, 0);
          SoundManager.play(total <= courseRef.current.par ? SFX.best : SFX.over);
        } else {
          gameStateRef.current = 'card';
          setGameState('card');
        }
      }, reducedMotionRef.current ? 600 : wait);
    },
    [],
  );

  const onHoled = useCallback(
    (at: THREE.Vector3, now: number) => {
      const hole = holeRef.current;
      const strokes = strokesRef.current;
      const d = strokes - hole.par;
      const rm = reducedMotionRef.current;
      phaseRef.current = 'holed';
      dropRef.current = { start: now, from: at.clone() };
      flagRef.current.pop = now;
      SoundManager.play(SFX.cup, { volume: 1.1 });
      // The chime climbs with how good the hole was.
      const step = strokes === 1 ? 12 : d <= -1 ? 7 : d === 0 ? 4 : 0;
      if (d <= 0 || strokes === 1) {
        window.setTimeout(() => SoundManager.play(SFX.chime, { pitch: semitonesToPitch(step) }), 120);
        window.setTimeout(() => SoundManager.play(SFX.chime, { pitch: semitonesToPitch(step + 7) }), 230);
      }
      if (strokes === 1) {
        window.setTimeout(() => SoundManager.play(SFX.best), 320);
        trigger('jackpot', { sound: false, hitStop: true });
        playHaptic('win');
      } else {
        playHaptic(d <= 0 ? 'success' : 'tick');
      }
      const tone: ArcadeGameplayCalloutTone = strokes === 1 || d < 0 ? 'combo' : d === 0 ? 'score' : 'neutral';
      pushCallout(scoreName(strokes, hole.par, true), tone, { duration: strokes === 1 ? 1400 : 1100 });
      if (!rm) {
        const cupW = toWorld(hole.cup.x, hole.cup.y, holeSceneRef.current?.cupH ?? 0);
        emitSpriteParticles(confettiRef.current, midwayParticleCount(strokes === 1 ? 28 : d <= 0 ? 18 : 8, qualityRef.current?.tier() ?? 'medium'), {
          origin: [cupW.x, cupW.y + 0.05, cupW.z],
          spread: 0.1,
          speed: [0.5, 1.6],
          up: [1.6, 3.2],
          ttl: [0.7, 1.2],
          size: [0.7, 1.3],
          grow: 0,
          fade: 1,
          spin: 9,
        });
      }
      finishHole(true);
    },
    [finishHole, pushCallout, trigger],
  );

  const onRest = useCallback(() => {
    const strokes = strokesRef.current;
    if (strokes >= MG_MAX_STROKES) {
      phaseRef.current = 'pickup';
      SoundManager.play(SFX.pickup);
      playHaptic('failure');
      pushCallout('Picked up', 'neutral');
      finishHole(false);
      return;
    }
    phaseRef.current = 'aim';
    phaseAtRef.current = performance.now();
    const hole = holeRef.current;
    const b = ballPosRef.current;
    kbRef.current = { angle: Math.atan2(hole.cup.y - b.y, hole.cup.x - b.x), share: 0.3, until: 0 };
  }, [finishHole, pushCallout]);

  // ── The putt: the one scored action ──
  const putt = useCallback(
    (dirX: number, dirY: number, share: number) => {
      if (gameStateRef.current !== 'playing' || phaseRef.current !== 'aim') return;
      const hole = holeRef.current;
      // The engine needs MG_MIN_AIM_MS between a ball stopping and the next
      // putt; a quicker flick is stamped at that moment, which the server
      // takes as it is.
      const t = Math.max(Math.round(holeClockRef.current), Math.ceil(readyAtRef.current));
      const q = mgQuantizePutt({ t, dx: dirX, dy: dirY, power: shareToPower(share) });
      const from = ballPosRef.current;
      const play = createMgPlayback(hole, from, q.dx, q.dy, q.power, q.t);
      if (!play) return;
      puttsRef.current[holeIndexRef.current].push(q);
      strokesRef.current += 1;
      // Saved as it is struck, so a reload can't take a putt back. The
      // stroke that ends the hole is saved as the hole, after it ends.
      const hi = holeIndexRef.current;
      const result = mgReplayHole(hole, puttsRef.current[hi]);
      if (modeRef.current === 'counted' && result.stop === 'bounds') {
        // Can't happen with the stamp above; if it did, stop saving rather
        // than play on against a round the server would refuse.
        roundBrokenRef.current = true;
        setSaveError('This round could not be saved.');
      }
      if (modeRef.current === 'counted' && result.stop === 'short') {
        postPuttsRef.current(hi, [...puttsRef.current[hi]], false, null);
      }
      setStrokesShown(strokesRef.current);
      playRef.current = play;
      phaseRef.current = 'roll';
      nearCupRef.current = false;
      const track = mgSpeedTrack(hole, from, q.dx, q.dy, q.power, q.t);
      stopRollRef.current();
      stopRollRef.current = SoundManager.playRoll(track.speeds, track.seconds, { volume: 0.8 });
      SoundManager.play(SFX.putt, { volume: 0.55 + q.power * 0.6, pitch: 0.9 + q.power * 0.25 });
      playHaptic('tap');
      const now = performance.now() - frozenTotalRef.current;
      squashRef.current = { start: now, force: 0.25 + q.power * 0.5 };
      if (!reducedMotionRef.current) {
        const p = toWorld(from.x, from.y, feltHeight(hole, from.x, from.y));
        emitSpriteParticles(dustRef.current, midwayParticleCount(3, qualityRef.current?.tier() ?? 'medium'), {
          origin: [p.x - q.dx * 0.06, p.y + 0.01, p.z + q.dy * 0.06],
          spread: 0.06,
          speed: [0.1, 0.35],
          up: [0.05, 0.25],
          ttl: [0.25, 0.4],
          size: [0.6, 1],
          grow: 1.6,
          fade: 0.35,
          spin: 1,
        });
      }
    },
    [],
  );

  // ── Per-frame ──
  const renderScene = useCallback(
    (frame?: GameFrameInfo) => {
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      const hs = holeSceneRef.current;
      if (!renderer || !scene || !camera) return;
      const wall = frame?.nowMs ?? performance.now();
      const rawMs = frame ? frame.deltaMs : wall - (lastWallRef.current || wall);
      lastWallRef.current = wall;
      const frozen = rawMs > 0 ? hitStopClock.frozenWithin(wall - rawMs, wall) : 0;
      frozenTotalRef.current += frozen;
      const effMs = Math.min(250, Math.max(0, rawMs - frozen));
      const now = wall - frozenTotalRef.current;
      const dt = Math.min(0.05, Math.max(0.001, rawMs / 1000));
      const rm = reducedMotionRef.current;
      const hole = holeRef.current;
      const phase = phaseRef.current;
      const playing = gameStateRef.current === 'playing';
      const ball = ballRef.current;
      const spin = ballSpinRef.current;
      const cam = camRef.current;

      // The hole clock: the windmill's time. It runs with the ball, so a
      // stalled tab can't put the sails out of step with the sim.
      if (playing || gameStateRef.current === 'idle') holeClockRef.current += effMs;

      // ── The ball ──
      const ballW = TMP2;
      let ballH = 0;
      const play = playRef.current;
      if (ball && play && phase === 'roll') {
        const events = play.advance(effMs);
        const s = sampleRef.current;
        play.sample(s);
        if (s.mode === 'loop' && hs) {
          const rigLoop = hs.loops[s.loop];
          if (rigLoop) loopPoint(rigLoop.loop, rigLoop.base, s.s, ballW);
        } else {
          const fh = feltHeight(hole, s.x, s.y);
          ballH = fh;
          ballW.copy(toWorld(s.x, s.y, fh + MG_BALL_R));
        }
        for (const e of events) handleEvent(e, now);
        const b = play.ball;
        if (b.mode === 'rest') {
          ballPosRef.current = { x: b.x, y: b.y };
          readyAtRef.current = b.t0 + b.steps * MG_STEP_MS + MG_MIN_AIM_MS;
          playRef.current = null;
          onRest();
        } else if (b.mode === 'holed') {
          ballPosRef.current = { x: hole.cup.x, y: hole.cup.y };
          playRef.current = null;
          onHoled(ballW.clone(), now);
        }
      } else {
        const p = ballPosRef.current;
        const fh = feltHeight(hole, p.x, p.y);
        ballH = fh;
        ballW.copy(toWorld(p.x, p.y, fh + MG_BALL_R));
      }

      // Drop into the cup: to the centre, then down out of sight.
      const drop = dropRef.current;
      if (drop && ball) {
        const age = (now - drop.start) / (rm ? 1 : 1);
        const cupW = toWorld(hole.cup.x, hole.cup.y, (hs?.cupH ?? 0) + MG_BALL_R);
        const k1 = Math.min(1, age / 110);
        ballW.copy(drop.from).lerp(cupW, settleEase(k1));
        const k2 = Math.max(0, Math.min(1, (age - 80) / 200));
        ballW.y -= k2 * k2 * 0.14;
        ball.visible = age < 300;
      }

      // A lip-out hop.
      const hop = hopRef.current;
      if (hop && !rm) {
        const age = (now - hop.start) / 260;
        if (age < 1) ballW.y += hop.height * 4 * age * (1 - age);
        else hopRef.current = null;
      }

      if (ball) {
        ball.position.copy(ballW);
        // Rolling spin: about (up x travel), by distance over radius.
        const prev = prevBallRef.current;
        if (prev && spin) {
          const dx = ballW.x - prev.x;
          const dz = ballW.z - prev.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist > 1e-5 && dist < 0.5) {
            SPIN_AXIS.set(dz, 0, -dx).normalize();
            spin.rotateOnWorldAxis(SPIN_AXIS, dist / MG_BALL_R);
          }
          prev.copy(ballW);
        } else {
          prevBallRef.current = ballW.clone();
        }
        const sq = squashRef.current;
        const sc = sq ? squashAt(now - sq.start, { force: sq.force, reduced: rm }) : { scaleX: 1, scaleY: 1 };
        ball.scale.set(sc.scaleX, sc.scaleY, sc.scaleX);
        if (sq && now - sq.start > 400) squashRef.current = null;
      }

      // Contact shadow on the felt under the ball.
      const shadow = shadowRef.current;
      if (shadow && ball) {
        const surface = phase === 'roll' && sampleRef.current.mode === 'loop' && hs
          ? (hs.loops[sampleRef.current.loop]?.base ?? 0)
          : ballH;
        const height = Math.max(0, ballW.y - MG_BALL_R - surface);
        const size = MG_BALL_R * 2.3 * (1 + height * 1.5);
        shadow.visible = ball.visible;
        shadow.position.set(ballW.x, surface + 0.004, ballW.z);
        shadow.scale.set(size, size, 1);
        (shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.12, 0.5 - height * 0.9);
      }

      // ── Aim: dots, the arrowhead and the pace ring ──
      const dots = dotsRef.current;
      const ring = ringRef.current;
      const track = ringTrackRef.current;
      const arrow = arrowRef.current;
      const drag = dragRef.current;
      const kbLive = !drag && performance.now() < kbRef.current.until;
      const aiming = playing && phase === 'aim';
      let share = 0;
      let dirX = 0;
      let dirY = 0;
      let tipShown = false;
      if (aiming && drag && drag.live) {
        share = drag.share;
        dirX = drag.dx;
        dirY = drag.dy;
      } else if (aiming && kbLive) {
        share = kbRef.current.share;
        dirX = Math.cos(kbRef.current.angle);
        dirY = Math.sin(kbRef.current.angle);
      }
      if (share > 0) paceColor(share, COLOR);
      if (dots && ring && track && arrow) {
        if (share > 0) {
          const from = ballPosRef.current;
          // The line grows with the pull, so its length reads as the pace.
          const path = mgAimPath(hole, from, dirX, dirY, 0.4 + share * 2.6);
          (dots.material as THREE.MeshBasicMaterial).color.copy(COLOR);
          (ring.material as THREE.MeshBasicMaterial).color.copy(COLOR);
          const spacing = 0.1;
          const march = rm ? 0 : ((now / 1000) * 0.32) % spacing;
          let n = 0;
          let carried = spacing * 1.8 + march;
          for (let leg = 0; leg + 1 < path.points.length && n < 48; leg += 1) {
            const a = path.points[leg];
            const b = path.points[leg + 1];
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            // Stop short of the end of the last leg: the arrowhead sits there.
            const stop = leg + 2 === path.points.length ? len - 0.07 : len;
            let d = carried;
            while (d < stop && n < 48) {
              const x = a.x + ((b.x - a.x) * d) / len;
              const y = a.y + ((b.y - a.y) * d) / len;
              const sc = leg === 1 ? 0.75 : 1;
              AIM_M.compose(toWorld(x, y, feltHeight(hole, x, y) + 0.012, TMP), AIM_FLAT, AIM_S.set(sc, sc, sc));
              dots.setMatrixAt(n, AIM_M);
              n += 1;
              d += spacing;
            }
            carried = d - len;
          }
          dots.count = n;
          dots.instanceMatrix.needsUpdate = true;
          // The arrowhead, along the last leg.
          const pa = path.points[path.points.length - 2];
          const pb = path.points[path.points.length - 1];
          const ll = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
          const ux = (pb.x - pa.x) / ll;
          const uy = (pb.y - pa.y) / ll;
          const tx = pb.x - ux * 0.06;
          const ty = pb.y - uy * 0.06;
          arrow.position.copy(toWorld(tx, ty, feltHeight(hole, tx, ty) + 0.013, TMP));
          arrow.quaternion.copy(AIM_TURN.setFromAxisAngle(Y_AXIS, Math.atan2(-ux, uy))).multiply(AIM_FLAT);
          const as = path.points.length > 2 ? 0.8 : 1;
          arrow.scale.set(as, as, as);
          arrow.visible = true;
          AIM_TIP.copy(arrow.position);
          tipShown = true;
          ring.visible = true;
          track.visible = true;
          const fh = feltHeight(hole, from.x, from.y) + 0.008;
          ring.position.copy(toWorld(from.x, from.y, fh));
          track.position.copy(ring.position);
          const segs = Math.max(1, Math.round(64 * share));
          ring.geometry.setDrawRange(0, segs * 6);
        } else {
          dots.count = 0;
          arrow.visible = false;
          ring.visible = false;
          track.visible = false;
        }
      }

      // ── Windmill sails: from the hole clock, or the sim's own time in a putt ──
      if (hs) {
        const t = play && phase === 'roll' ? play.time() : holeClockRef.current;
        for (const rigMill of hs.mills) {
          rigMill.sails.rotation.z = -mgMillTurn(rigMill.mill, t) * Math.PI * 2;
        }
      }

      // ── The flag: lifted as the ball comes near, popped on a hole-in ──
      if (hs) {
        const f = flagRef.current;
        const b = ballPosRef.current;
        const s = sampleRef.current;
        const near =
          phase === 'roll'
            ? Math.hypot(s.x - hole.cup.x, s.y - hole.cup.y) < 1.1
            : phase === 'holed' || Math.hypot(b.x - hole.cup.x, b.y - hole.cup.y) < 0.6;
        const target = near ? 0.32 : 0;
        f.lift = rm ? target : expDamp(f.lift, target, 7, dt);
        let pop = 0;
        const popAge = now - f.pop;
        if (popAge >= 0 && popAge < 1200) {
          pop = rm ? 0.25 : 0.25 * springEase(Math.min(1, popAge / 420));
          f.spin += rm ? 0 : dt * 9 * Math.max(0, 1 - popAge / 1200);
        }
        hs.flag.position.y = hs.cupH - 0.1 + f.lift + pop;
        hs.flag.rotation.y = f.spin;
      }

      // ── Camera ──
      if (phase === 'intro' && playing) {
        const k = Math.min(1, (performance.now() - introStartRef.current) / INTRO_MS);
        const e = settleEase(k);
        const cupW = toWorld(hole.cup.x, hole.cup.y, feltHeight(hole, hole.cup.x, hole.cup.y));
        cam.target.copy(cupW).lerp(cam.fitTarget, e);
        cam.dist = cam.fitDist * (0.42 + 0.58 * e);
        if (k >= 1) phaseRef.current = 'aim';
      } else if (!rm) {
        let tx = cam.fitTarget.x;
        let ty = cam.fitTarget.y;
        let tz = cam.fitTarget.z;
        let td = cam.fitDist;
        if (phase === 'roll' || phase === 'holed') {
          // Lean toward the ball, a little closer, without losing the hole.
          tx = cam.fitTarget.x + (ballW.x - cam.fitTarget.x) * 0.45;
          ty = cam.fitTarget.y + (ballW.y - cam.fitTarget.y) * 0.3;
          tz = cam.fitTarget.z + (ballW.z - cam.fitTarget.z) * 0.45;
          td = cam.fitDist * 0.84;
        }
        const rate = phase === 'roll' ? 2.4 : 1.8;
        cam.target.set(expDamp(cam.target.x, tx, rate, dt), expDamp(cam.target.y, ty, rate, dt), expDamp(cam.target.z, tz, rate, dt));
        cam.dist = expDamp(cam.dist, td, rate, dt);
      } else {
        cam.target.copy(cam.fitTarget);
        cam.dist = cam.fitDist;
      }
      const shake = shakeOffset(wall);
      camera.position.copy(cam.target).addScaledVector(CAM_DIR, cam.dist);
      camera.position.x += shake.x * SHAKE_UNITS_PER_PX;
      camera.position.y -= shake.y * SHAKE_UNITS_PER_PX;
      camera.lookAt(cam.target);

      // ── The pull on the glass, and the pace by the arrowhead ──
      const svg = pullSvgRef.current;
      const line = pullLineRef.current;
      const anchor = pullAnchorRef.current;
      const tag = paceTagRef.current;
      const glass = canvasRef.current;
      if (svg && line && anchor && tag && glass) {
        const rect = glass.getBoundingClientRect();
        const pulling = aiming && drag !== null && drag.armed;
        if (pulling && drag) {
          const ax = drag.sx - rect.left;
          const ay = drag.sy - rect.top;
          line.setAttribute('x1', ax.toFixed(1));
          line.setAttribute('y1', ay.toFixed(1));
          line.setAttribute('x2', (drag.x - rect.left).toFixed(1));
          line.setAttribute('y2', (drag.y - rect.top).toFixed(1));
          anchor.setAttribute('cx', ax.toFixed(1));
          anchor.setAttribute('cy', ay.toFixed(1));
          svg.dataset.live = drag.live ? 'true' : 'false';
          if (drag.live) svg.style.setProperty('--mg-pace', `#${COLOR.getHexString(THREE.SRGBColorSpace)}`);
        }
        svg.style.opacity = pulling ? '1' : '0';
        if (tipShown && share > 0) {
          TMP.copy(AIM_TIP).project(camera);
          const px = ((TMP.x + 1) / 2) * rect.width;
          const py = ((1 - TMP.y) / 2) * rect.height;
          const label = share >= 1 ? 'Full' : `${Math.round(share * 100)}%`;
          if (tag.textContent !== label) tag.textContent = label;
          tag.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, -165%)`;
          tag.style.setProperty('--mg-pace', `#${COLOR.getHexString(THREE.SRGBColorSpace)}`);
          tag.dataset.state = share >= 1 ? 'full' : 'pace';
          tag.style.opacity = '1';
        } else if (pulling && drag && !drag.live) {
          // Pulled back inside the dead zone: letting go now is no putt.
          if (tag.textContent !== 'Let go to cancel') tag.textContent = 'Let go to cancel';
          tag.style.transform = `translate(${(drag.sx - rect.left).toFixed(1)}px, ${(drag.sy - rect.top).toFixed(1)}px) translate(-50%, -190%)`;
          tag.dataset.state = 'cancel';
          tag.style.opacity = '1';
        } else {
          tag.style.opacity = '0';
        }
      }

      stepSpriteParticles(confettiRef.current, dt, 4.2, 1.2);
      stepSpriteParticles(dustRef.current, dt, 0.4, 2);

      const canvasEl = canvasRef.current;
      const label = playing ? phaseRef.current : gameStateRef.current;
      if (canvasEl && canvasEl.dataset.mgPhase !== label) canvasEl.dataset.mgPhase = label;
      renderer.render(scene, camera);
    },
    // handleEvent is stable (declared below with refs only).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hitStopClock, onHoled, onRest, shakeOffset],
  );
  renderRef.current = renderScene;

  /** Sound, haptics and motion for what the engine reported this frame. */
  function handleEvent(e: MgEvent, now: number) {
    const rm = reducedMotionRef.current;
    // Thresholds below are in real-ball m/s; the engine runs at game pace.
    const speed = 'speed' in e ? e.speed / MG_PACE : 0;
    switch (e.kind) {
      case 'rail': {
        SoundManager.play(SFX.rail, { volume: Math.min(1.3, 0.25 + speed / 2.2) });
        if (speed > 1.2) playHaptic('light');
        if (speed > 2.4) trigger('impact', { sound: false, shake: Math.min(1, (speed - 2.4) / 2) * 0.5 });
        if (!rm && speed > 0.8) {
          const p = toWorld(e.x, e.y, feltHeight(holeRef.current, e.x, e.y) + 0.04);
          emitSpriteParticles(dustRef.current, midwayParticleCount(2, qualityRef.current?.tier() ?? 'medium'), {
            origin: [p.x, p.y, p.z],
            spread: 0.04,
            speed: [0.1, 0.3],
            up: [0.05, 0.2],
            ttl: [0.2, 0.35],
            size: [0.5, 0.8],
            grow: 1.4,
            fade: 0.3,
          });
        }
        break;
      }
      case 'post':
        SoundManager.play(SFX.post, { volume: Math.min(1.2, 0.3 + speed / 2.5) });
        if (speed > 1) playHaptic('light');
        break;
      case 'blade':
      case 'mill':
        SoundManager.play(SFX.rail, { volume: Math.min(1.3, 0.4 + speed / 2) });
        playHaptic('light');
        if (e.kind === 'blade') trigger('impact', { sound: false, shake: 0.3 });
        break;
      case 'loopIn':
        SoundManager.play(SFX.whoosh, { volume: 0.8, pitch: 0.8 + Math.min(0.5, speed / 10) });
        break;
      case 'loopOut':
        if (e.made) SoundManager.play(SFX.chime, { pitch: semitonesToPitch(2), volume: 0.6 });
        else {
          SoundManager.play(SFX.rail, { volume: 0.8 });
          playHaptic('failure');
        }
        break;
      case 'lip':
        SoundManager.play(SFX.lip, { volume: 0.6 + e.drop * 0.7 });
        playHaptic('failure');
        hopRef.current = { start: now, height: 0.015 + e.drop * 0.035 };
        break;
      default:
        break;
    }
  }

  // ── The server's round ──
  const loadRound = useCallback(async (): Promise<{ signed: boolean; round: ServerRound | null }> => {
    try {
      const res = await fetch('/api/games/mini-golf/round', { cache: 'no-store' });
      if (res.status === 401) {
        setAccount('guest');
        return { signed: false, round: null };
      }
      if (!res.ok) return { signed: true, round: null };
      const data = (await res.json()) as { round: ServerRound | null };
      setAccount('signed');
      setServerRound(data.round);
      return { signed: true, round: data.round };
    } catch {
      return { signed: false, round: null };
    }
  }, []);

  const loadFriends = useCallback(async () => {
    try {
      const res = await fetch('/api/games/mini-golf/friends', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { friends?: FriendRound[] };
      if (Array.isArray(data.friends)) setFriends(data.friends);
    } catch {
      /* the card works without them */
    }
  }, []);

  /** Post one hole's putts so far. Queued, so posts land in order; a
   *  network error retries, a rejection stops saving this round. */
  const postPutts = useCallback(
    (holeIdx: number, putts: MgPutt[], done: boolean, score: number | null) => {
      const roundId = roundIdRef.current;
      if (!roundId || roundBrokenRef.current) return;
      const last = done && holeIdx >= MG_HOLES - 1;
      const send = async () => {
        if (roundBrokenRef.current) return;
        for (let attempt = 0; attempt < 5; attempt += 1) {
          try {
            const res = await fetch('/api/games/mini-golf/hole', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                roundId,
                hole: holeIdx,
                putts,
                done,
                score,
                env: last ? envMonitorRef.current.getFingerprint() : undefined,
              }),
            });
            const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
            if (res.status === 429) {
              const wait = Number(data?.retryAfterSec ?? 1) * 1000;
              await new Promise((r) => window.setTimeout(r, Math.min(5000, wait)));
              continue;
            }
            if (res.ok || res.status === 502) {
              if (last) {
                captureRunResult(data);
                if (data?.isNewBest === true) {
                  setNewBest(true);
                  pushCalloutRef.current('New best', 'best', { duration: 1600 });
                }
                if (res.status === 502) setSaveError(String(data?.error ?? 'Your round is saved. The tickets could not be paid yet.'));
                setSaving(false);
                envMonitorRef.current.stop();
                void loadRound();
                void loadFriends();
              }
              return;
            }
            roundBrokenRef.current = true;
            setSaveError(
              typeof data?.error === 'string' && data.error.trim()
                ? `This round could not be saved. ${data.error}`
                : 'This round could not be saved.',
            );
            setSaving(false);
            return;
          } catch {
            await new Promise((r) => window.setTimeout(r, 500 * 2 ** attempt));
          }
        }
        setSaveError('Could not reach the server. Your putts are kept, so reload to try again.');
        setSaving(false);
      };
      postChainRef.current = postChainRef.current.then(send, send);
    },
    [captureRunResult, loadFriends, loadRound],
  );
  const postPuttsRef = useRef(postPutts);
  const pushCalloutRef = useRef(pushCallout);
  pushCalloutRef.current = pushCallout;
  postPuttsRef.current = postPutts;

  useEffect(() => {
    void loadRound();
  }, [loadRound]);

  // The equipped skin and the wallet. Guests get the house look.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/store/inventory?gameType=mini-golf', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as MgInventory;
        if (cancelled) return;
        setSkinLook(miniGolfLookFrom(data));
      } catch {
        /* the house look */
      }
    };
    void load();
    const onUpdate = () => void load();
    window.addEventListener('store-inventory-updated', onUpdate);
    return () => {
      cancelled = true;
      window.removeEventListener('store-inventory-updated', onUpdate);
    };
  }, []);

  useEffect(() => {
    skinLookRef.current = skinLook;
    if (deferredStartedRef.current) applySkin(skinLook);
    SoundManager.setTint(skinLook.skin?.sound ?? 'house');
  }, [applySkin, skinLook]);
  useEffect(() => () => SoundManager.setTint('house'), []);

  // ── Run control ──
  /** Begin playing at hole i with these scores and the hole's putts so far
   *  (a resumed round puts the ball back where it stopped). */
  const beginAt = useCallback(
    (i: number, scores: number[], current: MgPutt[]) => {
      scoresRef.current = scores;
      setScores(scores);
      puttsRef.current = [];
      gameStateRef.current = 'playing';
      setGameState('playing');
      loadHole(i, true);
      if (current.length) {
        const hole = courseRef.current.holes[i].hole;
        const replay = mgReplayHole(hole, current);
        const lastPutt = current[current.length - 1];
        const rest = replay.rests[replay.rests.length - 1] ?? hole.tee;
        const from = replay.rests.length > 1 ? replay.rests[replay.rests.length - 2] : hole.tee;
        const roll = mgSimulatePutt(hole, from, lastPutt.dx, lastPutt.dy, lastPutt.power, lastPutt.t);
        puttsRef.current[i] = [...current];
        strokesRef.current = current.length;
        setStrokesShown(current.length);
        ballPosRef.current = { x: rest.x, y: rest.y };
        holeClockRef.current = lastPutt.t + (roll?.durationMs ?? 0) + MG_MIN_AIM_MS;
        readyAtRef.current = holeClockRef.current;
      }
      frameLoopRef.current?.start();
    },
    [loadHole],
  );

  const startRound = useCallback(async () => {
    if (!rendererRef.current) return;
    resetRunResult();
    setNewBest(false);
    setSaveError(null);
    setStartError(null);
    setFriends([]);
    roundBrokenRef.current = false;
    roundIdRef.current = null;
    let round = serverRound;
    let signedIn = account === 'signed';
    if (account === 'loading') {
      const loaded = await loadRound();
      signedIn = loaded.signed;
      round = loaded.round;
    }
    // A QA course (?mgTemplates=) isn't the day's course: play it locally.
    const qaOverride = new URLSearchParams(window.location.search).has('mgTemplates');
    if (!signedIn || qaOverride) {
      modeRef.current = 'guest';
      setMode('guest');
      beginAt(0, [], []);
      return;
    }
    if (round?.finished) {
      modeRef.current = 'practice';
      setMode('practice');
      void loadFriends();
      beginAt(0, [], []);
      return;
    }
    setStarting(true);
    try {
      const res = await fetch('/api/games/mini-golf/round', { method: 'POST' });
      const data = (await res.json().catch(() => null)) as { round?: ServerRound; error?: string } | null;
      if (res.status === 401) {
        setAccount('guest');
        modeRef.current = 'guest';
        setMode('guest');
        beginAt(0, [], []);
        return;
      }
      if (!res.ok || !data?.round) {
        setStartError(data?.error ?? 'Could not start your round. Try again.');
        gameStateRef.current = 'error';
        setGameState('error');
        return;
      }
      round = data.round;
      setServerRound(round);
      if (round.finished) {
        modeRef.current = 'practice';
        setMode('practice');
        beginAt(0, [], []);
        return;
      }
      if (round.dateKey !== courseRef.current.dateKey) {
        const next = mgCourseFor(round.dateKey);
        courseRef.current = next;
        setCourse(next);
      }
      roundIdRef.current = round.id;
      modeRef.current = 'counted';
      setMode('counted');
      envMonitorRef.current.start();
      beginAt(round.holesDone, round.holes.map((h) => h.score), round.current ?? []);
    } catch {
      setStartError('Could not start your round. Try again.');
      gameStateRef.current = 'error';
      setGameState('error');
    } finally {
      setStarting(false);
    }
  }, [account, beginAt, loadFriends, loadRound, resetRunResult, serverRound]);

  const nextHole = useCallback(() => {
    if (gameStateRef.current !== 'card') return;
    const next = holeIndexRef.current + 1;
    gameStateRef.current = 'playing';
    setGameState('playing');
    loadHole(next, true);
    frameLoopRef.current?.start();
    trigger('press', { haptic: true });
  }, [loadHole, trigger]);

  // ── Input ──
  /** A screen point to the course plane at the ball's height. */
  const screenToCourse = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const camera = cameraRef.current;
    const canvas = canvasRef.current;
    if (!camera || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const b = ballPosRef.current;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(feltHeight(holeRef.current, b.x, b.y) + MG_BALL_R));
    const hit = ray.ray.intersectPlane(plane, new THREE.Vector3());
    return hit ? { x: hit.x, y: -hit.z } : null;
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      if (gameStateRef.current === 'card') {
        nextHole();
        return;
      }
      if (gameStateRef.current !== 'playing') return;
      if (phaseRef.current === 'intro') {
        // A tap skips the fly-in.
        introStartRef.current = -1e9;
        return;
      }
      if (phaseRef.current !== 'aim') return;
      trigger('press', { haptic: true });
      dragRef.current = {
        id: e.pointerId,
        sx: e.clientX,
        sy: e.clientY,
        x: e.clientX,
        y: e.clientY,
        pull: fullPullPx(e.clientY),
        share: 0,
        dx: 0,
        dy: 1,
        live: false,
        armed: false,
      };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [nextHole, trigger],
  );

  const updateDrag = useCallback(
    (clientX: number, clientY: number) => {
      const drag = dragRef.current;
      if (!drag) return;
      drag.x = clientX;
      drag.y = clientY;
      let px = Math.hypot(clientX - drag.sx, clientY - drag.sy);
      if (px < DEAD_PX) {
        drag.live = false;
        drag.share = 0;
        return;
      }
      // Past full power the anchor follows on a leash, so easing back or
      // turning the line answers at once.
      const reach = drag.pull + DEAD_PX * 0.5;
      if (px > reach) {
        const k = (px - reach) / px;
        drag.sx += (clientX - drag.sx) * k;
        drag.sy += (clientY - drag.sy) * k;
        px = reach;
      }
      const a = screenToCourse(drag.sx, drag.sy);
      const b = screenToCourse(clientX, clientY);
      if (!a || !b) return;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) return;
      drag.dx = dx / len;
      drag.dy = dy / len;
      const share = Math.min(1, (px - DEAD_PX * 0.5) / drag.pull);
      drag.share = share >= FULL_SNAP ? 1 : share;
      drag.live = true;
      drag.armed = true;
    },
    [screenToCourse],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.id !== e.pointerId) return;
      e.preventDefault();
      updateDrag(e.clientX, e.clientY);
    },
    [updateDrag],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.id !== e.pointerId) return;
      e.preventDefault();
      updateDrag(e.clientX, e.clientY);
      dragRef.current = null;
      if (!drag.live || drag.share <= 0) return;
      putt(drag.dx, drag.dy, drag.share);
    },
    [putt, updateDrag],
  );

  const handlePointerCancel = useCallback((e: React.PointerEvent) => {
    if (dragRef.current?.id === e.pointerId) dragRef.current = null;
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (isControlTarget(e.target) || isDialogOpen()) return;
      if (gameStateRef.current === 'card' && (e.code === 'Space' || e.code === 'Enter')) {
        e.preventDefault();
        if (!e.repeat) nextHole();
        return;
      }
      if (gameStateRef.current !== 'playing' || phaseRef.current !== 'aim') return;
      const kb = kbRef.current;
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault();
        kb.angle += e.code === 'ArrowLeft' ? KB_TURN : -KB_TURN;
      } else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        e.preventDefault();
        kb.share = Math.min(1, Math.max(0.04, kb.share + (e.code === 'ArrowUp' ? KB_POWER : -KB_POWER)));
      } else if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) {
        e.preventDefault();
        trigger('press', { haptic: true });
        putt(Math.cos(kb.angle), Math.sin(kb.angle), kb.share);
        kb.until = 0;
        return;
      } else return;
      kb.until = performance.now() + 2400;
    },
    [nextHole, putt, trigger],
  );

  // ── Effects ──
  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  const fitCanvas = useCallback(({ width, height }: GameStageSize) => {
    setCanvasSize((prev) =>
      prev && prev.width === Math.floor(width) && prev.height === Math.floor(height)
        ? prev
        : { width: Math.floor(width), height: Math.floor(height) },
    );
  }, []);

  useEffect(() => {
    if (!canvasSize) return;
    buildScene(canvasSize.width, canvasSize.height);
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!renderer || !camera) return;
    renderer.setSize(canvasSize.width, canvasSize.height, false);
    camera.aspect = canvasSize.width / Math.max(1, canvasSize.height);
    camera.updateProjectionMatrix();
    if (!holeSceneRef.current) loadHole(holeIndexRef.current, false);
    else {
      const fit = fitCamera(holeFramePoints(holeRef.current), camera.aspect);
      camRef.current.fitTarget.copy(fit.target);
      camRef.current.fitDist = fit.dist;
    }
    renderScene();
    if (!deferredStartedRef.current) {
      deferredStartedRef.current = true;
      markMidwayFirstFrame('mini-golf', qualityRef.current?.tier() ?? 'medium');
      setSceneReady(true);
      deferredRef.current?.start(() => {
        if (gameStateRef.current !== 'playing') renderRef.current();
      });
      // The first hole's windmill turns on the idle frame too.
      frameLoopRef.current?.start();
    }
  }, [buildScene, canvasSize, fitCamera, holeFramePoints, loadHole, renderScene]);

  useEffect(() => {
    const loop = createGameFrameLoop({
      simulate: () => {},
      render: (_alpha, frame) => {
        const live = gameStateRef.current === 'playing' && (phaseRef.current === 'aim' || phaseRef.current === 'intro');
        qualityRef.current?.hold(live && dragRef.current !== null);
        qualityRef.current?.frame(frame.nowMs, frame.deltaMs);
        renderRef.current(frame);
        const keep =
          gameStateRef.current === 'playing' ||
          (gameStateRef.current === 'idle' && holeRef.current.windmills.length > 0) ||
          (gameStateRef.current === 'card' && performance.now() - phaseAtRef.current < 1600);
        if (!keep) loop.stop();
      },
    });
    frameLoopRef.current = loop;
    return () => {
      loop.destroy();
      if (frameLoopRef.current === loop) frameLoopRef.current = null;
    };
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    return () => {
      stopRollRef.current();
      frameLoopRef.current?.destroy();
      deferredRef.current?.dispose();
      rigRef.current?.dispose();
      qualityRef.current?.dispose();
      if (sceneRef.current) disposeSceneDeep(sceneRef.current);
      handleRef.current?.dispose();
      rendererRef.current = null;
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (gameState === 'card') phaseAtRef.current = performance.now();
  }, [gameState]);

  // QA hook (scripts/qa-mini-golf.mts): development, or ?mgQa=1. It can only
  // do what a player can; the server replays every putt either way.
  useEffect(() => {
    const allowed = process.env.NODE_ENV !== 'production' || new URLSearchParams(window.location.search).has('mgQa');
    if (!allowed) return;
    (window as unknown as { __mgQa?: unknown }).__mgQa = {
      state: () => ({
        game: gameStateRef.current,
        phase: phaseRef.current,
        hole: holeIndexRef.current,
        ball: { ...ballPosRef.current },
        strokes: strokesRef.current,
        clock: holeClockRef.current,
        scores: [...scoresRef.current],
        dateKey,
      }),
      putt: (dx: number, dy: number, share: number) => putt(dx, dy, share),
      next: () => nextHole(),
    };
  }, [dateKey, nextHole, putt]);

  // ── Render ──
  const phase: GamePhase = gameState === 'idle' ? 'ready' : gameState === 'gameover' || gameState === 'error' ? 'over' : 'playing';
  const hole = course.holes[holeIndex]?.hole ?? course.holes[0].hole;
  const totalStrokes = scores.reduce((a, b) => a + b, 0);
  const parSoFar = course.holes.slice(0, scores.length).reduce((a, h) => a + h.hole.par, 0);
  const toPar = totalStrokes - parSoFar;

  const counted = serverRound?.finished ? serverRound : null;
  const rawBalance = (runResult.reward as { balanceAfter?: unknown } | null)?.balanceAfter;
  const balanceAfter = typeof rawBalance === 'number' && Number.isFinite(rawBalance) ? Math.floor(rawBalance) : null;
  const countedToPar = counted ? counted.strokes - counted.par : null;
  const end =
    gameState === 'gameover' ? (
      <ArcadeRunResult
        title={
          mode === 'practice'
            ? 'Practice round'
            : newBest
              ? 'New best'
              : toPar < 0
              ? `${-toPar} under par`
              : toPar === 0
                ? 'Level par'
                : `${toPar} over par`
        }
        tone={mode !== 'practice' && (newBest || toPar <= 0) ? 'best' : 'neutral'}
        stats={[
          { label: 'strokes', value: totalStrokes },
          { label: 'to par', value: toParLabel(toPar), highlight: toPar < 0 },
          { label: 'points', value: mgRoundPointsOf(scores), highlight: newBest },
        ]}
        guest={mode === 'guest'}
        reward={mode === 'practice' ? PRACTICE_REWARD : runResult.reward}
        achievements={mode === 'counted' ? runResult.achievements : []}
        saving={mode === 'counted' && saving}
        error={mode === 'counted' ? saveError : null}
        actions={<ArcadeRematchButton onClick={() => void startRound()} />}
      >
        {mode === 'practice' && counted && countedToPar !== null ? (
          <p className='mg-result-note'>
            Today&apos;s round counted {counted.strokes} strokes, {toParLabel(countedToPar)}.
          </p>
        ) : null}
        <Scorecard course={course} scores={scores} friends={mode === 'guest' ? [] : friends} compact />
      </ArcadeRunResult>
    ) : gameState === 'error' ? (
      <GameStageNotice
        title='Connection lost'
        action={
          <ArcadeButton tone='primary' onClick={() => void startRound()}>
            retry
          </ArcadeButton>
        }
      >
        <p>{startError ?? 'Could not reach the server. Try again.'}</p>
      </GameStageNotice>
    ) : null;

  return (
    <GameShell
      game='mini-golf'
      className='mini-golf-midway'
      tickets={balanceAfter ?? undefined}
      below={
        <div className='flex flex-wrap items-center justify-center gap-2'>
          <GameLeaderboardButton onClick={() => setBoardOpen(true)} />
        </div>
      }
      stat={
        gameState === 'idle' ? (
          <GameStat value={countedToPar === null ? null : toParLabel(countedToPar)} label='today' />
        ) : (
          <GameStat value={`${holeIndex + 1}/${MG_HOLES}`} label='hole' />
        )
      }
      howTo={HOW_TO}
    >
      <GameStage
        phase={phase}
        hint={
          serverRound?.finished
            ? 'Tap for a practice round.'
            : serverRound && serverRound.holesDone > 0
              ? `Tap to resume at hole ${serverRound.holesDone + 1}.`
              : HINT
        }
        busy={starting ? 'Starting your round.' : !sceneReady && !webglError ? 'Loading the course.' : null}
        onStart={() => void startRound()}
        aspect={BASE_WIDTH / BASE_HEIGHT}
        onSize={fitCanvas}
        end={end}
      >
        {webglError ? (
          <MidwayStill
            game='mini-golf'
            alt='A mini golf hole with a red flag in the cup.'
            style={canvasSize ? { width: canvasSize.width, height: canvasSize.height } : undefined}
          />
        ) : (
          <>
            <canvas
              ref={canvasRef}
              aria-label='Mini golf hole. Drag back from anywhere to aim and let go to putt; pull back to where you pressed to cancel; keyboard players aim with the arrow keys and putt with space.'
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              className='block cursor-crosshair'
              style={{ touchAction: 'none', width: canvasSize?.width ?? '100%', height: canvasSize?.height ?? '100%' }}
            />
            <div className='mg-aim' aria-hidden>
              <svg ref={pullSvgRef} className='mg-pull'>
                <line ref={pullLineRef} className='mg-pull-line' />
                <circle ref={pullAnchorRef} className='mg-pull-anchor' r={7} />
              </svg>
              <span ref={paceTagRef} className='mg-pace-tag' />
            </div>
            {gameState === 'playing' || gameState === 'card' ? (
              <div className='mg-hud' aria-hidden>
                <div className='mg-hud-hole'>
                  <span className='mg-hud-num'>{holeIndex + 1}</span>
                  <span className='mg-hud-meta'>
                    <span className='mg-hud-name'>{hole.name}</span>
                    <span className='mg-hud-par'>par {hole.par}{mode === 'practice' ? ', practice' : ''}</span>
                  </span>
                </div>
                <div className='mg-hud-right'>
                  <span className='mg-hud-topar' data-under={toPar < 0 || undefined}>
                    {scores.length ? toParLabel(toPar) : 'E'}
                  </span>
                  <span className='mg-hud-pips'>
                    {Array.from({ length: MG_MAX_STROKES }, (_, i) => (
                      <span key={i} className='mg-hud-pip' data-used={i < strokesShown || undefined} />
                    ))}
                  </span>
                </div>
              </div>
            ) : null}
            {gameState === 'card' ? (
              <button type='button' className='mg-card' onClick={() => nextHole()}>
                <Scorecard course={course} scores={scores} />
                <span className='mg-card-next'>Tap for hole {holeIndex + 2}.</span>
              </button>
            ) : null}
            <ArcadeGameplayCallouts items={callouts} />
            <p className='sr-only' aria-live='polite' aria-atomic='true'>
              {announcement}
            </p>
            <span className='sr-only'>{dateKey}</span>
          </>
        )}
      </GameStage>
      <GameLeaderboardModal
        open={boardOpen}
        onOpenChange={setBoardOpen}
        title='Mini golf board'
        description={boardMode === 'daily' ? "Today's rounds against par." : 'Best rounds, all time.'}
      >
        <GameLeaderboard
          gameType='mini-golf'
          mode={boardMode}
          modes={DAILY_BOARD_MODES}
          onModeChange={(next) => setBoardMode(next as 'daily' | 'alltime')}
          refreshKey={serverRound?.finished ? 1 : 0}
        />
      </GameLeaderboardModal>
    </GameShell>
  );
}

/** The scorecard: nine holes, par, your strokes, the total, and under it
 *  friends' rounds today (at most four rows, the rest counted). */
function Scorecard({
  course,
  scores,
  friends = [],
  compact,
}: {
  course: MgCourse;
  scores: number[];
  friends?: FriendRound[];
  compact?: boolean;
}) {
  const total = scores.reduce((a, b) => a + b, 0);
  const par = course.holes.reduce((a, h) => a + h.hole.par, 0);
  const shown = friends.slice(0, 4);
  const more = friends.length - shown.length;
  const cells = (row: number[]) =>
    course.holes.map((h, i) => {
      const s = row[i];
      const d = s != null ? s - h.hole.par : 0;
      return (
        <td key={i} data-under={(s != null && d < 0) || undefined} data-ace={s === 1 || undefined}>
          {s ?? ''}
        </td>
      );
    });
  return (
    <div className='mg-scorecard-wrap' data-compact={compact || undefined}>
      <table className='mg-scorecard' data-compact={compact || undefined}>
        <tbody>
          <tr className='mg-sc-holes'>
            <th scope='row'>hole</th>
            {course.holes.map((_, i) => (
              <td key={i}>{i + 1}</td>
            ))}
            <td className='mg-sc-total'>tot</td>
          </tr>
          <tr className='mg-sc-par'>
            <th scope='row'>par</th>
            {course.holes.map((h, i) => (
              <td key={i}>{h.hole.par}</td>
            ))}
            <td className='mg-sc-total'>{par}</td>
          </tr>
          <tr className='mg-sc-you'>
            <th scope='row'>you</th>
            {cells(scores)}
            <td className='mg-sc-total'>{scores.length ? total : ''}</td>
          </tr>
          {shown.map((f) => (
            <tr key={f.userId} className='mg-sc-friend'>
              <th scope='row' title={f.name}>
                {f.name}
              </th>
              {cells(f.scores)}
              <td className='mg-sc-total'>{f.finished ? f.strokes : `${f.holesDone}/9`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {more > 0 ? <p className='mg-sc-more'>{more} more friends played today.</p> : null}
    </div>
  );
}
