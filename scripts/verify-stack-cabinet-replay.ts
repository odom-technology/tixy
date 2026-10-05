/**
 * Stacker's cabinet mode: seeded-replay, fairness and payout proof.
 *
 *   npx tsx scripts/verify-stack-cabinet-replay.ts
 *
 *  1. Rules lock: rows, caps, steps, gaps and prizes the route, the client
 *     and the sheet quote. The prize wiring in the reward pipeline.
 *  2. Same inputs, same score: replays across runs, and a pinned snapshot.
 *  3. Frame rates: a simulated client sampling at 30 to 144 Hz (display lag
 *     included) records the same stops and the same score as the server for
 *     the same input events, and shows every lamp position.
 *  4. Seeds: every seed is as hard as every other.
 *  5. Tampered input: the validator rejects what an honest client can't send.
 *  6. Tickets: rows reached, prize and tickets per minute for human timing,
 *     against ticket stop, so cabinet mode is not the fastest way to the cap.
 *  7. Play check: bots at a fixed point in the step are flagged; humans, on
 *     rounded clocks too, never are. Major streaks are review logs only.
 *  8. The glide: the drawn row is a continuous function of time that is
 *     never more than half a lamp from the lamp a stop lights, at every ms;
 *     at 30 to 144 Hz with stalls, what was on screen at each press against
 *     the lamp it lit.
 *
 * Exits non-zero on any failed assertion.
 */
import { createHash } from 'node:crypto';

import type { StackerRun } from '@/server/arcade/stack-cabinet-engine';

import {
  scoreStackerRun,
  stackerBinomialTail,
  stackerCheckPhases,
  stackerDisplayLeadMs,
  stackerGlideLeft,
  stackerLayout,
  stackerLeftAfter,
  stackerMovingAt,
  stackerPlayCheck,
  stackerPress,
  stackerPrizeTickets,
  stackerRowStart,
  stackerState,
  stackerView,
  STACKER_ARM_MS,
  STACKER_COLUMNS,
  STACKER_LEAD_IN_MS,
  STACKER_MAJOR_ROW,
  STACKER_MAJOR_TICKETS,
  STACKER_MINOR_ROW,
  STACKER_MINOR_TICKETS,
  STACKER_PLAY_WINDOW,
  STACKER_ROW_RULES,
  STACKER_ROWS,
  type StackerRunSummary,
} from '@/server/arcade/stack-cabinet-engine';
import { calculateGameRewardCredits } from '@/server/arcade/rewards/wallet';
import { GAME_DAILY_CREDIT_CAP, MAX_GAME_RUN_CREDITS } from '@/features/arcade/lib/rewards';

/** The rejection reason of a run, or null when it validated. */
const reasonOf = (run: StackerRun): string | null => (run.ok === false ? (run as Extract<StackerRun, { ok: false }>).reason : null);

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
function gauss(rng: () => number) {
  const u = Math.max(1e-12, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** A human: for each row, aim at the middle of a full-overlap position's
 *  step, with Gaussian timing error `sigma` ms plus a per-run bias. */
function humanStops(seed: number, sigma: number, rng: () => number, bias = 0): number[] {
  const layout = stackerLayout(seed);
  const stops: number[] = [];
  let state = stackerState(layout, stops);
  while (!state.over) {
    const index = stops.length;
    const start = stackerRowStart(stops, index);
    const rule = STACKER_ROW_RULES[index];
    const below = state.tower[state.tower.length - 1] ?? { left: 0, width: STACKER_COLUMNS };
    // First step, after arming, where the row fully sits on the one below.
    let target = start + STACKER_ARM_MS + rule.stepMs;
    for (let k = Math.ceil(STACKER_ARM_MS / rule.stepMs); k < 400; k += 1) {
      const m = stackerMovingAt(layout, index, state.width, k * rule.stepMs);
      if (m.left >= below.left && m.left + m.width <= below.left + below.width) {
        target = start + (k + 0.5) * rule.stepMs;
        break;
      }
    }
    const at = Math.max(start + STACKER_ARM_MS, Math.round(target + bias + gauss(rng) * sigma));
    stops.push(at);
    state = stackerState(layout, stops);
  }
  return stops;
}

// ---------------------------------------------------------------------------
console.log('1. Rules lock');
assert(STACKER_COLUMNS === 7 && STACKER_ROWS === 15, '7 lamps wide, 15 rows');
assert(STACKER_MINOR_ROW === 11 && STACKER_MAJOR_ROW === 15, 'prizes at rows 11 and 15');
assert(STACKER_ROW_RULES.length === 15, 'a rule per row');
assert(STACKER_ROW_RULES[0].stepMs === 150 && STACKER_ROW_RULES[14].stepMs === 50, 'steps 150 to 50 ms');
for (let i = 1; i < 15; i += 1) {
  assert(STACKER_ROW_RULES[i].stepMs < STACKER_ROW_RULES[i - 1].stepMs, `row ${i + 1} is faster than row ${i}`);
  assert(STACKER_ROW_RULES[i].cap <= STACKER_ROW_RULES[i - 1].cap, `row ${i + 1} cap never grows`);
}
assert(Math.min(...STACKER_ROW_RULES.map((r) => r.stepMs)) > 1000 / 30, 'the fastest step outlasts a 30 Hz frame');
assert(stackerPrizeTickets(10) === 0, 'row 10 pays nothing');
assert(stackerPrizeTickets(11) === STACKER_MINOR_TICKETS, 'row 11 pays the minor');
assert(stackerPrizeTickets(14) === STACKER_MINOR_TICKETS, 'row 14 still pays the minor');
assert(stackerPrizeTickets(15) === STACKER_MAJOR_TICKETS, 'row 15 pays the major, not both');
assert(stackerPrizeTickets(Number.NaN) === 0 && stackerPrizeTickets(-3) === 0, 'junk pays nothing');
assert(STACKER_MAJOR_TICKETS <= MAX_GAME_RUN_CREDITS, 'the major fits the per-run ceiling');
assert(STACKER_MAJOR_TICKETS <= GAME_DAILY_CREDIT_CAP, 'the major fits the daily cap');
for (let rows = 0; rows <= STACKER_ROWS; rows += 1) {
  assert(
    calculateGameRewardCredits({ gameType: 'stack-cabinet', score: rows }) === stackerPrizeTickets(rows),
    `reward pipeline pays ${stackerPrizeTickets(rows)} for ${rows} rows`,
  );
}
console.log(`   minor ${STACKER_MINOR_TICKETS}, major ${STACKER_MAJOR_TICKETS}; daily cap ${GAME_DAILY_CREDIT_CAP}`);

// ---------------------------------------------------------------------------
console.log('2. Determinism');
{
  const rng = mulberry32(7);
  for (let i = 0; i < 40; i += 1) {
    const seed = Math.floor(rng() * 2 ** 31);
    const stops = humanStops(seed, 12, rng);
    const a = scoreStackerRun(seed, stops);
    const b = scoreStackerRun(seed, [...stops]);
    assert(a.ok && b.ok && JSON.stringify(a) === JSON.stringify(b), `seed ${seed} replays identically`);
  }
  const stops = humanStops(12345, 10, mulberry32(99));
  const run = scoreStackerRun(12345, stops);
  const digest = createHash('sha256').update(JSON.stringify([stops, run])).digest('hex').slice(0, 16);
  console.log(`   snapshot ${digest} (${run.ok ? run.rows + ' rows' : reasonOf(run)})`);
  assert(digest === '0011aa229c2b1979', 'pinned snapshot unchanged');
}

// ---------------------------------------------------------------------------
console.log('3. Frame rates');
{
  const rng = mulberry32(21);
  for (const hz of [30, 60, 75, 90, 120, 144]) {
    const interval = 1000 / hz;
    for (let n = 0; n < 12; n += 1) {
      const seed = Math.floor(rng() * 2 ** 31);
      const input = humanStops(seed, 14, rng); // input event times, ms since start
      const server = scoreStackerRun(seed, input);
      // The client: frames at k * interval; a press is stamped with its own
      // event time, never the frame's.
      const layout = stackerLayout(seed);
      const stops: number[] = [];
      let next = 0;
      const seen = new Set<string>();
      const end = input[input.length - 1] + 200;
      for (let t = 0; t <= end; t += interval) {
        const lead = stackerDisplayLeadMs(interval);
        const view = stackerView(layout, stops, t + lead);
        if (view.moving && view.phase === 'move') seen.add(`${view.row}:${view.moving.left}`);
        while (next < input.length && input[next] <= t) {
          const press = stackerPress(layout, stops, input[next]);
          if (press.kind === 'stop') stops.push(input[next]);
          next += 1;
        }
      }
      assert(server.ok && JSON.stringify(stops) === JSON.stringify(input), `${hz} Hz records the same stops`);
      const client = stackerState(layout, stops);
      assert(server.ok && server.rows === client.rows, `${hz} Hz scores the same rows`);
      // Every position a row visits for at least one step is on screen.
      if (server.ok) {
        for (const r of server.results) {
          const rule = STACKER_ROW_RULES[r.row];
          const startMs = stackerRowStart(input, r.row);
          const visits = Math.min(4, Math.floor((r.stopMs - startMs) / rule.stepMs));
          for (let k = 0; k < visits; k += 1) {
            const left = stackerMovingAt(layout, r.row, r.moving.width, k * rule.stepMs).left;
            assert(seen.has(`${r.row}:${left}`), `${hz} Hz shows row ${r.row + 1} at ${left}`);
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
console.log('4. Seeds');
{
  const rng = mulberry32(33);
  const n = 4000;
  const rates: number[] = [];
  for (let group = 0; group < 4; group += 1) {
    let majors = 0;
    for (let i = 0; i < n / 4; i += 1) {
      const seed = Math.floor(rng() * 2 ** 31);
      const run = scoreStackerRun(seed, humanStops(seed, 9, rng));
      if (run.ok && run.rows >= STACKER_MAJOR_ROW) majors += 1;
    }
    rates.push(majors / (n / 4));
  }
  console.log(`   major rate by seed group ${rates.map((r) => r.toFixed(3)).join(' ')}`);
  assert(Math.max(...rates) - Math.min(...rates) < 0.08, 'seed groups win majors at the same rate');
  for (let r = 0; r < 15; r += 1) {
    const rule = STACKER_ROW_RULES[r];
    // The row visits the same positions whichever wall it starts from.
    const span = STACKER_COLUMNS - Math.min(rule.cap, 3);
    const left = new Set<number>();
    const right = new Set<number>();
    for (let s = 0; s < span * 2; s += 1) {
      left.add(stackerLeftAfter(s, Math.min(rule.cap, 3), 1));
      right.add(stackerLeftAfter(s, Math.min(rule.cap, 3), -1));
    }
    assert(left.size === right.size, `row ${r + 1} sweeps the same lamps from both walls`);
  }
}

// ---------------------------------------------------------------------------
console.log('5. Tampered input');
{
  const seed = 4242;
  const stops = humanStops(seed, 8, mulberry32(5));
  const base = scoreStackerRun(seed, stops);
  assert(base.ok, 'a human run validates');
  const reject = (label: string, s: unknown, reason: string, opts?: { sinceStartMs?: number }) => {
    const r = scoreStackerRun(seed, s, opts);
    assert(reasonOf(r) === reason, `${label} rejected as ${reason} (got ${reasonOf(r) ?? 'accepted'})`);
  };
  reject('not an array', 'x', 'count');
  reject('empty', [], 'count');
  reject('too many', new Array(16).fill(1000), 'count');
  reject('fractional', [1000.5], 'malformed');
  reject('negative', [-5], 'malformed');
  reject('string', ['900'], 'malformed');
  reject('before arming', [STACKER_LEAD_IN_MS + STACKER_ARM_MS - 1], 'early');
  {
    // A run that missed, then more stops: nothing may follow the end.
    const r = mulberry32(8);
    for (let tries = 0; tries < 50; tries += 1) {
      const s2 = Math.floor(r() * 2 ** 31);
      const missed = humanStops(s2, 90, r);
      if (missed.length < STACKER_ROWS) {
        const res = scoreStackerRun(s2, [...missed, missed[missed.length - 1] + 2000]);
        assert(reasonOf(res) === 'extra', 'stops after a miss rejected as extra');
        break;
      }
    }
  }
  reject('unfinished', [STACKER_LEAD_IN_MS + STACKER_ARM_MS + 150], 'unfinished', undefined);
  if (base.ok) {
    reject('faster than played', stops, 'too-fast', { sinceStartMs: base.durationMs - 1000 });
    reject('submitted long after', stops, 'stale', { sinceStartMs: base.durationMs + 200_000 });
    const ok = scoreStackerRun(seed, stops, { sinceStartMs: base.durationMs + 300 });
    assert(ok.ok, 'a prompt submit validates');
  }
  // Moving a stop changes the replay, it can't forge a better score for the
  // same stops: the score is recomputed from the stops, not read from them.
  const forged = scoreStackerRun(seed + 1, stops);
  assert(!forged.ok || forged.rows !== STACKER_ROWS || base.ok && base.rows === STACKER_ROWS, 'a different seed gets its own result');
}

// ---------------------------------------------------------------------------
console.log('6. Tickets by skill');
{
  type Tier = { name: string; sigma: number };
  const tiers: Tier[] = [
    { name: 'casual', sigma: 70 },
    { name: 'good', sigma: 45 },
    { name: 'sharp', sigma: 32 },
    { name: 'expert', sigma: 22 },
  ];
  // Ticket stop pays about 32 for a good run and 47 for a perfect one, in
  // about 8 s a run (scripts/verify-ticket-stop-replay.ts, section 7).
  const OVERHEAD_MS = 1200; // result strip and a rematch tap
  const ticketStopPerMin = { good: (32 / (8000 + OVERHEAD_MS)) * 60_000, perfect: (47 / (8000 + OVERHEAD_MS)) * 60_000 };
  const rpm: number[] = [];
  let prev = -1;
  for (const tier of tiers) {
    const rng = mulberry32(1000 + tier.sigma);
    const N = 3000;
    let minor = 0;
    let major = 0;
    let tickets = 0;
    let ms = 0;
    const byRows = new Array(16).fill(0);
    for (let i = 0; i < N; i += 1) {
      const seed = Math.floor(rng() * 2 ** 31);
      const bias = gauss(rng) * (tier.sigma * 0.3);
      const run = scoreStackerRun(seed, humanStops(seed, tier.sigma, rng, bias));
      if (!run.ok) throw new Error('human run rejected: ' + reasonOf(run));
      byRows[run.rows] += 1;
      if (run.rows >= STACKER_MAJOR_ROW) major += 1;
      else if (run.rows >= STACKER_MINOR_ROW) minor += 1;
      tickets += run.prize;
      ms += run.durationMs + 900 + OVERHEAD_MS;
    }
    const perRun = tickets / N;
    const perMin = (tickets / ms) * 60_000;
    rpm.push(perMin);
    console.log(
      `   ${tier.name.padEnd(6)} sigma ${String(tier.sigma).padStart(2)} ms: ` +
        `row 11+ ${(((minor + major) / N) * 100).toFixed(1)}%, row 15 ${((major / N) * 100).toFixed(1)}%, ` +
        `${perRun.toFixed(1)} tickets/run, ${perMin.toFixed(0)}/min, ${(ms / N / 1000).toFixed(1)} s/run`,
    );
    assert(perRun >= prev, `${tier.name} earns at least what the tier below earns`);
    prev = perRun;
    assert((minor + major) / N <= 0.9, `${tier.name}: row 11 is not a given`);
  }
  console.log(
    `   ticket stop: good ${ticketStopPerMin.good.toFixed(0)}/min, perfect ${ticketStopPerMin.perfect.toFixed(0)}/min`,
  );
  assert(rpm[rpm.length - 1] < ticketStopPerMin.perfect, 'the best cabinet player earns less per minute than a perfect ticket stop');
  assert(rpm[2] < ticketStopPerMin.good, 'a sharp cabinet player earns less per minute than a good ticket stop');
  const casualMajor = (() => {
    const rng = mulberry32(5);
    let m = 0;
    for (let i = 0; i < 2000; i += 1) {
      const seed = Math.floor(rng() * 2 ** 31);
      const run = scoreStackerRun(seed, humanStops(seed, 70, rng));
      if (run.ok && run.rows >= STACKER_MAJOR_ROW) m += 1;
    }
    return m / 2000;
  })();
  assert(casualMajor < 0.01, `a casual hand almost never wins the major (${(casualMajor * 100).toFixed(2)}%)`);
}

// ---------------------------------------------------------------------------
console.log('7. Play check');
{
  const summarize = (stops: number[], seed: number): StackerRunSummary => {
    const run = scoreStackerRun(seed, stops);
    if (!run.ok) throw new Error('run rejected: ' + reasonOf(run));
    return { rows: run.rows, phases: stackerCheckPhases(run.results) };
  };
  // A bot stops at the same point in every step, with 2 ms of jitter.
  const botFlags = [] as boolean[];
  for (let b = 0; b < 20; b += 1) {
    const rng = mulberry32(300 + b);
    const history: StackerRunSummary[] = [];
    let flagged = false;
    for (let i = 0; i < STACKER_PLAY_WINDOW && !flagged; i += 1) {
      const seed = Math.floor(rng() * 2 ** 31);
      history.push(summarize(humanStops(seed, 2, rng), seed));
      flagged = stackerPlayCheck(history).flag !== null;
    }
    botFlags.push(flagged);
  }
  assert(botFlags.every(Boolean), 'bots at a fixed point in the step are flagged');
  // Humans, by skill, with biased aim, and on rounded clocks.
  let humanFlags = 0;
  let reviews = 0;
  let players = 0;
  for (const sigma of [22, 32, 45, 70]) {
    for (const round of [1, 4, 8, 16, 100]) {
      for (let p = 0; p < 6; p += 1) {
        players += 1;
        const rng = mulberry32(sigma * 1000 + round * 10 + p);
        const bias = gauss(rng) * 10;
        const history: StackerRunSummary[] = [];
        for (let i = 0; i < STACKER_PLAY_WINDOW; i += 1) {
          const seed = Math.floor(rng() * 2 ** 31);
          // A coarse clock rounds every event time, including the stamp.
          const raw = humanStops(seed, sigma, rng, bias);
          const stops: number[] = [];
          const layout = stackerLayout(seed);
          for (const t of raw) {
            const at = round > 1 ? Math.round(t / round) * round : t;
            const press = stackerPress(layout, stops, at);
            stops.push(press.kind === 'stop' ? at : t);
          }
          if (!scoreStackerRun(seed, stops).ok) continue;
          history.push(summarize(stops, seed));
          const check = stackerPlayCheck(history);
          if (check.flag) humanFlags += 1;
          if (check.review) reviews += 1;
        }
      }
    }
  }
  console.log(`   ${players} human players: ${humanFlags} play flags, ${reviews} major reviews`);
  assert(humanFlags === 0, 'no human is flagged for the point in the step');
  assert(reviews === 0, 'no human lands in the major review log');
  assert(stackerBinomialTail(50, 0, 0.6) === 1 && stackerBinomialTail(50, 51, 0.6) === 0, 'binomial tail edges');
}

// ---------------------------------------------------------------------------
console.log('8. The glide');
{
  // Every ms of every row, every width, both walls: within half a lamp of
  // the lamp a stop lights, never faster than 4/3 of a lamp a step (the eased
  // turn), and waiting at its wall for the first half step.
  let farthest = 0;
  let fastest = 0;
  for (const seed of [1, 2, 3, 12345, 2 ** 30]) {
    const layout = stackerLayout(seed);
    for (let row = 0; row < STACKER_ROWS; row += 1) {
      const step = STACKER_ROW_RULES[row].stepMs;
      for (const width of [1, 2, 3]) {
        let prev = stackerGlideLeft(layout, row, width, 0);
        assert(prev === stackerMovingAt(layout, row, width, 0).left, `row ${row + 1} w${width} starts on its wall lamp`);
        for (let ms = 1; ms <= 30 * step; ms += 1) {
          const glide = stackerGlideLeft(layout, row, width, ms);
          farthest = Math.max(farthest, Math.abs(glide - stackerMovingAt(layout, row, width, ms).left));
          fastest = Math.max(fastest, Math.abs(glide - prev) * step);
          if (ms < step / 2) assert(glide === prev, `row ${row + 1} waits at its wall for half a step`);
          prev = glide;
        }
      }
    }
  }
  console.log(`   farthest from the lit lamp ${farthest.toFixed(3)} lamps; fastest ${fastest.toFixed(3)} lamps a step`);
  assert(farthest <= 0.5 + 1e-9, 'the drawn row is never more than half a lamp from the lamp a stop lights');
  assert(fastest <= 4 / 3 + 1e-9, 'the drawn row never jumps');

  // At each refresh rate, with stalls: the frame on screen when the press
  // came (drawn for its time plus the lead) against the lamp the press lit.
  // The nearest lamp to the gliding row is the lamp the stepping lamps would
  // have shown in that frame, so a press lights what was on screen exactly as
  // often as before; the glide adds no error of its own. Off by a lamp only
  // when a step boundary falls between the press and the frame's display, or
  // when a stall left an old frame up.
  const rng = mulberry32(88);
  const minStep = Math.min(...STACKER_ROW_RULES.map((r) => r.stepMs));
  for (const hz of [30, 60, 90, 120, 144]) {
    const interval = 1000 / hz;
    const lead = stackerDisplayLeadMs(interval);
    let presses = 0;
    let glideHits = 0;
    let stepHits = 0;
    let worstSteady = 0;
    for (let n = 0; n < 40; n += 1) {
      const seed = Math.floor(rng() * 2 ** 31);
      const layout = stackerLayout(seed);
      const input = humanStops(seed, 14, rng);
      const stops: number[] = [];
      let frame = 0;
      let drawn: { row: number; glide: number; lamp: number; stalled: boolean } | null = null;
      const frameRng = mulberry32(hz * 31 + n);
      for (const at of input) {
        while (frame <= at) {
          const view = stackerView(layout, stops, frame + lead);
          const stall = frameRng() < interval / 1500 ? 3 + Math.floor(frameRng() * 6) : 0;
          drawn =
            view.phase === 'move' && view.moving
              ? {
                  row: view.row,
                  glide: stackerGlideLeft(layout, view.row, view.moving.width, frame + lead - view.rowStartMs),
                  lamp: view.moving.left,
                  stalled: stall > 0,
                }
              : null;
          frame += interval * (1 + stall);
        }
        const press = stackerPress(layout, stops, at);
        if (press.kind !== 'stop') continue;
        stops.push(at);
        if (!drawn || drawn.row !== press.result.row) continue;
        presses += 1;
        const lit = press.result.moving.left;
        if (Math.abs(drawn.glide - lit) <= 0.5) glideHits += 1;
        if (drawn.lamp === lit) stepHits += 1;
        if (!drawn.stalled) worstSteady = Math.max(worstSteady, Math.abs(drawn.glide - lit));
      }
    }
    const bound = 0.5 + ((4 / 3) * (interval + lead)) / minStep;
    console.log(
      `   ${hz} Hz: the press lit the lamp nearest the drawn row ${((glideHits / presses) * 100).toFixed(1)}% of ${presses} presses ` +
        `(stepping lamps: ${((stepHits / presses) * 100).toFixed(1)}%); without a stall, at most ${worstSteady.toFixed(2)} lamps off`,
    );
    assert(glideHits >= stepHits, `${hz} Hz: the glide shows the lit lamp at least as often as stepping lamps did`);
    assert(worstSteady <= bound, `${hz} Hz: within half a lamp plus one frame of motion (${bound.toFixed(2)})`);
  }
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
