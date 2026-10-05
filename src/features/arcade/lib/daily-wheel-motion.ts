/* How the daily wheel moves (DAILY_WHEEL.md, "Feel spec"). Pure functions
   of time: the wheel's rotation is never stepped, so any refresh rate draws
   the same curve, and the stop is exactly the drawn unit's stop point.

   Rotation is in degrees, clockwise, unbounded (it keeps counting turns).
   Time is in ms on the performance.now() clock. Speeds are deg/ms. */

import {
  DAILY_WHEEL_UNIT_DEG,
  DAILY_WHEEL_UNITS,
  rotationForWheelAngle,
  wheelRestFraction,
} from './daily-wheel';

/** Top speed after the pull: 2.5 turns a second. */
export const WHEEL_TOP_SPEED = (2.5 * 360) / 1000;
export const WHEEL_KICK_MS = 280;
/** The slowdown's power: speed falls as (1 - u)^(K - 1). */
export const WHEEL_DECEL_POWER = 2.6;
/** Whole turns added to the distance to the stop point. */
export const WHEEL_EXTRA_TURNS = 3;
export const WHEEL_STALL_MS = 140;
export const WHEEL_ROCK_MS = 380;
export const WHEEL_SKIP_MS = 450;
export const WHEEL_COAST_MS = 1200;

/* The flapper's contact with a peg, in wheel degrees: a peg touches it
   PEG_TOUCH before the top and slips past PEG_SLIP after. */
export const PEG_TOUCH = 2.0;
export const PEG_SLIP = 2.6;

/** Where a spin rests: the wheel angle under the flapper, and whether it
 *  first climbs the next peg and rocks back. */
export type WheelStop = {
  unit: number;
  /** Rest, as a fraction of the unit from its leading peg line (0 to 1). */
  rest: number;
  /** When set, the slowdown ends with the next peg pushing the flapper this
   *  fraction of its way over (0 to 1), then the wheel rocks back to `rest`. */
  climb: number | null;
};

/* A free stop sits clear of both pegs: past the one behind (it has slipped
   off the flapper) and short of the one ahead (it hasn't touched). */
const REST_MIN = PEG_TOUCH / DAILY_WHEEL_UNIT_DEG + 0.03;
const REST_MAX = 1 - PEG_SLIP / DAILY_WHEEL_UNIT_DEG - 0.03;

/** The stop for a drawn unit; `seed` makes it the same on every draw of
 *  that day (the day key). Cosmetic: the unit is the result. */
export function wheelStopFor(unit: number, seed: string): WheelStop {
  const a = wheelRestFraction(`${seed}:${unit}:a`);
  const b = wheelRestFraction(`${seed}:${unit}:b`);
  if (a < 0.4) {
    // Climbs the next peg and rocks back to just clear of it.
    return { unit, rest: REST_MIN + 0.12 * b, climb: 0.35 + 0.45 * wheelRestFraction(`${seed}:${unit}:c`) };
  }
  return { unit, rest: REST_MIN + (REST_MAX - REST_MIN) * b, climb: null };
}

/** The rotation (0 to 360) at which the flapper reads `rest` in `unit`. */
export function restRotation(stop: Pick<WheelStop, 'unit' | 'rest'>) {
  return rotationForWheelAngle((stop.unit + stop.rest) * DAILY_WHEEL_UNIT_DEG);
}

/** The rotation at the top of a climb: the next peg (the unit's leading
 *  line) pushed `climb` of the way from touching to slipping. Past rest. */
function climbRotation(stop: WheelStop, rest: number) {
  if (stop.climb === null) return rest;
  // At rest the leading peg is rest * unit left of the top (delta below 0);
  // it touches at -PEG_TOUCH and would slip at +PEG_SLIP.
  const atRest = -stop.rest * DAILY_WHEEL_UNIT_DEG;
  const peak = -PEG_TOUCH + stop.climb * (PEG_TOUCH + PEG_SLIP);
  return rest + (peak - atRest);
}

type Piece = {
  from: number;
  to: number;
  angle: (t: number) => number;
  speed: (t: number) => number;
};

const decelCurve = (u: number) => 1 - (1 - u) ** WHEEL_DECEL_POWER;
const decelSlope = (u: number) => WHEEL_DECEL_POWER * (1 - u) ** (WHEEL_DECEL_POWER - 1);
const smooth = (u: number) => u * u * (3 - 2 * u);
const smoothSlope = (u: number) => 6 * u * (1 - u);
const clamp01 = (u: number) => Math.min(1, Math.max(0, u));

/** Up to speed `top` from rest at `t0` in KICK ms: v = top * (1 - (1 - s)^2). */
function kickPiece(t0: number, angle0: number, top: number): Piece {
  const k = WHEEL_KICK_MS;
  const end = angle0 + (2 / 3) * top * k;
  return {
    from: t0,
    to: Infinity,
    angle: (t) => {
      const tau = Math.max(0, t - t0);
      if (tau >= k) return end + top * (tau - k);
      const s = tau / k;
      return angle0 + top * k * (s - (1 - (1 - s) ** 3) / 3);
    },
    speed: (t) => {
      const tau = Math.max(0, t - t0);
      if (tau >= k) return top;
      const s = tau / k;
      return top * (1 - (1 - s) ** 2);
    },
  };
}

/** From (angle0, speed0) to a stop at `end` with the slowdown curve. The
 *  duration follows from the speed, so speed is continuous at the switch. */
function decelPiece(t0: number, angle0: number, speed0: number, end: number): Piece {
  const distance = end - angle0;
  const duration = (WHEEL_DECEL_POWER * distance) / Math.max(speed0, 1e-4);
  return {
    from: t0,
    to: t0 + duration,
    angle: (t) => angle0 + distance * decelCurve(clamp01((t - t0) / duration)),
    speed: (t) => (distance / duration) * decelSlope(clamp01((t - t0) / duration)),
  };
}

/** A cubic Hermite from (angle0, speed0) to `end` at rest, in `duration`. */
function hermitePiece(t0: number, angle0: number, speed0: number, end: number, duration: number): Piece {
  const distance = end - angle0;
  const m = speed0 * duration;
  return {
    from: t0,
    to: t0 + duration,
    angle: (t) => {
      const u = clamp01((t - t0) / duration);
      return angle0 + m * (u - 2 * u * u + u * u * u) + distance * (3 * u * u - 2 * u * u * u);
    },
    speed: (t) => {
      const u = clamp01((t - t0) / duration);
      return (m * (1 - 4 * u + 3 * u * u) + distance * (6 * u - 6 * u * u)) / duration;
    },
  };
}

function holdPiece(t0: number, duration: number, angle: number): Piece {
  return { from: t0, to: t0 + duration, angle: () => angle, speed: () => 0 };
}

function easePiece(t0: number, duration: number, from: number, to: number): Piece {
  return {
    from: t0,
    to: t0 + duration,
    angle: (t) => from + (to - from) * smooth(clamp01((t - t0) / duration)),
    speed: (t) => ((to - from) / duration) * smoothSlope(clamp01((t - t0) / duration)),
  };
}

/** The smallest angle >= `atLeast` that is `target` mod 360. */
function nextAt(target: number, atLeast: number) {
  const base = ((target % 360) + 360) % 360;
  const turns = Math.ceil((atLeast - base) / 360);
  return base + turns * 360;
}

export type WheelPhase = 'rest' | 'spinning' | 'stopping' | 'stopped';

/**
 * The wheel's motion. `start` kicks it; `stopAt` plans the stop once the
 * server names the unit; `skip` hurries the stop; `coast` stops it anywhere
 * (an error). `angleAt(t)` is all a frame needs.
 */
export function createWheelMotion(initial = 0) {
  let pieces: Piece[] = [];
  let restAngle = initial;
  let stopAt: number | null = null;
  let planned: { stop: WheelStop; rest: number; landAt: number } | null = null;

  const pieceAt = (t: number) => {
    for (const piece of pieces) if (t < piece.to) return piece;
    return null;
  };

  const angleAt = (t: number): number => {
    if (pieces.length === 0) return restAngle;
    if (t < pieces[0]!.from) return pieces[0]!.angle(pieces[0]!.from);
    const piece = pieceAt(t);
    if (piece) return piece.angle(t);
    const last = pieces[pieces.length - 1]!;
    return last.angle(last.to);
  };

  const speedAt = (t: number): number => {
    const piece = pieceAt(t);
    return piece ? piece.speed(t) : 0;
  };

  return {
    angleAt,
    speedAt,
    /** When the wheel comes to rest on its stop (after any rock back). */
    get stopsAt() {
      return stopAt;
    },
    /** When the slot is decided on screen: the end of the slowdown. */
    get landsAt() {
      return planned?.landAt ?? null;
    },
    get planned() {
      return planned;
    },
    phase(t: number): WheelPhase {
      if (pieces.length === 0) return 'rest';
      if (stopAt === null) return 'spinning';
      return t < stopAt ? 'stopping' : 'stopped';
    },
    /** Put the wheel at rest on a stop with no motion (already spun). */
    restOn(stop: WheelStop) {
      pieces = [];
      restAngle = restRotation(stop);
      stopAt = null;
      planned = { stop, rest: restAngle, landAt: 0 };
    },
    start(t: number, top = WHEEL_TOP_SPEED) {
      const angle = angleAt(t);
      pieces = [kickPiece(t, angle, top)];
      stopAt = null;
      planned = null;
    },
    /** Plan the stop on `stop`, no earlier than the end of the kick. */
    stopOn(t: number, stop: WheelStop) {
      const kick = pieces[0];
      const from = kick ? Math.max(t, kick.from + WHEEL_KICK_MS) : t;
      const angle0 = angleAt(from);
      const speed0 = Math.max(speedAt(from), WHEEL_TOP_SPEED * 0.5);
      const restMod = restRotation(stop);
      // At least the extra turns, plus the way round to the stop point.
      const rest = nextAt(restMod, angle0 + WHEEL_EXTRA_TURNS * 360);
      const peak = climbRotation(stop, rest);
      const decel = decelPiece(from, angle0, speed0, peak);
      const next: Piece[] = [...pieces.filter((piece) => piece.from < from).map((piece) => ({ ...piece, to: from })), decel];
      let end = decel.to;
      if (peak !== rest) {
        next.push(holdPiece(end, WHEEL_STALL_MS, peak));
        end += WHEEL_STALL_MS;
        next.push(easePiece(end, WHEEL_ROCK_MS, peak, rest));
        end += WHEEL_ROCK_MS;
      }
      pieces = next;
      restAngle = rest;
      stopAt = end;
      planned = { stop, rest, landAt: decel.to };
    },
    /** Hurry a planned stop: reach the rest point in SKIP ms from here. */
    skip(t: number) {
      if (!planned || stopAt === null || t >= stopAt) return;
      const angle0 = angleAt(t);
      const speed0 = speedAt(t);
      let end = nextAt(planned.rest, angle0);
      // Monotonic only while speed * time <= 3 * distance: go round once more.
      while (speed0 * WHEEL_SKIP_MS > 3 * (end - angle0)) end += 360;
      const keep = pieces.filter((piece) => piece.from < t).map((piece) => ({ ...piece, to: Math.min(piece.to, t) }));
      pieces = [...keep, hermitePiece(t, angle0, speed0, end, WHEEL_SKIP_MS)];
      restAngle = end;
      stopAt = t + WHEEL_SKIP_MS;
      planned = { ...planned, rest: end, landAt: stopAt };
    },
    /** Stop wherever the wheel gets to (the spin failed). */
    coast(t: number) {
      const angle0 = angleAt(t);
      const speed0 = speedAt(t);
      const distance = (speed0 * WHEEL_COAST_MS) / WHEEL_DECEL_POWER;
      const keep = pieces.filter((piece) => piece.from < t).map((piece) => ({ ...piece, to: Math.min(piece.to, t) }));
      const decel = decelPiece(t, angle0, speed0, angle0 + distance);
      pieces = [...keep, decel];
      restAngle = angle0 + distance;
      stopAt = decel.to;
      planned = null;
    },
  };
}

export type WheelMotion = ReturnType<typeof createWheelMotion>;

/* ── the flapper ──────────────────────────────────────────────────────── */

/** The peg touching the flapper at `rotation`, and how far it has pushed it
 *  (0 touching, 1 about to slip). Null when no peg touches. */
export function flapperContact(rotation: number): { peg: number; push: number } | null {
  // Peg j sits at wheel angle j * unit; on screen at j * unit + rotation.
  // The one nearest the top, measured with left of top negative.
  const unit = DAILY_WHEEL_UNIT_DEG;
  const k = Math.round(-rotation / unit);
  for (const j of [k - 1, k, k + 1]) {
    const delta = j * unit + rotation; // 0 at the top
    if (delta >= -PEG_TOUCH && delta <= PEG_SLIP) {
      const peg = ((j % DAILY_WHEEL_UNITS) + DAILY_WHEEL_UNITS) % DAILY_WHEEL_UNITS;
      return { peg, push: (delta + PEG_TOUCH) / (PEG_TOUCH + PEG_SLIP) };
    }
  }
  return null;
}

/** Pegs that slipped past the flapper going forward between two rotations. */
export function pegsPassed(from: number, to: number) {
  if (to <= from) return 0;
  // A peg slips when j * unit + rotation crosses PEG_SLIP: count the
  // multiples of a unit crossed by (rotation - PEG_SLIP).
  const unit = DAILY_WHEEL_UNIT_DEG;
  return Math.floor((to - PEG_SLIP) / unit) - Math.floor((from - PEG_SLIP) / unit);
}
