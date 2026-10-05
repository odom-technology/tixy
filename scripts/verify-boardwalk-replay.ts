/**
 * Offline REACHABILITY + REPLAY-PARITY proof for Boardwalk Hop.
 *
 *   npx tsx scripts/verify-boardwalk-replay.ts
 *
 * Proves four things the game's fairness + score route depend on:
 *  1. Layout determinism + invariants — rowInfo(seed, row) is pure (repeat
 *     calls identical), spacing/length/speed always inside the documented
 *     bounds, and a log is ALWAYS present within the grid on flume rows
 *     (spacing ≤ COLS).
 *  2. Reachability — a lookahead survivor bot (planning ONLY with the exported
 *     shared functions, at human cadence) reaches deep rows on thousands of
 *     seeds. The fairness gate: ZERO forced deaths below row 60 (the depth
 *     range real players live in) and at most a 0.75% tail of unwinnable
 *     deep-game corners out to row 120 — the difficulty ramp is what
 *     terminates marathon runs.
 *  3. Replay parity — the bot's recorded hop log replays to EXACTLY the
 *     furthest row + score the bot computed live via stepHop outcomes.
 *  4. Tamper detection — cadence violations, off-grid hops, hopping into a
 *     cart, landing in open water, and idling past the gull window are all
 *     caught by replayBoardwalkRun.
 *
 * Exits non-zero on any failed assertion.
 */
import {
  COLS,
  START_COL,
  GAP_MIN,
  HOP_COOLDOWN_MS,
  IDLE_GRACE_MS,
  CLOSE_CALL_BONUS,
  CLOSE_CALL_STREAK_CAP,
  idleLimitMs,
  rowInfo,
  stepHop,
  dwellDeath,
  playerXAt,
  replayBoardwalkRun,
  type BoardwalkHopEvent,
  type HopDir,
  type PlayerPos,
} from '@/server/arcade/boardwalk-hop-replay';

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error('  FAIL: ' + msg);
    failures += 1;
  }
};

const SEEDS = 2_000;
const TARGET_ROW = 120;
/** Pass a seed as argv[2] to debug a single run verbosely. */
const DEBUG_SEED = process.argv[2] ? Number(process.argv[2]) >>> 0 : null;

// ── 1. Layout determinism + invariants ─────────────────────────────────────
console.log('1. Layout determinism + invariants…');
{
  let flumes = 0;
  let roads = 0;
  for (let s = 0; s < 200; s += 1) {
    const seed = (s * 2654435761) >>> 0;
    for (let r = 0; r <= 200; r += 1) {
      const a = rowInfo(seed, r);
      const b = rowInfo(seed, r);
      assert(JSON.stringify(a) === JSON.stringify(b), `rowInfo not pure at seed=${seed} row=${r}`);
      if (a.kind === 'safe') continue;
      const h = a.hazard;
      if (a.kind === 'flume') flumes += 1;
      else roads += 1;
      assert(h.len >= 1 && h.len <= 3, `bad len ${h.len} at row ${r}`);
      assert(a.kind !== 'road' || h.len <= 2, `cart too long (${h.len}) at row ${r}`);
      assert(a.kind !== 'flume' || h.len >= 2, `log too short (${h.len}) at row ${r}`);
      assert(h.spacing >= h.len + GAP_MIN, `spacing ${h.spacing} < len+gap at row ${r}`);
      assert(a.kind !== 'flume' || h.spacing <= COLS, `flume spacing ${h.spacing} > COLS at row ${r}`);
      assert(h.velTilesPerMs > 0 && h.velTilesPerMs < 0.004, `speed out of range at row ${r}`);
    }
  }
  assert(flumes > 0 && roads > 0, 'generator never produced both row kinds');
  console.log(`   ok (${roads} road rows, ${flumes} flume rows sampled)`);
}

// ── 2 + 3. Reachability bot + replay parity ────────────────────────────────
//
// The bot plans with ONLY the shared exported functions (like the client) at a
// human cadence: it scans forward in 25ms steps for the earliest time a hop is
// SAFE (lands alive and the landing position survives a planning dwell), never
// acting faster than the cooldown, and always acting before its own gull
// deadline and before any dwell death on its current tile/log.
console.log(`2. Reachability bot over ${SEEDS} seeds to row ${TARGET_ROW}…`);

const REACT_MS = 150; // bot's minimum think time between hops (> cooldown)
const SCAN_STEP_MS = 25;
const SAFE_DWELL_MS = 320; // landing must be survivable this long (time to re-plan)
const DEADLINE_SAFETY_MS = 220; // act this early relative to the gull deadline

type BotOutcome = {
  events: BoardwalkHopEvent[];
  furthest: number;
  score: number;
  died: string | null;
  endT: number;
};

const isSafe = (seed: number, pos: PlayerPos, dir: HopDir, t: number): PlayerPos | null => {
  const out = stepHop(seed, pos, dir, t);
  if (!out.ok || out.died) return null;
  if (dwellDeath(seed, out.pos, t, t + SAFE_DWELL_MS)) return null;
  return out.pos;
};

/**
 * Receding-horizon planner: from (pos, ready-time), find a hop sequence whose
 * FIRST hop we execute, preferring the earliest safe forward hop, else chaining
 * up to `depth` repositioning hops (walk the log / cross columns / retreat)
 * that lead to a safe forward hop before the gull deadline. Everything is
 * evaluated with the exported shared functions only.
 */
const planHops = (
  seed: number,
  pos: PlayerPos,
  tReady: number,
  deadline: number,
  depth: number,
  verifyRow: number | null,
): { dir: HopDir; at: number } | null => {
  if (tReady > deadline) return null;
  // Cap the scan at the moment the CURRENT position turns lethal.
  let scanEnd = deadline;
  const dw = dwellDeath(seed, pos, tReady, deadline + SAFE_DWELL_MS);
  if (dw) scanEnd = Math.min(scanEnd, dw.t - 40);
  if (scanEnd < tReady) return null; // already doomed here

  // Candidate take-off times: the scan grid PLUS the boundary instant (the
  // last possible moment before the current tile turns lethal — a real
  // squeeze play the grid alone can miss).
  const times: number[] = [];
  for (let tc = tReady; tc <= scanEnd; tc += SCAN_STEP_MS) times.push(tc);
  if (times[times.length - 1] !== scanEnd) times.push(scanEnd);

  // Forward hop. With verifyRow set (top-level planning), a landing on the new
  // furthest row must also admit a CONTINUATION to the row after it inside the
  // refreshed idle window — this is the "pick the RIGHT log, not the first
  // log" lookahead a human plays with. If nothing verifies, fall back to the
  // landing that stays alive the LONGEST (better to advance and fight than
  // idle into the gull — but don't board a log that dies in 300ms if a
  // longer-lived one exists).
  let fallback: { dir: HopDir; at: number } | null = null;
  let fallbackLife = -Infinity;
  for (const tc of times) {
    const out = stepHop(seed, pos, 'U', tc);
    if (!out.ok || out.died) continue;
    if (dwellDeath(seed, out.pos, tc, tc + SAFE_DWELL_MS)) continue;
    if (verifyRow === null || out.pos.row !== verifyRow) return { dir: 'U', at: tc };
    const nextDeadline = tc + idleLimitMs(verifyRow) - DEADLINE_SAFETY_MS;
    if (planHops(seed, out.pos, tc + REACT_MS, nextDeadline, 2, null)) {
      return { dir: 'U', at: tc };
    }
    const doom = dwellDeath(seed, out.pos, tc, tc + 60_000);
    const life = doom ? doom.t - tc : 60_000;
    if (life > fallbackLife) {
      fallback = { dir: 'U', at: tc };
      fallbackLife = life;
    }
  }
  if (depth === 0) return fallback;

  // Repositioning: for each sidestep/retreat, try a few take-off times and
  // recurse. Sidestep TOWARD THE CENTER first (edge columns are where corner
  // pins happen); retreating is the last resort.
  const xNow = playerXAt(seed, pos, tReady);
  const sidesteps: HopDir[] =
    xNow > (COLS - 1) / 2 ? ['L', 'R', 'D'] : ['R', 'L', 'D'];
  for (const dir of sidesteps) {
    for (
      let tc = tReady;
      tc <= Math.min(scanEnd, tReady + 1_600);
      tc += SCAN_STEP_MS * 3
    ) {
      const landed = isSafe(seed, pos, dir, tc);
      if (!landed) continue;
      const sub = planHops(seed, landed, tc + REACT_MS, deadline, depth - 1, verifyRow);
      if (sub) return { dir, at: tc };
    }
    // The boundary-instant sidestep (squeeze out at the last moment).
    const lastTc = Math.min(scanEnd, tReady + 1_600);
    const landed = isSafe(seed, pos, dir, lastTc);
    if (landed) {
      const sub = planHops(seed, landed, lastTc + REACT_MS, deadline, depth - 1, verifyRow);
      if (sub) return { dir, at: lastTc };
    }
  }
  return fallback;
};

const runBot = (seed: number): BotOutcome => {
  const events: BoardwalkHopEvent[] = [];
  let pos: PlayerPos = { mode: 'ground', row: 0, col: START_COL };
  let t = 300; // idle a beat before the first hop, like a human
  let lastHopT = -Infinity;
  let lastForwardT = 0;
  let furthest = 0;
  let score = 0;
  let closeStreak = 0;
  let guard = 0;

  const hop = (dir: HopDir, at: number): boolean => {
    const out = stepHop(seed, pos, dir, at);
    if (!out.ok || out.died) return false;
    events.push({ dir, t: at });
    pos = out.pos;
    lastHopT = at;
    t = at;
    if (pos.row > furthest) {
      furthest = pos.row;
      lastForwardT = at;
      let pts = 1;
      if (out.closeCall) {
        closeStreak += 1;
        pts += CLOSE_CALL_BONUS * Math.min(closeStreak, CLOSE_CALL_STREAK_CAP);
      } else {
        closeStreak = 0;
      }
      score += pts;
    }
    return true;
  };

  while (furthest < TARGET_ROW) {
    guard += 1;
    if (guard > 8_000) return { events, furthest, score, died: 'bot-loop-guard', endT: t };

    const deadline = lastForwardT + idleLimitMs(furthest) - DEADLINE_SAFETY_MS;
    const earliest = Math.max(t, lastHopT + REACT_MS);
    if (earliest > deadline) {
      return { events, furthest, score, died: 'gull-no-time', endT: t };
    }

    const plan =
      planHops(seed, pos, earliest, deadline, 4, furthest + 1) ??
      planHops(seed, pos, earliest, deadline, 6, furthest + 1);
    if (!plan) {
      if (DEBUG_SEED !== null) {
        const x = playerXAt(seed, pos, earliest);
        console.error(
          `  [debug] STUCK: pos=${JSON.stringify(pos)} x=${x.toFixed(2)} t=${Math.round(t)} ` +
            `earliest=${Math.round(earliest)} deadline=${Math.round(deadline)} furthest=${furthest}`,
        );
        for (let r = pos.row - 1; r <= pos.row + 2; r += 1) {
          const info = rowInfo(seed, r);
          if (info.kind === 'safe') console.error(`  [debug] row ${r}: safe`);
          else {
            const h = info.hazard;
            console.error(
              `  [debug] row ${r}: ${info.kind} dir=${h.dir} v=${(h.velTilesPerMs * 1000).toFixed(2)} len=${h.len} spacing=${h.spacing} phase=${h.phase.toFixed(2)}`,
            );
          }
        }
      }
      return { events, furthest, score, died: 'forced-death', endT: t };
    }
    if (!hop(plan.dir, plan.at)) {
      return { events, furthest, score, died: 'plan-hop-rejected', endT: t };
    }
  }

  return { events, furthest, score, died: null, endT: t };
};

{
  let forced = 0;
  let minForcedRow = Number.POSITIVE_INFINITY;
  let parityFails = 0;
  let minFurthest = Number.POSITIVE_INFINITY;
  for (let s = 0; s < (DEBUG_SEED !== null ? 1 : SEEDS); s += 1) {
    const seed = DEBUG_SEED !== null ? DEBUG_SEED : (s * 2654435761 + 12345) >>> 0;
    const bot = runBot(seed);
    if (bot.died) {
      forced += 1;
      minForcedRow = Math.min(minForcedRow, bot.furthest);
      if (forced <= 20) {
        console.error(`  forced death seed=${seed} at furthest=${bot.furthest} (${bot.died})`);
      }
      continue;
    }
    minFurthest = Math.min(minFurthest, bot.furthest);

    // Replay parity: the recorded log must replay to the exact same numbers.
    const replay = replayBoardwalkRun(bot.events, bot.endT + 500, seed);
    if (
      replay.rejected ||
      replay.furthest !== bot.furthest ||
      replay.score !== bot.score ||
      replay.ending !== 'events-ended'
    ) {
      parityFails += 1;
      if (parityFails <= 5) {
        console.error(
          `  PARITY FAIL seed=${seed}: replay(furthest=${replay.furthest}, score=${replay.score}, ` +
            `ending=${replay.ending}, rejected=${replay.rejected} reason=${replay.reason}) ` +
            `vs bot(furthest=${bot.furthest}, score=${bot.score})`,
        );
      }
    }
  }
  // Fairness bar: NO forced death in the depth range real players live in
  // (below row 60), and at most a 0.75% tail of unwinnable deep-game states
  // out to row 120 (the difficulty ramp is what terminates marathon runs).
  assert(
    minForcedRow >= 60,
    `forced death below row 60 (earliest at row ${minForcedRow})`,
  );
  assert(
    forced <= SEEDS * 0.0075,
    `forced-death tail too fat (${forced}/${SEEDS} > 0.75%)`,
  );
  assert(parityFails === 0, `${parityFails}/${SEEDS} seeds failed replay parity`);
  if (failures === 0) {
    console.log(
      `   ok (${SEEDS - forced}/${SEEDS} seeds reached row ${TARGET_ROW}; ` +
        `${forced} deep-tail corners, none before row ${Number.isFinite(minForcedRow) ? minForcedRow : '-'}; parity exact)`,
    );
  }
}

// ── 4. Tamper detection ─────────────────────────────────────────────────────
console.log('4. Tamper detection…');
{
  const seed = 424242;

  // Cadence violation → rejected.
  const fast: BoardwalkHopEvent[] = [
    { dir: 'U', t: 200 },
    { dir: 'U', t: 240 },
  ];
  assert(replayBoardwalkRun(fast, 10_000, seed).rejected, 'sub-cadence hops not rejected');

  // Cadence BOUNDARY: the honest client can never record a gap below
  // HOP_COOLDOWN_MS, so anything meaningfully under it must reject (a wide
  // grace would let forged logs out-hop every real client), while exactly
  // HOP_COOLDOWN_MS must pass.
  const almostFloor: BoardwalkHopEvent[] = [
    { dir: 'U', t: 200 },
    { dir: 'U', t: 200 + HOP_COOLDOWN_MS - 10 },
  ];
  assert(
    replayBoardwalkRun(almostFloor, 10_000, seed).rejected,
    `gap of cooldown-10ms not rejected (grace too wide)`,
  );
  const atFloor: BoardwalkHopEvent[] = [
    { dir: 'U', t: 200 },
    { dir: 'U', t: 200 + HOP_COOLDOWN_MS },
  ];
  assert(
    !replayBoardwalkRun(atFloor, 10_000, seed).rejected,
    'gap of exactly the cooldown was false-rejected',
  );

  // Off-grid walk → rejected.
  const offgrid: BoardwalkHopEvent[] = [];
  for (let i = 0; i < COLS; i += 1) offgrid.push({ dir: 'R', t: 200 + i * 200 });
  assert(replayBoardwalkRun(offgrid, 10_000, seed).rejected, 'off-grid hop not rejected');

  // Idling past the gull window → gull ending, no extra score.
  const idle: BoardwalkHopEvent[] = [
    { dir: 'U', t: 200 },
    { dir: 'U', t: 200 + idleLimitMs(1) + IDLE_GRACE_MS + 1_000 },
  ];
  const idleRes = replayBoardwalkRun(idle, 60_000, seed);
  assert(!idleRes.rejected && idleRes.ending === 'gull', `gull idle not enforced (${idleRes.ending})`);
  assert(idleRes.furthest === 1, `gull idle furthest wrong (${idleRes.furthest})`);

  // Blind march up the center at max cadence: must die at the FIRST hazard
  // row it mishandles (drown or collision), never sail through. Find a seed
  // where the first hazard row is a flume, march into it while the landing x
  // is open water, and assert a drown.
  let drownChecked = false;
  for (let s = 0; s < 400 && !drownChecked; s += 1) {
    const trySeed = (s * 977 + 7) >>> 0;
    // Rows 0..4 are safe (warmup + band rest); row 5 is the first hazard row.
    const info = rowInfo(trySeed, 5);
    if (info.kind !== 'flume') continue;
    // March to row 4 (safe), then hop U at a moment when the landing x is
    // open water.
    const events: BoardwalkHopEvent[] = [];
    let t = 200;
    for (let i = 0; i < 4; i += 1) {
      events.push({ dir: 'U', t });
      t += HOP_COOLDOWN_MS + 60;
    }
    const pos: PlayerPos = { mode: 'ground', row: 4, col: START_COL };
    // Stay inside the idle window so the gull doesn't end the run first.
    for (let tc = t; tc < t + 4_200; tc += 20) {
      const out = stepHop(trySeed, pos, 'U', tc);
      if (out.ok && out.died === 'drown') {
        events.push({ dir: 'U', t: tc });
        const res = replayBoardwalkRun(events, 60_000, trySeed);
        assert(!res.rejected && res.ending === 'drown', `water landing not a drown (${res.ending})`);
        assert(res.furthest === 4, `drown furthest wrong (${res.furthest})`);
        drownChecked = true;
        break;
      }
    }
  }
  assert(drownChecked, 'never found a drown scenario to check');

  // Same idea for a road: hop into a cart → collision.
  let collisionChecked = false;
  for (let s = 0; s < 400 && !collisionChecked; s += 1) {
    const trySeed = (s * 977 + 7) >>> 0;
    const info = rowInfo(trySeed, 5);
    if (info.kind !== 'road') continue;
    const events: BoardwalkHopEvent[] = [];
    let t = 200;
    for (let i = 0; i < 4; i += 1) {
      events.push({ dir: 'U', t });
      t += HOP_COOLDOWN_MS + 60;
    }
    const pos: PlayerPos = { mode: 'ground', row: 4, col: START_COL };
    // Stay inside the idle window so the gull doesn't end the run first.
    for (let tc = t; tc < t + 4_200; tc += 20) {
      const out = stepHop(trySeed, pos, 'U', tc);
      if (out.ok && out.died === 'collision') {
        events.push({ dir: 'U', t: tc });
        const res = replayBoardwalkRun(events, 60_000, trySeed);
        assert(!res.rejected && res.ending === 'collision', `cart landing not a collision (${res.ending})`);
        collisionChecked = true;
        break;
      }
    }
  }
  assert(collisionChecked, 'never found a collision scenario to check');

  // Riding drift: land on a log and idle on it forever → swept (carried off)
  // or gull, whichever the geometry produces first — but NEVER extra rows.
  let sweptChecked = false;
  for (let s = 0; s < 2_000 && !sweptChecked; s += 1) {
    const trySeed = (s * 977 + 7) >>> 0;
    if (rowInfo(trySeed, 5).kind !== 'flume') continue;
    const events: BoardwalkHopEvent[] = [];
    let t = 200;
    for (let i = 0; i < 4; i += 1) {
      events.push({ dir: 'U', t });
      t += HOP_COOLDOWN_MS + 60;
    }
    let pos: PlayerPos = { mode: 'ground', row: 4, col: START_COL };
    // Stay inside the idle window so the gull doesn't end the run first.
    for (let tc = t; tc < t + 4_200; tc += 20) {
      const out = stepHop(trySeed, pos, 'U', tc);
      if (out.ok && !out.died && out.pos.mode === 'riding') {
        events.push({ dir: 'U', t: tc });
        pos = out.pos;
        // Sit on the log; hop in place (D at row 6 goes to row 5... instead
        // record a final sideways hop far in the future so the dwell interval
        // is examined). The dwell must kill (swept) before that hop applies —
        // unless the gull deadline lands first; both cap the score at row 6.
        const sweep = dwellDeath(trySeed, pos, tc, tc + 60_000);
        if (!sweep) break; // log never leaves? impossible, but skip
        events.push({ dir: 'L', t: tc + 30_000 });
        const res = replayBoardwalkRun(events, 120_000, trySeed);
        assert(
          !res.rejected && (res.ending === 'swept' || res.ending === 'gull'),
          `riding forever not fatal (${res.ending})`,
        );
        assert(res.furthest === 5, `swept furthest wrong (${res.furthest})`);
        sweptChecked = true;
        break;
      }
    }
  }
  assert(sweptChecked, 'never found a swept scenario to check');
  console.log('   ok');
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll Boardwalk Hop replay proofs passed.');
