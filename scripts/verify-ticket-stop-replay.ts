/**
 * Ticket stop, rules 2 (the lock): seeded-replay, fairness, anti-cheat and
 * payout proof.
 *
 *   npx tsx scripts/verify-ticket-stop-replay.ts
 *
 *  1. Rules lock: the numbers the route, the client and the ? sheet quote.
 *  2. Determinism: same seed and taps, same score; a pinned snapshot.
 *  3. Frame rates: a simulated client at 30, 60, 120 and 144 Hz records the
 *     same taps and the same score as the server for the same input events.
 *  4. Display lag: drawing one frame ahead, at 30 to 144 Hz.
 *  5. Seeds: every seed is as hard as every other.
 *  6. Boundaries: the hit window's edges, waiting taps, passes, level gaps.
 *  7. Tampered input: the validator rejects what an honest client can't send.
 *  8. Score distribution by skill, and the tickets each pays.
 *  9. Achievement thresholds against that distribution.
 * 10. Play check: programs with little timing noise are flagged; simulated
 *     humans at 10 to 80 ms noise, on fine and coarse clocks, never are.
 *
 * Exits non-zero on any failed assertion.
 */
import { createHash } from 'node:crypto';

import {
  lockCheckOffsets,
  lockDisplayLeadMs,
  lockHitsThrough,
  lockInputMs,
  lockLayout,
  lockLevelOfHit,
  lockLevelRule,
  lockNearStreak,
  lockPlayCheck,
  lockPooledSpread,
  lockPress,
  lockReplay,
  lockView,
  LOCK_COARSE_CLOCK_MS,
  LOCK_DOT_HALF_DEG,
  LOCK_HIT_HALF_DEG,
  LOCK_HITS_MAX,
  LOCK_HITS_START,
  LOCK_LEAD_IN_MS,
  LOCK_LEVEL_GAP_MS,
  LOCK_MAX_SUBMIT_DELAY_MS,
  LOCK_MAX_TAPS,
  LOCK_NEAR_MS,
  LOCK_NEEDLE_HALF_DEG,
  LOCK_PLAY_WINDOW,
  LOCK_SD_MAX_MS,
  LOCK_SD_MIN_DF,
  LOCK_SESSION_SLACK_MS,
  LOCK_SPAWN_MAX_DEG,
  LOCK_SPAWN_MIN_DEG,
  LOCK_SPAWN_MIN_MS,
  LOCK_SPEED_MAX_DPS,
  LOCK_SPEED_START_DPS,
  LOCK_SPEED_STEP_DPS,
  LOCK_STREAK_REVIEW,
  scoreLockRun,
  TICKET_STOP_LOCK_REWARD_DIVISOR,
  TICKET_STOP_LOCK_RULES,
  type LockRun,
  type LockRunSummary,
} from '@/server/arcade/ticket-stop-lock-engine';
import { ACHIEVEMENTS } from '@/server/arcade/achievements/registry';
import { calculateGameRewardCredits } from '@/server/arcade/rewards/wallet';
import { GAME_DAILY_CREDIT_CAP, MAX_GAME_RUN_CREDITS } from '@/features/arcade/lib/rewards';
import { simulateRun, type Skill } from './sim-ticket-stop-lock';

let failures = 0;
let checks = 0;
const assert = (cond: boolean, msg: string) => {
  checks += 1;
  if (!cond) {
    console.error('  FAIL: ' + msg);
    failures += 1;
  }
};

function mulberry32(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261003);
const randSeed = () => Math.floor(rand() * 2 ** 31);
/** The rejection reason of a run, or 'ok'. */
const why = (run: LockRun) => (run.ok ? 'ok' : (run as Extract<LockRun, { ok: false }>).reason);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

/** A player who aims each tap at the dot's centre with the given timing SD
 *  and no slips (the play check's humans). */
const human = (sigma: number): Skill => ({ name: `σ${sigma}`, sigma, lapse: 0 });

const EXPECTED_GOLDEN =
  '{"first":-1,"dots":[-73.657,-2.727,-87.113,3.378,-64.944,149.952],"taps":[1060,1503,2030,2595,4097,5361],"golden":[6,1,"passed",6374]}';

// ── 1. Rules lock ──────────────────────────────────────────────────────────
console.log('1. Rules');
{
  assert(TICKET_STOP_LOCK_RULES === 2, 'rules version');
  assert(LOCK_LEAD_IN_MS === 600, 'lead-in');
  assert(LOCK_LEVEL_GAP_MS === 1100, 'level gap');
  assert(LOCK_DOT_HALF_DEG === 12 && LOCK_NEEDLE_HALF_DEG === 1.5 && LOCK_HIT_HALF_DEG === 13.5, 'hit window in degrees');
  assert(LOCK_SPEED_START_DPS === 160 && LOCK_SPEED_STEP_DPS === 10 && LOCK_SPEED_MAX_DPS === 360, 'speed ramp');
  assert(LOCK_HITS_START === 4 && LOCK_HITS_MAX === 10, 'hits per level');
  assert(LOCK_SPAWN_MIN_DEG === 60 && LOCK_SPAWN_MAX_DEG === 220 && LOCK_SPAWN_MIN_MS === 300, 'spawn bounds');
  assert(TICKET_STOP_LOCK_REWARD_DIVISOR === 60, 'reward divisor');
  // The table the ? sheet and TICKET_STOP.md quote.
  const table: Array<[number, number, number, number]> = [
    [1, 4, 160, 84],
    [2, 5, 170, 79],
    [4, 7, 190, 71],
    [8, 10, 230, 59],
    [10, 10, 250, 54],
    [14, 10, 290, 47],
    [21, 10, 360, 38],
    [40, 10, 360, 38],
  ];
  for (const [level, hits, speed, windowMs] of table) {
    const rule = lockLevelRule(level);
    assert(rule.hits === hits && rule.speedDps === speed, `level ${level}: ${rule.hits} hits at ${rule.speedDps}`);
    assert(Math.round((LOCK_HIT_HALF_DEG * 1000) / rule.speedDps) === windowMs, `level ${level} window ±${windowMs} ms`);
  }
  assert(lockHitsThrough(1) === 4 && lockHitsThrough(2) === 9 && lockHitsThrough(7) === 49, 'hits through a level');
  assert(lockLevelOfHit(3).level === 1 && lockLevelOfHit(4).level === 2 && lockLevelOfHit(4).inLevel === 0, 'level of a hit');
  assert(lockLevelRule(21).speedDps === 360 && lockLevelRule(50).hits === 10, 'ramp holds past its end');
  console.log('   ramp 160 to 360 deg/s, 4 to 10 hits, window 13.5 deg: ±84 ms on level 1, ±38 ms from level 21');
}

// ── 2. Determinism ─────────────────────────────────────────────────────────
console.log('2. Seeded replays');
{
  const digest = createHash('sha256');
  for (let n = 0; n < 2000; n += 1) {
    const seed = randSeed();
    const skill = human([12, 24, 40][n % 3]);
    const run = simulateRun(seed, skill, mulberry32(seed ^ n));
    const again = simulateRun(seed, skill, mulberry32(seed ^ n));
    assert(run.ok && again.ok, 'sim run accepted');
    if (!run.ok || !again.ok) continue;
    const taps = [...run.hits.map((h) => h.atMs)];
    if (run.end.kind === 'early') taps.push(Math.round(run.end.atMs));
    const a = scoreLockRun(seed, taps);
    const b = scoreLockRun(seed, taps);
    assert(a.ok && b.ok && JSON.stringify(a) === JSON.stringify(b), `seed ${seed}: replays differ`);
    assert(a.ok && a.score === run.score && run.score === again.score, `seed ${seed}: score differs from the sim`);
    digest.update(`${seed}:${run.score}:${run.durationMs};`);
  }
  // A pinned run: layout and replay of one seed (exact-centre taps on its
  // first six dots). If this drifts, saved runs would replay differently.
  const layout = lockLayout(1234567);
  const dots = [0, 1, 2, 3, 4, 5].map((i) => Math.round(layout.dot(i).centreDeg * 1000) / 1000);
  const goldenTaps: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    const { segment } = lockReplay(layout, goldenTaps);
    goldenTaps.push(Math.round(segment.startMs + (segment.toCentreDeg * 1000) / segment.rule.speedDps));
  }
  const golden = scoreLockRun(1234567, goldenTaps);
  const goldenText = JSON.stringify({
    first: layout.firstDir,
    dots,
    taps: goldenTaps,
    golden: golden.ok ? [golden.score, golden.levelsCleared, golden.end.kind, golden.durationMs] : golden,
  });
  assert(goldenText === EXPECTED_GOLDEN, `golden layout drifted: ${goldenText}`);
  console.log(`   2,000 seeded runs replay identically; digest ${digest.digest('hex').slice(0, 16)}`);
}
// ── 3. Frame rates ─────────────────────────────────────────────────────────
console.log('3. Frame rates (30, 60, 120, 144 Hz)');
{
  const RATES = [30, 60, 120, 144];
  const PASS_GRACE_MS = 8; // the client's, _lock-client.tsx
  let compared = 0;
  for (let n = 0; n < 300; n += 1) {
    const seed = randSeed();
    const layout = lockLayout(seed);
    const intended = simulateRun(seed, human(20 + (n % 5) * 8), mulberry32(seed));
    assert(intended.ok, 'intended run accepted');
    if (!intended.ok) continue;
    const intendedTaps = intended.hits.map((h) => h.atMs);
    if (intended.end.kind === 'early') intendedTaps.push(Math.round(intended.end.atMs));
    // Input events as the browser stamps them: sub-ms stamps that round to
    // the intended tap, a stray press while the needle waits, a stray one
    // after the end.
    const runStart = 1000 + rand() * 5000;
    const events = [
      runStart + 350.4,
      ...intendedTaps.map((t) => runStart + t + rand() * 0.9 - 0.45),
      runStart + intended.durationMs + 400.3,
    ];
    const outcomes: string[] = [];
    for (const hz of RATES) {
      const frameMs = 1000 / hz;
      const phase = rand() * frameMs;
      const taps: number[] = [];
      let pending = 0;
      let endSeen: string | null = null;
      let lastScore = 0;
      for (let frame = 0; frame < 400_000; frame += 1) {
        const now = runStart + phase + frame * frameMs;
        while (pending < events.length && events[pending] <= now) {
          const at = lockInputMs(events[pending], runStart);
          const press = lockPress(layout, taps, at);
          if (press.kind !== 'ignored' && !endSeen) {
            taps.push(at);
            if (press.kind === 'early') endSeen = 'early';
          }
          pending += 1;
        }
        if (!endSeen) {
          const replay = lockReplay(layout, taps, now - runStart - PASS_GRACE_MS);
          if (replay.end) endSeen = replay.end.kind;
        }
        const view = lockView(layout, taps, now - runStart + lockDisplayLeadMs(frameMs));
        assert(view.score >= lastScore, 'score never goes down');
        lastScore = view.score;
        if (endSeen && pending >= events.length) break;
      }
      const server = scoreLockRun(seed, taps);
      assert(server.ok, `${hz} Hz run accepted by the server`);
      outcomes.push(JSON.stringify({ taps, server: server.ok ? [server.score, server.end.kind] : server }));
      assert(server.ok && server.score === intended.score && server.end.kind === intended.end.kind, `${hz} Hz: score or end differs from the intended run`);
      compared += 1;
    }
    assert(outcomes.every((o) => o === outcomes[0]), `seed ${seed}: taps or score differ across rates`);
  }
  console.log(`   ${compared} simulated runs (300 seeds × 4 rates, stray presses included): identical taps, scores and ends`);
}

// ── 4. Display lag ─────────────────────────────────────────────────────────
console.log('4. Display lag');
{
  // A frame drawn at t is on screen one frame interval later and shows engine
  // time t + lead. A hand that taps the moment the dot is under the needle
  // taps when that frame reaches the screen.
  const lateness = (hz: number, leadMs: number) => {
    const interval = 1000 / hz;
    const out: number[] = [];
    for (let n = 0; n < 20_000; n += 1) {
      const centre = 1000 + rand() * 1000;
      const phase = rand() * interval;
      // The first frame whose drawn time reaches the centre.
      const k = Math.ceil((centre - leadMs - phase) / interval);
      const shownAt = phase + k * interval + interval;
      out.push(shownAt - centre);
    }
    return mean(out);
  };
  const rows: string[] = [];
  for (const hz of [30, 60, 120, 144]) {
    const interval = 1000 / hz;
    const lead = lockDisplayLeadMs(interval);
    const without = lateness(hz, 0);
    const withLead = lateness(hz, lead);
    assert(Math.abs(withLead - interval / 2) < 1.2, `${hz} Hz: with the lead the mean lateness is half a frame (${withLead.toFixed(1)} ms)`);
    assert(Math.abs(without - 1.5 * interval) < 1.2, `${hz} Hz: without it, a frame and a half (${without.toFixed(1)} ms)`);
    rows.push(`${hz} Hz ${withLead.toFixed(1)} ms (without the lead ${without.toFixed(1)} ms)`);
  }
  console.log(`   mean lateness of a perfect reader: ${rows.join(', ')}`);
  // At the fastest level (±38 ms) a perfect reader at 30 Hz still hits every
  // dot with the lead, and misses most without.
  const hitRate = (leadMs: number) => {
    const interval = 1000 / 30;
    let hits = 0;
    let total = 0;
    for (let n = 0; n < 2000; n += 1) {
      const rule = lockLevelRule(25);
      const centre = 1000 + rand() * 1000;
      const phase = rand() * interval;
      const k = Math.ceil((centre - leadMs - phase) / interval);
      const offsetMs = phase + k * interval + interval - centre;
      total += 1;
      if (Math.abs((offsetMs * rule.speedDps) / 1000) <= LOCK_HIT_HALF_DEG) hits += 1;
    }
    return hits / total;
  };
  const withLead = hitRate(lockDisplayLeadMs(1000 / 30));
  const without = hitRate(0);
  assert(withLead === 1, `30 Hz, level 25, with the lead: ${withLead}`);
  assert(without < 0.5, `30 Hz, level 25, without it: ${without}`);
  console.log(`   30 Hz at the top speed: a perfect reader hits ${(withLead * 100).toFixed(0)}% with the lead, ${(without * 100).toFixed(0)}% without`);
}

// ── 5. Seeds ───────────────────────────────────────────────────────────────
console.log('5. Seeds');
{
  const reachable = new Set<number>();
  for (let n = 0; n < 500; n += 1) {
    const seed = randSeed() - 2 ** 30;
    const layout = lockLayout(seed);
    let from = 0;
    for (let i = 0; i < 120; i += 1) {
      const dot = layout.dot(i);
      const rule = lockLevelRule(dot.level);
      assert(dot.spawnDeg >= rule.spawnMinDeg - 1e-9 && dot.spawnDeg <= rule.spawnMaxDeg + 1e-9, `dot ${i} spawn ${dot.spawnDeg}`);
      assert((dot.spawnDeg * 1000) / rule.speedDps >= LOCK_SPAWN_MIN_MS - 1e-6, `dot ${i} never closer than ${LOCK_SPAWN_MIN_MS} ms`);
      assert(dot.dir === (i % 2 === 0 ? layout.firstDir : -layout.firstDir), `dot ${i} direction alternates`);
      assert(Math.abs(dot.centreDeg - from - dot.dir * dot.spawnDeg) < 1e-9, `dot ${i} sits a spawn away`);
      from = dot.centreDeg;
      if (i === 0) reachable.add(Math.round(((dot.centreDeg % 360) + 360) % 360));
    }
    // A player who taps the exact centre every time clears 120 dots on any seed.
    const taps: number[] = [];
    for (let i = 0; i < 120; i += 1) {
      const { segment } = lockReplay(layout, taps);
      taps.push(Math.round(segment.startMs + (segment.toCentreDeg * 1000) / segment.rule.speedDps));
    }
    const run = scoreLockRun(seed, taps);
    assert(run.ok && run.score === 120, `seed ${seed}: exact taps score ${run.ok ? run.score : why(run)}`);
  }
  assert(reachable.size > 100, 'first dots land all round the dial');
  console.log('   500 seeds: spawns inside their bounds and never under 300 ms away, directions alternate, exact taps clear 120 dots on every seed');
}

// ── 6. Boundaries ──────────────────────────────────────────────────────────
console.log('6. Boundaries');
{
  const seed = 4242;
  const layout = lockLayout(seed);
  const { segment } = lockReplay(layout, []);
  const rule = segment.rule;
  const msAt = (deg: number) => segment.startMs + (deg * 1000) / rule.speedDps;
  const openMs = msAt(segment.openDeg);
  const closeMs = msAt(segment.closeDeg);
  const centreMs = msAt(segment.toCentreDeg);
  // The first whole ms that touches the dot, and the one before it.
  const firstHit = Math.ceil(openMs);
  assert(scoreLockRun(seed, [firstHit]).ok && (scoreLockRun(seed, [firstHit]) as { score: number }).score === 1, 'first touching ms hits');
  const before = scoreLockRun(seed, [firstHit - 1]);
  assert(before.ok && before.score === 0 && before.end.kind === 'early', 'one ms earlier is an early miss');
  // The last whole ms that touches, and the one after (the needle has passed).
  const lastHit = Math.floor(closeMs);
  const last = scoreLockRun(seed, [lastHit]);
  assert(last.ok && last.score === 1, 'last touching ms hits');
  const after = scoreLockRun(seed, [lastHit + 1]);
  assert(why(after) === 'late', 'a tap after the needle passed is late, not a hit');
  // No tap: the run ends by a pass at the far edge.
  const none = scoreLockRun(seed, []);
  assert(none.ok && none.score === 0 && none.end.kind === 'passed' && none.durationMs === Math.ceil(closeMs), 'no taps: a pass');
  // Offsets are signed around the centre.
  const hit = scoreLockRun(seed, [Math.round(centreMs) - 20]);
  assert(hit.ok && hit.hits[0].offsetMs < -19 && hit.hits[0].offsetMs > -21, 'early offset is negative');
  // Waiting: the lead-in, and a level gap after the clearing hit.
  assert(!scoreLockRun(seed, [LOCK_LEAD_IN_MS - 1]).ok, 'a tap in the lead-in is rejected');
  const taps: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const r = lockReplay(layout, taps).segment;
    taps.push(Math.round(r.startMs + (r.toCentreDeg * 1000) / r.rule.speedDps));
  }
  const cleared = scoreLockRun(seed, taps);
  assert(cleared.ok && cleared.levelsCleared === 1 && cleared.hits[3].clears, 'four hits clear level 1');
  const gap = scoreLockRun(seed, [...taps, taps[3] + LOCK_LEVEL_GAP_MS - 1]);
  assert(why(gap) === 'waiting', 'a tap in the level gap is rejected');
  const second = lockReplay(layout, taps).segment;
  assert(second.startMs === taps[3] + LOCK_LEVEL_GAP_MS, 'the next level moves a gap after the clearing hit');
  assert(second.rule.level === 2 && second.rule.hits === 5, 'level 2 follows');
  // A tap exactly as the needle starts moving again is a (very early) miss, not ignored.
  const atStart = scoreLockRun(seed, [...taps, second.startMs]);
  assert(atStart.ok && atStart.end.kind === 'early', 'a tap as the needle moves is an early miss');
  console.log('   window edges to the ms, passes, the lead-in and level gaps');
}

// ── 7. Tampered input ──────────────────────────────────────────────────────
console.log('7. Tampered input');
{
  const seed = 99;
  const base = simulateRun(seed, human(15), mulberry32(5));
  assert(base.ok && base.score >= 20, 'a baseline run to tamper with');
  if (base.ok) {
    const taps = base.hits.map((h) => h.atMs);
    if (base.end.kind === 'early') taps.push(Math.round(base.end.atMs));
    const reason = (value: unknown, options?: { sinceStartMs?: number }) => {
      return why(scoreLockRun(seed, value, options));
    };
    assert(reason(taps) === 'ok', 'the honest run is accepted');
    for (const bad of [undefined, null, 'taps', 7, { length: 2 }]) assert(reason(bad) === 'count', `${JSON.stringify(bad)} is not a list`);
    assert(reason(new Array(LOCK_MAX_TAPS + 1).fill(1000)) === 'count', 'too many taps');
    for (const bad of [1.5, -3, NaN, Infinity, '700', null, {}]) {
      assert(reason([700, bad]) === 'malformed', `${String(bad)} is malformed`);
    }
    assert(reason([1000, 900]) === 'order', 'taps out of order');
    const swapped = taps.slice();
    [swapped[3], swapped[4]] = [swapped[4], swapped[3]];
    assert(reason(swapped) === 'order', 'two taps swapped');
    assert(reason([100, ...taps]) === 'waiting', 'a tap in the lead-in');
    const dup = taps.slice();
    dup.splice(5, 0, dup[4]);
    assert(reason(dup) !== 'ok', 'a tap repeated');
    // A tap after the run ended.
    if (base.end.kind === 'early') {
      assert(reason([...taps, taps[taps.length - 1] + 400]) === 'late', 'a tap after an early miss');
    } else {
      assert(reason([...taps, Math.ceil(base.end.atMs) + 500]) === 'late', 'a tap after the pass');
    }
    // Claiming more than the replay gives is the route's check; here the
    // replay's own score is the only one.
    const forged = taps.slice(0, 10).map((t) => t + 1);
    const forgedRun = scoreLockRun(seed, forged);
    assert(!forgedRun.ok || forgedRun.score <= 10, 'a forged list cannot score above its own taps');
    // Time against the session: the run's own length, and long after it.
    const duration = base.durationMs;
    assert(reason(taps, { sinceStartMs: duration + 100 }) === 'ok', 'a run posted just after it ended');
    assert(reason(taps, { sinceStartMs: duration - LOCK_SESSION_SLACK_MS + 1 }) === 'ok', 'inside the slack');
    assert(reason(taps, { sinceStartMs: duration - LOCK_SESSION_SLACK_MS - 5 }) === 'too-fast', 'a run longer than the session has existed');
    assert(reason(taps, { sinceStartMs: 3000 }) === 'too-fast', 'posted 3 s after the stamp, 40+ s of play');
    assert(reason(taps, { sinceStartMs: duration + LOCK_MAX_SUBMIT_DELAY_MS + 1 }) === 'stale', 'posted long after it ended');
    assert(reason(taps, { sinceStartMs: duration + LOCK_MAX_SUBMIT_DELAY_MS }) === 'ok', 'the delay bound is inclusive');
    // The same taps on another seed are no longer a run.
    let others = 0;
    for (let n = 0; n < 50; n += 1) {
      const other = scoreLockRun(seed + 1 + n, taps);
      if (other.ok && other.score >= base.score) others += 1;
    }
    assert(others <= 1, `a run replayed on other seeds scored as high ${others} times of 50`);
    // A run that never touches a dot: any taps at all that miss end it.
    assert(reason([LOCK_LEAD_IN_MS + 1]) === 'ok', 'a first tap on the needle at the top is an early miss, accepted as a zero');
    const zero = scoreLockRun(seed, [LOCK_LEAD_IN_MS + 1]);
    assert(zero.ok && zero.score === 0, 'and scores 0');
  }
  console.log('   malformed, unordered, early, waiting, late, too-fast, stale and wrong-seed runs are rejected; replayed sessions are the session claim (409), checked with curl');
}

// ── 8. Score distribution and tickets ──────────────────────────────────────
console.log('8. Score distribution by skill, and tickets');
const SKILLS: Skill[] = [
  { name: 'first go', sigma: 60, lapse: 0.02 },
  { name: 'new', sigma: 48, lapse: 0.012 },
  { name: 'casual', sigma: 34, lapse: 0.006 },
  { name: 'good', sigma: 24, lapse: 0.003 },
  { name: 'sharp', sigma: 15, lapse: 0.0015 },
];
const dist: Record<string, { p10: number; p50: number; p90: number; mean: number; secs: number; tickets: number; scores: number[] }> = {};
{
  const RUNS = 4000;
  const ticketsFor = (score: number) => calculateGameRewardCredits({ gameType: 'ticket-stop', score });
  for (const skill of SKILLS) {
    const rng = mulberry32(skill.sigma * 7919 + 13);
    const scores: number[] = [];
    const secs: number[] = [];
    for (let i = 0; i < RUNS; i += 1) {
      const run = simulateRun(randSeed(), skill, rng);
      assert(run.ok, 'sim run accepted');
      if (!run.ok) continue;
      scores.push(run.score);
      secs.push(run.durationMs / 1000);
    }
    const sorted = [...scores].sort((a, b) => a - b);
    const tickets = mean(scores.map(ticketsFor));
    dist[skill.name] = { p10: pct(sorted, 0.1), p50: pct(sorted, 0.5), p90: pct(sorted, 0.9), mean: mean(scores), secs: mean(secs), tickets, scores };
    const perMin = tickets / ((mean(secs) + 6) / 60);
    console.log(
      `   ${skill.name.padEnd(8)} σ${String(skill.sigma).padStart(2)} ms: score p10/p50/p90 ${dist[skill.name].p10}/${dist[skill.name].p50}/${dist[skill.name].p90}, mean ${mean(scores).toFixed(1)}, ${mean(secs).toFixed(0)} s a run, ${tickets.toFixed(1)} tickets a run, ${perMin.toFixed(0)} a minute with 6 s between runs`,
    );
  }
  const good = dist.good;
  assert(good.mean > 50 && good.mean < 60, `a good run averages ~55 hits (${good.mean.toFixed(1)})`);
  assert(good.secs > 40 && good.secs < 56, `a good run lasts ~48 s (${good.secs.toFixed(0)})`);
  assert(good.tickets > 39 && good.tickets < 43, `a good run pays about 41 (${good.tickets.toFixed(1)})`);
  assert(ticketsOf(55) === 44 && ticketsOf(0) === 0, 'tickets for exactly 55 hits and for none');
  for (const skill of SKILLS) {
    assert(dist[skill.name].scores.every((s) => ticketsOf(s) <= MAX_GAME_RUN_CREDITS), `${skill.name}: no run pays past the ${MAX_GAME_RUN_CREDITS} per-run cap`);
    assert(dist[skill.name].tickets < GAME_DAILY_CREDIT_CAP, `${skill.name}: a run is well under the ${GAME_DAILY_CREDIT_CAP} daily cap`);
  }
  assert(ticketsOf(10_000) === MAX_GAME_RUN_CREDITS - 1 || ticketsOf(10_000) === MAX_GAME_RUN_CREDITS, 'the curve saturates at the per-run cap');
  assert(ticketsOf(60) < ticketsOf(120) && ticketsOf(120) < ticketsOf(240), 'more hits pay more');
  let capScore = 0;
  while (ticketsOf(capScore) < MAX_GAME_RUN_CREDITS - 1) capScore += 1;
  console.log(
    `   55 hits pay ${ticketsOf(55)}, 100 pay ${ticketsOf(100)}, 150 pay ${ticketsOf(150)}, ${capScore} pay ${ticketsOf(capScore)} of the ${MAX_GAME_RUN_CREDITS} cap; the ${GAME_DAILY_CREDIT_CAP} daily cap is about ${(GAME_DAILY_CREDIT_CAP / dist.good.tickets).toFixed(1)} good runs`,
  );
}
function ticketsOf(score: number) {
  return calculateGameRewardCredits({ gameType: 'ticket-stop', score });
}

// ── 9. Achievement thresholds ──────────────────────────────────────────────
console.log('9. Achievement thresholds');
{
  const tiers = ACHIEVEMENTS.filter((a) => a.seriesId === 'ticket-stop-score').sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0));
  const thresholds = tiers.map((a) => ('stat' in a.condition && 'gte' in a.condition ? a.condition.gte : NaN));
  assert(thresholds.length === 5 && thresholds.every(Number.isFinite), 'five tiers with a minimum');
  assert(thresholds.every((t, i) => i === 0 || t > thresholds[i - 1]), 'tiers rise');
  assert(tiers.every((a) => 'stat' in a.condition && a.condition.stat === 'ticket-stop.lock_best'), 'on the lock stat, not rules 1\'s `best`');
  const share = (name: string, t: number) => dist[name].scores.filter((s) => s >= t).length / dist[name].scores.length;
  const [t1, t2, t3, t4, t5] = thresholds;
  // Anchors: each tier is a mark of the next skill up.
  assert(t1 >= dist['first go'].p90 && t1 <= dist.new.p90, `tier 1 (${t1}) between a first go's p90 and a new player's p90`);
  assert(t2 >= dist.casual.p50 - 10 && t2 <= dist.casual.p90, `tier 2 (${t2}) in a casual player's middle`);
  assert(t3 <= dist.good.p50 + 5 && t3 >= dist.good.p50 - 10, `tier 3 (${t3}) at a good player's median`);
  assert(t4 >= dist.good.p50 && t4 <= dist.good.p90 + 10, `tier 4 (${t4}) up to a good player's p90`);
  assert(t5 <= dist.sharp.p50 + 5 && t5 >= dist.good.p90, `tier 5 (${t5}) at a sharp player's median, above a good one's p90`);
  console.log(`   thresholds ${thresholds.join(', ')}; share of single runs reaching tier 1..5: ` +
    SKILLS.map((s) => `${s.name} ${thresholds.map((t) => (share(s.name, t) * 100).toFixed(0)).join('/')}%`).join(', '));
}

// ── 10. Play check ─────────────────────────────────────────────────────────
console.log('10. Play check: timing spread');
{
  const summarise = (seed: number, skill: Skill, rng: () => number, quantMs = 0): LockRunSummary & { score: number } => {
    const run = simulateRun(seed, skill, rng, { quantMs });
    if (!run.ok) throw new Error('rejected sim run');
    const taps = run.hits.map((h) => h.atMs);
    if (run.end.kind === 'early') taps.push(Math.round(run.end.atMs));
    return { streak: lockNearStreak(run.hits), offsets: lockCheckOffsets(run.hits, taps), score: run.score };
  };
  /** Play `runs` runs one after another, checking after each, as the route does. */
  const career = (skill: Skill, runs: number, quantMs = 0, tag = 1) => {
    const rng = mulberry32(Math.floor(skill.sigma * 1000) + runs + quantMs * 31 + tag);
    const history: LockRunSummary[] = [];
    let flagged = 0;
    let reviewed = 0;
    let judged = 0;
    for (let i = 0; i < runs; i += 1) {
      history.push(summarise(randSeed(), skill, rng, quantMs));
      const check = lockPlayCheck(history.slice(-LOCK_PLAY_WINDOW));
      if (check.df >= LOCK_SD_MIN_DF) judged += 1;
      if (check.flag) flagged += 1;
      if (check.review) reviewed += 1;
    }
    return { flagged, reviewed, judged };
  };

  // Programs: every tap at the centre, with a little noise (SD in ms).
  const botRows: string[] = [];
  for (const sigma of [0, 1, 2, 3, 4]) {
    const { flagged, judged } = career({ name: `bot ${sigma}`, sigma, lapse: 0 }, 6);
    assert(flagged > 0 && judged > 0, `a program with ${sigma} ms of noise is flagged (${flagged} of 6 runs)`);
    botRows.push(`${sigma} ms flagged ${flagged}/6 runs`);
  }
  console.log(`   programs: ${botRows.join(', ')}`);
  // One that shifts its aim for every run is just as flagged (the spread is within a run).
  {
    const rng = mulberry32(55);
    const history: LockRunSummary[] = [];
    let flagged = 0;
    for (let i = 0; i < 6; i += 1) {
      const shift = (rng() - 0.5) * 24;
      const seed = randSeed();
      const layout = lockLayout(seed);
      const taps: number[] = [];
      for (let d = 0; d < 150; d += 1) {
        const { segment } = lockReplay(layout, taps);
        taps.push(Math.round(segment.startMs + (segment.toCentreDeg * 1000) / segment.rule.speedDps + shift));
      }
      const run = scoreLockRun(seed, taps);
      if (!run.ok) continue;
      history.push({ streak: lockNearStreak(run.hits), offsets: lockCheckOffsets(run.hits, taps) });
      if (lockPlayCheck(history).flag) flagged += 1;
    }
    assert(flagged > 0, 'a program that moves its aim between runs is flagged');
    console.log(`   a program that moves its aim by up to ±12 ms between runs: flagged on ${flagged} of 6 runs`);
  }
  // The streak log: a near-perfect program is logged for review.
  {
    const sum = summarise(randSeed(), { name: 'bot', sigma: 1.5, lapse: 0 }, mulberry32(8));
    assert(sum.streak >= LOCK_STREAK_REVIEW, `a program's streak is ${sum.streak}`);
    assert(lockPlayCheck([sum]).review !== null, 'and is logged for review');
    assert(lockPlayCheck([sum]).flag !== null || sum.offsets.length - 1 < LOCK_SD_MIN_DF, 'and a long enough run is flagged');
  }

  // Humans: 10 to 80 ms of timing noise, fine and rounded clocks.
  // Offsets from a rounded clock say nothing about a hand, so the check skips
  // those runs (and a 16 ms or coarser clock spreads the offsets by itself).
  const clocks: Array<[string, number]> = [['1 ms', 0], ['16 ms', 16], ['20 ms', 20], ['50 ms', 50], ['100 ms', 100]];
  let humanRuns = 0;
  let humanJudged = 0;
  let humanFlags = 0;
  let humanReviews = 0;
  let skipped = 0;
  for (const sigma of [10, 12, 15, 20, 24, 34, 48, 60, 80]) {
    for (const [label, quant] of clocks) {
      const runs = sigma <= 24 ? 160 : 100;
      const { flagged, reviewed, judged } = career(human(sigma), runs, quant, 3);
      humanRuns += runs;
      humanJudged += judged;
      humanFlags += flagged;
      humanReviews += reviewed;
      assert(flagged === 0, `σ${sigma} ms on a ${label} clock was flagged ${flagged} times`);
      assert(reviewed === 0, `σ${sigma} ms on a ${label} clock was logged for a streak ${reviewed} times`);
      if (quant >= LOCK_COARSE_CLOCK_MS && judged === 0) skipped += 1;
    }
  }
  // A 60 Hz browser clock rounds to 16.67 ms ticks and then to whole ms: the
  // taps share no factor, and their offsets are spread by the rounding alone.
  {
    const rng = mulberry32(31);
    for (const sigma of [10, 15, 24, 48]) {
      const history: LockRunSummary[] = [];
      let flagged = 0;
      for (let i = 0; i < 120; i += 1) {
        const seed = randSeed();
        const run = simulateRun(seed, human(sigma), rng, { quantMs: 50 / 3 });
        if (!run.ok) throw new Error('rejected');
        const taps = run.hits.map((h) => h.atMs);
        history.push({ streak: lockNearStreak(run.hits), offsets: lockCheckOffsets(run.hits, taps) });
        if (lockPlayCheck(history.slice(-LOCK_PLAY_WINDOW)).flag) flagged += 1;
        humanRuns += 1;
      }
      assert(flagged === 0, `σ${sigma} ms on a 16.67 ms clock was flagged ${flagged} times`);
    }
  }
  assert(humanJudged > 1000, `the check really judged runs (${humanJudged})`);
  console.log(
    `   humans: ${humanRuns} runs at σ 10 to 80 ms on 1, 16, 20, 50, 100 and 16.67 ms clocks (${humanJudged} checks with enough hits to judge): ${humanFlags} flags, ${humanReviews} streak logs; ${skipped} rounded-clock careers skipped whole`,
  );

  // Coarse clocks are skipped: no offsets from a run whose taps share a big factor.
  {
    const rng = mulberry32(4);
    const run = simulateRun(randSeed(), human(15), rng, { quantMs: 20 });
    assert(run.ok, 'coarse sim run');
    if (run.ok) {
      const taps = run.hits.map((h) => h.atMs);
      assert(taps.length >= 12 && lockCheckOffsets(run.hits, taps).length === 0, 'a 20 ms clock contributes no offsets');
      assert(lockCheckOffsets(run.hits, taps.slice(0, 5)).length > 0, 'a few taps are too few to call a clock coarse');
    }
    const fine = simulateRun(randSeed(), human(15), rng);
    assert(fine.ok && lockCheckOffsets(fine.hits, fine.hits.map((h) => h.atMs)).length === Math.min(300, fine.hits.length), 'a 1 ms clock contributes its offsets');
  }

  // How often an honest hand would be flagged by chance: the pooled SD of
  // `df` offsets from a hand with 10 ms of noise (the sharpest modelled)
  // falls under LOCK_SD_MAX_MS with probability P(chi2_df < df * (5/10)^2).
  const chiSquareCdf = (x: number, k: number) => {
    // Regularized lower incomplete gamma P(k/2, x/2) by series.
    const a = k / 2;
    const z = x / 2;
    let term = 1 / a;
    let sum = term;
    for (let n = 1; n < 500; n += 1) {
      term *= z / (a + n);
      sum += term;
    }
    return Math.exp(-z + a * Math.log(z) - lgamma(a)) * sum;
  };
  const lgamma = (z: number): number => {
    const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = z;
    const tmp = z + 5.5 - (z + 0.5) * Math.log(z + 5.5);
    let ser = 1.000000000190015;
    for (const coef of c) ser += coef / ++y;
    return -tmp + Math.log((2.5066282746310005 * ser) / z);
  };
  const ratio = (LOCK_SD_MAX_MS / 10) ** 2;
  const pAtMin = chiSquareCdf(LOCK_SD_MIN_DF * ratio, LOCK_SD_MIN_DF);
  const pAt200 = chiSquareCdf(200 * ratio, 200);
  assert(pAtMin < 2e-6, `chance flag for a 10 ms hand at ${LOCK_SD_MIN_DF} df is ${pAtMin.toExponential(1)}`);
  assert(pAt200 < 1e-20, `and at 200 df ${pAt200.toExponential(1)}`);
  console.log(`   chance of flagging a hand with 10 ms of noise: ${pAtMin.toExponential(1)} at the ${LOCK_SD_MIN_DF}-hit minimum, ${pAt200.toExponential(1)} at 200 hits`);
  const streakChance = (0.3829 ** LOCK_STREAK_REVIEW) * 300;
  assert(streakChance < 1e-5, 'a streak log is a rare event for a 10 ms hand');
  console.log(`   a ${LOCK_STREAK_REVIEW}-hit streak within ±${LOCK_NEAR_MS} ms: about ${streakChance.toExponential(1)} a 300-hit run for a 10 ms hand (logged only, never counted toward a ban)`);
  assert(lockPooledSpread([[1, 2, 3], [10]]).df === 2, 'the pooled spread skips one-hit runs');
}

if (failures > 0) {
  console.error(`\n${failures} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`\nticket stop lock replay invariants passed (${checks} checks)`);
