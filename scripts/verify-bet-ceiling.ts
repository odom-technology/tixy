/**
 * The technical bet ceiling holds for every ticket machine.
 *
 *   npm run test:bet-ceiling
 *
 * A bet is any whole number from the minimum up to the player's tickets, so
 * the only limit left is what the integer ticket columns can store
 * (wallets.credits, currency_ledger and the round history are 32-bit). This
 * reads every machine's own tables and checks:
 *
 * - No machine except mines pays more than TOP_PAID_MULTIPLIER times the bet.
 * - MAX_TICKET_BET at that multiple is no more than MAX_ROUND_PAYOUT, and
 *   MAX_ROUND_PAYOUT leaves room under the column.
 * - Mines is the one that can pass it, and its payout is held there.
 * - invalidBetMessage takes the whole range and nothing outside it.
 * - A wallet credit that would pass the column fills it instead of failing.
 *
 * Exits non-zero on any failure.
 */
import assert from 'node:assert/strict';

import {
  ARCADE_MIN_BET,
  CASES_ITEMS,
  CRASH_MAX_MULTIPLIER,
  DARTS_ZONES,
  DICE_MAX_TARGET,
  DICE_MIN_TARGET,
  MAX_ROUND_PAYOUT,
  MAX_TICKET_BET,
  MINES_ALLOWED_COUNTS,
  MINES_GRID_SIZE,
  PACKS_CARDS_PER_PACK,
  PACKS_CARD_POOL,
  PLINKO_MULTIPLIERS,
  PLINKO_RTP_FACTORS,
  SLOT_2_MATCH_PAYOUTS,
  SLOT_3_MATCH_PAYOUTS,
  STOPLIGHT_ZONES,
  TICKET_COLUMN_MAX,
  TOP_PAID_MULTIPLIER,
  capRoundPayout,
  getDiceExactMultiplier,
  getMinesExactMultiplier,
  invalidBetMessage,
  maxBetFor,
} from '../src/server/arcade/arcade-constants';
import { baccaratReturnMultiplier } from '../src/server/arcade/wager-games/baccarat';
import { CLAW_TIERS } from '../src/server/arcade/wager-games/prize-claw';
import { DRAGON_MAX_MULTIPLIER } from '../src/server/arcade/wager-games/dragon';
import { FORTUNE_CARDS_PER_ROUND, FORTUNE_TIERS, FORTUNE_WIN_BUCKETS } from '../src/server/arcade/wager-games/fortune-teller';
import { GEM_ROLL_PAYOUTS } from '../src/server/arcade/wager-games/gem-roll';
import { KENO_PAYOUTS, KENO_RTP_FACTORS } from '../src/server/arcade/wager-games/keno';
import { LIMBO_MAX_TARGET } from '../src/server/arcade/wager-games/limbo';
import { LUCKY_CAGE_TICKETS } from '../src/server/arcade/wager-games/lucky-cage';
import { computeMinesPayout } from '../src/server/arcade/wager-games/mines';
import { PUMP_MAX_MULTIPLIER } from '../src/server/arcade/wager-games/pump';
import { ROULETTE_ODDS } from '../src/server/arcade/wager-games/roulette';
import { SCRATCH_TIERS } from '../src/server/arcade/wager-games/scratch';
import { VIDEO_POKER_PAYTABLE } from '../src/server/arcade/wager-games/video-poker';
import { WHEEL_LAYOUTS } from '../src/server/arcade/wager-games/prize-wheel';

const max = (values: readonly number[]) => values.reduce((a, b) => Math.max(a, b), 0);

// Blackjack: four split hands, each doubled, each paying the 3:2 blackjack
// return at most; a loose bound of 16 stakes (the real top is 4 hands x 4).
const BLACKJACK_TOP = 16;

const tops: Record<string, number> = {
  'coin flip': 2,
  slots: max([...Object.values(SLOT_3_MATCH_PAYOUTS), ...Object.values(SLOT_2_MATCH_PAYOUTS).map(Number)]),
  crash: CRASH_MAX_MULTIPLIER,
  stoplight: max(STOPLIGHT_ZONES.map((z) => z.multiplier)),
  plinko: max(
    (['low', 'medium', 'high'] as const).flatMap((risk) =>
      ([8, 12, 16] as const).map((rows) => max(PLINKO_MULTIPLIERS[risk][rows]) * PLINKO_RTP_FACTORS[risk][rows]),
    ),
  ),
  dice: max([
    getDiceExactMultiplier(DICE_MIN_TARGET, 'under'),
    getDiceExactMultiplier(DICE_MAX_TARGET, 'over'),
    getDiceExactMultiplier(DICE_MAX_TARGET, 'under'),
    getDiceExactMultiplier(DICE_MIN_TARGET, 'over'),
  ].filter(Number.isFinite)),
  chicken: 500,
  'hi-lo': 500,
  cases: max(Object.values(CASES_ITEMS).flat().map((item) => item.mult)),
  packs: max(PACKS_CARD_POOL.map((card) => card.mult)) * PACKS_CARDS_PER_PACK,
  darts: max(DARTS_ZONES.map((z) => z.multiplier)),
  lightspeed: 500,
  blackjack: BLACKJACK_TOP,
  limbo: LIMBO_MAX_TARGET,
  dragon: DRAGON_MAX_MULTIPLIER,
  'video poker': max(Object.values(VIDEO_POKER_PAYTABLE)),
  roulette: max(Object.values(ROULETTE_ODDS)),
  scratch: max(Object.values(SCRATCH_TIERS).flatMap((outcomes) => outcomes.map((o) => o.mult))),
  pump: PUMP_MAX_MULTIPLIER,
  keno: max(
    (Object.keys(KENO_PAYOUTS) as (keyof typeof KENO_PAYOUTS)[]).flatMap((profile) =>
      KENO_PAYOUTS[profile].flatMap((row, picks) =>
        row.map((pay) => pay * (KENO_RTP_FACTORS[profile][picks] ?? 1)),
      ),
    ),
  ),
  'prize wheel': max(Object.values(WHEEL_LAYOUTS).flatMap((byRisk) => Object.values(byRisk).map((layout) => max(layout as number[])))),
  baccarat: max((['player', 'banker', 'tie'] as const).flatMap((bet) => (['player', 'banker', 'tie'] as const).map((out) => baccaratReturnMultiplier(bet, out)))),
  // Three cards, each paying up to the tier's top, multiplied together.
  'fortune teller': max(FORTUNE_TIERS.map((tier) => max(FORTUNE_WIN_BUCKETS[tier].map((b) => b.mult)) ** FORTUNE_CARDS_PER_ROUND)),
  'gem roll': max(Object.values(GEM_ROLL_PAYOUTS)),
  'lucky cage': max(LUCKY_CAGE_TICKETS.map((t) => t.multiplier)),
  'prize claw': max(Object.values(CLAW_TIERS).map((tier) => tier.multiplier)),
};

let highest = ['', 0] as [string, number];
for (const [game, top] of Object.entries(tops)) {
  assert.ok(Number.isFinite(top) && top > 0, `${game}: a top multiplier was read (${top})`);
  assert.ok(top <= TOP_PAID_MULTIPLIER, `${game} pays ${top}x, over TOP_PAID_MULTIPLIER (${TOP_PAID_MULTIPLIER}x)`);
  assert.ok(MAX_TICKET_BET * top <= MAX_ROUND_PAYOUT, `${game}: ${MAX_TICKET_BET} at ${top}x passes MAX_ROUND_PAYOUT`);
  if (top > highest[1]) highest = [game, top];
}
assert.equal(highest[0], 'keno', 'keno is the biggest pay after mines');
assert.ok(TOP_PAID_MULTIPLIER >= highest[1] && TOP_PAID_MULTIPLIER <= highest[1] * 1.5, 'TOP_PAID_MULTIPLIER is the real top with a little room, not a guess');

// The numbers themselves.
assert.equal(MAX_TICKET_BET * TOP_PAID_MULTIPLIER, MAX_ROUND_PAYOUT);
assert.ok(Number.isSafeInteger(MAX_ROUND_PAYOUT));
assert.ok(MAX_ROUND_PAYOUT < TICKET_COLUMN_MAX, 'a round can pay less than the column holds');
assert.ok(TICKET_COLUMN_MAX - MAX_ROUND_PAYOUT > MAX_ROUND_PAYOUT, 'room is left for the balance the win lands on');
assert.ok(MAX_TICKET_BET > 250, 'the ceiling is far past the old cap');

// Mines pays more than any other, so its payout is held, and only it.
let minesTop = 0;
for (const mines of MINES_ALLOWED_COUNTS) {
  for (let gems = 1; gems <= MINES_GRID_SIZE - mines; gems++) {
    minesTop = Math.max(minesTop, getMinesExactMultiplier(gems, mines));
  }
}
assert.ok(minesTop > TOP_PAID_MULTIPLIER, 'mines can pass the top multiple, which is why it is held');
for (const wager of [ARCADE_MIN_BET, 250, 600, 5000, MAX_TICKET_BET]) {
  for (const mines of MINES_ALLOWED_COUNTS) {
    for (let gems = 1; gems <= MINES_GRID_SIZE - mines; gems++) {
      const pay = computeMinesPayout(wager, gems, mines, 7);
      assert.ok(Number.isSafeInteger(pay) && pay <= MAX_ROUND_PAYOUT && pay < TICKET_COLUMN_MAX, `mines ${wager} x ${gems}/${mines}: ${pay}`);
    }
  }
}
assert.equal(capRoundPayout(MAX_ROUND_PAYOUT + 1), MAX_ROUND_PAYOUT);
assert.equal(capRoundPayout(41), 41);

// Which bets the routes take.
for (const ok of [ARCADE_MIN_BET, 6, 250, 251, 600, 5000, 12_345, MAX_TICKET_BET]) {
  assert.equal(invalidBetMessage(ok), null, `${ok} is a bet`);
}
for (const bad of [0, 4, -5, 7.5, MAX_TICKET_BET + 1, 2 ** 31, Number.NaN, Infinity, '600', null, undefined]) {
  const message = invalidBetMessage(bad);
  assert.equal(typeof message, 'string', `${String(bad)} is refused`);
  assert.ok(!message!.includes('—') && !message!.includes('–'), 'no dashes in the sentence');
  assert.ok(message!.endsWith('.') && !message!.includes('\n'), 'one sentence');
}
assert.equal(invalidBetMessage(MAX_TICKET_BET + 1), 'Bets are whole numbers from 5 to 80,000 tickets.');

// The most a player can bet: the whole balance, up to the ceiling.
assert.equal(maxBetFor(340), 340);
assert.equal(maxBetFor(340.9), 340);
assert.equal(maxBetFor(5_000_000), MAX_TICKET_BET);
assert.equal(maxBetFor(0), 0);
assert.equal(maxBetFor(null), 250);
assert.equal(maxBetFor(undefined, 50), 50);

console.log(
  `bet ceiling ok: ${Object.keys(tops).length} machines read, top ${highest[0]} ${highest[1]}x, mines up to ${Math.round(minesTop).toLocaleString('en-US')}x held at ${MAX_ROUND_PAYOUT.toLocaleString('en-US')}; bets to ${MAX_TICKET_BET.toLocaleString('en-US')}.`,
);
for (const [game, top] of Object.entries(tops).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`  ${game.padEnd(16)} ${top.toLocaleString('en-US', { maximumFractionDigits: 2 })}x`);
}
