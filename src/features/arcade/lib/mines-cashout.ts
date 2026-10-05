/* What a mines cash-out pays, for the readout, worked out with the server's
   own multiplier (arcade-constants.ts). The server turns the exact payout
   into whole tickets with roundArcadePayout: the whole part, plus one more
   ticket with a chance equal to the fraction, rolled from the round's seed.
   The seed stays secret until the round ends (it also places the mines), so
   before then a cash-out of 14.4 tickets pays 14 or 15 and the readout says
   both. scripts/verify-mines-readout.ts checks that every payout the server
   can make is one the readout showed. */

import { capRoundPayout, getMinesExactMultiplier, getMinesMultiplier } from '@/server/arcade/arcade-constants';

export type MinesCashout = {
  /** The multiplier the server reports for this many gems (two places, floored). */
  multiplier: number;
  /** The fewest tickets it can pay. */
  low: number;
  /** The most it can pay: `low`, or one more when the exact payout has a fraction. */
  high: number;
};

export function minesCashout(wager: number, gems: number, mineCount: number): MinesCashout {
  const multiplier = getMinesMultiplier(gems, mineCount);
  // The same expression computeMinesPayout rounds, so the float is the same.
  const exact = wager * getMinesExactMultiplier(gems, mineCount);
  if (!Number.isFinite(exact) || exact <= 0) return { multiplier, low: 0, high: 0 };
  const low = capRoundPayout(Math.floor(exact));
  // Held at the round's payout limit, the cash-out is exact.
  return { multiplier, low, high: exact - Math.floor(exact) > 0 ? capRoundPayout(low + 1) : low };
}

/** "14" or "14 or 15". */
export function cashoutText(cashout: Pick<MinesCashout, 'low' | 'high'>): string {
  return cashout.high > cashout.low
    ? `${cashout.low.toLocaleString()} or ${cashout.high.toLocaleString()}`
    : cashout.low.toLocaleString();
}
