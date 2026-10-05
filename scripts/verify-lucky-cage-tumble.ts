import assert from 'node:assert/strict';

import {
  createTumbleState,
  stepTumble,
  type TumbleState,
} from '../src/app/(games)/lucky-cage/_lucky-cage-tumble';

const COUNT = 20;
const DRUM_RADIUS = 0.48;
const DRUM_HALF_LENGTH = 0.31;
const BALL_RADIUS = 0.055;
const EPSILON = 1e-12;

function assertContained(state: TumbleState): void {
  const axialLimit = state.drumHalfLength - state.ballRadius;
  const radialLimit = state.drumRadius - state.ballRadius;
  const radialLimit2 = radialLimit * radialLimit;

  for (const ball of state.balls) {
    if (ball.released) continue;
    assert.ok(
      [ball.x, ball.y, ball.z, ball.vx, ball.vy, ball.vz].every(Number.isFinite),
      `ball ${ball.n} has non-finite state`,
    );
    assert.ok(
      Math.abs(ball.x) <= axialLimit + EPSILON,
      `ball ${ball.n} crossed an end cap: ${ball.x}`,
    );
    assert.ok(
      ball.y * ball.y + ball.z * ball.z <= radialLimit2 + EPSILON,
      `ball ${ball.n} crossed the radial wall`,
    );
  }
}

function simulate(spin: number, seed: number): TumbleState {
  const state = createTumbleState(
    COUNT,
    DRUM_RADIUS,
    DRUM_HALF_LENGTH,
    BALL_RADIUS,
    seed,
  );
  for (let i = 0; i < 12_000; i += 1) {
    stepTumble(state, 1 / 120, spin);
    assertContained(state);
  }
  return state;
}

for (const spin of [0, 1.5, 4.8, -3.2, 8, 9.2]) {
  const first = simulate(spin, 0x1e55);
  const second = simulate(spin, 0x1e55);
  assert.deepEqual(second, first, `spin ${spin} was not deterministic`);
}

const released = createTumbleState(
  COUNT,
  DRUM_RADIUS,
  DRUM_HALF_LENGTH,
  BALL_RADIUS,
);
const claimed = released.balls[4]!;
claimed.released = true;
claimed.x = 12;
claimed.y = -7;
claimed.z = 3;
claimed.vx = 2;
claimed.vy = 4;
claimed.vz = -1;
const snapshot = { ...claimed };
for (let i = 0; i < 2_000; i += 1) stepTumble(released, 1 / 120, 4.8);
assert.deepEqual(claimed, snapshot, 'solver changed a timeline-owned ball');
assertContained(released);

console.log('Lucky Cage tumble containment verified.');
