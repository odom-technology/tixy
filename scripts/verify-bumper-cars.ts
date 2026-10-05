/* Bumper cars verifier. Fast, no database, no network:

   1. The engine is deterministic: the same round twice is the same round.
   2. A snapshot is exact: a world loaded from the wire and given the same
      inputs lands on the server's numbers, tick for tick. This is what lets
      the page's replay agree with the server.
   3. Practice runs the same at 30 to 144 Hz with frame stalls.
   4. The scoring rules: a nudge doesn't score, a hit does, a big hit scores
      two, head on both score, the pair cooldown, nothing with the power off,
      and the cap on scoring off one car.
   5. The reward table, inside the 75 cap, and nothing for no bumps.
   6. Tampered socket messages are refused; a flood is struck out and logged;
      inputs far ahead of the server are refused.
   7. A round settles once however many times settling is asked for.

     npx tsx scripts/verify-bumper-cars.ts                                  */

import assert from 'node:assert/strict';

import { BOT_SKILLS, botInput, createBot } from '../src/features/arcade/lib/bumper-cars/bots';
import {
  BIG_BUMP_SPEED,
  BUMP_MIN_SPEED,
  COUNTDOWN_TICKS,
  MAX_CARS,
  MAX_SCORES_PER_VICTIM,
  PAIR_COOLDOWN_TICKS,
  ROUND_TICKS,
  TICK_HZ,
} from '../src/features/arcade/lib/bumper-cars/constants';
import { parseClientMessage } from '../src/features/arcade/lib/bumper-cars/protocol';
import { bumperCarsTickets, roundScore, BUMPER_REWARD_CAP } from '../src/features/arcade/lib/bumper-cars/rules';
import { PracticeRound } from '../src/features/arcade/lib/bumper-cars/runtime';
import { createSim, packCar, setInputs, simHash, stepSim, unpackCarInto, type SimEvent, type SimState } from '../src/features/arcade/lib/bumper-cars/sim';
import {
  bumperStore,
  debugAdvance,
  getRoom,
  issueTicket,
  quickPlay,
  settleRoom,
  standingsFor,
  type SettleRequest,
} from '../src/server/arcade/bumper-cars/rooms';
import { createBumperSession } from '../src/server/arcade/bumper-cars/ws';

const ok = (msg: string) => console.log(`ok  ${msg}`);

function botRound(seed: number, until = COUNTDOWN_TICKS + ROUND_TICKS, onTick?: (sim: SimState, inputs: Array<{ steer: number; throttle: number }>) => void): SimState {
  const sim = createSim();
  const bots = Array.from({ length: MAX_CARS }, (_, i) => createBot(i, seed, BOT_SKILLS[(['easy', 'medium', 'hard'] as const)[i % 3]]));
  while (sim.tick < until) {
    sim.powered = sim.tick >= COUNTDOWN_TICKS && sim.tick < COUNTDOWN_TICKS + ROUND_TICKS;
    const inputs = bots.map((b) => botInput(b, sim));
    onTick?.(sim, inputs);
    setInputs(sim, inputs);
    stepSim(sim);
  }
  return sim;
}

// ── 1. Determinism ──
{
  for (const seed of [1, 7, 42, 99]) {
    const a = botRound(seed);
    const b = botRound(seed);
    assert.equal(simHash(a), simHash(b), `seed ${seed}: two runs differ`);
    assert.deepEqual(a.points, b.points);
  }
  ok('the same round twice is the same round, 4 seeds, every car and point');
}

// ── 2. Snapshots are exact ──
{
  let checked = 0;
  for (const seed of [3, 11]) {
    const inputsByTick: Array<Array<{ steer: number; throttle: number }>> = [];
    const hashes: number[] = [];
    const wires: number[][][] = [];
    botRound(seed, COUNTDOWN_TICKS + 40 * TICK_HZ, (sim, inputs) => {
      inputsByTick[sim.tick] = inputs.map((x) => ({ ...x }));
      hashes[sim.tick] = simHash(sim);
      wires[sim.tick] = sim.cars.map((c) => [...packCar(c), c.steer, c.throttle, c.slip]);
    });
    for (const from of [COUNTDOWN_TICKS + 60, COUNTDOWN_TICKS + 900, COUNTDOWN_TICKS + 1700]) {
      // Load the wire into a fresh world, as the page does.
      const sim = createSim();
      sim.tick = from;
      const wire = wires[from]!;
      sim.cars.forEach((car, i) => {
        unpackCarInto(car, wire[i]!);
        car.steer = wire[i]![7]!;
        car.throttle = wire[i]![8]!;
        car.slip = wire[i]![9]!;
      });
      for (let t = from; t < from + 300; t += 1) {
        sim.powered = t >= COUNTDOWN_TICKS && t < COUNTDOWN_TICKS + ROUND_TICKS;
        setInputs(sim, inputsByTick[t]!);
        stepSim(sim);
        // Points aren't on the wire; compare the cars.
        const cars = sim.cars.map((c) => packCar(c).join(',')).join('|');
        const want = wires[t + 1]!.map((w) => w.slice(0, 7).join(',')).join('|');
        assert.equal(cars, want, `seed ${seed}: replay from ${from} differs at tick ${t + 1}`);
        checked += 1;
      }
    }
  }
  ok(`a world loaded from the wire replays the server's world exactly (${checked} ticks from 6 snapshots)`);
}

// ── 3. Practice at any frame rate ──
{
  const run = (hz: number, stalls: boolean) => {
    const round = new PracticeRound({ seed: 77, myName: 'test', autopilot: true });
    // A long stall drops the time it lost rather than running a burst, so
    // run until the round is over, not for a fixed time.
    let now = 1000;
    let i = 0;
    while (!round.finished() && i < 100_000) {
      round.update(now);
      round.drainEvents();
      i += 1;
      now += 1000 / hz + (stalls && i % 97 === 0 ? 180 : 0);
    }
    return round.points().join(',');
  };
  const base = run(60, false);
  for (const hz of [30, 90, 120, 144]) assert.equal(run(hz, true), base, `practice at ${hz} Hz with stalls differs`);
  ok(`practice ends on the same scores at 30, 60, 90, 120 and 144 Hz with 180 ms stalls (${base})`);
}

// ── 4. Scoring rules ──
{
  // Car 0 at speed v into car 1 standing still, head to head along x.
  const ram = (v0: number, v1 = 0, powered = true) => {
    const sim = createSim([true, true, false, false, false, false, false, false]);
    sim.powered = powered;
    sim.tick = 1000;
    const [a, b] = sim.cars;
    Object.assign(a!, { x: -1.0, z: 0, vx: v0, vz: 0, fx: 1, fz: 0, w: 0, slip: 0 });
    Object.assign(b!, { x: 0.9, z: 0, vx: -v1, vz: 0, fx: -1, fz: 0, w: 0, slip: 0 });
    const events: SimEvent[] = [];
    for (let t = 0; t < 30; t += 1) stepSim(sim, events);
    return { sim, bump: events.find((e) => e.type === 'bump') as Extract<SimEvent, { type: 'bump' }> | undefined };
  };
  assert.equal(ram(BUMP_MIN_SPEED * 0.8).bump, undefined, 'a nudge scored');
  const one = ram(BUMP_MIN_SPEED + 0.6);
  assert.ok(one.bump && one.bump.pa === 1 && one.bump.pb === 0, 'a bump should score 1 for the car driving in');
  const big = ram(BIG_BUMP_SPEED + 0.5);
  assert.ok(big.bump && big.bump.pa === 2, 'a big bump should score 2');
  const head = ram(2.6, 2.6);
  assert.ok(head.bump && head.bump.pa > 0 && head.bump.pb > 0, 'head on, both should score');
  const off = ram(4.5, 0, false);
  assert.ok(off.bump && off.bump.pa === 0, 'a bump with the power off scored');

  // Cooldown and the cap: car 0 keeps ramming car 1.
  const sim = createSim([true, true, false, false, false, false, false, false]);
  sim.powered = true;
  sim.tick = 1000;
  let scored = 0;
  for (let k = 0; k < 40; k += 1) {
    const [a, b] = sim.cars;
    // Touching, closing at 3 m/s; half the tries come inside the cooldown.
    Object.assign(a!, { x: -0.92, z: 0, vx: 3, vz: 0, fx: 1, fz: 0, w: 0, slip: 0 });
    Object.assign(b!, { x: 0.92, z: 0, vx: 0, vz: 0, fx: -1, fz: 0, w: 0, slip: 0 });
    const events: SimEvent[] = [];
    stepSim(sim, events);
    scored += events.filter((e) => e.type === 'bump' && e.pa > 0).length;
    if (k % 2 === 1) sim.tick += PAIR_COOLDOWN_TICKS;
  }
  assert.equal(scored, MAX_SCORES_PER_VICTIM, `one car scored off another ${scored} times, cap is ${MAX_SCORES_PER_VICTIM}`);
  ok(`scoring: a nudge 0, a bump 1, a big bump 2, head on both, nothing with the power off, a ${PAIR_COOLDOWN_TICKS}-tick pair cooldown, ${MAX_SCORES_PER_VICTIM} off one car at most`);
}

// ── 5. Tickets ──
{
  const table = [0, 1, 5, 10, 15, 20, 30, 43, 50, 60, 70, 90, 120, 200].map((s) => [s, bumperCarsTickets(s)] as const);
  console.log('    score  tickets');
  for (const [s, t] of table) console.log(`    ${String(s).padStart(5)}  ${String(t).padStart(7)}`);
  assert.equal(bumperCarsTickets(0), 0, 'a round without a bump pays nothing');
  for (const [s, t] of table) assert.ok(t >= 0 && t <= BUMPER_REWARD_CAP, `score ${s} pays ${t}`);
  for (let s = 1; s < 200; s += 1) assert.ok(bumperCarsTickets(s + 1) >= bumperCarsTickets(s), 'tickets never fall with score');
  // Pinned so a change to the curve is a change to this file too.
  assert.deepEqual(table.map(([, t]) => t), [0, 1, 8, 16, 23, 30, 41, 52, 56, 61, 65, 70, 73, 75]);
  assert.equal(roundScore(30, 1, 8), 34, 'first place adds 4');
  assert.equal(roundScore(30, 4, 8), 30, 'fourth adds nothing');
  assert.equal(roundScore(0, 1, 8), 0, 'no podium for no points');
  ok('tickets: 75 × (1 − exp(−(s/37)^1.1)), 0 for no bumps, inside the 75 cap, never falling; podium adds 4, 2, 1');
}

// ── 6 and 7. The socket and the room ──
async function rooms() {
  const logged: string[] = [];
  let settles = 0;
  const store = bumperStore();
  store.persist = {
    start: async () => undefined,
    settle: async (req: SettleRequest) => {
      settles += 1;
      return { settled: true, rewards: new Map(req.players.map((p) => [p.userId, { tickets: 1, wanted: 1, balanceAfter: null, score: p.points }])) };
    },
    log: (_userId, reason) => logged.push(reason),
  };

  // Parsing.
  const bad = [
    '',
    'not json',
    '{"t":"in","k":-1,"d":[1,1]}',
    '{"t":"in","k":5,"d":[1]}',
    '{"t":"in","k":5,"d":[1.5,1]}',
    `{"t":"in","k":5,"d":[${new Array(40).fill(1).join(',')}]}`,
    '{"t":"hello","ticket":""}',
    '{"t":"teleport","x":1}',
    `{"t":"hello","ticket":"${'x'.repeat(600)}"}`,
  ];
  for (const raw of bad) assert.equal(parseClientMessage(raw), null, `accepted ${raw.slice(0, 40)}`);
  const clamped = parseClientMessage('{"t":"in","k":5,"d":[99,-99]}');
  assert.deepEqual(clamped, { t: 'in', k: 5, d: [16, -16] }, 'inputs are clamped to the wheel and the pedal');
  ok(`${bad.length} malformed or tampered messages refused; inputs clamped to ±16`);

  // A room with one player; drive the socket session by hand.
  const room = quickPlay('verify-user', 'verify');
  const sent: string[] = [];
  let closed = false;
  const session = createBumperSession({ send: (d) => sent.push(d), close: () => (closed = true) });
  session.onMessage(JSON.stringify({ t: 'hello', ticket: issueTicket('verify-user', 'verify', room.id) }), 40);
  assert.ok(sent.some((m) => m.includes('"t":"welcome"')), 'hello with a good ticket is welcomed');
  // A replayed ticket is refused.
  const other: string[] = [];
  const s2 = createBumperSession({ send: (d) => other.push(d), close: () => undefined });
  const ticket = issueTicket('verify-user', 'verify', room.id);
  s2.onMessage(JSON.stringify({ t: 'hello', ticket }), 40);
  const s3: string[] = [];
  createBumperSession({ send: (d) => s3.push(d), close: () => undefined }).onMessage(JSON.stringify({ t: 'hello', ticket }), 40);
  assert.ok(s3.some((m) => m.includes('closed')), 'a ticket works once');
  ok('a ticket works once; a hello without one is refused');

  // Start the round and send inputs from far ahead: refused and struck.
  const live = getRoom(room.id)!;
  // quickPlay keeps a public lobby open; start it now.
  const { startRound } = await import('../src/server/arcade/bumper-cars/rooms');
  startRound(live);
  // The newest socket for a seat replaces the old one, so drive a fresh one.
  let mainClosed = false;
  const main = createBumperSession({ send: () => undefined, close: () => (mainClosed = true) });
  main.onMessage(JSON.stringify({ t: 'hello', ticket: issueTicket('verify-user', 'verify', room.id) }), 40);
  assert.ok(closed, 'the older socket for the seat was replaced');
  for (let i = 0; i < 20; i += 1) main.onMessage(JSON.stringify({ t: 'in', k: 5000 + i, d: [16, 16] }), 40);
  assert.ok(mainClosed, 'twelve far-ahead inputs close the socket');
  assert.ok(logged.some((r) => /ahead/.test(r)), 'and are logged');
  ok('inputs more than 90 ticks ahead are refused; 12 strikes close the socket and log to anti_cheat_logs');

  // A flood from a fresh socket.
  logged.length = 0;
  let floodClosed = false;
  const flood = createBumperSession({ send: () => undefined, close: () => (floodClosed = true) });
  flood.onMessage(JSON.stringify({ t: 'hello', ticket: issueTicket('verify-user', 'verify', room.id) }), 40);
  for (let i = 0; i < 200; i += 1) flood.onMessage(JSON.stringify({ t: 'ping', c: i }), 20);
  assert.ok(floodClosed && logged.some((r) => /messages a second/.test(r)), 'a flood is struck out');
  ok('a socket over 70 messages a second is struck out and logged');

  // Settle once, however often it's asked.
  debugAdvance(live, COUNTDOWN_TICKS + ROUND_TICKS + 200);
  assert.equal(live.phase, 'over', 'the round ends at the horn');
  await new Promise((r) => setTimeout(r, 20));
  await settleRoom(live, live.sim!.tick);
  await settleRoom(live, live.sim!.tick);
  assert.equal(settles, 1, `settled ${settles} times`);
  assert.ok(standingsFor(live).length === MAX_CARS, 'eight cars on the board, bots included');
  ok('the round settles once at the horn; asking again does nothing');
}

await rooms();
session_cleanup();

function session_cleanup() {
  for (const room of bumperStore().rooms.values()) for (const s of room.seats) s.conn = null;
  console.log('\nbumper cars: all checks passed');
  process.exit(0);
}
