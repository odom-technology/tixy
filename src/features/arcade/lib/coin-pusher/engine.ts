/* ──────────────────────────────────────────────────────────────────────────
   COIN PUSHER — the shared deterministic engine.

   One pure module that the server and the browser both run. The server owns
   the machine: it stores a player's machine, steps it to the time of each
   request and pays for the coins that reach the tray. The browser runs the
   same steps from the same state to draw the machine between requests, and
   checks its result against the server's hash.

   Determinism rules, so the two agree bit for bit:
     - only + - * / and Math.sqrt, Math.floor, Math.abs, Math.min, Math.max
       (all exact or correctly rounded in IEEE 754 doubles); no Math.sin,
       Math.cos, Math.pow, Math.random, Date or Map iteration over floats;
     - time is an integer step index, so the shelves sit at exactly the same
       place on every cycle;
     - every loop runs in id order, and the pair list is sorted.

   The model, in coin radii (a coin is 1 unit in radius):

     side view, the player is on the right

       chute
         |
         v     tier 1                     tier 2
     |barricade|=== shelf A ===>|            (moving)
     |         |   playfield P1  |edge E1
     |         |_________________|=== shelf B ===>|
     |                           |  playfield P2   |edge E2 -> tray
     |___________________________|_________________|

   Each tier is a moving shelf over a fixed playfield. A coin lands on the
   shelf's top or on the playfield in front of it. When a shelf draws back,
   the wall behind it holds the coins on its top, so they creep forward
   relative to the shelf and drop off its front onto the playfield. When it
   comes forward, its front face pushes the playfield's coins toward the
   edge. Tier 1's edge drops onto tier 2; tier 2's edge drops into the tray.
   The sides are walls: every coin leaves through the tray, eventually.

   Coins are discs on a surface in two layers: layer 0 lies on the surface,
   layer 1 lies on top of layer 0 coins and rides on them. A layer 1 coin
   with nothing under it settles to layer 0. Contacts are solved by position
   (PBD) with equal masses; faces and walls are kinematic. Friction is a
   constant deceleration toward the surface's velocity, with a static band
   so a resting coin rests exactly.
   ────────────────────────────────────────────────────────────────────────── */

/* ── Time ─────────────────────────────────────────────────────────────── */

/** Steps per second. The machine clock is an integer step count. */
export const CP_HZ = 60;
export const CP_DT = 1 / CP_HZ;
export const CP_STEP_MS = 1000 / CP_HZ;
/** One shelf cycle, in steps (2.8 s). Shelf B runs half a cycle behind A. */
export const CP_PERIOD = 168;
/** The machine clock's zero: 2026-01-01T00:00:00Z. Steps count from here. */
export const CP_EPOCH_MS = Date.UTC(2026, 0, 1);

/** The machine step for a wall-clock time in ms. */
export function cpStepAt(ms: number): number {
  return Math.floor((ms - CP_EPOCH_MS) / CP_STEP_MS);
}

/** The wall-clock ms at the start of a step. */
export function cpMsAt(step: number): number {
  return CP_EPOCH_MS + step * CP_STEP_MS;
}

/* ── Geometry (coin radii) ───────────────────────────────────────────── */

export const CP_R = 1;
/** Inside width of the cabinet. Coin centres stay within ±(W/2 − r). */
export const CP_W = 18;
export const CP_X_MAX = CP_W / 2 - CP_R;
/** How far each shelf travels. */
export const CP_STROKE = 3;

/** Tier 1: the barricade face, shelf A's front edge when drawn back, P1's edge. */
export const CP_BAR1 = 0;
export const CP_A_FRONT = 5;
export const CP_E1 = 14;
/** Tier 2: tier 1's front face is shelf B's barricade. */
export const CP_BAR2 = CP_E1;
export const CP_B_FRONT = 18;
export const CP_E2 = 29;

/** Surface heights (the top of each surface). */
export const CP_Y_P2 = 0;
export const CP_Y_B = 1.2;
export const CP_Y_P1 = 2.6;
export const CP_Y_A = 3.8;
/** Coin thickness: a layer 1 coin sits this much higher. */
export const CP_T = 0.16;

/** Where the chute lets a coin go. */
export const CP_DROP_Y = 9.5;
export const CP_DROP_Z = 4.6;
/** The chute throws the coin forward a little. */
export const CP_DROP_VZ = 6.5;
/** Coins can be aimed across this much of the width. */
export const CP_AIM_MAX = 7.5;

/** Gravity, deliberately softer than real so a fall reads on a phone. */
export const CP_G = 300;
/** Sliding deceleration, and the speed under which a coin grips. */
export const CP_SLIDE = 34;
export const CP_GRIP_SPEED = 1.6;
export const CP_GRIP = 90;
/** How much horizontal speed survives a landing. */
export const CP_LAND_KEEP = 0.62;

/** Coins of one pour leave the chute this many steps apart (12 a second). */
export const CP_POUR_GAP = 5;
/** Sideways spread of a pour, in coin radii, by coin index. */
const POUR_SPREAD = [0, 0.7, -0.7, 1.4, -1.4, 0.35, -1.05, 1.05, -0.35, 1.75, -1.75, 0];
/** The most coins one request can pour (CP_MAX_BET / CP_COIN_TICKETS, in economy.ts). */
export const CP_MAX_POUR = 50;
/** The most coins waiting in the chute at once. */
export const CP_MAX_PENDING = 120;

/** Solver iterations per step. */
const ITERATIONS = 4;
/** A layer 1 coin is held up by layer 0 coins closer than this. */
const SUPPORT_DIST = 1.8;
/** A landing coin goes on top when a layer 0 coin is closer than this. */
const STACK_DIST = 1.75;
/** Motion under this per step counts as still: 0.001 radii, about 12
    microns a frame. A packed carpet creeps by less than that as the shelves press
    it, which no one can see and which would otherwise never settle. */
export const CP_STILL = 1e-3;
/** A machine still for one full cycle is settled. */
const SETTLE_STEPS = CP_PERIOD + 1;
/** A machine moving this long after its last coin is settled by rule. */
export const CP_MAX_ACTIVE = 1800;

/* ── State ───────────────────────────────────────────────────────────── */

/** 0 shelf A's top, 1 playfield P1, 2 shelf B's top, 3 playfield P2, 4 in the air. */
export type CpSurface = 0 | 1 | 2 | 3 | 4;

export type CpCoin = {
  id: number;
  s: CpSurface;
  l: 0 | 1;
  x: number;
  /** World z on P1, P2 and in the air; relative to the shelf on A and B. */
  z: number;
  /** Height of the coin's underside; only meaningful in the air. */
  y: number;
  vx: number;
  vz: number;
  vy: number;
};

export type CpPending = { id: number; at: number; x: number };

export type CpMachine = {
  v: 1;
  /** The last step simulated: the state is as of the end of this step. */
  step: number;
  coins: CpCoin[];
  pending: CpPending[];
  nextId: number;
  quiet: number;
  settled: boolean;
  lastEntry: number;
  /** Lifetime coins poured and coins that reached the tray. */
  dropped: number;
  won: number;
};

export type CpEvent =
  | { k: 'enter'; id: number; step: number; x: number }
  | { k: 'land'; id: number; step: number; s: CpSurface; l: 0 | 1; speed: number }
  | { k: 'tip'; id: number; step: number; from: CpSurface }
  | { k: 'tray'; id: number; step: number; x: number; vz: number };

/* ── Shelves ─────────────────────────────────────────────────────────── */

/** A smooth back-and-forth on [0, 1] for a phase in [0, 1): out and back,
    resting for an instant at each end, like a crank. Polynomial, so exact. */
export function cpStroke(phase: number): number {
  const q = phase < 0.5 ? phase * 2 : 2 - phase * 2;
  return q * q * (3 - 2 * q);
}

function mod(n: number, m: number): number {
  const r = n - Math.floor(n / m) * m;
  return r;
}

/** Shelf offsets (0 drawn back, CP_STROKE fully out) at a step, which may be
    fractional for drawing. */
export function cpShelfOffsets(step: number): { a: number; b: number } {
  const pa = mod(step, CP_PERIOD) / CP_PERIOD;
  const pb = mod(step + CP_PERIOD / 2, CP_PERIOD) / CP_PERIOD;
  return { a: CP_STROKE * cpStroke(pa), b: CP_STROKE * cpStroke(pb) };
}

/* ── Construction ────────────────────────────────────────────────────── */

export function cpEmptyMachine(step: number): CpMachine {
  return {
    v: 1,
    step,
    coins: [],
    pending: [],
    nextId: 1,
    quiet: SETTLE_STEPS,
    settled: true,
    lastEntry: step,
    dropped: 0,
    won: 0,
  };
}

export function cpClone(m: CpMachine): CpMachine {
  return {
    ...m,
    coins: m.coins.map((c) => ({ ...c })),
    pending: m.pending.map((p) => ({ ...p })),
  };
}

/** Clamp an aim to the chute's travel. */
export function cpClampAim(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(-CP_AIM_MAX, Math.min(CP_AIM_MAX, x));
}

/** Queue a pour of `count` coins aimed at `x`, the first leaving the chute
    at step `at`. Returns the new coin ids. The caller checks `at` is after
    the machine's step. */
export function cpPour(m: CpMachine, at: number, x: number, count: number): number[] {
  const aim = cpClampAim(x);
  const ids: number[] = [];
  for (let k = 0; k < count; k++) {
    const spread = POUR_SPREAD[k % POUR_SPREAD.length] + (k >= POUR_SPREAD.length ? 0.2 : 0);
    const px = Math.max(-CP_X_MAX, Math.min(CP_X_MAX, aim + spread));
    const id = m.nextId++;
    m.pending.push({ id, at: at + k * CP_POUR_GAP, x: px });
    ids.push(id);
  }
  m.dropped += count;
  m.settled = false;
  m.quiet = 0;
  return ids;
}

/* ── Stepping ────────────────────────────────────────────────────────── */


/** Height of a surface's top. */
export function cpSurfaceY(s: CpSurface): number {
  return s === 0 ? CP_Y_A : s === 1 ? CP_Y_P1 : s === 2 ? CP_Y_B : CP_Y_P2;
}

// Scratch buffers reused between steps (the engine is single-threaded).
let px: Float64Array = new Float64Array(256);
let pz: Float64Array = new Float64Array(256);
let ox: Float64Array = new Float64Array(256);
let oz: Float64Array = new Float64Array(256);
let cx: Float64Array = new Float64Array(256);
let cz: Float64Array = new Float64Array(256);
let order: number[] = [];

function ensure(n: number) {
  if (px.length >= n) return;
  let size = px.length;
  while (size < n) size *= 2;
  px = new Float64Array(size);
  pz = new Float64Array(size);
  ox = new Float64Array(size);
  oz = new Float64Array(size);
  cx = new Float64Array(size);
  cz = new Float64Array(size);
}

/** The lower kinematic limit on z for a coin on a surface: the barricade
    (relative to the shelf) on A and B, the shelf's face on P1 and P2. */
function backLimit(s: CpSurface, offA: number, offB: number): number {
  if (s === 0) return CP_BAR1 + CP_R - offA;
  if (s === 1) return CP_A_FRONT + offA + CP_R;
  if (s === 2) return CP_BAR2 + CP_R - offB;
  return CP_B_FRONT + offB + CP_R;
}

/** The edge a coin drops off, in the surface's own coordinates. */
function frontEdge(s: CpSurface): number {
  if (s === 0) return CP_A_FRONT;
  if (s === 1) return CP_E1;
  if (s === 2) return CP_B_FRONT;
  return CP_E2;
}

function applyFriction(c: CpCoin) {
  const sp = Math.sqrt(c.vx * c.vx + c.vz * c.vz);
  if (sp === 0) return;
  const decel = (sp > CP_GRIP_SPEED ? CP_SLIDE : CP_GRIP) * CP_DT;
  if (sp <= decel) {
    c.vx = 0;
    c.vz = 0;
    return;
  }
  const k = (sp - decel) / sp;
  c.vx *= k;
  c.vz *= k;
}

/** Sort-and-sweep pairs within reach on one surface. `idx` holds coin
    indexes sorted by predicted z, ties by id. */
function sweepPairs(
  coins: CpCoin[],
  idx: number[],
  reach: number,
  out: number[],
) {
  const r2 = reach * reach;
  for (let a = 0; a < idx.length; a++) {
    const i = idx[a];
    for (let b = a + 1; b < idx.length; b++) {
      const j = idx[b];
      const dz = pz[j] - pz[i];
      if (dz > reach) break;
      const dx = px[j] - px[i];
      if (dx * dx + dz * dz < r2) {
        // Keep the pair in id order so the solve order never depends on z ties.
        if (coins[i].id < coins[j].id) out.push(i, j);
        else out.push(j, i);
      }
    }
  }
}

function sortPairs(coins: CpCoin[], pairs: number[]) {
  const n = pairs.length / 2;
  const keys: number[] = new Array(n);
  for (let p = 0; p < n; p++) keys[p] = p;
  keys.sort((a, b) => {
    const ia = coins[pairs[a * 2]].id;
    const ib = coins[pairs[b * 2]].id;
    if (ia !== ib) return ia - ib;
    return coins[pairs[a * 2 + 1]].id - coins[pairs[b * 2 + 1]].id;
  });
  const copy = pairs.slice();
  for (let p = 0; p < n; p++) {
    pairs[p * 2] = copy[keys[p] * 2];
    pairs[p * 2 + 1] = copy[keys[p] * 2 + 1];
  }
}

/** Overlap a contact may keep without being pushed apart. Real coins rest
    on each other with friction; without this slop a packed carpet keeps
    breathing by a few microns every time a shelf presses it, and never
    settles. 0.003 radii is invisible. */
export const CP_SLOP = 0.003;

function solvePairs(pairs: number[]): number {
  let moved = 0;
  const min = 2 * CP_R - CP_SLOP;
  for (let p = 0; p < pairs.length; p += 2) {
    const i = pairs[p];
    const j = pairs[p + 1];
    let dx = px[j] - px[i];
    let dz = pz[j] - pz[i];
    let d2 = dx * dx + dz * dz;
    if (d2 >= min * min) continue;
    let d = Math.sqrt(d2);
    if (d < 1e-9) {
      // Exactly on top of each other: separate along x, by id order.
      dx = 1;
      dz = 0;
      d = 1e-9;
      d2 = 0;
    } else {
      dx /= d;
      dz /= d;
    }
    const push = (min - d) * 0.5;
    px[i] -= dx * push;
    pz[i] -= dz * push;
    px[j] += dx * push;
    pz[j] += dz * push;
    if (push > moved) moved = push;
  }
  return moved;
}

function clampLimits(coins: CpCoin[], list: number[], offA: number, offB: number): number {
  let moved = 0;
  for (let a = 0; a < list.length; a++) {
    const i = list[a];
    const c = coins[i];
    if (px[i] > CP_X_MAX) {
      moved = Math.max(moved, px[i] - CP_X_MAX);
      px[i] = CP_X_MAX;
    } else if (px[i] < -CP_X_MAX) {
      moved = Math.max(moved, -CP_X_MAX - px[i]);
      px[i] = -CP_X_MAX;
    }
    const lim = backLimit(c.s, offA, offB);
    if (pz[i] < lim) {
      moved = Math.max(moved, lim - pz[i]);
      pz[i] = lim;
    }
  }
  return moved;
}

/** Advance one step. Events, when given, receive what happened. */
export function cpStep(m: CpMachine, events?: CpEvent[]): void {
  const n = m.step + 1;
  const prevOff = cpShelfOffsets(m.step);
  const off = cpShelfOffsets(n);
  const prevOff2 = cpShelfOffsets(m.step - 1);
  // Shelf velocities this step and last, for carrying coins between frames.
  const vA = (off.a - prevOff.a) / CP_DT;
  const vB = (off.b - prevOff.b) / CP_DT;
  const vA0 = (prevOff.a - prevOff2.a) / CP_DT;
  const vB0 = (prevOff.b - prevOff2.b) / CP_DT;
  m.step = n;

  let active = false;

  // 1. Coins leave the chute.
  if (m.pending.length > 0) {
    let keep = 0;
    for (let p = 0; p < m.pending.length; p++) {
      const q = m.pending[p];
      if (q.at <= n) {
        m.coins.push({ id: q.id, s: 4, l: 0, x: q.x, z: CP_DROP_Z, y: CP_DROP_Y, vx: 0, vz: CP_DROP_VZ, vy: 0 });
        m.lastEntry = n;
        events?.push({ k: 'enter', id: q.id, step: n, x: q.x });
      } else {
        m.pending[keep++] = q;
      }
    }
    m.pending.length = keep;
    active = true;
  }

  const coins = m.coins;
  ensure(coins.length);

  // 2. Air: fall, and land on whatever is below.
  for (let i = 0; i < coins.length; i++) {
    const c = coins[i];
    if (c.s !== 4) continue;
    active = true;
    const y0 = c.y;
    c.vy -= CP_G * CP_DT;
    c.x += c.vx * CP_DT;
    c.z += c.vz * CP_DT;
    c.y += c.vy * CP_DT;
    if (c.x > CP_X_MAX) c.x = CP_X_MAX;
    if (c.x < -CP_X_MAX) c.x = -CP_X_MAX;
    // Falling past a face it is already below the top of: the face is in
    // the way. (A coin still above a shelf's top lands on it instead.)
    if (c.z < CP_E1) {
      if (y0 < CP_Y_A && c.z < CP_A_FRONT + off.a + CP_R) c.z = CP_A_FRONT + off.a + CP_R;
      if (c.z < CP_BAR1 + CP_R) c.z = CP_BAR1 + CP_R;
    } else {
      if (y0 < CP_Y_P1 && c.z < CP_BAR2 + CP_R) c.z = CP_BAR2 + CP_R;
      if (y0 < CP_Y_B && c.z < CP_B_FRONT + off.b + CP_R) c.z = CP_B_FRONT + off.b + CP_R;
    }
    // What is under it now? A shelf catches the coin if it was above the
    // shelf's top at the start of the step (no tunnelling at speed).
    let target: CpSurface;
    if (c.z < CP_E1) target = c.z <= CP_A_FRONT + off.a && y0 >= CP_Y_A ? 0 : 1;
    else target = c.z <= CP_B_FRONT + off.b && y0 >= CP_Y_B ? 2 : 3;
    const ground = cpSurfaceY(target);
    if (c.y > ground) continue;

    // Land: on top of a coin if one is right there, otherwise on the surface.
    const shelfOff = target === 0 ? off.a : target === 2 ? off.b : 0;
    const lz = c.z - shelfOff;
    let stacked = false;
    for (let j = 0; j < coins.length; j++) {
      const o = coins[j];
      if (o.s !== target || o.l !== 0) continue;
      const dx = o.x - c.x;
      const dz = o.z - lz;
      if (dx * dx + dz * dz < STACK_DIST * STACK_DIST) {
        stacked = true;
        break;
      }
    }
    const speed = Math.sqrt(c.vx * c.vx + c.vz * c.vz + c.vy * c.vy);
    const shelfV = target === 0 ? vA : target === 2 ? vB : 0;
    c.s = target;
    c.l = stacked ? 1 : 0;
    c.z = lz;
    c.y = ground + (stacked ? CP_T : 0);
    c.vx = c.vx * CP_LAND_KEEP;
    c.vz = c.vz * CP_LAND_KEEP - shelfV;
    c.vy = 0;
    events?.push({ k: 'land', id: c.id, step: n, s: target, l: c.l, speed });
  }

  // 3. Predict surface coins and build the pair lists per surface.
  const bySurface: number[][] = [[], [], [], []];
  for (let i = 0; i < coins.length; i++) {
    const c = coins[i];
    if (c.s === 4) continue;
    // On a shelf the frame itself sped up or slowed down since last step:
    // keep the coin's world velocity, then let friction pull it along.
    if (c.s === 0) c.vz -= vA - vA0;
    else if (c.s === 2) c.vz -= vB - vB0;
    // Friction before the move: a coin resting on a shelf grips through the
    // shelf's speeding up and slowing down, so it rides exactly.
    applyFriction(c);
    ox[i] = c.x;
    oz[i] = c.z;
    px[i] = c.x + c.vx * CP_DT;
    pz[i] = c.z + c.vz * CP_DT;
    cx[i] = 0;
    cz[i] = 0;
    bySurface[c.s].push(i);
  }

  let maxMove = 0;
  const pairs0: number[] = [];
  const pairs1: number[] = [];
  const support: number[] = [];
  const layer0: number[] = [];
  const layer1: number[] = [];

  for (let s = 0; s < 4; s++) {
    const list = bySurface[s];
    if (list.length === 0) continue;
    order = list.slice();
    order.sort((a, b) => (pz[a] !== pz[b] ? pz[a] - pz[b] : coins[a].id - coins[b].id));
    const l0: number[] = [];
    const l1: number[] = [];
    for (let a = 0; a < order.length; a++) {
      if (coins[order[a]].l === 0) l0.push(order[a]);
      else l1.push(order[a]);
    }
    sweepPairs(coins, l0, 2 * CP_R + 0.05, pairs0);
    sweepPairs(coins, l1, 2 * CP_R + 0.05, pairs1);
    // Support pairs: layer 1 coin over layer 0 coins.
    for (let a = 0; a < l1.length; a++) {
      const i = l1[a];
      for (let b = 0; b < l0.length; b++) {
        const j = l0[b];
        const dz = pz[j] - pz[i];
        if (dz < -SUPPORT_DIST) continue;
        if (dz > SUPPORT_DIST) break;
        const dx = px[j] - px[i];
        if (dx * dx + dz * dz < SUPPORT_DIST * SUPPORT_DIST) support.push(i, j);
      }
    }
    for (let a = 0; a < l0.length; a++) layer0.push(l0[a]);
    for (let a = 0; a < l1.length; a++) layer1.push(l1[a]);
  }
  sortPairs(coins, pairs0);
  sortPairs(coins, pairs1);
  sortPairs(coins, support);
  layer0.sort((a, b) => coins[a].id - coins[b].id);
  layer1.sort((a, b) => coins[a].id - coins[b].id);

  // 4. Solve layer 0.
  for (let it = 0; it < ITERATIONS; it++) {
    const a = solvePairs(pairs0);
    const b = clampLimits(coins, layer0, off.a, off.b);
    if (it === ITERATIONS - 1) maxMove = Math.max(maxMove, a, b);
  }

  // 5. Carry layer 1 on its supports, then solve layer 1.
  const supportCount: number[] = new Array(coins.length).fill(0);
  for (let p = 0; p < support.length; p += 2) {
    const i = support[p];
    const j = support[p + 1];
    cx[i] += px[j] - ox[j];
    cz[i] += pz[j] - oz[j];
    supportCount[i] += 1;
  }
  for (let a = 0; a < layer1.length; a++) {
    const i = layer1[a];
    const k = supportCount[i];
    if (k > 0) {
      cx[i] /= k;
      cz[i] /= k;
      px[i] += cx[i];
      pz[i] += cz[i];
    }
  }
  for (let it = 0; it < ITERATIONS; it++) {
    const a = solvePairs(pairs1);
    const b = clampLimits(coins, layer1, off.a, off.b);
    if (it === ITERATIONS - 1) maxMove = Math.max(maxMove, a, b);
  }

  // 6. Velocities, friction, and the move this step.
  for (let i = 0; i < coins.length; i++) {
    const c = coins[i];
    if (c.s === 4) continue;
    const dx = px[i] - ox[i];
    const dz = pz[i] - oz[i];
    const move = Math.abs(dx) + Math.abs(dz);
    if (move > maxMove) maxMove = move;
    c.vx = (dx - cx[i]) / CP_DT;
    c.vz = (dz - cz[i]) / CP_DT;
    c.x = px[i];
    c.z = pz[i];
  }

  // 7. Layer changes and edges; coins that leave are compacted out.
  let w = 0;
  for (let i = 0; i < coins.length; i++) {
    const c = coins[i];
    if (c.s !== 4) {
      if (c.l === 1 && supportCount[i] === 0) {
        c.l = 0;
        active = true;
      }
      if (c.z > frontEdge(c.s)) {
        active = true;
        if (c.s === 3) {
          // Over the last edge: into the tray.
          m.won += 1;
          events?.push({ k: 'tray', id: c.id, step: n, x: c.x, vz: c.vz });
          continue;
        }
        const from = c.s;
        const shelfOff = from === 0 ? off.a : from === 2 ? off.b : 0;
        const shelfV = from === 0 ? vA : from === 2 ? vB : 0;
        c.z = c.z + shelfOff;
        c.vz = Math.max(c.vz + shelfV, 1.5);
        c.y = cpSurfaceY(from) + (c.l === 1 ? CP_T : 0);
        c.vy = 0;
        c.s = 4;
        c.l = 0;
        events?.push({ k: 'tip', id: c.id, step: n, from });
      }
    }
    coins[w++] = c;
  }
  coins.length = w;

  // 8. Settling.
  if (active || maxMove > CP_STILL) {
    m.quiet = 0;
    m.settled = false;
  } else {
    m.quiet += 1;
  }
  if (!m.settled && m.pending.length === 0) {
    const forced = n - m.lastEntry >= CP_MAX_ACTIVE && !coins.some((c) => c.s === 4);
    if (m.quiet >= SETTLE_STEPS || forced) settle(m);
  }
}

function settle(m: CpMachine) {
  m.settled = true;
  m.quiet = SETTLE_STEPS;
  for (const c of m.coins) {
    c.vx = 0;
    c.vz = 0;
    c.vy = 0;
  }
}

/** Advance to `target`, stepping while anything moves and jumping across
    time when the machine is settled (coins on the shelves are stored
    relative to them, so a settled machine is the same at every step). */
export function cpAdvance(m: CpMachine, target: number, events?: CpEvent[], maxSteps = Infinity): number {
  let stepped = 0;
  while (m.step < target && stepped < maxSteps) {
    if (m.settled) {
      const next = m.pending.length > 0 ? Math.min(...m.pending.map((p) => p.at)) - 1 : target;
      const jumpTo = Math.min(target, next);
      if (jumpTo > m.step) {
        m.step = jumpTo;
        continue;
      }
    }
    cpStep(m, events);
    stepped += 1;
  }
  return stepped;
}

/* ── World positions, for drawing and checks ─────────────────────────── */

/** A coin's world position at step `at` (the machine's own step for the
    stored state). */
export function cpCoinWorld(c: CpCoin, at: number): { x: number; y: number; z: number } {
  if (c.s === 4) return { x: c.x, y: c.y, z: c.z };
  const off = cpShelfOffsets(at);
  const z = c.s === 0 ? c.z + off.a : c.s === 2 ? c.z + off.b : c.z;
  return { x: c.x, y: cpSurfaceY(c.s) + (c.l === 1 ? CP_T : 0), z };
}

/* ── Hash and wire format ────────────────────────────────────────────── */

const hashBuf = new DataView(new ArrayBuffer(8));

/** A 64-bit hash of everything that decides the future, as 16 hex digits.
    Same in every JavaScript engine: it reads the doubles' bytes. */
export function cpHash(m: CpMachine): string {
  let h1 = 0x811c9dc5 ^ 0;
  let h2 = 0x01000193 ^ 0;
  const mixNum = (v: number) => {
    hashBuf.setFloat64(0, v === 0 ? 0 : v); // fold -0 into 0
    for (let k = 0; k < 8; k++) {
      const b = hashBuf.getUint8(k);
      h1 = Math.imul(h1 ^ b, 0x01000193);
      h2 = Math.imul(h2 ^ b, 0x5bd1e995);
      h2 ^= h2 >>> 15;
    }
  };
  mixNum(m.step);
  mixNum(m.nextId);
  mixNum(m.quiet);
  mixNum(m.settled ? 1 : 0);
  mixNum(m.lastEntry);
  mixNum(m.dropped);
  mixNum(m.won);
  for (const c of m.coins) {
    mixNum(c.id);
    mixNum(c.s);
    mixNum(c.l);
    mixNum(c.x);
    mixNum(c.z);
    mixNum(c.y);
    mixNum(c.vx);
    mixNum(c.vz);
    mixNum(c.vy);
  }
  for (const p of m.pending) {
    mixNum(p.id);
    mixNum(p.at);
    mixNum(p.x);
  }
  const hex = (v: number) => (v >>> 0).toString(16).padStart(8, '0');
  return hex(h1) + hex(h2);
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Read a stored or received machine. Returns null for anything malformed,
    so a bad row can never reach the stepper. */
export function cpParse(raw: unknown): CpMachine | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return null;
  if (!finite(r.step) || !finite(r.nextId) || !finite(r.quiet) || !finite(r.lastEntry)) return null;
  if (!finite(r.dropped) || !finite(r.won) || typeof r.settled !== 'boolean') return null;
  if (!Array.isArray(r.coins) || !Array.isArray(r.pending)) return null;
  if (r.coins.length > 600 || r.pending.length > CP_MAX_PENDING) return null;
  const coins: CpCoin[] = [];
  for (const rc of r.coins) {
    if (!rc || typeof rc !== 'object') return null;
    const c = rc as Record<string, unknown>;
    const s = c.s;
    if (s !== 0 && s !== 1 && s !== 2 && s !== 3 && s !== 4) return null;
    if (c.l !== 0 && c.l !== 1) return null;
    const nums = [c.id, c.x, c.z, c.y, c.vx, c.vz, c.vy];
    if (!nums.every(finite)) return null;
    coins.push({
      id: c.id as number,
      s,
      l: c.l,
      x: c.x as number,
      z: c.z as number,
      y: c.y as number,
      vx: c.vx as number,
      vz: c.vz as number,
      vy: c.vy as number,
    });
  }
  const pending: CpPending[] = [];
  for (const rp of r.pending) {
    if (!rp || typeof rp !== 'object') return null;
    const p = rp as Record<string, unknown>;
    if (!finite(p.id) || !finite(p.at) || !finite(p.x)) return null;
    pending.push({ id: p.id, at: p.at, x: p.x });
  }
  return {
    v: 1,
    step: r.step,
    coins,
    pending,
    nextId: r.nextId,
    quiet: r.quiet,
    settled: r.settled,
    lastEntry: r.lastEntry,
    dropped: r.dropped,
    won: r.won,
  };
}

/* ── The starting bed ────────────────────────────────────────────────── */

/** A tiny seeded generator, only for building the bed. */
function bedRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build the bed every new machine starts with: pour coins into an empty
    machine until coins have been reaching the tray for a while, let it
    settle, then forget the counts. Deterministic; the same bed every time.
    `fill` is how many coins to pour after the first reaches the tray, and
    `target` the most coins it may hold at the end. */
export function cpBuildBed(opts: { seed?: number; fill?: number; maxCoins?: number; target?: number } = {}): CpMachine {
  const rand = bedRandom(opts.seed ?? 20261004);
  const m = cpEmptyMachine(0);
  const events: CpEvent[] = [];
  let firstTray = -1;
  let poured = 0;
  const fill = opts.fill ?? 300;
  const maxCoins = opts.maxCoins ?? 900;
  while (poured < maxCoins) {
    const x = (rand() * 2 - 1) * CP_AIM_MAX;
    cpPour(m, m.step + 1, x, 1);
    poured += 1;
    cpAdvance(m, m.step + 9 + Math.floor(rand() * 12), events);
    if (firstTray < 0 && events.some((e) => e.k === 'tray')) firstTray = poured;
    if (firstTray >= 0 && poured - firstTray >= fill) break;
  }
  cpAdvance(m, m.step + CP_MAX_ACTIVE + 10);
  // Then single coins, each left to settle, until the machine holds no more
  // than its working level (the median of a long session), so a new machine
  // starts where a played one sits and no more.
  const target = opts.target ?? 131;
  for (let i = 0; i < 400 && m.coins.length > target; i++) {
    cpPour(m, m.step + 1, (rand() * 2 - 1) * CP_AIM_MAX, 1);
    cpAdvance(m, m.step + CP_MAX_ACTIVE + 10);
  }
  // Renumber so the bed reads as coins 1..n in a fresh machine at step 0.
  m.coins.sort((a, b) => a.id - b.id);
  m.coins.forEach((c, i) => {
    c.id = i + 1;
  });
  m.nextId = m.coins.length + 1;
  m.dropped = 0;
  m.won = 0;
  m.lastEntry = m.step;
  return m;
}

/** Move a settled machine to start at `step` (the bed is built at its own
    clock; a new player's machine starts now). Shelf coins are relative, so
    this only works at the same shelf phase: it rounds to a whole cycle. */
export function cpRebase(m: CpMachine, step: number): CpMachine {
  const out = cpClone(m);
  const shift = Math.floor((step - m.step) / CP_PERIOD) * CP_PERIOD;
  out.step = m.step + shift;
  out.lastEntry = m.lastEntry + shift;
  return out;
}
