/* Derby's seeded numbers: integer maths only, the same bits everywhere. */

/** Mulberry32, the arcade's generator. */
export function derbyRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seed for one stream, mixed from the race seed, a lane and a salt. */
export function derbyLaneSeed(seed: number, lane: number, salt: number): number {
  let h = (seed ^ Math.imul(lane + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Roughly normal noise, mean 0 and spread 1, from four uniforms. */
export function derbyNoise(rng: () => number): number {
  return (rng() + rng() + rng() + rng() - 2) * 1.7320508075688772;
}
