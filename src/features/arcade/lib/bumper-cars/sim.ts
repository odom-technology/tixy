/* The bumper cars physics. One fixed step moves every car, resolves every
   contact and reports the bumps. Pure and allocation-light, no DOM or Node
   APIs: the server's room loop runs it as the authority, and the page runs the
   same code ahead of the server to predict.

   Determinism. Only + - * / and Math.sqrt touch the state, which IEEE 754 gives
   the same in every engine; the per-tick turn uses a polynomial in place of
   Math.sin and Math.cos, and the state is rounded to a fixed grid at the end of
   every tick. Snapshots carry the same grid, so a page that starts from a
   snapshot and is given the same inputs lands on the server's numbers exactly. */

import {
  ACCEL,
  BIG_BUMP_SPEED,
  BUMP_MIN_SPEED,
  CAR_INERTIA,
  CAR_MASS,
  CAR_RADIUS,
  CONTACT_FRICTION,
  DRAG,
  DRIFT_GRIP,
  DRIFT_SPEED,
  DRIFT_STEER,
  DT,
  GRIP,
  HEAD_ON_SHARE,
  INPUT_STEPS,
  MAX_CARS,
  MAX_SCORES_PER_VICTIM,
  PAIR_COOLDOWN_TICKS,
  RESTITUTION_CAR,
  RESTITUTION_WALL,
  REVERSE_ACCEL,
  RINK_CORNER,
  RINK_HX,
  RINK_HZ,
  ROLL_DECEL,
  SIDE_HIT_SPIN,
  SLIP_GRIP,
  SLIP_TICKS,
  TURN_RATE,
  YAW_RESPONSE,
} from './constants';

export type CarState = {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Unit vector along the car's nose. */
  fx: number;
  fz: number;
  /** Yaw rate, rad/s. Positive turns right seen from above. */
  w: number;
  /** Ticks of low grip left after a hit. */
  slip: number;
  /** The input this car is driving with, -INPUT_STEPS..INPUT_STEPS. */
  steer: number;
  throttle: number;
  /** Whether this car's bumps score. A seat a bot is minding for a player
   *  who dropped, or one a player left, still bumps but doesn't score. */
  counts: boolean;
  /** Whether a car is in the round at all. Empty seats park off the floor. */
  active: boolean;
};

export type SimState = {
  tick: number;
  /** Power to the floor. Off in the count in and after the horn. */
  powered: boolean;
  cars: CarState[];
  points: number[];
  bumps: number[];
  /** Last tick each ordered pair (a * MAX_CARS + b, a < b) scored. */
  pairTick: Int32Array;
  /** Times car a scored off car b this round, at a * MAX_CARS + b. */
  hits: Int16Array;
};

export type CarInput = { steer: number; throttle: number };

export type BumpEvent = {
  type: 'bump';
  tick: number;
  /** The two cars, a < b. */
  a: number;
  b: number;
  /** Points each scored: 0, 1 or 2. Head on, both score. */
  pa: number;
  pb: number;
  /** Closing speed, m/s. */
  speed: number;
  x: number;
  z: number;
  /** Contact normal, from a to b. */
  nx: number;
  nz: number;
};

export type WallEvent = {
  type: 'wall';
  tick: number;
  car: number;
  speed: number;
  x: number;
  z: number;
};

/** A touch too soft to score: still a sound and a squash. */
export type TouchEvent = {
  type: 'touch';
  tick: number;
  a: number;
  b: number;
  speed: number;
  x: number;
  z: number;
  nx: number;
  nz: number;
};

export type SimEvent = BumpEvent | WallEvent | TouchEvent;

// ── The grid the state lives on ──────────────────────────────────────────
const POS_Q = 1000; // 1 mm
const VEL_Q = 1000; // 1 mm/s
const DIR_Q = 100000;
const YAW_Q = 10000;

const q = (v: number, s: number) => Math.round(v * s) / s;

export function quantizeCar(car: CarState): void {
  car.x = q(car.x, POS_Q);
  car.z = q(car.z, POS_Q);
  car.vx = q(car.vx, VEL_Q);
  car.vz = q(car.vz, VEL_Q);
  car.fx = q(car.fx, DIR_Q);
  car.fz = q(car.fz, DIR_Q);
  car.w = q(car.w, YAW_Q);
}

/** Integers for the wire: [x mm, z mm, vx mm/s, vz mm/s, fx e5, fz e5, w e4]. */
export function packCar(car: CarState): number[] {
  return [
    Math.round(car.x * POS_Q),
    Math.round(car.z * POS_Q),
    Math.round(car.vx * VEL_Q),
    Math.round(car.vz * VEL_Q),
    Math.round(car.fx * DIR_Q),
    Math.round(car.fz * DIR_Q),
    Math.round(car.w * YAW_Q),
  ];
}

export function unpackCarInto(car: CarState, p: readonly number[]): void {
  car.x = p[0]! / POS_Q;
  car.z = p[1]! / POS_Q;
  car.vx = p[2]! / VEL_Q;
  car.vz = p[3]! / VEL_Q;
  car.fx = p[4]! / DIR_Q;
  car.fz = p[5]! / DIR_Q;
  car.w = p[6]! / YAW_Q;
}

// ── Setting up ───────────────────────────────────────────────────────────

/** Where each seat starts: four down each long side, nose to the middle,
 *  filled so the first cars in are spread round the floor. */
export function spawnPose(seat: number): { x: number; z: number; fx: number; fz: number } {
  const [sx, row] = SPAWN_GRID[seat % SPAWN_GRID.length]!;
  const x = sx * (RINK_HX - 2.1);
  const z = row * ((RINK_HZ - 2.4) / 3);
  const len = Math.sqrt(x * x + z * z) || 1;
  return { x, z, fx: -x / len, fz: -z / len };
}

// Side (-1 left, 1 right) and row (-3, -1, 1, 3 from the far end).
const SPAWN_GRID: ReadonlyArray<readonly [number, number]> = [
  [1, 3],
  [-1, -3],
  [-1, 3],
  [1, -3],
  [-1, 1],
  [1, -1],
  [1, 1],
  [-1, -1],
];

export function createCar(seat: number, active = true): CarState {
  const pose = spawnPose(seat);
  const car: CarState = {
    x: active ? pose.x : 0,
    z: active ? pose.z : 0,
    vx: 0,
    vz: 0,
    fx: pose.fx,
    fz: pose.fz,
    w: 0,
    slip: 0,
    steer: 0,
    throttle: 0,
    counts: true,
    active,
  };
  quantizeCar(car);
  return car;
}

export function createSim(activeSeats: readonly boolean[] = new Array(MAX_CARS).fill(true)): SimState {
  return {
    tick: 0,
    powered: false,
    cars: Array.from({ length: MAX_CARS }, (_, i) => createCar(i, activeSeats[i] ?? false)),
    points: new Array(MAX_CARS).fill(0),
    bumps: new Array(MAX_CARS).fill(0),
    pairTick: new Int32Array(MAX_CARS * MAX_CARS).fill(-1_000_000),
    hits: new Int16Array(MAX_CARS * MAX_CARS),
  };
}

export function copyCar(from: CarState, to: CarState): void {
  to.x = from.x;
  to.z = from.z;
  to.vx = from.vx;
  to.vz = from.vz;
  to.fx = from.fx;
  to.fz = from.fz;
  to.w = from.w;
  to.slip = from.slip;
  to.steer = from.steer;
  to.throttle = from.throttle;
  to.counts = from.counts;
  to.active = from.active;
}

export function cloneSim(state: SimState): SimState {
  return {
    tick: state.tick,
    powered: state.powered,
    cars: state.cars.map((c) => ({ ...c })),
    points: state.points.slice(),
    bumps: state.bumps.slice(),
    pairTick: state.pairTick.slice(),
    hits: state.hits.slice(),
  };
}

export function copySimInto(from: SimState, to: SimState): void {
  to.tick = from.tick;
  to.powered = from.powered;
  for (let i = 0; i < MAX_CARS; i += 1) {
    copyCar(from.cars[i]!, to.cars[i]!);
    to.points[i] = from.points[i]!;
    to.bumps[i] = from.bumps[i]!;
  }
  to.pairTick.set(from.pairTick);
  to.hits.set(from.hits);
}

export function clampInput(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const n = Math.round(value);
  return n > INPUT_STEPS ? INPUT_STEPS : n < -INPUT_STEPS ? -INPUT_STEPS : n;
}

// ── One tick ─────────────────────────────────────────────────────────────

const GRIP_K = GRIP * DT;
const DRIFT_K = DRIFT_GRIP * DT;
const SLIP_K = SLIP_GRIP * DT;
const DRAG_K = DRAG * DT;
const YAW_K = Math.min(1, YAW_RESPONSE * DT);
const MIN_SEP = CAR_RADIUS * 2;
const MIN_SEP2 = MIN_SEP * MIN_SEP;
const INNER_HX = RINK_HX - RINK_CORNER;
const INNER_HZ = RINK_HZ - RINK_CORNER;
const WALL_REACH = RINK_CORNER - CAR_RADIUS;
const INV_M = 1 / CAR_MASS;
const INV_I = 1 / CAR_INERTIA;

/** Turn a unit vector by a small angle without Math.sin or Math.cos. */
function turn(car: CarState, theta: number): void {
  const t2 = theta * theta;
  const s = theta * (1 - (t2 / 6) * (1 - t2 / 20));
  const c = 1 - (t2 / 2) * (1 - t2 / 12);
  const fx = car.fx * c - car.fz * s;
  const fz = car.fx * s + car.fz * c;
  const len = Math.sqrt(fx * fx + fz * fz) || 1;
  car.fx = fx / len;
  car.fz = fz / len;
}

function drive(car: CarState, powered: boolean): void {
  const steer = powered ? car.steer / INPUT_STEPS : 0;
  const throttle = powered ? car.throttle / INPUT_STEPS : 0;

  // Steering: a dodgem's drive wheel turns the car even standing still.
  const targetW = steer * TURN_RATE;
  car.w += (targetW - car.w) * YAW_K;
  turn(car, car.w * DT);

  // Push along the nose.
  const push = throttle >= 0 ? throttle * ACCEL : throttle * REVERSE_ACCEL;
  car.vx += car.fx * push * DT;
  car.vz += car.fz * push * DT;

  // Drag.
  car.vx -= car.vx * DRAG_K;
  car.vz -= car.vz * DRAG_K;

  // Split into along the nose and across it.
  const along = car.vx * car.fx + car.vz * car.fz;
  let across = car.vx * -car.fz + car.vz * car.fx;
  const speed2 = car.vx * car.vx + car.vz * car.vz;
  let k = GRIP_K;
  if (car.slip > 0) {
    k = SLIP_K;
    car.slip -= 1;
  } else if (speed2 > DRIFT_SPEED * DRIFT_SPEED && (steer > DRIFT_STEER || steer < -DRIFT_STEER)) {
    k = DRIFT_K;
  }
  across -= across * k;
  car.vx = car.fx * along - car.fz * across;
  car.vz = car.fz * along + car.fx * across;

  // Pedal up: rolling friction brings it to rest.
  if (throttle > -0.05 && throttle < 0.05) {
    const speed = Math.sqrt(car.vx * car.vx + car.vz * car.vz);
    if (speed > 0) {
      const next = speed - ROLL_DECEL * DT;
      const f = next > 0 ? next / speed : 0;
      car.vx *= f;
      car.vz *= f;
    }
  }
  // A coasting spin settles too.
  if (!powered || (steer > -0.05 && steer < 0.05)) car.w -= car.w * 0.06;
}

function collideCars(state: SimState, i: number, j: number, events: SimEvent[] | null): void {
  const a = state.cars[i]!;
  const b = state.cars[j]!;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const d2 = dx * dx + dz * dz;
  if (d2 >= MIN_SEP2) return;
  const dist = Math.sqrt(d2);
  let nx: number;
  let nz: number;
  if (dist > 1e-9) {
    nx = dx / dist;
    nz = dz / dist;
  } else {
    nx = 1;
    nz = 0;
  }
  // Push apart, half each.
  const pen = MIN_SEP - dist;
  a.x -= nx * pen * 0.5;
  a.z -= nz * pen * 0.5;
  b.x += nx * pen * 0.5;
  b.z += nz * pen * 0.5;

  // Each car's speed into the other, before the impulse.
  const ua = a.vx * nx + a.vz * nz;
  const ub = -(b.vx * nx + b.vz * nz);
  const closing = ua + ub;
  if (closing <= 0) return;

  // Normal impulse. The normal runs through both centres, so no turn.
  const jn = ((1 + RESTITUTION_CAR) * closing) / (2 * INV_M);
  a.vx -= jn * nx * INV_M;
  a.vz -= jn * nz * INV_M;
  b.vx += jn * nx * INV_M;
  b.vz += jn * nz * INV_M;

  // Rubber friction at the contact: a glancing hit spins both cars.
  const tx = -nz;
  const tz = nx;
  // Contact point velocities, with the spin: w × r = w (-rz, rx).
  const rax = nx * CAR_RADIUS;
  const raz = nz * CAR_RADIUS;
  const vax = a.vx + a.w * -raz;
  const vaz = a.vz + a.w * rax;
  const vbx = b.vx + b.w * raz;
  const vbz = b.vz + b.w * -rax;
  const vt = (vbx - vax) * tx + (vbz - vaz) * tz;
  const kt = 2 * INV_M + 2 * CAR_RADIUS * CAR_RADIUS * INV_I;
  let jt = -vt / kt;
  const maxT = CONTACT_FRICTION * jn;
  if (jt > maxT) jt = maxT;
  else if (jt < -maxT) jt = -maxT;
  a.vx -= jt * tx * INV_M;
  a.vz -= jt * tz * INV_M;
  b.vx += jt * tx * INV_M;
  b.vz += jt * tz * INV_M;
  // cross(r, J) = rx Jz - rz Jx.
  a.w += (rax * (-jt * tz) - raz * (-jt * tx)) * INV_I;
  b.w += (-rax * (jt * tz) - -raz * (jt * tx)) * INV_I;

  // A car is longer than it is wide: a hit near a corner turns it.
  const offA = (nx * a.fx + nz * a.fz) * CAR_RADIUS * 0.6;
  a.w += SIDE_HIT_SPIN * (a.fx * offA * (-jn * nz) - a.fz * offA * (-jn * nx));
  const offB = -(nx * b.fx + nz * b.fz) * CAR_RADIUS * 0.6;
  b.w += SIDE_HIT_SPIN * (b.fx * offB * (jn * nz) - b.fz * offB * (jn * nx));

  if (closing >= BUMP_MIN_SPEED * 0.75) {
    // The car that was hit slides for a moment.
    if (ub < closing * 0.5) a.slip = Math.max(a.slip, SLIP_TICKS >> 1);
    if (ua < closing * 0.5) b.slip = Math.max(b.slip, SLIP_TICKS >> 1);
    if (ua < closing * 0.35) b.slip = SLIP_TICKS;
    if (ub < closing * 0.35) a.slip = SLIP_TICKS;
  }

  const cx = (a.x + b.x) * 0.5;
  const cz = (a.z + b.z) * 0.5;
  if (closing < BUMP_MIN_SPEED) {
    if (events && closing > 0.6) {
      events.push({ type: 'touch', tick: state.tick, a: i, b: j, speed: closing, x: cx, z: cz, nx, nz });
    }
    return;
  }
  const pair = i * MAX_CARS + j;
  // Nothing scores with the power off: the count in and the coast.
  const scored = state.powered && state.tick - state.pairTick[pair]! >= PAIR_COOLDOWN_TICKS;
  let pa = 0;
  let pb = 0;
  if (scored) {
    const value = closing >= BIG_BUMP_SPEED ? 2 : 1;
    const headOn = ua > 0 && ub > 0 && Math.abs(ua - ub) <= HEAD_ON_SHARE * closing;
    if (headOn) {
      pa = value;
      pb = value;
    } else if (ua >= ub) {
      pa = value;
    } else {
      pb = value;
    }
    if (!a.counts || state.hits[i * MAX_CARS + j]! >= MAX_SCORES_PER_VICTIM) pa = 0;
    if (!b.counts || state.hits[j * MAX_CARS + i]! >= MAX_SCORES_PER_VICTIM) pb = 0;
    if (pa > 0) state.hits[i * MAX_CARS + j] += 1;
    if (pb > 0) state.hits[j * MAX_CARS + i] += 1;
    state.pairTick[pair] = state.tick;
    state.points[i] += pa;
    state.points[j] += pb;
    if (pa > 0) state.bumps[i] += 1;
    if (pb > 0) state.bumps[j] += 1;
  }
  if (events) {
    events.push({ type: 'bump', tick: state.tick, a: i, b: j, pa, pb, speed: closing, x: cx, z: cz, nx, nz });
  }
}

function collideWall(state: SimState, i: number, events: SimEvent[] | null): void {
  const car = state.cars[i]!;
  const qx = car.x > INNER_HX ? INNER_HX : car.x < -INNER_HX ? -INNER_HX : car.x;
  const qz = car.z > INNER_HZ ? INNER_HZ : car.z < -INNER_HZ ? -INNER_HZ : car.z;
  const dx = car.x - qx;
  const dz = car.z - qz;
  const d2 = dx * dx + dz * dz;
  if (d2 <= WALL_REACH * WALL_REACH) return;
  const dist = Math.sqrt(d2);
  const nx = dx / dist;
  const nz = dz / dist;
  const pen = dist - WALL_REACH;
  car.x -= nx * pen;
  car.z -= nz * pen;
  const vn = car.vx * nx + car.vz * nz;
  if (vn <= 0) return;
  car.vx -= (1 + RESTITUTION_WALL) * vn * nx;
  car.vz -= (1 + RESTITUTION_WALL) * vn * nz;
  // The rail drags along the side a little, and turns the car off it.
  const vt = car.vx * -nz + car.vz * nx;
  car.vx -= -nz * vt * 0.12;
  car.vz -= nx * vt * 0.12;
  car.w += (car.fx * -nz + car.fz * nx) * vn * 0.25 * (vt >= 0 ? 1 : -1);
  if (events && vn > 1.0) {
    events.push({ type: 'wall', tick: state.tick, car: i, speed: vn, x: car.x + nx * CAR_RADIUS, z: car.z + nz * CAR_RADIUS });
  }
}

/** Move the world one tick with each car's current input. Inputs are set on
 *  the cars (`steer`, `throttle`) before the call. */
export function stepSim(state: SimState, events: SimEvent[] | null = null): void {
  const cars = state.cars;
  for (let i = 0; i < MAX_CARS; i += 1) {
    const car = cars[i]!;
    if (!car.active) continue;
    drive(car, state.powered);
    car.x += car.vx * DT;
    car.z += car.vz * DT;
  }
  for (let i = 0; i < MAX_CARS; i += 1) {
    if (!cars[i]!.active) continue;
    for (let j = i + 1; j < MAX_CARS; j += 1) {
      if (!cars[j]!.active) continue;
      collideCars(state, i, j, events);
    }
  }
  for (let i = 0; i < MAX_CARS; i += 1) {
    if (cars[i]!.active) collideWall(state, i, events);
  }
  // A second pass for positions only, so a car pushed into the rail by a
  // neighbour doesn't sit inside it.
  for (let i = 0; i < MAX_CARS; i += 1) {
    if (cars[i]!.active) collideWall(state, i, null);
  }
  for (let i = 0; i < MAX_CARS; i += 1) {
    const car = cars[i]!;
    if (car.active) quantizeCar(car);
  }
  state.tick += 1;
}

export function setInputs(state: SimState, inputs: ReadonlyArray<CarInput | null | undefined>): void {
  for (let i = 0; i < MAX_CARS; i += 1) {
    const input = inputs[i];
    if (!input) continue;
    const car = state.cars[i]!;
    car.steer = clampInput(input.steer);
    car.throttle = clampInput(input.throttle);
  }
}

/** Places, best first, with ties sharing a place. */
export function placesFor(points: readonly number[], seats: readonly number[]): Map<number, number> {
  const sorted = seats.slice().sort((x, y) => points[y]! - points[x]! || x - y);
  const places = new Map<number, number>();
  let place = 0;
  let last = Number.NaN;
  sorted.forEach((seat, index) => {
    const p = points[seat]!;
    if (p !== last) {
      place = index + 1;
      last = p;
    }
    places.set(seat, place);
  });
  return places;
}

/** A plain-number fingerprint of the state, for the sync checks. */
export function simHash(state: SimState): number {
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    h ^= n | 0;
    h = Math.imul(h, 0x01000193);
  };
  mix(state.tick);
  for (const car of state.cars) {
    if (!car.active) continue;
    for (const v of packCar(car)) mix(v);
  }
  for (const p of state.points) mix(p);
  return h >>> 0;
}
