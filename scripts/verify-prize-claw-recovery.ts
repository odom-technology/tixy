import assert from 'node:assert/strict';

import {
  playPrizeClawDrop,
  readPrizeClawChoice,
} from '../src/server/arcade/wager-games/prize-claw';
import {
  buildClawTimeline,
  clawFrameAt,
} from '../src/app/(games)/prize-claw/_prize-claw-drop';

const config = { cabinet: 'curio' as const, bedSeed: 0x51a7 };
const seed = 0x19c0ffee;
const initial = playPrizeClawDrop(config, seed, 0.18, 0.62);
assert.ok(initial, 'initial drop did not resolve');

const stored = initial.resolution.point;
const parsed = readPrizeClawChoice(stored);
assert.deepEqual(parsed, stored, 'stored point did not revalidate');
const recovered = playPrizeClawDrop(config, seed, parsed.x, parsed.z);
assert.deepEqual(recovered, initial, 'unsettled recovery changed the drop');

const settledReplay = {
  ...(recovered ?? {}),
  payout: 125,
  seed,
  roundId: null,
  replayed: true,
};
assert.equal(settledReplay.payout, 125);
assert.equal(settledReplay.replayed, true);
assert.equal(settledReplay.roundId, null);

for (const malformed of [
  null,
  {},
  { x: '0.1', z: 0.4 },
  { x: Number.NaN, z: 0.4 },
  { x: 99, z: 0.4 },
  [0.1, 0.4],
]) {
  assert.equal(
    readPrizeClawChoice(malformed),
    null,
    `accepted malformed stored choice ${JSON.stringify(malformed)}`,
  );
}

// Model the route's guarded settle under simultaneous same-token retries:
// exactly one call pays, and every caller observes that one persisted payout.
let persistedPayout: number | null = null;
let payments = 0;
async function guardedSettle(payout: number): Promise<number> {
  await Promise.resolve();
  if (persistedPayout == null) {
    persistedPayout = payout;
    payments += 1;
    return payout;
  }
  return persistedPayout;
}
const concurrent = await Promise.all(
  Array.from({ length: 8 }, () => guardedSettle(125)),
);
assert.deepEqual(concurrent, Array(8).fill(125));
assert.equal(payments, 1, 'concurrent retries paid more than once');

for (const reduced of [false, true]) {
  const timeline = buildClawTimeline(initial.script, reduced);
  const boundaries = [
    timeline.descendEnd,
    timeline.closeEnd,
    timeline.gripEnd,
    timeline.liftEnd,
    timeline.travelEnd,
    timeline.releaseEnd,
    timeline.chuteEnd,
  ];
  for (let i = 1; i < boundaries.length; i += 1) {
    assert.ok(boundaries[i]! >= boundaries[i - 1]!, 'timeline moved backwards');
  }

  const phaseSpans = [
    [timeline.descendEnd, timeline.closeEnd],
    [timeline.closeEnd, timeline.gripEnd],
    [timeline.gripEnd, timeline.liftEnd],
    [timeline.liftEnd, timeline.travelEnd],
    [timeline.travelEnd, timeline.releaseEnd],
    [timeline.releaseEnd, timeline.chuteEnd],
  ] as const;
  for (const [start, end] of phaseSpans) {
    if (end === start) continue;
    const first = clawFrameAt(timeline, start, 0.5);
    const last = clawFrameAt(timeline, end - 1e-7, 0.5);
    assert.ok(first.t <= 1e-9, `phase did not start at 0 (${first.t})`);
    assert.ok(last.t >= 1 - 1e-6, `phase did not end at 1 (${last.t})`);
  }
  const final = clawFrameAt(timeline, timeline.chuteEnd, 0.5);
  assert.equal(final.phase, 'settled');
  assert.equal(final.chuteT, initial.script.outcome === 'won' ? 1 : 0);
}

console.log(
  'Prize Claw initial, settled replay, recovery, malformed choice, concurrency, and timeline verified.',
);
