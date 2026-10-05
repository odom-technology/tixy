/**
 * Verifies flappy bird's server replay (src/server/arcade/flappy-replay.ts).
 *
 *   npm run test:flappy-replay
 *
 * - Honest runs are accepted with the score the player saw: a reference
 *   client (scripts/lib/flappy-bot.ts) plays through the page's own frame
 *   loop and step at 24, 30, 60, 120 and 144 Hz, with jitter, dropped frames
 *   and stalls, at five skill levels. The replay must reach the same score
 *   and tick, and the sim clock must never run ahead of the display clock,
 *   so the server's session-age check can't reject an honest run.
 * - The page plays the shared step: the client imports _flappy-sim.ts and
 *   keeps no physics of its own.
 * - Tampered runs are rejected: inflated or deflated claims, no flaps, a
 *   first flap that isn't tick 0, flaps out of order or repeated, flaps
 *   after the crash, another session's seed, a run longer than its session,
 *   and forged flaps (moved, added or dropped), unless the forgery happens
 *   to reach the claim, which is then a legal run.
 * - The ticket maths for the PR: tickets a minute for each skill, run time
 *   included, with the payout curve unchanged.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FLAPPY_STEP_MS } from '../src/app/(games)/flappy-bird/_flappy-sim';
import {
  FLAPPY_CLOCK_SLACK_MS,
  parseFlappyFlaps,
  replayFlappyRun,
  verifyFlappyRun,
} from '../src/server/arcade/flappy-replay';
import { calculateGameRewardCredits } from '../src/server/arcade/rewards/wallet';
import { FLAPPY_SKILLS, botRng, playFlappyClient, playFlappyDirect, type FrameClock } from './lib/flappy-bot';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let checks = 0;
const ok = (message: string) => {
  console.log(`ok  ${message}`);
};
const check = (cond: unknown, message: string) => {
  checks += 1;
  assert.ok(cond, message);
};

/* ── the page plays the shared step ──────────────────────────────────── */

{
  const client = readFileSync(path.join(root, 'src/app/(games)/flappy-bird/_flappy-bird-client.tsx'), 'utf8');
  check(/from '\.\/_flappy-sim'/.test(client), 'client imports _flappy-sim');
  check(/stepFlappy\(/.test(client), 'client steps with stepFlappy');
  for (const name of ['GRAVITY', 'JUMP_FORCE', 'PIPE_SPEED', 'PIPE_GAP']) {
    check(!new RegExp(`const ${name}\\s*=`).test(client), `client defines no ${name} of its own`);
  }
  check(!/Math\.random\(\)\s*\*\s*\(maxHeight/.test(client), 'client deals no gaps of its own');
  ok('the page plays the shared step and keeps no physics of its own');
}

/* ── honest runs through the page's frame loop ───────────────────────── */

const CLOCKS: FrameClock[] = [
  { hz: 24, jitter: 0.1 },
  { hz: 30, jitter: 0.15, drop: 0.02 },
  { hz: 60 },
  { hz: 60, jitter: 0.2, drop: 0.03, stall: 0.002, stallMs: 240 },
  { hz: 120, jitter: 0.1 },
  { hz: 144, jitter: 0.1, drop: 0.01 },
];

let honest = 0;
let honestScore = 0;
let longest = 0;
for (const skill of FLAPPY_SKILLS) {
  for (const clock of CLOCKS) {
    const runs = skill.label === 'expert' || skill.label === 'strong' ? 4 : 10;
    for (let i = 0; i < runs; i += 1) {
      const seed = (Math.imul(honest + 1, 2654435761) >>> 0) % 2 ** 31;
      const client = playFlappyClient(seed, skill, clock, { botSeed: seed ^ 0x5a5a, maxTicks: 60 * 60 * 8 });
      honest += 1;
      // A run cut at the cap hasn't crashed; the page never posts one.
      if (client.ticks >= 60 * 60 * 8) continue;
      const wire = parseFlappyFlaps(JSON.parse(JSON.stringify(client.flaps)));
      check(wire !== null, 'wire form parses');
      // The session is at least as old as the run on the display clock.
      const run = verifyFlappyRun(seed, wire!, client.score, { elapsedMs: client.wallMs });
      if (run.ok === false) {
        const { reason } = run as Extract<typeof run, { ok: false }>;
        throw new Error(`honest run rejected at ${clock.hz} Hz (${skill.label}, seed ${seed}): ${reason}`);
      }
      check(run.score === client.score, 'replay score equals the page');
      check(run.ticks === client.ticks, 'replay ticks equal the page');
      check(run.durationMs <= client.wallMs + 1e-6, 'the sim clock never runs ahead of the display');
      honestScore += run.score;
      longest = Math.max(longest, run.score);
    }
  }
}
ok(`${honest} honest runs through the frame loop at 24, 30, 60, 120 and 144 Hz accepted with the page's score (total ${honestScore}, longest ${longest} pipes)`);

/* ── determinism ─────────────────────────────────────────────────────── */

{
  const a = playFlappyDirect(77, FLAPPY_SKILLS[3]!, 1);
  const r1 = replayFlappyRun(77, a.flaps);
  const r2 = replayFlappyRun(77, a.flaps);
  check(r1.ok && r2.ok && r1.score === r2.score && r1.ticks === r2.ticks, 'the same flaps replay the same');
  check(r1.ok && r1.score === a.score && r1.ticks === a.ticks, 'direct play and replay agree');
  // A perfect player is never stopped by the rules: no flap error at all.
  const perfect = playFlappyDirect(2026, { label: 'perfect', timingMs: 0, aimPx: 0 }, 3, 60 * 60 * 5);
  check(perfect.score > 200, `a perfect run keeps going (${perfect.score} pipes in 5 minutes)`);
  ok(`replays are deterministic; a perfect player passes ${perfect.score} pipes in five minutes`);
}

/* ── tampered runs ───────────────────────────────────────────────────── */

const reject = (run: ReturnType<typeof verifyFlappyRun>, label: string) => {
  check(!run.ok, `${label} is rejected`);
};

const samples = Array.from({ length: 40 }, (_, i) => {
  const seed = 9000 + i * 17;
  return { seed, run: playFlappyDirect(seed, FLAPPY_SKILLS[2]!, seed + 1) };
}).filter(({ run }) => run.score >= 3);

let tampered = 0;
for (const { seed, run } of samples) {
  const flaps = run.flaps;
  const roomy = run.wallMs + 5000;
  reject(verifyFlappyRun(seed, flaps, run.score + 1, { elapsedMs: roomy }), 'a score one higher');
  reject(verifyFlappyRun(seed, flaps, run.score * 2 + 1, { elapsedMs: roomy }), 'a doubled score');
  reject(verifyFlappyRun(seed, flaps, 9999, { elapsedMs: roomy }), 'a 9999 claim');
  reject(verifyFlappyRun(seed, flaps, Math.max(0, run.score - 1), { elapsedMs: roomy }), 'a score one lower');
  reject(verifyFlappyRun(seed, flaps.slice(1).map((t) => t - flaps[1]!).slice(0, 0), run.score, { elapsedMs: roomy }), 'no flaps');
  reject(verifyFlappyRun(seed, flaps.map((t) => t + 3), run.score, { elapsedMs: roomy }), 'a first flap after tick 0');
  if (flaps.length > 3) {
    const swapped = [...flaps];
    [swapped[1], swapped[2]] = [swapped[2]!, swapped[1]!];
    reject(verifyFlappyRun(seed, swapped, run.score, { elapsedMs: roomy }), 'flaps out of order');
    const doubled = [...flaps.slice(0, 2), flaps[1]!, ...flaps.slice(2)];
    reject(verifyFlappyRun(seed, doubled, run.score, { elapsedMs: roomy }), 'a repeated flap tick');
  }
  reject(verifyFlappyRun(seed, [...flaps, run.ticks + 5], run.score, { elapsedMs: roomy }), 'a flap after the crash');
  reject(verifyFlappyRun(seed, flaps, run.score, { elapsedMs: run.wallMs - FLAPPY_CLOCK_SLACK_MS - 200 }), 'a run longer than its session');
  reject(verifyFlappyRun(seed, flaps, run.score, { elapsedMs: run.wallMs / 5 }), 'a run at five times speed');
  tampered += 11;
}
ok(`${samples.length} runs each rejected with a raised, doubled, 9999 or lowered score, no flaps, a late first flap, flaps out of order or repeated, a flap after the crash, and a session too young for the run`);

// Another session's seed: the gaps are elsewhere, so the same flaps crash.
{
  let rejected = 0;
  for (const { seed, run } of samples) {
    const other = verifyFlappyRun(seed + 1, run.flaps, run.score, { elapsedMs: run.wallMs + 5000 });
    if (!other.ok) rejected += 1;
  }
  check(rejected >= samples.length - 1, `another seed: ${rejected} of ${samples.length} rejected`);
  ok(`another session's seed: ${rejected} of ${samples.length} rejected`);
}

// Forged flaps: one moved, added or dropped. Most change the run; one that
// happens to reach the same score is a legal run of the game and stands.
{
  const rng = botRng(4242);
  let forged = 0;
  let caught = 0;
  for (const { seed, run } of samples) {
    for (let k = 0; k < 3; k += 1) {
      const flaps = [...run.flaps];
      const i = 1 + Math.floor(rng.next() * (flaps.length - 1));
      if (k === 0) flaps[i] = flaps[i]! + 4 + Math.floor(rng.next() * 8);
      if (k === 1) flaps.splice(i, 1);
      if (k === 2) flaps.splice(i, 0, flaps[i - 1]! + 6);
      const sorted = flaps.every((t, j) => j === 0 || t > flaps[j - 1]!);
      if (!sorted) continue;
      forged += 1;
      // The forger claims a better score than the honest run reached.
      const claim = run.score + 3;
      if (!verifyFlappyRun(seed, flaps, claim, { elapsedMs: run.wallMs + 5000 }).ok) caught += 1;
    }
  }
  check(caught === forged, `forged flaps claiming 3 more pipes: ${caught} of ${forged} rejected`);
  ok(`forged flaps claiming 3 more pipes than the run reached: ${caught} of ${forged} rejected`);
}

// The wire form.
{
  check(parseFlappyFlaps(undefined) === null, 'no flap list');
  check(parseFlappyFlaps([]) === null, 'an empty flap list');
  check(parseFlappyFlaps([0, 1.5]) === null, 'a fractional tick');
  check(parseFlappyFlaps([0, -1]) === null, 'a negative tick');
  check(parseFlappyFlaps([0, '12']) === null, 'a string tick');
  check(parseFlappyFlaps(new Array(100_001).fill(0)) === null, 'over 100,000 flaps');
  check(JSON.stringify(parseFlappyFlaps([0, 20, 41])) === '[0,20,41]', 'a good list');
  ok('the wire form takes whole, non-negative ticks only');
}

/* ── tickets a minute ────────────────────────────────────────────────── */

// Between runs: the crash and its fall (about 0.9 s), the result, the
// rematch press and the session fetch (about 2.5 s), and the hover before
// the first flap (about 0.6 s). Before this change the bird fell at once
// and the run's first second was the same fall, so the gap was the same
// to within half a second.
const BETWEEN_RUNS_S = 4;
console.log('');
console.log('tickets a minute, by skill (payout curve unchanged: 75 × (1 − e^−(score/75)^1.15)):');
for (const skill of FLAPPY_SKILLS) {
  let tickets = 0;
  let seconds = 0;
  let scores = 0;
  const n = skill.label === 'expert' ? 60 : 200;
  for (let i = 0; i < n; i += 1) {
    const run = playFlappyDirect(30_000 + i, skill, 40_000 + i, 60 * 60 * 20);
    tickets += calculateGameRewardCredits({ gameType: 'flappy-bird', score: run.score });
    seconds += run.ticks * (FLAPPY_STEP_MS / 1000) + BETWEEN_RUNS_S;
    scores += run.score;
  }
  console.log(
    `  ${skill.label.padEnd(7)} mean score ${(scores / n).toFixed(1).padStart(6)}, mean run ${(seconds / n).toFixed(1).padStart(6)} s, ${(tickets / n).toFixed(1).padStart(5)} tickets a run, ${((tickets / seconds) * 60).toFixed(1).padStart(5)} a minute`,
  );
}
console.log('');

console.log(`${checks} checks passed (${tampered} tampered claims among them).`);
