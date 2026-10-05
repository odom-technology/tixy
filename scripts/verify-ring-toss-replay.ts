/**
 * Ring toss: the replay, the reward curve and the play check.
 *
 *   npx tsx scripts/verify-ring-toss-replay.ts [--rounds=120]
 *
 * 1. The client and the server agree. Simulated rounds are played the way
 *    the client plays them (the flight stepped ahead into a buffer by a few
 *    hundred steps a frame, drawn at 30 to 144 Hz with stalls and hit-stops)
 *    and replayed the way the server does (validateRingRun). Same rings, same
 *    poses to the last bit, same score.
 * 2. Tampered runs are rejected: a changed score, a flick before the ring is
 *    ready, after the round, out of order, not a number, too many.
 * 3. The reward divisor is the one solved from the simulated players (a good
 *    one earns about 51 tickets a minute with 6 s between rounds).
 * 4. RING_BEST_POWER is what the sweep finds.
 * 5. The play check flags no simulated hand and flags a machine.
 * 6. The achievement tiers and the quest's score sit where the tables say.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  RING_COUNT,
  RING_ROUND_MS,
  RING_STEP_MS,
  ringCheckThrow,
  ringRoundFinish,
  ringRoundInitial,
  ringRoundStart,
  ringStep,
  validateRingRun,
  type RingThrow,
} from '../src/server/arcade/ring-toss-engine';
import { RING_BEST_POWER, RING_REWARD_DIVISOR, ringOffsets, ringPlayCheck } from '../src/server/arcade/ring-toss-play';
import { calculateGameRewardCredits } from '../src/server/arcade/rewards/wallet';
import { createRingPlayback, type RingPose } from '../src/app/(games)/ring-toss/_ring-flick';
import { SKILLS, bestPowerByRow, makeRandom, playRound, quantile, rowRates, type RoundStats } from './sim-ring-toss';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const ROUNDS = Number(args.rounds ?? 120);

let checks = 0;
const ok = (label: string) => {
  checks += 1;
  console.log(`ok  ${label}`);
};

// ── 0. Only arithmetic that is the same in every engine ──
{
  const src = readFileSync(new URL('../src/server/arcade/ring-toss-engine.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const banned = src.match(/Math\.(sin|cos|tan|atan2?|hypot|pow|exp|log|cbrt|random)\b/g);
  assert.equal(banned, null, `the engine calls ${banned?.join(', ')}`);
  assert.ok(!/Date\.now|performance\.now/.test(src), 'the engine reads no clock');
  ok('the engine uses only + - * / and Math.sqrt (no sin, cos, atan, hypot, pow, exp, random, clocks)');
}

// ── 1. Client playback against the server's replay ──

/** Play a round's flicks the way the client does, at a display rate. */
function clientPlay(seed: number, throws: readonly RingThrow[], hz: number, rnd: ReturnType<typeof makeRandom>) {
  const round = ringRoundInitial(seed);
  const poses: RingPose[] = [];
  for (const thr of throws) {
    if (ringCheckThrow(round, thr.t, thr) !== 'ok') continue;
    const playback = createRingPlayback(ringRoundStart(round, thr));
    playback.lookahead(60);
    let ms = 0;
    const pose: RingPose = { x: 0, y: 0, z: 0, qw: 1, qx: 0, qy: 0, qz: 0 };
    for (let frame = 0; frame < 4000; frame += 1) {
      // A frame, sometimes a stall, sometimes a hit-stop that holds the clock.
      let dt = 1000 / hz;
      const r = rnd.uni();
      if (r < 0.02) dt += 250 + rnd.uni() * 750;
      else if (r < 0.05) dt = 0;
      playback.lookahead(40 + Math.floor(rnd.uni() * 300));
      ms += Math.min(250, dt);
      const stepped = playback.totalSteps * RING_STEP_MS;
      if (!playback.finished && ms > stepped) ms = stepped;
      playback.sample(ms, pose);
      if (playback.finished && ms >= stepped) break;
    }
    assert.ok(playback.finished, 'playback finishes');
    // The picture ends on the ring's resting pose (to rounding: the drawn
    // quaternion is renormalised), and the round records the state itself.
    const st = playback.state;
    assert.ok(Math.abs(pose.x - st.x) < 1e-12 && Math.abs(pose.qw - st.qw) < 1e-12, 'the last frame drawn is the resting pose');
    poses.push({ x: st.x, y: st.y, z: st.z, qw: st.qw, qx: st.qx, qy: st.qy, qz: st.qz });
    ringRoundFinish(round, thr.t, playback.state);
  }
  return { round, poses };
}

function serverPoses(seed: number, throws: readonly RingThrow[]): RingPose[] {
  const round = ringRoundInitial(seed);
  const out: RingPose[] = [];
  for (const thr of throws) {
    if (ringCheckThrow(round, thr.t, thr) !== 'ok') continue;
    const s = ringRoundStart(round, thr);
    while (!s.done) ringStep(s);
    out.push({ x: s.x, y: s.y, z: s.z, qw: s.qw, qx: s.qx, qy: s.qy, qz: s.qz });
    ringRoundFinish(round, thr.t, s);
  }
  return out;
}

const powerByRow = RING_BEST_POWER;
const sampleRounds: Array<{ seed: number; stats: RoundStats }> = [];
{
  const rnd = makeRandom(4242);
  const rates = [0.6, 0.4, 0.35, 0.3];
  for (let i = 0; i < 12; i += 1) {
    const skill = SKILLS[i % SKILLS.length]!;
    const seed = (0x27d4eb2f * (i + 11)) >>> 0;
    sampleRounds.push({ seed, stats: playRound(skill, seed, powerByRow, rates, rnd) });
  }
}
{
  const rnd = makeRandom(99);
  let compared = 0;
  for (const { seed, stats } of sampleRounds) {
    const server = validateRingRun(seed, stats.throws);
    assert.equal(server.stop === 'complete' || server.stop === 'end', true);
    assert.equal(server.skipped, 0, 'a simulated round has no skipped flicks');
    assert.equal(server.score, stats.score, 'replay score equals the round played');
    const want = serverPoses(seed, stats.throws);
    for (const hz of [30, 60, 90, 120, 144]) {
      const client = clientPlay(seed, stats.throws, hz, rnd);
      assert.equal(client.round.score, server.score, `score at ${hz} Hz`);
      assert.equal(client.poses.length, want.length);
      for (let k = 0; k < want.length; k += 1) {
        const a = client.poses[k]!;
        const b = want[k]!;
        assert.ok(a.x === b.x && a.y === b.y && a.z === b.z && a.qw === b.qw && a.qx === b.qx && a.qy === b.qy && a.qz === b.qz, `ring ${k} rests at the same pose to the bit at ${hz} Hz`);
      }
      compared += 1;
    }
  }
  ok(`client playback matches the replay: ${sampleRounds.length} rounds x 5 display rates (30 to 144 Hz, stalls up to 1 s, hit-stops), ${compared} comparisons, every resting pose equal to the bit`);
  const again = validateRingRun(sampleRounds[0]!.seed, sampleRounds[0]!.stats.throws);
  assert.deepEqual(again, validateRingRun(sampleRounds[0]!.seed, sampleRounds[0]!.stats.throws));
  ok('the same flicks replay to the same result twice');
}

// ── 2. Tampering ──
{
  const { seed, stats } = sampleRounds.find((r) => r.stats.score > 0 && r.stats.throws.length >= 4)!;
  const base = stats.throws;
  const v = (throws: RingThrow[]) => validateRingRun(seed, throws);
  // The route rejects a mismatch, a skipped flick, bounds and order.
  const rejected = (r: ReturnType<typeof validateRingRun>, claimed: number) =>
    r.stop === 'bounds' || r.stop === 'order' || r.skipped > 0 || r.score !== claimed;
  assert.ok(rejected(v(base), stats.score + 10), 'a raised score');
  const early = base.map((t, i) => (i === 2 ? { ...t, t: base[1]!.t + 50 } : t));
  assert.ok(rejected(v(early), stats.score), 'a flick before the ring is at rest');
  const late = [...base.slice(0, 3), { ...base[3]!, t: RING_ROUND_MS + 1 }];
  assert.ok(v(late).skipped > 0, 'a flick after the round');
  const swapped = [base[1]!, base[0]!, ...base.slice(2)];
  assert.ok(rejected(v(swapped), stats.score), 'flicks out of order');
  const nan = base.map((t, i) => (i === 1 ? { ...t, p: Number.NaN } : t));
  assert.equal(v(nan).stop, 'bounds', 'a flick that is not a number');
  const extra = [...base, ...base.map((t) => ({ ...t, t: t.t + 40_000 }))];
  assert.ok(v(extra).skipped > 0, 'more flicks than rings');
  const wild = base.map((t) => ({ ...t, p: 7, a: -9 }));
  const wildRun = v(wild);
  assert.ok(wildRun.stop !== 'bounds' && wildRun.score <= RING_COUNT * 100, 'out-of-range params are clamped, not trusted');
  ok('tampered runs are rejected: raised score, early flick, late flick, out of order, NaN, too many; wild params are clamped');
}

// ── 3, 4, 6. The tables by skill, the reward divisor, the tiers ──
const swept = bestPowerByRow();
for (let r = 0; r < 4; r += 1) assert.ok(Math.abs(swept[r]! - RING_BEST_POWER[r]!) <= 0.01, `RING_BEST_POWER[${r}] ${RING_BEST_POWER[r]} vs sweep ${swept[r]}`);
ok(`RING_BEST_POWER matches the sweep: ${swept.join(', ')}`);

const GAP_S = 6;
const bySkill = new Map<string, RoundStats[]>();
for (const skill of SKILLS) {
  const rates = rowRates(skill, powerByRow, 120, 7);
  const rnd = makeRandom(31 + skill.name.length);
  const out: RoundStats[] = [];
  for (let i = 0; i < ROUNDS; i += 1) out.push(playRound(skill, (0x85ebca6b * (i + 3)) >>> 0, powerByRow, rates, rnd));
  bySkill.set(skill.name, out);
}
const ticketsAt = (score: number, k: number) => Math.floor(75 * (1 - Math.exp(-Math.pow(Math.max(0, score / k), 1.15))));
const perMinute = (rounds: RoundStats[], k: number, gap = GAP_S) => {
  const tpr = rounds.reduce((a, r) => a + ticketsAt(r.score, k), 0) / rounds.length;
  const sec = rounds.reduce((a, r) => a + r.durationMs, 0) / rounds.length / 1000 + gap;
  return { tpr, perMin: (tpr * 60) / sec, sec };
};
const TARGET_PER_MIN = 51;
let solved = 0;
let bestErr = Infinity;
for (let k = 600; k <= 1400; k += 10) {
  const err = Math.abs(perMinute(bySkill.get('good')!, k).perMin - TARGET_PER_MIN);
  if (err < bestErr) {
    bestErr = err;
    solved = k;
  }
}
console.log(`\ntickets = 75 x (1 - exp(-(score / ${RING_REWARD_DIVISOR})^1.15)); ${ROUNDS} rounds per skill, ${GAP_S} s between rounds`);
console.log('skill      mean   p10   p25   p50   p75   p90   max  ringers  tickets/run  tickets/min');
for (const skill of SKILLS) {
  const rounds = bySkill.get(skill.name)!;
  const scores = rounds.map((r) => r.score);
  const pm = perMinute(rounds, RING_REWARD_DIVISOR);
  console.log(
    `${skill.name.padEnd(9)} ${(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(0).padStart(5)}` +
      [0.1, 0.25, 0.5, 0.75, 0.9].map((q) => String(quantile(scores, q)).padStart(6)).join('') +
      `${String(Math.max(...scores)).padStart(6)}  ${(rounds.reduce((a, r) => a + r.ringers, 0) / rounds.length).toFixed(2).padStart(7)}` +
      `  ${pm.tpr.toFixed(1).padStart(11)}  ${pm.perMin.toFixed(1).padStart(11)}`,
  );
}
for (const gap of [3, 10]) console.log(`with ${gap} s between rounds a good player earns ${perMinute(bySkill.get('good')!, RING_REWARD_DIVISOR, gap).perMin.toFixed(1)} a minute`);
console.log(`the divisor that pays a good player ${TARGET_PER_MIN} a minute is ${solved}; a perfect round (1000) pays ${ticketsAt(1000, RING_REWARD_DIVISOR)}`);
assert.ok(Math.abs(solved - RING_REWARD_DIVISOR) <= 60, `divisor ${RING_REWARD_DIVISOR} drifted from the solved ${solved}`);
for (const score of [0, 100, 300, 500, 1000]) {
  assert.equal(calculateGameRewardCredits({ gameType: 'ring-toss', score }), ticketsAt(score, RING_REWARD_DIVISOR), `wallet pays the curve at ${score}`);
}
const goodPm = perMinute(bySkill.get('good')!, RING_REWARD_DIVISOR).perMin;
assert.ok(goodPm >= 45 && goodPm <= 65, `a good player earns ${goodPm.toFixed(1)} a minute, outside 45 to 65`);
ok(`the reward divisor ${RING_REWARD_DIVISOR} is within 60 of the solved ${solved}; the wallet pays the same curve; a good player earns ${goodPm.toFixed(1)} a minute`);

// Achievement tiers (a player's best round) and the daily quest's score.
const casual = bySkill.get('casual')!.map((r) => r.score);
const good = bySkill.get('good')!.map((r) => r.score);
const sharp = bySkill.get('sharp')!.map((r) => r.score);
const TIERS = [250, 400, 550, 700, 850];
const QUEST = 400;
console.log(
  `tiers ${TIERS.join(', ')}: casual p75 ${quantile(casual, 0.75)}, good p50 ${quantile(good, 0.5)}, good p90 ${quantile(good, 0.9)}, sharp p50 ${quantile(sharp, 0.5)}, sharp p90 ${quantile(sharp, 0.9)}`,
);
const share = (xs: number[], at: number) => xs.filter((x) => x >= at).length / xs.length;
console.log(`quest "score ${QUEST}": ${(share(good, QUEST) * 100).toFixed(0)}% of a good player's rounds, ${(share(casual, QUEST) * 100).toFixed(0)}% of a casual one's`);
assert.ok(share(casual, TIERS[0]!) >= 0.4, 'tier I is within a casual player');
assert.ok(share(good, TIERS[2]!) >= 0.1 && share(good, TIERS[2]!) <= 0.5, 'tier III is a good player stretching');
assert.ok(share(sharp, TIERS[4]!) >= 0.05, 'tier V is reachable by a sharp hand');
assert.ok(share(good, QUEST) >= 0.4 && share(good, QUEST) <= 0.8, 'the quest score is near a good round');
ok('achievement tiers and the quest score sit on the simulated rounds');

// ── 5. The play check ──
for (const skill of SKILLS) {
  const rounds = bySkill.get(skill.name)!.slice(0, 50);
  const offsets = rounds.map((r) => {
    const v = validateRingRun((0x85ebca6b * (bySkill.get(skill.name)!.indexOf(r) + 3)) >>> 0, r.throws);
    return ringOffsets(r.throws, v.outcomes);
  });
  const check = ringPlayCheck(offsets);
  console.log(`play check, ${skill.name}: ${check.ringers} ringers, power sd ${check.sdPower?.toFixed(4) ?? 'n/a'}, aim sd ${check.sdAim === null ? 'n/a' : (check.sdAim * 1000).toFixed(2) + ' mm'}, ${check.flag ? 'flagged' : 'not flagged'}`);
  if (skill.name === 'machine') assert.ok(check.flag, 'the machine is flagged');
  else assert.equal(check.flag, null, `${skill.name} is not flagged`);
}
ok('the play check flags the machine and no simulated hand');

console.log(`\nring toss: ${checks} checks passed`);
