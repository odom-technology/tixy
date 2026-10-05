/**
 * Skee-ball feel numbers: what a throw does, step by step, for an engine.
 *
 *   npx tsx scripts/measure-skee-ball-feel.ts [--engine=path/to/skee-ball-replay.ts]
 *
 * Run it on the base branch's engine (git show origin/tixy/rev2:... into a
 * temp file) and on this one to compare. Prints:
 *
 *  1. A launch-speed sweep straight up the lane: time to the hump and the
 *     lip, lip speed, airtime, how far up the board it lands, the landing
 *     impact, bounces, wall knocks, time to decide, and the ring.
 *  2. Rings against launch speed on a fine grid (aim 0 and aim 40%): the
 *     window of launch speed (and of flick speed through the flick map)
 *     that lands each ring, and how often the ring flips as power rises.
 *  3. Spread: for a casual player's power noise (9% of the range), how
 *     many different rings one intended release scatters into.
 *  4. A ring map over launch speed and aim.
 *  5. How long a ball spends on the board before it drops.
 *  6. Snaps: steps where the ball moves further than its velocity explains
 *     (a wall pushing it out sideways in one step), which read as a jerk.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    return match ? [match[1], match[2] ?? 'true'] : [arg, 'true'];
  }),
) as Record<string, string>;

type Ev = { kind: string; speed?: number; outcome?: { kind: string; ring: number | null } };
type State = {
  phase: string;
  steps: number;
  s: number;
  vs: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  w: number;
  h: number;
  vw: number;
  vh: number;
  outcome: { kind: string; ring: number | null } | null;
};
type Engine = {
  SKEE_MIN_POWER: number;
  SKEE_MAX_POWER: number;
  SKEE_MAX_AIM: number;
  SKEE_SIM_DT: number;
  SKEE_S_FLAT: number;
  skeeStartThrow: (aim: number, power: number) => State;
  skeeStep: (state: State, events?: Ev[]) => void;
};

const enginePath = path.resolve(args.engine ?? 'src/server/arcade/skee-ball-replay.ts');
const E = (await import(pathToFileURL(enginePath).href)) as Engine;
const DT = E.SKEE_SIM_DT;
const span = E.SKEE_MAX_POWER - E.SKEE_MIN_POWER;
// The flick map's ends (px/ms), read from the client module when it has them.
const flick = (await import(pathToFileURL(path.resolve('src/app/(games)/skee-ball/_skee-flick.ts')).href)) as {
  FLICK_MIN_SPEED: number;
  FLICK_MAX_SPEED: number;
};
const toFlick = (power: number) =>
  flick.FLICK_MIN_SPEED + ((power - E.SKEE_MIN_POWER) / span) * (flick.FLICK_MAX_SPEED - flick.FLICK_MIN_SPEED);

type Trace = {
  hump: number;
  lip: number;
  lipSpeed: number;
  air: number;
  landW: number | null;
  impact: number;
  peakH: number;
  bounces: number;
  walls: number;
  decided: number;
  result: string;
};

function trace(aim: number, power: number): Trace {
  const st = E.skeeStartThrow(aim, power);
  const out: Trace = {
    hump: NaN,
    lip: NaN,
    lipSpeed: NaN,
    air: NaN,
    landW: null,
    impact: NaN,
    peakH: 0,
    bounces: 0,
    walls: 0,
    decided: NaN,
    result: '?',
  };
  const events: Ev[] = [];
  while (st.phase !== 'done' && st.steps < 16 * 240) {
    events.length = 0;
    const wasFlat = st.s <= E.SKEE_S_FLAT;
    E.skeeStep(st, events);
    const t = st.steps * DT;
    if (wasFlat && st.s > E.SKEE_S_FLAT && Number.isNaN(out.hump)) out.hump = t;
    if (st.phase === 'board' && st.h > out.peakH) out.peakH = st.h;
    for (const e of events) {
      if (e.kind === 'lip') {
        out.lip = t;
        out.lipSpeed = e.speed ?? NaN;
      } else if (e.kind === 'land') {
        out.air = t - out.lip;
        out.landW = st.w;
        out.impact = e.speed ?? NaN;
      } else if (e.kind === 'bounce') out.bounces += 1;
      else if (e.kind === 'wall') out.walls += 1;
      else if (e.kind === 'decided' && e.outcome && Number.isNaN(out.decided)) {
        out.decided = t;
        out.result = e.outcome.kind === 'ring' ? String(e.outcome.ring) : e.outcome.kind;
      }
    }
  }
  return out;
}

const f2 = (v: number) => (Number.isNaN(v) ? '  -  ' : v.toFixed(2).padStart(5));

console.log(`engine ${path.relative(process.cwd(), enginePath)}`);
console.log(`launch ${E.SKEE_MIN_POWER} to ${E.SKEE_MAX_POWER} u/s, flick ${flick.FLICK_MIN_SPEED} to ${flick.FLICK_MAX_SPEED} px/ms\n`);

// ── 1. Sweep ──
console.log('— 1. straight up the lane —');
console.log('power  flick  hump_s lip_s  lip_v  air_s  land_w impact peak_h bnc wall decide ring');
for (let k = 0; k <= 16; k += 1) {
  const p = E.SKEE_MIN_POWER + (span * k) / 16;
  const r = trace(0, p);
  console.log(
    `${p.toFixed(2).padStart(5)}  ${toFlick(p).toFixed(2)}   ${f2(r.hump)}  ${f2(r.lip)}  ${f2(r.lipSpeed)}  ${f2(r.air)}  ${r.landW === null ? '  -  ' : f2(r.landW)}  ${f2(r.impact)}  ${f2(r.peakH)}  ${String(r.bounces).padStart(2)}  ${String(r.walls).padStart(3)}  ${f2(r.decided)}  ${r.result}`,
  );
}

// ── 2. Ring windows ──
for (const aimShare of [0, 0.4]) {
  const aim = aimShare * E.SKEE_MAX_AIM;
  const N = 800;
  const rings: string[] = [];
  for (let i = 0; i <= N; i += 1) rings.push(trace(aim, E.SKEE_MIN_POWER + (span * i) / N).result);
  let flips = 0;
  const runs: Array<{ ring: string; from: number; to: number }> = [];
  for (let i = 0; i <= N; i += 1) {
    const p = E.SKEE_MIN_POWER + (span * i) / N;
    const last = runs[runs.length - 1];
    if (last && last.ring === rings[i]) last.to = p;
    else {
      if (last) flips += 1;
      runs.push({ ring: rings[i], from: p, to: p });
    }
  }
  console.log(`\n— 2. rings by launch speed, aim ${(aimShare * 100).toFixed(0)}% (${flips} flips over the range) —`);
  for (const run of runs) {
    const width = run.to - run.from + span / N;
    console.log(
      `${run.ring.padStart(5)}  ${run.from.toFixed(2)} to ${run.to.toFixed(2)} u/s  (${((width / span) * 100).toFixed(1).padStart(4)}% of range, flick ${toFlick(run.from).toFixed(2)} to ${toFlick(run.to).toFixed(2)} px/ms)`,
    );
  }
  const total: Record<string, number> = {};
  for (const r of rings) total[r] = (total[r] ?? 0) + 1;
  console.log(`  share of range: ${Object.entries(total).map(([r, n]) => `${r} ${((n / rings.length) * 100).toFixed(0)}%`).join(', ')}`);
}

// ── 3. Spread under a casual player's power noise ──
let seed = 7;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const normal = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, rand()))) * Math.cos(2 * Math.PI * rand());
console.log('\n— 3. one intended release, casual power noise (9% of range), aim 0 —');
console.log('aim for  10   20   30   40   50  100  short over');
for (let k = 2; k <= 14; k += 2) {
  const p0 = E.SKEE_MIN_POWER + (span * k) / 16;
  const count: Record<string, number> = {};
  for (let i = 0; i < 300; i += 1) {
    const r = trace(0, p0 + normal() * 0.09 * span).result;
    count[r] = (count[r] ?? 0) + 1;
  }
  const cell = (r: string) => `${String(Math.round(((count[r] ?? 0) / 300) * 100)).padStart(3)}%`;
  console.log(`${p0.toFixed(2).padStart(6)}  ${['10', '20', '30', '40', '50', '100', 'short', 'over'].map(cell).join(' ')}`);
}

// ── 4. Ring map: launch speed down, aim across (share of the max) ──
console.log('\n— 4. ring map (power down, aim share across) —');
const aims = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1];
console.log(`power  ${aims.map((a) => a.toFixed(2).padStart(6)).join('')}`);
for (let k = 0; k <= 16; k += 1) {
  const p = E.SKEE_MIN_POWER + (span * k) / 16;
  console.log(`${p.toFixed(2).padStart(5)}  ${aims.map((a) => trace(a * E.SKEE_MAX_AIM, p).result.padStart(6)).join('')}`);
}

// ── 5. How long a ball takes to settle, over a uniform spread of releases ──
const decide: number[] = [];
const onBoard: number[] = [];
for (let i = 0; i < 2000; i += 1) {
  const r = trace((rand() * 2 - 1) * E.SKEE_MAX_AIM, E.SKEE_MIN_POWER + rand() * span);
  if (!Number.isNaN(r.air) && !Number.isNaN(r.decided)) {
    decide.push(r.decided);
    onBoard.push(r.decided - r.lip - r.air);
  }
}
// ── 6. Snaps: a step that moves the ball further than its velocity explains ──
let snapThrows = 0;
let snapWorst = 0;
let snapSteps = 0;
for (let i = 0; i < 2000; i += 1) {
  const st = E.skeeStartThrow((rand() * 2 - 1) * E.SKEE_MAX_AIM, E.SKEE_MIN_POWER + rand() * span);
  let had = false;
  let px = st.x;
  let py = st.y;
  let pz = st.z;
  while (st.phase !== 'done' && st.steps < 16 * 240) {
    const [vx, vy, vz] = [st.vx, st.vy, st.vz];
    E.skeeStep(st);
    if (st.phase === 'board') {
      const j = Math.hypot(st.x - px - vx * DT, st.y - py - vy * DT, st.z - pz - vz * DT);
      snapWorst = Math.max(snapWorst, j);
      if (j > 0.04) {
        had = true;
        snapSteps += 1;
      }
    }
    [px, py, pz] = [st.x, st.y, st.z];
  }
  if (had) snapThrows += 1;
}

const pct = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))];
console.log(
  `\n— 5. ${decide.length} random releases that land: release to decision p50 ${pct(decide, 0.5).toFixed(2)} s, p90 ${pct(decide, 0.9).toFixed(2)} s, max ${pct(decide, 1).toFixed(2)} s; on the board after landing p50 ${pct(onBoard, 0.5).toFixed(2)} s, p90 ${pct(onBoard, 0.9).toFixed(2)} s, over 1.5 s ${((onBoard.filter((c) => c > 1.5).length / onBoard.length) * 100).toFixed(0)}% —`,
);
console.log(
  `\n— 6. snaps (a 4 ms step moving the ball over 0.04 units, a third of its radius, past its velocity): ${((snapThrows / 2000) * 100).toFixed(1)}% of 2000 random throws, ${snapSteps} steps, worst ${snapWorst.toFixed(3)} units —`,
);
