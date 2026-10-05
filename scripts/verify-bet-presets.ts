/**
 * The bet row's stub presets, with no database.
 *
 *   npm run test:bet-presets
 *
 * - Across balances 0 to 200,000: four whole presets, strictly increasing,
 *   from the minimum to MAX_TICKET_BET.
 * - Presets never shrink as the balance grows, and keep growing past 250:
 *   5,000 tickets show stubs up to 500, 100,000 show stubs up to 10,000.
 * - 100 tickets show 5, 10, 25 and 50; 1,000 show bigger stubs.
 * - A game with its own lower ceiling (coin pusher, 250) never gets a preset
 *   over it.
 * - Guests and unknown balances get the fixed set.
 * - A game with a higher minimum never gets a preset under it.
 * - The row puts a custom bet in its place among the presets, smallest
 *   first, and leaves out a bet the game doesn't take.
 */
import assert from 'node:assert/strict';

import { betPresets, betRowStubs, FIXED_BET_PRESETS } from '@/features/arcade/lib/bet-presets';
import { ARCADE_MIN_BET, MAX_TICKET_BET } from '@/server/arcade/arcade-constants';

const balances = new Set<number>();
for (let n = 0; n <= 1000; n++) balances.add(n);
for (let n = 1000; n <= 200_000; n += 5) balances.add(n);
const sorted = [...balances].sort((a, b) => a - b);

let previous: readonly number[] | null = null;
for (const balance of sorted) {
  const presets = betPresets(balance);
  assert.equal(presets.length, 4, `balance ${balance}: four presets, got ${presets}`);
  for (let i = 0; i < presets.length; i++) {
    assert.ok(Number.isInteger(presets[i]), `balance ${balance}: ${presets[i]} is a whole number`);
    assert.ok(presets[i] >= ARCADE_MIN_BET && presets[i] <= MAX_TICKET_BET, `balance ${balance}: ${presets[i]} in range`);
    if (i > 0) assert.ok(presets[i] > presets[i - 1], `balance ${balance}: ${presets} increase`);
    if (previous) assert.ok(presets[i] >= previous[i], `balance ${balance}: preset ${i} never falls as tickets grow`);
  }
  previous = presets;
}

assert.deepEqual(betPresets(100), [5, 10, 25, 50]);
assert.deepEqual(betPresets(0), FIXED_BET_PRESETS);
assert.deepEqual(betPresets(null), FIXED_BET_PRESETS);
assert.deepEqual(betPresets(Number.NaN), FIXED_BET_PRESETS);
assert.deepEqual(betPresets(1000), [10, 25, 50, 100]);
assert.deepEqual(betPresets(5000), [50, 100, 250, 500]);
assert.deepEqual(betPresets(10_000), [100, 250, 500, 1000]);
assert.deepEqual(betPresets(100_000), [1000, 2500, 5000, 10_000]);
assert.deepEqual(betPresets(5_000_000), [15_000, 25_000, 50_000, 75_000], 'a huge balance stays under the ceiling');
assert.ok(betPresets(1000)[3] > betPresets(100)[3], '1,000 tickets show bigger stubs than 100');
assert.ok(betPresets(5000)[3] > 250, '5,000 tickets show stubs past the old cap of 250');
// A game's own ceiling (coin pusher takes 250 a drop) caps the stubs.
for (const balance of [0, 100, 1000, 5000, 100_000]) {
  const capped = betPresets(balance, ARCADE_MIN_BET, 250);
  assert.ok(capped.every((p) => p <= 250), `ceiling 250, balance ${balance}: ${capped}`);
}
assert.deepEqual(betPresets(100_000, ARCADE_MIN_BET, 250), [100, 150, 200, 250]);

for (const balance of [0, 20, 100, 1000, 5000, 100_000, 5_000_000]) {
  const presets = betPresets(balance, 25);
  assert.ok(presets.every((p) => p >= 25 && p <= MAX_TICKET_BET), `min 25, balance ${balance}: ${presets}`);
  assert.ok(presets.every((p, i) => i === 0 || p > presets[i - 1]), `min 25, balance ${balance}: increasing`);
}

assert.deepEqual(betRowStubs([25, 50, 100, 200], 10), [10, 25, 50, 100, 200]);
assert.deepEqual(betRowStubs([25, 50, 100, 200], 75), [25, 50, 75, 100, 200]);
assert.deepEqual(betRowStubs([25, 50, 100, 200], 240), [25, 50, 100, 200, 240]);
assert.deepEqual(betRowStubs([25, 50, 100, 200], 50), [25, 50, 100, 200]);
assert.deepEqual(betRowStubs([25, 50, 100, 200], null), [25, 50, 100, 200]);
assert.deepEqual(betRowStubs([25, 50, 100, 200], 10, 25), [25, 50, 100, 200], 'under the minimum stays out');
assert.deepEqual(betRowStubs([25, 50, 100, 200], 600), [25, 50, 100, 200, 600], 'a custom bet past 250 sits in the row');
assert.deepEqual(betRowStubs([25, 50, 100, 200], MAX_TICKET_BET + 1), [25, 50, 100, 200], 'over the ceiling stays out');
assert.deepEqual(betRowStubs([25, 50, 100, 250], 300, 5, 250), [25, 50, 100, 250], 'over a game ceiling stays out');
for (const balance of sorted.filter((n) => n % 97 === 0)) {
  for (const bet of [5, 7, 10, 33, 120, 600, 4321, MAX_TICKET_BET]) {
    const row = betRowStubs(betPresets(balance), bet);
    assert.ok(row.every((p, i) => i === 0 || p > row[i - 1]), `row for ${bet} on ${balance}: ${row} ascends`);
    assert.ok(row.includes(bet), `row for ${bet} on ${balance} holds the bet`);
  }
}

console.log(`bet presets ok: ${sorted.length} balances from 0 to 200,000`);
for (const balance of [0, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, 100_000, 5_000_000]) {
  console.log(`  ${String(balance).padStart(7)}: ${betPresets(balance).join(' / ')}`);
}
