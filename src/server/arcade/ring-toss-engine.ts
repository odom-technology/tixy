/**
 * Ring toss: the pure, deterministic ring sim and the run validator.
 *
 * One engine for both sides. The client steps it live at the fixed step and
 * draws the ring between steps; the score route replays the recorded flicks
 * through the same steps. The same flick gives the same flight, the same
 * clinks and the same ringer on both sides, at any display rate.
 *
 * The model (RING_TOSS.md has the sources):
 *
 *  1. THE RING is a rigid body: a hoop of major radius 4.0 cm and tube
 *     radius 0.55 cm, thrown flat with spin. Its rotation is integrated from
 *     its angular momentum, so a ring thrown a little off its spin axis
 *     wobbles in the air the way a real one does (torque-free precession of
 *     a symmetric body, I_axis = 2 I_diameter). No air.
 *  2. CONTACT. The ring's tube is 40 spheres on its centre circle (the gaps
 *     between them are under 0.1 mm deep). Each sphere is tested against the
 *     bottles (solids of revolution from one profile: body, shoulder, neck,
 *     lip bead and mouth), the crate's walls, the platform, and every ring
 *     already at rest (a torus each). Contacts are resolved with sequential
 *     impulses, restitution and Coulomb friction: rings clink off necks,
 *     skid on the crate, rattle down a neck and settle on the shoulder.
 *  3. REST. A ring that stops moving, or that has flown for 3.2 s, is
 *     frozen where it lies and becomes a fixed obstacle for later rings. A
 *     ring at rest is never moved by another ring (the simplification that
 *     keeps every ring's flight a function of its own flick and the rings
 *     before it). A ring that falls off the platform is gone.
 *  4. RINGER. A ring is a ringer when, at rest, a bottle's axis passes
 *     through its hole below the bottle's mouth. Around a neck it can't get
 *     off again, so this is exact, not a guess.
 *
 * Determinism: a fixed 480 Hz step of + - * / and Math.sqrt over IEEE
 * doubles, in a fixed order. No Math.sin, Math.cos, Math.hypot or Math.pow
 * at runtime (their last bit can differ between JavaScript engines): angles
 * go through fixed polynomials. No Date.now(), no Math.random(), no I/O.
 *
 * Anti-cheat: the server trusts only each flick's four numbers and its time.
 * Params are clamped inside the sim on both sides. A flick before the last
 * ring has come to rest, after the round, or past the tenth ring is
 * ignored the same way on both sides; non-finite params stop scoring.
 */

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** Bumped when the physics or the scoring changes. */
export const RING_RULES_VERSION = 1;

/** Rings in a round. */
export const RING_COUNT = 10;
/** The round's clock (ms). A flick after this doesn't count. */
export const RING_ROUND_MS = 30_000;
/** Flicks the server reads at most (anything past the tenth ring is dropped). */
export const RING_MAX_THROWS = 24;
/** A ring can't be thrown sooner than this after the last one came to rest. */
export const RING_READY_GAP_MS = 120;

// ---------------------------------------------------------------------------
// Physics constants (metres, seconds; one unit is one metre)
// ---------------------------------------------------------------------------

/** Fixed integrator step (seconds). */
export const RING_SIM_DT = 1 / 480;
export const RING_STEP_MS = RING_SIM_DT * 1000;
/** Gravity. */
export const RING_GRAVITY = 9.8;

/** Ring: centre-circle radius and tube radius. Inner diameter 6.9 cm. */
export const RING_R = 0.04;
export const RING_TUBE = 0.0055;
/** Spheres on the ring's centre circle. */
export const RING_SPHERES = 40;

/** Mass is 1: impulses are changes of velocity. Torus inertia. */
const I_AXIS = RING_R * RING_R + 0.75 * RING_TUBE * RING_TUBE;
const I_DIAM = 0.5 * RING_R * RING_R + 0.625 * RING_TUBE * RING_TUBE;
const INV_I_AXIS = 1 / I_AXIS;
const INV_I_DIAM = 1 / I_DIAM;

/**
 * The bottle, a solid of revolution: (radius, height) from the mouth's
 * centre round the lip bead, down the neck and the shoulder, to the base.
 * Radius is a function of height below the mouth, so "inside" is easy.
 */
export const BOTTLE_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0, 0.2],
  [0.0122, 0.2],
  [0.0148, 0.1988],
  [0.0156, 0.1965],
  [0.0156, 0.1925],
  [0.0146, 0.1898],
  [0.0134, 0.1885],
  [0.0134, 0.152],
  [0.0158, 0.1455],
  [0.0198, 0.1385],
  [0.0246, 0.1305],
  [0.0294, 0.1225],
  [0.0334, 0.1148],
  [0.0358, 0.1085],
  [0.0368, 0.103],
  [0.037, 0.096],
  [0.037, 0],
];
/** The mouth (top of the lip bead). */
export const BOTTLE_H = 0.2;
/** Below this a bottle's axis inside the ring's hole is a ringer. */
export const BOTTLE_NECK_TOP = 0.1885;
/** Widest radius (the body). */
export const BOTTLE_MAX_R = 0.037;

/** The crate: COLS x ROWS bottles, centre to centre. */
export const CRATE_COLS = 4;
export const CRATE_ROWS = 4;
export const CRATE_PITCH = 0.095;
/** Distance from the hand to the crate's centre, down the throw. */
export const CRATE_Z = 0.9;
/** Inside half-width of the crate (bottles sit a pitch apart, half a pitch in from the walls). */
export const CRATE_HALF = (CRATE_COLS * CRATE_PITCH) / 2;
export const CRATE_HALF_Z = (CRATE_ROWS * CRATE_PITCH) / 2;
export const CRATE_WALL_H = 0.085;
export const CRATE_WALL_T = 0.014;

/** The platform the crate stands on (top at y = 0). */
export const PLATFORM_HALF_X = 0.46;
export const PLATFORM_Z0 = CRATE_Z - CRATE_HALF_Z - 0.12;
export const PLATFORM_Z1 = CRATE_Z + CRATE_HALF_Z + 0.24;
export const PLATFORM_DEPTH = 0.7;
/** The backboard at the back of the platform: the sign hangs on it. */
export const BACKBOARD_Z = PLATFORM_Z1 - 0.06;
export const BACKBOARD_HALF_X = 0.26;
export const BACKBOARD_H = 0.36;
export const BACKBOARD_T = 0.02;
/** Below this the ring has fallen off the platform: gone. */
export const RING_LOST_Y = -0.16;

/** Bounce and grip. */
const E_GLASS = 0.42;
const E_WOOD = 0.3;
const E_RING = 0.35;
const MU_GLASS = 0.22;
const MU_WOOD = 0.45;
const MU_RING = 0.3;
/** Below this approach speed a contact doesn't bounce (m/s). */
const BOUNCE_MIN = 0.18;
/** Penetration allowed before the solver pushes out, and how hard. */
const SLOP = 0.0004;
const BAUMGARTE = 0.25;
const MAX_PUSH = 0.6;
const ITERATIONS = 6;

/** Rest: slower than this for REST_STEPS in contact (m/s, rad/s). */
const REST_SPEED = 0.05;
const REST_SPIN = 2.2;
const REST_STEPS = 48;
/** Longest flight before the ring is frozen where it is (steps: 3.2 s). */
export const RING_MAX_STEPS = 1536;
/** Rolling and scrubbing losses while touching something (per second). */
const CONTACT_DAMP_V = 1.2;
const CONTACT_DAMP_W = 2.6;

// ---------------------------------------------------------------------------
// The throw
// ---------------------------------------------------------------------------

/** Where the ring leaves the hand. */
export const HAND_Y = 0.32;
export const HAND_Z = 0.32;
/** The hand slides this far either side of centre. */
export const HAND_HALF = 0.075;
/** Aim -1 and 1 put the ring's centre this far either side at the necks:
 *  past the outside columns, to the crate's walls. */
export const AIM_RANGE = CRATE_HALF + 0.02;
/** Power 0 lands this far short of the front row's necks, 1 past the back row's. */
export const POWER_OVERSHOOT = 0.075;
/** Launch elevation: vertical over forward speed (about 55 degrees), a lob. */
const LAUNCH_K = 1.45;
/** Spin about the ring's axis (rad/s): a base plus more for a harder flick. */
const SPIN_BASE = 19;
const SPIN_POWER = 9;
/** Every ring leaves the hand a little off its spin axis: the wobble. */
const WOBBLE_W = 4.5;
/** The ring's nose is up this much at release (rad). */
const PITCH_UP = 0.07;
/** A hooked flick banks the ring: full curl is this much bank (rad). */
const CURL_BANK = 0.42;
/** Curl under this is a straight flick. */
const CURL_DEAD = 0.18;

/** Values by row, front to back, and the gold bottle. */
export const ROW_VALUES = [10, 20, 30, 50] as const;
export const GOLD_VALUE = 100;
/** The gold bottle is one of the back two rows, a new one for every ring. */
export const GOLD_ROWS = [2, 3] as const;

export const RING_MAX_POINTS = RING_COUNT * GOLD_VALUE;

export type RingParams = {
  /** Where the ring leaves the hand, -1 (left) to 1 (right). */
  h: number;
  /** Power, 0 to 1: how far it flies. */
  p: number;
  /** Where it is aimed across the crate, -1 to 1 (AIM_RANGE), right positive. */
  a: number;
  /** Curl (how much the flick hooks), -1 to 1. */
  c: number;
};

export type RingThrow = RingParams & {
  /** Ms since the server-stamped start of the round. */
  t: number;
};

// ---------------------------------------------------------------------------
// Small maths (identical everywhere)
// ---------------------------------------------------------------------------

/** sin and cos by fixed polynomials for |a| <= 0.8. */
function polySin(a: number): number {
  const a2 = a * a;
  return a * (1 - (a2 / 6) * (1 - (a2 / 20) * (1 - (a2 / 42) * (1 - a2 / 72))));
}
function polyCos(a: number): number {
  const a2 = a * a;
  return 1 - (a2 / 2) * (1 - (a2 / 12) * (1 - (a2 / 30) * (1 - (a2 / 56) * (1 - a2 / 90))));
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Unit circle at 40 points, built from one octant by symmetry. */
const CIRCLE_COS: number[] = new Array(RING_SPHERES);
const CIRCLE_SIN: number[] = new Array(RING_SPHERES);
{
  // 40 points: 9 degrees apart. Angles in the first octant are 0, 9, 18,
  // 27, 36 and 45 is between, so build 0..90 from polynomials of a <= pi/4
  // and the co-function for the rest.
  const step = Math.PI / 20; // a literal double, the same everywhere
  for (let k = 0; k <= 10; k += 1) {
    let c: number;
    let s: number;
    if (k <= 5) {
      const a = k * step;
      c = polyCos(a);
      s = polySin(a);
    } else {
      const a = (10 - k) * step;
      c = polySin(a);
      s = polyCos(a);
    }
    // Quadrants: k, 20 - k, 20 + k, 40 - k.
    CIRCLE_COS[k] = c;
    CIRCLE_SIN[k] = s;
    if (k > 0 && k < 10) {
      CIRCLE_COS[20 - k] = -c;
      CIRCLE_SIN[20 - k] = s;
      CIRCLE_COS[20 + k] = -c;
      CIRCLE_SIN[20 + k] = -s;
      CIRCLE_COS[40 - k] = c;
      CIRCLE_SIN[40 - k] = -s;
    }
  }
  CIRCLE_COS[20] = -1;
  CIRCLE_SIN[20] = 0;
  CIRCLE_COS[10] = 0;
  CIRCLE_SIN[10] = 1;
  CIRCLE_COS[30] = 0;
  CIRCLE_SIN[30] = -1;
  CIRCLE_COS[0] = 1;
  CIRCLE_SIN[0] = 0;
}
export const RING_CIRCLE: { cos: readonly number[]; sin: readonly number[] } = { cos: CIRCLE_COS, sin: CIRCLE_SIN };

// ---------------------------------------------------------------------------
// The crate
// ---------------------------------------------------------------------------

export type Bottle = { index: number; col: number; row: number; x: number; z: number; value: number };

/** Bottles, front row first, left to right as the player sees them (x from -). */
export const BOTTLES: readonly Bottle[] = (() => {
  const out: Bottle[] = [];
  for (let row = 0; row < CRATE_ROWS; row += 1) {
    for (let col = 0; col < CRATE_COLS; col += 1) {
      out.push({
        index: row * CRATE_COLS + col,
        col,
        row,
        x: (col - (CRATE_COLS - 1) / 2) * CRATE_PITCH,
        z: CRATE_Z + (row - (CRATE_ROWS - 1) / 2) * CRATE_PITCH,
        value: ROW_VALUES[row]!,
      });
    }
  }
  return out;
})();

/** Front and back rows' necks, for the power map. */
const Z_FRONT = BOTTLES[0]!.z;
const Z_BACK = BOTTLES[BOTTLES.length - 1]!.z;

type Box = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; id: number };

/** Crate walls (ids 100..103), the backboard (104) and the platform (200). */
export const CRATE_BOXES: readonly Box[] = (() => {
  const x0 = -CRATE_HALF;
  const x1 = CRATE_HALF;
  const z0 = CRATE_Z - CRATE_HALF_Z;
  const z1 = CRATE_Z + CRATE_HALF_Z;
  const t = CRATE_WALL_T;
  const h = CRATE_WALL_H;
  return [
    { x0: x0 - t, x1: x1 + t, y0: 0, y1: h, z0: z0 - t, z1: z0, id: 100 },
    { x0: x0 - t, x1: x1 + t, y0: 0, y1: h, z0: z1, z1: z1 + t, id: 101 },
    { x0: x0 - t, x1: x0, y0: 0, y1: h, z0: z0, z1: z1, id: 102 },
    { x0: x1, x1: x1 + t, y0: 0, y1: h, z0: z0, z1: z1, id: 103 },
    { x0: -BACKBOARD_HALF_X, x1: BACKBOARD_HALF_X, y0: 0, y1: BACKBOARD_H, z0: BACKBOARD_Z, z1: BACKBOARD_Z + BACKBOARD_T, id: 104 },
    { x0: -PLATFORM_HALF_X, x1: PLATFORM_HALF_X, y0: -PLATFORM_DEPTH, y1: 0, z0: PLATFORM_Z0, z1: PLATFORM_Z1, id: 200 },
  ];
})();

// ---------------------------------------------------------------------------
// Seeded gold bottle
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The gold bottle for ring `index` (0-based) of a round. Never the same one twice running. */
export function ringGoldBottle(seed: number, index: number): number {
  const pool: number[] = [];
  for (const b of BOTTLES) if ((GOLD_ROWS as readonly number[]).includes(b.row)) pool.push(b.index);
  let prev = -1;
  let pick = pool[0]!;
  for (let i = 0; i <= index; i += 1) {
    const rng = mulberry32((seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0);
    rng();
    let k = Math.floor(rng() * pool.length) % pool.length;
    if (pool[k] === prev) k = (k + 1 + Math.floor(rng() * (pool.length - 1))) % pool.length;
    pick = pool[k]!;
    prev = pick;
  }
  return pick;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** A ring at rest: a fixed torus. */
export type RestingRing = {
  x: number;
  y: number;
  z: number;
  /** Unit axis. */
  ax: number;
  ay: number;
  az: number;
  /** The quaternion it rests at, for drawing. */
  qw: number;
  qx: number;
  qy: number;
  qz: number;
  /** Bottle it rings, or -1. */
  bottle: number;
};

export type RingContactKind = 'neck' | 'glass' | 'wood' | 'ring';

export type RingStepEvent =
  | { type: 'hit'; step: number; kind: RingContactKind; collider: number; impulse: number; x: number; y: number; z: number }
  /** The ring dropped over a neck: below the mouth with the axis through its hole. */
  | { type: 'over'; step: number; bottle: number }
  | { type: 'done'; step: number; outcome: RingOutcome };

export type RingOutcome =
  | { kind: 'ringer'; bottle: number; gold: boolean; points: number }
  | { kind: 'miss'; lost: boolean };

export type RingState = {
  step: number;
  /** Centre. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Orientation: body y is the ring's axis. */
  qw: number;
  qx: number;
  qy: number;
  qz: number;
  /** Angular momentum (mass 1). */
  lx: number;
  ly: number;
  lz: number;
  /** Angular velocity, derived from L each step. */
  wx: number;
  wy: number;
  wz: number;
  restSteps: number;
  done: boolean;
  outcome: RingOutcome | null;
  overBottle: number;
  /** Contact ids touched last step (for "new contact" events). */
  touching: number[];
  /** What it can hit. */
  resting: readonly RestingRing[];
  gold: number;
};

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

export function clampParams(params: RingParams): RingParams {
  return {
    h: clamp(params.h, -1, 1),
    p: clamp(params.p, 0, 1),
    a: clamp(params.a, -1, 1),
    c: clamp(params.c, -1, 1),
  };
}

/** Quaternion product a * b. */
function qmul(
  aw: number, ax: number, ay: number, az: number,
  bw: number, bx: number, by: number, bz: number,
): [number, number, number, number] {
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ];
}

/** The ring's world axis (body y) from its quaternion. */
function axisOf(qw: number, qx: number, qy: number, qz: number): [number, number, number] {
  return [2 * (qx * qy - qw * qz), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qw * qx)];
}

/** How far down the throw power p (0 to 1) aims the ring's centre. */
export function ringAimDepth(p: number): number {
  return Z_FRONT - POWER_OVERSHOOT + clamp(p, 0, 1) * (Z_BACK - Z_FRONT + 2 * POWER_OVERSHOOT);
}

/** Where a throw's centre is aimed: the depth and sideways point at neck height. */
export function ringAimPoint(params: RingParams): { x: number; z: number } {
  const p = clampParams(params);
  return { x: p.a * AIM_RANGE, z: ringAimDepth(p.p) };
}

/** Neck height, where the aim point is. */
export const RING_AIM_Y = 0.215;

export function ringStartThrow(params: RingParams, resting: readonly RestingRing[] = [], gold = -1): RingState {
  const p = clampParams(params);
  const hx = p.h * HAND_HALF;
  const aim = ringAimPoint(p);
  const dz = aim.z - HAND_Z;
  const dy = RING_AIM_Y - HAND_Y;
  // Through (aim.x, RING_AIM_Y, aim.z) at a fixed elevation: z = vz t, y = K vz t - g t^2 / 2.
  const vz = Math.sqrt((RING_GRAVITY * dz * dz) / (2 * (LAUNCH_K * dz - dy)));
  const vy = LAUNCH_K * vz;
  const tf = dz / vz;
  const vx = (aim.x - hx) / tf;

  // Orientation: nose up (about +x), then a bank from the curl (about +z).
  const curlMag = p.c < 0 ? -p.c : p.c;
  const bankShare = curlMag <= CURL_DEAD ? 0 : (curlMag - CURL_DEAD) / (1 - CURL_DEAD);
  const bank = (p.c < 0 ? -1 : 1) * bankShare * CURL_BANK;
  const hp = -PITCH_UP / 2;
  const hb = bank / 2;
  const qPitch: [number, number, number, number] = [polyCos(hp), polySin(hp), 0, 0];
  const qBank: [number, number, number, number] = [polyCos(hb), 0, 0, polySin(hb)];
  const q = qmul(qBank[0], qBank[1], qBank[2], qBank[3], qPitch[0], qPitch[1], qPitch[2], qPitch[3]);
  const [qw, qx, qy, qz] = q;
  const [ax, ay, az] = axisOf(qw, qx, qy, qz);

  // Spin about the axis: clockwise from above, the way a right hand throws,
  // unless the flick hooks left.
  const sense = p.c < -0.05 ? 1 : -1;
  const spin = sense * (SPIN_BASE + SPIN_POWER * p.p);
  // The wobble: a little angular velocity about the throw's side axis.
  const wx = spin * ax + WOBBLE_W;
  const wy = spin * ay;
  const wz = spin * az;
  // L = I w, with I = I_DIAM E + (I_AXIS - I_DIAM) a a^T.
  const aw = ax * wx + ay * wy + az * wz;
  const lx = I_DIAM * wx + (I_AXIS - I_DIAM) * aw * ax;
  const ly = I_DIAM * wy + (I_AXIS - I_DIAM) * aw * ay;
  const lz = I_DIAM * wz + (I_AXIS - I_DIAM) * aw * az;

  const state: RingState = {
    step: 0,
    x: hx,
    y: HAND_Y,
    z: HAND_Z,
    vx,
    vy,
    vz,
    qw,
    qx,
    qy,
    qz,
    lx,
    ly,
    lz,
    wx: 0,
    wy: 0,
    wz: 0,
    restSteps: 0,
    done: false,
    outcome: null,
    overBottle: -1,
    touching: [],
    resting,
    gold,
  };
  syncOmega(state);
  return state;
}

function syncOmega(s: RingState): void {
  const [ax, ay, az] = axisOf(s.qw, s.qx, s.qy, s.qz);
  const al = ax * s.lx + ay * s.ly + az * s.lz;
  const k = (INV_I_AXIS - INV_I_DIAM) * al;
  s.wx = INV_I_DIAM * s.lx + k * ax;
  s.wy = INV_I_DIAM * s.ly + k * ay;
  s.wz = INV_I_DIAM * s.lz + k * az;
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

/** Contact ids: bottle necks are 0..15, bottle bodies RING_BODY_ID + index,
 *  crate walls 100..103, the backboard 104, the platform 200, rings at rest 300 + n. */
export const RING_BODY_ID = 20;

type Contact = {
  /** Offset from the ring's centre to the contact point. */
  rx: number;
  ry: number;
  rz: number;
  nx: number;
  ny: number;
  nz: number;
  pen: number;
  e: number;
  mu: number;
  id: number;
  kind: RingContactKind;
  /** Effective inverse mass along n. */
  kn: number;
  bias: number;
  target: number;
  jn: number;
};

/** Closest point on the bottle profile to (rho, y): distance, normal (outward), inside. */
function bottleNearest(rho: number, y: number): { d: number; nr: number; ny: number; inside: boolean } {
  let best = Infinity;
  let bx = 0;
  let by = 0;
  const prof = BOTTLE_PROFILE;
  for (let i = 0; i < prof.length - 1; i += 1) {
    const ax = prof[i]![0];
    const ay = prof[i]![1];
    const ex = prof[i + 1]![0] - ax;
    const ey = prof[i + 1]![1] - ay;
    const len2 = ex * ex + ey * ey;
    let t = ((rho - ax) * ex + (y - ay) * ey) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + ex * t;
    const py = ay + ey * t;
    const dx = rho - px;
    const dy = y - py;
    const d2 = dx * dx + dy * dy;
    if (d2 < best) {
      best = d2;
      bx = px;
      by = py;
    }
  }
  const d = Math.sqrt(best);
  const inside = y > 0 && y < BOTTLE_H && rho < bottleRadiusAt(y);
  let nr = 0;
  let ny = 1;
  if (d > 1e-12) {
    nr = (rho - bx) / d;
    ny = (y - by) / d;
    if (inside) {
      nr = -nr;
      ny = -ny;
    }
  }
  return { d, nr, ny, inside };
}

/** The profile's radius at height y (0 above the mouth). */
export function bottleRadiusAt(y: number): number {
  if (y >= BOTTLE_H || y < 0) return 0;
  const prof = BOTTLE_PROFILE;
  for (let i = 1; i < prof.length - 1; i += 1) {
    const ay = prof[i]![1];
    const by = prof[i + 1]![1];
    if (y <= ay && y >= by) {
      const t = ay === by ? 0 : (ay - y) / (ay - by);
      return prof[i]![0] + (prof[i + 1]![0] - prof[i]![0]) * t;
    }
  }
  return BOTTLE_MAX_R;
}

function addContact(
  out: Contact[],
  s: RingState,
  cx: number,
  cy: number,
  cz: number,
  nx: number,
  ny: number,
  nz: number,
  pen: number,
  e: number,
  mu: number,
  id: number,
  kind: RingContactKind,
): void {
  // The contact point is on the tube's surface, toward the obstacle.
  const rx = cx - nx * RING_TUBE - s.x;
  const ry = cy - ny * RING_TUBE - s.y;
  const rz = cz - nz * RING_TUBE - s.z;
  out.push({ rx, ry, rz, nx, ny, nz, pen, e, mu, id, kind, kn: 0, bias: 0, target: 0, jn: 0 });
}

function gatherContacts(s: RingState, out: Contact[]): void {
  out.length = 0;
  // Ring frame: e1 (body x) and e3 (body z) span the ring's plane.
  const { qw, qx, qy, qz } = s;
  const e1x = 1 - 2 * (qy * qy + qz * qz);
  const e1y = 2 * (qx * qy + qw * qz);
  const e1z = 2 * (qx * qz - qw * qy);
  const e3x = 2 * (qx * qz + qw * qy);
  const e3y = 2 * (qy * qz - qw * qx);
  const e3z = 1 - 2 * (qx * qx + qy * qy);
  const reach = RING_R + RING_TUBE;

  // Bottles near the ring (broad phase on the ring's bounding sphere).
  const nearBottles: number[] = [];
  if (s.y - reach < BOTTLE_H + 0.002) {
    for (let b = 0; b < BOTTLES.length; b += 1) {
      const bot = BOTTLES[b]!;
      const dx = s.x - bot.x;
      const dz = s.z - bot.z;
      const lim = reach + BOTTLE_MAX_R + 0.002;
      if (dx * dx + dz * dz < lim * lim) nearBottles.push(b);
    }
  }
  const nearBoxes: number[] = [];
  for (let k = 0; k < CRATE_BOXES.length; k += 1) {
    const bx = CRATE_BOXES[k]!;
    if (
      s.x + reach > bx.x0 && s.x - reach < bx.x1 &&
      s.y + reach > bx.y0 && s.y - reach < bx.y1 + 0.002 &&
      s.z + reach > bx.z0 && s.z - reach < bx.z1
    ) nearBoxes.push(k);
  }
  const nearRings: number[] = [];
  for (let k = 0; k < s.resting.length; k += 1) {
    const r = s.resting[k]!;
    const dx = s.x - r.x;
    const dy = s.y - r.y;
    const dz = s.z - r.z;
    const lim = 2 * reach + 0.002;
    if (dx * dx + dy * dy + dz * dz < lim * lim) nearRings.push(k);
  }
  if (nearBottles.length === 0 && nearBoxes.length === 0 && nearRings.length === 0) return;

  for (let i = 0; i < RING_SPHERES; i += 1) {
    const c = CIRCLE_COS[i]!;
    const sn = CIRCLE_SIN[i]!;
    const cx = s.x + RING_R * (c * e1x + sn * e3x);
    const cy = s.y + RING_R * (c * e1y + sn * e3y);
    const cz = s.z + RING_R * (c * e1z + sn * e3z);

    for (let j = 0; j < nearBottles.length; j += 1) {
      const bot = BOTTLES[nearBottles[j]!]!;
      if (cy - RING_TUBE > BOTTLE_H) continue;
      const dx = cx - bot.x;
      const dz = cz - bot.z;
      const rho2 = dx * dx + dz * dz;
      const lim = BOTTLE_MAX_R + RING_TUBE;
      if (rho2 > lim * lim) continue;
      const rho = Math.sqrt(rho2);
      const hit = bottleNearest(rho, cy);
      if (!hit.inside && hit.d >= RING_TUBE) continue;
      const pen = hit.inside ? RING_TUBE + hit.d : RING_TUBE - hit.d;
      let ux = 1;
      let uz = 0;
      if (rho > 1e-9) {
        ux = dx / rho;
        uz = dz / rho;
      }
      const nx = hit.nr * ux;
      const nz = hit.nr * uz;
      // The neck and the body are told apart, so a ring sliding down the
      // neck and landing on the shoulder is a new contact (and a new sound).
      const neck = cy > 0.15;
      addContact(out, s, cx, cy, cz, nx, hit.ny, nz, pen, E_GLASS, MU_GLASS, neck ? bot.index : RING_BODY_ID + bot.index, neck ? 'neck' : 'glass');
    }

    for (let j = 0; j < nearBoxes.length; j += 1) {
      const bx = CRATE_BOXES[nearBoxes[j]!]!;
      const px = cx < bx.x0 ? bx.x0 : cx > bx.x1 ? bx.x1 : cx;
      const py = cy < bx.y0 ? bx.y0 : cy > bx.y1 ? bx.y1 : cy;
      const pz = cz < bx.z0 ? bx.z0 : cz > bx.z1 ? bx.z1 : cz;
      let dx = cx - px;
      let dy = cy - py;
      let dz = cz - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      let nx: number;
      let ny: number;
      let nz: number;
      let pen: number;
      if (d2 > 1e-18) {
        if (d2 >= RING_TUBE * RING_TUBE) continue;
        const d = Math.sqrt(d2);
        nx = dx / d;
        ny = dy / d;
        nz = dz / d;
        pen = RING_TUBE - d;
      } else {
        // Centre inside the box: out through the nearest face.
        const fx0 = cx - bx.x0;
        const fx1 = bx.x1 - cx;
        const fy1 = bx.y1 - cy;
        const fz0 = cz - bx.z0;
        const fz1 = bx.z1 - cz;
        let m = fy1;
        nx = 0;
        ny = 1;
        nz = 0;
        if (fx0 < m) { m = fx0; nx = -1; ny = 0; nz = 0; }
        if (fx1 < m) { m = fx1; nx = 1; ny = 0; nz = 0; }
        if (fz0 < m) { m = fz0; nx = 0; ny = 0; nz = -1; }
        if (fz1 < m) { m = fz1; nx = 0; ny = 0; nz = 1; }
        pen = RING_TUBE + m;
        dx = dy = dz = 0;
      }
      addContact(out, s, cx, cy, cz, nx, ny, nz, pen, E_WOOD, MU_WOOD, bx.id, 'wood');
    }

    for (let j = 0; j < nearRings.length; j += 1) {
      const r = s.resting[nearRings[j]!]!;
      const dx = cx - r.x;
      const dy = cy - r.y;
      const dz = cz - r.z;
      const h = dx * r.ax + dy * r.ay + dz * r.az;
      const px = dx - h * r.ax;
      const py = dy - h * r.ay;
      const pz = dz - h * r.az;
      const rho2 = px * px + py * py + pz * pz;
      if (rho2 < 1e-12) continue;
      const rho = Math.sqrt(rho2);
      const qx2 = px * (RING_R / rho);
      const qy2 = py * (RING_R / rho);
      const qz2 = pz * (RING_R / rho);
      const wx = dx - qx2;
      const wy = dy - qy2;
      const wz = dz - qz2;
      const d2 = wx * wx + wy * wy + wz * wz;
      const lim = 2 * RING_TUBE;
      if (d2 >= lim * lim || d2 < 1e-18) continue;
      const d = Math.sqrt(d2);
      addContact(out, s, cx, cy, cz, wx / d, wy / d, wz / d, lim - d, E_RING, MU_RING, 300 + nearRings[j]!, 'ring');
    }
  }
}

/** Inverse inertia (world) times a vector. */
function invI(ax: number, ay: number, az: number, vx: number, vy: number, vz: number): [number, number, number] {
  const k = (INV_I_AXIS - INV_I_DIAM) * (ax * vx + ay * vy + az * vz);
  return [INV_I_DIAM * vx + k * ax, INV_I_DIAM * vy + k * ay, INV_I_DIAM * vz + k * az];
}

/** Velocity of the point at offset r: v + w x r. */
function pointVel(s: RingState, rx: number, ry: number, rz: number): [number, number, number] {
  return [
    s.vx + s.wy * rz - s.wz * ry,
    s.vy + s.wz * rx - s.wx * rz,
    s.vz + s.wx * ry - s.wy * rx,
  ];
}

/** Apply impulse J at offset r. */
function applyImpulse(s: RingState, ax: number, ay: number, az: number, rx: number, ry: number, rz: number, jx: number, jy: number, jz: number): void {
  s.vx += jx;
  s.vy += jy;
  s.vz += jz;
  s.lx += ry * jz - rz * jy;
  s.ly += rz * jx - rx * jz;
  s.lz += rx * jy - ry * jx;
  // Keep w in step with L inside the solver.
  const k = (INV_I_AXIS - INV_I_DIAM) * (ax * s.lx + ay * s.ly + az * s.lz);
  s.wx = INV_I_DIAM * s.lx + k * ax;
  s.wy = INV_I_DIAM * s.ly + k * ay;
  s.wz = INV_I_DIAM * s.lz + k * az;
}

const contacts: Contact[] = [];

// ---------------------------------------------------------------------------
// Step
// ---------------------------------------------------------------------------

/** Is the ring around a bottle's neck? Returns the bottle or -1. */
export function ringAroundBottle(x: number, y: number, z: number, ax: number, ay: number, az: number): number {
  if ((ay < 0 ? -ay : ay) < 0.25) return -1;
  for (const b of BOTTLES) {
    // Where the bottle's axis meets the ring's plane.
    const yi = y + (ax * (x - b.x) + az * (z - b.z)) / ay;
    if (yi >= BOTTLE_NECK_TOP || yi <= 0.02) continue;
    const dx = b.x - x;
    const dy = yi - y;
    const dz = b.z - z;
    const lim = RING_R - RING_TUBE * 0.5;
    if (dx * dx + dy * dy + dz * dz < lim * lim) return b.index;
  }
  return -1;
}

export function ringStep(s: RingState, events?: RingStepEvent[]): void {
  if (s.done) return;
  s.step += 1;
  const dt = RING_SIM_DT;
  s.vy -= RING_GRAVITY * dt;

  gatherContacts(s, contacts);
  const [ax, ay, az] = axisOf(s.qw, s.qx, s.qy, s.qz);

  // Prepare.
  for (let i = 0; i < contacts.length; i += 1) {
    const c = contacts[i]!;
    // r x n, then n . (I^-1 (r x n)) x r == (r x n) . I^-1 (r x n)
    const cnx = c.ry * c.nz - c.rz * c.ny;
    const cny = c.rz * c.nx - c.rx * c.nz;
    const cnz = c.rx * c.ny - c.ry * c.nx;
    const [ix, iy, iz] = invI(ax, ay, az, cnx, cny, cnz);
    c.kn = 1 / (1 + cnx * ix + cny * iy + cnz * iz);
    const [vx, vy, vz] = pointVel(s, c.rx, c.ry, c.rz);
    const vn = vx * c.nx + vy * c.ny + vz * c.nz;
    c.target = vn < -BOUNCE_MIN ? -c.e * vn : 0;
    const push = BAUMGARTE * (c.pen - SLOP) / dt;
    c.bias = push > 0 ? (push > MAX_PUSH ? MAX_PUSH : push) : 0;
    c.jn = 0;
  }

  // Solve.
  for (let it = 0; it < ITERATIONS; it += 1) {
    for (let i = 0; i < contacts.length; i += 1) {
      const c = contacts[i]!;
      const [vx, vy, vz] = pointVel(s, c.rx, c.ry, c.rz);
      const vn = vx * c.nx + vy * c.ny + vz * c.nz;
      const want = (c.target > c.bias ? c.target : c.bias) - vn;
      let dj = want * c.kn;
      const old = c.jn;
      c.jn = old + dj < 0 ? 0 : old + dj;
      dj = c.jn - old;
      if (dj !== 0) applyImpulse(s, ax, ay, az, c.rx, c.ry, c.rz, dj * c.nx, dj * c.ny, dj * c.nz);

      // Friction along the slip, bounded by mu * jn (this iteration's).
      const [ux, uy, uz] = pointVel(s, c.rx, c.ry, c.rz);
      const un = ux * c.nx + uy * c.ny + uz * c.nz;
      const tx = ux - un * c.nx;
      const ty = uy - un * c.ny;
      const tz = uz - un * c.nz;
      const ts2 = tx * tx + ty * ty + tz * tz;
      if (ts2 > 1e-14) {
        const ts = Math.sqrt(ts2);
        const dx = tx / ts;
        const dy = ty / ts;
        const dz = tz / ts;
        const ctx = c.ry * dz - c.rz * dy;
        const cty = c.rz * dx - c.rx * dz;
        const ctz = c.rx * dy - c.ry * dx;
        const [jx, jy, jz] = invI(ax, ay, az, ctx, cty, ctz);
        const kt = 1 / (1 + ctx * jx + cty * jy + ctz * jz);
        let jt = ts * kt;
        const maxT = c.mu * c.jn;
        if (jt > maxT) jt = maxT;
        if (jt > 0) applyImpulse(s, ax, ay, az, c.rx, c.ry, c.rz, -jt * dx, -jt * dy, -jt * dz);
      }
    }
  }

  // Events: a new contact with something, loud enough to hear.
  const touchingNow: number[] = [];
  const inContact = contacts.length > 0;
  for (let i = 0; i < contacts.length; i += 1) {
    const c = contacts[i]!;
    let seen = false;
    for (let k = 0; k < touchingNow.length; k += 1) if (touchingNow[k] === c.id) seen = true;
    if (seen) continue;
    touchingNow.push(c.id);
    let sum = 0;
    let px = 0;
    let py = 0;
    let pz = 0;
    let n = 0;
    for (let k = 0; k < contacts.length; k += 1) {
      const o = contacts[k]!;
      if (o.id !== c.id) continue;
      sum += o.jn;
      px += o.rx;
      py += o.ry;
      pz += o.rz;
      n += 1;
    }
    let was = false;
    for (let k = 0; k < s.touching.length; k += 1) if (s.touching[k] === c.id) was = true;
    if (!was && sum > 0.03 && events) {
      events.push({
        type: 'hit',
        step: s.step,
        kind: c.kind,
        collider: c.id,
        impulse: sum,
        x: s.x + px / n,
        y: s.y + py / n,
        z: s.z + pz / n,
      });
    }
  }
  s.touching = touchingNow;

  if (inContact) {
    const kv = 1 - CONTACT_DAMP_V * dt;
    const kw = 1 - CONTACT_DAMP_W * dt;
    s.vx *= kv;
    s.vy *= kv;
    s.vz *= kv;
    s.lx *= kw;
    s.ly *= kw;
    s.lz *= kw;
  }

  // Integrate.
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  s.z += s.vz * dt;
  syncOmega(s);
  const hx = 0.5 * dt * s.wx;
  const hy = 0.5 * dt * s.wy;
  const hz = 0.5 * dt * s.wz;
  const { qw, qx, qy, qz } = s;
  let nw = qw - hx * qx - hy * qy - hz * qz;
  let nx = qx + hx * qw + hy * qz - hz * qy;
  let ny = qy - hx * qz + hy * qw + hz * qx;
  let nz = qz + hx * qy - hy * qx + hz * qw;
  const inv = 1 / Math.sqrt(nw * nw + nx * nx + ny * ny + nz * nz);
  nw *= inv;
  nx *= inv;
  ny *= inv;
  nz *= inv;
  s.qw = nw;
  s.qx = nx;
  s.qy = ny;
  s.qz = nz;
  syncOmega(s);

  // Over a neck? An event each time it drops round a (new) one.
  const [bx, by, bz] = axisOf(s.qw, s.qx, s.qy, s.qz);
  const around = ringAroundBottle(s.x, s.y, s.z, bx, by, bz);
  if (around !== s.overBottle) {
    s.overBottle = around;
    if (around >= 0) events?.push({ type: 'over', step: s.step, bottle: around });
  }

  // Rest, loss, or the time limit.
  const v2 = s.vx * s.vx + s.vy * s.vy + s.vz * s.vz;
  const w2 = s.wx * s.wx + s.wy * s.wy + s.wz * s.wz;
  if (inContact && v2 < REST_SPEED * REST_SPEED && w2 < REST_SPIN * REST_SPIN) s.restSteps += 1;
  else s.restSteps = 0;
  const lost = s.y < RING_LOST_Y;
  if (lost || s.restSteps >= REST_STEPS || s.step >= RING_MAX_STEPS) {
    s.done = true;
    s.vx = s.vy = s.vz = 0;
    s.lx = s.ly = s.lz = 0;
    s.wx = s.wy = s.wz = 0;
    const bottle = lost ? -1 : ringAroundBottle(s.x, s.y, s.z, bx, by, bz);
    if (bottle >= 0) {
      const gold = bottle === s.gold;
      s.outcome = { kind: 'ringer', bottle, gold, points: gold ? GOLD_VALUE : BOTTLES[bottle]!.value };
    } else {
      s.outcome = { kind: 'miss', lost };
    }
    events?.push({ type: 'done', step: s.step, outcome: s.outcome });
  }
}

/** The ring's world axis, for drawing. */
export function ringAxis(s: Pick<RingState, 'qw' | 'qx' | 'qy' | 'qz'>): [number, number, number] {
  return axisOf(s.qw, s.qx, s.qy, s.qz);
}

/** A state at rest as a fixed obstacle. */
export function ringToResting(s: RingState): RestingRing {
  const [ax, ay, az] = axisOf(s.qw, s.qx, s.qy, s.qz);
  return {
    x: s.x,
    y: s.y,
    z: s.z,
    ax,
    ay,
    az,
    qw: s.qw,
    qx: s.qx,
    qy: s.qy,
    qz: s.qz,
    bottle: s.outcome?.kind === 'ringer' ? s.outcome.bottle : -1,
  };
}

/** Run one throw to rest (tools and the server). */
export function ringSimulateThrow(
  params: RingParams,
  resting: readonly RestingRing[] = [],
  gold = -1,
  events?: RingStepEvent[],
): RingState {
  const s = ringStartThrow(params, resting, gold);
  while (!s.done) ringStep(s, events);
  return s;
}

/** Ms after release before the next ring can go. */
export function ringReadyMs(s: Pick<RingState, 'step'>): number {
  return s.step * RING_STEP_MS + RING_READY_GAP_MS;
}

// ---------------------------------------------------------------------------
// A round: shared by the client (live) and the server (replay)
// ---------------------------------------------------------------------------

export type RingRoundState = {
  seed: number;
  score: number;
  /** Rings thrown that counted. */
  thrown: number;
  ringers: number;
  golds: number;
  /** Longest run of ringers in a row. */
  bestStreak: number;
  streak: number;
  /** Rings at rest on the crate or platform. */
  resting: RestingRing[];
  /** Earliest time (round ms) the next ring may go. */
  readyAt: number;
  outcomes: RingOutcome[];
};

export function ringRoundInitial(seed: number): RingRoundState {
  return { seed, score: 0, thrown: 0, ringers: 0, golds: 0, bestStreak: 0, streak: 0, resting: [], readyAt: 0, outcomes: [] };
}

export type RingThrowCheck = 'ok' | 'done' | 'early' | 'late' | 'bounds';

/** Can a flick at round time t be thrown? */
export function ringCheckThrow(round: RingRoundState, t: number, params: RingParams): RingThrowCheck {
  if (round.thrown >= RING_COUNT) return 'done';
  if (!Number.isFinite(t) || !Number.isFinite(params.h) || !Number.isFinite(params.p) || !Number.isFinite(params.a) || !Number.isFinite(params.c)) return 'bounds';
  if (t < round.readyAt) return 'early';
  if (t > RING_ROUND_MS) return 'late';
  return 'ok';
}

/** Start the next ring's sim (the round's gold bottle and the rings at rest). */
export function ringRoundStart(round: RingRoundState, params: RingParams): RingState {
  return ringStartThrow(params, round.resting.slice(), ringGoldBottle(round.seed, round.thrown));
}

/** Record a finished ring. `t` is when it was thrown. */
export function ringRoundFinish(round: RingRoundState, t: number, s: RingState): void {
  const outcome = s.outcome ?? { kind: 'miss', lost: false };
  round.thrown += 1;
  round.outcomes.push(outcome);
  round.readyAt = t + ringReadyMs(s);
  if (!(outcome.kind === 'miss' && outcome.lost)) round.resting.push(ringToResting(s));
  if (outcome.kind === 'ringer') {
    round.score += outcome.points;
    round.ringers += 1;
    if (outcome.gold) round.golds += 1;
    round.streak += 1;
    if (round.streak > round.bestStreak) round.bestStreak = round.streak;
  } else {
    round.streak = 0;
  }
}

export type RingRunResult = {
  score: number;
  thrown: number;
  ringers: number;
  golds: number;
  bestStreak: number;
  /** Flicks read. */
  inspected: number;
  /** Flicks read that didn't count: too early, after the round, past the tenth ring. */
  skipped: number;
  /** The last counted flick's time (round ms), or 0. */
  lastT: number;
  stop: 'complete' | 'end' | 'bounds' | 'order';
  outcomes: RingOutcome[];
};

/** The server's replay. Flicks before the ring is ready, or after the round, are skipped. */
export function validateRingRun(seed: number, throws: readonly RingThrow[]): RingRunResult {
  const round = ringRoundInitial(seed >>> 0);
  let inspected = 0;
  let skipped = 0;
  let lastT = -Infinity;
  let lastCounted = 0;
  const result = (stop: RingRunResult['stop']): RingRunResult => ({
    score: round.score,
    thrown: round.thrown,
    ringers: round.ringers,
    golds: round.golds,
    bestStreak: round.bestStreak,
    inspected,
    skipped,
    lastT: lastCounted,
    stop,
    outcomes: round.outcomes,
  });
  if (!Array.isArray(throws)) return result('bounds');
  for (let i = 0; i < throws.length && i < RING_MAX_THROWS; i += 1) {
    if (round.thrown >= RING_COUNT) {
      skipped += throws.length - i;
      return result('complete');
    }
    inspected = i + 1;
    const raw = throws[i] as Partial<RingThrow> | undefined;
    const t = typeof raw?.t === 'number' ? raw.t : NaN;
    const params: RingParams = {
      h: typeof raw?.h === 'number' ? raw.h : NaN,
      p: typeof raw?.p === 'number' ? raw.p : NaN,
      a: typeof raw?.a === 'number' ? raw.a : NaN,
      c: typeof raw?.c === 'number' ? raw.c : NaN,
    };
    const check = ringCheckThrow(round, t, params);
    if (check === 'bounds') return result('bounds');
    if (t < lastT) return result('order');
    lastT = t;
    if (check !== 'ok') {
      skipped += 1;
      continue;
    }
    lastCounted = t;
    const s = ringRoundStart(round, params);
    while (!s.done) ringStep(s);
    ringRoundFinish(round, t, s);
  }
  return result(round.thrown >= RING_COUNT ? 'complete' : 'end');
}
