/**
 * Coin pusher tuning harness. Not a gate; the gate is verify-coin-pusher-rtp.ts.
 *
 *   npx tsx scripts/coin-pusher-sim.ts [bed|flow|cost|all]
 *
 * bed:  builds the starting bed and reports where its coins sit.
 * flow: plays long sessions with a few strategies and reports how coins
 *       per drop come out, the stock, and the spread of a session's return.
 * cost: steps per millisecond, which is what the server pays per request.
 */
import {
  CP_A_FRONT,
  CP_B_FRONT,
  CP_E1,
  CP_E2,
  CP_PERIOD,
  cpAdvance,
  cpBuildBed,
  cpClone,
  cpPour,
  type CpEvent,
  type CpMachine,
} from '@/features/arcade/lib/coin-pusher/engine';

const mode = process.argv[2] ?? 'all';

function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function census(m: CpMachine) {
  const by = [0, 0, 0, 0, 0];
  const top = [0, 0, 0, 0, 0];
  for (const c of m.coins) {
    by[c.s] += 1;
    if (c.l === 1) top[c.s] += 1;
  }
  const edge = m.coins.filter((c) => c.s === 3 && c.z > CP_E2 - 1.2).length;
  return `A ${by[0]} (${top[0]} on top)  P1 ${by[1]} (${top[1]})  B ${by[2]} (${top[2]})  P2 ${by[3]} (${top[3]})  air ${by[4]}  total ${m.coins.length}  at the edge ${edge}`;
}

let bed: CpMachine | null = null;
function getBed() {
  if (!bed) {
    const t0 = performance.now();
    bed = cpBuildBed();
    console.log(`bed built in ${(performance.now() - t0).toFixed(0)} ms at step ${bed.step}`);
  }
  return bed;
}

if (mode === 'bed' || mode === 'all') {
  const b = getBed();
  console.log('bed:', census(b));
  console.log(`geometry: A front ${CP_A_FRONT}+, E1 ${CP_E1}, B front ${CP_B_FRONT}+, E2 ${CP_E2}`);
}

type Strategy = { name: string; pour: (r: () => number) => number; gap: (r: () => number) => number };
const strategies: Strategy[] = [
  { name: '1 coin, steady', pour: () => 1, gap: (r) => 40 + Math.floor(r() * 80) },
  { name: '1 coin, fast', pour: () => 1, gap: (r) => 8 + Math.floor(r() * 10) },
  { name: '5 coins', pour: () => 5, gap: (r) => 60 + Math.floor(r() * 120) },
  { name: '10 coins', pour: () => 10, gap: (r) => 120 + Math.floor(r() * 120) },
  { name: '50 coins', pour: () => 50, gap: (r) => 600 + Math.floor(r() * 300) },
];

if (mode === 'flow' || mode === 'all') {
  for (const st of strategies) {
    const r = rng(7 + st.name.length);
    const m = cpClone(getBed());
    const events: CpEvent[] = [];
    let dropped = 0;
    let won = 0;
    let minStock = Infinity;
    let maxStock = 0;
    const perDrop: number[] = [];
    const t0 = performance.now();
    let steps = 0;
    const DROPS = st.name.startsWith('50') ? 60 : 400;
    for (let d = 0; d < DROPS; d++) {
      const count = st.pour(r);
      const x = (r() * 2 - 1) * 7.5;
      cpPour(m, m.step + 1, x, count);
      dropped += count;
      events.length = 0;
      steps += cpAdvance(m, m.step + st.gap(r) + count * 5, events);
      const got = events.filter((e) => e.k === 'tray').length;
      won += got;
      perDrop.push(got);
      const stock = m.coins.length + m.pending.length;
      minStock = Math.min(minStock, stock);
      maxStock = Math.max(maxStock, stock);
    }
    events.length = 0;
    steps += cpAdvance(m, m.step + 3000, events);
    won += events.filter((e) => e.k === 'tray').length;
    const ms = performance.now() - t0;
    const zero = perDrop.filter((v) => v === 0).length / perDrop.length;
    const big = Math.max(...perDrop);
    console.log(
      `${st.name.padEnd(16)} dropped ${dropped} won ${won} flux ${(won / dropped).toFixed(3)} stock ${minStock}..${maxStock} ` +
        `zero-drop ${(zero * 100).toFixed(0)}% biggest ${big}  ${census(m)}  ${(steps / ms).toFixed(1)} steps/ms`,
    );
  }
}

if (mode === 'cost' || mode === 'all') {
  const m = cpClone(getBed());
  cpPour(m, m.step + 1, 0, 10);
  const t0 = performance.now();
  const n = cpAdvance(m, m.step + CP_PERIOD * 6);
  const ms = performance.now() - t0;
  console.log(`cost: ${n} steps with ${m.coins.length} coins in ${ms.toFixed(1)} ms (${(ms / n * 1000).toFixed(0)} us/step)`);
}
