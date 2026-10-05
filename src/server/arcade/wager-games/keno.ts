// ---------------------------------------------------------------------------
// tixy — Keno game logic
//
// 40-number board, player picks 1..10, 10 drawn without replacement via a
// seeded Fisher-Yates shuffle of 1..40 (the same seededShuffle the rest of the
// provably-fair stack uses). Payout is multiplier[picks][hits] chosen from one
// of four risk profiles.
//
// Every (profile, picks) column is pinned to exactly ARCADE_RTP theoretical
// return: the displayed base multipliers below give a *raw* RTP already within
// ~1% of target, and a per-column correction factor (KENO_RTP_FACTORS, derived
// at module load from the exact hypergeometric distribution) trims it to the
// target on payout — identical to plinko's PLINKO_RTP_FACTORS convention.
// See scratchpad/keno/design.mjs + verify-rtp.mjs for the offline derivation.
// ---------------------------------------------------------------------------

import { ARCADE_RTP } from '../arcade-constants';
import { roundArcadePayout } from '../arcade-payout';
import { seededShuffle } from '../arcade-rng';

export const KENO_BOARD_SIZE = 40;
export const KENO_DRAW_COUNT = 10;
export const KENO_MIN_PICKS = 1;
export const KENO_MAX_PICKS = 10;

export const KENO_PROFILES = ['classic', 'low', 'medium', 'high'] as const;
export type KenoProfile = (typeof KENO_PROFILES)[number];

/**
 * Base (displayed) payout multipliers. Outer key: risk profile. Middle index:
 * number of spots picked (1..10; index 0 unused). Inner index: number of hits
 * (0..picks). A 0 means that hit count does not pay.
 *
 * Design intent per profile (max top prize climbs with variance):
 *   low     — pays on frequent low hit counts, small multipliers, gentle curve
 *   classic — familiar keno curve, pays around break-even hits
 *   medium  — pays a step deeper, bigger tops
 *   high    — only the rare deep-hit counts pay, huge jackpots (capped 10000x)
 */
export const KENO_PAYOUTS: Record<KenoProfile, number[][]> = {
  classic: [
    [],
    [0, 3.96],
    [0, 0, 17.16],
    [0, 0, 5.72, 17.16],
    [0, 0, 2.8, 8.41, 25],
    [0, 0, 1.62, 4.85, 14.56, 43.5],
    [0, 0, 0, 4.55, 13.65, 41, 123],
    [0, 0, 0, 2.63, 7.9, 23.5, 71, 213],
    [0, 0, 0, 1.64, 4.93, 14.79, 44.5, 133, 399],
    [0, 0, 0, 1.08, 3.24, 9.72, 29, 87.5, 262, 787],
    [0, 0, 0, 0, 2.81, 8.42, 25.5, 76, 227, 682, 2046],
  ],
  low: [
    [],
    [0, 3.96],
    [0, 1.94, 4.26],
    [0, 1.24, 2.72, 5.99],
    [0, 0.88, 1.93, 4.24, 9.32],
    [0, 0.65, 1.43, 3.15, 6.93, 15.24],
    [0, 0, 1.34, 2.95, 6.49, 14.28, 31.5],
    [0, 0, 0.97, 2.13, 4.68, 10.29, 22.5, 50],
    [0, 0, 0.72, 1.59, 3.5, 7.69, 16.92, 37, 82],
    [0, 0, 0.55, 1.22, 2.68, 5.89, 12.95, 28.5, 62.5, 138],
    [0, 0, 0, 1.1, 2.41, 5.3, 11.66, 25.5, 56.5, 124, 273],
  ],
  medium: [
    [],
    [0, 3.96],
    [0, 0, 17.16],
    [0, 0, 5, 25],
    [0, 0, 2.49, 8.96, 45],
    [0, 0, 1.39, 5, 18.01, 91],
    [0, 0, 0, 4.1, 14.75, 53, 268],
    [0, 0, 0, 2.28, 8.2, 29.5, 106, 536],
    [0, 0, 0, 1.36, 4.9, 17.63, 63.5, 228, 1151],
    [0, 0, 0, 0.85, 3.07, 11.04, 39.5, 143, 515, 2595],
    [0, 0, 0, 0, 2.37, 8.52, 30.5, 110, 397, 1430, 7209],
  ],
  high: [
    [],
    [0, 3.96],
    [0, 0, 17.16],
    [0, 0, 0, 81.5],
    [0, 0, 0, 15.87, 159],
    [0, 0, 0, 6.76, 34, 338],
    [0, 0, 0, 0, 27, 136, 1361],
    [0, 0, 0, 0, 11.62, 58, 291, 2905],
    [0, 0, 0, 0, 5.57, 28, 139, 697, 6967],
    [0, 0, 0, 0, 2.9, 14.52, 72.5, 363, 1815, 10000],
    [0, 0, 0, 0, 0, 10.55, 53, 264, 1319, 6597, 10000],
  ],
};

// ---------------------------------------------------------------------------
// RTP correction factors — computed once from the exact hypergeometric
// distribution so every column pays exactly ARCADE_RTP['arcade-keno'].
// ---------------------------------------------------------------------------

function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  const kk = Math.min(k, n - k);
  let num = 1;
  let den = 1;
  for (let i = 0; i < kk; i++) {
    num *= n - i;
    den *= i + 1;
  }
  return num / den;
}

const KENO_TOTAL_COMBINATIONS = binomial(KENO_BOARD_SIZE, KENO_DRAW_COUNT);

/**
 * Probability of exactly `hits` of the player's `picks` spots appearing among
 * the 10 drawn numbers. Hypergeometric:
 *   P = C(picks, hits) * C(40-picks, 10-hits) / C(40, 10)
 */
export function kenoHitProbability(picks: number, hits: number): number {
  if (hits < 0 || hits > picks || picks < 0) return 0;
  return (
    (binomial(picks, hits) *
      binomial(KENO_BOARD_SIZE - picks, KENO_DRAW_COUNT - hits)) /
    KENO_TOTAL_COMBINATIONS
  );
}

/** Raw (uncorrected) RTP of a base multiplier column. */
function rawColumnRtp(table: number[], picks: number): number {
  let rtp = 0;
  for (let hits = 0; hits <= picks; hits++) {
    rtp += kenoHitProbability(picks, hits) * (table[hits] ?? 0);
  }
  return rtp;
}

/**
 * KENO_RTP_FACTORS[profile][picks] — multiply the base multiplier by this to
 * land on exactly the target RTP. Derived from the base tables above so there
 * is a single source of truth (edit a payout, the factor re-solves).
 */
export const KENO_RTP_FACTORS: Record<KenoProfile, number[]> = (() => {
  const target = ARCADE_RTP['arcade-keno'];
  const out = {} as Record<KenoProfile, number[]>;
  for (const profile of KENO_PROFILES) {
    const factors: number[] = [];
    for (let picks = 0; picks <= KENO_MAX_PICKS; picks++) {
      const table = KENO_PAYOUTS[profile][picks] ?? [];
      const raw = rawColumnRtp(table, picks);
      factors[picks] = raw > 0 ? target / raw : 1;
    }
    out[profile] = factors;
  }
  return out;
})();

// ---------------------------------------------------------------------------
// Config + resolution
// ---------------------------------------------------------------------------

export type KenoConfig = {
  profile: KenoProfile;
  /** Distinct spots in 1..40, ascending, length 1..10. */
  picks: number[];
};

export type KenoResult = {
  profile: KenoProfile;
  picks: number[];
  /** The 10 drawn numbers, ascending. */
  drawn: number[];
  /** Player spots that were drawn. */
  hitNumbers: number[];
  hits: number;
  /** Displayed base multiplier for this hit count. */
  multiplier: number;
};

/** Validate a keno config from the client. */
export function validateKenoConfig(config: unknown): KenoConfig | null {
  if (!config || typeof config !== 'object') return null;
  const c = config as Record<string, unknown>;

  const profile = c.profile;
  if (typeof profile !== 'string' || !(KENO_PROFILES as readonly string[]).includes(profile)) {
    return null;
  }

  const rawPicks = c.picks;
  if (!Array.isArray(rawPicks)) return null;
  if (rawPicks.length < KENO_MIN_PICKS || rawPicks.length > KENO_MAX_PICKS) return null;

  const seen = new Set<number>();
  for (const p of rawPicks) {
    if (
      typeof p !== 'number' ||
      !Number.isInteger(p) ||
      p < 1 ||
      p > KENO_BOARD_SIZE ||
      seen.has(p)
    ) {
      return null;
    }
    seen.add(p);
  }

  const picks = [...seen].sort((a, b) => a - b);
  return { profile: profile as KenoProfile, picks };
}

/**
 * Draw the 10 keno numbers from a seed: Fisher-Yates shuffle of 1..40, take the
 * first 10. Returned ascending for stable display; membership is what matters
 * for hit detection.
 */
export function drawKenoNumbers(seed: number): number[] {
  const all = Array.from({ length: KENO_BOARD_SIZE }, (_, i) => i + 1);
  const shuffled = seededShuffle(all, seed);
  return shuffled.slice(0, KENO_DRAW_COUNT).sort((a, b) => a - b);
}

/** Resolve the keno outcome for a seed + config. */
export function resolveKeno(
  seed: number,
  profile: KenoProfile,
  picks: number[],
): KenoResult {
  const drawn = drawKenoNumbers(seed);
  const drawnSet = new Set(drawn);
  const hitNumbers = picks.filter((p) => drawnSet.has(p));
  const hits = hitNumbers.length;
  const table = KENO_PAYOUTS[profile][picks.length] ?? [];
  const multiplier = table[hits] ?? 0;
  return { profile, picks, drawn, hitNumbers, hits, multiplier };
}

/** Compute the payout for a resolved keno round, with the RTP factor applied. */
export function computeKenoPayout(
  wager: number,
  profile: KenoProfile,
  picksCount: number,
  hits: number,
  seed: number,
): number {
  const base = KENO_PAYOUTS[profile][picksCount]?.[hits] ?? 0;
  if (base <= 0) return 0;
  const factor = KENO_RTP_FACTORS[profile][picksCount] ?? 1;
  return roundArcadePayout(
    wager * base * factor,
    seed,
    `keno:${profile}:${picksCount}:${hits}`,
  );
}
