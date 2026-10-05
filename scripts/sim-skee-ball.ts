/**
 * Skee-ball by skill: what a frame scores and pays, for an engine.
 *
 *   npx tsx scripts/sim-skee-ball.ts [--engine=path/to/skee-ball-replay.ts]
 *     [--throws=10000] [--divisor=260]
 *
 * A simulated player has a skill: the spread of their launch speed and
 * aim, as a share of the engine's range (normal noise). Each player first
 * picks the release they aim for, the one that scores best for their own
 * spread (searched on a grid, 400 throws a candidate), then plays frames
 * through skeeApplyThrow (the same state machine the server replays) with
 * a fresh seed per frame, until about --throws throws. Tickets per frame
 * are the reward curve's (calculateGameRewardCredits) for each frame's
 * score, with the divisor scaled by --divisor / 260.
 *
 * Run it on the base branch's engine (git show origin/tixy/rev2:...) and on
 * this one to compare. Deterministic: the noise comes from a fixed seed.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { calculateGameRewardCredits } from '../src/server/arcade/rewards/wallet';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    return match ? [match[1], match[2] ?? 'true'] : [arg, 'true'];
  }),
) as Record<string, string>;

type Engine = {
  SKEE_MIN_POWER: number;
  SKEE_MAX_POWER: number;
  SKEE_MAX_AIM: number;
  SKEE_BALLS_PER_SESSION: number;
  skeeSimulateThrow: (aim: number, power: number) => { outcome: { basePoints: number; ring: number | null } };
  skeeInitialState: () => { balls: number; score: number; ballsAllowed?: number };
  skeeApplyThrow: (
    seed: number,
    state: { balls: number; score: number; ballsAllowed?: number },
    t: number,
    aim: number,
    power: number,
  ) => { state: { balls: number; score: number; ballsAllowed?: number }; event: { type: string } };
};

const enginePath = path.resolve(args.engine ?? 'src/server/arcade/skee-ball-replay.ts');
const E = (await import(pathToFileURL(enginePath).href)) as Engine;
const THROWS = Number(args.throws ?? 10_000);
const DIVISOR = Number(args.divisor ?? 260);

// Deterministic noise.
let rngState = 0x2545f491;
const rand = () => {
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const normal = () => {
  const u = Math.max(1e-12, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
};

const span = E.SKEE_MAX_POWER - E.SKEE_MIN_POWER;
const skills = [
  { name: 'first go', power: 0.15, aim: 0.3 },
  { name: 'casual', power: 0.09, aim: 0.2 },
  { name: 'good', power: 0.05, aim: 0.12 },
  { name: 'sharp', power: 0.03, aim: 0.07 },
];

const tickets = (score: number) =>
  calculateGameRewardCredits({ gameType: 'skee-ball', score: (score * 260) / DIVISOR });

const rows: string[] = [];
for (const skill of skills) {
  const release = (target: { aim: number; power: number }) => ({
    aim: target.aim + normal() * skill.aim * E.SKEE_MAX_AIM,
    power: target.power + normal() * skill.power * span,
  });
  // The release this player aims for: best mean points for their spread.
  let best = { aim: 0, power: E.SKEE_MIN_POWER, mean: -1 };
  for (let p = E.SKEE_MIN_POWER; p <= E.SKEE_MAX_POWER + 1e-9; p += span / 40) {
    for (const a of [0, 0.25, 0.5, 0.75].map((k) => k * E.SKEE_MAX_AIM)) {
      let sum = 0;
      for (let i = 0; i < 400; i += 1) {
        const r = release({ aim: a, power: p });
        sum += E.skeeSimulateThrow(r.aim, r.power).outcome.basePoints;
      }
      if (sum / 400 > best.mean) best = { aim: a, power: p, mean: sum / 400 };
    }
  }

  let throws = 0;
  let frames = 0;
  let scoreSum = 0;
  let ticketSum = 0;
  let balls = 0;
  const ringCount: Record<string, number> = {};
  while (throws < THROWS) {
    const seed = Math.floor(rand() * 0x7fffffff);
    let state = E.skeeInitialState();
    let t = 0;
    for (;;) {
      const allowed = state.ballsAllowed ?? E.SKEE_BALLS_PER_SESSION;
      if (state.balls >= allowed) break;
      const r = release(best);
      const ring = E.skeeSimulateThrow(r.aim, r.power).outcome.ring;
      ringCount[String(ring ?? 0)] = (ringCount[String(ring ?? 0)] ?? 0) + 1;
      state = E.skeeApplyThrow(seed, state, t, r.aim, r.power).state;
      t += 2_000;
      throws += 1;
    }
    balls += state.balls;
    frames += 1;
    scoreSum += state.score;
    ticketSum += tickets(state.score);
  }
  const share = (k: string) => `${(((ringCount[k] ?? 0) / throws) * 100).toFixed(0)}%`;
  rows.push(
    `| ${skill.name} | ${best.power.toFixed(2)}, ${best.aim.toFixed(2)} | ${frames} | ${(balls / frames).toFixed(2)} | ${(scoreSum / frames).toFixed(1)} | ${(ticketSum / frames).toFixed(2)} | ${['0', '10', '20', '30', '40', '50', '100'].map(share).join(' / ')} |`,
  );
}

console.log(`engine ${path.relative(process.cwd(), enginePath)}, about ${THROWS} throws a skill, divisor ${DIVISOR}`);
console.log('| skill | aims for (power, aim) | frames | balls a frame | mean score | mean tickets | 0 / 10 / 20 / 30 / 40 / 50 / 100 |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (const row of rows) console.log(row);
