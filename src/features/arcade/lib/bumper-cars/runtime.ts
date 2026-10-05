/* What the page draws from. A round, practice in the browser or a real one on
   the server, is a `BumperView`: the phase, the clock, the seats, the scores,
   each car's pose at the moment being drawn, and the events that moved it.
   The scene and the HUD read only this, so practice and a real round look and
   feel the same.

   Poses are drawn between two fixed ticks (interpolation at display refresh),
   from a short history of every car. A hit-stop holds the drawn moment still
   for 50 ms and then catches up over 200 ms; the physics never stops, so the
   page stays in step with the server. */

import { BOT_NAMES, BOT_SKILLS, botInput, createBot, type BotBrain } from './bots';
import {
  CAR_COLORS,
  COAST_TICKS,
  COUNTDOWN_TICKS,
  DT,
  MAX_CARS,
  ROUND_TICKS,
  TICK_HZ,
} from './constants';
import { createSim, setInputs, stepSim, type SimEvent, type SimState } from './sim';

export type RoundPhase = 'waiting' | 'countdown' | 'live' | 'over';

export type SeatInfo = {
  name: string;
  kind: 'you' | 'player' | 'bot' | 'empty';
  color: string;
  /** A player whose connection dropped, waiting to come back. */
  away: boolean;
  /** A player who left the round. A bot drives their car. */
  left: boolean;
};

export type Pose = { x: number; z: number; fx: number; fz: number; speed: number; w: number; ax: number; az: number };

/** Something the player should feel. `confirmed` events change the score. */
export type FeelEvent =
  | { kind: 'bump'; a: number; b: number; speed: number; x: number; z: number; nx: number; nz: number; pa: number; pb: number }
  | { kind: 'touch'; a: number; b: number; speed: number; x: number; z: number; nx: number; nz: number }
  | { kind: 'wall'; car: number; speed: number; x: number; z: number }
  | { kind: 'score'; seat: number; points: number; victim: number; big: boolean }
  | { kind: 'phase'; phase: RoundPhase };

export interface BumperView {
  readonly mode: 'practice' | 'online';
  phase(): RoundPhase;
  /** Ticks into the live round; negative in the count in. */
  roundTick(): number;
  seats(): readonly SeatInfo[];
  mySeat(): number;
  points(): readonly number[];
  bumps(): readonly number[];
  /** Set the player's input, -16..16 each. */
  setInput(steer: number, throttle: number): void;
  /** Advance to wall time `nowMs` (performance.now()). */
  update(nowMs: number): void;
  pose(seat: number, out: Pose): void;
  drainEvents(): FeelEvent[];
  /** Hold the drawn moment for a beat. */
  hitStop(nowMs: number): void;
  dispose(): void;
}

// ── Pose history ─────────────────────────────────────────────────────────

const HISTORY = 48;
const FIELDS = 7; // x, z, fx, fz, vx, vz, w

export class PoseHistory {
  readonly data = new Float64Array(HISTORY * MAX_CARS * FIELDS);
  readonly ticks = new Int32Array(HISTORY).fill(-1);

  record(state: SimState): void {
    const slot = ((state.tick % HISTORY) + HISTORY) % HISTORY;
    this.ticks[slot] = state.tick;
    let o = slot * MAX_CARS * FIELDS;
    for (const car of state.cars) {
      this.data[o] = car.x;
      this.data[o + 1] = car.z;
      this.data[o + 2] = car.fx;
      this.data[o + 3] = car.fz;
      this.data[o + 4] = car.vx;
      this.data[o + 5] = car.vz;
      this.data[o + 6] = car.w;
      o += FIELDS;
    }
  }

  has(tick: number): boolean {
    return this.ticks[((tick % HISTORY) + HISTORY) % HISTORY] === tick;
  }

  /** The pose at fractional tick `t`, between the two ticks either side. */
  sample(seat: number, t: number, out: Pose): boolean {
    let t0 = Math.floor(t);
    let t1 = t0 + 1;
    let alpha = t - t0;
    if (!this.has(t1)) {
      t1 = t0;
      alpha = 0;
    }
    if (!this.has(t0)) {
      if (!this.has(t1)) return false;
      t0 = t1;
    }
    const a = (((t0 % HISTORY) + HISTORY) % HISTORY) * MAX_CARS * FIELDS + seat * FIELDS;
    const b = (((t1 % HISTORY) + HISTORY) % HISTORY) * MAX_CARS * FIELDS + seat * FIELDS;
    const d = this.data;
    const l = (i: number) => d[a + i]! + (d[b + i]! - d[a + i]!) * alpha;
    out.x = l(0);
    out.z = l(1);
    let fx = l(2);
    let fz = l(3);
    const len = Math.hypot(fx, fz) || 1;
    fx /= len;
    fz /= len;
    out.fx = fx;
    out.fz = fz;
    const vx = l(4);
    const vz = l(5);
    out.speed = Math.hypot(vx, vz);
    out.w = l(6);
    // Acceleration over the last tick, for the body's lean.
    const p = (((t0 - 1) % HISTORY) + HISTORY) % HISTORY;
    if (this.ticks[p] === t0 - 1) {
      const c = p * MAX_CARS * FIELDS + seat * FIELDS;
      out.ax = (d[a + 4]! - d[c + 4]!) * TICK_HZ;
      out.az = (d[a + 5]! - d[c + 5]!) * TICK_HZ;
    } else {
      out.ax = 0;
      out.az = 0;
    }
    return true;
  }
}

/** The drawn moment trails the physics by a little after a hit-stop. */
export class RenderLag {
  private holdUntil = -Infinity;
  private lagTicks = 0;
  private lastNow = 0;

  hit(nowMs: number, reduced: boolean): void {
    if (reduced) return;
    this.holdUntil = nowMs + 50;
  }

  /** Ticks to draw behind the newest tick. */
  update(nowMs: number): number {
    const dt = Math.min(100, Math.max(0, nowMs - this.lastNow));
    this.lastNow = nowMs;
    if (nowMs < this.holdUntil) {
      this.lagTicks += dt / (1000 * DT);
    } else if (this.lagTicks > 0) {
      // Catch up a little faster than real time: 200 ms for a 50 ms hold.
      this.lagTicks = Math.max(0, this.lagTicks - (dt / (1000 * DT)) * 0.25);
    }
    this.lagTicks = Math.min(this.lagTicks, 6);
    return this.lagTicks;
  }
}

// ── Practice: the whole round in the browser ─────────────────────────────

export type PracticeOptions = {
  seed: number;
  myName: string;
  /** Bot skill for the seven other cars. */
  level?: keyof typeof BOT_SKILLS;
  /** Drive the player's car with a bot too (the recorded demo and tests). */
  autopilot?: boolean;
  reducedMotion?: () => boolean;
};

export class PracticeRound implements BumperView {
  readonly mode = 'practice' as const;
  private sim: SimState;
  private bots: Array<BotBrain | null>;
  private seatList: SeatInfo[];
  private history = new PoseHistory();
  private events: FeelEvent[] = [];
  private stepEvents: SimEvent[] = [];
  private input = { steer: 0, throttle: 0 };
  private startMs: number | null = null;
  private stepped = 0;
  private renderTick = 0;
  private lag = new RenderLag();
  private phaseNow: RoundPhase = 'countdown';
  private reduced: () => boolean;

  constructor(private readonly opts: PracticeOptions) {
    this.sim = createSim();
    const level = opts.level ?? 'medium';
    const skills: Array<keyof typeof BOT_SKILLS> = ['hard', 'medium', level, 'easy', level, 'medium', 'easy'];
    this.bots = Array.from({ length: MAX_CARS }, (_, seat) =>
      seat === 0 && !opts.autopilot ? null : createBot(seat, opts.seed, BOT_SKILLS[skills[(seat + 6) % 7]!]!),
    );
    const names = BOT_NAMES.slice();
    // Shuffle the bot names with the seed.
    let s = opts.seed >>> 0;
    for (let i = names.length - 1; i > 0; i -= 1) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const j = s % (i + 1);
      [names[i], names[j]] = [names[j]!, names[i]!];
    }
    this.seatList = Array.from({ length: MAX_CARS }, (_, seat) => ({
      name: seat === 0 ? opts.myName : names[seat - 1]!,
      kind: seat === 0 ? 'you' : 'bot',
      color: CAR_COLORS[seat]!,
      away: false,
      left: false,
    }));
    this.reduced = opts.reducedMotion ?? (() => false);
    this.history.record(this.sim);
  }

  phase(): RoundPhase {
    return this.phaseNow;
  }

  roundTick(): number {
    return Math.floor(this.renderTick) - COUNTDOWN_TICKS;
  }

  seats(): readonly SeatInfo[] {
    return this.seatList;
  }

  mySeat(): number {
    return 0;
  }

  points(): readonly number[] {
    return this.sim.points;
  }

  bumps(): readonly number[] {
    return this.sim.bumps;
  }

  setInput(steer: number, throttle: number): void {
    this.input.steer = steer;
    this.input.throttle = throttle;
  }

  /** Sim seconds of physics owed at `nowMs`, capped so a hidden tab can't spiral. */
  update(nowMs: number): void {
    if (this.startMs === null) this.startMs = nowMs;
    const due = Math.floor((nowMs - this.startMs) / (1000 * DT));
    let steps = 0;
    while (this.stepped < due && steps < 8) {
      this.tickOnce();
      steps += 1;
    }
    // A long stall: drop the time rather than run a burst.
    if (this.stepped < due) this.startMs = nowMs - this.stepped * 1000 * DT;
    const frac = (nowMs - this.startMs) / (1000 * DT) - this.stepped;
    // Drawn one tick behind the newest, so there is always a tick ahead to
    // interpolate toward.
    this.renderTick = this.sim.tick - 1 + Math.min(1, Math.max(0, frac)) - this.lag.update(nowMs);
  }

  private tickOnce(): void {
    const sim = this.sim;
    const roundTick = sim.tick - COUNTDOWN_TICKS;
    const phase: RoundPhase = roundTick < 0 ? 'countdown' : roundTick < ROUND_TICKS ? 'live' : 'over';
    if (phase !== this.phaseNow) {
      this.phaseNow = phase;
      this.events.push({ kind: 'phase', phase });
    }
    sim.powered = phase === 'live';
    const inputs = this.bots.map((bot, seat) => (bot ? botInput(bot, sim) : seat === 0 ? this.input : null));
    setInputs(sim, inputs);
    this.stepEvents.length = 0;
    stepSim(sim, this.stepEvents);
    this.stepped += 1;
    this.history.record(sim);
    for (const e of this.stepEvents) {
      if (e.type === 'bump') {
        this.events.push({ kind: 'bump', a: e.a, b: e.b, speed: e.speed, x: e.x, z: e.z, nx: e.nx, nz: e.nz, pa: e.pa, pb: e.pb });
        if (e.pa > 0) this.events.push({ kind: 'score', seat: e.a, points: e.pa, victim: e.b, big: e.pa > 1 });
        if (e.pb > 0) this.events.push({ kind: 'score', seat: e.b, points: e.pb, victim: e.a, big: e.pb > 1 });
      } else if (e.type === 'touch') {
        this.events.push({ kind: 'touch', a: e.a, b: e.b, speed: e.speed, x: e.x, z: e.z, nx: e.nx, nz: e.nz });
      } else {
        this.events.push({ kind: 'wall', car: e.car, speed: e.speed, x: e.x, z: e.z });
      }
    }
  }

  /** True once the cars have coasted to a stop after the horn. */
  finished(): boolean {
    return this.sim.tick - COUNTDOWN_TICKS >= ROUND_TICKS + COAST_TICKS;
  }

  pose(seat: number, out: Pose): void {
    this.history.sample(seat, this.renderTick, out);
  }

  drainEvents(): FeelEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  hitStop(nowMs: number): void {
    this.lag.hit(nowMs, this.reduced());
  }

  dispose(): void {
    this.events = [];
  }
}

export { TICK_HZ };
