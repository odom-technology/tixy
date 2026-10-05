/**
 * Derby's verifier: the water race the server judges is the race every
 * phone draws, and nothing already decided ever changes.
 *
 *   npx tsx scripts/verify-derby-race.ts          (npm run test:derby)
 *   node scripts/run-with-env.mjs tsx scripts/verify-derby-race.ts --db   (also the settle, on env's database)
 *
 * 1. The target path: a pure function of the seed (the same bits twice, a
 *    golden hash), inside the field, readable (top speed bounded) and a
 *    little harder late in the race than early.
 * 2. Bots: the same samples every time (golden hash), legal input a phone
 *    could send, ordered by skill, and human (no bot trips the perfect-
 *    tracking flag).
 * 3. The replay: a race's result is the same whether the samples arrive in
 *    one batch or many, as your own provisional ticks first, or through a
 *    JSON round trip (what the server stores and phones receive).
 * 4. Finality: the server's keep rule never takes a tick it has called
 *    final, so once its clock has passed a result by the lag no batch it
 *    would still accept moves it.
 * 5. Impossible input is turned down: non-finite or fractional values, out
 *    of the field, a squirt that isn't 0 or 1, a teleporting aim, an
 *    oversized batch.
 * 6. The anti-cheat line: a script that sits on the bull is flagged; the
 *    sharpest bot is not.
 * 7. Tickets by place, inside the 75 cap.
 * 8. With --db: a race settles exactly once under five concurrent settles,
 *    pays one ledger row, turns a batch away after the finish, and logs a
 *    teleporting batch.
 */
import { createHash } from 'node:crypto';

import {
  DERBY_AIM_MAX_STEP,
  DERBY_AIM_SCALE,
  DERBY_BOT_SKILLS,
  DERBY_FIELD_X,
  DERBY_FIELD_Y,
  DERBY_LANES,
  DERBY_MAX_BATCH_TICKS,
  DERBY_MAX_LAG_MS,
  DERBY_MAX_TICKS,
  DERBY_SEAL_MARGIN_MS,
  DERBY_TARGET_R,
  DERBY_TICK_MS,
  DerbyRaceModel,
  derbyBotSamples,
  derbyCheckSamples,
  derbyKeepRange,
  derbySealTick,
  derbyTargetAt,
  derbyTargetPath,
  derbyTickets,
  derbyTracking,
  type DerbyResult,
} from '../src/features/arcade/lib/derby';

let failures = 0;
const check = (ok: boolean, label: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
};

let seed = 0x9e3779b9;
const rand = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const hash = (data: ArrayBufferView) => createHash('sha256').update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)).digest('hex').slice(0, 16);
const sameResult = (a: DerbyResult | null, b: DerbyResult | null) =>
  !!a && !!b && a.winner === b.winner && a.endT === b.endT && a.timedOut === b.timedOut && a.order.join() === b.order.join() && a.distance.every((d, i) => d === b.distance[i]);

// 1. The target path.
const GOLDEN_SEED = 0xdeb7_2026;
const pathA = derbyTargetPath(GOLDEN_SEED);
const pathB = derbyTargetPath(GOLDEN_SEED);
check(hash(pathA.ticks) === hash(pathB.ticks), 'the target path is the same twice from one seed');
const pathHash = hash(pathA.ticks);
check(pathHash === 'd610c2bb49cf950e', `the target path's golden hash holds (${pathHash})`);
let inside = true;
let readable = true;
let topSpeed = 0;
let early = 0;
let late = 0;
for (let r = 0; r < 200; r += 1) {
  const p = derbyTargetPath(Math.floor(rand() * 0xffffffff) >>> 0);
  for (let k = 1; k < DERBY_MAX_TICKS; k += 1) {
    const x = p.ticks[k * 2]!;
    const y = p.ticks[k * 2 + 1]!;
    if (Math.abs(x) + DERBY_TARGET_R > DERBY_FIELD_X || Math.abs(y) + DERBY_TARGET_R > DERBY_FIELD_Y) inside = false;
    const v = (Math.hypot(x - p.ticks[(k - 1) * 2]!, y - p.ticks[(k - 1) * 2 + 1]!) * 1000) / DERBY_TICK_MS;
    topSpeed = Math.max(topSpeed, v);
    if (k * DERBY_TICK_MS < 10_000) early += v;
    else if (k * DERBY_TICK_MS >= 25_000 && k * DERBY_TICK_MS < 35_000) late += v;
  }
}
// Two field widths a second is a fast hand; the path never asks more than this.
if (topSpeed > 2.2) readable = false;
check(inside, 'the whole target stays inside the field on 200 seeds');
check(readable, `the target never moves faster than a hand can follow (top ${topSpeed.toFixed(2)} field units a second)`);
check(late > early * 1.5, `it gets harder: mean speed ${(early / 400 / 200).toFixed(2)} in the first 10 s, ${(late / 400 / 200).toFixed(2)} from 25 to 35 s`);
const still = { x: 1, y: 1 };
derbyTargetAt(pathA, -2_000, still);
check(still.x === 0 && still.y === 0, 'the target sits in the middle for the countdown');

// 2. Bots.
const botA = derbyBotSamples(GOLDEN_SEED, 0, 2, pathA);
const botB = derbyBotSamples(GOLDEN_SEED, 0, 2, pathB);
check(hash(botA) === hash(botB), 'a bot makes the same samples twice');
const botHash = hash(botA);
check(botHash === 'cd1f95bf4b89d059', `the bot golden hash holds (${botHash})`);
let legal = true;
const meanBySkill = DERBY_BOT_SKILLS.map(() => 0);
const flaggedBySkill = DERBY_BOT_SKILLS.map(() => 0);
const RACES = 120;
for (let r = 0; r < RACES; r += 1) {
  const s = Math.floor(rand() * 0xffffffff) >>> 0;
  for (let skill = 0; skill < DERBY_BOT_SKILLS.length; skill += 1) {
    const model = new DerbyRaceModel(s, [{ lane: 3, kind: 'human' }]);
    const samples = derbyBotSamples(s ^ 0x1234, 3, skill, model.path);
    for (let k = 0; k < DERBY_MAX_TICKS; k += DERBY_MAX_BATCH_TICKS) {
      const n = Math.min(DERBY_MAX_BATCH_TICKS, DERBY_MAX_TICKS - k);
      const before = k > 0 ? ([samples[k * 3 - 3]!, samples[k * 3 - 2]!, samples[k * 3 - 1]!] as [number, number, number]) : null;
      if (!derbyCheckSamples(Array.from(samples.subarray(k * 3, (k + n) * 3)), before).ok) legal = false;
    }
    model.confirm(3, 0, 0, samples);
    meanBySkill[skill] += model.distance(3, 30_000) / RACES;
    const track = derbyTracking(model, 3, 1_400);
    if (track.onTarget >= 400 && track.meanOn < 0.1) flaggedBySkill[skill] += 1;
  }
}
check(legal, 'every bot sample is input a phone could send (in the field, no teleports)');
check(
  meanBySkill.every((m, i) => i === 0 || m > meanBySkill[i - 1]!),
  `bots are ordered by skill: lengths at 30 s ${meanBySkill.map((m) => m.toFixed(1)).join(' < ')}`,
);
check(flaggedBySkill.every((n) => n === 0), 'no bot trips the perfect-tracking flag');

// 3. The replay.
let replayOk = true;
let jsonOk = true;
let provisionalOk = true;
let raceCount = 0;
for (let r = 0; r < 40; r += 1) {
  const s = Math.floor(rand() * 0xffffffff) >>> 0;
  const humans = [3, 4, 2].slice(0, 1 + (r % 3));
  const lanes = humans.map((lane) => ({ lane, kind: 'human' as const }));
  const ref = new DerbyRaceModel(s, lanes);
  const bySample = humans.map((lane, i) => derbyBotSamples(s ^ (0xabc + i), lane, 1 + (i % 3), ref.path));
  humans.forEach((lane, i) => ref.confirm(lane, 0, 0, bySample[i]!));
  const want = ref.decided();
  // Many small batches, lanes interleaved, with dry gaps the server made.
  const many = new DerbyRaceModel(s, lanes);
  const json = new DerbyRaceModel(s, lanes);
  const prov = new DerbyRaceModel(s, lanes);
  const next = humans.map(() => 0);
  let open = true;
  while (open) {
    open = false;
    humans.forEach((lane, i) => {
      if (next[i]! >= DERBY_MAX_TICKS) return;
      open = true;
      const n = Math.min(DERBY_MAX_TICKS - next[i]!, 1 + Math.floor(rand() * 20));
      const flat = Array.from(bySample[i]!.subarray(next[i]! * 3, (next[i]! + n) * 3));
      prov.provisional(lane, next[i]!, flat);
      if (many.confirm(lane, next[i]!, next[i]!, flat) !== 'applied') replayOk = false;
      const wire = JSON.parse(JSON.stringify({ prev: next[i], from: next[i], samples: flat })) as { prev: number; from: number; samples: number[] };
      json.confirm(lane, wire.prev, wire.from, wire.samples);
      // Your own phone confirms what it predicted, a little later.
      prov.confirm(lane, next[i]!, next[i]!, flat);
      next[i] = next[i]! + n;
    });
  }
  if (!sameResult(want, many.decided())) replayOk = false;
  if (!sameResult(want, json.decided())) jsonOk = false;
  if (!sameResult(want, prov.decided())) provisionalOk = false;
  raceCount += 1;
}
check(replayOk, `${raceCount} races: the same result from one batch or many`);
check(jsonOk, `${raceCount} races: the same result to the last bit through JSON (the server's log and the pushes)`);
check(provisionalOk, `${raceCount} races: your own predicted ticks, confirmed later, land on the same result`);

// A batch out of order is held back, not folded in.
const orderModel = new DerbyRaceModel(1, [{ lane: 3, kind: 'human' }]);
check(orderModel.confirm(3, 40, 40, [0, 0, 1]) === 'gap' && orderModel.known[3] === 0, 'a batch after a missing one is a gap, not applied');
check(orderModel.confirm(3, 0, 0, [0, 0, 1]) === 'applied' && orderModel.confirm(3, 0, 0, [0, 0, 1]) === 'old', 'a batch already held is old');

// 4. Finality.
let keepOk = true;
for (let k = 0; k < 20_000; k += 1) {
  const now = rand() * 90_000;
  const later = now + rand() * 5_000;
  const sealed = derbySealTick(now);
  const from = Math.floor(rand() * DERBY_MAX_TICKS);
  const keep = derbyKeepRange(Math.floor(rand() * from), from, 1 + Math.floor(rand() * 100), later);
  if (keep && keep.keepFrom < sealed) keepOk = false;
  if (keep && keep.keepTo * DERBY_TICK_MS > later + 250 + DERBY_TICK_MS) keepOk = false;
}
check(keepOk, 'the server never keeps a tick it has called final, nor one ahead of its clock');
let finalOk = true;
let finalRaces = 0;
for (let r = 0; r < 40; r += 1) {
  const s = Math.floor(rand() * 0xffffffff) >>> 0;
  const lanes = [{ lane: 3, kind: 'human' as const }, { lane: 4, kind: 'human' as const }];
  const model = new DerbyRaceModel(s, lanes);
  const a = derbyBotSamples(s ^ 1, 3, 3, model.path);
  const b = derbyBotSamples(s ^ 2, 4, 3, model.path);
  // The server takes samples as the race runs, then settles.
  let next3 = 0;
  let next4 = 0;
  let result: DerbyResult | null = null;
  for (let now = 0; now < 95_000 && !result; now += 200) {
    for (const [lane, src] of [[3, a], [4, b]] as const) {
      const from = lane === 3 ? next3 : next4;
      const upTo = Math.min(DERBY_MAX_TICKS, Math.floor(now / DERBY_TICK_MS));
      const keep = derbyKeepRange(from, from, upTo - from, now);
      if (!keep) continue;
      model.confirm(lane, from, keep.keepFrom, Array.from(src.subarray(keep.keepFrom * 3, keep.keepTo * 3)));
      if (lane === 3) next3 = keep.keepTo;
      else next4 = keep.keepTo;
    }
    model.seal(derbySealTick(now));
    result = model.decided();
    if (result && now < result.endT) finalOk = false;
  }
  if (!result) {
    finalOk = false;
    continue;
  }
  // Anything the server would still take after the settle changes nothing.
  for (let k = 0; k < 10; k += 1) {
    const later = result.endT + DERBY_MAX_LAG_MS + DERBY_SEAL_MARGIN_MS + rand() * 3_000;
    const keep = derbyKeepRange(next3, next3, 200, later);
    if (!keep) continue;
    const copy = new DerbyRaceModel(s, lanes);
    copy.confirm(3, 0, 0, Array.from(a.subarray(0, next3 * 3)));
    copy.confirm(4, 0, 0, Array.from(b.subarray(0, next4 * 3)));
    // A bull's-eye stream for every tick it would keep.
    const flat: number[] = [];
    for (let t = keep.keepFrom; t < keep.keepTo; t += 1) {
      flat.push(Math.round(copy.path.ticks[t * 2]! * DERBY_AIM_SCALE), Math.round(copy.path.ticks[t * 2 + 1]! * DERBY_AIM_SCALE), 1);
    }
    copy.confirm(3, next3, keep.keepFrom, flat);
    copy.seal(derbySealTick(later));
    if (!sameResult(result, copy.decided())) finalOk = false;
  }
  finalRaces += 1;
}
check(finalOk, `${finalRaces} races: decided no sooner than the wire, and no batch the server takes after that moves the result`);

// 5. Impossible input.
const at = DERBY_AIM_SCALE;
const bad: Array<[string, unknown, string]> = [
  ['a non-finite value', [Number.NaN, 0, 1], 'malformed'],
  ['a fraction', [0.5, 0, 1], 'malformed'],
  ['a string', ['0', 0, 1], 'malformed'],
  ['outside the field', [Math.round(DERBY_FIELD_X * at) + 1, 0, 1], 'out_of_range'],
  ['a squirt of 2', [0, 0, 2], 'malformed'],
  ['a teleport while squirting', [-900, 0, 1, 900, 0, 1], 'teleport'],
  ['a ragged batch', [0, 0], 'malformed'],
  ['an empty batch', [], 'malformed'],
  ['an oversized batch', Array.from({ length: (DERBY_MAX_BATCH_TICKS + 1) * 3 }, () => 0), 'malformed'],
  ['not a list', 'aim', 'malformed'],
];
for (const [label, samples, reason] of bad) {
  const got = derbyCheckSamples(samples, null);
  const why = 'reason' in got ? got.reason : 'passed';
  check(why === reason, `turned down: ${label} (${why})`);
}
check(derbyCheckSamples([-900, 0, 0, 900, 0, 1], null).ok, 'a jump with the water off is allowed (a mouse re-entering the booth)');
check(!derbyCheckSamples([900, 0, 1], [-900, 0, 1]).ok, 'a jump from the last stored sample is caught across batches');
check(
  derbyCheckSamples([0, 0, 1, Math.round(DERBY_AIM_MAX_STEP * at * 0.98), 0, 1], null).ok,
  'the phone\'s own top speed passes',
);
const ahead = derbyKeepRange(0, 200, 10, 2_000);
check(ahead === null, 'ticks ahead of the server\'s clock are not taken');

// 6. The anti-cheat line.
{
  const s = 0x51ed;
  const model = new DerbyRaceModel(s, [{ lane: 3, kind: 'human' }]);
  const flat: number[] = [];
  for (let k = 0; k < DERBY_MAX_TICKS; k += 1) {
    flat.push(Math.round(model.path.ticks[k * 2]! * at), Math.round(model.path.ticks[k * 2 + 1]! * at), 1);
  }
  model.confirm(3, 0, 0, flat);
  const t = derbyTracking(model, 3, 1_300);
  check(t.onTarget >= 400 && t.meanOn < 0.1, `a script on the bull is flagged (mean ${t.meanOn.toFixed(3)} radii)`);
}

// 7. Tickets.
const table = Array.from({ length: DERBY_LANES }, (_, i) => derbyTickets(i + 1));
check(JSON.stringify(table) === JSON.stringify([65, 60, 54, 46, 36, 25, 13, 10]), `tickets by place ${table.join(', ')}`);
check(table.every((t) => t <= 75 && t >= 10), 'every place inside the 75 cap and over the 10 floor');
check(derbyTickets(0) === 65 && derbyTickets(99) === 10 && derbyTickets(Number.NaN) === 0, 'places out of range clamp; nonsense pays 0');

// 8. The settle, on a database.
if (process.argv.includes('--db')) {
  await verifySettle();
}

console.log(failures ? `\n${failures} failed` : '\nall derby checks passed');
process.exit(failures ? 1 : 0);

async function verifySettle() {
  const { query } = await import('../src/server/db/client');
  const service = await import('../src/server/arcade/derby-race/service');
  const userId = `verify-derby-${Date.now().toString(36)}`;
  const now = Date.now();
  await query(
    `INSERT INTO arcade_accounts (id, email, email_normalized, username, username_normalized, status, created_at, updated_at)
     VALUES ($1, $2, $2, $3, $3, 'active', $4, $4)`,
    [userId, `${userId}@example.com`, userId, now],
  );
  const user = { userId, userName: userId };
  const raceId = await service.createDerbyRace('practice', user);
  // Wind the clock: the gate opened 20 s ago, so the stream can go in now.
  await query(`UPDATE derby_water_races SET start_at = $2 WHERE id = $1`, [raceId, Date.now() - 20_000]);
  const rt = (globalThis as Record<string, unknown>).__arcadeDerbyWaterRuntime__ as { races: Map<string, unknown> };
  rt.races.delete(raceId);
  const snap = await service.getDerbySnapshot(raceId, userId);
  const model = new DerbyRaceModel(snap!.seed, snap!.lanes.map((l) => (l.kind === 'human' ? { lane: l.lane, kind: 'human' as const } : { lane: l.lane, kind: 'bot' as const, botSkill: l.botSkill ?? 0 })));
  const nowTick = Math.floor((Date.now() - snap!.startAt!) / DERBY_TICK_MS);
  const from = nowTick - 30;
  const flat: number[] = [];
  for (let k = from; k < from + 30; k += 1) flat.push(Math.round(model.path.ticks[k * 2]! * at), Math.round(model.path.ticks[k * 2 + 1]! * at), 1);
  const ok = await service.submitDerbyAims(raceId, user, { from, samples: flat });
  check(ok.ok && ok.kept !== null && ok.kept.n === 30, `a batch on the target is kept (${JSON.stringify('kept' in ok ? ok.kept : ok)})`);
  const tele = await service.submitDerbyAims(raceId, user, { from: from + 30, samples: [-900, 0, 1, 900, 0, 1] });
  check('reason' in tele && tele.reason === 'teleport', 'a teleporting batch is turned down');
  // Wind on past the bots' finish, then settle five times at once.
  await query(`UPDATE derby_water_races SET start_at = start_at - 60000 WHERE id = $1`, [raceId]);
  rt.races.delete(raceId);
  const row = async () =>
    (await query<Record<string, unknown>>(
      `SELECT id, kind, status, seed, rules, host_user_id AS "hostUserId", rematch_of AS "rematchOf", created_at AS "createdAt",
              fill_at AS "fillAt", start_at AS "startAt", end_t AS "endT", winner_lane AS "winnerLane", timed_out AS "timedOut",
              settled_at AS "settledAt" FROM derby_water_races WHERE id = $1`,
      [raceId],
    )).rows[0];
  const race = await row();
  const settles = await Promise.all(Array.from({ length: 5 }, () => service.settleDerbyRace(race as never)));
  const settled = settles.filter(Boolean).length;
  check(settled === 1, `five settles at once: ${settled} settled`);
  const after = await row();
  check(after!.status === 'finished', 'the race is finished');
  await service.payDerbyRace(raceId, { endT: Number(after!.endT) }, 1);
  const ledger = await query<{ n: string }>(`SELECT count(*) AS n FROM currency_ledger WHERE source_id = $1`, [`derby:${raceId}:${userId}`]);
  const lane = await query<{ tickets: number; forfeit: string | null; place: number }>(
    `SELECT tickets, forfeit, place FROM derby_water_lanes WHERE race_id = $1 AND od_user_id = $2`,
    [raceId, userId],
  );
  check(Number(ledger.rows[0]!.n) === 1, `one ledger row after the settle and a second payout (${ledger.rows[0]!.n})`);
  check(lane.rows[0]!.forfeit === null && lane.rows[0]!.tickets === derbyTickets(lane.rows[0]!.place), `paid by place: ${lane.rows[0]!.place} pays ${lane.rows[0]!.tickets}`);
  const late = await service.submitDerbyAims(raceId, user, { from: nowTick + 2_400, samples: [0, 0, 1] });
  check('reason' in late && late.reason === 'finished', 'a batch after the finish is turned away');
  const log = await query<{ n: string }>(`SELECT count(*) AS n FROM anti_cheat_logs WHERE user_id = $1 AND reason LIKE 'Derby aim rejected: teleport%'`, [userId]).catch(() => null);
  check(!log || Number(log.rows[0]!.n) >= 1, 'the teleport is in the anti-cheat log');
}
