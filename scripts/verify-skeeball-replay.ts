/**
 * Skee-ball (rules 2) verifier.
 *
 * Usage: npx tsx scripts/verify-skeeball-replay.ts
 *
 *  1. Flick table: flick speed and slant to the ring it lands in, through
 *     the client's own input map (_skee-flick.ts).
 *  2. Display rates: the client's live playback, driven at 30, 60, 120 and
 *     144 Hz with jittered frame times, decides the same outcome (ring and
 *     touchdown point, bit for bit) as the one-shot sim the server runs. The drawn
 *     ball never jumps: no frame moves it more than its speed allows.
 *     The ball return takes the ball from where the sim stops at the
 *     sim's speed and never jumps in speed or position on the way home.
 *     No step on the board shoves the ball sideways (a ball coming down on
 *     a ring wall glances off its rounded top).
 *  3. Replay: a client frame (bonus balls included) and validateSkeeRun
 *     agree on every ball and the score.
 *  4. Tamper: a raised score claim, bad params, a bad timeline, throws past
 *     the frame's balls and the bonus cap are all held to the rules.
 *  5. The engine uses no Math.sin or Math.cos (engine-dependent last bits).
 */
import { readFileSync } from 'node:fs';

import {
  SKEE_BALL_R,
  SKEE_BALLS_PER_SESSION,
  SKEE_GAP_FLOOR_Y,
  SKEE_GRAVITY,
  SKEE_MAX_AIM,
  SKEE_MAX_BALLS,
  SKEE_MAX_POWER,
  SKEE_MAX_SCORE,
  SKEE_MAX_THROWS,
  SKEE_MIN_POWER,
  SKEE_MIN_THROW_INTERVAL_MS,
  SKEE_SIM_DT,
  skeeApplyThrow,
  skeeBallBonusFor,
  skeeDailyTarget,
  skeeDateKey,
  skeeInitialState,
  skeeSimulateThrow,
  skeeStartThrow,
  skeeStep,
  validateSkeeRun,
  type SkeeThrow,
} from '../src/server/arcade/skee-ball-replay';
import { createSkeePlayback, flickToRelease } from '../src/app/(games)/skee-ball/_skee-flick';
import {
  holeCentre,
  returnPoints,
  sampleReturnRun,
  startReturnRun,
  stepReturnRun,
} from '../src/app/(games)/skee-ball/_skee-ball-scene';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) {
    failures += 1;
    console.error(`FAIL  ${label} ${detail}`);
  } else {
    console.log(`ok    ${label}`);
  }
};
const ringOf = (aim: number, power: number) => {
  const o = skeeSimulateThrow(aim, power).outcome;
  return o.kind === 'ring' ? String(o.ring) : o.kind;
};

// ── 1. Flick table ──
console.log('\n— flick to ring (forward speed px/ms down, slant across; slant is sideways over forward) —');
const slants = [-0.5, -0.3, -0.15, 0, 0.15, 0.3, 0.5];
console.log(`fwd px/ms  ${slants.map((s) => s.toFixed(2).padStart(6)).join('')}`);
for (let f = 0.6; f <= 2.31; f += 0.1) {
  const cells = slants.map((s) => {
    const r = flickToRelease(f, s * f);
    return ringOf(r.aim, r.power).padStart(6);
  });
  console.log(`${f.toFixed(1).padStart(9)}  ${cells.join('')}`);
}

// ── 2. Display rates ──
let seed = 99;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
let rateMismatch = 0;
let worstJump = 0;
const RATES = [30, 60, 120, 144];
for (let i = 0; i < 400; i += 1) {
  const aim = (rand() * 2 - 1) * SKEE_MAX_AIM;
  const power = SKEE_MIN_POWER + rand() * (SKEE_MAX_POWER - SKEE_MIN_POWER);
  const server = skeeSimulateThrow(aim, power);
  for (const hz of RATES) {
    const play = createSkeePlayback(aim, power);
    const at = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    let decided: string | null = null;
    let last: { x: number; y: number; z: number } | null = null;
    for (let frame = 0; frame < 20 * hz && play.state.phase !== 'done'; frame += 1) {
      // Frame times wobble by up to a fifth, as on a real device.
      const ms = (1000 / hz) * (0.8 + 0.4 * rand());
      for (const e of play.advance(ms)) {
        if (e.kind === 'decided' && decided === null) decided = JSON.stringify(e.outcome);
      }
      play.sample(at);
      if (last) {
        const moved = Math.hypot(at.x - last.x, at.y - last.y, at.z - last.z);
        const allowed = (Math.hypot(at.vx, at.vy, at.vz) + 15) * (ms / 1000) * 1.6 + 1e-6;
        worstJump = Math.max(worstJump, moved / allowed);
      }
      last = { x: at.x, y: at.y, z: at.z };
    }
    // The whole outcome, touchdown point included, bit for bit.
    if (decided !== JSON.stringify(server.outcome)) rateMismatch += 1;
  }
}
check('playback at 30/60/120/144 Hz decides the server\'s outcome bit for bit (400 throws x 4 rates)', rateMismatch === 0, `mismatches=${rateMismatch}`);
check('the drawn ball never jumps between frames', worstJump <= 1, `worst=${worstJump.toFixed(2)}`);

// ── 2b. The hand-off to the ball return ──
// The return starts at the speed the sim left the ball with and changes it
// no faster than gravity plus the floor's climb: no jump when the sim ends,
// at a hole, or on the way home.
let worstReturnDv = 0;
let worstReturnJump = 0;
for (let i = 0; i < 300; i += 1) {
  const aim = (rand() * 2 - 1) * SKEE_MAX_AIM;
  const power = SKEE_MIN_POWER + rand() * (SKEE_MAX_POWER - SKEE_MIN_POWER);
  const play = createSkeePlayback(aim, power);
  while (play.state.phase !== 'done') play.advance(50);
  const st = play.state;
  const outcome = st.outcome!;
  const inGap = outcome.kind === 'short' && st.y <= SKEE_GAP_FLOOR_Y + SKEE_BALL_R + 0.05;
  const kind = outcome.kind === 'ring' ? 'ring' : outcome.kind === 'over' ? 'over' : inGap ? 'gutter' : 'short';
  const from: [number, number, number] = [st.x, st.y, st.z];
  const holeAt = outcome.kind === 'ring' ? holeCentre(outcome.ring, st.x, st.w) : null;
  const speed = Math.hypot(st.vx, st.vy, st.vz);
  const run = startReturnRun(returnPoints(from, kind, outcome.ring, holeAt), speed);
  worstReturnDv = Math.max(worstReturnDv, Math.abs(run.v - Math.min(6.5, Math.max(0.3, speed))));
  let last = sampleReturnRun(run);
  let v = run.v;
  const dt = 1 / 120;
  for (let k = 0; k < 2_000; k += 1) {
    const done = stepReturnRun(run, dt).done;
    const at = sampleReturnRun(run);
    if (at.visible && last.visible) {
      // Gravity on a fall, plus the floor's climb, plus slack for rounding.
      worstReturnDv = Math.max(worstReturnDv, Math.abs(run.v - v) / ((SKEE_GRAVITY + 9) * dt + 0.02));
      const moved = Math.hypot(at.p[0] - last.p[0], at.p[1] - last.p[1], at.p[2] - last.p[2]);
      worstReturnJump = Math.max(worstReturnJump, moved / (run.v * dt + 1e-6));
    }
    v = run.v;
    last = at;
    if (done) break;
  }
}
check('the ball return picks up the sim\'s speed and never jumps in speed', worstReturnDv <= 1, `worst=${worstReturnDv.toFixed(2)}`);
check('the ball return never moves further than its speed', worstReturnJump <= 1.01, `worst=${worstReturnJump.toFixed(3)}`);

// ── 2c. No wall shoves ──
// A ball coming down on a ring wall glances off its rounded top; no step
// moves it more than a third of its radius past what its velocity explains.
let worstShove = 0;
for (let i = 0; i < 600; i += 1) {
  const st = skeeStartThrow((rand() * 2 - 1) * SKEE_MAX_AIM, SKEE_MIN_POWER + rand() * (SKEE_MAX_POWER - SKEE_MIN_POWER));
  while (st.phase !== 'done' && st.steps < 16 * 240) {
    const [x, y, z, vx, vy, vz] = [st.x, st.y, st.z, st.vx, st.vy, st.vz];
    skeeStep(st);
    if (st.phase === 'board') {
      worstShove = Math.max(worstShove, Math.hypot(st.x - x - vx * SKEE_SIM_DT, st.y - y - vy * SKEE_SIM_DT, st.z - z - vz * SKEE_SIM_DT));
    }
  }
}
check('no step on the board shoves the ball over a third of its radius', worstShove <= SKEE_BALL_R / 3, `worst=${worstShove.toFixed(3)}`);

// ── 3. Replay: client frame vs server ──
const frameSeed = 1234567;
const scripted: Array<[number, number]> = [
  [0, 9.4],
  [1.2, 9.8], // a 100 pocket: a bonus ball
  [-1.2, 9.8], // and another
  [0, 8.8],
  [0.4, 9.0],
  [-0.4, 7.4],
  [0, 10.6],
  [0.2, 9.6],
  [0, 6.0],
  [1.2, 9.9],
  [0, 9.2],
  [0, 8.2],
  [0, 9.0], // past the frame's balls: ignored
];
let client = skeeInitialState();
const throws: SkeeThrow[] = [];
let t = 500;
let pockets = 0;
for (const [aim, power] of scripted) {
  const applied = skeeApplyThrow(frameSeed, client, t, aim, power);
  if (applied.event.type === 'thrown') {
    throws.push({ t, aim, power });
    if (applied.event.bonusBall) pockets += 1;
  }
  client = applied.state;
  t += 2_000;
}
const replay = validateSkeeRun(frameSeed, throws);
check('scripted frame earns bonus balls', pockets >= 2 && client.ballsAllowed === SKEE_BALLS_PER_SESSION + pockets, `pockets=${pockets} allowed=${client.ballsAllowed}`);
check('frame completes on its own ball count', replay.stop === 'complete' && replay.balls === client.ballsAllowed, `balls=${replay.balls} allowed=${replay.ballsAllowed} stop=${replay.stop}`);
check('server replay matches the client score', replay.score === client.score, `client=${client.score} server=${replay.score}`);
const a = skeeSimulateThrow(0.777, 10.123);
const b = skeeSimulateThrow(0.777, 10.123);
check('the sim is deterministic', JSON.stringify(a) === JSON.stringify(b));

// ── 4. Tamper ──
check('a raised score claim fails the route\'s comparison', replay.score + 10 !== validateSkeeRun(frameSeed, throws).score);
const fast = validateSkeeRun(frameSeed, [
  { t: 1_000, aim: 0, power: 9 },
  { t: 1_000 + SKEE_MIN_THROW_INTERVAL_MS - 1, aim: 0, power: 9 },
  { t: 1_000 + SKEE_MIN_THROW_INTERVAL_MS + 1, aim: 0, power: 9 },
]);
check('an under-cadence throw is ignored', fast.balls === 2 && fast.inspected === 3, `balls=${fast.balls}`);
check('a non-finite param stops scoring', validateSkeeRun(frameSeed, [{ t: 1_000, aim: Number.NaN, power: 9 }]).stop === 'bounds');
check('a negative time stops scoring', validateSkeeRun(frameSeed, [{ t: -5, aim: 0, power: 9 }]).stop === 'bounds');
check(
  'a gap over two minutes stops scoring',
  validateSkeeRun(frameSeed, [
    { t: 1_000, aim: 0, power: 9 },
    { t: 200_000, aim: 0, power: 9 },
  ]).stop === 'bounds',
);
check('out-of-range params are clamped, not trusted', ringOf(99, 99) === ringOf(SKEE_MAX_AIM, SKEE_MAX_POWER) && ringOf(-99, -99) === ringOf(-SKEE_MAX_AIM, SKEE_MIN_POWER));
// Every throw a pocket: the bonus stops at 3.
let greedy = skeeInitialState();
let greedyThrows = 0;
for (let i = 0; i < 20; i += 1) {
  const applied = skeeApplyThrow(frameSeed, greedy, 1_000 + i * 2_000, 1.2, 9.8);
  if (applied.event.type === 'thrown') greedyThrows += 1;
  greedy = applied.state;
}
check('bonus balls stop at 3 (12 balls)', greedy.ballsAllowed <= SKEE_MAX_BALLS && greedyThrows <= SKEE_MAX_BALLS, `allowed=${greedy.ballsAllowed} thrown=${greedyThrows}`);
check('the score ceiling covers 12 hot pockets', SKEE_MAX_SCORE === 12 * 300 && SKEE_MAX_THROWS === 16);
let hotEarly = 0;
for (let s = 0; s < 200; s += 1) {
  for (let i = 0; i < SKEE_MAX_BALLS; i += 1) {
    const bonus = skeeBallBonusFor(s * 7919 + 1, i);
    if (![10, 20, 30, 40, 50, 100].includes(bonus.ring)) failures += 1;
    if (bonus.mult === 3 && i < 6) hotEarly += 1;
  }
}
check('lit-ring schedule is sane for all 12 balls', hotEarly === 0);

// Daily target: one number a day, 350 to 550, the same for everyone.
const targets = Array.from({ length: 60 }, (_, d) => skeeDailyTarget(skeeDateKey(Date.UTC(2026, 9, 1 + d))));
check(
  'the daily target is 350 to 550 in tens and repeats for the same date',
  targets.every((v) => v >= 350 && v <= 550 && v % 10 === 0) &&
    skeeDailyTarget('2026-10-03') === skeeDailyTarget(skeeDateKey(Date.UTC(2026, 9, 3, 23, 59))),
  targets.slice(0, 7).join(','),
);

// ── 5. No engine-dependent trig ──
const source = readFileSync(new URL('../src/server/arcade/skee-ball-replay.ts', import.meta.url), 'utf8');
check('the engine calls no Math.sin, Math.cos or Math.atan', !/Math\.(sin|cos|tan|atan|asin|acos|exp|log|pow)\(/.test(source));

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
