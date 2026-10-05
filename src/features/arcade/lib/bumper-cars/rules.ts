/* Bumper cars scoring and tickets. Pure; the server settles with these and
   the verifier prints the table. */

/** A round's score: points from bumps, plus a little for the podium when
 *  there were at least four cars. Ties share a place and its bonus. */
export const PLACE_BONUS: readonly number[] = [0, 4, 2, 1];

export function roundScore(points: number, place: number, cars: number): number {
  const bonus = cars >= 4 ? PLACE_BONUS[place] ?? 0 : 0;
  return Math.max(0, points) + (points > 0 ? bonus : 0);
}

/** Tickets: 75 × (1 − exp(−(s/k)^p)), inside the 75 per-run cap, and nothing
 *  for a round without a bump. scripts/verify-bumper-cars.ts prints the table
 *  and fails if it drifts. */
export const BUMPER_REWARD_CAP = 75;
export const BUMPER_REWARD_K = 37;
export const BUMPER_REWARD_P = 1.1;

export function bumperCarsTickets(score: number): number {
  const s = Math.max(0, Math.min(200, Math.floor(score)));
  if (s <= 0) return 0;
  const curve = BUMPER_REWARD_CAP * (1 - Math.exp(-Math.pow(s / BUMPER_REWARD_K, BUMPER_REWARD_P)));
  return Math.max(1, Math.min(BUMPER_REWARD_CAP, Math.round(curve)));
}
