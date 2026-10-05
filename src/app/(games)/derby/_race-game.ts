/* Derby's stage: the water race, drawn flat on one canvas, as you'd see it
   sitting at the booth's counter. The backboard on top (eight rails, a toy
   horse on each, the wire and the bell), your target wall under it, and
   the counter with your water gun at the bottom. Plain TypeScript, no
   React: the client owns the shell, the network and the result; this owns
   the canvas, your aim and every frame.

   Every moving thing is a function of the race clock. The target is the
   shared path at now. A horse is the shared race model's distance at now:
   yours from your own aim (on the frame it happens), a bot's from the seed,
   another person's from what the server has sent, carried forward at their
   last speed until the next news. News that moves a horse folds into an
   offset that decays, and no horse ever steps backwards, so nothing jumps. */

import {
  DERBY_AIM_MAX_STEP,
  DERBY_AIM_SCALE,
  DERBY_BULL,
  DERBY_COUNTDOWN_MS,
  DERBY_DISTANCE,
  DERBY_FIELD_X,
  DERBY_FIELD_Y,
  DERBY_LANE_COLORS,
  DERBY_LANES,
  DERBY_MAX_TICKS,
  DERBY_TARGET_R,
  DERBY_TICK_MS,
  DERBY_TOP_SPEED,
  DerbyRaceModel,
  derbySpeedShare,
  derbyTargetAt,
  type DerbyConfirm,
  type DerbyLaneSpec,
  type DerbyResult,
} from '@/features/arcade/lib/derby';
import { feelReducedMotion, semitonesToPitch } from '@/features/arcade/lib/game-feel';
import { createGameFrameLoop, type GameFrameHitStop, type GameFrameLoop } from '@/features/arcade/lib/game-frame-loop';
import { playHaptic } from '@/features/arcade/lib/game-haptics';
import { markMidwayFirstFrame } from '@/features/arcade/lib/midway-quality';
import { MATERIAL_TILE, paintMaterialTile } from '@/features/arcade/lib/skins/skin-material-canvas';
import { mixHex } from '@/features/arcade/lib/skins/skin-set';
import { SoundManager } from '@/features/arcade/lib/sound-manager';


import { HOUSE_LOOK, type DerbyHorseMake, type DerbyLook } from './_race-theme';

/** Width over height of the stage on a phone, and on a wide screen. */
export const STAGE_ASPECT = 0.6;
export const STAGE_ASPECT_WIDE = 1.22;
/** A finished race shows its moment this long before the result. */
export const FINISH_MOMENT_MS = 2_200;

/** How fast late news is folded in: the offset halves in about 110 ms. */
const OFFSET_DECAY = 6.5;
/** A finger drag moves the aim this many times as far as the finger. */
const TOUCH_GAIN = 1.3;
/** Keyboard aim speed (field units a second), and after a held second. */
const KEY_SPEED = 0.9;
const KEY_SPEED_FAST = 1.6;
/** Ticks older than this when the page samples them (a stalled tab) are dry:
 *  the server would drop them anyway. */
const STALE_MS = 600;
/** Another person's horse runs on at its last speed for this long, fading. */
const PREDICT_TAU = 800;

const C = {
  paper: '#f4ebdc',
  paper2: '#eadfcb',
  ink: '#1f1a16',
  ticket: '#f2a33c',
  red: '#c8402f',
  water: '#8fd3f4',
  waterCore: '#eaf8ff',
  brass: '#c79a4c',
  brassHi: '#f0d79a',
};

const COATS = ['#8a4b2a', '#b98a5a', '#3b2b22', '#c97b3f', '#6b4a33', '#d9b98c', '#5a3a1c', '#a0522d'];

export type RaceGamePhase = 'idle' | 'countdown' | 'racing' | 'finish';

export type RaceGameEvents = {
  onPhase: (phase: RaceGamePhase) => void;
  onCountdown: (value: number | 'go' | null) => void;
  /** The winner reached the wire (or the time ran out). Once per race. */
  onFinish: (result: DerbyResult) => void;
  onReady: () => void;
  /** A short line for screen readers. */
  onAnnounce: (text: string) => void;
};

export type RaceGameFeedback = {
  hitStop: GameFrameHitStop;
  trigger: (event: 'impact' | 'collect' | 'round-win' | 'loss' | 'press', options?: Record<string, unknown>) => void;
  shakeOffset: (now: number) => { x: number; y: number };
};

export type RaceGameHud = {
  /** The big callout over the backboard: your place, "photo finish". */
  callout: HTMLElement | null;
};

export type RaceSetup = {
  seed: number;
  lanes: DerbyLaneSpec[];
  myLane: number;
  /** Race ms (0 is the gate opening) at a performance.now() time. */
  clock: (perfMs: number) => number;
  /** A practice race on this device: your aim is final as you make it. */
  local: boolean;
};

type Rect = { x: number; y: number; w: number; h: number };

type Layout = {
  wide: boolean;
  board: Rect;
  rowsTop: number;
  rowH: number;
  discX: number;
  discR: number;
  startX: number;
  finishX: number;
  horseL: number;
  wall: Rect;
  field: Rect;
  /** Pixels per field unit. */
  unit: number;
  counter: Rect;
  pivot: { x: number; y: number };
  gunLen: number;
  placeAt: { x: number; y: number; size: number };
};

type Drop = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  ttl: number;
  r: number;
  kind: 0 | 1 | 2 | 3; // 0 spray, 1 drip, 2 ripple, 3 dust
  color: string;
};

const DROPS = 160;

function canvasFont(kind: 'text' | 'num', weight: number, px: number): string {
  const variable = kind === 'num' ? '--font-big-shoulders' : '--font-gabarito';
  let family = '';
  if (typeof document !== 'undefined') family = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  const fallback = kind === 'num' ? 'Big Shoulders, Gabarito' : 'Gabarito';
  return `${weight} ${Math.round(px)}px ${family ? `${family}, ` : ''}${fallback}, system-ui, sans-serif`;
}

export function ordinalOf(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const suffix = n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

export class DerbyRaceGame {
  private readonly canvas: HTMLCanvasElement;
  private readonly hud: RaceGameHud;
  private readonly feedback: RaceGameFeedback;
  private readonly events: RaceGameEvents;
  private ctx: CanvasRenderingContext2D | null = null;
  private loop: GameFrameLoop | null = null;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private L: Layout | null = null;
  private look: DerbyLook = HOUSE_LOOK;
  private layers: { back: HTMLCanvasElement | null } = { back: null };
  private numFont = '';
  private numFamily = '';

  // Race state.
  private setup: RaceSetup | null = null;
  private model: DerbyRaceModel | null = null;
  private result: DerbyResult | null = null;
  /** A result the server sent before this phone could decide it. */
  private serverResult: DerbyResult | null = null;
  private finishPerf = 0;
  private finishClock = 0;
  private phase: RaceGamePhase = 'idle';
  private countdownShown: number | 'go' | null = null;
  private targetHint = 0;
  private target = { x: 0, y: 0 };

  // Horses on screen.
  private shown = new Float64Array(DERBY_LANES);
  private offsets = new Float64Array(DERBY_LANES);
  private stride = new Float64Array(DERBY_LANES);
  private pace = new Float64Array(DERBY_LANES);
  private atFinish = new Float64Array(DERBY_LANES);
  private finishSpeed = new Float64Array(DERBY_LANES);
  private place = 0;
  private placePop = -1e9;
  private placeDir = 0;
  /** When the leader turned into the last stretch, or 0. */
  private lastStretch = 0;
  private lastStep = 0;

  // Your aim.
  private raw = { x: 0, y: 0 };
  private aim = { x: 0, y: 0 };
  private prevAim = { x: 0, y: 0 };
  private prevRace = 0;
  private pointer: { id: number; type: string; x: number; y: number } | null = null;
  private keys = new Set<string>();
  private keyHeldAt = 0;
  private keySquirt = false;
  private debugSquirt = false;
  private mine = new Int32Array(DERBY_MAX_TICKS * 3);
  /** Ticks of your aim sampled so far. */
  private sampled = 0;
  private lastSample: [number, number, number] = [0, 0, 0];

  // Water and feel.
  private head = 0;
  private tail = 0;
  private share = 0;
  private ring = 0;
  private onTarget = false;
  private onBull = false;
  private bullFlash = -1e9;
  private lastBullTick = -1e9;
  private sprayClock = 0;
  private rippleClock = 0;
  private drops: Drop[] = [];
  private dropNext = 0;
  private jet: ReturnType<typeof SoundManager.startWaterJet> | null = null;
  private clopAt = new Float64Array(DERBY_LANES);
  private lastFrame = 0;
  private work = new Float64Array(600);
  private workNext = 0;
  private sync = { remote: 0, late: 0, maxLateMs: 0, maxOffset: 0, gaps: 0, ages: [] as number[] };

  constructor(canvas: HTMLCanvasElement, hud: RaceGameHud, feedback: RaceGameFeedback, events: RaceGameEvents) {
    this.canvas = canvas;
    this.hud = hud;
    this.feedback = feedback;
    this.events = events;
    for (let i = 0; i < DROPS; i += 1) {
      this.drops.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, ttl: 0, r: 0, kind: 0, color: C.water });
    }
  }

  /** Set up the canvas and draw the first frame. False without a 2D context. */
  build(width: number, height: number): boolean {
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) return false;
    this.ctx = ctx;
    this.resize(width, height);
    this.renderFrame(performance.now(), 0, false);
    markMidwayFirstFrame('derby', 'high');
    this.loop = createGameFrameLoop({
      simulate: () => {},
      hitStop: this.feedback.hitStop,
      render: (_alpha, frame) => this.renderFrame(frame.nowMs, frame.deltaMs, frame.frozen),
    });
    this.loop.start();
    this.events.onReady();
    // The faces load after the first frame: draw the lettering again then.
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        this.numFamily = '';
        this.paintLayers();
      });
    }
    return true;
  }

  /** A skin set (or the house look): repaints the booth, remakes the horses
   *  and tints the sounds. */
  applyLook(look: DerbyLook) {
    if (look.key === this.look.key) return;
    this.look = look;
    SoundManager.setTint(look.tint);
    this.paintLayers();
  }

  resize(width: number, height: number) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    const raw = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.dpr = Math.min(2, Math.max(1, raw));
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.L = this.layout(this.width, this.height);
    this.paintLayers();
  }

  private layout(W: number, H: number): Layout {
    const wide = W / H > 0.95;
    const pad = 6;
    const board: Rect = { x: pad, y: pad, w: W - pad * 2, h: Math.round(H * (wide ? 0.43 : 0.43)) };
    const rowsTop = board.y + 10;
    const rowH = (board.h - 18) / DERBY_LANES;
    const discR = Math.min(rowH * 0.36, 13);
    const discX = board.x + 8 + discR;
    const horseL = rowH * 1.12;
    const startX = discX + discR + 6 + horseL;
    const finishX = board.x + board.w - 16;
    const counterH = Math.round(H * (wide ? 0.14 : 0.13));
    const counter: Rect = { x: 0, y: H - counterH, w: W, h: counterH };
    const wallTop = board.y + board.h + 6;
    const wall: Rect = { x: pad, y: wallTop, w: W - pad * 2, h: counter.y - wallTop - 4 };
    const fw = Math.min(wall.w - 12, (wall.h - 8) * (DERBY_FIELD_X / DERBY_FIELD_Y));
    const fh = fw * (DERBY_FIELD_Y / DERBY_FIELD_X);
    const field: Rect = { x: W / 2 - fw / 2, y: wall.y + (wall.h - fh) / 2, w: fw, h: fh };
    const unit = fw / (2 * DERBY_FIELD_X);
    const pivot = { x: W / 2, y: counter.y + counterH * 0.62 };
    const placeSize = Math.round(Math.min(44, counterH * 0.6));
    const placeAt = wide
      ? { x: field.x / 2, y: field.y + field.h / 2, size: Math.round(Math.min(56, field.x * 0.4)) }
      : { x: 18, y: counter.y + counterH * 0.55, size: placeSize };
    return {
      wide,
      board,
      rowsTop,
      rowH,
      discX,
      discR,
      startX,
      finishX,
      horseL,
      wall,
      field,
      unit,
      counter,
      pivot,
      gunLen: Math.max(26, counterH * 0.5),
      placeAt,
    };
  }

  private laneY(lane: number): number {
    const L = this.L!;
    return L.rowsTop + L.rowH * (lane + 0.5);
  }

  private noseX(d: number): number {
    const L = this.L!;
    return L.startX + ((L.finishX - L.startX) * d) / DERBY_DISTANCE;
  }

  private fx(x: number): number {
    const L = this.L!;
    return L.field.x + L.field.w / 2 + x * L.unit;
  }

  private fy(y: number): number {
    const L = this.L!;
    return L.field.y + L.field.h / 2 + y * L.unit;
  }

  // ── The still parts, painted once per size and look ──

  private paintLayers() {
    const L = this.L;
    if (!L || typeof document === 'undefined') return;
    const back = this.layers.back ?? document.createElement('canvas');
    this.layers.back = back;
    back.width = this.canvas.width;
    back.height = this.canvas.height;
    const g = back.getContext('2d');
    if (!g) return;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const look = this.look;
    this.numFamily = '';
    // The booth behind everything.
    g.fillStyle = C.ink;
    g.fillRect(0, 0, this.width, this.height);
    // Backboard.
    roundRect(g, L.board.x, L.board.y, L.board.w, L.board.h, 12);
    g.fillStyle = look.infield;
    g.fill();
    // The rails, a groove per lane.
    let pattern: CanvasPattern | null = null;
    if (look.material) {
      const tile = document.createElement('canvas');
      tile.width = MATERIAL_TILE;
      tile.height = MATERIAL_TILE;
      paintMaterialTile(tile, look.material, { base: look.band, alt: mixHex(look.band, C.ink, 0.1), line: look.bandLine }, 'h');
      pattern = g.createPattern(tile, 'repeat');
      if (pattern) {
        const scale = (L.rowH * 1.6) / MATERIAL_TILE;
        pattern.setTransform(new DOMMatrix([scale, 0, 0, scale, 0, 0]));
      }
    }
    const railX = L.discX + L.discR + 4;
    const railW = L.finishX + 10 - railX;
    for (let lane = 0; lane < DERBY_LANES; lane += 1) {
      const y = this.laneY(lane);
      const gh = L.rowH * 0.78;
      roundRect(g, railX, y - gh / 2, railW, gh, gh / 2);
      g.fillStyle = pattern ?? look.band;
      g.fill();
      // The slot the horse rides in.
      g.fillStyle = look.bandLine;
      g.fillRect(railX + gh / 2, y + gh * 0.28, railW - gh, Math.max(1.5, gh * 0.08));
      // The lane's disc in its silks.
      const silk = DERBY_LANE_COLORS[lane]!;
      g.beginPath();
      g.arc(L.discX, y, L.discR, 0, Math.PI * 2);
      g.fillStyle = silk.silk;
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = 'rgba(244,235,220,0.55)';
      g.stroke();
      g.fillStyle = silk.ink;
      g.font = this.font(800, L.discR * 1.25);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(lane + 1), L.discX, y + L.discR * 0.08);
    }
    // The start line and the wire.
    g.fillStyle = 'rgba(244,235,220,0.35)';
    g.fillRect(L.startX - 1, L.rowsTop + 2, 2, L.rowH * DERBY_LANES - 4);
    // Quarter poles.
    g.fillStyle = 'rgba(244,235,220,0.16)';
    for (const q of [0.25, 0.5, 0.75]) {
      g.fillRect(L.startX + (L.finishX - L.startX) * q - 1, L.rowsTop + 2, 2, L.rowH * DERBY_LANES - 4);
    }
    const cell = Math.max(4, L.rowH / 6);
    for (let i = 0; i * cell < L.rowH * DERBY_LANES; i += 1) {
      g.fillStyle = i % 2 ? C.ink : C.paper;
      g.fillRect(L.finishX - 3, L.rowsTop + i * cell, 3, Math.min(cell, L.rowH * DERBY_LANES - i * cell));
      g.fillStyle = i % 2 ? C.paper : C.ink;
      g.fillRect(L.finishX, L.rowsTop + i * cell, 3, Math.min(cell, L.rowH * DERBY_LANES - i * cell));
    }
    g.fillStyle = look.rail;
    g.fillRect(L.finishX - 4, L.rowsTop - 6, 8, 4);
    g.fillRect(L.finishX - 4, L.rowsTop + L.rowH * DERBY_LANES + 2, 8, 4);

    // The target wall.
    roundRect(g, L.wall.x, L.wall.y, L.wall.w, L.wall.h, 12);
    g.fillStyle = mixHex(look.infield, C.ink, 0.25);
    g.fill();
    roundRect(g, L.field.x - 4, L.field.y - 4, L.field.w + 8, L.field.h + 8, 10);
    g.fillStyle = mixHex(look.rail, look.infield, 0.72);
    g.fill();
    roundRect(g, L.field.x, L.field.y, L.field.w, L.field.h, 7);
    g.fillStyle = look.infield;
    g.fill();
    // Faint painted boards behind the target.
    g.save();
    roundRect(g, L.field.x, L.field.y, L.field.w, L.field.h, 7);
    g.clip();
    g.fillStyle = 'rgba(244,235,220,0.035)';
    const plank = Math.max(14, L.unit * 0.2);
    for (let x = L.field.x; x < L.field.x + L.field.w; x += plank * 2) g.fillRect(x, L.field.y, plank, L.field.h);
    g.restore();

    // The counter.
    g.fillStyle = look.board;
    g.fillRect(L.counter.x, L.counter.y, L.counter.w, L.counter.h);
    g.fillStyle = mixHex(look.board, C.paper, 0.18);
    g.fillRect(L.counter.x, L.counter.y, L.counter.w, 3);
    g.fillStyle = mixHex(look.board, C.ink, 0.35);
    g.beginPath();
    g.ellipse(L.pivot.x, L.pivot.y + 4, L.gunLen * 0.62, L.gunLen * 0.26, 0, 0, Math.PI * 2);
    g.fill();
  }

  private font(weight: number, px: number): string {
    if (!this.numFamily) {
      this.numFont = canvasFont('num', 800, 10);
      this.numFamily = this.numFont.replace(/^\d+ \d+px /, '');
    }
    return `${weight} ${Math.round(px)}px ${this.numFamily}`;
  }

  // ── A race ──

  /** Start drawing a race. Samples already known come in through confirm. */
  startRace(setup: RaceSetup) {
    this.setup = setup;
    this.model = new DerbyRaceModel(setup.seed, setup.lanes);
    this.result = null;
    this.serverResult = null;
    this.finishPerf = 0;
    this.finishClock = 0;
    this.shown.fill(0);
    this.offsets.fill(0);
    this.stride.fill(0);
    this.pace.fill(0);
    this.clopAt.fill(0);
    this.place = 0;
    this.placeDir = 0;
    this.lastStretch = 0;
    this.mine.fill(0);
    this.sampled = 0;
    this.lastSample = [0, 0, 0];
    this.raw = { x: 0, y: 0 };
    this.aim = { x: 0, y: 0 };
    this.prevAim = { x: 0, y: 0 };
    this.prevRace = setup.clock(performance.now());
    this.head = 0;
    this.tail = 0;
    this.ring = 0;
    this.onTarget = false;
    this.onBull = false;
    this.targetHint = 0;
    this.countdownShown = null;
    this.sync = { remote: 0, late: 0, maxLateMs: 0, maxOffset: 0, gaps: 0, ages: [] };
    for (const d of this.drops) d.life = 0;
    if (this.hud.callout) this.hud.callout.dataset.run = 'false';
    this.setPhase('countdown');
    this.loop?.start();
  }

  /** Back to the empty booth (after a race, before the next). */
  clearRace() {
    this.setup = null;
    this.model = null;
    this.result = null;
    this.stopJet();
    this.setPhase('idle');
  }

  get race(): DerbyRaceModel | null {
    return this.model;
  }

  get myLane(): number {
    return this.setup?.myLane ?? -1;
  }

  /** The race on the stage is decided here. */
  get finished(): boolean {
    return this.result !== null;
  }

  /** Ticks of your aim made so far. */
  get sampledTicks(): number {
    return this.sampled;
  }

  /** Your samples for ticks [from, to), flat, to send. */
  mySamples(from: number, to: number): number[] {
    const end = Math.min(to, this.sampled);
    return Array.from(this.mine.subarray(from * 3, Math.max(from, end) * 3));
  }

  /** The server's word on a lane (yours or another's). */
  confirm(lane: number, prev: number, from: number, samples: ArrayLike<number>): DerbyConfirm {
    const model = this.model;
    const setup = this.setup;
    if (!model || !setup) return 'old';
    const now = setup.clock(performance.now());
    const before = this.rawDistance(lane, now);
    const outcome = model.confirm(lane, prev, from, samples);
    if (outcome !== 'applied') {
      if (outcome === 'gap') this.sync.gaps += 1;
      return outcome;
    }
    if (lane !== setup.myLane) {
      this.sync.remote += 1;
      // How old the first sample in this news is: the time it took to reach
      // this phone (a dry gap before it is not lateness).
      const lateMs = now - from * DERBY_TICK_MS;
      if (samples.length) {
        this.sync.late += lateMs > 450 ? 1 : 0;
        this.sync.maxLateMs = Math.max(this.sync.maxLateMs, lateMs);
        if (this.sync.ages.length < 4000) this.sync.ages.push(Math.round(lateMs));
      }
    }
    const after = this.rawDistance(lane, now);
    this.offsets[lane] += before - after;
    this.sync.maxOffset = Math.max(this.sync.maxOffset, Math.abs(before - after));
    return outcome;
  }

  /** Ticks every lane is final through, from the server's clock. */
  seal(tick: number) {
    this.model?.seal(tick);
  }

  /** The server's result, if it came first: the stage takes it. */
  serverFinished(result: DerbyResult) {
    this.serverResult = result;
  }

  private setPhase(phase: RaceGamePhase) {
    if (this.phase === phase) return;
    this.phase = phase;
    this.events.onPhase(phase);
  }

  // ── Input ──

  private squirting(): boolean {
    return this.pointer !== null || this.keySquirt || this.debugSquirt;
  }

  private canAim(): boolean {
    return this.phase === 'countdown' || this.phase === 'racing';
  }

  pointerDown(e: PointerEvent) {
    if (!this.canAim() || !this.L) return;
    if (this.pointer) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.pointer = { id: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY };
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // a synthetic event has no capture
    }
    if (e.pointerType === 'mouse') this.mouseTo(e);
    this.feedback.trigger('press', { haptic: true });
  }

  pointerMove(e: PointerEvent) {
    if (!this.L) return;
    if (e.pointerType === 'mouse') {
      // A mouse aims where it points, pressed or not.
      if (this.canAim() && (!this.pointer || this.pointer.id === e.pointerId)) this.mouseTo(e);
      return;
    }
    const p = this.pointer;
    if (!p || p.id !== e.pointerId) return;
    // A finger drags the aim like a trackpad, so it never covers the target.
    const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const last = coalesced.length ? coalesced[coalesced.length - 1]! : e;
    const dx = last.clientX - p.x;
    const dy = last.clientY - p.y;
    p.x = last.clientX;
    p.y = last.clientY;
    this.raw.x = clamp(this.raw.x + (dx * TOUCH_GAIN) / this.L.unit, -DERBY_FIELD_X, DERBY_FIELD_X);
    this.raw.y = clamp(this.raw.y + (dy * TOUCH_GAIN) / this.L.unit, -DERBY_FIELD_Y, DERBY_FIELD_Y);
  }

  private mouseTo(e: PointerEvent) {
    const L = this.L!;
    const rect = this.canvas.getBoundingClientRect();
    const sx = rect.width ? this.width / rect.width : 1;
    const x = (e.clientX - rect.left) * sx;
    const y = (e.clientY - rect.top) * sx;
    this.raw.x = clamp((x - (L.field.x + L.field.w / 2)) / L.unit, -DERBY_FIELD_X, DERBY_FIELD_X);
    this.raw.y = clamp((y - (L.field.y + L.field.h / 2)) / L.unit, -DERBY_FIELD_Y, DERBY_FIELD_Y);
  }

  pointerUp(e: PointerEvent) {
    if (!this.pointer || e.pointerId !== this.pointer.id) return;
    this.pointer = null;
  }

  pointerCancel(e: PointerEvent) {
    this.pointerUp(e);
  }

  /** Keyboard: arrows (or WASD) aim, hold space to squirt. */
  keyDown(code: string, perf: number): boolean {
    if (!this.canAim()) return false;
    if (code === 'Space' || code === 'Enter') {
      if (!this.keySquirt) this.feedback.trigger('press', { haptic: false });
      this.keySquirt = true;
      return true;
    }
    if (KEY_DIRS[code]) {
      if (this.keys.size === 0) this.keyHeldAt = perf;
      this.keys.add(code);
      return true;
    }
    return false;
  }

  keyUp(code: string): boolean {
    if (code === 'Space' || code === 'Enter') {
      this.keySquirt = false;
      return true;
    }
    if (KEY_DIRS[code]) {
      this.keys.delete(code);
      return true;
    }
    return false;
  }

  /** Window lost focus: let go of everything. */
  releaseAll() {
    this.pointer = null;
    this.keys.clear();
    this.keySquirt = false;
  }

  /** QA and the sync test (?derbyDebug=1): aim at a field point, water on or off. */
  debugAim(x: number, y: number, squirt: boolean) {
    this.raw.x = clamp(x, -DERBY_FIELD_X, DERBY_FIELD_X);
    this.raw.y = clamp(y, -DERBY_FIELD_Y, DERBY_FIELD_Y);
    this.debugSquirt = squirt;
  }

  /** Where the target is now (field units), for QA and the sync test. */
  targetNow(): { x: number; y: number; t: number } {
    return { x: this.target.x, y: this.target.y, t: this.setup ? this.setup.clock(performance.now()) : 0 };
  }

  // ── The frame ──

  private raceNow(perf: number): number {
    return this.setup ? this.setup.clock(perf) : -Infinity;
  }

  /** A lane's distance: exact for you and the bots, carried forward at its
   *  last speed for a person whose news hasn't come. */
  private rawDistance(lane: number, t: number): number {
    const model = this.model!;
    if (!(t > 0)) return 0;
    if (lane === this.setup?.myLane) return model.distance(lane, t, true);
    if (model.isBot(lane)) return model.distance(lane, t);
    const knownT = model.known[lane]! * DERBY_TICK_MS;
    const base = model.distance(lane, t);
    if (t <= knownT) return base;
    const v = model.recentSpeed(lane, model.known[lane]!) / 1000;
    const gap = t - knownT;
    return base + v * PREDICT_TAU * (1 - Math.exp(-gap / PREDICT_TAU));
  }

  private renderFrame(perf: number, deltaMs: number, frozen: boolean) {
    const ctx = this.ctx;
    const L = this.L;
    if (!ctx || !L) return;
    const dt = frozen ? 0 : Math.min(0.1, Math.max(0, deltaMs / 1000));
    const reduced = feelReducedMotion();
    this.lastFrame = perf;
    const now = this.raceNow(perf);
    const workFrom = performance.now();

    this.stepAim(dt, perf);
    if (this.model && this.setup) {
      this.stepClock(now, perf);
      this.sample(now);
      this.stepRace(now, dt, perf, reduced);
    } else {
      this.shown.fill(0);
    }
    this.stepWater(now, dt, perf, reduced);
    this.stepDrops(dt);

    // Paint.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.layers.back) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.layers.back, 0, 0);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
    const shake = reduced ? { x: 0, y: 0 } : this.feedback.shakeOffset(perf);
    if (shake.x || shake.y) ctx.translate(shake.x, shake.y);
    this.drawBoard(ctx, perf, reduced);
    this.drawWall(ctx, perf, reduced);
    this.drawCounter(ctx, perf, reduced);
    // The frame's own cost, for the perf check (ring of the last 600).
    this.work[this.workNext % this.work.length] = performance.now() - workFrom;
    this.workNext += 1;
  }

  private stepAim(dt: number, perf: number) {
    if (this.keys.size && this.canAim()) {
      let kx = 0;
      let ky = 0;
      for (const code of this.keys) {
        const d = KEY_DIRS[code];
        if (d) {
          kx += d[0];
          ky += d[1];
        }
      }
      const speed = perf - this.keyHeldAt > 900 ? KEY_SPEED_FAST : KEY_SPEED;
      const m = Math.hypot(kx, ky) || 1;
      this.raw.x = clamp(this.raw.x + (kx / m) * speed * dt, -DERBY_FIELD_X, DERBY_FIELD_X);
      this.raw.y = clamp(this.raw.y + (ky / m) * speed * dt, -DERBY_FIELD_Y, DERBY_FIELD_Y);
    }
    this.aim.x = this.raw.x;
    this.aim.y = this.raw.y;
  }

  private stepClock(now: number, perf: number) {
    // Countdown and the gate.
    if (this.phase === 'finish') return;
    if (now < 0) {
      const left = Math.ceil(-now / 1000);
      const value = left <= Math.ceil(DERBY_COUNTDOWN_MS / 1000) ? left : null;
      if (value !== this.countdownShown) {
        this.countdownShown = value;
        this.events.onCountdown(value);
        if (value !== null) SoundManager.play('arcadeTick', { volume: 0.8 });
      }
      this.setPhase('countdown');
    } else if (this.phase === 'countdown' || this.phase === 'idle') {
      this.setPhase('racing');
      this.countdownShown = 'go';
      this.events.onCountdown('go');
      SoundManager.play('cageGate', { volume: 0.9 });
      window.setTimeout(() => {
        if (this.countdownShown === 'go') {
          this.countdownShown = null;
          this.events.onCountdown(null);
        }
      }, 700);
      void perf;
    }
  }

  /** Your aim, one sample a tick, from the gate to the wire. */
  private sample(now: number) {
    const setup = this.setup!;
    const model = this.model!;
    const prevRace = this.prevRace;
    this.prevRace = now;
    const px = this.prevAim.x;
    const py = this.prevAim.y;
    this.prevAim.x = this.aim.x;
    this.prevAim.y = this.aim.y;
    if (setup.myLane < 0 || this.phase === 'finish' || now < 0) return;
    const from = this.sampled;
    const upTo = Math.min(DERBY_MAX_TICKS, Math.floor(now / DERBY_TICK_MS) + 1);
    if (upTo <= from) return;
    const squirt = this.squirting() ? 1 : 0;
    const step = DERBY_AIM_MAX_STEP * DERBY_AIM_SCALE * 0.98;
    for (let k = from; k < upTo; k += 1) {
      const t = k * DERBY_TICK_MS;
      // The aim at the tick, between last frame's and this frame's.
      const span = now - prevRace;
      const u = span > 0 ? clamp((t - prevRace) / span, 0, 1) : 1;
      let x = Math.round((px + (this.aim.x - px) * u) * DERBY_AIM_SCALE);
      let y = Math.round((py + (this.aim.y - py) * u) * DERBY_AIM_SCALE);
      const s = now - t > STALE_MS ? 0 : squirt;
      const [lx, ly, ls] = this.lastSample;
      if (s === 1 && ls === 1) {
        const dx = x - lx;
        const dy = y - ly;
        const m = Math.hypot(dx, dy);
        if (m > step) {
          x = Math.round(lx + (dx / m) * step);
          y = Math.round(ly + (dy / m) * step);
        }
      }
      x = clamp(x, -DERBY_FIELD_X * DERBY_AIM_SCALE, DERBY_FIELD_X * DERBY_AIM_SCALE);
      y = clamp(y, -DERBY_FIELD_Y * DERBY_AIM_SCALE, DERBY_FIELD_Y * DERBY_AIM_SCALE);
      this.mine[k * 3] = x;
      this.mine[k * 3 + 1] = y;
      this.mine[k * 3 + 2] = s;
      this.lastSample = [x, y, s];
    }
    this.sampled = upTo;
    const fresh = this.mine.subarray(from * 3, upTo * 3);
    if (setup.local) {
      model.confirm(setup.myLane, model.known[setup.myLane]!, from, fresh);
    } else {
      model.provisional(setup.myLane, from, fresh);
    }
  }

  private stepRace(now: number, dt: number, perf: number, reduced: boolean) {
    const model = this.model!;
    const setup = this.setup!;
    const raceT = Math.max(0, now);
    if (setup.local) model.seal(Math.floor(raceT / DERBY_TICK_MS));
    if (!this.result && this.phase === 'racing') {
      const decided = model.decided() ?? this.serverResult;
      if (decided) this.onDecided(decided, perf);
    }
    const decay = Math.exp(-OFFSET_DECAY * dt);
    if (this.result) this.finishClock += dt * 1000;
    for (let lane = 0; lane < DERBY_LANES; lane += 1) {
      this.offsets[lane]! *= decay;
      if (Math.abs(this.offsets[lane]!) < 1e-4) this.offsets[lane] = 0;
      let d: number;
      if (!this.result) {
        d = this.rawDistance(lane, raceT) + this.offsets[lane]!;
      } else {
        // After the wire: everyone eases to a stop, the winner through it.
        const tau = 380;
        d = this.atFinish[lane]! + this.finishSpeed[lane]! * tau * (1 - Math.exp(-this.finishClock / tau));
        if (lane !== this.result.winner) d = Math.min(d, DERBY_DISTANCE - 0.3);
      }
      const prev = this.shown[lane]!;
      // A horse never twitches back: a small overshoot (a guess a little
      // ahead of the news) holds still until the truth catches up. A big
      // one (ticks the server dropped, a phone that was offline) eases
      // back, faster the further it has to go, so it never waits long.
      if (d < prev) {
        const back = Math.max(0, prev - d - 0.3) * 6 * dt;
        d = Math.max(d, prev - back);
      }
      d = Math.max(0, d);
      const moved = d - prev;
      this.shown[lane] = d;
      // Pace: lengths a second on screen, eased for the legs.
      const v = dt > 0 ? moved / dt : 0;
      this.pace[lane] = dt > 0 ? this.pace[lane]! + (v - this.pace[lane]!) * (1 - Math.exp(-12 * dt)) : this.pace[lane]!;
      if (!reduced) this.stride[lane] = this.stride[lane]! + moved * 9;
      if (lane === setup.myLane && moved > 0) {
        // A soft gallop every 1.2 lengths your horse covers.
        this.clopAt[lane] = this.clopAt[lane]! + moved;
        if (this.clopAt[lane]! >= 1.2) {
          this.clopAt[lane] = 0;
          if (this.pace[lane]! > 0.4 && !this.result) SoundManager.play('derbyHoof', { volume: 0.12 + 0.12 * (this.pace[lane]! / DERBY_TOP_SPEED) });
        }
        // Dust behind the hooves.
        if (!reduced && Math.random() < moved * 1.2) this.dust(lane);
      }
    }
    // Your place, live.
    const me = setup.myLane;
    if (me >= 0) {
      let place = 1;
      const mine = this.shown[me]!;
      for (let lane = 0; lane < DERBY_LANES; lane += 1) {
        if (lane !== me && (this.shown[lane]! > mine + 1e-6 || (this.shown[lane]! === mine && lane < me && mine > 0))) place += 1;
      }
      if (this.result) place = this.result.order.indexOf(me) + 1;
      if (this.place && place !== this.place && raceT > 1_500 && !this.result) {
        this.placeDir = place < this.place ? 1 : -1;
        this.placePop = perf;
        if (place < this.place) {
          SoundManager.play('derbyBull', { volume: 0.5, pitch: semitonesToPitch(9 - place) });
          playHaptic('tick');
        }
      }
      this.place = place;
    }
    // The last stretch: the leader is three quarters home. The bell gives
    // one strike and the wire glows until someone reaches it.
    if (!this.lastStretch && !this.result) {
      let lead = 0;
      for (let lane = 0; lane < DERBY_LANES; lane += 1) lead = Math.max(lead, this.shown[lane]!);
      if (lead >= DERBY_DISTANCE * 0.75) {
        this.lastStretch = perf;
        SoundManager.play('strikerBell', { volume: 0.3 });
      }
    }
  }

  private onDecided(result: DerbyResult, perf: number) {
    this.result = result;
    this.finishPerf = perf;
    this.finishClock = 0;
    for (let lane = 0; lane < DERBY_LANES; lane += 1) {
      this.atFinish[lane] = this.shown[lane]!;
      this.finishSpeed[lane] = Math.max(0, this.pace[lane]!) / 1000;
    }
    // The winner always reaches the wire on screen.
    const w = result.winner;
    if (!result.timedOut && this.atFinish[w]! < DERBY_DISTANCE) {
      this.finishSpeed[w] = Math.max(this.finishSpeed[w]!, (DERBY_DISTANCE + 0.6 - this.atFinish[w]!) / 380);
    }
    this.setPhase('finish');
    this.stopJet();
    const mine = this.setup?.myLane ?? -1;
    const place = result.order.indexOf(mine) + 1;
    const reduced = feelReducedMotion();
    // The wire: the bell, and the one hit-stop in the game.
    SoundManager.play('derbyBell', { volume: 0.9 });
    this.feedback.trigger('impact', { hitStop: true, shake: 0.6, sound: false });
    const second = result.order[1];
    const margin = second === undefined ? 99 : DERBY_DISTANCE - result.distance[second]!;
    const photo = !result.timedOut && margin < 1;
    if (place === 1) {
      window.setTimeout(() => this.feedback.trigger('round-win', { haptic: true }), 120);
      if (!reduced) this.confetti();
    } else if (place > 0) {
      window.setTimeout(() => SoundManager.play('arcadeLose', { volume: 0.5 }), 900);
    }
    const ordinal = place > 0 ? ordinalOf(place) : '';
    const words = photo ? 'photo finish' : result.timedOut ? 'time' : place === 1 ? 'you won' : ordinal;
    if (this.hud.callout) {
      const label = this.hud.callout.querySelector('.arc-floater-label');
      if (label) label.textContent = words;
      this.hud.callout.dataset.tone = place === 1 ? 'best' : 'score';
      this.hud.callout.dataset.run = 'false';
      void this.hud.callout.offsetWidth;
      this.hud.callout.dataset.run = 'true';
    }
    this.events.onAnnounce(
      place === 1 ? 'You won the race.' : place > 0 ? `You finished ${ordinal} of ${DERBY_LANES}.` : 'The race is over.',
    );
    this.events.onFinish(result);
  }

  // ── Water ──

  private stepWater(now: number, dt: number, perf: number, reduced: boolean) {
    const path = this.model?.path ?? null;
    if (path) this.targetHint = derbyTargetAt(path, Math.max(-DERBY_COUNTDOWN_MS, now), this.target, this.targetHint);
    else {
      this.target.x = 0;
      this.target.y = 0;
    }
    const live = this.canAim() && this.setup !== null;
    const on = live && this.squirting();
    // The stream: the head runs out to the target in 50 ms, the tail follows
    // it off in 80 ms when you let go.
    if (on) {
      if (this.tail > 0) {
        this.tail = 0;
        this.head = 0;
      }
      this.head = Math.min(1, this.head + dt / 0.05);
    } else if (this.head > 0) {
      this.tail = Math.min(1, this.tail + dt / 0.08);
      if (this.tail >= 1) {
        this.head = 0;
        this.tail = 0;
      }
    }
    const dx = this.aim.x - this.target.x;
    const dy = this.aim.y - this.target.y;
    const d = Math.sqrt(dx * dx + dy * dy) / DERBY_TARGET_R;
    const hitting = on && this.head >= 1;
    const racing = this.phase === 'racing' && now >= 0;
    this.share = hitting ? derbySpeedShare(d) : 0;
    // The ring fills fast and drains faster: it reads as the same frame.
    const k = 1 - Math.exp(-(this.share > this.ring ? 30 : 45) * dt);
    this.ring += (this.share - this.ring) * (reduced ? 1 : k);
    const wasOn = this.onTarget;
    const wasBull = this.onBull;
    this.onTarget = hitting && d < 1;
    this.onBull = hitting && d <= DERBY_BULL;
    if (this.onTarget && !wasOn && racing) {
      this.feedback.trigger('collect', { haptic: true, sound: false });
    }
    if (this.onBull && !wasBull) {
      this.bullFlash = perf;
      if (racing && perf - this.lastBullTick > 280) {
        this.lastBullTick = perf;
        SoundManager.play('derbyBull', { volume: 0.55 });
      }
    }
    // The gun's sound.
    if (live && !this.jet && (on || racing)) this.jet = SoundManager.startWaterJet({ volume: 0.9 });
    const me = this.setup?.myLane ?? -1;
    const run = me >= 0 ? Math.min(1, Math.max(0, this.pace[me]! / DERBY_TOP_SPEED)) : 0;
    this.jet?.set({ water: on ? 1 : 0, hit: this.onTarget ? this.share : 0, run: racing ? run : 0 });
    // Spray where the stream lands.
    if (hitting && this.L && !reduced) {
      const ax = this.fx(this.aim.x);
      const ay = this.fy(this.aim.y);
      this.sprayClock += dt;
      const every = 1 / 70;
      while (this.sprayClock > every) {
        this.sprayClock -= every;
        this.spray(ax, ay, this.onTarget);
      }
      this.rippleClock += dt;
      if (this.onTarget && this.rippleClock > 0.11) {
        this.rippleClock = 0;
        this.emit(ax, ay, 0, 0, 0.42, 2, 2, C.waterCore);
      }
    }
  }

  private stopJet() {
    this.jet?.stop(80);
    this.jet = null;
  }

  private emit(x: number, y: number, vx: number, vy: number, ttl: number, r: number, kind: Drop['kind'], color: string) {
    const d = this.drops[this.dropNext % DROPS]!;
    this.dropNext += 1;
    d.x = x;
    d.y = y;
    d.vx = vx;
    d.vy = vy;
    d.ttl = ttl;
    d.life = ttl;
    d.r = r;
    d.kind = kind;
    d.color = color;
  }

  private spray(x: number, y: number, onTarget: boolean) {
    const a = Math.random() * Math.PI * 2;
    const s = (onTarget ? 40 : 60) + Math.random() * 90;
    this.emit(x, y, Math.cos(a) * s, Math.sin(a) * s * 0.6 - 50, 0.22 + Math.random() * 0.18, 1.2 + Math.random() * 1.6, 0, onTarget ? C.waterCore : C.water);
    if (!onTarget && Math.random() < 0.25) {
      // Water that missed runs down the wall.
      this.emit(x + (Math.random() - 0.5) * 10, y + Math.random() * 6, 0, 30 + Math.random() * 30, 0.7 + Math.random() * 0.4, 1.6, 1, C.water);
    }
  }

  private dust(lane: number) {
    const L = this.L!;
    const x = this.noseX(this.shown[lane]!) - L.horseL * 0.85;
    const y = this.laneY(lane) + L.rowH * 0.3;
    this.emit(x, y, -20 - Math.random() * 30, -10 - Math.random() * 15, 0.35, 1.4 + Math.random(), 3, C.paper);
  }

  private confetti() {
    const L = this.L!;
    const me = this.setup?.myLane ?? 0;
    const colors = [C.ticket, C.paper, C.red];
    for (let i = 0; i < 70; i += 1) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const s = 120 + Math.random() * 220;
      this.emit(L.finishX, this.laneY(me), Math.cos(a) * s, Math.sin(a) * s, 1 + Math.random() * 0.7, 2 + Math.random() * 1.5, 3, colors[i % 3]!);
    }
  }

  private stepDrops(dt: number) {
    for (const d of this.drops) {
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.kind === 2) continue;
      const g = d.kind === 1 ? 40 : d.kind === 3 ? 160 : 520;
      d.vy += g * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.kind === 3) d.vx *= 1 - 2 * dt;
    }
  }

  // ── Drawing ──

  private drawBoard(ctx: CanvasRenderingContext2D, perf: number, reduced: boolean) {
    const L = this.L!;
    const me = this.setup?.myLane ?? -1;
    const look = this.look;
    // Your rail: the ticket ring on its disc, a glow along it, and the
    // water's pull streaming behind your horse.
    if (me >= 0) {
      const y = this.laneY(me);
      const gh = L.rowH * 0.78;
      const railX = L.discX + L.discR + 4;
      ctx.lineWidth = 2;
      ctx.strokeStyle = C.ticket;
      roundRect(ctx, railX - 1, y - gh / 2 - 1, L.finishX + 12 - railX, gh + 2, gh / 2 + 1);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(L.discX, y, L.discR + 2.5, 0, Math.PI * 2);
      ctx.lineWidth = 2.5;
      ctx.stroke();
      const runShare = Math.min(1, this.pace[me]! / DERBY_TOP_SPEED);
      if (runShare > 0.02 && !this.result) {
        const nose = this.noseX(this.shown[me]!);
        const tailX = nose - L.horseL;
        const flow = reduced ? 0 : (perf / 1000) * 90;
        ctx.save();
        ctx.beginPath();
        ctx.rect(railX, y - gh / 2, Math.max(0, tailX - railX), gh);
        ctx.clip();
        ctx.strokeStyle = `rgba(242,163,60,${(0.25 + 0.55 * runShare).toFixed(3)})`;
        ctx.lineWidth = 2;
        const gap = 11;
        for (let i = 0; i < 6; i += 1) {
          const cx = tailX - 6 - i * gap - ((flow % gap) + gap) % gap;
          ctx.globalAlpha = 1 - i / 6;
          ctx.beginPath();
          ctx.moveTo(cx - 3, y - gh * 0.22);
          ctx.lineTo(cx + 1, y);
          ctx.lineTo(cx - 3, y + gh * 0.22);
          ctx.stroke();
        }
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }
    // The last stretch: the wire glows, breathing at 1.5 Hz.
    if (this.lastStretch && !this.result) {
      const glow = reduced ? 0.4 : 0.3 + 0.25 * Math.sin(((perf - this.lastStretch) / 1000) * Math.PI * 3);
      ctx.fillStyle = `rgba(242,163,60,${glow.toFixed(3)})`;
      ctx.fillRect(L.finishX - 7, L.rowsTop, 14, L.rowH * DERBY_LANES);
    }
    // The wire lamp: the winner's silks after the finish.
    if (this.result && !this.result.timedOut) {
      const since = perf - this.finishPerf;
      const blink = reduced ? true : since < 1600 ? Math.floor(since / 130) % 2 === 0 : true;
      if (blink) {
        ctx.fillStyle = DERBY_LANE_COLORS[this.result.winner]!.silk;
        ctx.fillRect(L.finishX - 3, this.laneY(this.result.winner) - L.rowH / 2, 6, L.rowH);
      }
    }
    // Horses, back to front so yours sits on top of its neighbours.
    for (let lane = 0; lane < DERBY_LANES; lane += 1) {
      if (lane === me) continue;
      this.drawHorse(ctx, lane, false, reduced);
    }
    if (me >= 0) this.drawHorse(ctx, me, true, reduced);
    // The bell over the wire.
    const bellX = L.finishX;
    const bellY = L.board.y + 4;
    const since = this.result ? perf - this.finishPerf : 1e9;
    const swing = !reduced && since < 1400 ? Math.sin(since / 22) * 0.35 * (1 - since / 1400) : 0;
    drawBell(ctx, bellX, bellY, Math.max(7, L.rowH * 0.32), swing, look.rail);
    // Dust and confetti over the board.
    this.drawDrops(ctx, 3);
  }

  private drawHorse(ctx: CanvasRenderingContext2D, lane: number, mine: boolean, reduced: boolean) {
    const L = this.L!;
    const d = this.shown[lane]!;
    const x = this.noseX(d);
    const y = this.laneY(lane) + L.rowH * 0.3;
    const s = L.horseL;
    const run = Math.min(1, this.pace[lane]! / DERBY_TOP_SPEED);
    const phase = this.stride[lane]!;
    const silk = DERBY_LANE_COLORS[lane]!;
    const coat = COATS[lane]!;
    const make = this.look.make;
    ctx.save();
    ctx.translate(x, y);
    let bob = 0;
    let tilt = 0;
    if (!reduced) {
      if (make === 'carousel') bob = -Math.sin(phase) * 0.05 * s * Math.min(1, run * 2);
      else if (make === 'rocker') tilt = Math.sin(phase) * 0.07 * Math.min(1, run * 2);
      else bob = -Math.abs(Math.sin(phase)) * 0.04 * s * Math.min(1, run * 2);
    }
    ctx.translate(0, bob);
    if (tilt) {
      ctx.translate(-0.5 * s, 0);
      ctx.rotate(tilt);
      ctx.translate(0.5 * s, 0);
    }
    ctx.scale(s, s);
    drawToyHorse(ctx, coat, silk.silk, silk.ink, lane + 1, make, reduced ? 0 : phase, run, this.font(800, 0.2 * s), s);
    ctx.restore();
    if (mine) {
      // The ticket ring rides over your horse.
      ctx.beginPath();
      ctx.arc(x - s * 0.5, this.laneY(lane) - L.rowH * 0.5 + 1, Math.max(3, L.rowH * 0.13), 0, Math.PI * 2);
      ctx.fillStyle = C.ticket;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = C.ink;
      ctx.stroke();
    }
  }

  private drawWall(ctx: CanvasRenderingContext2D, perf: number, reduced: boolean) {
    const L = this.L!;
    const tx = this.fx(this.target.x);
    const ty = this.fy(this.target.y);
    const R = DERBY_TARGET_R * L.unit;
    ctx.save();
    roundRect(ctx, L.field.x, L.field.y, L.field.w, L.field.h, 7);
    ctx.clip();
    // Water running down the wall.
    this.drawDrops(ctx, 1);
    // The target: a tin bullseye with a shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.arc(tx + 2.5, ty + 4, R, 0, Math.PI * 2);
    ctx.fill();
    for (const [r, color] of TARGET_RINGS) {
      ctx.beginPath();
      ctx.arc(tx, ty, R * r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
    // The bull lights while the stream is on it.
    const flash = perf - this.bullFlash;
    if (this.onBull || flash < 140) {
      ctx.beginPath();
      ctx.arc(tx, ty, R * DERBY_BULL, 0, Math.PI * 2);
      ctx.fillStyle = this.onBull ? (flash < 140 && !reduced ? '#fff6e6' : C.ticket) : C.ticket;
      ctx.fill();
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = C.ink;
    ctx.beginPath();
    ctx.arc(tx, ty, R, 0, Math.PI * 2);
    ctx.stroke();
    // Ripples where the water drums on the tin.
    ctx.save();
    ctx.beginPath();
    ctx.arc(tx, ty, R, 0, Math.PI * 2);
    ctx.clip();
    this.drawDrops(ctx, 2);
    ctx.restore();
    ctx.restore();
    // The gauge: a ring round the target that fills with your speed.
    const ringR = R + 7;
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(244,235,220,0.16)';
    ctx.beginPath();
    ctx.arc(tx, ty, ringR, 0, Math.PI * 2);
    ctx.stroke();
    if (this.ring > 0.01) {
      ctx.strokeStyle = C.ticket;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(tx, ty, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, this.ring));
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
    // The stream, the spray and the sight.
    this.drawStream(ctx, perf, reduced);
    this.drawDrops(ctx, 0);
    this.drawSight(ctx);
  }

  private nozzle(): { x: number; y: number; ax: number; ay: number } {
    const L = this.L!;
    const ax = this.fx(this.aim.x);
    const ay = this.fy(this.aim.y);
    const dx = ax - L.pivot.x;
    const dy = ay - L.pivot.y;
    const m = Math.hypot(dx, dy) || 1;
    return { x: L.pivot.x + (dx / m) * L.gunLen, y: L.pivot.y + (dy / m) * L.gunLen, ax, ay };
  }

  private drawStream(ctx: CanvasRenderingContext2D, perf: number, reduced: boolean) {
    if (this.head <= 0) return;
    const n = this.nozzle();
    const x0 = n.x;
    const y0 = n.y;
    const x2 = n.ax;
    const y2 = n.ay;
    const len = Math.hypot(x2 - x0, y2 - y0);
    // The jet arcs a little: up off the nozzle, down onto the wall.
    const cx = (x0 + x2) / 2;
    const cy = (y0 + y2) / 2 - len * 0.16;
    const a = this.tail;
    const b = this.head;
    const steps = 18;
    const left = STREAM_LEFT;
    const right = STREAM_RIGHT;
    for (let i = 0; i <= steps; i += 1) {
      const u = a + ((b - a) * i) / steps;
      const v = 1 - u;
      const px = v * v * x0 + 2 * v * u * cx + u * u * x2;
      const py = v * v * y0 + 2 * v * u * cy + u * u * y2;
      const tx = 2 * v * (cx - x0) + 2 * u * (x2 - cx);
      const ty = 2 * v * (cy - y0) + 2 * u * (y2 - cy);
      const tm = Math.hypot(tx, ty) || 1;
      const w = 4.2 - 2.4 * u;
      left[i * 2] = px - (ty / tm) * w;
      left[i * 2 + 1] = py + (tx / tm) * w;
      right[i * 2] = px + (ty / tm) * w;
      right[i * 2 + 1] = py - (tx / tm) * w;
    }
    ctx.beginPath();
    ctx.moveTo(left[0]!, left[1]!);
    for (let i = 1; i <= steps; i += 1) ctx.lineTo(left[i * 2]!, left[i * 2 + 1]!);
    for (let i = steps; i >= 0; i -= 1) ctx.lineTo(right[i * 2]!, right[i * 2 + 1]!);
    ctx.closePath();
    ctx.fillStyle = C.water;
    ctx.globalAlpha = 0.92;
    ctx.fill();
    ctx.globalAlpha = 1;
    // The bright core, moving along the jet.
    ctx.beginPath();
    for (let i = 0; i <= steps; i += 1) {
      const u = a + ((b - a) * i) / steps;
      const v = 1 - u;
      const px = v * v * x0 + 2 * v * u * cx + u * u * x2;
      const py = v * v * y0 + 2 * v * u * cy + u * u * y2;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = C.waterCore;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([7, 9]);
    ctx.lineDashOffset = reduced ? 0 : -((perf / 1000) * 420);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawSight(ctx: CanvasRenderingContext2D) {
    if (!this.setup || !this.canAim()) return;
    const x = this.fx(this.aim.x);
    const y = this.fy(this.aim.y);
    const on = this.head > 0;
    ctx.lineWidth = 2;
    ctx.strokeStyle = on ? 'rgba(234,248,255,0.85)' : C.paper;
    ctx.beginPath();
    ctx.arc(x, y, on ? 5 : 9, 0, Math.PI * 2);
    ctx.stroke();
    if (!on) {
      ctx.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        ctx.moveTo(x + dx * 12, y + dy * 12);
        ctx.lineTo(x + dx * 16, y + dy * 16);
      }
      ctx.stroke();
    }
  }

  private drawCounter(ctx: CanvasRenderingContext2D, perf: number, reduced: boolean) {
    const L = this.L!;
    const n = this.nozzle();
    const dx = n.x - L.pivot.x;
    const dy = n.y - L.pivot.y;
    const angle = Math.atan2(dy, dx);
    // The gun: a turret on the counter, its barrel on your aim.
    ctx.save();
    ctx.translate(L.pivot.x, L.pivot.y);
    ctx.rotate(angle);
    const len = L.gunLen;
    const w = Math.max(7, len * 0.3);
    ctx.fillStyle = mixHex(this.look.ball, C.ink, 0.3);
    roundRect(ctx, -w * 0.4, -w / 2 - 1, len + 2, w + 2, w / 2);
    ctx.fill();
    ctx.fillStyle = this.look.ball;
    roundRect(ctx, -w * 0.4, -w / 2, len, w, w / 2);
    ctx.fill();
    ctx.fillStyle = C.brass;
    ctx.fillRect(len - w * 0.55, -w * 0.32, w * 0.5, w * 0.64);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(L.pivot.x, L.pivot.y, w * 0.75, 0, Math.PI * 2);
    ctx.fillStyle = mixHex(this.look.ball, C.ink, 0.15);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = C.ink;
    ctx.stroke();
    // Your place, live.
    const me = this.setup?.myLane ?? -1;
    if (me >= 0 && this.place > 0 && this.phase !== 'countdown') {
      const p = L.placeAt;
      const since = perf - this.placePop;
      const pop = reduced || since > 260 ? 1 : 1 + 0.28 * Math.sin((since / 260) * Math.PI) * (this.placeDir > 0 ? 1 : 0.4);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(pop, pop);
      const text = ordinalOf(this.place);
      ctx.font = this.font(800, p.size);
      ctx.textAlign = L.wide ? 'center' : 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = this.place === 1 ? C.ticket : C.paper;
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
  }

  private drawDrops(ctx: CanvasRenderingContext2D, kind: Drop['kind']) {
    for (const d of this.drops) {
      if (d.life <= 0 || d.kind !== kind) continue;
      const k = d.life / d.ttl;
      ctx.globalAlpha = kind === 2 ? k * 0.7 : Math.min(1, k * 1.6);
      if (kind === 2) {
        ctx.beginPath();
        ctx.arc(d.x, d.y, 4 + (1 - k) * 18, 0, Math.PI * 2);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = d.color;
        ctx.stroke();
      } else if (kind === 1) {
        ctx.fillStyle = d.color;
        ctx.fillRect(d.x - d.r / 2, d.y - 6, d.r, 6 + (1 - k) * 4);
      } else {
        ctx.fillStyle = d.color;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  teardown() {
    SoundManager.setTint('house');
    this.stopJet();
    this.loop?.destroy();
    this.loop = null;
  }

  /** The sync test: the result this phone reached, and every lane's final ticks. */
  debugState() {
    const model = this.model;
    return {
      result: model?.decided() ?? null,
      shownResult: this.result,
      known: model ? Array.from(model.known) : null,
      sealed: model?.sealed ?? 0,
      distances: model && this.result ? model.lanes.map((_, lane) => model.distance(lane, this.result!.endT)) : null,
      sync: { ...this.sync },
    };
  }

  /** The phase, cheaply (tests poll it every frame). */
  get phaseNow(): RaceGamePhase {
    return this.phase;
  }

  /** For the perf overlay and tests. */
  stats() {
    return {
      phase: this.phase,
      distances: Array.from(this.shown),
      place: this.place,
      share: this.share,
      onTarget: this.onTarget,
      sampled: this.sampled,
      work: Array.from(this.work.subarray(0, Math.min(this.workNext, this.work.length))),
    };
  }
}

const STREAM_LEFT = new Float64Array(40);
const STREAM_RIGHT = new Float64Array(40);
const TARGET_RINGS: ReadonlyArray<readonly [number, string]> = [
  [1, C.paper],
  [0.8, C.red],
  [0.56, C.paper],
  [DERBY_BULL, C.red],
];

const KEY_DIRS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
  KeyW: [0, -1],
  KeyS: [0, 1],
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

function drawBell(g: CanvasRenderingContext2D, x: number, y: number, r: number, swing: number, trim: string) {
  g.save();
  g.translate(x, y);
  g.rotate(swing);
  g.fillStyle = C.brass;
  g.beginPath();
  g.moveTo(-r, r * 1.1);
  g.quadraticCurveTo(-r * 0.9, -r * 0.2, 0, -r * 0.3);
  g.quadraticCurveTo(r * 0.9, -r * 0.2, r, r * 1.1);
  g.closePath();
  g.fill();
  g.fillStyle = C.brassHi;
  g.fillRect(-r * 0.55, r * 0.05, r * 0.22, r * 0.7);
  g.fillStyle = trim;
  g.fillRect(-r * 1.15, r * 1.05, r * 2.3, r * 0.22);
  g.beginPath();
  g.arc(0, r * 1.4, r * 0.25, 0, Math.PI * 2);
  g.fillStyle = C.brass;
  g.fill();
  g.restore();
}

/**
 * A flat toy horse in unit space: nose at (0, 0) facing right, hooves on
 * y = 0, about 1 long and 0.95 tall. `phase` swings the legs; `run` (0 to
 * 1) is how hard. The make is the skin's: on wheels, on a rocker, or on a
 * carousel pole.
 */
function drawToyHorse(
  g: CanvasRenderingContext2D,
  coat: string,
  silk: string,
  silkInk: string,
  number: number,
  make: DerbyHorseMake,
  phase: number,
  run: number,
  font: string,
  scale: number,
) {
  const dark = mixHex(coat, '#1f1a16', 0.45);
  const swing = make === 'carousel' ? 0.15 : 0.55 * Math.min(1, run * 1.6);
  const legs: Array<[number, number]> = [
    [-0.3, Math.sin(phase) * swing + 0.15],
    [-0.38, Math.sin(phase + 1.2) * swing - 0.1],
    [-0.7, Math.sin(phase + Math.PI) * swing - 0.15],
    [-0.78, Math.sin(phase + Math.PI + 1.2) * swing + 0.1],
  ];
  if (make === 'carousel') {
    g.fillStyle = C.brass;
    g.fillRect(-0.53, -1.25, 0.05, 1.4);
    g.fillStyle = C.brassHi;
    g.fillRect(-0.53, -1.25, 0.018, 1.4);
  }
  // Legs, hip down, far pair darker.
  g.lineCap = 'round';
  g.lineWidth = 0.075;
  for (let i = 0; i < legs.length; i += 1) {
    const [hx, a] = legs[i]!;
    const tuck = make === 'carousel' ? -0.12 : 0;
    g.strokeStyle = i % 2 ? dark : coat;
    g.beginPath();
    g.moveTo(hx, -0.36);
    g.lineTo(hx + Math.sin(a) * 0.32, -0.36 + Math.cos(a) * 0.33 + tuck);
    g.stroke();
  }
  // Tail.
  g.strokeStyle = dark;
  g.lineWidth = 0.08;
  g.beginPath();
  g.moveTo(-0.84, -0.55);
  g.quadraticCurveTo(-1.02, -0.5 + Math.sin(phase * 0.5) * 0.04, -0.98, -0.28);
  g.stroke();
  g.lineCap = 'butt';
  // Body.
  g.fillStyle = coat;
  g.beginPath();
  g.ellipse(-0.56, -0.5, 0.32, 0.17, 0, 0, Math.PI * 2);
  g.fill();
  // Neck and head.
  g.beginPath();
  g.moveTo(-0.36, -0.6);
  g.lineTo(-0.2, -0.88);
  g.lineTo(-0.08, -0.86);
  g.lineTo(-0.22, -0.46);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(-0.24, -0.92);
  g.quadraticCurveTo(-0.12, -0.96, 0, -0.74);
  g.quadraticCurveTo(0.02, -0.66, -0.06, -0.66);
  g.lineTo(-0.2, -0.74);
  g.closePath();
  g.fill();
  // Ear and mane.
  g.beginPath();
  g.moveTo(-0.22, -0.9);
  g.lineTo(-0.18, -1.02);
  g.lineTo(-0.13, -0.9);
  g.closePath();
  g.fill();
  g.strokeStyle = dark;
  g.lineWidth = 0.06;
  g.beginPath();
  g.moveTo(-0.38, -0.64);
  g.lineTo(-0.23, -0.9);
  g.stroke();
  // Eye.
  g.fillStyle = '#1f1a16';
  g.beginPath();
  g.arc(-0.1, -0.8, 0.022, 0, Math.PI * 2);
  g.fill();
  // The saddle cloth in the lane's silks, with its number.
  g.fillStyle = silk;
  g.beginPath();
  g.moveTo(-0.72, -0.66);
  g.lineTo(-0.42, -0.66);
  g.lineTo(-0.44, -0.38);
  g.lineTo(-0.7, -0.38);
  g.closePath();
  g.fill();
  g.lineWidth = 0.025;
  g.strokeStyle = 'rgba(31,26,22,0.6)';
  g.stroke();
  g.save();
  g.scale(1 / scale, 1 / scale);
  g.fillStyle = silkInk;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(number), -0.57 * scale, -0.51 * scale);
  g.restore();
  // The make.
  if (make === 'wheels') {
    g.fillStyle = '#3b2616';
    g.fillRect(-0.9, -0.03, 0.82, 0.07);
    for (const wx of [-0.78, -0.2]) {
      g.beginPath();
      g.arc(wx, 0.08, 0.075, 0, Math.PI * 2);
      g.fillStyle = C.brass;
      g.fill();
      g.strokeStyle = '#3b2616';
      g.lineWidth = 0.025;
      g.beginPath();
      g.moveTo(wx + Math.cos(phase * 1.8) * 0.06, 0.08 + Math.sin(phase * 1.8) * 0.06);
      g.lineTo(wx - Math.cos(phase * 1.8) * 0.06, 0.08 - Math.sin(phase * 1.8) * 0.06);
      g.stroke();
    }
  } else if (make === 'rocker') {
    g.strokeStyle = '#3b2616';
    g.lineWidth = 0.06;
    g.beginPath();
    g.moveTo(-1.02, -0.04);
    g.quadraticCurveTo(-0.55, 0.12, -0.05, -0.04);
    g.stroke();
  }
}
