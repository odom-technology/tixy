/* The stub presets on a machine's bet row. They scale with the player's
   tickets: about 1%, 2.5%, 5% and 10% of the balance, each snapped to a
   clean step, so 1,000 tickets show bigger stubs than 100. Guests and an
   unknown balance get the fixed set. The custom amount is always there, so
   these only have to be sensible, not complete. Any whole bet from the
   game's minimum up to the player's tickets is valid on the server (to
   MAX_TICKET_BET, a technical ceiling). */

import { ARCADE_MIN_BET, MAX_TICKET_BET } from '@/server/arcade/arcade-constants';

/** The fixed set: guests, an unknown balance, and the floor for small ones. */
export const FIXED_BET_PRESETS: readonly number[] = [5, 10, 25, 50];

/** Each preset's share of the balance, smallest first. */
const BALANCE_SHARES = [0.01, 0.025, 0.05, 0.1] as const;

/** The steps a preset can land on, clean numbers all the way to the ceiling. */
const BET_STEPS: readonly number[] = [
  5, 10, 25, 50, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 2500, 5000, 7500, 10_000, 15_000, 25_000,
  50_000, 75_000,
];

/** The bet presets for a balance: up to four whole bets, increasing, each
 *  from `min` to `max` (MAX_TICKET_BET unless the game's own ceiling is
 *  lower). Fewer than four only when fewer steps fit. */
export function betPresets(
  balance: number | null,
  min: number = ARCADE_MIN_BET,
  max: number = MAX_TICKET_BET,
): readonly number[] {
  const steps = BET_STEPS.filter((step) => step >= min && step <= max);
  const fixed = FIXED_BET_PRESETS.filter((step) => step >= min && step <= max);
  if (balance == null || !Number.isFinite(balance) || balance <= 0 || steps.length <= BALANCE_SHARES.length) {
    return fixed.length > 0 ? fixed : steps;
  }

  const last = steps.length - 1;
  const index = BALANCE_SHARES.map((share, position) => {
    // Never under the fixed set's matching stub, so a small balance still
    // gets 5, 10, 25 and 50.
    const target = Math.max(balance * share, FIXED_BET_PRESETS[position]);
    let nearest = 0;
    for (let i = 1; i <= last; i++) {
      if (Math.abs(steps[i] - target) < Math.abs(steps[nearest] - target)) nearest = i;
    }
    return nearest;
  });
  // Strictly increasing, then pulled back under the top step.
  for (let i = 1; i < index.length; i++) index[i] = Math.max(index[i], index[i - 1] + 1);
  for (let i = index.length - 1; i >= 0; i--) index[i] = Math.min(index[i], last - (index.length - 1 - i));
  return index.map((i) => steps[i]);
}

/** The stubs a bet row shows: the presets plus the player's own bet when it
 *  isn't one of them (and is a bet the game takes), smallest first, so a
 *  custom 10 sits between 5 and 25 instead of trailing the row. */
export function betRowStubs(
  presets: readonly number[],
  bet: number | null | undefined,
  min: number = ARCADE_MIN_BET,
  max: number = MAX_TICKET_BET,
): readonly number[] {
  if (bet == null || !Number.isFinite(bet) || bet < min || bet > max || presets.includes(bet)) {
    return presets;
  }
  return [...presets, bet].sort((a, b) => a - b);
}
