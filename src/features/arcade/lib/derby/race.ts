/* Derby's race: a pure function of the seed, the lanes and the aim samples.

   Every lane sends one sample a tick: where its stream points and whether
   the water runs. A tick's speed is derbySpeedShare of the stream's
   distance from the target's middle at that tick, and the horse covers it
   evenly across the tick. A lane's distance is the sum, so the server,
   every phone and the verifier judge the same race from the same samples,
   at any frame rate. A tick nobody sent is dry: the horse stands.

   The model holds two layers per lane: `known` ticks the server has made
   final (confirmed), and on your own phone the ticks you have aimed but
   the server hasn't answered yet (provisional), drawn ahead of it. */

import { derbyBotSamples, derbyBotSkillFor } from './bots';
import {
  DERBY_AIM_SCALE,
  DERBY_DISTANCE,
  DERBY_LANES,
  DERBY_MAX_TICKS,
  DERBY_RACE_MAX_MS,
  DERBY_TARGET_R,
  DERBY_TICK_LENGTHS,
  DERBY_TICK_MS,
  derbySpeedShare,
} from './rules';
import { derbyTargetPath, type DerbyTargetPath } from './target';

export type DerbyLaneSpec = {
  lane: number;
  kind: 'human' | 'bot';
  /** A bot's skill index (DERBY_BOT_SKILLS); ignored for people. */
  botSkill?: number;
};

export type DerbyResult = {
  /** The lane that reached the wire first, or the leader at the time limit. */
  winner: number;
  /** When the race ended: the winner's crossing, or the time limit (ms). */
  endT: number;
  timedOut: boolean;
  /** Lanes from first to last. */
  order: number[];
  /** Each lane's distance at the end, by lane. */
  distance: number[];
};

/** Place a lane finished (1 is first) in a result. */
export function derbyPlaceOf(result: DerbyResult, lane: number): number {
  return result.order.indexOf(lane) + 1;
}

/** Target radii from the target's middle for a sample at tick k. */
export function derbySampleDistance(path: DerbyTargetPath, k: number, x: number, y: number): number {
  const dx = x / DERBY_AIM_SCALE - path.ticks[k * 2]!;
  const dy = y / DERBY_AIM_SCALE - path.ticks[k * 2 + 1]!;
  return Math.sqrt(dx * dx + dy * dy) / DERBY_TARGET_R;
}

/** Lengths a sample at tick k moves the horse. */
export function derbySampleLengths(path: DerbyTargetPath, k: number, x: number, y: number, squirt: number): number {
  if (squirt !== 1) return 0;
  return derbySpeedShare(derbySampleDistance(path, k, x, y)) * DERBY_TICK_LENGTHS;
}

export type DerbyConfirm = 'applied' | 'old' | 'gap';

export class DerbyRaceModel {
  readonly seed: number;
  readonly lanes: DerbyLaneSpec[];
  readonly path: DerbyTargetPath;
  /** Per lane, flat [x, y, squirt] per tick. */
  readonly samples: Int32Array[];
  /** Per lane, lengths covered in each tick. */
  readonly speeds: Float64Array[];
  /** Per lane, the distance at the start of each tick (one longer). */
  readonly cum: Float64Array[];
  /** Per lane, ticks that are final (the server's). */
  readonly known: Int32Array;
  /** Per lane, ticks written (known plus your own provisional ones). */
  readonly filled: Int32Array;
  /** Ticks final for every lane: a lane that sent nothing for them was dry. */
  sealed = 0;
  private readonly crossCache: (number | null | undefined)[];

  constructor(seed: number, lanes: readonly DerbyLaneSpec[]) {
    this.seed = seed >>> 0;
    this.path = derbyTargetPath(this.seed);
    this.lanes = Array.from({ length: DERBY_LANES }, (_, lane) => {
      const spec = lanes.find((l) => l.lane === lane);
      return spec?.kind === 'human'
        ? { lane, kind: 'human' as const }
        : { lane, kind: 'bot' as const, botSkill: spec?.botSkill ?? derbyBotSkillFor(this.seed, lane) };
    });
    this.samples = [];
    this.speeds = [];
    this.cum = [];
    this.known = new Int32Array(DERBY_LANES);
    this.filled = new Int32Array(DERBY_LANES);
    this.crossCache = Array(DERBY_LANES).fill(undefined);
    for (const spec of this.lanes) {
      const bot = spec.kind === 'bot';
      this.samples.push(bot ? derbyBotSamples(this.seed, spec.lane, spec.botSkill ?? 0, this.path) : new Int32Array(DERBY_MAX_TICKS * 3));
      this.speeds.push(new Float64Array(DERBY_MAX_TICKS));
      this.cum.push(new Float64Array(DERBY_MAX_TICKS + 1));
      if (bot) {
        this.write(spec.lane, 0, DERBY_MAX_TICKS);
        this.known[spec.lane] = DERBY_MAX_TICKS;
        this.filled[spec.lane] = DERBY_MAX_TICKS;
      }
    }
  }

  isBot(lane: number): boolean {
    return this.lanes[lane]?.kind === 'bot';
  }

  /** Recompute speeds for ticks [from, to) from the samples, then the
   *  running distance from `from` to the end of what's written. */
  private write(lane: number, from: number, to: number) {
    const s = this.samples[lane]!;
    const v = this.speeds[lane]!;
    for (let k = from; k < to; k += 1) v[k] = derbySampleLengths(this.path, k, s[k * 3]!, s[k * 3 + 1]!, s[k * 3 + 2]!);
    const c = this.cum[lane]!;
    const end = Math.max(to, this.filled[lane]!);
    for (let k = from; k < end; k += 1) c[k + 1] = c[k]! + v[k]!;
    this.crossCache[lane] = undefined;
  }

  private put(lane: number, from: number, samples: ArrayLike<number>, offset: number, count: number) {
    const s = this.samples[lane]!;
    for (let i = 0; i < count; i += 1) {
      s[(from + i) * 3] = samples[(offset + i) * 3]!;
      s[(from + i) * 3 + 1] = samples[(offset + i) * 3 + 1]!;
      s[(from + i) * 3 + 2] = samples[(offset + i) * 3 + 2]!;
    }
  }

  /**
   * The server's word on a lane: ticks [prev, from) were dry and [from,
   * from + n) are these samples. Applies only in order (prev must be the
   * lane's known end): 'old' for news already held, 'gap' when something
   * before it is missing.
   */
  confirm(lane: number, prev: number, from: number, samples: ArrayLike<number>): DerbyConfirm {
    if (this.isBot(lane) || !this.samples[lane]) return 'old';
    const n = Math.floor(samples.length / 3);
    const known = this.known[lane]!;
    if (prev < known) return 'old';
    if (prev > known) return 'gap';
    if (from < prev || from + n > DERBY_MAX_TICKS) return 'old';
    const s = this.samples[lane]!;
    for (let k = prev; k < from; k += 1) {
      s[k * 3] = 0;
      s[k * 3 + 1] = 0;
      s[k * 3 + 2] = 0;
    }
    this.put(lane, from, samples, 0, n);
    this.known[lane] = from + n;
    if (this.filled[lane]! < from + n) this.filled[lane] = from + n;
    this.write(lane, prev, from + n);
    return 'applied';
  }

  /** Your own aim, ahead of the server's answer: ticks from `from`. */
  provisional(lane: number, from: number, samples: ArrayLike<number>) {
    if (this.isBot(lane) || !this.samples[lane]) return;
    const n = Math.floor(samples.length / 3);
    const start = Math.max(from, this.known[lane]!);
    const skip = start - from;
    if (n - skip <= 0 || start + n - skip > DERBY_MAX_TICKS) return;
    // Ticks skipped since the last written one were dry.
    const was = this.filled[lane]!;
    const s = this.samples[lane]!;
    for (let k = was; k < start; k += 1) {
      s[k * 3] = 0;
      s[k * 3 + 1] = 0;
      s[k * 3 + 2] = 0;
    }
    this.put(lane, start, samples, skip, n - skip);
    if (was < start + n - skip) this.filled[lane] = start + n - skip;
    this.write(lane, Math.min(was, start), start + n - skip);
  }

  /** Drop provisional ticks (a page that lost its own samples). */
  dropProvisional(lane: number) {
    this.filled[lane] = this.known[lane]!;
  }

  /** Ticks every lane is final through (from the server's clock). */
  seal(tick: number) {
    if (tick > this.sealed) this.sealed = Math.min(DERBY_MAX_TICKS, tick);
  }

  /** A lane's distance at race time `t`. Final ticks only, unless
   *  `ahead` (your own provisional ticks too). Past the data the horse
   *  stands. */
  distance(lane: number, t: number, ahead = false): number {
    const end = ahead ? this.filled[lane]! : this.known[lane]!;
    const c = this.cum[lane]!;
    if (!(t > 0)) return 0;
    const k = Math.floor(t / DERBY_TICK_MS);
    if (k >= end) return c[end]!;
    return c[k]! + (this.speeds[lane]![k]! * (t - k * DERBY_TICK_MS)) / DERBY_TICK_MS;
  }

  /** Lengths a second over the last `ticks` final ticks before `tick`. */
  recentSpeed(lane: number, tick: number, ticks = 8): number {
    const end = Math.min(tick, this.known[lane]!);
    const start = Math.max(0, end - ticks);
    if (end <= start) return 0;
    const c = this.cum[lane]!;
    return ((c[end]! - c[start]!) / (end - start)) * (1000 / DERBY_TICK_MS);
  }

  /** The moment a lane's horse reaches the wire in its final ticks, or null. */
  crossTime(lane: number): number | null {
    const cached = this.crossCache[lane];
    if (cached !== undefined) return cached;
    const c = this.cum[lane]!;
    const v = this.speeds[lane]!;
    const end = this.known[lane]!;
    let found: number | null = null;
    if (c[end]! >= DERBY_DISTANCE) {
      // The running distance only grows: halve to the crossing tick.
      let lo = 0;
      let hi = end - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (c[mid + 1]! >= DERBY_DISTANCE) hi = mid;
        else lo = mid + 1;
      }
      found = lo * DERBY_TICK_MS + ((DERBY_DISTANCE - c[lo]!) / v[lo]!) * DERBY_TICK_MS;
    }
    this.crossCache[lane] = found;
    return found;
  }

  /** The result if it is decided: the first crossing is known, and every
   *  lane is final up to it (so nobody could have crossed sooner). */
  decided(): DerbyResult | null {
    let winner = -1;
    let endT = Infinity;
    for (let lane = 0; lane < DERBY_LANES; lane += 1) {
      const cross = this.crossTime(lane);
      if (cross !== null && cross < endT) {
        endT = cross;
        winner = lane;
      }
    }
    const limit = winner < 0 ? DERBY_RACE_MAX_MS : endT;
    for (let lane = 0; lane < DERBY_LANES; lane += 1) {
      const through = Math.max(this.known[lane]!, this.sealed) * DERBY_TICK_MS;
      if (through < limit) return null;
    }
    return this.resultAt(winner, limit);
  }

  private resultAt(winner: number, endT: number): DerbyResult {
    const timedOut = winner < 0;
    const distance = this.lanes.map((_, lane) => Math.min(DERBY_DISTANCE, this.distance(lane, endT)));
    const order = this.lanes
      .map((_, lane) => lane)
      .sort((a, b) => {
        if (a === winner) return -1;
        if (b === winner) return 1;
        return distance[b]! - distance[a]! || a - b;
      });
    return { winner: timedOut ? order[0]! : winner, endT, timedOut, order, distance };
  }
}

export type DerbyTracking = {
  /** Ticks the water ran, and of those, on the target and on the bull. */
  squirting: number;
  onTarget: number;
  onBull: number;
  /** Mean distance from the middle (target radii) over the ticks on target. */
  meanOn: number;
  /** Spread of the stream's distance from the middle on target. */
  spreadOn: number;
};

/** How a lane tracked the target over ticks [0, endTick): the anti-cheat
 *  reads this at the settle. */
export function derbyTracking(model: DerbyRaceModel, lane: number, endTick: number): DerbyTracking {
  const s = model.samples[lane]!;
  const end = Math.min(endTick, model.known[lane]!);
  let squirting = 0;
  let onTarget = 0;
  let onBull = 0;
  let sum = 0;
  let sum2 = 0;
  for (let k = 0; k < end; k += 1) {
    if (s[k * 3 + 2] !== 1) continue;
    squirting += 1;
    const d = derbySampleDistance(model.path, k, s[k * 3]!, s[k * 3 + 1]!);
    if (d < 1) {
      onTarget += 1;
      sum += d;
      sum2 += d * d;
      if (d <= 0.3) onBull += 1;
    }
  }
  const meanOn = onTarget ? sum / onTarget : 0;
  const spreadOn = onTarget ? Math.sqrt(Math.max(0, sum2 / onTarget - meanOn * meanOn)) : 0;
  return { squirting, onTarget, onBull, meanOn, spreadOn };
}
