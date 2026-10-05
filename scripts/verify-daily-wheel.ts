/**
 * The daily spin's verifier (docs/design/tixy-rebrand/DAILY_WHEEL.md).
 *
 *   npm run test:daily-wheel            maths, simulation, motion, and the
 *                                       database checks on a local database
 *   npm run test:daily-wheel -- --no-db  everything but the database
 *
 * 1. The layout: 50 units, every unit in one slot, slot widths as drawn.
 * 2. Expected payout per streak day, exact from the weights, equals the old
 *    ladder (25, 25, 50, 50, 75, 100, 200, repeating).
 * 3. The distribution, by simulation through the server's own draw.
 * 4. The legacy hold: never paid less than the hold, nor less than the wheel.
 * 5. The motion: every plan stops on the drawn unit, clear of the pegs, at
 *    30 to 144 Hz, with speed continuous and never backwards until a climb.
 * 6. The database (local only, throwaway users, cleaned up): a day spins
 *    once, two spins at once pay once, the row and ledger keep the unit, the
 *    status reports it, and the next day's multiplier follows the streak.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

for (const envFile of ['env/.env.local', 'env/.env']) {
  try {
    for (const raw of fs.readFileSync(path.join(process.cwd(), envFile), 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      const eq = line.indexOf('=');
      if (!line || line.startsWith('#') || eq < 0) continue;
      const key = line.slice(0, eq).trim();
      if (process.env[key] === undefined) process.env[key] = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch {
    // no env file
  }
}

const wheel = await import('../src/features/arcade/lib/daily-wheel');
const motion = await import('../src/features/arcade/lib/daily-wheel-motion');
const { DAILY_CLAIM_LADDER } = await import('../src/features/arcade/lib/rewards');

let failures = 0;
let checks = 0;
const check = (name: string, ok: boolean, detail = '') => {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`);
};

const {
  DAILY_WHEEL_SEGMENTS: SEGMENTS,
  DAILY_WHEEL_UNITS: UNITS,
  DAILY_WHEEL_MULTIPLIERS: MULTIPLIERS,
} = wheel;

/* ── 1. layout ───────────────────────────────────────────────────────── */
console.log('\nlayout');
const unitsTotal = SEGMENTS.reduce((sum, segment) => sum + segment.units, 0);
check('the slots cover 50 units', unitsTotal === UNITS && UNITS === 50, `${unitsTotal}`);
check(
  'slots are contiguous from unit 0',
  SEGMENTS.every((segment, index) => segment.start === (index === 0 ? 0 : SEGMENTS[index - 1]!.start + SEGMENTS[index - 1]!.units)),
);
check(
  'every unit maps back to the slot that holds it',
  Array.from({ length: UNITS }, (_, unit) => wheel.wheelSegmentForUnit(unit)).every(
    (segment, unit) => unit >= segment.start && unit < segment.start + segment.units,
  ),
);
check('no two neighbouring slots share a value', SEGMENTS.every((s, i) => s.value !== SEGMENTS[(i + 1) % SEGMENTS.length]!.value));
const top = SEGMENTS.filter((segment) => segment.tier === 'top');
check('one top slot, 1 unit wide, worth 200', top.length === 1 && top[0]!.units === 1 && top[0]!.value === 200);
check('the 200 sits at the top of the wheel at rest', top[0]!.start === 0);
check('body slots are 2 units, the 100 and 200 are 1', SEGMENTS.every((s) => s.units === (s.value >= 100 ? 1 : 2)));

/* ── 2. expected payout per streak day, exact ────────────────────────── */
console.log('\nexpected payout per streak day (exact from the weights)');
const weightedSum = SEGMENTS.reduce((sum, segment) => sum + segment.value * segment.units, 0);
check('base expected value is 25: sum(value x units) = 25 x 50', weightedSum === 25 * UNITS, `${weightedSum}/${UNITS}`);
const rows: string[] = [];
for (let day = 1; day <= 14; day += 1) {
  const multiplier = wheel.wheelMultiplier(day);
  const ladder = DAILY_CLAIM_LADDER[(day - 1) % DAILY_CLAIM_LADDER.length]!;
  const exact = weightedSum * multiplier === ladder * UNITS;
  check(`day ${day}: ×${multiplier}, EV ${(weightedSum * multiplier) / UNITS} = ladder ${ladder}`, exact && Number.isInteger(multiplier));
  if (day <= 7) {
    const sorted = Array.from({ length: UNITS }, (_, unit) => wheel.wheelPayout(unit, day).tickets).sort((a, b) => a - b);
    rows.push(`| ${day} | ${ladder} | ×${multiplier} | ${sorted[0]} | ${sorted[UNITS / 2 - 1]}/${sorted[UNITS / 2]} | ${(weightedSum * multiplier) / UNITS} | ${200 * multiplier} |`);
  }
}
check('multipliers are 1, 1, 2, 2, 3, 4, 8', MULTIPLIERS.join(',') === '1,1,2,2,3,4,8');
const weekly = Array.from({ length: 7 }, (_, i) => (weightedSum * wheel.wheelMultiplier(i + 1)) / UNITS).reduce((a, b) => a + b, 0);
check('a full week expects 525, as the ladder did', weekly === 525, `${weekly}`);
console.log('| day | ladder | mult | least | median | EV | top |');
for (const row of rows) console.log(row);

/* ── 3. distribution by simulation, through the server's draw ─────────── */
console.log('\ndistribution (simulated with the server draw)');
const { drawWheelUnit } = await import('../src/server/arcade/rewards/daily-claim');
const N = 1_000_000;
const unitCounts = new Array<number>(UNITS).fill(0);
for (let i = 0; i < N; i += 1) unitCounts[drawWheelUnit()]! += 1;
check('every draw is a unit 0 to 49', unitCounts.reduce((a, b) => a + b, 0) === N);
// Chi-square over 50 equal cells, 49 degrees of freedom: the 0.1% critical value is 85.35.
const expected = N / UNITS;
const chi2 = unitCounts.reduce((sum, count) => sum + (count - expected) ** 2 / expected, 0);
check('units are uniform (chi-square, 49 df, p > 0.001)', chi2 < 85.35, `chi2 ${chi2.toFixed(1)}`);
const byValue = new Map<number, number>();
for (const segment of SEGMENTS) {
  let count = 0;
  for (let u = segment.start; u < segment.start + segment.units; u += 1) count += unitCounts[u]!;
  byValue.set(segment.value, (byValue.get(segment.value) ?? 0) + count);
}
for (const [value, count] of [...byValue].sort((a, b) => a[0] - b[0])) {
  const units = SEGMENTS.filter((s) => s.value === value).reduce((sum, s) => sum + s.units, 0);
  const p = units / UNITS;
  const sigma = Math.sqrt(N * p * (1 - p));
  check(`value ${value}: ${((count / N) * 100).toFixed(2)}% against ${(p * 100).toFixed(0)}%`, Math.abs(count - N * p) < 5 * sigma);
}
for (const day of [1, 3, 5, 6, 7]) {
  let paid = 0;
  for (let unit = 0; unit < UNITS; unit += 1) paid += unitCounts[unit]! * wheel.wheelPayout(unit, day).tickets;
  const mean = paid / N;
  const ladder = DAILY_CLAIM_LADDER[day - 1]!;
  // Standard error of the mean from the exact variance.
  const variance =
    Array.from({ length: UNITS }, (_, unit) => wheel.wheelPayout(unit, day).tickets ** 2).reduce((a, b) => a + b, 0) / UNITS - ladder ** 2;
  const se = Math.sqrt(variance / N);
  check(`day ${day}: simulated mean ${mean.toFixed(2)} within 5 SE of ${ladder}`, Math.abs(mean - ladder) < 5 * se, `SE ${se.toFixed(3)}`);
}

/* ── 4. the legacy hold ──────────────────────────────────────────────── */
console.log('\nlegacy hold');
let floorOk = true;
let wheelOk = true;
let heldFlagOk = true;
for (const hold of [0, 75, 82, 117, 208]) {
  for (let day = 1; day <= 14; day += 1) {
    for (let unit = 0; unit < UNITS; unit += 1) {
      const pay = wheel.wheelPayout(unit, day, hold);
      if (pay.tickets < hold) floorOk = false;
      if (pay.tickets < pay.value * pay.multiplier) wheelOk = false;
      if (pay.held !== (hold > pay.value * pay.multiplier)) heldFlagOk = false;
    }
  }
}
check('a spin never pays less than the hold', floorOk);
check('a spin never pays less than the wheel', wheelOk);
check('held is set exactly when the hold paid more', heldFlagOk);
for (const hold of [117, 208]) {
  const ev = Array.from({ length: UNITS }, (_, unit) => wheel.wheelPayout(unit, 7, hold).tickets).reduce((a, b) => a + b, 0) / UNITS;
  check(`hold ${hold}, day 7: expected ${ev.toFixed(1)} is at least the ladder's 200 and the hold`, ev >= 200 && ev >= hold);
}

/* ── 5. the motion ───────────────────────────────────────────────────── */
console.log('\nmotion');
let stopsOnUnit = true;
let clearOfPegs = true;
let continuous = true;
let forward = true;
let durationsOk = true;
let skipOk = true;
let rateOk = true;
const durations: number[] = [];
let climbs = 0;
let trials = 0;
for (let unit = 0; unit < UNITS; unit += 1) {
  for (const seed of ['2026-10-04', '2026-10-05', '2027-01-01', 'x']) {
    for (const latency of [0, 120, 900]) {
      trials += 1;
      const stop = motion.wheelStopFor(unit, seed);
      if (stop.climb !== null) climbs += 1;
      const m = motion.createWheelMotion((unit * 37) % 360);
      const t0 = 1000;
      m.start(t0);
      m.stopOn(t0 + latency, stop);
      const end = m.stopsAt!;
      const final = m.angleAt(end + 1000);
      if (wheel.unitAtRotation(final) !== unit) stopsOnUnit = false;
      if (motion.flapperContact(final) !== null) clearOfPegs = false;
      durations.push(end - t0);
      if (end - t0 < 3000 || end - t0 > 5600) durationsOk = false;
      // Sample at 1 ms: speed continuous (no jump over 2% of top speed in 1 ms),
      // never backwards before the climb's peak.
      let previous = m.angleAt(t0);
      const landsAt = m.landsAt!;
      for (let t = t0 + 1; t <= landsAt; t += 1) {
        const angle = m.angleAt(t);
        if (angle < previous - 1e-9) forward = false;
        const jump = Math.abs(m.speedAt(t) - m.speedAt(t - 1));
        if (jump > motion.WHEEL_TOP_SPEED * 0.02) continuous = false;
        previous = angle;
      }
      // Display rates: the last frame at or after the stop reads the unit.
      for (const hz of [30, 60, 90, 120, 144]) {
        const frame = 1000 / hz;
        const lastFrame = t0 + Math.ceil((end - t0) / frame) * frame;
        if (wheel.unitAtRotation(m.angleAt(lastFrame)) !== unit) rateOk = false;
      }
      // Skip mid slowdown: same unit, in SKIP ms.
      const s = motion.createWheelMotion(0);
      s.start(t0);
      s.stopOn(t0 + latency, stop);
      const mid = t0 + latency + 900;
      s.skip(mid);
      if (Math.abs(s.stopsAt! - (mid + motion.WHEEL_SKIP_MS)) > 1e-6) skipOk = false;
      if (wheel.unitAtRotation(s.angleAt(s.stopsAt! + 1)) !== unit) skipOk = false;
      let prev = s.angleAt(mid);
      for (let t = mid; t <= s.stopsAt!; t += 1) {
        const angle = s.angleAt(t);
        if (angle < prev - 1e-9) skipOk = false;
        prev = angle;
      }
    }
  }
}
durations.sort((a, b) => a - b);
check(`every plan stops on the drawn unit (${trials} plans)`, stopsOnUnit);
check('every stop is clear of both pegs (the flapper reads one unit)', clearOfPegs);
check('speed is continuous through the kick, the switch and the slowdown', continuous);
check('the wheel never turns backwards before it lands', forward);
check(
  `pull to rest takes 3.0 to 5.6 s`,
  durationsOk,
  `min ${(durations[0]! / 1000).toFixed(2)} s, median ${(durations[durations.length >> 1]! / 1000).toFixed(2)} s, max ${(durations.at(-1)! / 1000).toFixed(2)} s`,
);
check('the frame at the stop reads the unit at 30, 60, 90, 120 and 144 Hz', rateOk);
check('a skip lands on the same unit in 450 ms, never backwards', skipOk);
check(`some stops climb a peg and rock back (${climbs} of ${trials})`, climbs > trials * 0.25 && climbs < trials * 0.55);

/* ── 6. the database ─────────────────────────────────────────────────── */
console.log('\ndatabase');
const url = process.env.DATABASE_URL ?? '';
const local = /@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);
if (process.argv.includes('--no-db') || !local) {
  console.log(`skip  database checks (${process.argv.includes('--no-db') ? '--no-db' : 'no local DATABASE_URL'})`);
} else {
  const { query, queryOne, getPool } = await import('../src/server/db/client');
  const daily = await import('../src/server/arcade/rewards/daily-claim');
  const users = Array.from({ length: 3 }, () => `wheel-verify-${randomUUID()}`);
  const [once, race, streak] = users as [string, string, string];
  try {
    const key = '2031-05-01';
    const first = await daily.claimDailyCreditsForDate(once, key);
    check('a spin pays value times multiplier', first.ticketsAwarded === first.wheel.value * first.wheel.multiplier && first.wheel.multiplier === 1);
    let second: unknown = null;
    try {
      await daily.claimDailyCreditsForDate(once, key);
    } catch (error) {
      second = error;
    }
    check('a second spin the same day is refused as already claimed', second instanceof Error && second.message === 'Already claimed today.');
    const row = await queryOne<{ wheel_unit: number; wheel_value: number; wheel_multiplier: number; wheel_version: number; credits_awarded: number }>(
      `SELECT wheel_unit, wheel_value, wheel_multiplier, wheel_version, credits_awarded FROM daily_credit_claims WHERE user_id = $1 AND date_key = $2`,
      [once, key],
    );
    check(
      'the claim row keeps the unit, value, multiplier and version',
      !!row && Number(row.wheel_unit) === first.wheel.unit && Number(row.wheel_value) === first.wheel.value &&
        Number(row.wheel_multiplier) === first.wheel.multiplier && Number(row.wheel_version) === wheel.DAILY_WHEEL_VERSION &&
        Number(row.credits_awarded) === first.ticketsAwarded,
    );
    const ledger = await query<{ amount: number; meta_json: string; source_type: string }>(
      `SELECT amount, meta_json, source_type FROM currency_ledger WHERE user_id = $1`,
      [once],
    );
    const meta = ledger.rows[0] ? (JSON.parse(ledger.rows[0].meta_json) as { wheel?: { unit?: number } }) : null;
    check(
      'one daily_claim ledger entry, with the unit in its meta',
      ledger.rows.length === 1 && ledger.rows[0]!.source_type === 'daily_claim' && Number(ledger.rows[0]!.amount) === first.ticketsAwarded &&
        meta?.wheel?.unit === first.wheel.unit,
    );

    const results = await Promise.allSettled([
      daily.claimDailyCreditsForDate(race, key),
      daily.claimDailyCreditsForDate(race, key),
      daily.claimDailyCreditsForDate(race, key),
    ]);
    const won = results.filter((r) => r.status === 'fulfilled').length;
    const refused = results.filter((r) => r.status === 'rejected' && (r.reason as Error).message === 'Already claimed today.').length;
    const raceLedger = await query<{ n: string }>(`SELECT count(*) AS n FROM currency_ledger WHERE user_id = $1`, [race]);
    check('three spins at once: one pays, two are refused, one ledger entry', won === 1 && refused === 2 && Number(raceLedger.rows[0]!.n) === 1);

    // A streak: days 1 to 8 in a row, each with the 40 slot.
    const unit40 = SEGMENTS.find((s) => s.value === 40)!.start;
    const paid: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      const dateKey = `2031-06-${String(i + 1).padStart(2, '0')}`;
      const spin = await daily.claimDailyCreditsForDate(streak, dateKey, { drawUnit: () => unit40 });
      paid.push(spin.ticketsAwarded);
    }
    check('a streak multiplies: 40 pays 40, 40, 80, 80, 120, 160, 320, then 40', paid.join(',') === '40,40,80,80,120,160,320,40', paid.join(','));
    const gap = await daily.claimDailyCreditsForDate(streak, '2031-06-10', { drawUnit: () => unit40 });
    check('a missed day starts again at ×1', gap.streak === 1 && gap.wheel.multiplier === 1);
    let refusedUnit: unknown = null;
    try {
      await daily.claimDailyCreditsForDate(streak, '2031-06-11', { drawUnit: () => 50 });
    } catch (error) {
      refusedUnit = error;
    }
    check('a draw outside the wheel is refused and pays nothing', refusedUnit instanceof Error &&
      !(await queryOne(`SELECT 1 FROM daily_credit_claims WHERE user_id = $1 AND date_key = '2031-06-11'`, [streak])));
  } finally {
    for (const table of ['daily_credit_claims', 'currency_ledger', 'wallets']) {
      await query(`DELETE FROM ${table} WHERE user_id = ANY($1)`, [users]);
    }
    await getPool().end();
  }
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
