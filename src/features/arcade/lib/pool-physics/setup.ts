// fallow-ignore-file unused-file — actively used via re-exports in index.ts
// ---------------------------------------------------------------------------
// Initial ball placement for 8-ball pool.
// Positions match henshmi/Classic-8-Ball-Pool reference.
// ---------------------------------------------------------------------------

import type { Ball, Vec2 } from './types';
import { isInPocketZone } from './pockets';
import {
  BALL_DIAMETER,
  BALL_RADIUS,
  CUSHION_WIDTH,
  TABLE_WIDTH,
  TABLE_HEIGHT,
  CUE_BALL_START,
  FOOT_SPOT,
  HEAD_STRING_X,
} from './constants';

const ZERO: Vec2 = { x: 0, y: 0 };

// Rack triangle positions — 5 rows, tightly packed
// Row spacing = BALL_DIAMETER * cos(30°) = BALL_DIAMETER * sqrt(3)/2
function computeRackPositions(apex: Vec2): Vec2[] {
  const rowSpacing = (BALL_DIAMETER * Math.sqrt(3)) / 2;
  const positions: Vec2[] = [];

  for (let row = 0; row < 5; row++) {
    const count = row + 1;
    const rowX = apex.x + row * rowSpacing;
    const startY = apex.y - row * (BALL_DIAMETER / 2);
    for (let col = 0; col < count; col++) {
      positions.push({
        x: Math.round(rowX * 10) / 10,
        y: Math.round((startY + col * BALL_DIAMETER) * 10) / 10,
      });
    }
  }

  return positions;
}

/**
 * Creates the standard 8-ball break rack.
 *
 * Ball IDs: 0=cue, 1-7=solids, 8=eight, 9-15=stripes.
 *
 * Rules:
 * - 8-ball must be in center of row 3 (position index 4)
 * - Back row corners (indices 10, 14) must be one solid + one stripe
 * - All other positions randomized
 */
export function createBreakRack(): Ball[] {
  const balls: Ball[] = [];

  // Cue ball
  balls.push({
    id: 0,
    pos: { ...CUE_BALL_START },
    vel: { ...ZERO },
    pocketed: false,
  });

  // WPA: rack apex sits on the foot spot.
  const positions = computeRackPositions({ x: FOOT_SPOT.x, y: FOOT_SPOT.y });

  // Assign ball IDs: 8-ball at center (index 4)
  // Back row corners (10, 14): one solid + one stripe
  // All other positions randomized for variety
  const assignment: (number | null)[] = new Array(15).fill(null);
  assignment[4] = 8;

  const solids = [1, 2, 3, 4, 5, 6, 7];
  const stripes = [9, 10, 11, 12, 13, 14, 15];

  // Shuffle both arrays
  for (let i = solids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [solids[i], solids[j]] = [solids[j], solids[i]];
  }
  for (let i = stripes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [stripes[i], stripes[j]] = [stripes[j], stripes[i]];
  }

  // Back row corners: one solid, one stripe (random which corner)
  if (Math.random() < 0.5) {
    assignment[10] = solids.shift()!;
    assignment[14] = stripes.shift()!;
  } else {
    assignment[10] = stripes.shift()!;
    assignment[14] = solids.shift()!;
  }

  // Fill remaining positions randomly
  const remaining = [...solids, ...stripes];
  for (let i = remaining.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
  }

  let fillIdx = 0;
  for (let i = 0; i < 15; i++) {
    if (assignment[i] === null) {
      assignment[i] = remaining[fillIdx++];
    }
  }

  for (let i = 0; i < 15; i++) {
    balls.push({
      id: assignment[i]!,
      pos: { ...positions[i] },
      vel: { ...ZERO },
      pocketed: false,
    });
  }

  return balls;
}

/**
 * Check if a cue ball placement is valid.
 */
export function isValidCuePlacement(
  pos: Vec2,
  balls: Ball[],
  options?: { behindHeadString?: boolean },
): boolean {
  const minX = CUSHION_WIDTH + BALL_RADIUS;
  const maxX = TABLE_WIDTH - CUSHION_WIDTH - BALL_RADIUS;
  const minY = CUSHION_WIDTH + BALL_RADIUS;
  const maxY = TABLE_HEIGHT - CUSHION_WIDTH - BALL_RADIUS;

  if (pos.x < minX || pos.x > maxX || pos.y < minY || pos.y > maxY) {
    return false;
  }

  if (options?.behindHeadString && pos.x > HEAD_STRING_X) {
    return false;
  }

  // Must not be inside a pocket zone (throat + jaw area)
  if (isInPocketZone(pos)) return false;

  // Must not overlap any active ball
  for (const ball of balls) {
    if (ball.id === 0 || ball.pocketed) continue;
    const dx = pos.x - ball.pos.x;
    const dy = pos.y - ball.pos.y;
    if (Math.sqrt(dx * dx + dy * dy) < BALL_DIAMETER + 1) {
      return false;
    }
  }

  return true;
}

/**
 * Re-spot the 8-ball at the foot spot.
 */
export function respotEightBall(balls: Ball[]): void {
  const eight = balls.find((b) => b.id === 8);
  if (!eight) return;

  eight.pocketed = false;
  eight.vel = { x: 0, y: 0 };

  const footX = FOOT_SPOT.x;
  const footY = FOOT_SPOT.y;
  const spot = { x: footX, y: footY };

  const isOccupied = balls.some(
    (b) =>
      b.id !== 8 &&
      !b.pocketed &&
      Math.sqrt((b.pos.x - spot.x) ** 2 + (b.pos.y - spot.y) ** 2) <
        BALL_DIAMETER + 1,
  );

  if (!isOccupied) {
    eight.pos = spot;
    return;
  }

  // Scan right from foot spot for a free position
  for (
    let offset = BALL_DIAMETER;
    offset < TABLE_WIDTH / 2;
    offset += BALL_RADIUS
  ) {
    const candidate = { x: footX + offset, y: footY };
    if (candidate.x > TABLE_WIDTH - CUSHION_WIDTH - BALL_RADIUS) break;
    const taken = balls.some(
      (b) =>
        b.id !== 8 &&
        !b.pocketed &&
        Math.sqrt((b.pos.x - candidate.x) ** 2 + (b.pos.y - candidate.y) ** 2) <
          BALL_DIAMETER + 1,
    );
    if (!taken) {
      eight.pos = candidate;
      return;
    }
  }

  // Scan left from foot spot if rightward scan failed
  for (
    let offset = BALL_DIAMETER;
    offset < TABLE_WIDTH / 2;
    offset += BALL_RADIUS
  ) {
    const candidate = { x: footX - offset, y: footY };
    if (candidate.x < CUSHION_WIDTH + BALL_RADIUS) break;
    const taken = balls.some(
      (b) =>
        b.id !== 8 &&
        !b.pocketed &&
        Math.sqrt((b.pos.x - candidate.x) ** 2 + (b.pos.y - candidate.y) ** 2) <
          BALL_DIAMETER + 1,
    );
    if (!taken) {
      eight.pos = candidate;
      return;
    }
  }

  // Last resort — foot spot (extremely unlikely to be fully blocked both ways)
  eight.pos = spot;
}
