import {
  PHYSICS_DT_MS,
  createAdaptiveGameQuality,
  createGameFrameLoop,
  gameCanvasDpr,
} from '../src/features/arcade/lib/game-frame-loop';

const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

let queued: FrameRequestCallback | null = null;
let nextId = 1;
globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
  queued = callback;
  return nextId++;
}) as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = (() => {
  queued = null;
}) as typeof cancelAnimationFrame;

const takeFrame = (now: number) => {
  const callback = queued;
  queued = null;
  check(callback, `no frame queued at ${now}`);
  callback!(now);
};

let simulations = 0;
const painted: Array<{ alpha: number; steps: number; hitched: boolean }> = [];
const loop = createGameFrameLoop({
  simulate: () => {
    simulations += 1;
  },
  render: (alpha, frame) => {
    painted.push({ alpha, steps: frame.simulationSteps, hitched: frame.hitched });
  },
});

loop.start();
check(loop.isRunning(), 'loop did not start');
takeFrame(100);
takeFrame(100 + PHYSICS_DT_MS / 2);
takeFrame(100 + PHYSICS_DT_MS);
check(simulations === 1, `expected one elapsed fixed step, got ${simulations}`);
check(painted.length === 3, `expected three paints, got ${painted.length}`);
check(painted[1]!.alpha > 0 && painted[1]!.alpha < 1, 'half-step did not interpolate');

takeFrame(1_000);
check(painted.at(-1)!.hitched, 'large delta was not reported as a hitch');
check(painted.at(-1)!.steps <= 4, 'hitch exceeded the simulation catch-up cap');

loop.stop();
check(!loop.isRunning(), 'loop did not stop');
check(queued === null, 'stopped loop retained a scheduled frame');
loop.destroy();

// Hit-stop: a frozenUntil window on the frame clock. Frozen time never
// reaches the accumulator; paint continues and resumes without a burst.
const { createHitStop } = await import('../src/features/arcade/lib/game-feel');
const hitStop = createHitStop({ reducedMotion: () => false });
let frozenSims = 0;
const frozenPaints: boolean[] = [];
const frozenLoop = createGameFrameLoop({
  hitStop,
  simulate: () => {
    frozenSims += 1;
  },
  render: (_alpha, frame) => {
    frozenPaints.push(frame.frozen);
  },
});
frozenLoop.start();
takeFrame(2_000);
takeFrame(2_000 + PHYSICS_DT_MS);
check(frozenSims === 1, `expected one step before the freeze, got ${frozenSims}`);
hitStop.freeze(50, 2_000 + PHYSICS_DT_MS);
const freezeStart = 2_000 + PHYSICS_DT_MS;
takeFrame(freezeStart + 20);
takeFrame(freezeStart + 40);
check(frozenSims === 1, `simulation advanced during hit-stop (${frozenSims} steps)`);
check(frozenPaints.at(-1) === true, 'frame did not report frozen during hit-stop');
check(frozenPaints.length === 4, 'paint stopped during hit-stop');
takeFrame(freezeStart + 50 + PHYSICS_DT_MS + 1);
check(frozenSims === 2, `expected exactly one step after the freeze, got ${frozenSims}`);
check(frozenPaints.at(-1) === false, 'frame still frozen after hit-stop ended');
frozenLoop.destroy();

// A freeze requested inside a step ends stepping that frame; the time still
// owed is simulated after the freeze, not during it.
const midStop = createHitStop({ reducedMotion: () => false });
let midSims = 0;
let midRequested = false;
const midLoop = createGameFrameLoop({
  hitStop: midStop,
  simulate: () => {
    midSims += 1;
    if (midSims === 1 && !midRequested) {
      midRequested = true;
      midStop.freeze(50, 3_000 + PHYSICS_DT_MS * 3);
    }
  },
  render: () => undefined,
});
midLoop.start();
takeFrame(3_000);
takeFrame(3_000 + PHYSICS_DT_MS * 3 + 1);
check(midSims === 1, `stepping continued after a mid-frame freeze (${midSims} steps)`);
takeFrame(3_000 + PHYSICS_DT_MS * 3 + 30);
check(midSims === 1, `simulation advanced while frozen after a mid-frame freeze (${midSims})`);
takeFrame(3_000 + PHYSICS_DT_MS * 3 + 51);
check(midSims === 3, `owed time was not simulated after the freeze (${midSims} steps, expected 3)`);
midLoop.destroy();

// A long frame that held a freeze clamps what is left after the freeze, so
// the time around the freeze is not lost to the hitch clamp.
const longStop = createHitStop({ reducedMotion: () => false });
let longSims = 0;
const longLoop = createGameFrameLoop({
  hitStop: longStop,
  simulate: () => {
    longSims += 1;
  },
  render: () => undefined,
});
longLoop.start();
takeFrame(4_000);
longStop.freeze(50, 4_010);
takeFrame(4_120);
// 120 ms raw, 50 ms frozen: 70 ms simulated is 4 steps. Clamping first
// (100 - 50 = 50 ms) would give only 3.
check(longSims === 4, `long frame around a freeze simulated ${longSims} steps, expected 4`);
longLoop.destroy();

const quality = createAdaptiveGameQuality();
let changed = false;
for (let i = 0; i < 200; i += 1) {
  changed = quality.sample(30, 4_000 + i * 34) || changed;
}
check(changed && quality.tier() !== 'high', 'quality did not step down under sustained load');
check(quality.dprScale() < 1 && quality.particleScale() < 1, 'lower tier did not reduce work');

check(gameCanvasDpr(1_000, 600) <= 1.5, 'large canvas DPR exceeded its cap');

console.log('game frame loop invariants passed');
