/**
 * Ticket stop (the lock): simulated players, for tuning.
 *
 *   npx tsx scripts/sim-ticket-stop-lock.ts [--runs=2000]
 *
 * A simulated player aims each tap at the moment the needle reaches the
 * dot's centre and misses that moment by a normal error with SD `sigma` ms,
 * plus a per-run bias. Dots that arrive quickly are harder to read: when
 * the needle reaches a dot less than READ_MS after it appeared, sigma grows
 * (up to 1.8x at no time at all). `lapse` is the chance per dot of a slip
 * (a tap that lands nowhere near). Every tap goes through scoreLockRun, the
 * same replay the server will use.
 */
import {
  LOCK_HIT_HALF_DEG,
  LOCK_LEVEL_GAP_MS,
  lockHitsThrough,
  lockLayout,
  lockLevelRule,
  lockReplay,
  scoreLockRun,
  TICKET_STOP_LOCK_REWARD_DIVISOR,
} from '../src/server/arcade/ticket-stop-lock-engine';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    return match ? [match[1], match[2] ?? 'true'] : [arg, 'true'];
  }),
) as Record<string, string>;
const RUNS = Number(args.runs ?? 2000);

const READ_MS = 450;
/** Seconds between runs: the result card, rematch. */
const RESULT_S = 6;

export type Skill = { name: string; sigma: number; lapse: number };
const SKILLS: Skill[] = [
  { name: 'first go', sigma: 60, lapse: 0.02 },
  { name: 'new', sigma: 48, lapse: 0.012 },
  { name: 'casual', sigma: 34, lapse: 0.006 },
  { name: 'good', sigma: 24, lapse: 0.003 },
  { name: 'sharp', sigma: 15, lapse: 0.0015 },
];

function mulberry32(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const normal = (rng: () => number) => {
  const u = Math.max(1e-12, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
};

/** `quantMs`: the player's clock only ticks this often (a rounded timer), so
 *  every tap lands on a multiple of it. */
export function simulateRun(seed: number, skill: Skill, rng: () => number, opts: { quantMs?: number } = {}) {
  const layout = lockLayout(seed);
  const taps: number[] = [];
  const bias = normal(rng) * skill.sigma * 0.3;
  for (let guard = 0; guard < 400; guard += 1) {
    const { segment, end } = lockReplay(layout, taps);
    if (end) break;
    const centreMs = segment.startMs + (segment.toCentreDeg * 1000) / segment.rule.speedDps;
    // The dot appeared at the last hit (or, for a level's first dot, a gap
    // earlier), so a level's first dot has longer to read.
    const shownFor = centreMs - segment.startMs + (segment.dot.inLevel === 0 ? LOCK_LEVEL_GAP_MS : 0);
    const rush = Math.max(0, (READ_MS - shownFor) / READ_MS);
    const sigma = skill.sigma * (1 + 0.8 * rush);
    let tap: number;
    if (rng() < skill.lapse) {
      // A slip: early by a lot, or no tap at all (the needle passes).
      if (rng() < 0.5) tap = centreMs - 150 - rng() * 200;
      else break;
    } else {
      tap = centreMs + bias + normal(rng) * sigma;
    }
    const q = opts.quantMs && opts.quantMs > 1 ? opts.quantMs : 0;
    tap = q ? Math.round(Math.round(tap / q) * q) : Math.round(tap);
    // A waiting tap is ignored; press at the start.
    if (tap < segment.startMs) tap = q ? Math.ceil(segment.startMs / q) * q : segment.startMs;
    const passMs = segment.passMs;
    if (tap > passMs) break; // too late: the needle passed
    taps.push(tap);
  }
  const run = scoreLockRun(seed, taps);
  if (!run.ok) throw new Error(`sim produced a rejected run: ${JSON.stringify(run)}`);
  return run;
}

/** The wallet's skill curve (rewards/wallet.ts): 75 * (1 - e^-(score/D)^1.15),
 *  before the daily cap. */
const tickets = (score: number) =>
  Math.floor(75 * (1 - Math.exp(-Math.pow(Math.max(0, score) / TICKET_STOP_LOCK_REWARD_DIVISOR, 1.15))));

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

if (process.argv[1]?.endsWith('sim-ticket-stop-lock.ts')) {
  console.log('levels:');
  for (let l = 1; l <= 14; l += 1) {
    const r = lockLevelRule(l);
    const halfMs = ((LOCK_HIT_HALF_DEG) * 1000) / r.speedDps;
    console.log(
      `  L${l}: ${r.hits} hits, ${r.speedDps} deg/s (lap ${(360 / r.speedDps).toFixed(2)} s), window ±${halfMs.toFixed(0)} ms, spawn ${r.spawnMinDeg.toFixed(0)}-${r.spawnMaxDeg} deg, ${lockHitsThrough(l)} hits through`,
    );
  }
  console.log(`\n${RUNS} runs per skill. levels cleared p10 / median / p90, mean score, mean run s, tickets at divisor ${TICKET_STOP_LOCK_REWARD_DIVISOR} (per run, per minute with ${RESULT_S} s between runs), share clearing L1, L2, L8`);
  for (const skill of SKILLS) {
    const rng = mulberry32(skill.sigma * 7919 + 13);
    const cleared: number[] = [];
    const scores: number[] = [];
    const secs: number[] = [];
    for (let i = 0; i < RUNS; i += 1) {
      const seed = (rng() * 2 ** 31) | 0;
      const run = simulateRun(seed, skill, rng);
      if (!run.ok) continue;
      cleared.push(run.levelsCleared);
      scores.push(run.score);
      secs.push(run.durationMs / 1000);
    }
    const sorted = [...cleared].sort((a, b) => a - b);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const share = (k: number) => cleared.filter((c) => c >= k).length / cleared.length;
    console.log(
      `  ${skill.name.padEnd(8)} σ${String(skill.sigma).padStart(3)}: ${pct(sorted, 0.1)} / ${pct(sorted, 0.5)} / ${pct(sorted, 0.9)}` +
        `  score ${mean(scores).toFixed(1)} (p90 ${pct([...scores].sort((a, b) => a - b), 0.9)})` +
        `  ${mean(secs).toFixed(1)} s  tickets ${mean(scores.map(tickets)).toFixed(1)}/run, ${(mean(scores.map(tickets)) / ((mean(secs) + RESULT_S) / 60)).toFixed(0)}/min  L1 ${(share(1) * 100).toFixed(0)}% L2 ${(share(2) * 100).toFixed(0)}% L8 ${(share(8) * 100).toFixed(0)}%`,
    );
  }
}
