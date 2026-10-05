/**
 * Ricochet by skill: score distributions for the achievement tiers, and what a
 * run pays by the minute.
 *
 *   npx tsx scripts/sim-ricochet.ts [runs]
 *
 * The real engine (stepRicochet) plays a bot per skill (scripts/lib/ricochet-
 * bot.ts): it aims at the middle of the gap it is flying toward with a
 * per-wall error, flaps when it is below that and not rising, sees the state a
 * few steps late and now and then misses a tap. Runs stop at 400 walls, which
 * is a flawless 8 minutes.
 *
 * Prints single-run p10 / p50 / p90, the median best after 10 runs (a first
 * session) and after 100 runs (a few weeks), because an achievement keeps a
 * player's best run, not their typical one. Then the tickets a run pays and
 * what that is an hour, for the reward check.
 */
import { calculateGameRewardCredits } from '@/server/arcade/rewards/wallet';
import { SKILLS, mulberry32, playClient } from './lib/ricochet-bot';

const RUNS = Number(process.argv[2] ?? 300);
const rand = mulberry32(0x51c0c4e7);
const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;
const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);

console.log(`Ricochet by skill, ${RUNS} runs each, runs capped at 400 walls`);
console.log('skill    run p10 / p50 / p90      best of 10 (p25-p75)   best of 100         minutes a run   tickets a run   tickets a minute');
for (const skill of SKILLS) {
  const scores: number[] = [];
  const minutes: number[] = [];
  const tickets: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    const seed = Math.floor(rand() * 2 ** 31);
    const run = playClient(seed, skill, rand, { maxWalls: 400 });
    scores.push(run.score);
    minutes.push(run.durationMs / 60000);
    tickets.push(calculateGameRewardCredits({ gameType: 'ricochet', score: run.score }));
  }
  const s = sorted(scores);
  const bestOf = (n: number) => {
    const bests: number[] = [];
    for (let i = 0; i < 600; i += 1) {
      let b = 0;
      for (let k = 0; k < n; k += 1) b = Math.max(b, scores[Math.floor(rand() * scores.length)]!);
      bests.push(b);
    }
    const sb = sorted(bests);
    return `${pct(sb, 0.5)} (${pct(sb, 0.25)}-${pct(sb, 0.75)})`;
  };
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  console.log(
    `${skill.name.padEnd(8)} ${String(pct(s, 0.1)).padStart(4)} / ${String(pct(s, 0.5)).padStart(4)} / ${String(pct(s, 0.9)).padStart(4)}   ${bestOf(10).padEnd(22)} ${bestOf(100).padEnd(18)} ${mean(minutes).toFixed(2).padStart(6)}          ${mean(tickets).toFixed(1).padStart(6)}          ${(mean(tickets) / mean(minutes)).toFixed(1).padStart(6)}`,
  );
}
