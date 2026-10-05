/* The ball's path, rebuilt in the browser from the seed the server revealed.

   The server picks the outcome in resolvePlinko (server/arcade/wager-games/
   plinko.ts): sha256(`${seed}:plinko-path`) seeds mulberry32, and each row
   goes right when the draw is >= 0.5. This is the same walk with WebCrypto,
   so the board shows exactly the slot the server paid.
   scripts/verify-plinko-rtp.ts checks the two agree. */

import { sha256 } from '@/features/arcade/lib/sha256';
import type { PlinkoRows } from '@/server/arcade/arcade-constants';

import type { Direction } from './_plinko-trajectory';

export type { Direction };

export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function deriveSubSeed(seed: number, domain: string): Promise<number> {
  const data = new TextEncoder().encode(`${seed}:${domain}`);
  const hashBuffer = await sha256(data);
  return new DataView(hashBuffer).getUint32(0, false);
}

export async function derivePlinkoPath(
  seed: number,
  rows: PlinkoRows,
): Promise<{ path: Direction[]; slotIndex: number }> {
  const rng = mulberry32(await deriveSubSeed(seed, 'plinko-path'));
  const path: Direction[] = [];
  let slotIndex = 0;
  for (let i = 0; i < rows; i++) {
    if (rng() >= 0.5) {
      path.push('R');
      slotIndex++;
    } else {
      path.push('L');
    }
  }
  return { path, slotIndex };
}
