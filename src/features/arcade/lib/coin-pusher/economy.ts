/* COIN PUSHER — what a coin costs and pays. Shared by the server, the client
   and the RTP verifier. Browser-safe: arcade-constants has no node imports.

   A coin is 5 tickets. A bet buys bet / 5 coins, so bets go in fives. Every
   coin that reaches the tray pays 5 × ARCADE_RTP tickets (4.85). The machine
   keeps the hundredths it owes and pays whole tickets, so the return is
   exact and nothing in the payout is random. */

import { ARCADE_MIN_BET, ARCADE_RTP } from '@/server/arcade/arcade-constants';

export const CP_GAME_TYPE = 'arcade-coin-pusher' as const;
export const CP_COIN_TICKETS = 5;
export const CP_RTP = ARCADE_RTP[CP_GAME_TYPE];
/** What one coin in the tray pays, in hundredths of a ticket. */
export const CP_COIN_PAY_HUNDREDTHS = Math.round(CP_COIN_TICKETS * CP_RTP * 100);
/** The most one drop can cost. A drop is real coins on a real table: 50 of
    them is what the chute holds and the physics steps at once (CP_MAX_POUR,
    CP_MAX_PENDING). That is a limit of the machine, not of the economy: the
    other machines take any bet up to the player's tickets. Drop again for more. */
export const CP_MAX_BET = 250;

/** Coins a bet buys, or null when the server would refuse the bet. */
export function cpCoinsForBet(bet: unknown): number | null {
  if (typeof bet !== 'number' || !Number.isInteger(bet)) return null;
  if (bet < ARCADE_MIN_BET || bet > CP_MAX_BET) return null;
  if (bet % CP_COIN_TICKETS !== 0) return null;
  return bet / CP_COIN_TICKETS;
}

/** The sentence for a bet the machine won't take. */
export const CP_BET_RULE = `Bets go in fives, from ${ARCADE_MIN_BET} to ${CP_MAX_BET} tickets.`;

/** Pay for `coins` coins in the tray, given the hundredths already owed.
    Returns whole tickets to pay now and the hundredths still owed. */
export function cpPayCoins(coins: number, carry: number): { tickets: number; carry: number } {
  const owed = carry + coins * CP_COIN_PAY_HUNDREDTHS;
  const tickets = Math.floor(owed / 100);
  return { tickets, carry: owed - tickets * 100 };
}
