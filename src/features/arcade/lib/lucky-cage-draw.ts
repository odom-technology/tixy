/* ──────────────────────────────────────────────────────────────────────────
   Lucky Cage — browser-safe replica of the server draw.

   The authoritative draw lives in src/server/arcade/wager-games/lucky-cage.ts
   and runs through src/server/arcade/arcade-rng.ts, which imports node:crypto
   for seed generation and hashing. That module can never be pulled into a
   client bundle, so this file re-states the two PURE pieces it needs —
   mulberry32 and the Fisher-Yates shuffle — with byte-identical arithmetic.

   This replica is COSMETIC/VERIFICATION ONLY:
     - after the round settles and the seed is revealed, the client recomputes
       the draw and shows the player that it matches the server's;
     - it never decides money. The payout always comes from the settle
       response.

   scripts/verify-lucky-cage-client-parity.ts asserts the two implementations
   agree on 100,000+ seeds. If you touch either side, run it.
   ────────────────────────────────────────────────────────────────────────── */

export const LUCKY_CAGE_BALLS = 20;
export const LUCKY_CAGE_DRAWN = 5;

/**
 * Mulberry32 — a verbatim copy of `mulberry32` in
 * src/server/arcade/arcade-rng.ts. Every operator matters: `s | 0` truncation,
 * `Math.imul`, the `>>> 0` before the divide.
 */
export function luckyCageRng(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates over a copy of `items`, matching `seededShuffle` exactly:
 * descending i, `j = floor(rng() * (i + 1))`, swap.
 */
export function luckyCageShuffle<T>(items: readonly T[], seed: number): T[] {
  const arr = [...items];
  const rng = luckyCageRng(seed);
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

/**
 * The five balls in chute order for a revealed seed — the client-side mirror
 * of `drawLuckyCage`.
 */
export function drawLuckyCageClient(seed: number): number[] {
  const all = Array.from({ length: LUCKY_CAGE_BALLS }, (_, i) => i + 1);
  return luckyCageShuffle(all, seed).slice(0, LUCKY_CAGE_DRAWN);
}

/** True when the recomputed draw matches what the server reported. */
export function luckyCageDrawMatches(
  seed: number,
  serverDraw: readonly number[] | null | undefined,
): boolean {
  if (!serverDraw || serverDraw.length !== LUCKY_CAGE_DRAWN) return false;
  const local = drawLuckyCageClient(seed);
  for (let i = 0; i < LUCKY_CAGE_DRAWN; i += 1) {
    if (local[i] !== serverDraw[i]) return false;
  }
  return true;
}
