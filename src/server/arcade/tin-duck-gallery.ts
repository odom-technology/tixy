/**
 * Tin duck gallery, rev. 2: the rules as pure math.
 *
 * Three rows of tin targets ride chains at different depths and speeds. Every
 * target's position is a function of the round clock, so the client draws the
 * same gallery the server would replay: no frame steps, nothing to interpolate.
 * A shot is `{ x, y, t }`: the ray's slope through the pointer (dx / -dz and
 * dy / -dz from the fixed camera) and the milliseconds since the round began.
 * Slopes do not depend on the canvas shape or the field of view, so a phone
 * and a desktop aim the same way.
 *
 * The client draws it and the score route replays it. The older popup range
 * (`tin-duck-replay.ts`) is rules 1, last season: kept for its stored scores and
 * for the verifier's comparison, no longer replayed.
 *
 * Pure: no Date.now(), no Math.random(), no trig at module scope.
 */

/** Rules 2. Rules 1 is the popup range; its rows stay on last season's board. */
export const GALLERY_RULES_VERSION = 2;

/** The round is 30 seconds. */
export const GALLERY_ROUND_MS = 30_000;
/** A shot later than this is not scored. */
export const GALLERY_MAX_SHOT_T_MS = GALLERY_ROUND_MS + 3_000;

/** Six corks, then a reload. Kept from the audited v1. */
export const GALLERY_MAG_SIZE = 6;
export const GALLERY_RELOAD_MS = 1_200;
/** The gun is pumped between shots: no faster than this. */
export const GALLERY_MIN_SHOT_INTERVAL_MS = 170;
export const GALLERY_MAX_SHOTS = 600;
/** The most a round can pay in points, for the route's plausibility bound. The
 *  magazine and pump allow 88 shots; a simulated machine at the pump's floor with
 *  no aim error scored 289 at most in 1,500 runs, and a good player about 128. */
export const GALLERY_MAX_RUN_SCORE = 300;
/** Longest a session may run: the round and 5 s for the network. */
export const GALLERY_MAX_SESSION_MS = GALLERY_ROUND_MS + 5_000;
/**
 * Reward curve divisor: tickets = 75 x (1 - exp(-(score / divisor)^1.15)). Solved
 * so a good player earns about what a good rules 1 player did per minute of
 * play; scripts/verify-tin-duck-gallery.ts holds the maths and fails on drift.
 */
export const GALLERY_REWARD_DIVISOR = 337;

/** The camera sits here for every player; only its field of view changes. */
export const GALLERY_CAMERA = { x: 0, y: 2.55, z: 3.4 } as const;

/** Targets are only live while they are inside the end panels. */
export const GALLERY_HIT_HALF_WIDTH = 4.3;
/** Where the end panels stand; targets slide behind them. */
export const GALLERY_PANEL_X = 4.7;
export const GALLERY_BACKBOARD_Z = -11.4;

/** Down time after a hit: the target flips back and swings up again. */
export const GALLERY_DUCK_DOWN_MS = 1_350;
/** A plate that has been hit is dead until its chain carries it behind an end
 *  panel and round again (`galleryItemLap` changes). Plates ring; they don't
 *  reset in front of you, so a plate can't be farmed from one spot. */

export const GALLERY_DUCK_RADIUS = 0.5;
export const GALLERY_PLATE_RADIUS = 0.56;
export const GALLERY_BULLSEYE_RADIUS = 0.2;
/** Height of a target's centre above its row. */
export const GALLERY_TARGET_LIFT = 0.46;

export const GALLERY_BONUS_VALUE = 10;
/** Plates pay twice the row, the bullseye three times. */
export const GALLERY_PLATE_MULT = 2;
export const GALLERY_BULLSEYE_MULT = 3;

export interface GalleryRow {
  /** Depth of the chain (the camera looks down -z). */
  z: number;
  /** Height of the shelf the targets stand on. */
  y: number;
  /** Chain speed, world units per second. */
  speed: number;
  /** +1 runs left to right, -1 right to left. */
  dir: 1 | -1;
  /** Points for a duck in this row. */
  value: number;
  /** Space between targets on the chain. */
  spacing: number;
  /** Targets on the loop. The loop is `spacing * count` long. */
  count: number;
}

/** Near to far. Farther rows are smaller on screen, faster and pay more. */
export const GALLERY_ROWS: readonly GalleryRow[] = [
  { z: -4.4, y: 1.2, speed: 0.95, dir: 1, value: 1, spacing: 2.4, count: 5 },
  { z: -6.3, y: 2.18, speed: 1.55, dir: -1, value: 2, spacing: 2.4, count: 5 },
  { z: -8.2, y: 3.4, speed: 2.2, dir: 1, value: 3, spacing: 2.4, count: 5 },
];

/** The bonus duck rides its own rail above the back row. */
export const GALLERY_BONUS = {
  z: -9.8,
  y: 4.85,
  speed: 4.3,
  /** The gold duck is bigger: it is far back and fast. */
  radius: 0.8,
  /** Enters and leaves this far past the panels. */
  margin: 1.4,
} as const;

export type GalleryKind = 'duck' | 'plate';

export interface GalleryItem {
  row: number;
  index: number;
  kind: GalleryKind;
}

export interface GallerySchedule {
  /** Where each row's loop starts, in world units along the chain. */
  offsets: number[];
  /** Which index on each row's loop is the plate. */
  plates: number[];
  bonus: { startMs: number; dir: 1 | -1 };
}

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The same seed gives the same gallery on both sides. The draw order is fixed. */
export function deriveGallerySchedule(seed: number): GallerySchedule {
  const rng = mulberry32((seed | 0) ^ 0x7d1ce5);
  const offsets: number[] = [];
  const plates: number[] = [];
  for (const row of GALLERY_ROWS) {
    offsets.push(rng() * row.spacing * row.count);
    plates.push(Math.min(row.count - 1, Math.floor(rng() * row.count)));
  }
  const startMs = Math.round(8_000 + rng() * 12_000);
  const dir: 1 | -1 = rng() < 0.5 ? -1 : 1;
  return { offsets, plates, bonus: { startMs, dir } };
}

/** World x of a target on the loop at time t (ms). It wraps behind the panels. */
export function galleryItemX(
  schedule: GallerySchedule,
  rowIndex: number,
  index: number,
  tMs: number,
): number {
  const row = GALLERY_ROWS[rowIndex]!;
  const length = row.spacing * row.count;
  const travelled = (row.speed * tMs) / 1000;
  const u = index * row.spacing + schedule.offsets[rowIndex]! + row.dir * travelled;
  const wrapped = u - Math.floor(u / length) * length;
  return wrapped - length / 2;
}

/** Which lap of its chain a target is on at time t. It turns over behind the panels. */
export function galleryItemLap(
  schedule: GallerySchedule,
  rowIndex: number,
  index: number,
  tMs: number,
): number {
  const row = GALLERY_ROWS[rowIndex]!;
  const length = row.spacing * row.count;
  const travelled = (row.speed * tMs) / 1000;
  const u = index * row.spacing + schedule.offsets[rowIndex]! + row.dir * travelled;
  return Math.floor(u / length);
}

export function galleryItemKind(schedule: GallerySchedule, rowIndex: number, index: number): GalleryKind {
  return schedule.plates[rowIndex] === index ? 'plate' : 'duck';
}

/** The bonus duck's world x, or null when it is off the rail. */
export function galleryBonusX(schedule: GallerySchedule, tMs: number): number | null {
  const { startMs, dir } = schedule.bonus;
  const reach = GALLERY_PANEL_X + GALLERY_BONUS.margin;
  const x = -reach + (GALLERY_BONUS.speed * (tMs - startMs)) / 1000;
  if (x < -reach || x > reach) return null;
  return dir * x;
}

/** How long the bonus duck is on its rail. */
export const GALLERY_BONUS_RUN_MS = Math.round(
  ((2 * (GALLERY_PANEL_X + GALLERY_BONUS.margin)) / GALLERY_BONUS.speed) * 1000,
);

export type GalleryHitKind = 'duck' | 'plate' | 'bullseye' | 'bonus';

export type GalleryShotOutcome =
  | { type: 'ignored' }
  | { type: 'reload-dead' }
  | {
      type: 'miss';
      ammo: number;
      reloading: boolean;
      /** Where the ray meets the backboard. */
      bx: number;
      by: number;
    }
  | {
      type: 'hit';
      kind: GalleryHitKind;
      value: number;
      /** 0 to 2 for a row, 3 for the bonus rail. */
      row: number;
      index: number;
      wx: number;
      wy: number;
      wz: number;
      ammo: number;
      reloading: boolean;
    };

export interface GalleryScorer {
  shoot(sx: number, sy: number, tMs: number): GalleryShotOutcome;
  /** The ms a target was last hit, or null. */
  lastHitAt(row: number, index: number): number | null;
  displayAmmo(tMs: number): number;
  reloadFraction(tMs: number): number;
  readonly score: number;
  readonly shotsFired: number;
  readonly hits: number;
  readonly bullseyes: number;
  readonly bonusHit: boolean;
}

const BONUS_ROW = GALLERY_ROWS.length;

export function createGalleryScorer(schedule: GallerySchedule): GalleryScorer {
  let score = 0;
  let shotsFired = 0;
  let hits = 0;
  let bullseyes = 0;
  let ammo = GALLERY_MAG_SIZE;
  let reloadUntil = -1;
  let lastLiveShotT = -Infinity;
  let bonusHit = false;
  const hitAt = new Map<number, number>();
  const key = (row: number, index: number) => row * 64 + index;

  const resolve = (sx: number, sy: number, t: number) => {
    const cam = GALLERY_CAMERA;
    // Nearest row first.
    for (let r = 0; r < GALLERY_ROWS.length; r += 1) {
      const row = GALLERY_ROWS[r]!;
      const reach = cam.z - row.z;
      const px = cam.x + sx * reach;
      const py = cam.y + sy * reach;
      for (let i = 0; i < row.count; i += 1) {
        const x = galleryItemX(schedule, r, i, t);
        if (x < -GALLERY_HIT_HALF_WIDTH || x > GALLERY_HIT_HALF_WIDTH) continue;
        const last = hitAt.get(key(r, i));
        const kind = galleryItemKind(schedule, r, i);
        if (last !== undefined) {
          if (kind === 'plate') {
            if (galleryItemLap(schedule, r, i, t) === galleryItemLap(schedule, r, i, last)) continue;
          } else if (t - last < GALLERY_DUCK_DOWN_MS) {
            continue;
          }
        }
        const dx = px - x;
        const dy = py - (row.y + GALLERY_TARGET_LIFT);
        const d2 = dx * dx + dy * dy;
        const radius = kind === 'plate' ? GALLERY_PLATE_RADIUS : GALLERY_DUCK_RADIUS;
        if (d2 > radius * radius) continue;
        if (kind === 'plate') {
          const bull = d2 <= GALLERY_BULLSEYE_RADIUS * GALLERY_BULLSEYE_RADIUS;
          return {
            kind: bull ? ('bullseye' as const) : ('plate' as const),
            value: row.value * (bull ? GALLERY_BULLSEYE_MULT : GALLERY_PLATE_MULT),
            row: r,
            index: i,
            wx: x,
            wy: row.y + GALLERY_TARGET_LIFT,
            wz: row.z,
          };
        }
        return {
          kind: 'duck' as const,
          value: row.value,
          row: r,
          index: i,
          wx: x,
          wy: row.y + GALLERY_TARGET_LIFT,
          wz: row.z,
        };
      }
    }
    const bx = galleryBonusX(schedule, t);
    if (bx !== null && hitAt.get(key(BONUS_ROW, 0)) === undefined) {
      const reach = cam.z - GALLERY_BONUS.z;
      const px = cam.x + sx * reach;
      const py = cam.y + sy * reach;
      const dx = px - bx;
      const dy = py - (GALLERY_BONUS.y + GALLERY_TARGET_LIFT);
      if (dx * dx + dy * dy <= GALLERY_BONUS.radius * GALLERY_BONUS.radius) {
        return {
          kind: 'bonus' as const,
          value: GALLERY_BONUS_VALUE,
          row: BONUS_ROW,
          index: 0,
          wx: bx,
          wy: GALLERY_BONUS.y + GALLERY_TARGET_LIFT,
          wz: GALLERY_BONUS.z,
        };
      }
    }
    return null;
  };

  const shoot = (sx: number, sy: number, t: number): GalleryShotOutcome => {
    if (t > GALLERY_ROUND_MS) return { type: 'ignored' };
    if (reloadUntil >= 0) {
      if (t < reloadUntil) return { type: 'reload-dead' };
      ammo = GALLERY_MAG_SIZE;
      reloadUntil = -1;
    }
    if (lastLiveShotT !== -Infinity && t - lastLiveShotT < GALLERY_MIN_SHOT_INTERVAL_MS) {
      return { type: 'ignored' };
    }
    lastLiveShotT = t;
    shotsFired += 1;
    ammo -= 1;
    if (ammo <= 0) {
      ammo = 0;
      reloadUntil = t + GALLERY_RELOAD_MS;
    }
    const target = resolve(sx, sy, t);
    if (!target) {
      const reach = GALLERY_CAMERA.z - GALLERY_BACKBOARD_Z;
      return {
        type: 'miss',
        ammo,
        reloading: reloadUntil >= 0,
        bx: GALLERY_CAMERA.x + sx * reach,
        by: GALLERY_CAMERA.y + sy * reach,
      };
    }
    score += target.value;
    hits += 1;
    if (target.kind === 'bullseye') bullseyes += 1;
    if (target.kind === 'bonus') bonusHit = true;
    hitAt.set(key(target.row, target.index), t);
    return { type: 'hit', ...target, ammo, reloading: reloadUntil >= 0 };
  };

  return {
    shoot,
    lastHitAt: (row, index) => hitAt.get(key(row, index)) ?? null,
    displayAmmo: (t) => (reloadUntil >= 0 && t < reloadUntil ? 0 : reloadUntil >= 0 ? GALLERY_MAG_SIZE : ammo),
    reloadFraction: (t) => {
      if (reloadUntil < 0) return 0;
      const left = reloadUntil - t;
      if (left <= 0) return 0;
      return Math.min(1, Math.max(0, 1 - left / GALLERY_RELOAD_MS));
    },
    get score() {
      return score;
    },
    get shotsFired() {
      return shotsFired;
    },
    get hits() {
      return hits;
    },
    get bullseyes() {
      return bullseyes;
    },
    get bonusHit() {
      return bonusHit;
    },
  };
}

export interface GalleryShot {
  x: number;
  y: number;
  t: number;
}

export interface GalleryRunResult {
  score: number;
  hits: number;
  shotsFired: number;
  dropped: number;
}

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Replay a shot list through the same scorer the client ran. Never throws. */
export function validateGalleryRun(
  seed: number,
  shots: readonly GalleryShot[],
  durationMs: number,
): GalleryRunResult {
  if (!Array.isArray(shots) || shots.length === 0) return { score: 0, hits: 0, shotsFired: 0, dropped: 0 };
  const scorer = createGalleryScorer(deriveGallerySchedule(seed));
  const windowMs =
    Number.isFinite(durationMs) && durationMs > 0
      ? Math.min(GALLERY_MAX_SHOT_T_MS, durationMs + 1_500)
      : GALLERY_MAX_SHOT_T_MS;
  const clean = shots
    .slice(0, GALLERY_MAX_SHOTS)
    .filter((s): s is GalleryShot => !!s && isFiniteNum(s.x) && isFiniteNum(s.y) && isFiniteNum(s.t))
    .sort((a, b) => a.t - b.t);
  let dropped = shots.length - clean.length;
  for (const shot of clean) {
    const t = Math.floor(shot.t);
    // A slope past 2 is outside any camera the client can build.
    if (t < 0 || t > windowMs || Math.abs(shot.x) > 2 || Math.abs(shot.y) > 2) {
      dropped += 1;
      continue;
    }
    scorer.shoot(shot.x, shot.y, t);
  }
  return { score: scorer.score, hits: scorer.hits, shotsFired: scorer.shotsFired, dropped };
}
