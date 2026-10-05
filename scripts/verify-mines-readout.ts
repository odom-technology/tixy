/**
 * The mines readout tells the truth about the cash-out.
 *
 *   npx tsx scripts/verify-mines-readout.ts
 *
 * For every bet from ARCADE_MIN_BET to 250 (a sweep, not a limit), every mine count the server
 * allows and every number of gems, the server's payout (computeMinesPayout,
 * run over a spread of seeds) must be one of the numbers the readout shows
 * (minesCashout: low, or low and high), and the readout's multiplier must be
 * the one the server reports (getMinesMultiplier). When the readout shows a
 * single number, every seed must pay exactly that.
 *
 * The server rounds a fractional payout up with a chance equal to the
 * fraction, rolled from the round's seed, and the seed is secret until the
 * round ends. So before a cash-out the client can't know which of the two
 * whole numbers it gets; it shows both.
 *
 * Exits non-zero on any failure.
 */

import {
  ARCADE_MIN_BET,
  MAX_ROUND_PAYOUT,
  MAX_TICKET_BET,
  MINES_ALLOWED_COUNTS,
  MINES_GRID_SIZE,
  getMinesMultiplier,
} from '../src/server/arcade/arcade-constants';
import { computeMinesPayout } from '../src/server/arcade/wager-games/mines';
import { cashoutText, minesCashout } from '../src/features/arcade/lib/mines-cashout';

const SEEDS = Array.from({ length: 24 }, (_, i) => (i * 2654435761 + 12345) >>> 0);

let checked = 0;
let splits = 0;
const failures: string[] = [];
const fail = (message: string) => {
  if (failures.length < 20) failures.push(message);
  else if (failures.length === 20) failures.push('…more failures');
};

const SWEEP_MAX_BET = 250;
for (let wager = ARCADE_MIN_BET; wager <= SWEEP_MAX_BET; wager++) {
  for (const mineCount of MINES_ALLOWED_COUNTS) {
    const safe = MINES_GRID_SIZE - mineCount;
    for (let gems = 1; gems <= safe; gems++) {
      const readout = minesCashout(wager, gems, mineCount);
      if (readout.multiplier !== getMinesMultiplier(gems, mineCount)) {
        fail(`multiplier: bet ${wager}, ${mineCount} mines, ${gems} gems shows ${readout.multiplier}`);
      }
      if (readout.high !== readout.low && readout.high !== readout.low + 1) {
        fail(`range: bet ${wager}, ${mineCount} mines, ${gems} gems shows ${cashoutText(readout)}`);
      }
      const seen = new Set<number>();
      for (const seed of SEEDS) {
        const payout = computeMinesPayout(wager, gems, mineCount, seed);
        seen.add(payout);
        checked++;
        if (payout !== readout.low && payout !== readout.high) {
          fail(`payout: bet ${wager}, ${mineCount} mines, ${gems} gems, seed ${seed} pays ${payout}, readout ${cashoutText(readout)}`);
        }
      }
      if (readout.high > readout.low) splits++;
      // A single number is exact: every seed must pay it.
      if (readout.high === readout.low && (seen.size !== 1 || !seen.has(readout.low))) {
        fail(`exact: bet ${wager}, ${mineCount} mines, ${gems} gems shows ${readout.low}, paid ${[...seen].join(', ')}`);
      }
    }
  }
}

// Big bets, up to the technical ceiling: the readout still matches what the
// server pays, and no round pays past MAX_ROUND_PAYOUT (a 10-gem clear with 15
// mines pays 3.17 million times the bet, over what the ticket columns hold).
let clamped = 0;
for (const wager of [600, 1000, 5000, 77_777, 12_345, MAX_TICKET_BET]) {
  for (const mineCount of MINES_ALLOWED_COUNTS) {
    const safe = MINES_GRID_SIZE - mineCount;
    for (let gems = 1; gems <= safe; gems++) {
      const readout = minesCashout(wager, gems, mineCount);
      if (readout.high > MAX_ROUND_PAYOUT) fail(`ceiling: bet ${wager}, ${mineCount} mines, ${gems} gems shows ${readout.high}`);
      for (const seed of SEEDS) {
        const payout = computeMinesPayout(wager, gems, mineCount, seed);
        checked++;
        if (payout > MAX_ROUND_PAYOUT) fail(`ceiling: bet ${wager}, ${mineCount} mines, ${gems} gems pays ${payout}`);
        if (payout !== readout.low && payout !== readout.high) {
          fail(`big bet: bet ${wager}, ${mineCount} mines, ${gems} gems, seed ${seed} pays ${payout}, readout ${cashoutText(readout)}`);
        }
      }
      if (readout.low === MAX_ROUND_PAYOUT) clamped++;
    }
  }
}
if (clamped === 0) fail('no big bet reached the payout ceiling; the check is not testing it');

// No gems: nothing to cash out, and the server pays nothing.
for (const mineCount of MINES_ALLOWED_COUNTS) {
  const readout = minesCashout(10, 0, mineCount);
  if (readout.low !== 0 || readout.high !== 0 || computeMinesPayout(10, 0, mineCount, 1) !== 0) {
    fail(`zero gems with ${mineCount} mines`);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  console.error(`\nMINES READOUT CHECK FAILED (${checked} payouts checked).`);
  process.exit(1);
}
console.log(
  `${checked} payouts checked: bets ${ARCADE_MIN_BET} to ${SWEEP_MAX_BET}, mine counts ${MINES_ALLOWED_COUNTS.join(', ')}, every gem count, ${SEEDS.length} seeds each; ${splits} cash-outs show two numbers; ${clamped} big-bet cash-outs held at ${MAX_ROUND_PAYOUT.toLocaleString('en-US')}.`,
);
console.log('THE MINES READOUT MATCHES EVERY PAYOUT.');
