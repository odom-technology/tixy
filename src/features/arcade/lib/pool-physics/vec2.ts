// ---------------------------------------------------------------------------
// Pure 2D vector math. No mutation — all functions return new objects.
// ---------------------------------------------------------------------------

import type { Vec2 } from './types';

const _vec2 = (x: number, y: number): Vec2 => ({ x, y });

const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

const scale = (v: Vec2, s: number): Vec2 => ({ x: v.x * s, y: v.y * s });

const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;

const lengthSq = (v: Vec2): number => v.x * v.x + v.y * v.y;

const length = (v: Vec2): number => Math.sqrt(lengthSq(v));

export const normalize = (v: Vec2): Vec2 => {
  const len = length(v);
  return len > 0 ? { x: v.x / len, y: v.y / len } : { x: 0, y: 0 };
};

export const distance = (a: Vec2, b: Vec2): number => length(sub(a, b));

const _distanceSq = (a: Vec2, b: Vec2): number => lengthSq(sub(a, b));

/** Reflect vector `v` about a unit normal `n`. */
const _reflect = (v: Vec2, n: Vec2): Vec2 => {
  const d = 2 * dot(v, n);
  return { x: v.x - d * n.x, y: v.y - d * n.y };
};

/** Rotate vector by angle (radians). */
const _rotate = (v: Vec2, angle: number): Vec2 => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
};

/** Linearly interpolate between two vectors. */
const _lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/** Clamp vector components within bounds. */
const _clamp = (v: Vec2, min: Vec2, max: Vec2): Vec2 => ({
  x: Math.max(min.x, Math.min(max.x, v.x)),
  y: Math.max(min.y, Math.min(max.y, v.y)),
});

/**
 * Perpendicular distance from point `p` to line segment `a→b`.
 * Returns the distance and the closest point on the segment.
 */
export const pointToSegment = (
  p: Vec2,
  a: Vec2,
  b: Vec2,
): { distance: number; closest: Vec2; t: number } => {
  const ab = sub(b, a);
  const ap = sub(p, a);
  const abLenSq = lengthSq(ab);
  if (abLenSq === 0) {
    const d = distance(p, a);
    return { distance: d, closest: a, t: 0 };
  }
  let t = dot(ap, ab) / abLenSq;
  t = Math.max(0, Math.min(1, t));
  const closest = add(a, scale(ab, t));
  return { distance: distance(p, closest), closest, t };
};
