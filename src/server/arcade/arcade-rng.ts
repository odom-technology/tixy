// ---------------------------------------------------------------------------
// Arcade — Seeded PRNG utilities (mulberry32-based, deterministic)
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';

/** Mulberry32 PRNG — returns a stateful function that yields floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Get the Nth seeded float (0..1) by advancing the RNG N+1 times. */
function seededFloat(seed: number, index: number): number {
  const rng = mulberry32(seed);
  let result = 0;
  for (let i = 0; i <= index; i++) {
    result = rng();
  }
  return result;
}

/** Get a seeded integer in [0, max). */
function _seededInt(seed: number, index: number, max: number): number {
  return Math.floor(seededFloat(seed, index) * max);
}

/**
 * Derive a deterministic sub-seed from a parent seed and a string label.
 * Useful for generating independent RNG streams for different game phases
 * (e.g., each reel in slots, mine placement vs bonus).
 */
export function deriveSubSeed(seed: number, label: string): number {
  const hash = crypto
    .createHash('sha256')
    .update(`${seed}:${label}`)
    .digest();
  return hash.readUInt32BE(0);
}

/**
 * Fisher-Yates shuffle using seeded RNG.
 * Returns a new shuffled array (does not mutate input).
 */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const arr = [...items];
  const rng = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** Generate a cryptographically random seed for a new arcade session. */
export function generateArcadeSeed(): number {
  return crypto.randomInt(0, 2 ** 31);
}

/**
 * Hash a seed for provably-fair verification. NOTE: the seed is a 31-bit
 * integer, so this hash is brute-forceable in seconds — it must NEVER be sent
 * to the client before/during a round (that would leak the seed and let
 * players pre-compute outcomes). The seed is revealed only after the round
 * ends; the client derives this hash from the revealed seed for display.
 */
export function hashSeed(seed: number): string {
  return crypto.createHash('sha256').update(String(seed)).digest('hex');
}
