/**
 * Skee-ball score distribution by skill, used to set the tiers of the
 * "skee-ball-score" achievement series in src/server/arcade/achievements.
 *
 * Usage: tsx scripts/sim-skeeball-thresholds.ts
 *
 * A bot throws a 9-ball frame through the real replay code (skeeApplyThrow).
 * Skill is the Gaussian error on aim and power. Each ball it picks the
 * nominal throw with the best expected points for that ball's lit ring and
 * multiplier, given its own error, then throws it with the error applied.
 * 400 seeds per skill. Prints p10, p50, p90 and the best run.
 */
import {
  SKEE_BALLS_PER_SESSION,
  SKEE_MAX_POWER,
  SKEE_MIN_POWER,
  skeeApplyThrow,
  skeeBallBonusFor,
  skeeInitialState,
  skeeSimulateThrow,
} from '../src/server/arcade/skee-ball-replay';

const SEEDS = 400;
const SAMPLES = 24;

const SKILLS = [
  { name: 'novice', aim: 0.9, power: 1.4 },
  { name: 'casual', aim: 0.5, power: 0.9 },
  { name: 'good', aim: 0.3, power: 0.55 },
  { name: 'strong', aim: 0.18, power: 0.35 },
  { name: 'expert', aim: 0.1, power: 0.2 },
  { name: 'perfect', aim: 0, power: 0 },
] as const;

let state32 = 0x2545f491;
const rand = () => {
  state32 ^= state32 << 13;
  state32 ^= state32 >>> 17;
  state32 ^= state32 << 5;
  return ((state32 >>> 0) % 1_000_000) / 1_000_000;
};
const gauss = () =>
  Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

type Candidate = { aim: number; power: number; ringProb: Map<number, number> };

function candidatesFor(sa: number, sp: number): Candidate[] {
  const out: Candidate[] = [];
  for (let aim = -1.6; aim <= 1.601; aim += 0.2) {
    for (let power = SKEE_MIN_POWER; power <= SKEE_MAX_POWER + 0.01; power += 0.2) {
      const ringProb = new Map<number, number>();
      for (let i = 0; i < SAMPLES; i += 1) {
        const o = skeeSimulateThrow(aim + gauss() * sa, power + gauss() * sp).outcome;
        if (o.kind === 'ring' && o.ring) ringProb.set(o.ring, (ringProb.get(o.ring) ?? 0) + 1 / SAMPLES);
      }
      out.push({ aim, power, ringProb });
    }
  }
  return out;
}

const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];

for (const skill of SKILLS) {
  const cands = candidatesFor(skill.aim, skill.power);
  const scores: number[] = [];
  for (let s = 0; s < SEEDS; s += 1) {
    const seed = 7001 + s * 7919;
    let state = skeeInitialState();
    let t = 500;
    for (let i = 0; i < SKEE_BALLS_PER_SESSION; i += 1) {
      const bonus = skeeBallBonusFor(seed, i);
      let best = cands[0];
      let bestEv = -1;
      for (const c of cands) {
        let ev = 0;
        for (const [ring, p] of c.ringProb) ev += p * ring * (ring === bonus.ring ? bonus.mult : 1);
        if (ev > bestEv) {
          bestEv = ev;
          best = c;
        }
      }
      const aim = best.aim + gauss() * skill.aim;
      const power = best.power + gauss() * skill.power;
      state = skeeApplyThrow(seed, state, t, aim, power).state;
      t += 2_000;
    }
    scores.push(state.score);
  }
  scores.sort((a, b) => a - b);
  console.log(
    `${skill.name.padEnd(8)} p10 ${pct(scores, 0.1)}  p50 ${pct(scores, 0.5)}  p90 ${pct(scores, 0.9)}  max ${scores[scores.length - 1]}`,
  );
}
