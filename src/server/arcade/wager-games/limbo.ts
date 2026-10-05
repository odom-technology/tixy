// ---------------------------------------------------------------------------
// tixy — Limbo game logic
//
// Single-action settle-only game. The player picks a target multiplier M; the
// server rolls a crash-point R from the session seed. WIN iff R >= M, paying
// M × stake; otherwise 0.
//
// House edge (~1%) is baked entirely into R's distribution — do NOT apply
// ARCADE_RTP a second time in the payout. The crash-point uses the classic
// inverse-CDF form:
//
//   u32 = floor(rng() * 2^32)            // rng() from mulberry32(seed)
//   R   = max(1.00, floor(0.99 * 2^32 / (u32 + 1) * 100) / 100)   // 2dp
//
// P(R >= M) ≈ 0.99 / M, so EV(M·stake) ≈ 0.99·stake → 1% edge regardless of M.
// ---------------------------------------------------------------------------

import { roundArcadePayout } from '../arcade-payout';
import { mulberry32 } from '../arcade-rng';

/** Lowest target the player may pick. 1.01 keeps a real (if tiny) house edge. */
export const LIMBO_MIN_TARGET = 1.01;
/** Highest target the player may pick — bounds the worst-case bankroll hit. */
export const LIMBO_MAX_TARGET = 1000;

/** Local 2dp floor (arcade-constants keeps its own copy private). */
function floorToTwoDecimals(value: number): number {
  return Math.floor(value * 100) / 100;
}

/** Round a raw target to the 2dp grid the validator/resolver operate on. */
function normalizeTarget(target: number): number {
  return floorToTwoDecimals(target);
}

export type LimboConfig = {
  /** Chosen target multiplier, 1.01 ≤ target ≤ 1000, 2dp. */
  target: number;
};

export type LimboResult = {
  /** The rolled crash-point (2dp, ≥ 1.00). */
  roll: number;
  /** The player's chosen target multiplier. */
  target: number;
  won: boolean;
  /** Payout multiplier shown to the player: target on a win, 0 on a loss. */
  multiplier: number;
};

/**
 * Validate Limbo configuration from the client.
 * Rejects anything outside [1.01, 1000] or finer than 2 decimal places.
 */
export function validateLimboConfig(config: unknown): LimboConfig | null {
  if (!config || typeof config !== 'object') return null;
  const c = config as Record<string, unknown>;

  const target = c.target;
  if (
    typeof target !== 'number' ||
    !Number.isFinite(target) ||
    target < LIMBO_MIN_TARGET ||
    target > LIMBO_MAX_TARGET
  ) {
    return null;
  }

  // Enforce 2dp precision — reject hostile sub-cent targets that could be used
  // to probe the rounding. floorToTwoDecimals must be a no-op on a valid input.
  if (floorToTwoDecimals(target) !== target) return null;

  return { target };
}

/**
 * Roll the crash-point R for a session seed. Deterministic and reproducible
 * after the seed is revealed. House edge (1%) lives entirely in this curve.
 */
export function rollLimboCrashPoint(seed: number): number {
  const rng = mulberry32(seed);
  const u32 = Math.floor(rng() * 2 ** 32);
  const raw = (0.99 * 2 ** 32) / (u32 + 1);
  return Math.max(1.0, Math.floor(raw * 100) / 100);
}

/**
 * Resolve the Limbo outcome from a seed + the player's target.
 * WIN iff the rolled crash-point reaches or exceeds the target.
 */
export function resolveLimbo(seed: number, target: number): LimboResult {
  const normalizedTarget = normalizeTarget(target);
  const roll = rollLimboCrashPoint(seed);
  const won = roll >= normalizedTarget;
  return {
    roll,
    target: normalizedTarget,
    won,
    multiplier: won ? normalizedTarget : 0,
  };
}

/**
 * Compute the integer Ticket payout. The edge is already in R, so the payout
 * multiplier is exactly the player's target — no extra RTP factor here.
 */
export function computeLimboPayout(
  wager: number,
  result: LimboResult,
  seed: number,
): number {
  if (!result.won || result.multiplier <= 0) return 0;
  return roundArcadePayout(
    wager * result.target,
    seed,
    `limbo:${result.target}`,
  );
}
