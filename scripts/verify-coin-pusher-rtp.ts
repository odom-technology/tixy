/**
 * Coin pusher RTP and determinism gate.
 *
 *   npx tsx scripts/verify-coin-pusher-rtp.ts [--quick | --full]
 *
 * The default takes about a minute; --full plays four times as long (about
 * four minutes) and is what the pull request quotes; --quick is a smoke test.
 *
 * The return is exact by construction: a coin is 5 tickets, a coin in the
 * tray pays 5 × ARCADE_RTP with the hundredths carried, and the sides are
 * walls, so every coin dropped leaves through the tray in the end. What has
 * to be proved is the "in the end": that coins are conserved, that the
 * machine's stock stays bounded whatever a player does, and that the browser
 * and the server step the same machine. Layers, all of which must pass:
 *
 *   1. CONFIG      ARCADE_RTP is 0.97, a coin pays 485 hundredths, bets map
 *                  to coins exactly (fives from 5 to 250), and the engine's
 *                  tuning is pinned by a SHA-256, so a retune that moves the
 *                  machine fails here until the pin changes with it.
 *   2. PAY         cpPayCoins over any split of N coins into commits pays
 *                  exactly floor(485N / 100) and carries the rest.
 *   3. BED         bed.json is cpBuildBed()'s output, settled, at the
 *                  machine's working level.
 *   4. DETERMINISM the same inputs give the same hash; a machine saved and
 *                  read back mid-spill has the same future; a settled machine
 *                  jumped across time equals one stepped; and the browser's
 *                  runtime, advanced by frames at 30 to 144 Hz with stalls,
 *                  lands on exactly the server's machine.
 *   5. SESSIONS    long sessions under seven strategies (steady, fast,
 *                  pours of 5, 10 and 50 coins, a harvester that only drops
 *                  when coins hang over the lip, and a greedy searcher that
 *                  tries 24 aims and steps in the 3 s window and keeps the
 *                  one that spills most): coins are conserved at every
 *                  request, the stock stays inside its bounds, and the
 *                  realised return is 0.97 × (1 − stock change / staked).
 *   6. EXTRACTION  from a fresh machine, the most coins any strategy took out
 *                  beyond what it put in, over many runs: the most a new
 *                  player can win from the bed.
 *
 * Exits non-zero on any failed assertion.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  CP_A_FRONT,
  CP_AIM_MAX,
  CP_B_FRONT,
  CP_DROP_VZ,
  CP_DROP_Y,
  CP_DROP_Z,
  CP_E1,
  CP_E2,
  CP_G,
  CP_GRIP,
  CP_GRIP_SPEED,
  CP_HZ,
  CP_LAND_KEEP,
  CP_MAX_ACTIVE,
  CP_PERIOD,
  CP_POUR_GAP,
  CP_SLIDE,
  CP_SLOP,
  CP_STILL,
  CP_STROKE,
  CP_W,
  cpAdvance,
  cpBuildBed,
  cpClone,
  cpHash,
  cpParse,
  cpPour,
  type CpEvent,
  type CpMachine,
} from '@/features/arcade/lib/coin-pusher/engine';
import {
  CP_COIN_PAY_HUNDREDTHS,
  CP_COIN_TICKETS,
  CP_RTP,
  cpCoinsForBet,
  cpPayCoins,
} from '@/features/arcade/lib/coin-pusher/economy';
import { ARCADE_RTP } from '@/server/arcade/arcade-constants';
import { PusherRuntime } from '@/app/(games)/coin-pusher/_coin-pusher-runtime';

const QUICK = process.argv.includes('--quick');
const FULL = process.argv.includes('--full');
/** Session length by mode: quick, default, full. */
const size = (quick: number, normal: number, full: number) => (QUICK ? quick : FULL ? full : normal);
const failures: string[] = [];
function assert(cond: boolean, msg: string) {
  if (!cond) failures.push(msg);
}
const pct = (v: number, d = 3) => `${(v * 100).toFixed(d)}%`;

function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const trays = (events: CpEvent[]) => events.reduce((n, e) => n + (e.k === 'tray' ? 1 : 0), 0);

console.log('Coin pusher RTP and determinism');
console.log(`  configured RTP: ${pct(CP_RTP, 1)} (ARCADE_RTP['arcade-coin-pusher'])`);
console.log(`  a coin: ${CP_COIN_TICKETS} tickets, pays ${CP_COIN_PAY_HUNDREDTHS / 100} in the tray`);
console.log('');

/* ══ 1. Config ═════════════════════════════════════════════════════════ */

assert(ARCADE_RTP['arcade-coin-pusher'] === 0.97, `ARCADE_RTP is ${ARCADE_RTP['arcade-coin-pusher']}`);
assert(CP_RTP === ARCADE_RTP['arcade-coin-pusher'], 'economy reads a different RTP');
assert(CP_COIN_PAY_HUNDREDTHS === 485, `a coin pays ${CP_COIN_PAY_HUNDREDTHS} hundredths`);
for (let bet = -5; bet <= 260; bet++) {
  const coins = cpCoinsForBet(bet);
  const ok = bet >= 5 && bet <= 250 && bet % 5 === 0;
  assert(ok ? coins === bet / 5 : coins === null, `bet ${bet} maps to ${coins}`);
}
for (const bad of [7.5, '25', NaN, Infinity, null, undefined, {}]) assert(cpCoinsForBet(bad) === null, `bet ${String(bad)} accepted`);

/** The tuning that decides where coins go. A change here must come with a
    new pin and a fresh run of this file. */
const TUNING = {
  CP_HZ, CP_PERIOD, CP_W, CP_STROKE, CP_A_FRONT, CP_E1, CP_B_FRONT, CP_E2, CP_DROP_Y, CP_DROP_Z, CP_DROP_VZ, CP_G,
  CP_SLIDE, CP_SLOP, CP_STILL, CP_GRIP_SPEED, CP_GRIP, CP_LAND_KEEP, CP_POUR_GAP, CP_MAX_ACTIVE, CP_COIN_TICKETS, CP_COIN_PAY_HUNDREDTHS,
};
const PINNED_TUNING_SHA256: string = '95bec919f308356f27777d21e92fe7985c3177bdadcee8ca60e643105be1ae0c';
const tuningHash = createHash('sha256').update(JSON.stringify(TUNING)).digest('hex');
if (PINNED_TUNING_SHA256 === '__PIN__') console.log(`Tuning sha256 (unpinned): ${tuningHash}`);
else {
  assert(tuningHash === PINNED_TUNING_SHA256, `the engine tuning changed (sha256 ${tuningHash}); re-run and re-pin`);
  console.log(`Tuning sha256: ${tuningHash} (pinned)`);
}

/* ══ 2. Pay ════════════════════════════════════════════════════════════ */

{
  const r = rng(11);
  for (let trial = 0; trial < 2000; trial++) {
    let carry = 0;
    let paid = 0;
    let coins = 0;
    const commits = 1 + Math.floor(r() * 40);
    for (let c = 0; c < commits; c++) {
      const n = Math.floor(r() * 8);
      const p = cpPayCoins(n, carry);
      assert(p.carry >= 0 && p.carry < 100 && Number.isInteger(p.tickets), 'pay out of range');
      paid += p.tickets;
      carry = p.carry;
      coins += n;
    }
    assert(paid === Math.floor((coins * 485) / 100) && carry === (coins * 485) % 100, `split pay drifted: ${coins} coins paid ${paid}`);
  }
  console.log('Pay: every split of coins into commits pays floor(4.85 × coins), the rest carried');
}

/* ══ 3. Bed ════════════════════════════════════════════════════════════ */

const bedFile = JSON.parse(readFileSync(path.join(process.cwd(), 'src/features/arcade/lib/coin-pusher/bed.json'), 'utf8'));
const bed = cpParse(bedFile);
assert(bed !== null, 'bed.json does not parse');
const rebuilt = cpBuildBed();
assert(bed !== null && cpHash(bed) === cpHash(rebuilt), 'bed.json is not cpBuildBed()\'s output; run scripts/build-coin-pusher-bed.ts');
assert(!!bed && bed.settled && bed.pending.length === 0, 'the bed is not settled');
console.log(`Bed: ${bed?.coins.length} coins, settled, hash ${bed ? cpHash(bed) : '?'}`);

/* ══ 4. Determinism ════════════════════════════════════════════════════ */

if (bed) {
  // Same inputs, same machine.
  const play = (m: CpMachine, seed: number, drops: number) => {
    const r = rng(seed);
    for (let d = 0; d < drops; d++) {
      cpPour(m, m.step + 1, (r() * 2 - 1) * CP_AIM_MAX, 1 + Math.floor(r() * 4));
      cpAdvance(m, m.step + 10 + Math.floor(r() * 50));
    }
    return m;
  };
  const a = play(cpClone(bed), 5, 60);
  const b = play(cpClone(bed), 5, 60);
  assert(cpHash(a) === cpHash(b), 'the same drops gave two machines');

  // Saved and read back mid-spill: the same future.
  const live = cpClone(bed);
  cpPour(live, live.step + 1, 2, 10);
  cpAdvance(live, live.step + 40);
  const saved = cpParse(JSON.parse(JSON.stringify(live)))!;
  cpAdvance(live, live.step + 900);
  cpAdvance(saved, saved.step + 900);
  assert(cpHash(live) === cpHash(saved), 'a machine read back from JSON has a different future');

  // A settled machine jumped across time equals one stepped.
  const settled = cpClone(live);
  cpAdvance(settled, settled.step + CP_MAX_ACTIVE + 10);
  assert(settled.settled, 'the machine never settled');
  const jumped = cpClone(settled);
  const stepped = cpClone(settled);
  cpAdvance(jumped, jumped.step + 5000);
  for (let i = 0; i < 5000; i++) cpAdvance(stepped, stepped.step + 1);
  assert(cpHash(jumped) === cpHash(stepped), 'a settled machine jumped differs from one stepped');

  // The browser's runtime, advanced by frames at 30 to 144 Hz with stalls
  // (its catch-up is capped per frame), lands on exactly the machine the
  // server steps straight through with the same pours.
  const start = cpClone(bed);
  const wanted = [3, 40, 41, 90, 200, 201, 202, 380].map((k) => start.step + k);
  for (const hz of [30, 60, 90, 120, 144]) {
    const rt = new PusherRuntime(cpClone(start), 0);
    const r = rng(hz);
    let frameMs = 0;
    // Pin the runtime's clock to a virtual one: frame 0 is the step after the bed.
    (rt as unknown as { wallBase: number }).wallBase = 0;
    rt.offsetMs = Date.UTC(2026, 0, 1) + (start.step + 1) * (1000 / CP_HZ);
    const queue = [...wanted];
    const used: number[] = [];
    let stalls = 0;
    while (rt.m.step < start.step + 1200) {
      const stall = r() < 0.04 ? r() * 250 : 0;
      if (stall > 0) stalls += 1;
      frameMs += 1000 / hz + stall;
      rt.advance(frameMs, 1000 / hz);
      while (queue.length > 0 && rt.m.step + 1 >= queue[0]) {
        queue.shift();
        used.push(rt.pour(1.25, 3));
      }
    }
    const ref = cpClone(start);
    for (const at of used) {
      cpAdvance(ref, at - 1);
      cpPour(ref, at, 1.25, 3);
    }
    cpAdvance(ref, rt.m.step);
    assert(cpHash(rt.m) === cpHash(ref), `${hz} Hz with ${stalls} stalls: the browser's machine differs from the server's`);
  }
  console.log('Determinism: same inputs, saved mid-spill, settled jump, and frames at 30, 60, 90, 120 and 144 Hz with stalls all match');
}

/* ══ 5. Sessions ═══════════════════════════════════════════════════════ */

type Strategy = {
  name: string;
  /** Coins and aim for the next drop, and steps to wait after it. Null skips a drop. */
  next: (m: CpMachine, r: () => number) => { coins: number; x: number; wait: number; at?: number } | null;
};

function edgeCount(m: CpMachine) {
  return m.coins.filter((c) => c.s === 3 && c.l === 0 && c.z > CP_E2 - 0.6).length;
}

/** Try candidate drops in the 3 s window and keep the one that spills most
    in the next 3 s. What a bot with the engine could do. */
function greedy(m: CpMachine, r: () => number) {
  let best = { coins: 1, x: 0, wait: 30, at: m.step + 1, score: -1 };
  for (let k = 0; k < 24; k++) {
    const x = (r() * 2 - 1) * CP_AIM_MAX;
    const at = m.step + 1 + Math.floor(r() * 180);
    const trial = cpClone(m);
    const ev: CpEvent[] = [];
    cpAdvance(trial, at - 1);
    cpPour(trial, at, x, 1);
    cpAdvance(trial, at + 180, ev);
    const score = trays(ev);
    if (score > best.score) best = { coins: 1, x, wait: 20, at, score };
  }
  return best;
}

const strategies: Strategy[] = [
  { name: 'steady, 1 coin', next: (_m, r) => ({ coins: 1, x: (r() * 2 - 1) * CP_AIM_MAX, wait: 40 + Math.floor(r() * 80) }) },
  { name: 'fast, 1 coin', next: (_m, r) => ({ coins: 1, x: (r() * 2 - 1) * CP_AIM_MAX, wait: 6 + Math.floor(r() * 8) }) },
  { name: 'pours of 5', next: (_m, r) => ({ coins: 5, x: (r() * 2 - 1) * CP_AIM_MAX, wait: 60 + Math.floor(r() * 90) }) },
  { name: 'pours of 10', next: (_m, r) => ({ coins: 10, x: (r() * 2 - 1) * CP_AIM_MAX, wait: 100 + Math.floor(r() * 100) }) },
  { name: 'pours of 50', next: (_m, r) => ({ coins: 50, x: (r() * 2 - 1) * CP_AIM_MAX, wait: 500 + Math.floor(r() * 200) }) },
  {
    name: 'harvester',
    // Drops only while coins hang over the lip; otherwise waits.
    next: (m, r) => (edgeCount(m) >= 3 || r() < 0.15 ? { coins: 1, x: (r() * 2 - 1) * CP_AIM_MAX, wait: 25 } : null),
  },
  { name: 'greedy searcher', next: (m, r) => greedy(m, r) },
];

type Outcome = { dropped: number; won: number; minStock: number; maxStock: number; staked: number; paid: number; conserved: boolean };

function session(strategy: Strategy, seed: number, drops: number, from: CpMachine): Outcome {
  const r = rng(seed);
  const m = cpClone(from);
  const start = m.coins.length;
  let dropped = 0;
  let won = 0;
  let carry = 0;
  let paid = 0;
  let minStock = Infinity;
  let maxStock = 0;
  let conserved = true;
  let made = 0;
  let idle = 0;
  while (made < drops && idle < drops * 4) {
    const plan = strategy.next(m, r);
    const ev: CpEvent[] = [];
    if (!plan) {
      cpAdvance(m, m.step + 30, ev);
      idle += 1;
    } else {
      const at = Math.max(m.step + 1, plan.at ?? m.step + 1);
      cpAdvance(m, at - 1, ev);
      cpPour(m, at, plan.x, plan.coins);
      dropped += plan.coins;
      made += 1;
      cpAdvance(m, at + plan.wait + plan.coins * CP_POUR_GAP, ev);
    }
    const w = trays(ev);
    won += w;
    const p = cpPayCoins(w, carry);
    paid += p.tickets;
    carry = p.carry;
    const stock = m.coins.length + m.pending.length;
    if (start + dropped - won !== stock) conserved = false;
    minStock = Math.min(minStock, stock);
    maxStock = Math.max(maxStock, stock);
  }
  // Let the last spill finish.
  const ev: CpEvent[] = [];
  cpAdvance(m, m.step + CP_MAX_ACTIVE + 10, ev);
  const w = trays(ev);
  won += w;
  const p = cpPayCoins(w, carry);
  paid += p.tickets;
  const stock = m.coins.length;
  if (start + dropped - won !== stock) conserved = false;
  return { dropped, won, minStock: Math.min(minStock, stock), maxStock: Math.max(maxStock, stock), staked: dropped * CP_COIN_TICKETS, paid, conserved };
}

/** The machine never holds more or fewer than this, whatever a player does. */
const STOCK_FLOOR = 100;
const STOCK_CEILING = 175;

if (bed) {
  console.log('');
  console.log('Sessions (realised return, and what it would be if the stock ended where it started):');
  console.log('  strategy           drops  coins in  coins out  stock      staked    paid  return   at even stock');
  for (const st of strategies) {
    const drops =
      st.name === 'greedy searcher' ? size(30, 50, 150) : st.name.includes('50') ? size(15, 30, 60) : size(120, 350, 700);
    const t0 = performance.now();
    const o = session(st, 1000 + st.name.length, drops, bed);
    const ret = o.paid / o.staked;
    // Coins left in (or taken from) the machine are the only gap from 97%:
    // value the stock change at a coin's pay and the return is 97%.
    const stockChange = bed.coins.length + o.dropped - o.won - bed.coins.length;
    const evenStock = (o.paid + CP_RTP * CP_COIN_TICKETS * stockChange) / o.staked;
    console.log(
      `  ${st.name.padEnd(17)} ${String(drops).padStart(6)} ${String(o.dropped).padStart(9)} ${String(o.won).padStart(10)}  ${o.minStock}..${o.maxStock}`.padEnd(70) +
        `${String(o.staked).padStart(7)} ${String(o.paid).padStart(7)}  ${pct(ret, 2).padStart(7)}  ${pct(evenStock, 2).padStart(7)}  (${((performance.now() - t0) / 1000).toFixed(1)} s)`,
    );
    assert(o.conserved, `${st.name}: a coin was lost or made`);
    assert(o.minStock >= STOCK_FLOOR && o.maxStock <= STOCK_CEILING, `${st.name}: stock ${o.minStock}..${o.maxStock} left ${STOCK_FLOOR}..${STOCK_CEILING}`);
    // The return differs from 97% only by the stock change, which is bounded.
    const bound = (CP_RTP * CP_COIN_TICKETS * Math.max(bed.coins.length - STOCK_FLOOR, STOCK_CEILING - bed.coins.length)) / o.staked + 0.01 / o.staked;
    assert(Math.abs(ret - CP_RTP) <= bound + 1e-9, `${st.name}: return ${pct(ret)} is further from 97% than the stock allows`);
    assert(Math.abs(evenStock - CP_RTP) <= 1 / o.staked + 1e-9, `${st.name}: return at even stock is ${pct(evenStock)}`);
  }
}

/* ══ 6. Extraction ═════════════════════════════════════════════════════ */

if (bed) {
  const runs = size(30, 80, 160);
  const takes: number[] = [];
  const r = rng(77);
  for (let run = 0; run < runs; run++) {
    const st = strategies[run % (strategies.length - 1)]; // the searcher has its own line below
    const m = cpClone(bed);
    let dropped = 0;
    let won = 0;
    let best = 0;
    const rr = rng(5000 + run);
    for (let d = 0; d < 60; d++) {
      const plan = st.next(m, rr) ?? { coins: 1, x: (r() * 2 - 1) * CP_AIM_MAX, wait: 30 };
      const ev: CpEvent[] = [];
      cpPour(m, m.step + 1, plan.x, plan.coins);
      dropped += plan.coins;
      cpAdvance(m, m.step + plan.wait + plan.coins * CP_POUR_GAP, ev);
      won += trays(ev);
      best = Math.max(best, won - dropped);
    }
    takes.push(best);
  }
  const g = session(strategies[strategies.length - 1], 9, size(20, 40, 60), bed);
  takes.sort((a, b) => a - b);
  const q = (p: number) => takes[Math.min(takes.length - 1, Math.floor(takes.length * p))];
  const worst = Math.max(takes[takes.length - 1], g.won - g.dropped);
  console.log('');
  console.log(
    `Extraction from a fresh machine (coins out beyond coins in, best moment of 60 drops, ${runs} runs): ` +
      `p50 ${q(0.5)}, p90 ${q(0.9)}, max ${takes[takes.length - 1]}; greedy searcher ${g.won - g.dropped} at the end`,
  );
  console.log(`  at most ${worst} coins, ${((worst * CP_COIN_PAY_HUNDREDTHS) / 100).toFixed(0)} tickets above what a new player puts in, once per account`);
  assert(worst <= bed.coins.length - STOCK_FLOOR, `a fresh machine gave up ${worst} coins`);
}

console.log('');
if (failures.length > 0) {
  console.log(`FAIL (${failures.length})`);
  for (const f of failures.slice(0, 30)) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('PASS');
