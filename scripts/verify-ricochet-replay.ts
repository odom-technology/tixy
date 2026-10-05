/**
 * Ricochet's trusted score: seeded-replay, step-clock and tamper proof.
 *
 *   npx tsx scripts/verify-ricochet-replay.ts
 *
 *  1. Rules lock: the step, the numbers the game has always run on, the gap
 *     and speed schedule (a fingerprint of the schedule the game shipped
 *     with), and the wire form.
 *  2. Same game: the client's old physics (a verbatim copy of its step, run
 *     once per 60 Hz frame) and the shared engine are played with the same
 *     flaps and must agree on every step of 1,500 runs, so a score still
 *     means what it did.
 *  3. Honest runs: a reference client plays a bot per skill with the real
 *     engine and logs its taps as the client does. The server's replay must
 *     reach the same score and step count, so the score the player saw is the
 *     score saved and the tickets it pays don't change.
 *  4. Clock: the same client driven by a frame loop at 30, 60, 120 and 144 Hz
 *     with jitter and dropped frames. Its tap log must replay to what it
 *     flew, and the replay's least duration never exceeds the wall time the
 *     run took, so an honest run is never rejected as too long for its
 *     session. The real frame loop at 60, 120 and 144 Hz also draws the bird
 *     moving on every paint, by the same distance.
 *  5. Tampered runs: an inflated score, the old wall-event post (no taps), a
 *     forged flap, dropped and shifted taps, a run flown on the wrong seed,
 *     taps after the run ended, bad shapes, a run longer than the session and
 *     a flawless flight posted from a session seconds old.
 *  6. What a run pays: tickets a minute by skill, on the old physics and on
 *     the engine, which must match.
 *
 * Replayed sessions are the score route's job (the session row is consumed
 * once); scripts/verify-ricochet-http.ts covers that over HTTP.
 *
 * Exits non-zero on any failed assertion.
 */
import {
  RICOCHET_BASE_HEIGHT,
  RICOCHET_BASE_WIDTH,
  RICOCHET_BIRD_RADIUS,
  RICOCHET_FLAP_IMPULSE,
  RICOCHET_GAP_BASE,
  RICOCHET_GAP_MIN,
  RICOCHET_GRAVITY,
  RICOCHET_LEFT_FACE,
  RICOCHET_MAX_FALL_SPEED,
  RICOCHET_MAX_SPEED,
  RICOCHET_MAX_TAPS,
  RICOCHET_RIGHT_FACE,
  RICOCHET_STEP_HZ,
  RICOCHET_STEP_MS,
  createRicochetState,
  parseRicochetTaps,
  replayRicochetRun,
  ricochetGapFor,
  ricochetSpeedFor,
  stepRicochet,
  verifyRicochetRun,
  type RicochetState,
} from '@/server/arcade/ricochet-replay';
import { calculateGameRewardCredits } from '@/server/arcade/rewards/wallet';
import {
  SKILLS,
  mulberry32,
  playClient,
  playFramed,
  type ClientRun,
  type Skill,
} from './lib/ricochet-bot';

let failures = 0;
let checks = 0;
const assert = (cond: boolean, msg: string) => {
  checks += 1;
  if (!cond) {
    console.error('  FAIL: ' + msg);
    failures += 1;
  }
};
const section = (title: string) => console.log(title);

const failure = (run: ReturnType<typeof replayRicochetRun>) =>
  run.ok === false ? (run as Extract<typeof run, { ok: false }>).reason : null;

const rand = mulberry32(0x7a11e7);
const seedFor = () => Math.floor(rand() * 2 ** 31);

// ── 1. Rules lock ──────────────────────────────────────────────────────────
section('1. Rules');
assert(RICOCHET_STEP_HZ === 60 && Math.abs(RICOCHET_STEP_MS - 1000 / 60) < 1e-12, 'the step is 60 Hz, the shared frame loop rate');
assert(RICOCHET_GRAVITY === 0.5 && RICOCHET_FLAP_IMPULSE === -7.6 && RICOCHET_MAX_FALL_SPEED === 11, 'gravity 0.5, flap -7.6, terminal 11 px a step');
assert(RICOCHET_BASE_WIDTH === 480 && RICOCHET_BASE_HEIGHT === 640 && RICOCHET_BIRD_RADIUS === 14, 'a 480 by 640 field and a 14 px bird');
assert(RICOCHET_LEFT_FACE === 34 && RICOCHET_RIGHT_FACE === 446, 'walls 34 px thick');
assert(RICOCHET_GAP_BASE === 200 && RICOCHET_GAP_MIN === 116, 'gaps start 200 px and shrink to 116 px');
assert(ricochetSpeedFor(1) === 2.6 && ricochetSpeedFor(1000) === RICOCHET_MAX_SPEED, 'speed from 2.6 to 6.4 px a step');
// The schedule the game shipped with: a fingerprint of 6 seeds x 300 walls.
let fingerprint = 0;
for (const seed of [1, 2, 99, 123456, 2147483647, -5]) {
  for (let wall = 1; wall <= 300; wall += 1) {
    const gap = ricochetGapFor(seed, wall);
    fingerprint =
      (Math.imul(fingerprint ^ Math.round(gap.start * 1000), 0x9e3779b1) +
        Math.round(gap.height) +
        Math.round(ricochetSpeedFor(wall) * 1000)) |
      0;
    assert(gap.start >= 26 && gap.end <= RICOCHET_BASE_HEIGHT - 26, `gap ${seed}/${wall} sits inside the margins`);
  }
}
assert(fingerprint === -154092428, `the gap and speed schedule is the one the game shipped with (${fingerprint})`);
assert(parseRicochetTaps([0, 3, 9]) !== null, 'taps are a list of step counts');
assert(parseRicochetTaps([3, 3]) === null && parseRicochetTaps([4, 3]) === null, 'taps strictly increase');
assert(parseRicochetTaps([-1]) === null && parseRicochetTaps([1.5]) === null && parseRicochetTaps(['1']) === null, 'taps are whole, non-negative numbers');
assert(parseRicochetTaps(Array.from({ length: RICOCHET_MAX_TAPS + 1 }, (_, i) => i)) === null, `no more than ${RICOCHET_MAX_TAPS} taps`);
assert(parseRicochetTaps(null) === null && parseRicochetTaps({}) === null, 'a payload with no list is refused');

// ── 2. Same game as before ─────────────────────────────────────────────────
section('2. The old client physics and the engine agree');
type OldBird = { x: number; y: number; vy: number; dir: number };
/** The client's stepPhysics before the replay, copied as it stood: the flap
 *  is applied between steps, then gravity, the move, the floor and ceiling,
 *  the horizontal move and the wall test. */
function oldStep(bird: OldBird, wall: number, seed: number, flapped: boolean) {
  if (flapped) bird.vy = -7.6;
  bird.vy = Math.min(11, bird.vy + 0.5);
  bird.y += bird.vy;
  if (bird.y - 14 <= 0 || bird.y + 14 >= 640) {
    bird.y = Math.max(14, Math.min(640 - 14, bird.y));
    return { dead: true, bounced: false };
  }
  const speed = Math.min(6.4, 2.6 + (wall - 1) * 0.085);
  bird.x += bird.dir * speed;
  const gap = ricochetGapFor(seed, wall);
  const outside = () => bird.y + 14 < gap.start || bird.y - 14 > gap.end;
  if (bird.dir > 0 && bird.x + 14 >= 480 - 34) {
    bird.x = 480 - 34 - 14;
    if (outside()) return { dead: true, bounced: false };
    bird.dir = -1;
    return { dead: false, bounced: true };
  }
  if (bird.dir < 0 && bird.x - 14 <= 34) {
    bird.x = 34 + 14;
    if (outside()) return { dead: true, bounced: false };
    bird.dir = 1;
    return { dead: false, bounced: true };
  }
  return { dead: false, bounced: false };
}
let sameRuns = 0;
for (let run = 0; run < 1500; run += 1) {
  const seed = seedFor();
  const flapEvery = 7 + Math.floor(rand() * 14);
  const aimLow = 150 + rand() * 340;
  const bird: OldBird = { x: 240, y: 320, vy: -7.6, dir: 1 };
  let wall = 1;
  const state = createRicochetState();
  let agreed = true;
  for (let step = 0; step < 4000 && agreed; step += 1) {
    // A flap rule with a little randomness, so runs reach different depths.
    const flap = (bird.y > aimLow && bird.vy > -2 && step % 3 === 0) || step % flapEvery === 0 && rand() < 0.5;
    const before = oldStep(bird, wall, seed, flap);
    if (before.bounced) wall += 1;
    const event = stepRicochet(state, seed, flap);
    const same =
      state.x === bird.x &&
      state.y === bird.y &&
      state.vy === bird.vy &&
      state.dir === bird.dir &&
      state.wall === wall &&
      (event?.kind === 'death') === before.dead &&
      (event?.kind === 'bounce') === before.bounced;
    if (!same) {
      agreed = false;
      assert(false, `run ${run} step ${step} differs from the old physics`);
    }
    if (before.dead) break;
  }
  if (agreed) sameRuns += 1;
}
assert(sameRuns === 1500, `1,500 runs of up to 4,000 steps agree step for step (${sameRuns})`);

// ── 3. Honest runs ─────────────────────────────────────────────────────────
section('3. Honest runs replay to the score the client saw');
const honest: ClientRun[] = [];
for (const skill of SKILLS) {
  for (let i = 0; i < 40; i += 1) {
    const run = playClient(seedFor(), skill, rand, { maxWalls: 200 });
    honest.push(run);
    const verdict = verifyRicochetRun(run.seed, run.taps, run.score, { elapsedMs: run.durationMs + 400 });
    assert(verdict.ok === true, `${skill.name} run ${i} (score ${run.score}) is accepted (${failure(verdict)})`);
    if (verdict.ok) {
      assert(verdict.score === run.score && verdict.steps === run.steps, `${skill.name} run ${i}: same score and steps (${verdict.score}/${verdict.steps} vs ${run.score}/${run.steps})`);
      assert(verdict.bounceSteps.length === run.score, `${skill.name} run ${i}: one wall step a point`);
    }
  }
}
assert(honest.some((run) => run.score >= 60), 'the sample reaches 60 walls or more');
const noTaps = replayRicochetRun(1234, []);
assert(noTaps.ok === true && noTaps.score === 0, 'a run with no taps is a bird that falls: score 0');

// ── 4. The clock ───────────────────────────────────────────────────────────
section('4. Frame rates: the tap log replays to what was flown, never longer than the wall time');
for (const hz of [30, 60, 120, 144]) {
  for (const [jitterMs, dropRate] of [[0, 0], [2, 0.03], [4, 0.08]] as const) {
    let worstMargin = Infinity;
    let runs = 0;
    for (const skill of [SKILLS[1]!, SKILLS[3]!]) {
      for (let i = 0; i < 12; i += 1) {
        const run = playFramed(seedFor(), skill, rand, { hz, jitterMs, dropRate, maxWalls: 120 });
        const verdict = verifyRicochetRun(run.seed, run.taps, run.score, { elapsedMs: run.wallMs });
        assert(verdict.ok === true, `${hz} Hz jitter ${jitterMs} drops ${dropRate}: ${skill.name} run ${i} accepted (${failure(verdict)})`);
        if (verdict.ok) {
          assert(verdict.steps === run.steps, `${hz} Hz: replay steps ${verdict.steps} equal the client's ${run.steps}`);
          worstMargin = Math.min(worstMargin, run.wallMs - verdict.durationMs);
        }
        runs += 1;
      }
    }
    assert(worstMargin >= 0, `${hz} Hz jitter ${jitterMs} drops ${dropRate}: the replay never needs more time than the run took (least margin ${worstMargin.toFixed(0)} ms over ${runs} runs)`);
  }
}
// The same seed and the same taps are the same run at any frame rate.
{
  const seed = 987654;
  const reference = playClient(seed, SKILLS[2]!, mulberry32(5), { maxWalls: 80 });
  const again = replayRicochetRun(seed, reference.taps);
  assert(again.ok === true && again.score === reference.score, 'the taps alone give the score: frame rate is not an input');
}

// What the player sees: the real frame loop, driven at each display rate, with
// the sim stepping at 60 Hz and the bird drawn between two steps. On a 120 or
// 144 Hz display the bird must move on every paint, by the same amount, not
// sit for a paint on a 60 Hz sample.
{
  const g = globalThis as unknown as Record<string, unknown>;
  const { createGameFrameLoop, lerp } = await import('@/features/arcade/lib/game-frame-loop');
  const flight = playClient(4242, SKILLS[3]!, mulberry32(9), { maxWalls: 6 });
  const flaps = new Set(flight.taps);
  for (const hz of [60, 120, 144]) {
    let queued: ((t: number) => void) | null = null;
    g.requestAnimationFrame = (cb: (t: number) => void) => {
      queued = cb;
      return 1;
    };
    g.cancelAnimationFrame = () => {
      queued = null;
    };
    g.document = { hidden: false, addEventListener: () => {}, removeEventListener: () => {} };
    const sim = createRicochetState();
    let prev = { x: sim.x, y: sim.y };
    let over = false;
    const seen: Array<{ x: number; dir: number; wall: number; bounced: boolean }> = [];
    let bounceStep = -1;
    const loop = createGameFrameLoop({
      beforeSimulate: () => {
        prev = { x: sim.x, y: sim.y };
      },
      simulate: () => {
        const event = stepRicochet(sim, 4242, flaps.has(sim.step));
        if (event?.kind === 'death') over = true;
        if (event?.kind === 'bounce') bounceStep = sim.step;
        return !over;
      },
      render: (alpha) => {
        seen.push({ x: lerp(prev.x, sim.x, alpha), dir: sim.dir, wall: sim.wall, bounced: sim.step === bounceStep });
      },
    });
    loop.start();
    let now = 0;
    while (!over && now < 120_000) {
      now += 1000 / hz;
      const frame = queued as ((t: number) => void) | null;
      queued = null;
      frame?.(now);
    }
    let still = 0;
    let worst = 0;
    let pairs = 0;
    for (let i = 1; i < seen.length; i += 1) {
      const a = seen[i - 1]!;
      const b = seen[i]!;
      // The step that meets a wall stops short of it, so the paints inside it move less.
      if (a.dir !== b.dir || a.wall !== b.wall || a.bounced || b.bounced || i < 4) continue;
      const expected = ricochetSpeedFor(a.wall) * (1000 / hz / RICOCHET_STEP_MS);
      const moved = Math.abs(b.x - a.x);
      pairs += 1;
      if (moved < 1e-9) still += 1;
      worst = Math.max(worst, Math.abs(moved - expected) / expected);
    }
    assert(pairs > 200, `${hz} Hz: ${pairs} paints compared`);
    assert(still === 0, `${hz} Hz: the bird moves on every paint (${still} paints held still)`);
    assert(worst < 0.02, `${hz} Hz: each paint moves it the same distance, within 2% (worst ${(worst * 100).toFixed(2)}%)`);
    loop.destroy();
  }
  delete g.requestAnimationFrame;
  delete g.cancelAnimationFrame;
  delete g.document;
}

// ── 5. Tampered runs ───────────────────────────────────────────────────────
section('5. Tampered runs are rejected');
const good = honest.filter((run) => run.score >= 15 && run.taps.length > 12).slice(0, 12);
assert(good.length >= 6, `have ${good.length} runs of 15 walls or more to tamper with`);
const slack = 400;
const check = (label: string, run: ClientRun, taps: readonly number[], claim: number, elapsedMs?: number, seed = run.seed) => {
  const verdict = verifyRicochetRun(seed, taps, claim, { elapsedMs: elapsedMs ?? run.durationMs + slack });
  assert(verdict.ok === false, `${label} is rejected`);
  return verdict.ok === false ? (verdict as { reason: string }).reason : '';
};
for (const run of good) {
  check('an inflated score', run, run.taps, run.score + 1);
  check('a score of 1000', run, run.taps, 1000);
  check('the score of a run with the taps dropped', run, run.taps.slice(0, Math.floor(run.taps.length / 2)), run.score);
  // A forged flap: one extra tap between two taps. It is a flight a hand could
  // have flown, so it is scored on its own taps: the replay's score is the
  // score, and the old claim only passes when the flights reach the same wall.
  const gapAt = run.taps.findIndex((k, i) => i > 0 && k - run.taps[i - 1]! > 4);
  if (gapAt > 0) {
    const forged = [...run.taps];
    forged.splice(gapAt, 0, run.taps[gapAt - 1]! + 2);
    const own = replayRicochetRun(run.seed, forged);
    if (own.ok === false) {
      assert(/after the run ended/.test(failure(own) ?? ''), `a forged flap that kills the bird earlier leaves taps after the end (${failure(own)})`);
    } else {
      assert(verifyRicochetRun(run.seed, forged, own.score, { elapsedMs: run.durationMs + 5000 }).ok === true, 'a forged flap scores what its own flight reaches');
      assert(verifyRicochetRun(run.seed, forged, own.score + 1, { elapsedMs: run.durationMs + 5000 }).ok === false, 'a forged flap with one wall more claimed is rejected');
    }
  }
  // The wall a flight reaches is fixed by the step count (the bird crosses at
  // a fixed speed), so taps cannot buy more walls than the seed's gaps allow:
  // a bird that is never flapped dies on the floor.
  const grounded = replayRicochetRun(run.seed, []);
  assert(grounded.ok === true && grounded.score <= 1 && grounded.steps < 120, `a bird nobody flaps falls out of the air within 2 s (score ${grounded.ok ? grounded.score : 'n/a'})`);
  // Another session's seed.
  check('a run flown on another seed', run, run.taps, run.score, undefined, run.seed ^ 0x5bd1e995);
  // Taps after the run ended.
  check('a tap after the run ended', run, [...run.taps, run.steps + 5], run.score);
  // Out of order and repeated.
  check('taps out of order', run, [run.taps[1]!, run.taps[0]!, ...run.taps.slice(2)], run.score);
  check('a repeated tap', run, [run.taps[0]!, run.taps[0]!, ...run.taps.slice(1)], run.score);
  // Longer than the session has existed.
  const tooShort = check('a run longer than its session', run, run.taps, run.score, run.durationMs - 3000);
  assert(/session/.test(tooShort), `the reason names the session (${tooShort})`);
}
{
  const run = good[0]!;
  // The old post: wall events and no taps.
  assert(parseRicochetTaps(undefined) === null, 'the old wall-event post carries no tap list and is refused');
  check('a claim of 100 walls with no taps', run, [], 100);
  check('a claim of 1 wall with no taps', run, [], 1);
  // A seed-aware script that flies the gaps perfectly, posted from a session
  // seconds old: the flight is real, but it takes minutes.
  const flawless = playClient(run.seed, SKILLS[4]!, mulberry32(11), { maxWalls: 150 });
  const verdictInTime = verifyRicochetRun(flawless.seed, flawless.taps, flawless.score, { elapsedMs: flawless.durationMs + 400 });
  assert(verdictInTime.ok === true, `a flawless ${flawless.score}-wall flight is accepted when the session is old enough`);
  check('the same flight posted from a session 5 s old', flawless, flawless.taps, flawless.score, 5000);
  check('the same flight posted from a session 30 s old', flawless, flawless.taps, flawless.score, 30_000);
  // Huge step counts.
  check('a tap at step 10 million', run, [10_000_000], 0);
  const forgedHuge = replayRicochetRun(run.seed, [0, 1_000_000_000]);
  assert(forgedHuge.ok === false, 'a tap a billion steps out is refused');
  // Shapes.
  for (const [label, taps] of [
    ['a fractional tap', [1.5]],
    ['a negative tap', [-3]],
    ['NaN', [Number.NaN]],
    ['a string tap', ['4']],
    ['a nested list', [[4]]],
    ['a null tap', [null]],
  ] as const) {
    assert(parseRicochetTaps(taps as unknown) === null, `${label} is refused`);
  }
  const replayShape = replayRicochetRun(run.seed, [5, 5]);
  assert(replayShape.ok === false, 'the replay refuses a repeated tap on its own');
}

// ── 6. What a run pays ─────────────────────────────────────────────────────
section('6. Tickets a minute by skill, old physics and engine');
type Stepper = (state: RicochetState, seed: number, flap: boolean) => ReturnType<typeof stepRicochet>;
/** The old client's step as a stepper on the engine's state, for the bot. */
const oldStepper: Stepper = (state, seed, flap) => {
  state.step += 1;
  const bird: OldBird = { x: state.x, y: state.y, vy: state.vy, dir: state.dir };
  const wall = state.wall;
  const outcome = oldStep(bird, wall, seed, flap);
  state.x = bird.x;
  state.y = bird.y;
  state.vy = bird.vy;
  if (outcome.dead) return { kind: 'death', cause: 'spike', wall, y: bird.y, side: 'left' };
  if (outcome.bounced) {
    state.dir = bird.dir === 1 ? 1 : -1;
    state.score += 1;
    state.wall += 1;
    return { kind: 'bounce', wall, y: bird.y, side: bird.dir > 0 ? 'left' : 'right' };
  }
  return null;
};
console.log('  skill     minutes a run   tickets a run   tickets a minute (old)   tickets a minute (engine)');
const perMinute = (skill: Skill, step: Stepper) => {
  const rng = mulberry32(0xa11ce5);
  let tickets = 0;
  let minutes = 0;
  for (let i = 0; i < 150; i += 1) {
    const run = playClient(Math.floor(rng() * 2 ** 31), skill, rng, { maxWalls: 400, step });
    tickets += calculateGameRewardCredits({ gameType: 'ricochet', score: run.score });
    minutes += run.durationMs / 60000;
  }
  return { tickets: tickets / 150, minutes: minutes / 150, perMinute: tickets / minutes };
};
for (const skill of SKILLS) {
  const before = perMinute(skill, oldStepper);
  const after = perMinute(skill, stepRicochet);
  console.log(
    `  ${skill.name.padEnd(9)} ${after.minutes.toFixed(2).padStart(8)}        ${after.tickets.toFixed(1).padStart(8)}          ${before.perMinute.toFixed(2).padStart(10)}               ${after.perMinute.toFixed(2).padStart(10)}`,
  );
  assert(
    Math.abs(before.perMinute - after.perMinute) < 1e-9 && Math.abs(before.tickets - after.tickets) < 1e-9,
    `${skill.name}: tickets a minute are the same on the old physics and the engine`,
  );
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} failed`);
  process.exit(1);
}
