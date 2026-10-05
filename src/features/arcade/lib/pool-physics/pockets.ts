// fallow-ignore-file unused-file — actively used via re-exports in index.ts
// ---------------------------------------------------------------------------
// Pocket jaw/throat geometry for 8-ball pool.
//
// Each pocket has:
//   - center: the visual pocket center (used for animations, rendering)
//   - throat: a smaller circle where the ball is actually pocketed
//   - jaws: two short angled segments that form the pocket mouth
//   - zone: a radius around the pocket where jaw collision replaces main cushion
//
// Balls can rattle off jaws, be rejected at steep angles, or pocket cleanly.
// ---------------------------------------------------------------------------

import type { Vec2 } from './types';
import {
  TABLE_WIDTH,
  TABLE_HEIGHT,
  PLAYING_SURFACE_WIDTH,
  CUSHION_WIDTH,
  BALL_DIAMETER,
  BALL_RADIUS,
  POCKETS,
} from './constants';

// ── Jaw/throat constants ─────────────────────────────────────────────────

/** Throat radius for corner pockets (actual pocketing zone). */
export const CORNER_THROAT_RADIUS = BALL_DIAMETER * 1.0;

/** Throat radius for side pockets (most forgiving on a real table). */
export const SIDE_THROAT_RADIUS = BALL_DIAMETER * 1.15;

/** Jaw coefficient of restitution (pocket edges absorb more energy). */
const JAW_COR = 0.6;

/** Pocket zone radius — area where jaw collision replaces main cushion. */
// fallow-ignore-next-line unused-export
export const POCKET_ZONE_RADIUS = BALL_DIAMETER * 1.65;

const OFFICIAL_PLAYING_SURFACE_WIDTH_IN = 100;
const OFFICIAL_CORNER_MOUTH_IN = 4.5625; // WPA range midpoint: 4.5-4.625
const OFFICIAL_SIDE_MOUTH_IN = 5.0625; // WPA range midpoint: 5.0-5.125
const PX_PER_IN = PLAYING_SURFACE_WIDTH / OFFICIAL_PLAYING_SURFACE_WIDTH_IN;

/** Corner pocket mouth half-opening along each rail (WPA-scaled). */
export const CORNER_MOUTH_HALF = (OFFICIAL_CORNER_MOUTH_IN * PX_PER_IN) / 2;

/** Side pocket mouth half-opening along each rail (WPA-scaled). */
export const SIDE_MOUTH_HALF = (OFFICIAL_SIDE_MOUTH_IN * PX_PER_IN) / 2;

// ── Types ────────────────────────────────────────────────────────────────

export type JawSegment = {
  a: Vec2; // outer end (where rail breaks)
  b: Vec2; // inner end (jaw tip, near pocket)
  /** Outward-facing unit normal (points into the table, away from pocket). */
  normal: Vec2;
};

export type PocketGeometry = {
  center: Vec2;
  throatRadius: number;
  zoneRadius: number;
  jaws: [JawSegment, JawSegment];
  type: 'corner' | 'side';
};

// ── Geometry helpers ─────────────────────────────────────────────────────

function computeOutwardNormal(a: Vec2, b: Vec2, pocketCenter: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return { x: 0, y: 0 };
  // Two candidate normals
  const n1 = { x: -dy / len, y: dx / len };
  const n2 = { x: dy / len, y: -dx / len };
  // Pick the one pointing AWAY from pocket center
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  const toPocketX = pocketCenter.x - midX;
  const toPocketY = pocketCenter.y - midY;
  const dot1 = n1.x * toPocketX + n1.y * toPocketY;
  return dot1 < 0 ? n1 : n2; // Pick normal facing away from pocket
}

function makeJaw(a: Vec2, b: Vec2, center: Vec2): JawSegment {
  return { a, b, normal: computeOutwardNormal(a, b, center) };
}

// ── Build all 6 pocket geometries ────────────────────────────────────────

let _cachedGeometries: PocketGeometry[] | null = null;

export function getPocketGeometries(): PocketGeometry[] {
  if (_cachedGeometries) return _cachedGeometries;

  const CW = CUSHION_WIDTH;
  const [tl, ts, tr, bl, bs, br] = POCKETS;

  // Mouth half-openings along cushion noses.
  const CM = CORNER_MOUTH_HALF;
  const SM = SIDE_MOUTH_HALF;
  const cornerTipLong = BALL_DIAMETER * 0.63;
  const cornerTipShort = BALL_DIAMETER * 0.47;
  const sideTipX = BALL_DIAMETER * 0.42;
  const sideTipY = BALL_DIAMETER * 0.16;

  const geoms: PocketGeometry[] = [
    // ── Top-left corner ───────────────────────────────────
    {
      center: { x: tl.x, y: tl.y },
      throatRadius: CORNER_THROAT_RADIUS,
      zoneRadius: POCKET_ZONE_RADIUS,
      type: 'corner',
      jaws: [
        makeJaw(
          { x: CW, y: tl.y + CM },
          { x: tl.x - cornerTipLong, y: tl.y + cornerTipShort },
          { x: tl.x, y: tl.y },
        ),
        makeJaw(
          { x: tl.x + CM, y: CW },
          { x: tl.x + cornerTipShort, y: tl.y - cornerTipLong },
          { x: tl.x, y: tl.y },
        ),
      ],
    },
    // ── Top-center side ───────────────────────────────────
    {
      center: { x: ts.x, y: ts.y },
      throatRadius: SIDE_THROAT_RADIUS,
      zoneRadius: POCKET_ZONE_RADIUS,
      type: 'side',
      jaws: [
        makeJaw(
          { x: ts.x - SM, y: CW },
          { x: ts.x - SM + sideTipX, y: ts.y - sideTipY },
          { x: ts.x, y: ts.y },
        ),
        makeJaw(
          { x: ts.x + SM, y: CW },
          { x: ts.x + SM - sideTipX, y: ts.y - sideTipY },
          { x: ts.x, y: ts.y },
        ),
      ],
    },
    // ── Top-right corner ──────────────────────────────────
    {
      center: { x: tr.x, y: tr.y },
      throatRadius: CORNER_THROAT_RADIUS,
      zoneRadius: POCKET_ZONE_RADIUS,
      type: 'corner',
      jaws: [
        makeJaw(
          { x: tr.x - CM, y: CW },
          { x: tr.x - cornerTipShort, y: tr.y - cornerTipLong },
          { x: tr.x, y: tr.y },
        ),
        makeJaw(
          { x: TABLE_WIDTH - CW, y: tr.y + CM },
          { x: tr.x + cornerTipLong, y: tr.y + cornerTipShort },
          { x: tr.x, y: tr.y },
        ),
      ],
    },
    // ── Bottom-left corner ────────────────────────────────
    {
      center: { x: bl.x, y: bl.y },
      throatRadius: CORNER_THROAT_RADIUS,
      zoneRadius: POCKET_ZONE_RADIUS,
      type: 'corner',
      jaws: [
        makeJaw(
          { x: CW, y: bl.y - CM },
          { x: bl.x - cornerTipLong, y: bl.y - cornerTipShort },
          { x: bl.x, y: bl.y },
        ),
        makeJaw(
          { x: bl.x + CM, y: TABLE_HEIGHT - CW },
          { x: bl.x + cornerTipShort, y: bl.y + cornerTipLong },
          { x: bl.x, y: bl.y },
        ),
      ],
    },
    // ── Bottom-center side ────────────────────────────────
    {
      center: { x: bs.x, y: bs.y },
      throatRadius: SIDE_THROAT_RADIUS,
      zoneRadius: POCKET_ZONE_RADIUS,
      type: 'side',
      jaws: [
        makeJaw(
          { x: bs.x - SM, y: TABLE_HEIGHT - CW },
          { x: bs.x - SM + sideTipX, y: bs.y + sideTipY },
          { x: bs.x, y: bs.y },
        ),
        makeJaw(
          { x: bs.x + SM, y: TABLE_HEIGHT - CW },
          { x: bs.x + SM - sideTipX, y: bs.y + sideTipY },
          { x: bs.x, y: bs.y },
        ),
      ],
    },
    // ── Bottom-right corner ───────────────────────────────
    {
      center: { x: br.x, y: br.y },
      throatRadius: CORNER_THROAT_RADIUS,
      zoneRadius: POCKET_ZONE_RADIUS,
      type: 'corner',
      jaws: [
        makeJaw(
          { x: TABLE_WIDTH - CW, y: br.y - CM },
          { x: br.x + cornerTipLong, y: br.y - cornerTipShort },
          { x: br.x, y: br.y },
        ),
        makeJaw(
          { x: br.x - CM, y: TABLE_HEIGHT - CW },
          { x: br.x - cornerTipShort, y: br.y + cornerTipLong },
          { x: br.x, y: br.y },
        ),
      ],
    },
  ];

  _cachedGeometries = geoms;
  return geoms;
}

// ── Collision / detection functions ──────────────────────────────────────

/** Check if a position is within ANY pocket's zone (where jaw logic applies). */
export function isInPocketZone(pos: Vec2): boolean {
  for (const pg of getPocketGeometries()) {
    const dx = pos.x - pg.center.x;
    const dy = pos.y - pg.center.y;
    if (dx * dx + dy * dy <= pg.zoneRadius * pg.zoneRadius) return true;
  }
  return false;
}

/** Check if ball center is in a pocket throat (= pocketed). */
export function isInThroat(pos: Vec2): boolean {
  for (const pg of getPocketGeometries()) {
    const dx = pos.x - pg.center.x;
    const dy = pos.y - pg.center.y;
    if (dx * dx + dy * dy <= pg.throatRadius * pg.throatRadius) return true;
  }
  return false;
}

/** Returns the pocket index (0-5) the position is inside, or -1. */
export function getPocketIndex(pos: Vec2): number {
  const geoms = getPocketGeometries();
  for (let i = 0; i < geoms.length; i++) {
    const pg = geoms[i]!;
    const dx = pos.x - pg.center.x;
    const dy = pos.y - pg.center.y;
    if (dx * dx + dy * dy <= pg.throatRadius * pg.throatRadius) return i;
  }
  return -1;
}

/**
 * Resolve ball collision against jaw segments near pockets.
 * Returns true if a jaw was hit. Modifies ball velocity and position.
 */
export function resolveJawCollision(ball: { pos: Vec2; vel: Vec2 }): boolean {
  let hit = false;

  for (const pg of getPocketGeometries()) {
    const dx = ball.pos.x - pg.center.x;
    const dy = ball.pos.y - pg.center.y;
    const distSq = dx * dx + dy * dy;

    // Only check jaws when ball is in the pocket zone but NOT in the throat
    if (distSq > pg.zoneRadius * pg.zoneRadius) continue;
    if (distSq <= pg.throatRadius * pg.throatRadius) continue;

    for (const jaw of pg.jaws) {
      // Point-to-segment distance
      const abx = jaw.b.x - jaw.a.x;
      const aby = jaw.b.y - jaw.a.y;
      const apx = ball.pos.x - jaw.a.x;
      const apy = ball.pos.y - jaw.a.y;
      const ab2 = abx * abx + aby * aby;
      if (ab2 === 0) continue;

      const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
      const closestX = jaw.a.x + t * abx;
      const closestY = jaw.a.y + t * aby;
      const cdx = ball.pos.x - closestX;
      const cdy = ball.pos.y - closestY;
      const cDistSq = cdx * cdx + cdy * cdy;

      if (cDistSq >= BALL_RADIUS * BALL_RADIUS) continue;
      if (cDistSq === 0) continue;

      const cDist = Math.sqrt(cDistSq);

      // Collision normal (from segment toward ball)
      const nx = cdx / cDist;
      const ny = cdy / cDist;

      // Only resolve if ball is moving toward the jaw
      const vn = ball.vel.x * nx + ball.vel.y * ny;
      if (vn >= 0) continue; // Moving away

      // Reflect velocity with jaw COR (lower than regular cushion)
      ball.vel.x -= (1 + JAW_COR) * vn * nx;
      ball.vel.y -= (1 + JAW_COR) * vn * ny;

      // Separate: push ball out to BALL_RADIUS from segment
      const overlap = BALL_RADIUS - cDist;
      if (overlap > 0) {
        ball.pos.x += nx * (overlap + 0.1);
        ball.pos.y += ny * (overlap + 0.1);
      }

      hit = true;
    }
  }

  return hit;
}

/**
 * Check if a position is between the jaw outer endpoints of any pocket
 * (i.e., in the pocket mouth opening). If so, the ball should NOT get
 * regular cushion collision — it's entering a pocket.
 *
 * Returns true if position is inside any pocket mouth (the opening).
 * Used to prevent a ball that just left the pocket
 * along the rail from being treated as entering the pocket mouth.
 */
export function isInPocketMouth(pos: Vec2): boolean {
  for (const pg of getPocketGeometries()) {
    const dx = pos.x - pg.center.x;
    const dy = pos.y - pg.center.y;
    const distSq = dx * dx + dy * dy;
    if (distSq > pg.zoneRadius * pg.zoneRadius) continue;

    // Check if the position is between the two jaw outer endpoints.
    // The mouth is the gap between jaw[0].a and jaw[1].a (the outer/rail ends).
    const ja = pg.jaws[0].a;
    const jb = pg.jaws[1].a;

    if (pg.type === 'side') {
      // Side pocket: mouth is horizontal (along x-axis between ja.x and jb.x).
      // Any ball inside the zone AND between the jaw endpoints is in the mouth.
      // This is intentionally broad — the zone IS the pocket opening area.
      // Rail runners are handled separately via velocity checks in the
      // simulation substep (see simulation.ts).
      const minX = Math.min(ja.x, jb.x);
      const maxX = Math.max(ja.x, jb.x);
      if (pos.x >= minX && pos.x <= maxX) return true;
    } else {
      // Corner pocket: mouth is diagonal. Check if ball is inside the triangle
      // formed by the pocket center and both jaw outer points.
      // Use cross-product signs to determine if point is on the same side
      // of both edges from center → jaw outer endpoints.
      const cx = pg.center.x;
      const cy = pg.center.y;
      const cross1 = (ja.x - cx) * (pos.y - cy) - (ja.y - cy) * (pos.x - cx);
      const cross2 = (jb.x - cx) * (pos.y - cy) - (jb.y - cy) * (pos.x - cx);
      // If cross products have opposite signs, point is between the two jaw arms
      if (cross1 * cross2 <= 0) return true;
    }
  }
  return false;
}

/** Find the nearest pocket center to a given position. */
function _nearestPocketCenter(pos: Vec2): Vec2 {
  const geoms = getPocketGeometries();
  let best = geoms[0].center;
  let bestDist = Infinity;
  for (const pg of geoms) {
    const dx = pos.x - pg.center.x;
    const dy = pos.y - pg.center.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = pg.center;
    }
  }
  return best;
}
