import { NextResponse } from 'next/server';
import { simulateShot, createBreakRack, type Ball, type ShotInput } from '@/features/arcade/lib/pool-physics';
import {
  TABLE_WIDTH, TABLE_HEIGHT, BALL_RADIUS, BALL_DIAMETER,
  CUSHION_WIDTH, POCKETS,
} from '@/features/arcade/lib/pool-physics/constants';

/**
 * DEV-ONLY: Physics validation suite.
 * Hit GET /api/dev/test-pool-physics to run all tests.
 */

const IS_DEV = process.env.NODE_ENV !== 'production';

function pathDistance(frames: { id: number; x: number; y: number }[][], ballId: number): number {
  let total = 0;
  let prev: { x: number; y: number } | null = null;
  for (const frame of frames) {
    const ball = frame.find((entry) => entry.id === ballId);
    if (!ball) break;
    if (prev) {
      total += Math.sqrt((ball.x - prev.x) ** 2 + (ball.y - prev.y) ** 2);
    }
    prev = { x: ball.x, y: ball.y };
  }
  return total;
}

function findRailBounceRetention(frames: { id: number; x: number; y: number }[][], ballId: number): number | null {
  const path = frames
    .map((frame) => frame.find((entry) => entry.id === ballId))
    .filter((entry): entry is { id: number; x: number; y: number } => Boolean(entry));

  for (let i = 2; i < path.length; i++) {
    const prevDx = path[i - 1].x - path[i - 2].x;
    const currDx = path[i].x - path[i - 1].x;
    if (prevDx > 0.01 && currDx < -0.01) {
      const before = Math.abs(path[i - 1].x - path[i - 2].x);
      const afterOne = Math.abs(path[i].x - path[i - 1].x);
      const afterTwo = i + 1 < path.length ? Math.abs(path[i + 1].x - path[i].x) : afterOne;
      return ((afterOne + afterTwo) / 2) / before;
    }
  }

  return null;
}

function singleBall(x: number, y: number): Ball[] {
  return [{ id: 0, pos: { x, y }, vel: { x: 0, y: 0 }, pocketed: false }];
}

function twoBalls(x1: number, y1: number, x2: number, y2: number): Ball[] {
  return [
    { id: 0, pos: { x: x1, y: y1 }, vel: { x: 0, y: 0 }, pocketed: false },
    { id: 1, pos: { x: x2, y: y2 }, vel: { x: 0, y: 0 }, pocketed: false },
  ];
}

type TestResult = { name: string; pass: boolean; detail?: string };

export async function GET() {
  if (!IS_DEV) {
    return NextResponse.json({ error: 'Not available in production.' }, { status: 403 });
  }

  const results: TestResult[] = [];
  const t = (pass: boolean, name: string, detail?: string) => {
    results.push({ name, pass, detail });
  };

  // Test 1: Break scatter
  {
    const balls = createBreakRack();
    // Copy positions to compare later (rack is randomized)
    const origPositions = balls.map(b => ({ id: b.id, x: b.pos.x, y: b.pos.y }));
    const r = simulateShot(balls, { angle: 0, power: 1.0, cuePosition: null });
    const moved = r.finalBalls.filter(b => {
      const o = origPositions.find(ob => ob.id === b.id)!;
      return Math.abs(b.pos.x - o.x) > 1 || Math.abs(b.pos.y - o.y) > 1;
    });
    t(moved.length >= 10, 'Break scatters 10+ balls', `${moved.length} moved`);
    t(r.totalFrames > 30 && r.totalFrames < 600, 'Break completes in reasonable time', `${r.totalFrames} frames`);

    const oob = r.finalBalls.filter(b => !b.pocketed && (
      b.pos.x < CUSHION_WIDTH || b.pos.x > TABLE_WIDTH - CUSHION_WIDTH ||
      b.pos.y < CUSHION_WIDTH || b.pos.y > TABLE_HEIGHT - CUSHION_WIDTH
    ));
    t(oob.length === 0, 'No balls out of bounds after break', `${oob.length} out`);
  }

  // Test 2: Ball comes to rest
  {
    const r = simulateShot(singleBall(400, 400), { angle: 0, power: 0.5, cuePosition: null });
    const c = r.finalBalls[0];
    t(c.vel.x === 0 && c.vel.y === 0, 'Ball velocity is zero at rest');
    t(r.totalFrames > 20 && r.totalFrames < 400, 'Ball stops in reasonable time', `${r.totalFrames} frames`);
  }

  // Test 3: Cushion bounce stays in bounds
  {
    const r = simulateShot(singleBall(400, TABLE_HEIGHT / 2), { angle: 0, power: 0.7, cuePosition: null });
    const c = r.finalBalls[0];
    t(!c.pocketed, 'Ball not pocketed from cushion bounce');
    t(c.pos.x > CUSHION_WIDTH + BALL_RADIUS && c.pos.x < TABLE_WIDTH - CUSHION_WIDTH,
      'Ball within bounds after bounce', `x=${Math.round(c.pos.x)}`);
  }

  // Test 4: Cushion energy loss
  {
    const r = simulateShot(
      singleBall(TABLE_WIDTH - 200, TABLE_HEIGHT / 2),
      { angle: 0, power: 0.6, cuePosition: null },
    );
    const retention = findRailBounceRetention(r.frames, 0);
    t(retention !== null, 'Ball visibly bounced off the cushion');
    t(r.totalFrames < 500, 'Cushion bounce settles in reasonable time', `${r.totalFrames} frames`);
  }

  // Test 5: Head-on collision
  {
    const r = simulateShot(
      twoBalls(300, TABLE_HEIGHT / 2, 300 + BALL_DIAMETER * 3, TABLE_HEIGHT / 2),
      { angle: 0, power: 0.5, cuePosition: null },
    );
    const target = r.finalBalls.find(b => b.id === 1)!;
    t(target.pos.x > 500, 'Target moves forward on head-on hit', `x=${Math.round(target.pos.x)}`);
  }

  // Test 6: No tunneling at max power
  {
    const r = simulateShot(
      twoBalls(300, TABLE_HEIGHT / 2, 300 + BALL_DIAMETER + 5, TABLE_HEIGHT / 2),
      { angle: 0, power: 1.0, cuePosition: null },
    );
    t(r.firstContactBallId === 1, 'No tunneling at max power — contact detected');
  }

  // Test 7: Corner pocket detection
  {
    const p = POCKETS[0];
    const balls: Ball[] = [
      { id: 0, pos: { x: p.x + 50, y: p.y + 50 }, vel: { x: 0, y: 0 }, pocketed: false },
    ];
    const angle = Math.atan2(p.y - balls[0].pos.y, p.x - balls[0].pos.x);
    const r = simulateShot(balls, { angle, power: 0.3, cuePosition: null });
    t(r.pocketedBallIds.includes(0), 'Corner pocket detection works');
    t(r.scratch, 'Scratch detected on cue ball pocket');
  }

  // Test 8: Side pocket detection
  {
    const p = POCKETS[1];
    const balls: Ball[] = [
      { id: 0, pos: { x: p.x, y: p.y + 80 }, vel: { x: 0, y: 0 }, pocketed: false },
    ];
    const r = simulateShot(balls, { angle: -Math.PI / 2, power: 0.3, cuePosition: null });
    t(r.pocketedBallIds.includes(0), 'Side pocket detection works');
  }

  // Test 9: Cluster collision — no overlaps
  {
    const balls: Ball[] = [
      { id: 0, pos: { x: 200, y: TABLE_HEIGHT / 2 }, vel: { x: 0, y: 0 }, pocketed: false },
      { id: 1, pos: { x: 400, y: TABLE_HEIGHT / 2 - BALL_RADIUS }, vel: { x: 0, y: 0 }, pocketed: false },
      { id: 2, pos: { x: 400, y: TABLE_HEIGHT / 2 + BALL_RADIUS }, vel: { x: 0, y: 0 }, pocketed: false },
      { id: 3, pos: { x: 400 + BALL_DIAMETER, y: TABLE_HEIGHT / 2 }, vel: { x: 0, y: 0 }, pocketed: false },
    ];
    const r = simulateShot(balls, { angle: 0, power: 0.6, cuePosition: null });
    const active = r.finalBalls.filter(b => !b.pocketed);
    let overlaps = 0;
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const dx = active[i].pos.x - active[j].pos.x;
        const dy = active[i].pos.y - active[j].pos.y;
        if (Math.sqrt(dx * dx + dy * dy) < BALL_DIAMETER - 1) overlaps++;
      }
    }
    t(overlaps === 0, 'No overlapping balls after cluster collision', `${overlaps} overlaps`);
  }

  // Test 10: Power proportionality
  {
    const r1 = simulateShot(singleBall(400, TABLE_HEIGHT / 2), { angle: 0, power: 0.2, cuePosition: null });
    const r2 = simulateShot(singleBall(400, TABLE_HEIGHT / 2), { angle: 0, power: 0.8, cuePosition: null });
    const d1 = pathDistance(r1.frames, 0);
    const d2 = pathDistance(r2.frames, 0);
    t(d2 > d1 * 2, 'Higher power = further travel', `20%: ${Math.round(d1)}, 80%: ${Math.round(d2)}`);
  }

  // Test 11: Determinism
  {
    const balls1 = createBreakRack();
    const balls2 = balls1.map(b => ({ ...b, pos: { ...b.pos }, vel: { ...b.vel } }));
    const input: ShotInput = { angle: 0.1, power: 0.85, cuePosition: null };
    const r1 = simulateShot(balls1, input);
    const r2 = simulateShot(balls2, input);
    let identical = true;
    for (let i = 0; i < r1.finalBalls.length; i++) {
      if (Math.abs(r1.finalBalls[i].pos.x - r2.finalBalls[i].pos.x) > 0.01) identical = false;
    }
    t(identical, 'Deterministic — same input = same output');
  }

  // Test 12: Max power at cushion
  {
    const r = simulateShot(
      singleBall(TABLE_WIDTH / 2, TABLE_HEIGHT / 2),
      { angle: 0, power: 1.0, cuePosition: null },
    );
    const c = r.finalBalls[0];
    t(!c.pocketed && c.pos.x > CUSHION_WIDTH + BALL_RADIUS,
      'Max power cushion bounce — ball stays in bounds');
  }

  // Test 13: Ball-in-hand placement
  {
    const balls = createBreakRack();
    const r = simulateShot(balls, { angle: 0, power: 0.3, cuePosition: { x: 300, y: 300 } });
    const firstFrame = r.frames[0];
    const cueFrame = firstFrame.find(f => f.id === 0);
    t(cueFrame !== undefined && Math.abs(cueFrame.x - 300) < 2,
      'Ball-in-hand placement works', `cue at x=${cueFrame?.x}`);
  }

  // Test 14: Animation frame quality
  {
    const balls = createBreakRack();
    const r = simulateShot(balls, { angle: 0, power: 0.9, cuePosition: null });
    t(r.frames.length >= 50, 'Enough frames for smooth animation', `${r.frames.length} frames`);
    const lastFrame = r.frames[r.frames.length - 1];
    const activeFinal = r.finalBalls.filter(b => !b.pocketed);
    t(lastFrame.length === activeFinal.length, 'Last frame matches final state');
  }

  // Test 15: Performance — simulate 10 break shots and measure time
  {
    const start = performance.now();
    for (let i = 0; i < 10; i++) {
      const balls = createBreakRack();
      simulateShot(balls, { angle: i * 0.1, power: 0.9, cuePosition: null });
    }
    const elapsed = performance.now() - start;
    t(elapsed < 2000, 'Performance: 10 break shots in < 2s', `${Math.round(elapsed)}ms`);
    t(elapsed < 500, 'Performance: 10 break shots in < 500ms (target)', `${Math.round(elapsed)}ms`);
  }

  const passCount = results.filter(r => r.pass).length;
  const failCount = results.filter(r => !r.pass).length;

  return NextResponse.json({
    summary: `${passCount} passed, ${failCount} failed out of ${results.length} tests`,
    allPassed: failCount === 0,
    results,
  });
}
