'use client';

import { sha256 } from '@/features/arcade/lib/sha256';
import { useEffect, useState } from 'react';

/**
 * Provably-fair seed hash — derived CLIENT-SIDE from the revealed seed, and
 * only AFTER the round ends.
 *
 * Why not show the commitment hash up front? The arcade RNG seed is a small
 * integer, so `sha256(seed)` is brute-forceable in seconds. Exposing that hash
 * before/during a round let players recover the seed and pre-compute outcomes
 * (mine locations, Crossy safe lanes, crash points, …). The seed is fixed
 * server-side when the round is created (the audit trail), but nothing about
 * it reaches the client until the round is over and the seed is revealed.
 */

/** SHA-256 hex of a string via Web Crypto (client-side, secure contexts). */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await sha256(bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Returns the SHA-256 of the revealed seed once it's known, else null. The
 * hash is purely a fingerprint of the now-public seed for display/verification
 * — it is never available while the round is still in play.
 */
export function useRevealedSeedHash(revealedSeed: number | null): string | null {
  const [hash, setHash] = useState<string | null>(null);

  useEffect(() => {
    if (revealedSeed == null) {
      setHash(null);
      return;
    }
    let cancelled = false;
    void sha256Hex(String(revealedSeed)).then((h) => {
      if (!cancelled) setHash(h);
    });
    return () => {
      cancelled = true;
    };
  }, [revealedSeed]);

  return hash;
}
