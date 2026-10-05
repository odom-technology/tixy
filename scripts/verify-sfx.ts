/* The sample pipeline's trim and level math (scripts/sfx/process.ts), on
   synthetic takes: lead-in noise, a quiet hit before the loud one, a hiss
   floor. No ffmpeg, no network. */

import assert from 'node:assert/strict';

import { findRange, gate, peak, punch, RATE, shapeTake } from './sfx/process';

const db = (x: number) => 20 * Math.log10(x);
const ms = (n: number) => Math.round((n / RATE) * 1000);

/** White noise at `level` for `seconds`, seeded so runs agree. */
function noise(seconds: number, level: number, seed = 1): Float32Array {
  let s = seed;
  const out = new Float32Array(Math.round(RATE * seconds));
  for (let i = 0; i < out.length; i += 1) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = ((s / 0xffffffff) * 2 - 1) * level;
  }
  return out;
}

/** A decaying 1 kHz hit at `at` seconds, `amp` loud, 40 ms time constant. */
function addHit(into: Float32Array, at: number, amp: number): void {
  const start = Math.round(RATE * at);
  for (let i = 0; start + i < into.length && i < RATE * 0.3; i += 1) {
    into[start + i]! += amp * Math.sin((2 * Math.PI * 1000 * i) / RATE) * Math.exp(-i / (RATE * 0.04));
  }
}

// A take with 200 ms of hiss, a quiet hit at 0.2 s and the loud one at 0.5 s.
const take = noise(1, 0.003);
addHit(take, 0.2, 0.05);
addHit(take, 0.5, 0.4);

// Without slice the cue starts at the first hit that matters (the quiet one
// is 18 dB under, inside the 36 dB onset) and drops the hiss lead-in.
const [a] = findRange(take);
assert.ok(Math.abs(ms(a) - 200) <= 8, `whole-take start ${ms(a)} ms, want ~200`);

// With slice it starts on the loud hit, not the quiet one or the hiss.
const [sa, sb] = findRange(take, { slice: true });
assert.ok(Math.abs(ms(sa) - 500) <= 8, `sliced start ${ms(sa)} ms, want ~500`);
assert.ok(ms(sb) > 600 && ms(sb) <= 1000, `sliced end ${ms(sb)} ms`);

// Shaped: the loudest 50 ms lands on the level, and the peak stays under -1.
const shaped = shapeTake(take, { slice: true, levelDb: -18 });
assert.ok(Math.abs(db(punch(shaped)) - -18) < 0.2 || db(peak(shaped)) > -1.05, 'level or peak cap');
assert.ok(db(peak(shaped)) <= -0.99, `peak ${db(peak(shaped)).toFixed(2)} dBFS`);
assert.ok(shaped.length <= Math.round(RATE * 0.5) + 1, 'sliced take is shorter than its source');
assert.ok(Math.abs(shaped[0]!) < 1e-9, 'fades in from zero');
assert.ok(Math.abs(shaped[shaped.length - 1]!) < 1e-3, 'fades out to zero');

// A hot take is held at the -1 dBFS peak rather than pushed to the level.
const hot = new Float32Array(RATE * 0.3);
addHit(hot, 0, 0.9);
const hotShaped = shapeTake(hot, { slice: true, levelDb: -3 });
assert.ok(db(peak(hotShaped)) <= -0.99 && db(peak(hotShaped)) > -1.1, 'peak capped at -1 dBFS');

// The gate pushes hiss well down and leaves the hit alone.
const hiss = noise(0.4, 0.0008); // about 53 dB under the hit
addHit(hiss, 0.2, 0.5);
const gated = gate(hiss, -45);
const floorBefore = punch(hiss.slice(0, RATE * 0.15));
const floorAfter = punch(gated.slice(0, RATE * 0.15));
assert.ok(db(floorBefore) - db(floorAfter) > 12, `gate cut the floor by ${(db(floorBefore) - db(floorAfter)).toFixed(1)} dB`);
assert.ok(Math.abs(db(peak(gated)) - db(peak(hiss))) < 0.1, 'gate leaves the hit');

// Loops keep their length and get no fades.
const bed = noise(2, 0.1);
const loop = shapeTake(bed, {}, true);
assert.equal(loop.length, bed.length);
assert.notEqual(loop[0], 0);

console.log('sfx pipeline checks passed');
