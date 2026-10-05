// ---------------------------------------------------------------------------
// tixy — Prize Wheel game logic (carnival wheel-of-fortune, single spin)
// ---------------------------------------------------------------------------
//
// The player picks a wheel: a segment COUNT ∈ {10,20,30,40,50} and a RISK ∈
// {low, medium, high}. Each (count, risk) pair defines a fixed list of segment
// multipliers (the wheel layout). The server draws ONE uniform segment index
// from the session seed and the wheel pays wager × layout[index].
//
// Provably-fair shape (mirrors dice/roulette exactly):
//   u    = firstDraw(seed)              // first mulberry32(seed) float in [0,1)
//   index = floor(u * count)            // 0 .. count-1
// The client reconstructs `index` from the revealed seed with the same math so
// the spin animation lands on the authoritative segment; the payout, however,
// always comes from the server's settle response.
//
// House edge lives ENTIRELY in the layout: every layout sums to 0.99 × count,
// so RTP = sum(layout)/count = 0.990 for every (count, risk) pair (well inside
// the [0.985, 0.995] band). Because the edge is baked into the segment values,
// ARCADE_RTP['arcade-prize-wheel'] is 1.0 — do NOT discount a second time.
//
//   Low risk    → no losing segments; a spread of small multipliers, low
//                 variance, a modest top prize.
//   Medium risk → ~55% losing (0×) segments, a graduated mid ladder, a bigger
//                 top prize.
//   High risk   → a pure jackpot wheel: one big top segment = 0.99 × count
//                 (49.5× on the 50-segment wheel) and every other segment 0×.
// ---------------------------------------------------------------------------

import { roundArcadePayout } from '../arcade-payout';
import { mulberry32 } from '../arcade-rng';

/** Allowed segment counts. */
export const WHEEL_SEGMENT_COUNTS = [10, 20, 30, 40, 50] as const;
export type WheelSegmentCount = (typeof WHEEL_SEGMENT_COUNTS)[number];

/** Allowed risk tiers. */
export const WHEEL_RISKS = ['low', 'medium', 'high'] as const;
export type WheelRisk = (typeof WHEEL_RISKS)[number];

/** Target RTP baked into every layout. sum(layout) = TARGET_RTP × count. */
export const WHEEL_TARGET_RTP = 0.99;

export type WheelConfig = {
  segments: WheelSegmentCount;
  risk: WheelRisk;
};

export type WheelResult = {
  segments: WheelSegmentCount;
  risk: WheelRisk;
  /** Winning segment index, 0 .. segments-1. */
  index: number;
  /** Multiplier on the winning segment (already includes the house edge). */
  multiplier: number;
  won: boolean;
};

// ---------------------------------------------------------------------------
// Layout construction
// ---------------------------------------------------------------------------

const round2 = (v: number): number => Math.round(v * 100) / 100;
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/** A designed winning band: `n` segments each paying `mult`×. */
type WheelTier = { mult: number; n: number };

/**
 * Designed winning segments per (count, risk) — clean numbers, integer counts.
 * These deliberately sum to just UNDER the 0.99×count budget; the generator
 * distributes the small remainder (see buildWheelLayout) so every wheel lands
 * on an exact 0.990 RTP with sensible-looking segments.
 */
function designWinners(count: number, risk: WheelRisk): WheelTier[] {
  const n = (frac: number) => Math.max(1, Math.round(count * frac));
  switch (risk) {
    case 'low': {
      // Modest top + a light spread of small wins; the bulk of the wheel is
      // filled with equal low "background" multipliers (see buildWheelLayout),
      // so there are NO 0× losses — low variance by design.
      const topByCount: Record<number, number> = { 10: 3, 20: 4, 30: 6, 40: 7, 50: 10 };
      return [
        { mult: topByCount[count]!, n: 1 },
        { mult: 2, n: n(0.05) },
        { mult: 1.5, n: n(0.1) },
        { mult: 1, n: n(0.2) },
      ];
    }
    case 'medium': {
      // A real top prize (always the headline) + a light graduated mid ladder;
      // every remaining segment is a 0× loss (~half the wheel). Mid counts use
      // plain rounding (no min-1 floor) so small wheels stay within budget and
      // the top is never overtaken. Layouts are designed to sum just UNDER the
      // budget; the small remainder becomes one consolation segment.
      const nz = (frac: number) => Math.round(count * frac); // may be 0 on small wheels
      const topByCount: Record<number, number> = { 10: 6, 20: 9, 30: 15, 40: 23, 50: 25 };
      return [
        { mult: topByCount[count]!, n: 1 },
        { mult: 5, n: nz(0.03) },
        { mult: 2, n: nz(0.06) },
        { mult: 1, n: nz(0.1) },
        { mult: 0.5, n: nz(0.14) },
      ];
    }
    case 'high': {
      // Pure jackpot: one top segment carries the entire budget (= 0.99×count,
      // i.e. 49.5× on the 50-segment wheel); every other segment is 0×.
      return [{ mult: round2(WHEEL_TARGET_RTP * count), n: 1 }];
    }
  }
}

/**
 * Build the exact multiplier layout for a (count, risk) wheel. Deterministic
 * and pure so the client and server compute byte-identical arrays.
 *
 * Invariant (asserted by the offline enumeration test): the returned array has
 * length `count` and sums to exactly 0.99 × count, so RTP = 0.990 ∈
 * [0.985, 0.995] for every pair.
 */
export function buildWheelLayout(count: number, risk: WheelRisk): number[] {
  const target = round2(WHEEL_TARGET_RTP * count);
  const winners = designWinners(count, risk);

  const arr: number[] = [];
  for (const t of winners) {
    for (let i = 0; i < t.n; i++) arr.push(t.mult);
  }
  const winSum = round2(sum(arr));
  const slotsLeft = count - arr.length;
  if (slotsLeft < 0) {
    throw new Error(`Prize-wheel layout overflow for ${count}/${risk}.`);
  }

  if (risk === 'low') {
    // Fill the remaining segments with equal small "background" multipliers so
    // the whole budget is spent as low-variance small wins (no 0× losses).
    if (slotsLeft > 0) {
      const per = Math.floor(((target - winSum) / slotsLeft) * 100) / 100;
      const base = Math.max(0, per);
      for (let i = 0; i < slotsLeft; i++) arr.push(base);
      // Absorb the sub-cent remainder on one background segment.
      const residual = round2(target - sum(arr));
      arr[arr.length - 1] = round2(arr[arr.length - 1]! + residual);
    } else {
      const residual = round2(target - sum(arr));
      arr[0] = round2(arr[0]! + residual);
    }
  } else {
    // Medium / high: every remaining segment is a 0× loss. The designed winners
    // sum to at most the budget; the small positive remainder becomes ONE
    // consolation segment (a trailing slot) so the top stays the headline. High
    // risk is a pure jackpot (winners already == budget → remainder 0 → all
    // remaining segments are 0×).
    const residual = round2(target - winSum);
    if (residual < 0) {
      throw new Error(`Prize-wheel budget overflow for ${count}/${risk}.`);
    }
    if (slotsLeft > 0 && residual > 0) {
      arr.push(residual);
      for (let i = 1; i < slotsLeft; i++) arr.push(0);
    } else {
      for (let i = 0; i < slotsLeft; i++) arr.push(0);
      if (residual > 0) arr[arr.length - 1] = round2(arr[arr.length - 1]! + residual);
    }
  }

  return arr;
}

/**
 * Precomputed layouts for every (count, risk) pair. Frozen so neither the
 * client nor the server can mutate a shared wheel. This is the single source
 * of truth both sides render and resolve against.
 */
export const WHEEL_LAYOUTS: Record<
  WheelSegmentCount,
  Record<WheelRisk, readonly number[]>
> = (() => {
  const out = {} as Record<WheelSegmentCount, Record<WheelRisk, readonly number[]>>;
  for (const count of WHEEL_SEGMENT_COUNTS) {
    const perRisk = {} as Record<WheelRisk, readonly number[]>;
    for (const risk of WHEEL_RISKS) {
      perRisk[risk] = Object.freeze(buildWheelLayout(count, risk));
    }
    out[count] = perRisk;
  }
  return out;
})();

/** Look up the (frozen) multiplier layout for a wheel. */
export function getWheelLayout(
  segments: WheelSegmentCount,
  risk: WheelRisk,
): readonly number[] {
  return WHEEL_LAYOUTS[segments][risk];
}

/** Highest multiplier on a given wheel (for UI previews / paytable). */
export function getWheelMaxMultiplier(
  segments: WheelSegmentCount,
  risk: WheelRisk,
): number {
  return Math.max(...getWheelLayout(segments, risk));
}

/** RTP (return-to-player) of a wheel — sum of segments / count. */
export function getWheelRtp(segments: WheelSegmentCount, risk: WheelRisk): number {
  return sum(getWheelLayout(segments, risk) as number[]) / segments;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isSegmentCount(v: unknown): v is WheelSegmentCount {
  return (WHEEL_SEGMENT_COUNTS as readonly number[]).includes(v as number);
}

function isRisk(v: unknown): v is WheelRisk {
  return (WHEEL_RISKS as readonly string[]).includes(v as string);
}

/** Validate a Prize Wheel configuration from the client. */
export function validateWheelConfig(config: unknown): WheelConfig | null {
  if (!config || typeof config !== 'object') return null;
  const c = config as Record<string, unknown>;
  if (!isSegmentCount(c.segments)) return null;
  if (!isRisk(c.risk)) return null;
  return { segments: c.segments, risk: c.risk };
}

// ---------------------------------------------------------------------------
// Resolve + payout
// ---------------------------------------------------------------------------

/**
 * Draw the winning segment index for a seed. Mirrors the client's firstDraw so
 * the spin animation lands on the same segment the server settles.
 */
export function resolveWheel(
  seed: number,
  segments: WheelSegmentCount,
  risk: WheelRisk,
): WheelResult {
  const rng = mulberry32(seed);
  const index = Math.floor(rng() * segments); // 0 .. segments-1
  const layout = getWheelLayout(segments, risk);
  const multiplier = layout[index] ?? 0;
  return {
    segments,
    risk,
    index,
    multiplier,
    won: multiplier > 0,
  };
}

/**
 * Integer Ticket payout for a settled wheel. The edge is already inside the
 * layout, so the payout multiplier is exactly layout[index] — no extra RTP
 * factor. Rounded once through the shared unbiased helper.
 */
export function computeWheelPayout(
  wager: number,
  result: WheelResult,
  seed: number,
): number {
  if (!result.won || result.multiplier <= 0) return 0;
  return roundArcadePayout(
    wager * result.multiplier,
    seed,
    `prize-wheel:${result.segments}:${result.risk}:${result.index}`,
  );
}
