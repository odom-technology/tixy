/**
 * The sim behind Flap Happy's tiers (achievements/registry.ts) and flappy
 * bird's daily score quest (battlepass/daily-quests.ts).
 *
 *   npx tsx scripts/sim-flappy-tiers.ts
 *
 * Plays the shared sim (_flappy-sim.ts) with scripts/lib/flappy-bot.ts at
 * five skill levels, 1,000 runs each, and prints each level's run median and
 * the median best of 10 and of 50 runs: a first week and a regular's month.
 */
import { FLAPPY_SKILLS, playFlappyDirect } from './lib/flappy-bot';

const RUNS = 1000;
const q = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
};
const bestOf = (runs: number[], n: number) => {
  const out: number[] = [];
  for (let i = 0; i + n <= runs.length; i += n) out.push(Math.max(...runs.slice(i, i + n)));
  return out;
};

console.log('skill     timing  run p25  run p50  run p75  best of 10 p50  best of 50 p50');
for (const skill of FLAPPY_SKILLS) {
  const runs = Array.from({ length: RUNS }, (_, i) => playFlappyDirect(1000 + i, skill, 9000 + i, 60 * 60 * 20).score);
  console.log(
    [
      skill.label.padEnd(8),
      `${skill.timingMs} ms`.padStart(6),
      String(q(runs, 0.25)).padStart(8),
      String(q(runs, 0.5)).padStart(8),
      String(q(runs, 0.75)).padStart(8),
      String(q(bestOf(runs, 10), 0.5)).padStart(15),
      String(q(bestOf(runs, 50), 0.5)).padStart(15),
    ].join(' '),
  );
}
console.log('\nRuns are capped at 20 minutes (887 pipes).');
