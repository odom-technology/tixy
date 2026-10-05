/**
 * Ring toss tuning by simulation: simulated players of five skills play
 * whole rounds through the shared engine (src/server/arcade/ring-toss-engine.ts),
 * rings at rest and all, and the script prints what they score.
 *
 *   npx tsx scripts/sim-ring-toss.ts [--rounds=400] [--rows]
 *
 * A player's hand is noisy where people are noisy:
 *  - flick speed: a share of the speed (Weber's law), so far rows are harder;
 *  - where the finger starts (the column it points at), in metres at the necks;
 *  - the flick's slant (sideways over forward), which bends the aim;
 *  - its hook (curl), which banks the ring.
 * Each player knows the flick for each row (the best of a sweep) and aims at
 * the bottle with the best value for their own hit rate: usually the gold.
 * Time between rings is a reading pause plus the ring's flight.
 *
 * `--rows` prints the ringer rate per row for each skill on an empty crate.
 */
import {
  AIM_RANGE,
  BOTTLES,
  GOLD_VALUE,
  RING_COUNT,
  RING_ROUND_MS,
  ringAimDepth,
  ringGoldBottle,
  ringReadyMs,
  ringRoundFinish,
  ringRoundInitial,
  ringRoundStart,
  ringSimulateThrow,
  ringStep,
  type RingParams,
  type RingRoundState,
} from '../src/server/arcade/ring-toss-engine';
import { FLICK_FULL_AIM, FLICK_MAX_SPEED, FLICK_MIN_SPEED, flickAimShift } from '../src/app/(games)/ring-toss/_ring-flick';

export type Skill = {
  name: string;
  /** Flick speed SD as a share of the speed. */
  speed: number;
  /** Finger placement SD at the necks (m). */
  place: number;
  /** Slant SD (sideways over forward). */
  slant: number;
  /** Curl SD. */
  curl: number;
  /** Seconds between a ring coming to rest and the next flick: mean and SD. */
  pause: [number, number];
};

export const SKILLS: readonly Skill[] = [
  { name: 'first go', speed: 0.16, place: 0.012, slant: 0.1, curl: 0.35, pause: [1.6, 0.5] },
  { name: 'casual', speed: 0.11, place: 0.008, slant: 0.07, curl: 0.25, pause: [1.2, 0.4] },
  { name: 'good', speed: 0.075, place: 0.005, slant: 0.05, curl: 0.18, pause: [0.9, 0.3] },
  { name: 'sharp', speed: 0.05, place: 0.004, slant: 0.035, curl: 0.12, pause: [0.7, 0.2] },
  { name: 'machine', speed: 0.01, place: 0.001, slant: 0.005, curl: 0.02, pause: [0.25, 0.05] },
];

/** A seeded normal source (Box-Muller over an LCG). */
export function makeRandom(seed: number) {
  let s = seed >>> 0;
  const uni = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s + 0.5) / 4294967296;
  };
  return {
    uni,
    gauss: () => Math.sqrt(-2 * Math.log(uni())) * Math.cos(2 * Math.PI * uni()),
  };
}

const speedFor = (p: number) => FLICK_MIN_SPEED + p * (FLICK_MAX_SPEED - FLICK_MIN_SPEED);
const powerFor = (f: number) => Math.min(1, Math.max(0, (f - FLICK_MIN_SPEED) / (FLICK_MAX_SPEED - FLICK_MIN_SPEED)));

/** The power that rings each row most often with a steady hand (a sweep). */
export function bestPowerByRow(): number[] {
  const out: number[] = [];
  for (let row = 0; row < 4; row += 1) {
    let best = -1;
    let bestP = 0;
    for (let p = row * 0.22 + 0.04; p <= row * 0.22 + 0.3; p += 0.005) {
      let hits = 0;
      for (const col of [0, 1, 2, 3]) {
        for (const d of [-0.012, 0, 0.012]) {
          for (const dp of [-0.015, 0, 0.015]) {
            const b = BOTTLES[row * 4 + col]!;
            const s = ringSimulateThrow({ h: (0.5 * b.x) / AIM_RANGE, p: p + dp, a: (b.x + d) / AIM_RANGE, c: 0 });
            if (s.outcome?.kind === 'ringer' && s.outcome.bottle === b.index) hits += 1;
          }
        }
      }
      if (hits > best) {
        best = hits;
        bestP = p;
      }
    }
    out.push(Math.round(bestP * 1000) / 1000);
  }
  return out;
}

/** One noisy flick at a bottle. */
export function noisyFlick(skill: Skill, bottle: number, powerByRow: readonly number[], rnd: ReturnType<typeof makeRandom>): RingParams {
  const b = BOTTLES[bottle]!;
  const f = speedFor(powerByRow[b.row]!) * (1 + skill.speed * rnd.gauss());
  const sightX = b.x + skill.place * rnd.gauss();
  const slant = Math.max(-1, Math.min(1, (skill.slant * rnd.gauss()) / FLICK_FULL_AIM));
  const aimX = sightX + slant * flickAimShift(ringAimDepth(powerFor(f)));
  const r4 = (v: number) => Math.round(v * 10000) / 10000;
  return {
    h: r4(Math.max(-1, Math.min(1, (0.5 * sightX) / AIM_RANGE))),
    p: r4(powerFor(f)),
    a: r4(Math.max(-1, Math.min(1, aimX / AIM_RANGE))),
    c: r4(Math.max(-1, Math.min(1, skill.curl * rnd.gauss()))),
  };
}

/** Ringer rate by row on an empty crate. */
export function rowRates(skill: Skill, powerByRow: readonly number[], n = 240, seed = 1): number[] {
  const rnd = makeRandom(seed);
  return [0, 1, 2, 3].map((row) => {
    let hits = 0;
    for (let i = 0; i < n; i += 1) {
      const bottle = row * 4 + (i % 4);
      const s = ringSimulateThrow(noisyFlick(skill, bottle, powerByRow, rnd));
      if (s.outcome?.kind === 'ringer' && s.outcome.bottle === bottle) hits += 1;
    }
    return hits / n;
  });
}

export type RoundStats = { score: number; ringers: number; golds: number; thrown: number; durationMs: number; throws: Array<RingParams & { t: number }> };

/** A whole round: the player throws at the best bottle for them until 10 rings or 30 s. */
export function playRound(skill: Skill, seed: number, powerByRow: readonly number[], rates: readonly number[], rnd: ReturnType<typeof makeRandom>): RoundStats {
  const round: RingRoundState = ringRoundInitial(seed);
  const throws: Array<RingParams & { t: number }> = [];
  let t = 400 + Math.max(150, (skill.pause[0] + skill.pause[1] * rnd.gauss()) * 1000);
  let lastEnd = 0;
  while (round.thrown < RING_COUNT && t <= RING_ROUND_MS) {
    const gold = ringGoldBottle(seed, round.thrown);
    // Best value for this hand: the gold, unless a row pays more for them.
    let target = gold;
    let bestEv = GOLD_VALUE * rates[BOTTLES[gold]!.row]!;
    for (const b of BOTTLES) {
      const ev = b.value * rates[b.row]!;
      if (ev > bestEv) {
        bestEv = ev;
        target = b.index;
      }
    }
    const params = noisyFlick(skill, target, powerByRow, rnd);
    const tt = Math.floor(t);
    throws.push({ ...params, t: tt });
    const s = ringRoundStart(round, params);
    while (!s.done) ringStep(s);
    ringRoundFinish(round, tt, s);
    lastEnd = tt + ringReadyMs(s);
    t = lastEnd + Math.max(150, (skill.pause[0] + skill.pause[1] * rnd.gauss()) * 1000);
  }
  return { score: round.score, ringers: round.ringers, golds: round.golds, thrown: round.thrown, durationMs: Math.max(lastEnd, Math.min(t, RING_ROUND_MS)), throws };
}

export function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
  const rounds = Number(args.rounds ?? 400);
  const powerByRow = bestPowerByRow();
  console.log(`best power by row: ${powerByRow.join(', ')} (flick ${powerByRow.map((p) => speedFor(p).toFixed(2)).join(', ')} px/ms)`);
  console.log('\nringer rate on an empty crate, by row (front to back)');
  const ratesBySkill = new Map<string, number[]>();
  for (const skill of SKILLS) {
    const rates = rowRates(skill, powerByRow);
    ratesBySkill.set(skill.name, rates);
    console.log(`${skill.name.padEnd(9)} ${rates.map((r) => `${(r * 100).toFixed(0)}%`.padStart(5)).join(' ')}`);
  }
  if (args.rows) return;
  console.log(`\nwhole rounds (${rounds} each, rings at rest stay on the crate)`);
  console.log('skill      mean   p10   p50   p90   max  ringers  golds  rings  seconds');
  for (const skill of SKILLS) {
    const rnd = makeRandom(1000 + skill.name.length);
    const out: RoundStats[] = [];
    for (let i = 0; i < rounds; i += 1) out.push(playRound(skill, (0x9e3779b1 * (i + 1)) >>> 0, powerByRow, ratesBySkill.get(skill.name)!, rnd));
    const scores = out.map((r) => r.score);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    console.log(
      `${skill.name.padEnd(9)} ${mean(scores).toFixed(0).padStart(5)} ${String(quantile(scores, 0.1)).padStart(5)} ${String(quantile(scores, 0.5)).padStart(5)} ${String(quantile(scores, 0.9)).padStart(5)} ${String(Math.max(...scores)).padStart(5)}` +
        `  ${mean(out.map((r) => r.ringers)).toFixed(2).padStart(7)} ${mean(out.map((r) => r.golds)).toFixed(2).padStart(6)} ${mean(out.map((r) => r.thrown)).toFixed(1).padStart(6)} ${(mean(out.map((r) => r.durationMs)) / 1000).toFixed(1).padStart(8)}`,
    );
  }
}

if (process.argv[1] && /sim-ring-toss/.test(process.argv[1])) main();
