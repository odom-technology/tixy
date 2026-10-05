// ---------------------------------------------------------------------------
// Arcade — Crash ("Rocket Launch") game logic
// ---------------------------------------------------------------------------

import { CRASH_GROWTH_RATE, CRASH_MAX_MULTIPLIER, ARCADE_RTP } from '../arcade-constants';
import { roundArcadePayout } from '../arcade-payout';
import { mulberry32 } from '../arcade-rng';

/**
 * A claimed client cashout target must line up closely with the real server
 * timeline. This allows normal client/server jitter without letting a client
 * wait until after the crash and then retroactively claim an earlier target.
 */
const CRASH_TARGET_TIME_GRACE_MS = 500;

/**
 * Determine the crash point from a seed.
 *
 * Formula (provably fair, 3% house edge):
 * - 3% chance of instant crash at 1.00x
 * - Otherwise: crashPoint = RTP / (1 - r), where r is uniform [0, 1)
 *
 * EV per unit wagered = RTP = 0.97
 */
export function getCrashPoint(seed: number): number {
  const rng = mulberry32(seed);
  const r = rng();

  // Instant crash (house edge floor)
  const rtp = ARCADE_RTP['arcade-crash'];
  if (r < 1 - rtp) return 1.0;

  // Inverse-CDF: maps uniform r to a crash point with correct EV
  const crash = rtp / (1 - r);

  // Round down to 2 decimal places, clamp to max
  return Math.min(CRASH_MAX_MULTIPLIER, Math.floor(crash * 100) / 100);
}

/**
 * Compute the multiplier at a given elapsed time (in milliseconds).
 * mult(t) = e^(CRASH_GROWTH_RATE * t/100)
 * where t is in ms, rate is per 100ms tick.
 */
export function getMultiplierAtTime(elapsedMs: number): number {
  const ticks = elapsedMs / 100;
  const mult = Math.exp(CRASH_GROWTH_RATE * ticks);
  return Math.min(CRASH_MAX_MULTIPLIER, Math.floor(mult * 100) / 100);
}

/**
 * Compute the time (in ms) at which a given multiplier is reached.
 * Inverse of getMultiplierAtTime: t = ln(mult) / rate * 100
 */
export function getTimeForMultiplier(multiplier: number): number {
  if (multiplier <= 1) return 0;
  return (Math.log(multiplier) / CRASH_GROWTH_RATE) * 100;
}

/**
 * Validate a cashout attempt.
 *
 * `clientTarget` is the multiplier the client locked in at the moment of
 * the cashout (the auto-cashout target, or the displayed multiplier when the
 * player tapped the manual button). The only valid cashout is one where the
 * claimed target fits inside the real crash point: if the player's local
 * animation ran past the real crash before their request reached us, they
 * missed it — no consolation payout.
 *
 * Anti-cheat: a fabricated `clientTarget` substantially above the server's
 * current multiplier is rejected as `too-high`. Without this check a
 * malicious client could simply send a huge number and always win.
 */
export function validateCashout(
  crashPoint: number,
  sessionStartedAt: number,
  cashoutAtMs: number,
  clientTarget?: number,
): { success: boolean; multiplier: number; reason?: 'too-late' | 'too-high' } {
  const elapsedMs = Math.max(0, cashoutAtMs - sessionStartedAt);
  const serverCurrentMult = getMultiplierAtTime(elapsedMs);
  const crashTimeMs = getTimeForMultiplier(crashPoint);

  // Client supplied an explicit target — the authoritative check is whether
  // the claimed target actually fits inside the real crash point.
  if (
    typeof clientTarget === 'number' &&
    Number.isFinite(clientTarget) &&
    clientTarget > 1
  ) {
    const normalizedTarget = Math.floor(clientTarget * 100) / 100;
    const targetTimeMs = getTimeForMultiplier(normalizedTarget);

    if (normalizedTarget > crashPoint) {
      return { success: false, multiplier: 0, reason: 'too-late' };
    }

    // The client can't legitimately claim a target far enough ahead of the
    // current server timeline that it hasn't been reached yet.
    if (targetTimeMs > elapsedMs + CRASH_TARGET_TIME_GRACE_MS) {
      return { success: false, multiplier: 0, reason: 'too-high' };
    }

    // Likewise, once we are well past the moment that target was on-screen,
    // the request arrived too late to honor.
    if (elapsedMs > targetTimeMs + CRASH_TARGET_TIME_GRACE_MS) {
      return { success: false, multiplier: 0, reason: 'too-late' };
    }

    // 10% upward grace over server-current tolerates ~150ms of legitimate
    // clock drift + network jitter. Anything higher is fabricated.
    if (normalizedTarget > serverCurrentMult * 1.10) {
      return { success: false, multiplier: 0, reason: 'too-high' };
    }
    return { success: true, multiplier: Math.max(1, normalizedTarget) };
  }

  // Legacy callers that don't supply a target fall back to server-time.
  // No grace: if elapsed has passed the crash time, the round is over.
  if (elapsedMs > crashTimeMs) {
    return { success: false, multiplier: 0, reason: 'too-late' };
  }
  const cashoutMult = Math.max(1, Math.min(serverCurrentMult, crashPoint));
  return { success: true, multiplier: cashoutMult };
}

/** Compute crash payout amount. */
export function computeCrashPayout(
  wager: number,
  multiplier: number,
  seed: number,
): number {
  if (multiplier <= 0) return 0;
  return roundArcadePayout(wager * multiplier, seed, `crash:${multiplier.toFixed(2)}`);
}
