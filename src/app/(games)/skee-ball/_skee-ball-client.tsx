'use client';

import { renameGameNamesInText } from '@/features/arcade/lib/game-renames';
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
import { useFeelReducedMotion, useGameFeedback } from '@/features/arcade/lib/use-game-feedback';
import { semitonesToPitch, settleEase, springEase, squashAt } from '@/features/arcade/lib/game-feel';
import {
  CALLOUT_STOPS,
  calloutFrameAt,
  calloutFontPx,
  calloutLifeMs,
} from '@/features/arcade/components/gameplay/callout-motion';
import {
  drawCanvasCallout,
  readCanvasCalloutLook,
} from '@/features/arcade/components/gameplay/callout-canvas';
import {
  createGameFrameLoop,
  type GameFrameInfo,
  type GameFrameLoop,
} from "@/features/arcade/lib/game-frame-loop";
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
  makeSoftDiscTexture,
  makeSparkTexture,
  makeSpriteParticlePool,
  markMidwayFirstFrame,
  midwayCanvasFont,
  midwayParticleCount,
  resetSpriteParticles,
  stepSpriteParticles,
  tintBulb,
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
  skeeApplyThrow,
  skeeBallBonusFor,
  skeeDailyTarget,
  skeeDateKey,
  skeeInitialState,
  skeeLanePoint,
  skeeStartThrow,
  skeeStep,
  SKEE_BALL_R,
  SKEE_BALLS_PER_SESSION,
  SKEE_MAX_BALLS,
  SKEE_BOARD_COS,
  SKEE_BOARD_HALF,
  SKEE_BOARD_SIN,
  SKEE_FIELD_Y0,
  SKEE_FIELD_Z0,
  SKEE_GAP_FLOOR_Y,
  SKEE_HUMP_R,
  SKEE_LANE_HALF,
  SKEE_MAX_AIM,
  SKEE_MAX_POWER,
  SKEE_MIN_POWER,
  SKEE_POCKET_R,
  SKEE_POCKET_W,
  SKEE_POCKET_X,
  SKEE_R20,
  SKEE_R30,
  SKEE_R40,
  SKEE_R50,
  SKEE_S_FLAT,
  SKEE_W_CENTER,
  SKEE_Y_LIP,
  SKEE_Z_LIP,
  type SkeeBonus,
  type SkeeSimState,
  type SkeeThrow,
  type SkeeThrowEvent,
} from '@/server/arcade/skee-ball-replay';
import {
  BALL_START,
  DISPLAY_POS,
  LAMP_POS,
  SPOUT,
  buildSkeeCabinet,
  holeCentre,
  placeOnBoard,
  returnPoints,
  sampleReturnRun,
  startReturnRun,
  stepReturnRun,
  troughFloorY,
  type ReturnRun,
} from './_skee-ball-scene';
import {
  createSkeePlayback,
  flickPowerShare,
  flickToRelease,
  flickVelocity,
  FLICK_MIN_SPEED,
  SKEE_STEP_MS,
  type SkeePlayback,
} from './_skee-flick';
import {
  DEFAULT_SKEE_BALL_THEME,
  buildSkeeBallTheme,
  type SkeeBallCosmeticTheme,
  type InventoryCosmeticResponse,
} from './_skee-ball-theme';
import { makeBallSkinTexture, makeLaneSkinTexture } from './_skee-ball-skin';
import './_skee-ball.css';

/* ──────────────────────────────────────────────────────────────────────────
   SKEE-BALL — the boardwalk roll-and-score ramp, in three.js.

   Pull back, then FLICK forward and let go: the release velocity (read from
   coalesced pointer samples over a short window) sets POWER and the flick
   angle sets AIM, with a gentle center bias. Releasing slowly falls back to
   the pull-distance mapping, a mostly-sideways swipe cancels the throw, and
   the arrow keys + Space keep full keyboard parity.
   The ball climbs the kicker ramp, jumps
   the gap, and lands on the inclined ring board — concentric enamel rings pay
   10/20/30/40/50, the high corner pockets pay 100. Nine balls a frame; each
   ball has one seeded LIT ring that pays x2 (x3 on hot late balls). Fall
   short, miss wide, or rim out and the ball is dead.

   Anti-cheat: the release params (aim, power, t) are the ONLY thing sent to
   the server — it replays them through the identical fixed-timestep lane sim
   (server/arcade/skee-ball-replay.ts) and re-derives every ring + lit-ring
   multiplier from the session seed. The client never claims a score.

   Scene: one cabinet in flat colours that fills the canvas: walnut side
   walls with brass capping rails, the lane and kicker ramp, the inclined
   ring deck with every ring's value painted on it, and the cabinet head,
   which is the score display. The ball return runs the near side. Feel
   spec: docs/design/tixy-rebrand/SKEE_BALL.md. Reduced motion: the ball's
   flight and return still play (that motion IS the game); shake, squash,
   hit-stop, particles and the camera moves stop, and the display jumps.
   ────────────────────────────────────────────────────────────────────────── */

// The canvas keeps this portrait shape; the shell scales it to the stage.
const BASE_WIDTH = 340;
const BASE_HEIGHT = 640;
// The "+30" plate on its sprite: texture pixels per CSS pixel of the callout
// look, and the plate's height in world units (the texture is 128 px tall for
// 0.5 world), so the callout's drift can be played in the scene.
const POINTS_PLATE_UNIT = 2.8;
const POINTS_PLATE_WORLD_H = (((calloutFontPx(true, 1280) + 11) * POINTS_PLATE_UNIT) / 128) * 0.5;

const RESTART_GRACE_PERIOD = 400;

const GUEST_RUN_MESSAGE = 'Sign in to save scores and earn tickets.';

const HINT: GameHint = {
  touch: 'Tap, then flick up to roll.',
  pointer: 'Click, then flick up to roll.',
};
const HOW_TO: GameHowTo = {
  lines: [
    'Pull the ball back and flick up to roll it.',
    'Nine balls a frame. A corner pocket adds one, up to 12.',
    'Rings pay 10 to 50, pockets 100, and the lit ring pays 2 or 3 times.',
  ],
};

// Camera: the player's end of the lane, framing the cabinet to the canvas
// edges. Fixed, since the canvas keeps one shape at every size.
const CAM_FOV = 52;
const CAM_POS: [number, number, number] = [0, 8, -2.8];
const CAM_LOOK: [number, number, number] = [0, 0, 4.8];
/** Shake: px from the feel kit to world units at the deck. */
const SHAKE_UNITS_PER_PX = 0.0045;

/**
 * The ball's enamel: a near-white mottle (so it still multiplies the theme
 * ball color) plus one painted maker's band. Without a surface feature the
 * rolling spin is invisible on a plain sphere — this is what makes the ball
 * read as heavy and actually ROLLING rather than sliding.
 */
function makeBallTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#fbf7ee';
    ctx.fillRect(0, 0, w, h);
    // A solid composite ball: one thin moulding seam round its equator and
    // a small maker's mark, so its roll reads at any speed.
    ctx.fillStyle = 'rgba(96, 66, 34, 0.55)';
    ctx.fillRect(0, h * 0.49, w, h * 0.022);
    ctx.fillStyle = 'rgba(96, 66, 34, 0.7)';
    ctx.beginPath();
    ctx.arc(w * 0.25, h * 0.27, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fbf7ee';
    ctx.beginPath();
    ctx.arc(w * 0.25, h * 0.27, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(96, 66, 34, 0.7)';
    ctx.beginPath();
    ctx.arc(w * 0.75, h * 0.73, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Drag → release-param mapping (pixels): the slow-release fallback.
const DRAG_POWER_PX = 220; // a full-power pull
const DRAG_AIM_PX = 150; // full-left / full-right aim
const DRAG_DEADZONE_PX = 16; // accidental taps cancel the throw
const FLICK_SAMPLE_KEEP_MS = 220; // sample ring-buffer horizon
const CANCEL_SWIPE_RATIO = 1.7; // a release moving this much more sideways than forward cancels
const CANCEL_SWIPE_MIN_SPEED = 0.45; // but only if it is a real swipe, not a wobble (px/ms)

// Keyboard tuning (accessibility): arrows adjust, Space throws.
const KB_AIM_STEP = 0.1;
const KB_POWER_STEP = 0.2;
const KB_DEFAULT_POWER = 9.3;

// Board tilt (radians) for the contact shadow.
const BOARD_TILT = Math.atan2(SKEE_BOARD_SIN, SKEE_BOARD_COS);

// Two layers per event: a PHYSICAL contact cue (what the ball actually hit)
// and, for a score, a musical cue on top of it. The physical layer is what
// makes the return read as one continuous object moving through the cabinet.
const SFX = {
  start: 'arcadeReveal',
  roll: 'skeeRoll', // the ball leaves the hand onto the boards
  chime: 'skeeChime', // pitched to the ring it lands in
  pocket: 'arcadeCashout', // a corner pocket, after its chime
  lit: 'coinStreakMilestone', // the lit ring lands
  wood: 'skeeWoodKnock', // ball onto lacquered lane wood; the lip; a dead ball
  rim: 'skeeRimRattle', // rattles the brass rim and stays out
  cup: 'skeeCupDrop', // hollow thock as it drops into a cup
  chute: 'skeeChute', // running the sheet-metal return trough
  cradle: 'skeeCradle', // settling into the wire cradle
  over: 'arcadeLose',
  best: 'arcadeWin',
};

type GameState = 'idle' | 'playing' | 'gameover' | 'error';
type Phase = 'aim' | 'flight' | 'result' | 'return' | 'over';

/** What the cabinet head shows. Painted only when it changes. */
type DisplayState = {
  score: number;
  ballsUsed: number;
  /** Balls this frame has: 9, plus one per 100 pocket. */
  ballsAllowed: number;
  /** Today's target, shown in place of the lit ring before a run. */
  target: number;
  showTarget: boolean;
  bonus: SkeeBonus;
  /** A dead-ball reason in red, or the lit multiplier, until `until`. */
  message: { text: string; tone: 'red' | 'ticket'; until: number } | null;
};

/** Power 0 to 1 → paper, then ticket amber, then red at full power. */
const POWER_STOPS: Array<[number, [number, number, number]]> = [
  [0, [244, 235, 220]],
  [0.55, [242, 163, 60]],
  [1, [184, 54, 39]],
];
const powerColor = (k: number): [number, number, number] => {
  const t = Math.min(1, Math.max(0, k));
  for (let i = 1; i < POWER_STOPS.length; i += 1) {
    const [p1, c1] = POWER_STOPS[i];
    const [p0, c0] = POWER_STOPS[i - 1];
    if (t <= p1) {
      const f = (t - p0) / (p1 - p0);
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
    }
  }
  return POWER_STOPS[POWER_STOPS.length - 1][1];
};

/** Power share 0 to 1 of a stroke's flick so far, or null when it isn't one. */
function flickPower(samples: ReadonlyArray<{ x: number; y: number; t: number }>): number | null {
  const v = flickVelocity(samples);
  if (!v || v.forward < FLICK_MIN_SPEED) return null;
  return flickPowerShare(v.forward);
}

/** Ring → chime step in semitones: a major arpeggio up to the pockets. */
const RING_SEMITONES: Record<number, number> = { 10: 0, 20: 2, 30: 4, 40: 7, 50: 12, 100: 16 };
const RING_LABELS = ['10', '20', '30', '40', '50', '100'] as const;
const LABEL_UNLIT = new THREE.Color('#d9cdb6');
const LABEL_LIT = new THREE.Color(MIDWAY_PALETTE.ticket);
const LABEL_FLASH = new THREE.Color('#fff8ea');

/** One atlas of ring values in Big Shoulders, white on clear; the label
 *  materials tint it. Repaints once the face has loaded. */
function makeRingLabelAtlas(): THREE.CanvasTexture {
  const cell = 128;
  const canvas = document.createElement('canvas');
  canvas.width = cell * RING_LABELS.length;
  canvas.height = cell;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const paint = () => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let font = '';
    RING_LABELS.forEach((label, i) => {
      // A small ink plate under each value, so it reads on any enamel.
      ctx.fillStyle = MIDWAY_PALETTE.ink;
      ctx.beginPath();
      ctx.roundRect(cell * i + cell * 0.06, cell * 0.06, cell * 0.88, cell * 0.88, cell * 0.16);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      font = midwayCanvasFont('num', 800, label.length > 2 ? 78 : 96);
      ctx.font = font;
      ctx.fillText(label, cell * i + cell / 2, cell * 0.53, cell * 0.8);
    });
    return font;
  };
  const font = paint();
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (fonts && font && !fonts.check(font)) {
    void fonts.load(font).then(() => {
      paint();
      tex.needsUpdate = true;
    }).catch(() => undefined);
  }
  return tex;
}

/** The cabinet head: score, ball lamps, the lit ring. */
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
  const message = state.message && now < state.message.until ? state.message : null;
  // Left: the score, or a dead ball's reason.
  const numFont = midwayCanvasFont('num', 800, h * 0.7);
  if (message && message.tone === 'red') {
    ctx.font = midwayCanvasFont('text', 800, h * 0.42);
    ctx.fillStyle = '#e0533f';
    ctx.textAlign = 'center';
    ctx.fillText(message.text, w * 0.33, h * 0.42, w * 0.56);
  } else {
    ctx.font = numFont;
    ctx.fillStyle = P.ticket;
    ctx.textAlign = 'center';
    ctx.fillText(String(Math.round(state.score)), w * 0.33, h * 0.44, w * 0.56);
  }
  // Ball lamps under the score.
  // Nine lamps, and one more for each bonus ball, up to twelve.
  const lamps = state.ballsAllowed;
  const gap = (w * 0.54) / SKEE_MAX_BALLS;
  for (let i = 0; i < lamps; i += 1) {
    ctx.beginPath();
    ctx.arc(w * 0.06 + gap * (i + 0.5), h * 0.82, h * 0.04, 0, Math.PI * 2);
    ctx.fillStyle = i < state.ballsUsed ? P.ink2 : P.paper;
    ctx.fill();
  }
  // Right: the lit ring for this ball, or its multiplier flashing.
  ctx.fillStyle = P.rail;
  ctx.fillRect(w * 0.64, h * 0.14, w * 0.32, h * 0.72);
  ctx.textAlign = 'center';
  if (state.showTarget) {
    ctx.font = midwayCanvasFont('text', 700, h * 0.2);
    ctx.fillStyle = P.paper;
    ctx.fillText('target', w * 0.8, h * 0.28, w * 0.28);
    ctx.font = midwayCanvasFont('num', 800, h * 0.4);
    ctx.fillStyle = P.paper;
    ctx.fillText(String(state.target), w * 0.8, h * 0.64, w * 0.28);
    return numFont;
  }
  const lit = message && message.tone === 'ticket';
  ctx.font = midwayCanvasFont('num', 800, h * (lit ? 0.56 : 0.44));
  ctx.fillStyle = lit ? P.ticket : P.paper;
  ctx.fillText(
    lit ? message.text : String(state.bonus.ring),
    w * 0.8,
    h * (lit ? 0.5 : 0.4),
    w * 0.28,
  );
  if (!lit) {
    ctx.font = midwayCanvasFont('num', 800, h * 0.24);
    ctx.fillStyle = state.bonus.mult >= 3 ? '#e0533f' : P.ticket;
    ctx.fillText(`\u00d7${state.bonus.mult}`, w * 0.8, h * 0.7, w * 0.28);
  }
  return numFont;
}

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

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const clampNum = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

// Scratch vector for the rolling-spin axis (no per-frame allocation).
const SPIN_AXIS = new THREE.Vector3();

// The camera sits at -z looking down-lane (+z), so SCREEN-right is WORLD -x.
// Inputs and the meter live in screen space (positive = right); the sim gets
// the negated value so a right flick visibly rolls right.
const screenAimToSim = (aim: number) => -aim;

export default function SkeeBallClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trailCanvasRef = useRef<HTMLCanvasElement>(null);

  const [gameState, setGameState] = useState<GameState>('idle');
  const [score, setScore] = useState(0);
  const [runStats, setRunStats] = useState({ rings: 0, pockets: 0, balls: 0 });
  const [highScore, setHighScore] = useState<number | null>(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [walletBalances, setWalletBalances] = useState({ credits: 0 });
  const [, setDailyCreditsProgress] = useState({
    earned: 0,
    cap: 300,
  });
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
  // Null until the stage reports its size: the renderer is sized once,
  // before the first render.
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);
  // Equipped cosmetics (lane / rings / background). Seeded with the exact
  // default palette so the idle render is unchanged before inventory loads.
  const [skeeTheme, setSkeeTheme] =
    useState<SkeeBallCosmeticTheme>(DEFAULT_SKEE_BALL_THEME);
  // A skin set's sound tint colours this game's cues while it is open.
  const skinSound = skeeTheme.skin?.sound ?? 'house';
  useEffect(() => {
    SoundManager.setTint(skinSound);
    return () => SoundManager.setTint('house');
  }, [skinSound]);

  // Today's target (UTC), the same number the score route reports.
  const [dailyTarget] = useState(() => skeeDailyTarget(skeeDateKey(Date.now())));
  const reducedMotion = useFeelReducedMotion();
  const { trigger, hitStopClock, shakeOffset } = useGameFeedback();

  // ── Refs (mutable sim state; no re-render) ──
  const gameStateRef = useRef<GameState>('idle');
  const phaseRef = useRef<Phase>('aim');
  const sessionTokenRef = useRef<string | null>(null);
  const seedRef = useRef<number | null>(null);
  const envMonitorRef = useRef(new EnvMonitor());
  const scoreRef = useRef(0);
  const simRef = useRef<SkeeSimState>(skeeInitialState());
  const throwsRef = useRef<SkeeThrow[]>([]);
  const runStartRef = useRef(0);
  const runStatsRef = useRef({ rings: 0, pockets: 0, balls: 0 });

  // Drag state. `samples` is a short ring buffer of coalesced pointer points
  // used to read the release velocity for the flick mapping.
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    aim: number;
    power: number;
    maxPullPx: number;
    samples: Array<{ x: number; y: number; t: number }>;
  } | null>(null);
  // Keyboard tuning (accessibility path).
  const kbRef = useRef<{ aim: number; power: number }>({
    aim: 0,
    power: KB_DEFAULT_POWER,
  });
  /** The aim arrow on the lane while the player tunes a keyboard throw. */
  const kbPreviewUntilRef = useRef(0);
  /** The power trail: the stroke after release, fading. */
  const trailDrawnRef = useRef(false);
  const trailRef = useRef<{
    points: Array<{ x: number; y: number }>;
    color: [number, number, number];
    releasedAt: number;
  } | null>(null);

  // ── three.js scene refs (built once; updated per frame by renderScene) ──
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  /** The ball: the group moves and squashes, the mesh inside it spins. */
  const ballRef = useRef<THREE.Group | null>(null);
  const ballSpinRef = useRef<THREE.Mesh | null>(null);
  const themeRef = useRef<SkeeBallCosmeticTheme>(DEFAULT_SKEE_BALL_THEME);
  // A skin set's lane and ball pictures, and the house ball map to go back to.
  const skinPaintRef = useRef<{
    key: string;
    lane: THREE.Texture | null;
    ball: THREE.Texture | null;
    houseBall: THREE.Texture | null;
    blank: THREE.Texture | null;
  }>({ key: '', lane: null, ball: null, houseBall: null, blank: null });
  const themeMatsRef = useRef<{
    wood: THREE.MeshStandardMaterial;
    cabinet: THREE.MeshStandardMaterial;
    panel: THREE.MeshStandardMaterial;
    rail: THREE.MeshStandardMaterial;
    trim: THREE.MeshStandardMaterial;
    field: THREE.MeshStandardMaterial;
    hole: THREE.MeshStandardMaterial;
    ring10: THREE.MeshStandardMaterial;
    ring20: THREE.MeshStandardMaterial;
    ring30: THREE.MeshStandardMaterial;
    ring40: THREE.MeshStandardMaterial;
    ring50: THREE.MeshStandardMaterial;
    pocket: THREE.MeshStandardMaterial;
    ball: THREE.MeshStandardMaterial;
    ground: THREE.MeshBasicMaterial;
    bulbAmber: THREE.MeshStandardMaterial;
    bulbRed: THREE.MeshStandardMaterial;
    bulbTeal: THREE.MeshStandardMaterial;
    hemi: THREE.HemisphereLight;
  } | null>(null);
  // The cabinet head and the painted ring values.
  const displayRef = useRef<{
    canvas: HTMLCanvasElement;
    texture: THREE.CanvasTexture;
    painted: string;
  } | null>(null);
  const displayStateRef = useRef<DisplayState>({
    score: 0,
    ballsUsed: 0,
    ballsAllowed: SKEE_BALLS_PER_SESSION,
    target: dailyTarget,
    showTarget: true,
    bonus: { ring: 30, mult: 2 },
    message: null,
  });
  /** The score the display shows rolls from `from` to `to`. */
  const displayRollRef = useRef({ from: 0, to: 0, start: 0 });
  const ringLabelsRef = useRef<Array<{ ring: number; mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; base: number }>>([]);
  const labelPunchRef = useRef<{ ring: number; start: number } | null>(null);
  /** "+30" rising off the ring it landed in. */
  const pointsSpriteRef = useRef<{
    sprite: THREE.Sprite;
    canvas: HTMLCanvasElement;
    texture: THREE.CanvasTexture;
    start: number;
    from: THREE.Vector3;
  } | null>(null);
  const squashRef = useRef<{ start: number; force: number } | null>(null);
  /** Stops the roll rumble scheduled for the ball in play. */
  const stopRollRef = useRef<() => void>(() => {});
  /** Effect clock: wall time minus every hit-stop so far. */
  const frozenTotalRef = useRef(0);
  const effectClockRef = useRef(0);

  // The ball in play: the shared sim stepped live, drawn between steps.
  const flightRef = useRef<{
    play: SkeePlayback;
    event: Extract<SkeeThrowEvent, { type: 'thrown' }>;
    /** Release offset from the hand to the sim's start, blended out. */
    offset: [number, number, number];
    age: number;
    decided: boolean;
  } | null>(null);
  /** The ball rolling home after its throw is decided and the sim stops. */
  const ballReturnRef = useRef<ReturnRun | null>(null);
  /** The ball's spin (rad/s about a world axis), kept while it flies. */
  const spinRef = useRef(new THREE.Vector3());
  const sampleRef = useRef({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
  // Cabinet parts the render loop drives: the sprung spout flap and the
  // particle pools.
  const spoutFlapRef = useRef<THREE.Group | null>(null);
  const dustPoolRef = useRef<SpriteParticle[]>([]);
  const sparkPoolRef = useRef<SpriteParticle[]>([]);
  const ballPrevPosRef = useRef<THREE.Vector3 | null>(null);
  // The aim arrow on the lane (live while aiming, then a fading read-back)
  // and the contact shadow.
  const ghostArrowRef = useRef<THREE.Group | null>(null);
  const ghostArrowMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const ghostAnimRef = useRef<{ start: number } | null>(null);
  const landingShadowRef = useRef<THREE.Mesh | null>(null);
  const landingShadowMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  // Restrained pointer parallax (desktop hover; dt-eased in the render loop).
  const parallaxTargetRef = useRef({ x: 0, y: 0 });
  const parallaxRef = useRef({ x: 0, y: 0 });
  const lastFrameRef = useRef(0);
  const impactPulseRef = useRef<{ start: number; material: THREE.MeshStandardMaterial } | null>(null);

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
  const saveScoreRef = useRef<((score: number, throws: SkeeThrow[]) => Promise<void>) | null>(null);
  const bestScoreCacheRef = useRef<number | null>(null);

  /** The effect clock at the last painted frame (hit-stops taken out). */
  const effectNow = useCallback(() => effectClockRef.current || performance.now(), []);

  const fetchUserBestScore = useCallback(async () => {
    if (bestScoreCacheRef.current !== null) {
      setHighScore(bestScoreCacheRef.current);
      return;
    }
    try {
      const response = await fetch('/api/games/skee-ball/score', {
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
      const response = await fetch('/api/store/inventory?gameType=skee-ball', {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = (await response.json()) as InventoryCosmeticResponse;
      setWalletBalances({ credits: payload.wallet?.credits ?? 0 });
      setDailyCreditsProgress({
        earned: payload.dailyGameCredits?.earned ?? 0,
        cap: payload.dailyGameCredits?.cap ?? 300,
      });
      setSkeeTheme(buildSkeeBallTheme(payload));
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

  const saveScore = async (finalScore: number, throws: SkeeThrow[]) => {
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
      const response = await fetch('/api/games/skee-ball/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: finalScore,
          sessionToken: sessionTokenRef.current,
          throws,
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
        console.error(`[SkeeBall] Score rejected (${response.status}): ${reason}`);
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
      qualityRef.current ?? createMidwayQualityController({ game: 'skee-ball' });
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
      ballRef.current = null;
      ballSpinRef.current = null;
      displayRef.current = null;
      pointsSpriteRef.current = null;
      ringLabelsRef.current = [];
      themeMatsRef.current = null;
      skinPaintRef.current.houseBall?.dispose();
      skinPaintRef.current = { key: '', lane: null, ball: null, houseBall: null, blank: null };
      spoutFlapRef.current = null;
      dustPoolRef.current = [];
      sparkPoolRef.current = [];
      setWebglError(true);
      rendererRef.current = null;
      rendererHandleRef.current?.dispose();
      rendererHandleRef.current = null;
    };
    const handle = createMidwayRenderer({
      canvas,
      tier,
      exposure: 1.34,
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
    if (!handle) {
      setWebglError(true);
      return;
    }
    const renderer = handle.renderer;
    rendererHandleRef.current = handle;
    rendererRef.current = renderer;

    const t = themeRef.current;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(t.skyBottom);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(CAM_FOV, width / Math.max(1, height), 0.1, 120);
    camera.position.set(...CAM_POS);
    camera.lookAt(...CAM_LOOK);
    cameraRef.current = camera;

    // The kit's night-boardwalk rig; the hemisphere follows the background skin.
    const rig = createMidwayLightRig(renderer, scene, {
      tier,
      target: [0, 0.6, 4.6],
      radius: 7.5,
      camera: CAM_POS,
      sky: t.skyTop,
      ground: t.groundColor,
    });
    rigRef.current = rig;
    const hemi = rig.hemi;
    quality.onChange((next) => {
      // Runs only when no decision is live (see the hold in the frame loop),
      // and pays the shader recompile now, between throws.
      applyMidwayTier(renderer, rig, next, { scene, camera });
      if (gameStateRef.current !== 'playing') renderSceneRef.current();
    });

    // The ball's band and the signs paint after the first frame.
    const deferred = createMidwayDeferredTextures('skee-ball', { quality });
    deferredRef.current = deferred;
    const blank = deferred.placeholder();

    // ── Materials (captured for theme recolor) ──
    // Flat colours: no grain, no planks. The lane bed is a shade lighter
    // than the cabinet carcass.
    // The lane carries a placeholder map from the start, so a skin's lane
    // picture is a texture swap and not a shader recompile mid-round.
    const woodMat = new THREE.MeshStandardMaterial({ color: t.woodMid, roughness: 0.62, map: blank });
    skinPaintRef.current.blank = blank;
    const cabinetMat = new THREE.MeshStandardMaterial({ color: t.woodLo, roughness: 0.56 });
    const railMat = new THREE.MeshStandardMaterial({ color: t.rail, roughness: 0.85 });
    const trimMat = new THREE.MeshStandardMaterial({ color: t.trim, roughness: 0.7 });
    // Aged brass for the capping rails, cup collars, spout and cradle.
    const brassMat = makeMidwayMaterial('brass');
    // Teal painted enamel panels let into the cabinet flanks.
    const panelMat = new THREE.MeshStandardMaterial({
      color: t.ring10,
      roughness: 0.42,
      metalness: 0.04,
    });
    const fieldMat = new THREE.MeshStandardMaterial({ color: t.field, roughness: 0.8 });
    const holeMat = new THREE.MeshStandardMaterial({
      color: '#0d0603',
      roughness: 0.96,
      side: THREE.DoubleSide,
    });
    const enamel = { roughness: 0.38, metalness: 0.05 };
    const ring10Mat = new THREE.MeshStandardMaterial({ color: t.ring10, ...enamel });
    const ring20Mat = new THREE.MeshStandardMaterial({ color: t.ring20, ...enamel });
    const ring30Mat = new THREE.MeshStandardMaterial({ color: t.ring30, ...enamel });
    const ring40Mat = new THREE.MeshStandardMaterial({ color: t.ring40, ...enamel });
    const ring50Mat = new THREE.MeshStandardMaterial({ color: t.ring50, ...enamel });
    const pocketMat = new THREE.MeshStandardMaterial({
      color: t.pocket,
      roughness: 0.28,
      metalness: 0.6,
    });
    // The ball carries a faint mottle + a maker's stamp so its rolling spin is
    // legible; the near-white map multiplies the theme's ball color.
    const ballMat = new THREE.MeshStandardMaterial({
      color: t.ball,
      roughness: 0.3,
      map: blank,
    });
    // The boardwalk deck under the cabinet, one flat colour.
    // Unlit: it is most of what isn't cabinet, and lighting it costs every
    // one of those pixels.
    const groundMat = new THREE.MeshBasicMaterial({ color: t.groundColor });
    deferred.add(
      () => makeBallTexture(),
      (painted) => {
        skinPaintRef.current.houseBall = painted;
        // A skin set may have taken the ball while this waited.
        if (!themeRef.current.skin) ballMat.map = painted;
      },
    );
    const bulbAmberMat = new THREE.MeshStandardMaterial({ color: t.bulbAmber });
    const bulbRedMat = new THREE.MeshStandardMaterial({ color: t.bulbRed });
    const bulbTealMat = new THREE.MeshStandardMaterial({ color: t.bulbTeal });
    tintBulb(bulbAmberMat, t.bulbAmber);
    tintBulb(bulbRedMat, t.bulbRed);
    tintBulb(bulbTealMat, t.bulbTeal);

    // Boardwalk deck: planks running down-midway, wide enough to carry the
    // cabinet's contact shadow and still read behind it.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(44, 30), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.75, 6);
    ground.receiveShadow = true;
    scene.add(ground);

    // No string lights: the camera frames the cabinet to its edges, so
    // they would sit outside the frame and only cost shader programs.

    // ── The cabinet, built from the engine's own constants: what is drawn
    //    is what the ball hits. ──
    const chuteMat = new THREE.MeshStandardMaterial({ color: '#3a2a1c', roughness: 0.42, metalness: 0.44 });
    const cabinet = buildSkeeCabinet(scene, {
      lane: woodMat,
      cabinet: cabinetMat,
      rail: railMat,
      trim: trimMat,
      brass: brassMat,
      field: fieldMat,
      hole: holeMat,
      chute: chuteMat,
      ring20: ring20Mat,
      ring30: ring30Mat,
      ring40: ring40Mat,
      ring50: ring50Mat,
      pocket: pocketMat,
    });
    spoutFlapRef.current = cabinet.spoutFlap;
    void ring10Mat;

    // The cabinet head is the score display. It carries game information,
    // so it paints before the first frame, never deferred. Self-lit, like a
    // real display, and outside tone mapping so the amber stays the token.
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
    const marquee = new THREE.Group();
    marquee.position.set(...DISPLAY_POS);
    marquee.rotation.x = 0.28;
    const marqueeFace = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 0.65),
      new THREE.MeshBasicMaterial({ map: displayTex, toneMapped: false }),
    );
    marqueeFace.rotation.y = Math.PI;
    marquee.add(marqueeFace);
    const marqueeFrame = new THREE.Mesh(new THREE.BoxGeometry(2.74, 0.78, 0.07), brassMat);
    marqueeFrame.position.z = 0.05;
    marquee.add(marqueeFrame);
    scene.add(marquee);

    // One lamp over the box, under the hood: each point light costs every
    // lit pixel, so there is one.
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.22, 16, 1, true), brassMat);
    shade.rotation.x = Math.PI;
    shade.position.set(LAMP_POS[0], LAMP_POS[1] + 0.12, LAMP_POS[2]);
    scene.add(shade);
    const filament = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), bulbAmberMat);
    filament.position.set(LAMP_POS[0], LAMP_POS[1] + 0.02, LAMP_POS[2]);
    scene.add(filament);
    rig.addPractical(LAMP_POS, { intensity: 5, distance: 6 });

    // Every ring's value is painted on the board in Big Shoulders, from one
    // atlas. The lit ring's value is drawn as a lamp; see renderScene.
    const labelAtlas = makeRingLabelAtlas();
    const labels: typeof ringLabelsRef.current = [];
    // Each value is drawn taller than wide: the view squashes the board
    // up-slope, so on screen it reads about square.
    const addLabel = (ring: number, x: number, w: number, size: number, lift = 0.012) => {
      const index = RING_LABELS.indexOf(String(ring) as (typeof RING_LABELS)[number]);
      const geo = new THREE.PlaneGeometry(size, size * 1.35);
      // Up the board reads as up on screen.
      geo.rotateZ(Math.PI);
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i += 1) {
        uv.setX(i, (index + uv.getX(i)) / RING_LABELS.length);
      }
      const mat = new THREE.MeshBasicMaterial({
        map: labelAtlas,
        color: LABEL_UNLIT,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      placeOnBoard(scene, mesh, x, w, lift);
      mesh.renderOrder = 2;
      labels.push({ ring, mesh, mat, base: size });
    };
    // Each band's value sits at its sides, where the view doesn't squash
    // the band; the 10 in the bottom corners; the 50 in its cup; the 100s
    // below their pockets.
    const sideLabels: Array<[number, number, number]> = [
      [20, (SKEE_R30 + SKEE_R20) / 2, 0.18],
      [30, (SKEE_R40 + SKEE_R30) / 2, 0.18],
      [40, (SKEE_R50 + SKEE_R40) / 2, 0.17],
    ];
    for (const [ring, r, size] of sideLabels) {
      addLabel(ring, -r, SKEE_W_CENTER, size);
      addLabel(ring, r, SKEE_W_CENTER, size);
    }
    addLabel(10, -1.08, 0.42, 0.2);
    addLabel(10, 1.08, 0.42, 0.2);
    addLabel(50, 0, SKEE_W_CENTER, 0.15, 0.008);
    addLabel(100, -SKEE_POCKET_X, SKEE_POCKET_W - SKEE_POCKET_R - 0.15, 0.2);
    addLabel(100, SKEE_POCKET_X, SKEE_POCKET_W - SKEE_POCKET_R - 0.15, 0.2);
    ringLabelsRef.current = labels;

    // ── The cream enamel ball. The group moves and squashes; the mesh
    //    inside it spins, so a squash is always flat to the surface. ──
    const ballSpin = new THREE.Mesh(
      new THREE.SphereGeometry(SKEE_BALL_R, 32, 20),
      ballMat,
    );
    ballSpin.castShadow = true;
    const ball = new THREE.Group();
    ball.add(ballSpin);
    ball.position.set(...BALL_START);
    scene.add(ball);
    ballRef.current = ball;
    ballSpinRef.current = ballSpin;

    // "+30" rising off the ring: one sprite, repainted per landing.
    const pointsCanvas = document.createElement('canvas');
    pointsCanvas.width = 256;
    pointsCanvas.height = 128;
    const pointsTex = new THREE.CanvasTexture(pointsCanvas);
    pointsTex.colorSpace = THREE.SRGBColorSpace;
    const pointsSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: pointsTex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    pointsSprite.scale.set(1, 0.5, 1);
    pointsSprite.visible = false;
    pointsSprite.renderOrder = 5;
    scene.add(pointsSprite);
    pointsSpriteRef.current = {
      sprite: pointsSprite,
      canvas: pointsCanvas,
      texture: pointsTex,
      start: -Infinity,
      from: new THREE.Vector3(),
    };

    // ── Post-release ghost arrow: a flat chevron on the lane that reads back
    //    the released aim + power, fading over ~0.6s ──
    const ghostMat = new THREE.MeshBasicMaterial({
      color: '#f2e5c8',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    // Drawn pointing -y in shape space → +z (down-lane) after rotation.x=-π/2.
    const ghostShape = new THREE.Shape();
    ghostShape.moveTo(-0.05, 0);
    ghostShape.lineTo(0.05, 0);
    ghostShape.lineTo(0.05, -0.72);
    ghostShape.lineTo(0.14, -0.72);
    ghostShape.lineTo(0, -0.98);
    ghostShape.lineTo(-0.14, -0.72);
    ghostShape.lineTo(-0.05, -0.72);
    ghostShape.closePath();
    const ghostMesh = new THREE.Mesh(new THREE.ShapeGeometry(ghostShape), ghostMat);
    ghostMesh.rotation.x = -Math.PI / 2;
    ghostMesh.position.y = 0.02;
    const ghostGroup = new THREE.Group();
    ghostGroup.add(ghostMesh);
    ghostGroup.position.set(BALL_START[0], 0, BALL_START[2] + 0.3);
    ghostGroup.visible = false;
    scene.add(ghostGroup);
    ghostArrowRef.current = ghostGroup;
    ghostArrowMatRef.current = ghostMat;

    // ── Landing shadow: a soft dark blob tracking under the airborne ball ──
    const shadowMat = new THREE.MeshBasicMaterial({
      color: '#000000',
      map: makeSoftDiscTexture(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const landingShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMat);
    landingShadow.rotation.x = -Math.PI / 2;
    landingShadow.visible = false;
    scene.add(landingShadow);
    landingShadowRef.current = landingShadow;
    landingShadowMatRef.current = shadowMat;

    // ── Restrained particle pools ──
    // Enamel dust for a scoring cup entry, brass sparks for a rim-out, and
    // wood chips for a dead ball. Small, short-lived and capped; they read as
    // material coming off a surface, never as a glow pass.
    const softTex = makeSoftDiscTexture();
    const sparkTex = makeSparkTexture();
    dustPoolRef.current = makeSpriteParticlePool({
      scene,
      count: 14,
      texture: softTex,
      colors: [t.ring50, t.ball, '#d8c49a'],
      size: 0.16,
    });
    sparkPoolRef.current = makeSpriteParticlePool({
      scene,
      count: 12,
      texture: sparkTex,
      colors: [t.pocket, '#ffd28a', t.bulbAmber],
      size: 0.11,
      blending: THREE.AdditiveBlending,
    });

    themeMatsRef.current = {
      wood: woodMat,
      cabinet: cabinetMat,
      panel: panelMat,
      rail: railMat,
      trim: trimMat,
      field: fieldMat,
      hole: holeMat,
      ring10: ring10Mat,
      ring20: ring20Mat,
      ring30: ring30Mat,
      ring40: ring40Mat,
      ring50: ring50Mat,
      pocket: pocketMat,
      ball: ballMat,
      ground: groundMat,
      bulbAmber: bulbAmberMat,
      bulbRed: bulbRedMat,
      bulbTeal: bulbTealMat,
      hemi,
    };

    // Things that first appear mid-run (the arrow, the "+30", particles)
    // would compile their shaders on the frame they show up: a visible
    // hitch on the first throw. Compile them while the page is idle.
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

  // ── A skin set's pictures: the lane's material and the ball's markings.
  //    Decoration, so they paint with the deferred textures; until then the
  //    lane and ball keep their flat colour. Nothing here moves a vertex. ──
  const applySkeeSkinPictures = useCallback(
    (t: SkeeBallCosmeticTheme, mats: NonNullable<typeof themeMatsRef.current>) => {
      const paint = skinPaintRef.current;
      const skin = t.skin;
      const key = skin
        ? [skin.material, skin.shape, t.woodMid, skin.laneAlt, skin.laneLine, t.ball, skin.ballMark].join('|')
        : '';
      if (key === paint.key) {
        // The colours were just reset; a painted picture carries its own.
        if (paint.lane) mats.wood.color.set('#ffffff');
        if (paint.ball) mats.ball.color.set('#ffffff');
        return;
      }
      paint.key = key;
      paint.lane?.dispose();
      paint.ball?.dispose();
      paint.lane = null;
      paint.ball = null;
      mats.wood.map = paint.blank;
      mats.ball.map = skin ? paint.blank : (paint.houseBall ?? paint.blank);
      const deferred = deferredRef.current;
      if (!skin || !deferred) return;
      deferred.add(
        () => ({ lane: makeLaneSkinTexture(t), ball: makeBallSkinTexture(t) }),
        ({ lane, ball }) => {
          if (paint.key !== key) {
            lane?.dispose();
            ball?.dispose();
            return;
          }
          paint.lane = lane;
          paint.ball = ball;
          if (lane) {
            mats.wood.map = lane;
            mats.wood.color.set('#ffffff');
          }
          if (ball) {
            mats.ball.map = ball;
            mats.ball.color.set('#ffffff');
          }
        },
      );
    },
    [],
  );

  // ── Recolor the live scene when an equipped skin arrives ──
  const applySkeeTheme = useCallback(() => {
    const t = themeRef.current;
    const mats = themeMatsRef.current;
    const scene = sceneRef.current;
    if (!mats || !scene) return;
    scene.background = new THREE.Color(t.skyBottom);
    mats.wood.color.set(t.woodMid);
    mats.cabinet.color.set(t.woodLo);
    mats.panel.color.set(t.ring10);
    mats.rail.color.set(t.rail);
    mats.trim.color.set(t.trim);
    mats.field.color.set(t.field);
    mats.ring10.color.set(t.ring10);
    mats.ring20.color.set(t.ring20);
    mats.ring30.color.set(t.ring30);
    mats.ring40.color.set(t.ring40);
    mats.ring50.color.set(t.ring50);
    mats.pocket.color.set(t.pocket);
    mats.ball.color.set(t.ball);
    mats.ground.color.set(t.groundColor);
    applySkeeSkinPictures(t, mats);
    tintBulb(mats.bulbAmber, t.bulbAmber);
    tintBulb(mats.bulbRed, t.bulbRed);
    tintBulb(mats.bulbTeal, t.bulbTeal);
    mats.hemi.color.set(t.skyTop);
    mats.hemi.groundColor.set(t.groundColor);
  }, [applySkeeSkinPictures]);

  // ── Frame resolution after a ball lands (presentation only — the throw was
  //    already judged by the shared state machine at release) ──
  const resolveFlight = useCallback(
    (
      event: Extract<SkeeThrowEvent, { type: 'thrown' }>,
      at: [number, number, number],
      now: number,
    ) => {
      const { outcome, lit, points, bonus: b } = event;
      const rm = reducedMotionRef.current;
      if (!reducedMotionRef.current) {
        if (outcome.kind === 'ring') {
          // Enamel dust puffs out of the cup mouth, biased upward and toward
          // the player so it reads against the dark deck.
          emitSpriteParticles(
            dustPoolRef.current,
            midwayParticleCount(outcome.ring === 100 ? 9 : 6, qualityRef.current?.tier() ?? 'medium'),
            {
              origin: at,
              spread: 0.16,
              speed: [0.35, 1.1],
              up: [0.5, 1.5],
              ttl: [0.34, 0.6],
              size: [0.7, 1.35],
              grow: 1.5,
              fade: 0.42,
              spin: 3,
            },
          );
          if (outcome.ring === 100 || lit) {
            emitSpriteParticles(
              sparkPoolRef.current,
              midwayParticleCount(outcome.ring === 100 ? 10 : 6, qualityRef.current?.tier() ?? 'medium'),
              {
                origin: at,
                spread: 0.12,
                speed: [0.9, 2.4],
                up: [1.4, 3.0],
                ttl: [0.28, 0.5],
                size: [0.6, 1.1],
                grow: -0.5,
                fade: 0.85,
                spin: 8,
              },
            );
          }
        } else if (outcome.kind === 'over') {
          // Over the back wall: brass sparks off its cap.
          emitSpriteParticles(
            sparkPoolRef.current,
            midwayParticleCount(6, qualityRef.current?.tier() ?? 'medium'),
            {
              origin: at,
              spread: 0.1,
              speed: [1.2, 2.6],
              up: [0.4, 1.4],
              ttl: [0.2, 0.36],
              size: [0.5, 0.9],
              grow: -0.4,
              fade: 0.7,
              spin: 10,
            },
          );
        } else {
          emitSpriteParticles(
            dustPoolRef.current,
            midwayParticleCount(4, qualityRef.current?.tier() ?? 'medium'),
            {
              origin: at,
              spread: 0.2,
              speed: [0.3, 0.8],
              up: [0.25, 0.8],
              ttl: [0.3, 0.5],
              size: [0.6, 1.1],
              grow: 1.8,
              fade: 0.24,
              spin: 2,
            },
          );
        }
      }
      const display = displayStateRef.current;
      const scored = outcome.kind === 'ring' && outcome.ring !== null;
      if (scored) {
        const ring = outcome.ring as number;
        const pocket = ring === 100;
        runStatsRef.current.rings += 1;
        if (pocket) runStatsRef.current.pockets += 1;
        setResultAnnouncement(
          pocket
            ? `Pocket. ${points} points.`
            : `${ring} ring. ${points} points.`,
        );
        // The chime is pitched to the ring.
        const pitch = semitonesToPitch(RING_SEMITONES[ring] ?? 0);
        SoundManager.play(SFX.chime, { pitch });
        if (lit) {
          window.setTimeout(() => SoundManager.play(SFX.chime, { pitch: pitch * semitonesToPitch(7) }), 90);
          window.setTimeout(() => SoundManager.play(SFX.lit), 160);
          display.message = { text: `\u00d7${b.mult}`, tone: 'ticket', until: now + 600 };
        }
        if (pocket) {
          window.setTimeout(() => SoundManager.play(SFX.pocket), 120);
          // A pocket earns a ball: its lamp appears on the display.
          if (event.bonusBall) display.message = { text: '+1', tone: 'ticket', until: now + 900 };
          trigger('impact', { sound: false, shake: 1, hitStop: true });
          playHaptic('win');
        } else {
          trigger('impact', { sound: false, shake: (ring / 50) * 0.5 });
          playHaptic('tick');
        }
        // The ring flashes and its painted value punches.
        const mats = themeMatsRef.current;
        if (mats) {
          const mat =
            ring === 100 ? mats.pocket
            : ring === 50 ? mats.ring50
            : ring === 40 ? mats.ring40
            : ring === 30 ? mats.ring30
            : ring === 20 ? mats.ring20
            : mats.ring10;
          impactPulseRef.current = { start: now, material: mat };
        }
        labelPunchRef.current = { ring, start: now };
        // "+30" off the ring.
        const sprite = pointsSpriteRef.current;
        if (sprite) {
          const ctx = sprite.canvas.getContext('2d');
          if (ctx) {
            // The tixy callout plate, painted once at rest: the paper plate
            // for a lit ring or a pocket, screen 2 otherwise. Its motion
            // is the callout's curve, played on the sprite in renderScene.
            ctx.clearRect(0, 0, 256, 128);
            const stage = rendererRef.current?.domElement;
            drawCanvasCallout(ctx, readCanvasCalloutLook(stage ?? document.documentElement), {
              text: `+${points}`,
              x: 128,
              y: 64,
              u: CALLOUT_STOPS.in,
              tone: lit || pocket ? 'combo' : 'score',
              unit: POINTS_PLATE_UNIT,
            });
            sprite.texture.needsUpdate = true;
          }
          sprite.from.set(at[0], at[1] + 0.25, at[2]);
          sprite.start = now;
        }
        // The display's score rolls up to the new total.
        const roll = displayRollRef.current;
        roll.from = display.score;
        roll.to = scoreRef.current;
        roll.start = now;
        if (rm) display.score = roll.to;
      } else {
        const over = outcome.kind === 'over';
        display.message = { text: over ? 'too far' : 'too short', tone: 'red', until: now + 900 };
        setResultAnnouncement(over ? 'Too far. No points.' : 'Too short. No points.');
        trigger('impact', { sound: false, shake: 0.1 });
        playHaptic('failure');
      }
    },
    [trigger],
  );

  // ── Per-frame render + flight playback ──
  const renderScene = useCallback((frame?: GameFrameInfo) => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera) return;

    // Time comes from the frame's own timestamp (the display's vsync), not
    // from when this callback happens to run, so motion is even at any
    // refresh rate. The ball runs on the effect clock, which a hit-stop
    // holds; the shake and the trail run on wall time.
    const wall = frame?.nowMs ?? performance.now();
    const lastFrame = lastFrameRef.current || wall;
    const rawMs = frame ? frame.deltaMs : wall - lastFrame;
    lastFrameRef.current = wall;
    const frozenMs = rawMs > 0 ? hitStopClock.frozenWithin(wall - rawMs, wall) : 0;
    frozenTotalRef.current += frozenMs;
    const effMs = Math.max(0, rawMs - frozenMs);
    const now = wall - frozenTotalRef.current;
    effectClockRef.current = now;
    const dt = clampNum(rawMs / 1000, 0.001, 0.05);
    const rm = reducedMotionRef.current;
    const ball = ballRef.current;
    const display = displayStateRef.current;

    // The ball's contact shadow rides whatever surface is under it: the
    // trough floor, the lane and its hump, the gap floor or the board.
    const placeContactShadow = (bx: number, by: number, bz: number) => {
      const shadow = landingShadowRef.current;
      const shadowMat = landingShadowMatRef.current;
      if (!shadow || !shadowMat) return;
      let surfY: number;
      if (bx < -(SKEE_LANE_HALF + 0.06) && bz < SKEE_FIELD_Z0) {
        surfY = troughFloorY(bz);
        shadow.rotation.x = -Math.PI / 2;
      } else if (bz >= SKEE_FIELD_Z0 && Math.abs(bx) <= SKEE_BOARD_HALF) {
        surfY = SKEE_FIELD_Y0 + ((bz - SKEE_FIELD_Z0) * SKEE_BOARD_SIN) / SKEE_BOARD_COS;
        shadow.rotation.x = -(Math.PI / 2 + BOARD_TILT);
      } else if (bz <= SKEE_S_FLAT) {
        surfY = 0;
        shadow.rotation.x = -Math.PI / 2;
      } else if (bz <= SKEE_Z_LIP + 0.001) {
        const sin = Math.min(1, (bz - SKEE_S_FLAT) / SKEE_HUMP_R);
        surfY = SKEE_HUMP_R - Math.sqrt(SKEE_HUMP_R * SKEE_HUMP_R - (bz - SKEE_S_FLAT) ** 2);
        shadow.rotation.x = -(Math.PI / 2 + Math.asin(sin));
      } else {
        surfY = SKEE_GAP_FLOOR_Y;
        shadow.rotation.x = -Math.PI / 2;
      }
      const height = Math.max(0, by - SKEE_BALL_R - surfY);
      const spread = SKEE_BALL_R * 2 * (0.92 + height * 0.5);
      shadow.scale.set(spread, spread, 1);
      shadow.position.set(bx, surfY + 0.012, bz);
      shadowMat.opacity = Math.max(0.06, 0.45 - height * 0.35);
      shadow.visible = true;
    };

    // Rolling spin from the ball's travel: it turns about (normal x travel)
    // by distance over radius, so its mark rolls with the surface.
    const spinTo = (px: number, py: number, pz: number) => {
      const prev = ballPrevPosRef.current;
      if (prev) {
        const dx = px - prev.x;
        const dy = py - prev.y;
        const dz = pz - prev.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > 1e-5) {
          SPIN_AXIS.set(dz, 0, -dx);
          if (SPIN_AXIS.lengthSq() > 1e-8) {
            SPIN_AXIS.normalize();
            ballSpinRef.current?.rotateOnWorldAxis(SPIN_AXIS, dist / SKEE_BALL_R);
          }
        }
        prev.set(px, py, pz);
      } else {
        ballPrevPosRef.current = new THREE.Vector3(px, py, pz);
      }
    };

    // The ball in play: the shared sim, stepped at its fixed rate from this
    // frame's effect time and drawn between its last two steps.
    const flight = flightRef.current;
    if (ball && flight) {
      const events = flight.play.advance(effMs);
      const at = sampleRef.current;
      flight.play.sample(at);
      flight.age += effMs;
      // The hand's offset from the sim's start fades over the first 90 ms.
      const blend = Math.max(0, 1 - flight.age / 90);
      const px = at.x + flight.offset[0] * blend;
      const py = at.y + flight.offset[1] * blend;
      const pz = at.z + flight.offset[2] * blend;
      ball.position.set(px, py, pz);
      const st = flight.play.state;
      const spin = spinRef.current;
      if (st.contact) {
        // Rolling: angular velocity = (n x v) / r, n the surface normal: the
        // board's, or the lane's where the ball is (it tilts up the hump, so
        // the spin keeps pace with the climb and leaves the lip right).
        let ny = SKEE_BOARD_COS;
        let nz = -SKEE_BOARD_SIN;
        if (st.phase !== 'board') {
          const lane = skeeLanePoint(st.s);
          ny = lane.cos;
          nz = -lane.sin;
        }
        spin.set(ny * at.vz - nz * at.vy, nz * at.vx, -ny * at.vx).multiplyScalar(1 / SKEE_BALL_R);
      }
      // In the air it keeps the spin it left the surface with.
      const rate = spin.length();
      if (rate > 1e-4 && effMs > 0) {
        SPIN_AXIS.copy(spin).multiplyScalar(1 / rate);
        ballSpinRef.current?.rotateOnWorldAxis(SPIN_AXIS, (rate * effMs) / 1000);
      }
      placeContactShadow(px, py, pz);

      for (const e of events) {
        if (e.kind === 'lip') {
          SoundManager.play(SFX.wood, { volume: 0.75 });
          if (!rm) {
            emitSpriteParticles(dustPoolRef.current, midwayParticleCount(3, qualityRef.current?.tier() ?? 'medium'), {
              origin: [px, SKEE_Y_LIP + 0.02, SKEE_Z_LIP],
              spread: 0.12,
              speed: [0.2, 0.5],
              up: [0.2, 0.6],
              ttl: [0.25, 0.4],
              size: [0.4, 0.7],
              grow: 1.8,
              fade: 0.22,
              spin: 1.5,
            });
          }
        } else if (e.kind === 'land') {
          // The first touchdown: a thud and a squash scaled by the impact.
          SoundManager.play(SFX.wood, { volume: clampNum(e.speed / 3.5, 0.5, 1.4) });
          squashRef.current = { start: now, force: clampNum(e.speed / 6, 0.3, 1) };
          playHaptic('light');
        } else if (e.kind === 'bounce' || e.kind === 'box' || e.kind === 'rail') {
          SoundManager.play(SFX.wood, { volume: clampNum(e.speed / 5, 0.15, 0.8) });
        } else if (e.kind === 'wall') {
          SoundManager.play(SFX.rim, { volume: clampNum(e.speed / 3, 0.25, 1) });
        } else if (e.kind === 'decided' && !flight.decided) {
          flight.decided = true;
          resolveFlight(flight.event, [px, py, pz], now);
        }
      }

      if (st.phase === 'done') {
        // The sim is over: the ball goes home along the return.
        const outcome = flight.event.outcome;
        const inGap = outcome.kind === 'short' && st.y <= SKEE_GAP_FLOOR_Y + SKEE_BALL_R + 0.05;
        const kind = outcome.kind === 'ring' ? 'ring' : outcome.kind === 'over' ? 'over' : inGap ? 'gutter' : 'short';
        const speed = Math.hypot(at.vx, at.vy, at.vz);
        ballReturnRef.current = startReturnRun(
          returnPoints([px, py, pz], kind, outcome.ring, outcome.kind === 'ring' ? holeCentre(outcome.ring, st.x, st.w) : null),
          speed,
        );
        flightRef.current = null;
        ballPrevPosRef.current = null;
        phaseRef.current = 'return';
      }
    }

    // The ball rolls home: speed from the slope it is on, never stopping
    // until it settles in the cradle.
    const ret = ballReturnRef.current;
    if (ball && ret && !flightRef.current) {
      const stepped = stepReturnRun(ret, effMs / 1000);
      const sample = sampleReturnRun(ret);
      ball.position.set(...sample.p);
      ball.visible = sample.visible;
      if (ball.visible) {
        spinTo(sample.p[0], sample.p[1], sample.p[2]);
        placeContactShadow(sample.p[0], sample.p[1], sample.p[2]);
      } else {
        ballPrevPosRef.current = null;
        if (landingShadowRef.current) landingShadowRef.current.visible = false;
      }
      for (const cue of stepped.cues) {
        if (cue === 'cup') SoundManager.play(SFX.cup);
        else if (cue === 'settle') SoundManager.play(SFX.wood, { volume: 0.6 });
        else if (cue === 'chute') SoundManager.play(SFX.chute);
        else if (cue === 'cradle') {
          SoundManager.play(SFX.cradle);
          playHaptic('light');
        }
      }
      if (stepped.done) {
        ball.visible = true;
        ball.position.set(...BALL_START);
        ballReturnRef.current = null;
        ballPrevPosRef.current = null;
        spinRef.current.set(0, 0, 0);
        if (simRef.current.balls >= simRef.current.ballsAllowed) {
          phaseRef.current = 'over';
          const finalScore = scoreRef.current;
          const best = finalScore > 0 && finalScore > (bestScoreCacheRef.current ?? 0);
          SoundManager.play(best ? SFX.best : SFX.over);
          if (best) playHaptic('win');
          gameOverTimeRef.current = performance.now() + (rm ? 0 : 500);
          setRunStats({ ...runStatsRef.current });
          window.setTimeout(() => {
            if (phaseRef.current !== 'over') return;
            gameStateRef.current = 'gameover';
            setGameState('gameover');
          }, rm ? 0 : 500);
          void saveScoreRef.current?.(finalScore, throwsRef.current);
        } else {
          phaseRef.current = 'aim';
          kbRef.current = { aim: 0, power: KB_DEFAULT_POWER };
          display.bonus = skeeBallBonusFor(seedRef.current ?? 0, simRef.current.balls);
        }
      }
    }

    // Aiming: the ball follows the pull with a little weight, and the arrow
    // on the lane shows where and how hard it will go.
    const drag = dragRef.current;
    const kbLive = !drag && wall < kbPreviewUntilRef.current;
    const aiming = gameStateRef.current === 'playing' && phaseRef.current === 'aim' && !ret;
    const ghost = ghostArrowRef.current;
    const ghostMat = ghostArrowMatRef.current;
    if (ball && aiming) {
      const live = drag ?? (kbLive ? kbRef.current : null);
      const power = live ? live.power : SKEE_MIN_POWER;
      const aim = live ? live.aim : 0;
      const pull = live ? (power - SKEE_MIN_POWER) / (SKEE_MAX_POWER - SKEE_MIN_POWER) : 0;
      const tx = BALL_START[0] + (drag ? (screenAimToSim(aim) / SKEE_MAX_AIM) * 0.3 : 0);
      const ty = BALL_START[1] + (drag ? 0.03 : 0);
      const tz = BALL_START[2] - (drag ? pull * 0.45 : 0);
      const rate = rm ? 1000 : 18;
      ball.position.set(
        expDamp(ball.position.x, tx, rate, dt),
        expDamp(ball.position.y, ty, rate, dt),
        expDamp(ball.position.z, tz, rate, dt),
      );
      if (ghost && ghostMat) {
        if (live) {
          const simAim = screenAimToSim(aim);
          ghost.visible = true;
          ghost.position.set(ball.position.x, 0, ball.position.z + 0.3);
          ghost.rotation.y = Math.atan2(simAim, power);
          ghost.scale.set(1, 1, 0.75 + pull * 1.15);
          const [r, g, b] = powerColor(pull);
          ghostMat.color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
          ghostMat.opacity = 0.9;
          ghostAnimRef.current = null;
        } else if (!ghostAnimRef.current) {
          ghost.visible = false;
        }
      }
    }

    // At rest the ball still needs its contact shadow, or it floats above the
    // cradle in every idle and aim frame.
    if (ball && ball.visible && !flightRef.current && !ret) {
      placeContactShadow(ball.position.x, ball.position.y, ball.position.z);
    }

    // Squash on landing: the group scales, the spinning mesh sinks so the
    // ball stays on the deck.
    if (ball) {
      const squash = squashRef.current;
      const sq = squash
        ? squashAt(now - squash.start, { force: squash.force, reduced: rm })
        : { scaleX: 1, scaleY: 1 };
      ball.scale.set(sq.scaleX, sq.scaleY, sq.scaleX);
      const spin = ballSpinRef.current;
      if (spin) spin.position.y = -(1 - sq.scaleY) * SKEE_BALL_R;
      if (squash && now - squash.start > 400) squashRef.current = null;
    }

    // The sprung spout flap answers the ball's proximity rather than a timer,
    // so the hand-off out of the collector always lines up with the geometry.
    const flap = spoutFlapRef.current;
    if (flap) {
      let open = 0;
      if (ball && ball.visible && phaseRef.current === 'return') {
        const dx = ball.position.x - SPOUT[0];
        const dz = ball.position.z - SPOUT[2];
        open = clampNum(1 - (dx * dx + dz * dz) / 0.55, 0, 1);
      }
      flap.rotation.x = expDamp(flap.rotation.x, -0.95 * open, 14, dt);
    }

    // Particles: capped pools, integrated allocation-free.
    stepSpriteParticles(dustPoolRef.current, dt, 1.6, 1.5);
    stepSpriteParticles(sparkPoolRef.current, dt, 5.2, 2.4);

    // After release the arrow stays as a read-back and fades over 650 ms.
    const ghostAnim = ghostAnimRef.current;
    if (ghostAnim && ghost && ghostMat) {
      const fade = clampNum((now - ghostAnim.start) / 650, 0, 1);
      ghostMat.opacity = 0.85 * (1 - fade);
      if (fade >= 1) {
        ghost.visible = false;
        ghostAnimRef.current = null;
      }
    }

    // Camera: restrained pointer parallax (mouse only), plus the shake.
    const par = parallaxRef.current;
    const parTarget = rm ? { x: 0, y: 0 } : parallaxTargetRef.current;
    par.x = expDamp(par.x, parTarget.x, 6, dt);
    par.y = expDamp(par.y, parTarget.y, 6, dt);
    const shake = shakeOffset(wall);
    camera.position.set(
      CAM_POS[0] + par.x * 0.12 + shake.x * SHAKE_UNITS_PER_PX,
      CAM_POS[1] + par.y * 0.08 - shake.y * SHAKE_UNITS_PER_PX,
      CAM_POS[2],
    );
    camera.lookAt(...CAM_LOOK);

    // The ring the ball landed in flashes: fast in, eased out.
    const pulse = impactPulseRef.current;
    if (pulse) {
      const age = (now - pulse.start) / (rm ? 120 : 280);
      const mat = pulse.material;
      mat.emissive.copy(LABEL_FLASH);
      mat.emissiveIntensity = age >= 1 ? 0 : rm ? 0.8 : 1.1 * (1 - settleEase(clampNum(age, 0, 1)));
      if (age >= 1) impactPulseRef.current = null;
    }

    // The lit ring breathes, and its painted value is a lamp.
    const mats = themeMatsRef.current;
    const playing = gameStateRef.current === 'playing';
    const litRing = playing && (phaseRef.current === 'aim' || phaseRef.current === 'flight')
      ? display.bonus.ring
      : null;
    const breathe = rm ? 1 : 0.5 + 0.5 * Math.sin(now / 260);
    if (mats) {
      const theme = themeRef.current;
      const ringMats: Array<[number, THREE.MeshStandardMaterial, string]> = [
        [10, mats.ring10, theme.ring10],
        [20, mats.ring20, theme.ring20],
        [30, mats.ring30, theme.ring30],
        [40, mats.ring40, theme.ring40],
        [50, mats.ring50, theme.ring50],
        [100, mats.pocket, theme.pocket],
      ];
      for (const [ring, mat, base] of ringMats) {
        if (ring === litRing && !rm) mat.color.set(base).multiplyScalar(0.82 + 0.18 * breathe);
        else mat.color.set(base);
      }
    }
    const punch = labelPunchRef.current;
    for (const label of ringLabelsRef.current) {
      let scale = 1;
      if (label.ring === litRing) {
        label.mat.color.copy(LABEL_LIT).lerp(LABEL_FLASH, 0.35 * breathe);
      } else {
        label.mat.color.copy(LABEL_UNLIT);
      }
      if (punch && punch.ring === label.ring) {
        const age = (now - punch.start) / 220;
        if (age < 1) {
          if (!rm) scale = 1.35 - 0.35 * springEase(clampNum(age, 0, 1));
          label.mat.color.copy(LABEL_FLASH);
        }
      }
      label.mesh.scale.set(scale, scale, 1);
    }
    if (punch && now - punch.start > 260) labelPunchRef.current = null;

    // "+30" is the callout plate: in on the spring, a short drift up, out
    // upward, on the callout's own curve.
    const pts = pointsSpriteRef.current;
    if (pts) {
      const age = (now - pts.start) / calloutLifeMs(rm);
      if (age >= 0 && age < 1) {
        const frame = calloutFrameAt(age, rm);
        pts.sprite.visible = true;
        pts.sprite.position.set(pts.from.x, pts.from.y - frame.lift * POINTS_PLATE_WORLD_H, pts.from.z);
        pts.sprite.scale.set(frame.scale, 0.5 * frame.scale, 1);
        (pts.sprite.material as THREE.SpriteMaterial).opacity = frame.opacity;
      } else {
        pts.sprite.visible = false;
      }
    }

    // The cabinet head: the score rolls, and it repaints only on a change.
    const roll = displayRollRef.current;
    if (roll.to !== display.score && roll.start > 0) {
      const k = clampNum((now - roll.start) / 600, 0, 1);
      display.score = k >= 1 || rm ? roll.to : roll.from + (roll.to - roll.from) * settleEase(k);
    }
    const disp = displayRef.current;
    if (disp) {
      const message = display.message && now < display.message.until ? display.message.text : '';
      const key = `${Math.round(display.score)}|${display.ballsUsed}/${display.ballsAllowed}|${display.showTarget ? display.target : ''}|${display.bonus.ring}x${display.bonus.mult}|${message}`;
      if (key !== disp.painted) {
        paintDisplay(disp.canvas, display, now);
        disp.texture.needsUpdate = true;
        disp.painted = key;
      }
    }

    // The power trail over the stage: the last 140 ms of the stroke while
    // dragging, then the release stroke fading over 260 ms.
    // Untouched when there is nothing to draw, so the layer never
    // repaints between flicks.
    const trailCanvas = trailCanvasRef.current;
    const tctx =
      trailCanvas && (drag || trailRef.current || trailDrawnRef.current) ? trailCanvas.getContext('2d') : null;
    if (trailCanvas && tctx) {
      const rect = trailCanvas.getBoundingClientRect();
      const scaleX = trailCanvas.width / Math.max(1, rect.width);
      tctx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
      trailDrawnRef.current = false;
      let points: Array<{ x: number; y: number }> | null = null;
      let color: [number, number, number] = POWER_STOPS[0][1];
      let alpha = 1;
      if (drag && drag.samples.length > 1) {
        // Wall time: a finger that stops lets its trail run out.
        const recent = drag.samples.filter((p) => p.t >= performance.now() - 160);
        points = recent.map((p) => ({ x: p.x - rect.left, y: p.y - rect.top }));
        color = powerColor(flickPower(drag.samples) ?? 0);
      } else if (trailRef.current) {
        const age = (wall - trailRef.current.releasedAt) / 260;
        if (age >= 1 || rm) {
          trailRef.current = null;
        } else {
          points = trailRef.current.points;
          color = trailRef.current.color;
          alpha = 1 - settleEase(age);
        }
      }
      if (points && points.length > 1) {
        trailDrawnRef.current = true;
        const n = points.length;
        tctx.lineCap = 'round';
        tctx.lineJoin = 'round';
        for (let i = 1; i < n; i += 1) {
          const f = i / (n - 1);
          tctx.strokeStyle = `rgba(${color[0] | 0}, ${color[1] | 0}, ${color[2] | 0}, ${(alpha * (0.25 + 0.75 * f)).toFixed(3)})`;
          tctx.lineWidth = (3 + 19 * f) * scaleX;
          tctx.beginPath();
          tctx.moveTo(points[i - 1].x * scaleX, points[i - 1].y * scaleX);
          tctx.lineTo(points[i].x * scaleX, points[i].y * scaleX);
          tctx.stroke();
        }
      }
    }

    const canvasEl = canvasRef.current;
    if (canvasEl && canvasEl.dataset.skeePhase !== (aiming ? 'aim' : phaseRef.current)) {
      canvasEl.dataset.skeePhase = aiming ? 'aim' : phaseRef.current;
    }

    renderer.render(scene, camera);
  }, [hitStopClock, resolveFlight, shakeOffset]);

  renderSceneRef.current = renderScene;

  const resize3D = useCallback((w: number, h: number) => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!renderer || !camera) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }, []);

  // ── The throw: the ONE scored action. Release params are judged by the
  //    shared state machine the server replays; only {t, aim, power} is sent. ──
  const throwBall = useCallback((rawAim: number, rawPower: number) => {
    if (gameStateRef.current !== 'playing' || phaseRef.current !== 'aim') return;
    const seed = seedRef.current;
    if (seed === null) return;

    const aim = r3(clampNum(rawAim, -SKEE_MAX_AIM, SKEE_MAX_AIM));
    const power = r3(clampNum(rawPower, SKEE_MIN_POWER, SKEE_MAX_POWER));
    const t = Math.round(performance.now() - runStartRef.current);

    const applied = skeeApplyThrow(seed, simRef.current, t, aim, power);
    const event = applied.event;
    if (event.type === 'ignored') return;
    if (event.type === 'bounds') return; // cannot happen via the UI

    // Record EVERY counted throw — the validator replays the same stream.
    throwsRef.current.push({ t, aim, power });
    simRef.current = applied.state;
    scoreRef.current = applied.state.score;
    setScore(applied.state.score);
    displayStateRef.current.ballsUsed = applied.state.balls;
    displayStateRef.current.ballsAllowed = applied.state.ballsAllowed;
    runStatsRef.current.balls = applied.state.balls;
    dragRef.current = null;
    kbPreviewUntilRef.current = 0;

    // The ball is the shared sim, stepped live in renderScene. A copy runs
    // ahead here only to schedule the rumble: its speed while it touches a
    // surface, silence in the air.
    const ahead = skeeStartThrow(aim, power);
    const speeds: number[] = [];
    while (ahead.phase !== 'done' && ahead.steps < 16 * 240) {
      skeeStep(ahead);
      if (ahead.steps % 4 === 0) {
        speeds.push(ahead.contact ? Math.min(1, Math.hypot(ahead.vx, ahead.vy, ahead.vz) / 11) : 0);
      }
    }
    stopRollRef.current();
    stopRollRef.current = SoundManager.playRoll(speeds, (speeds.length * 4 * SKEE_STEP_MS) / 1000, { volume: 1.1 });
    const start = effectNow();
    const play = createSkeePlayback(aim, power);
    const hand = ballRef.current?.position;
    flightRef.current = {
      play,
      event,
      offset: hand
        ? [hand.x - play.state.x, hand.y - play.state.y, hand.z - play.state.z]
        : [0, 0, 0],
      age: 0,
      decided: false,
    };
    spinRef.current.set(0, 0, 0);
    ballPrevPosRef.current = null;
    phaseRef.current = 'flight';

    // The arrow stays on the lane as a read-back and fades.
    const powerNorm = (power - SKEE_MIN_POWER) / (SKEE_MAX_POWER - SKEE_MIN_POWER);
    const ghost = ghostArrowRef.current;
    if (ghost) {
      ghost.rotation.y = Math.atan2(aim, power);
      ghost.scale.set(1, 1, 0.75 + powerNorm * 1.15);
      ghost.visible = true;
      const [r, g, b] = powerColor(powerNorm);
      ghostArrowMatRef.current?.color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
      ghostAnimRef.current = { start };
    }

    // Release: a puff of lane dust scaled by how hard the ball was let go.
    if (!reducedMotionRef.current) {
      emitSpriteParticles(
        dustPoolRef.current,
        midwayParticleCount(3, qualityRef.current?.tier() ?? 'medium'),
        {
          origin: [BALL_START[0], 0.04, BALL_START[2] + 0.1],
          spread: 0.22,
          speed: [0.2, 0.6],
          up: [0.15, 0.5],
          ttl: [0.28, 0.46],
          size: [0.55, 1.0],
          grow: 2.2,
          fade: 0.16 + powerNorm * 0.14,
          spin: 1.5,
        },
      );
    }

    SoundManager.play(SFX.roll, { volume: 0.7 });
    playHaptic('tap');
  }, [effectNow]);

  const resetRun = useCallback(() => {
    scoreRef.current = 0;
    setScore(0);
    runStatsRef.current = { rings: 0, pockets: 0, balls: 0 };
    setRunStats({ rings: 0, pockets: 0, balls: 0 });
    stopRollRef.current();
    trailRef.current = null;
    kbPreviewUntilRef.current = 0;
    squashRef.current = null;
    labelPunchRef.current = null;
    if (pointsSpriteRef.current) pointsSpriteRef.current.start = -Infinity;
    displayStateRef.current = {
      score: 0,
      ballsUsed: 0,
      ballsAllowed: SKEE_BALLS_PER_SESSION,
      target: dailyTarget,
      showTarget: false,
      bonus: skeeBallBonusFor(seedRef.current ?? 0, 0),
      message: null,
    };
    displayRollRef.current = { from: 0, to: 0, start: 0 };
    simRef.current = skeeInitialState();
    throwsRef.current = [];
    phaseRef.current = 'aim';
    dragRef.current = null;
    flightRef.current = null;
    ballReturnRef.current = null;
    ballPrevPosRef.current = null;
    ghostAnimRef.current = null;
    // Dropping the pulse is not enough on its own — the ring material keeps
    // whatever emissive the loop last wrote, and only the practicals may glow.
    const pulse = impactPulseRef.current;
    if (pulse) pulse.material.emissiveIntensity = 0;
    impactPulseRef.current = null;
    if (ghostArrowRef.current) ghostArrowRef.current.visible = false;
    if (landingShadowRef.current) landingShadowRef.current.visible = false;
    if (spoutFlapRef.current) spoutFlapRef.current.rotation.x = 0;
    resetSpriteParticles(dustPoolRef.current);
    resetSpriteParticles(sparkPoolRef.current);
    kbRef.current = { aim: 0, power: KB_DEFAULT_POWER };
    const ball = ballRef.current;
    if (ball) {
      ball.visible = true;
      ball.position.set(...BALL_START);
      ball.scale.set(1, 1, 1);
      ballSpinRef.current?.rotation.set(0, 0, 0);
    }
    runStartRef.current = performance.now();
    gameStartTimeRef.current = runStartRef.current;
  }, [dailyTarget]);

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
        body: JSON.stringify({ gameType: 'skee-ball' }),
      });
      if (sessionResponse.ok) {
        setBanIndefinite(false);
        setBanUntilMs(null);
        const sessionData = await sessionResponse.json();
        sessionTokenRef.current = sessionData.token;
        seedRef.current =
          typeof sessionData.skeeBallSeed === 'number'
            ? sessionData.skeeBallSeed
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
    SoundManager.play(SFX.start);
  }, [resetRun, resetRunResult]);

  // ── Generic "primary action": start / restart ──
  const primaryAction = useCallback(() => {
    const current = gameStateRef.current;
    // A run starts from the shell's first input or the result's rematch;
    // this only restarts from the result with space.
    if (current === 'gameover') {
      const since = performance.now() - gameOverTimeRef.current;
      if (since >= RESTART_GRACE_PERIOD) startGame();
    }
  }, [startGame]);

  // ── Flick input: pull back to load, flick forward and release to roll.
  //    Release velocity (from coalesced pointer samples) sets power, the
  //    flick angle sets aim. A slow release falls back to the pull mapping. ──
  const cancelDrag = useCallback(() => {
    // The ball eases back into the cradle (renderScene).
    dragRef.current = null;
  }, []);

  const updateDrag = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    drag.maxPullPx = Math.max(drag.maxPullPx, dy);
    drag.aim = clampNum((dx / DRAG_AIM_PX) * SKEE_MAX_AIM, -SKEE_MAX_AIM, SKEE_MAX_AIM);
    drag.power = clampNum(
      SKEE_MIN_POWER + (dy / DRAG_POWER_PX) * (SKEE_MAX_POWER - SKEE_MIN_POWER),
      SKEE_MIN_POWER,
      SKEE_MAX_POWER,
    );
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (gameStateRef.current !== 'playing' || phaseRef.current !== 'aim') return;
      // The press answers in this frame: a click, a tap, the ball lifts.
      trigger('press', { haptic: true });
      trailRef.current = null;
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        aim: 0,
        power: SKEE_MIN_POWER,
        maxPullPx: 0,
        samples: [{ x: e.clientX, y: e.clientY, t: performance.now() }],
      };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [trigger],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) {
        // Not dragging: feed the restrained pointer parallax (mouse only).
        if (!drag && e.pointerType === 'mouse') {
          const rect = e.currentTarget.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            parallaxTargetRef.current = {
              x: clampNum(((e.clientX - rect.left) / rect.width) * 2 - 1, -1, 1),
              y: clampNum(((e.clientY - rect.top) / rect.height) * 2 - 1, -1, 1),
            };
          }
        }
        return;
      }
      e.preventDefault();
      // Coalesced samples give a dense, accurate velocity read at release.
      const native = e.nativeEvent;
      const coalesced =
        typeof native.getCoalescedEvents === 'function'
          ? native.getCoalescedEvents()
          : [];
      const points = coalesced.length > 0 ? coalesced : [native];
      // Event time, not handler time: on a busy main thread the handler runs
      // late, and the flick window must still see the samples.
      const now = native.timeStamp > 0 ? native.timeStamp : performance.now();
      for (const p of points) {
        drag.samples.push({
          x: p.clientX,
          y: p.clientY,
          t: typeof p.timeStamp === 'number' && p.timeStamp > 0 ? p.timeStamp : now,
        });
      }
      const horizon = now - FLICK_SAMPLE_KEEP_MS;
      while (drag.samples.length > 2 && drag.samples[0].t < horizon) {
        drag.samples.shift();
      }
      updateDrag(e);
    },
    [updateDrag],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      e.preventDefault();
      const now = e.timeStamp > 0 ? e.timeStamp : performance.now();
      drag.samples.push({ x: e.clientX, y: e.clientY, t: now });
      const { aim: pullAim, power: pullPower, maxPullPx, samples } = drag;
      dragRef.current = null;
      // The stroke stays on the stage as the power trail and fades.
      const rect = e.currentTarget.getBoundingClientRect();
      const tail = samples.filter((p) => p.t >= now - 160);
      trailRef.current = {
        points: tail.map((p) => ({ x: p.x - rect.left, y: p.y - rect.top })),
        color: powerColor(flickPower(samples) ?? (pullPower - SKEE_MIN_POWER) / (SKEE_MAX_POWER - SKEE_MIN_POWER)),
        releasedAt: now,
      };

      // Release velocity over the flick window, from event timestamps.
      const v = flickVelocity(samples) ?? { forward: 0, side: 0 };
      const forwardSpeed = v.forward;
      const sideSpeed = Math.abs(v.side);

      // A deliberate mostly-sideways swipe cancels the throw.
      if (
        sideSpeed >= CANCEL_SWIPE_MIN_SPEED &&
        sideSpeed > Math.abs(forwardSpeed) * CANCEL_SWIPE_RATIO
      ) {
        cancelDrag();
        return;
      }

      if (forwardSpeed >= FLICK_MIN_SPEED) {
        // A flick: its speed is the launch speed, its slant the aim, both on
        // straight lines (_skee-flick.ts), so the same flick throws the
        // same ball.
        const release = flickToRelease(forwardSpeed, v.side);
        throwBall(release.aim, release.power);
        return;
      }

      // Slow release: keep the classic pull-distance mapping.
      if (maxPullPx < DRAG_DEADZONE_PX) {
        // Accidental tap — cancel the throw, keep the ball.
        cancelDrag();
        return;
      }
      throwBall(screenAimToSim(pullAim), pullPower);
    },
    [cancelDrag, throwBall],
  );

  // pointercancel (browser stole the pointer: scroll, alt-tab, palm-reject)
  // must CANCEL the pending throw — never release it as a live roll.
  const handlePointerCancel = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      cancelDrag();
    },
    [cancelDrag],
  );

  const handlePointerLeave = useCallback(() => {
    parallaxTargetRef.current = { x: 0, y: 0 };
  }, []);

  // ── Keyboard: arrows tune aim/power, Space rolls; Space/Enter starts ──
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (isControlTarget(e.target) || isDialogOpen()) return;
      const playing = gameStateRef.current === 'playing';
      if (!playing) {
        if (gameStateRef.current === 'gameover' && (e.code === 'Space' || e.code === 'Enter')) {
          e.preventDefault();
          primaryAction();
        }
        return;
      }
      if (phaseRef.current !== 'aim') return;
      const kb = kbRef.current;
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault();
        kb.aim = clampNum(
          kb.aim + (e.code === 'ArrowLeft' ? -KB_AIM_STEP : KB_AIM_STEP),
          -SKEE_MAX_AIM,
          SKEE_MAX_AIM,
        );
      } else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        e.preventDefault();
        kb.power = clampNum(
          kb.power + (e.code === 'ArrowUp' ? KB_POWER_STEP : -KB_POWER_STEP),
          SKEE_MIN_POWER,
          SKEE_MAX_POWER,
        );
      } else if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        trigger('press', { haptic: true });
        throwBall(screenAimToSim(kb.aim), kb.power);
        return;
      } else {
        return;
      }
      // The arrow on the lane shows the tuned throw for 1.6 s.
      kbPreviewUntilRef.current = performance.now() + 1600;
      trigger('press');
    },
    [primaryAction, throwBall, trigger],
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
  // before the first render), draw the first frame, then paint the decoration.
  useEffect(() => {
    if (!canvasSize) return;
    buildScene(canvasSize.width, canvasSize.height);
    // A skin that arrived before the scene existed paints its pictures now.
    applySkeeTheme();
    resize3D(canvasSize.width, canvasSize.height);
    const trail = trailCanvasRef.current;
    if (trail) {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      trail.width = Math.round(canvasSize.width * ratio);
      trail.height = Math.round(canvasSize.height * ratio);
    }
    renderScene();
    if (rendererRef.current && !deferredStartedRef.current) {
      deferredStartedRef.current = true;
      // The first frame is on screen: record it, then paint the decoration.
      markMidwayFirstFrame('skee-ball', qualityRef.current?.tier() ?? 'medium');
      setSceneReady(true);
      deferredRef.current?.start(() => {
        if (gameStateRef.current !== 'playing') renderSceneRef.current();
      });
    }
  }, [buildScene, applySkeeTheme, resize3D, renderScene, canvasSize]);

  useEffect(() => {
    const loop = createGameFrameLoop({
      // The server has already judged each throw before visual playback. Keep
      // trajectory/return ceremonies wall-clock driven while the shared
      // runtime owns RAF, visibility pausing, and resume clock reset.
      simulate: () => {},
      render: (_alpha, frame) => {
        // A tier change waits while the player is aiming: a recompile there
        // would stall the input being timed.
        qualityRef.current?.hold(
          gameStateRef.current === 'playing' && phaseRef.current === 'aim',
        );
        qualityRef.current?.frame(frame.nowMs, frame.deltaMs);
        renderSceneRef.current(frame);
        if (gameStateRef.current !== "playing") loop.stop();
      },
    });
    frameLoopRef.current = loop;
    return () => {
      loop.destroy();
      if (frameLoopRef.current === loop) frameLoopRef.current = null;
    };
  }, []);

  // Apply equipped cosmetics to the live scene (and re-render the idle frame).
  useEffect(() => {
    themeRef.current = skeeTheme;
    applySkeeTheme();
    if (gameStateRef.current !== 'playing') {
      renderScene();
    }
  }, [skeeTheme, applySkeeTheme, renderScene]);

  // Keyboard listeners.
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
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
      stopRollRef.current();
      frameLoopRef.current?.destroy();
      frameLoopRef.current = null;
      monitor.stop();
      // Dispose the three.js scene — geometries, materials AND textures.
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
      spoutFlapRef.current = null;
      dustPoolRef.current = [];
      sparkPoolRef.current = [];
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
        title={isBest ? 'New best' : score >= dailyTarget ? 'Target beaten' : 'Run over'}
        tone={isBest ? 'best' : 'neutral'}
        stats={[
          { label: 'score', value: score, highlight: isBest },
          { label: 'balls scored', value: `${runStats.rings}/${runStats.balls}` },
          { label: 'target', value: dailyTarget, highlight: score >= dailyTarget },
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
      game='skee-ball'
      className='skee-ball-midway'
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
            game='skee-ball'
            alt={renameGameNamesInText('A skee-ball lane with rings worth 10 to 50.')}
            style={canvasSize ? { width: canvasSize.width, height: canvasSize.height } : undefined}
          />
        ) : (
          <>
            {/* three.js renders into this canvas (it manages the drawing buffer). */}
            <canvas
              ref={canvasRef}
              aria-label={renameGameNamesInText('Skee-ball lane. Pull back and flick up to roll; keyboard players aim with the arrow keys and roll with space.')}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              onPointerLeave={handlePointerLeave}
              className='block cursor-pointer'
              style={{
                touchAction: 'none',
                width: canvasSize?.width ?? '100%',
                height: canvasSize?.height ?? '100%',
              }}
            />
            {/* The power trail, drawn over the stage. */}
            <canvas ref={trailCanvasRef} aria-hidden className='sb-trail' />
            <p className='sr-only' aria-live='polite' aria-atomic='true'>
              {resultAnnouncement}
            </p>
          </>
        )}
      </GameStage>

      <GameLeaderboardModal
        open={showLeaderboard}
        onOpenChange={setShowLeaderboard}
        title={renameGameNamesInText('Skee-ball board')}
        description='Highest frame scores, and your rank.'
      >
        <GameLeaderboard
          gameType='skee-ball'
          maxEntries={5}
          enableFullLeaderboardModal
          fullLeaderboardDisplay='inline'
          refreshKey={leaderboardRefreshKey}
        />
      </GameLeaderboardModal>
    </GameShell>
  );
}
