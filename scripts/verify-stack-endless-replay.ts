/**
 * Stacker endless, rules 2: replay, smoothness, difficulty and payout proof.
 *
 *   npx tsx scripts/verify-stack-endless-replay.ts
 *
 *  1. Rules lock: the speed curve, the pressures and their heights, the
 *     sweep (inside the band, continuous, eased at the walls, steady over
 *     the tower), and the payout the route and the sheet quote.
 *  2. Same drops, same score: replays, a pinned snapshot, rounding, order,
 *     and the WS path (JSON and back).
 *  3. Frame rates: a client drawing at 30 to 144 Hz with frame stalls scores
 *     every drop at its event time and records exactly what the route
 *     replays; the block on screen at each tap is within one frame of motion
 *     of where it lands. Rules 1 resolved taps at the next 60 fps frame; the
 *     same taps show how far that moved a landing.
 *  4. Tampered input: junk times, drops after the miss, drops past the run.
 *  5. Heights by skill: rules 1 against rules 2 for the same simulated
 *     players, how many reach each pressure, and the front-loaded reward curve
 *     fitted so new and good players earn within 10% of rules 1 per minute.
 *
 * Exits non-zero on any failed assertion.
 */
import { createHash } from 'node:crypto';

import {
  STACK_BAND,
  STACK_INITIAL_BLOCK_WIDTH,
  STACK_REWARD_POWER,
  STACK_REWARD_SCALE,
  STACK_RULES_VERSION,
  STACK_SWEEP_LEFT,
  STACK2_BASE_SPEED,
  STACK2_FAST_BOOST,
  STACK2_FAST_FROM,
  STACK2_NARROW_FROM,
  STACK2_NARROW_MIN,
  STACK2_TOP_SPEED,
  STACK2_TURN_PX,
  applyStackDrop,
  createStackRun,
  createStackSim,
  replayStackRun,
  stackAimElapsedMs,
  stackBaseSpeed,
  stackDropAt,
  stackInputMs,
  stackMoverLeft,
  stackMoverWidth,
  stackMovingLeftAt,
  stackRow,
  stackRunTickets,
  stackSpeedForHeight,
  stackWidthLimit,
  type StackRunState,
} from '@/server/arcade/stack-replay';
import { stackerDisplayLeadMs } from '@/server/arcade/stack-cabinet-engine';
import { calculateGameRewardCredits } from '@/server/arcade/rewards/wallet';
import { MAX_GAME_RUN_CREDITS } from '@/features/arcade/lib/rewards';

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
const gauss = (rng: () => number) => Math.sqrt(-2 * Math.log(Math.max(1e-12, rng()))) * Math.cos(2 * Math.PI * rng());

/**
 * The player model (the same one scripts/sim-achievement-thresholds.ts used
 * for rules 1): each drop aims at the first time, at least 180 ms into the
 * row, that the block lines up with the tower, and misses by a normal timing
 * error (`ms`) plus a normal error in where the eye puts the block (`px`,
 * which doesn't shrink as the block speeds up).
 */
type Skill = { name: string; ms: number; px: number };
const SKILLS: Skill[] = [
  { name: 'novice', ms: 90, px: 30 },
  { name: 'new', ms: 60, px: 20 },
  { name: 'good', ms: 40, px: 13 },
  { name: 'strong', ms: 28, px: 9 },
  { name: 'expert', ms: 18, px: 6 },
];
const CAP = 600;
/** Death zoom (1.55 s) plus the result card and a rematch tap. */
const OVERHEAD_MS = 2750;

/** One rules 2 run: its drop times and result. */
function humanDrops2(skill: Skill, rng: () => number): number[] {
  const run = createStackRun();
  const drops: number[] = [];
  while (!run.died && run.height < CAP) {
    const aim = stackAimElapsedMs(run, 180);
    const speed = stackRow(run.height).speed;
    const t = Math.max(
      run.rowStartMs + 130,
      Math.round(run.rowStartMs + aim + gauss(rng) * skill.ms + (gauss(rng) * skill.px) / speed),
    );
    drops.push(t);
    stackDropAt(run, t);
  }
  return drops;
}

/** One rules 1 run, through its own frame-counting sim. */
function humanRun1(skill: Skill, rng: () => number) {
  const sim = createStackSim();
  let frames = 0;
  while (!sim.died && sim.height < CAP) {
    const parity = sim.height % 2;
    const speed = stackSpeedForHeight(sim.height);
    const gapAt = (p: number) => Math.abs(stackMovingLeftAt(p, sim.width, parity, sim.height) - sim.left);
    let aim = 11; // 180 ms
    while (!(gapAt(aim) <= speed && gapAt(aim) <= gapAt(aim + 1)) && aim < 5000) aim += 1;
    sim.phase = Math.max(1, Math.round(aim + (gauss(rng) * skill.ms) / (1000 / 60) + (gauss(rng) * skill.px) / speed));
    frames += sim.phase;
    applyStackDrop(sim);
  }
  return { score: sim.height, ms: (frames * 1000) / 60 };
}

/** 75 x (1 - exp(-(score / scale)^power)), floored: rules 1 paid (40, 1.15). */
const curve = (score: number, scale: number, power: number) =>
  Math.max(0, Math.floor(Math.min(300, MAX_GAME_RUN_CREDITS * (1 - Math.exp(-Math.pow(Math.max(0, score / scale), power))))));
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;

// ---------------------------------------------------------------------------
console.log('1. Rules lock');
{
  assert(STACK_RULES_VERSION === 2, 'rules version 2');
  assert(STACK2_FAST_FROM === 30 && STACK2_NARROW_FROM === 60, 'fast rows from 30, narrower from 60');
  // The speed curve: rises every row, never by more than 2%, toward TOP.
  let worstStep = 0;
  for (let h = 1; h <= 400; h += 1) {
    const a = stackBaseSpeed(h - 1);
    const b = stackBaseSpeed(h);
    assert(b > a, `row ${h} is faster than row ${h - 1}`);
    worstStep = Math.max(worstStep, b / a - 1);
  }
  console.log(`   speed px/ms: ${[0, 15, 30, 45, 60, 80, 100, 150].map((h) => `${h}:${stackBaseSpeed(h).toFixed(3)}`).join(' ')}; worst row-to-row step ${(worstStep * 100).toFixed(2)}%`);
  assert(worstStep <= 0.02, 'no row is more than 2% faster than the one before');
  assert(stackBaseSpeed(0) === STACK2_BASE_SPEED && stackBaseSpeed(1e6) < STACK2_TOP_SPEED, 'the curve starts at BASE and stays under TOP');
  // Pressure 1: fast rows are the odd heights from 31, phased in.
  for (let h = 0; h < STACK2_FAST_FROM; h += 1) assert(!stackRow(h).fast, `row ${h} is not fast`);
  assert(stackRow(31).fast && !stackRow(32).fast && stackRow(33).fast, 'fast rows alternate from 31');
  const boost = (h: number) => stackRow(h).speed / stackBaseSpeed(h) - 1;
  assert(boost(31) > 0 && boost(31) < boost(35) && Math.abs(boost(45) - STACK2_FAST_BOOST) < 1e-12, 'the boost phases in to 25% by row 41');
  // Pressure 2: the width limit.
  assert(stackWidthLimit(59) === STACK_INITIAL_BLOCK_WIDTH && stackWidthLimit(60) === 200, 'the limit drops to 200 at 60');
  assert(stackWidthLimit(70) === 180 && stackWidthLimit(80) === 160 && stackWidthLimit(90) === 140, 'then 20 px every 10 rows');
  assert(stackWidthLimit(500) === STACK2_NARROW_MIN, 'down to 140');
  console.log(`   fast rows from ${STACK2_FAST_FROM + 1} (odd heights, +${STACK2_FAST_BOOST * 100}% by 41); width limit 200 at 60, 180 at 70, 160 at 80, 140 from 90`);

  // The sweep: inside the band, starts at its wall from rest, continuous,
  // never faster than 4/3 of the row's speed (the eased turn), and at the
  // row's speed exactly away from the walls.
  for (const h of [0, 7, 31, 64, 95, 150]) {
    const row = stackRow(h);
    for (const width of [220, 140, 60, 8]) {
      const span = STACK_BAND - width;
      assert(stackMoverLeft(row, width, 0) === (row.dir === 1 ? STACK_SWEEP_LEFT : STACK_SWEEP_LEFT + span), `h${h} w${width} starts at its wall`);
      let prev = stackMoverLeft(row, width, 0);
      let worst = 0;
      let inside = true;
      let steady = true;
      for (let ms = 0.25; ms < 8000; ms += 0.25) {
        const x = stackMoverLeft(row, width, ms);
        if (x < STACK_SWEEP_LEFT - 1e-9 || x > STACK_SWEEP_LEFT + span + 1e-9) inside = false;
        worst = Math.max(worst, Math.abs(x - prev) / 0.25);
        const fromWall = Math.min(x - STACK_SWEEP_LEFT, STACK_SWEEP_LEFT + span - x);
        if (fromWall > STACK2_TURN_PX + 1 && Math.abs(Math.abs(x - prev) / 0.25 - row.speed) > 1e-6) steady = false;
        prev = x;
      }
      assert(inside, `h${h} w${width} stays inside the band`);
      assert(worst <= (row.speed * 4) / 3 + 1e-9, `h${h} w${width} never jumps (peak ${(worst / row.speed).toFixed(3)}x)`);
      assert(steady, `h${h} w${width} is steady over the tower`);
    }
  }

  // Tickets: the route's pipeline and the sheet agree.
  for (let h = 0; h <= 400; h += 1) {
    const pays = calculateGameRewardCredits({ gameType: 'stack', score: h });
    assert(pays === stackRunTickets(h), `${h} pays ${pays} on the sheet too`);
    assert(pays <= MAX_GAME_RUN_CREDITS, `${h} pays within the per-run ceiling`);
  }
  console.log(`   pays: 15 -> ${stackRunTickets(15)}, 40 -> ${stackRunTickets(40)}, 60 -> ${stackRunTickets(60)}, 100 -> ${stackRunTickets(100)}, 150 -> ${stackRunTickets(150)} (scale ${STACK_REWARD_SCALE}, power ${STACK_REWARD_POWER})`);
}

// ---------------------------------------------------------------------------
console.log('2. Determinism');
{
  const rng = mulberry32(7);
  for (let i = 0; i < 60; i += 1) {
    const drops = humanDrops2(SKILLS[i % SKILLS.length], rng);
    const a = replayStackRun(drops, drops[drops.length - 1] + 100);
    const b = replayStackRun([...drops], drops[drops.length - 1] + 100);
    assert(JSON.stringify(a) === JSON.stringify(b), `run ${i} replays identically`);
    // Order doesn't matter (the route sorts), and neither does JSON.
    const shuffled = [...drops].sort(() => rng() - 0.5);
    const wire = JSON.parse(JSON.stringify(shuffled.map((t) => ({ t })))) as { t: number }[];
    const c = replayStackRun(wire.map((e) => e.t), drops[drops.length - 1] + 100);
    assert(JSON.stringify(a) === JSON.stringify(c), `run ${i} replays the same shuffled and over the wire`);
  }
  // The client sends whole ms; the route rounds again, which changes nothing.
  const drops = humanDrops2(SKILLS[2], mulberry32(99));
  const a = replayStackRun(drops, 1e9);
  const b = replayStackRun(drops.map((t) => t + 0.4), 1e9);
  assert(a.score === b.score && JSON.stringify(a.dropTimesMs) === JSON.stringify(b.dropTimesMs), 'sub-ms noise rounds away');
  assert(stackInputMs(1234.5, 1000) === 235 && stackInputMs(10, 1000) === 0, 'input ms: rounded, never negative');
  const digest = createHash('sha256').update(JSON.stringify([drops, a])).digest('hex').slice(0, 16);
  console.log(`   snapshot ${digest} (height ${a.score}, ${a.perfects} perfect)`);
  assert(digest === 'a004bf89a0bd20da', 'pinned snapshot unchanged');
}

// ---------------------------------------------------------------------------
console.log('3. Frame rates');
{
  // The client: frames every `interval` ms, with a stall of 3 to 8 frames
  // about every 1.5 s. Each frame draws the block for frame time + lead.
  // Taps are input events at their own times; the handler scores each one
  // at its event time, whatever frame it runs in.
  const rows: string[] = [];
  for (const hz of [30, 60, 75, 90, 120, 144]) {
    const interval = 1000 / hz;
    const lead = stackerDisplayLeadMs(interval);
    let worstSeen = 0;
    let worstRules1 = 0;
    let matched = 0;
    const runs = 30;
    for (let n = 0; n < runs; n += 1) {
      const rng = mulberry32(hz * 1000 + n);
      const input = humanDrops2(SKILLS[n % SKILLS.length], rng);
      // Event times carry sub-ms noise; the client turns them into whole ms.
      const events = input.map((t) => t + rng() * 0.98 - 0.49);
      const server = replayStackRun(events.map((t) => stackInputMs(t, 0)), Number.MAX_SAFE_INTEGER);

      const client = createStackRun();
      const sent: number[] = [];
      let lastT = -Infinity;
      let frame = 0;
      let next = 0;
      let lastDrawn: { left: number; height: number } | null = null;
      const frameRng = mulberry32(hz + n);
      while (next < events.length && !client.died) {
        // A frame at `frame`: draw, then handle the taps that arrived before it.
        const drawAt = frame + lead;
        const height = client.height;
        const left = stackMoverLeft(stackRow(height), stackMoverWidth(client), Math.max(0, drawAt - client.rowStartMs));
        lastDrawn = { left, height };
        const stall = frameRng() < interval / 1500 ? 3 + Math.floor(frameRng() * 6) : 0;
        const nextFrame = frame + interval * (1 + stall);
        while (next < events.length && events[next] <= nextFrame && !client.died) {
          const t = Math.max(client.rowStartMs, stackInputMs(events[next], 0));
          next += 1;
          if (t - lastT < 130) continue;
          lastT = t;
          sent.push(t);
          const before: StackRunState = { ...client };
          const result = stackDropAt(client, t);
          // What was on screen when the tap came: the last frame drawn
          // (if a stall swallowed the frames, the one before the stall).
          if (lastDrawn && lastDrawn.height === before.height) {
            const gap = Math.abs(result.movingLeft - lastDrawn.left);
            const speed = stackRow(before.height).speed;
            // One frame of motion (two after a stall), at the eased peak.
            const allowed = ((speed * 4) / 3) * (nextFrame - frame + lead) + 1e-6;
            worstSeen = Math.max(worstSeen, gap / allowed);
          }
          // Rules 1 would have moved the tap to the next 60 fps frame.
          worstRules1 = Math.max(worstRules1, ((Math.ceil(t / (1000 / 60)) * (1000 / 60) - t) * stackRow(before.height).speed));
        }
        frame = nextFrame;
      }
      const replayed = replayStackRun(sent, Number.MAX_SAFE_INTEGER);
      if (JSON.stringify(replayed) === JSON.stringify(server) && JSON.stringify(sent) === JSON.stringify(server.dropTimesMs)) matched += 1;
    }
    assert(matched === runs, `${hz} Hz: the client sends exactly what the route replays (${matched}/${runs})`);
    assert(worstSeen <= 1, `${hz} Hz: the block lands within one frame of motion of where it was drawn`);
    rows.push(`${hz} Hz: ${matched}/${runs} runs identical, landing within ${(worstSeen * 100).toFixed(0)}% of a frame's motion of the drawn block (rules 1 moved taps up to ${worstRules1.toFixed(1)} px)`);
  }
  for (const r of rows) console.log(`   ${r}`);
}

// ---------------------------------------------------------------------------
console.log('4. Tampered input');
{
  const drops = humanDrops2(SKILLS[3], mulberry32(5));
  const base = replayStackRun(drops, 1e9);
  const junk = replayStackRun([Number.NaN, -5, Infinity, ...drops] as number[], 1e9);
  assert(junk.score === base.score, 'NaN, negative and infinite times are dropped');
  const after = replayStackRun([...drops, drops[drops.length - 1] + 500, drops[drops.length - 1] + 900], 1e9);
  assert(after.score === base.score && after.dropTimesMs.length === base.dropTimesMs.length, 'nothing plays after the miss');
  const cut = replayStackRun(drops, drops[9]);
  assert(cut.dropTimesMs.length === 10, 'drops past the run are ignored');
  // A doubled drop is a real drop of the next block, at its wall: it is
  // scored where it was (a hard cut), never as a copy of the first.
  const twice = createStackRun();
  for (const t of drops.slice(0, 5)) stackDropAt(twice, t);
  const wall = stackRow(twice.height).dir === 1 ? STACK_SWEEP_LEFT : STACK_SWEEP_LEFT + STACK_BAND - stackMoverWidth(twice);
  const second = stackDropAt(twice, drops[4]);
  assert(second.movingLeft === wall && second.kind !== 'perfect', 'a doubled drop lands its block at the wall');
  const empty = replayStackRun([], 1e9);
  assert(empty.score === 0 && !empty.died, 'no drops, no height');
}

// ---------------------------------------------------------------------------
console.log('5. Heights by skill');
{
  type Row = { name: string; p10: number; p50: number; p90: number; p99: number; sPerRun: number; perRun: number; perMin: number; reachFast: number; reachNarrow: number };
  type Run = { score: number; ms: number };
  const runsBySkill = new Map<string, Run[]>();
  const table = (rules: 1 | 2, scale: number, power: number, n: number): Row[] =>
    SKILLS.map((skill) => {
      const rng = mulberry32(skill.ms * 7 + rules);
      const scores: number[] = [];
      let ms = 0;
      let tickets = 0;
      const kept: Run[] = [];
      for (let i = 0; i < n; i += 1) {
        let score: number;
        let runMs: number;
        if (rules === 1) {
          ({ score, ms: runMs } = humanRun1(skill, rng));
        } else {
          const drops = humanDrops2(skill, rng);
          const run = replayStackRun(drops, Number.MAX_SAFE_INTEGER);
          score = run.score;
          runMs = drops[drops.length - 1];
        }
        scores.push(score);
        ms += runMs + OVERHEAD_MS;
        tickets += curve(score, scale, power);
        kept.push({ score, ms: runMs + OVERHEAD_MS });
      }
      if (rules === 2) runsBySkill.set(skill.name, kept);
      return {
        name: skill.name,
        p10: pct(scores, 0.1),
        p50: pct(scores, 0.5),
        p90: pct(scores, 0.9),
        p99: pct(scores, 0.99),
        sPerRun: ms / n / 1000,
        perRun: tickets / n,
        perMin: (tickets / ms) * 60_000,
        reachFast: scores.filter((s) => s > STACK2_FAST_FROM).length / n,
        reachNarrow: scores.filter((s) => s >= STACK2_NARROW_FROM).length / n,
      };
    });
  const print = (label: string, rows: Row[]) => {
    console.log(`   ${label}`);
    for (const r of rows) {
      console.log(
        `     ${r.name.padEnd(7)} p10 ${String(r.p10).padStart(3)}  p50 ${String(r.p50).padStart(3)}  p90 ${String(r.p90).padStart(3)}  p99 ${String(r.p99).padStart(3)}` +
          `  ${r.sPerRun.toFixed(1).padStart(5)} s/run  ${r.perRun.toFixed(1).padStart(4)} tickets/run  ${r.perMin.toFixed(1).padStart(5)}/min` +
          (label.startsWith('rules 2') ? `  reach 31: ${(r.reachFast * 100).toFixed(0)}%, 60: ${(r.reachNarrow * 100).toFixed(0)}%` : ''),
      );
    }
  };
  const N1 = 500;
  const N2 = 1500;
  const old = table(1, 40, 1.15, N1);
  print(`rules 1, paid at (height / 40)^1.15 (${N1} runs a skill, runs stop at ${CAP})`, old);
  const now = table(2, STACK_REWARD_SCALE, STACK_REWARD_POWER, N2);
  print(`rules 2, paid at (height / ${STACK_REWARD_SCALE})^${STACK_REWARD_POWER} (${N2} runs a skill)`, now);

  const by = (rows: Row[], name: string) => rows.find((r) => r.name === name)!;
  assert(by(now, 'new').p50 >= 12 && by(now, 'new').p50 <= 20, `a new player reaches about 15 (median ${by(now, 'new').p50})`);
  assert(by(now, 'good').p50 >= 40 && by(now, 'good').p50 <= 60, `a good player reaches 40 to 60 (median ${by(now, 'good').p50})`);
  assert(by(now, 'expert').p50 > 100 && by(now, 'expert').p10 > 80, `an expert pushes past 100 (median ${by(now, 'expert').p50})`);
  assert(by(now, 'expert').p99 < CAP, 'nobody stacks forever');
  for (let i = 1; i < now.length; i += 1) assert(now[i].p50 > now[i - 1].p50, `${now[i].name} climbs higher than ${now[i - 1].name}`);

  // The curve: tickets a minute, rules 2 against rules 1, by skill.
  console.log('   tickets a minute, rules 1 -> rules 2:');
  for (const r of now) {
    const o = by(old, r.name);
    console.log(`     ${r.name.padEnd(7)} ${o.perMin.toFixed(1).padStart(5)} -> ${r.perMin.toFixed(1).padStart(5)} (${((r.perMin / o.perMin - 1) * 100).toFixed(1).padStart(6)}%)  per run ${o.perRun.toFixed(1)} -> ${r.perRun.toFixed(1)}`);
  }
  for (const name of ['new', 'good']) {
    const change = by(now, name).perMin / by(old, name).perMin - 1;
    assert(Math.abs(change) <= 0.1, `${name} players earn within 10% of rules 1 a minute (${(change * 100).toFixed(1)}%)`);
  }
  for (const name of ['strong', 'expert']) {
    assert(by(now, name).perMin >= by(old, name).perMin, `${name} players earn at least what they did`);
  }
  for (let h = 0; h <= 2000; h += 1) assert(stackRunTickets(h) <= MAX_GAME_RUN_CREDITS, `${h} stays inside the per-run cap`);
  for (let h = 1; h <= 400; h += 1) assert(stackRunTickets(h) >= stackRunTickets(h - 1), `${h} pays at least what ${h - 1} does`);

  // Refit: the best (scale, power) on a grid, for new and good together,
  // must stay close to the constants, so a change to the rules that moves
  // run lengths or heights fails here until the curve is refitted.
  const perMin = (runs: Run[], scale: number, power: number) =>
    (runs.reduce((a, r) => a + curve(r.score, scale, power), 0) / runs.reduce((a, r) => a + r.ms, 0)) * 60_000;
  const targets = { new: by(old, 'new').perMin, good: by(old, 'good').perMin };
  let fit = { err: Infinity, scale: 0, power: 0 };
  for (let power = 0.4; power <= 1.2001; power += 0.02) {
    for (let scale = 40; scale <= 160; scale += 2) {
      const err = Math.max(
        Math.abs(perMin(runsBySkill.get('new')!, scale, power) / targets.new - 1),
        Math.abs(perMin(runsBySkill.get('good')!, scale, power) / targets.good - 1),
      );
      if (err < fit.err) fit = { err, scale, power };
    }
  }
  console.log(`   refit: scale ${fit.scale}, power ${fit.power.toFixed(2)} (worst miss ${(fit.err * 100).toFixed(1)}%); shipped scale ${STACK_REWARD_SCALE}, power ${STACK_REWARD_POWER}`);
  assert(Math.abs(fit.scale - STACK_REWARD_SCALE) <= 12 && Math.abs(fit.power - STACK_REWARD_POWER) <= 0.06, 'the shipped curve is the fitted one');
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
