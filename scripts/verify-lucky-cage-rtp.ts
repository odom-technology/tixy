/**
 * Offline fairness/RTP verification gate for Lucky Cage.
 *
 *   npx tsx scripts/verify-lucky-cage-rtp.ts
 *
 * Four independent layers, all of which must agree:
 *
 *   1. CLOSED FORM   — each ticket's stated numerator/denominator matches an
 *                      independently re-derived binomial expression, and
 *                      multiplier x probability === ARCADE_RTP exactly.
 *   2. EXHAUSTIVE    — enumerate all C(20,5) = 15,504 unordered draws (and all
 *                      77,520 (draw, head-position) pairs) and count, by brute
 *                      force, how many each of the 51 tickets wins. The counts
 *                      must equal the closed-form numerators, and the
 *                      exhaustive RTP of every ticket must be 0.99.
 *   3. MONTE CARLO   — a large deterministic sweep of real session seeds
 *                      through drawLuckyCage(), checking draw legality,
 *                      per-ball / per-position uniformity, and empirical RTP.
 *   4. PAYOUT        — computeLuckyCagePayout() against resolveLuckyCage() over
 *                      the same sweep: no payout on a loss, exact multiplier
 *                      (+/- the one-ticket unbiased rounding) on a win, and an
 *                      aggregate ticket-level RTP inside tolerance.
 *
 * Exits non-zero on any failed assertion.
 */
import {
  LUCKY_CAGE_BALL_COUNT,
  LUCKY_CAGE_COMBINATIONS,
  LUCKY_CAGE_DRAW_COUNT,
  LUCKY_CAGE_HIGH_THRESHOLD,
  LUCKY_CAGE_ORDERED_HEAD_SPACE,
  LUCKY_CAGE_RACK_COUNT,
  LUCKY_CAGE_RACK_SIZE,
  LUCKY_CAGE_RACK_THRESHOLD,
  LUCKY_CAGE_RTP,
  LUCKY_CAGE_TICKETS,
  LUCKY_CAGE_TICKET_COUNT,
  computeLuckyCagePayout,
  drawLuckyCage,
  getLuckyCageTicket,
  luckyCageBinomial,
  luckyCageHighCount,
  luckyCageRackOf,
  luckyCageTicketWins,
  resolveLuckyCage,
  type LuckyCageTicket,
} from '@/server/arcade/wager-games/lucky-cage';
import { ARCADE_RTP } from '@/server/arcade/arcade-constants';

/* ── assertion plumbing ─────────────────────────────────────────────── */

const MAX_FAILURES_PRINTED = 60;
const failures: string[] = [];
let suppressedFailures = 0;

function fail(msg: string): void {
  if (failures.length < MAX_FAILURES_PRINTED) failures.push(msg);
  else suppressedFailures += 1;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) fail(msg);
}

function pct(v: number): string {
  return `${(v * 100).toFixed(4)}%`;
}

/* ── tuning ─────────────────────────────────────────────────────────── */

const MONTE_CARLO_ROUNDS = 400_000;
const SEED_ORIGIN = 1_234_567;
/** Session seeds are crypto.randomInt(0, 2**31). */
const SEED_SPACE = 2 ** 31;

/**
 * Deterministic seed stream so a failure is always reproducible, but scrambled
 * (splitmix32 finalizer) so consecutive samples look like independent
 * crypto.randomInt seeds rather than an arithmetic ladder — a strided stream
 * could otherwise flatter or defame a PRNG for structural reasons.
 */
function seedAt(index: number): number {
  let z = (index + SEED_ORIGIN) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  z = z ^ (z >>> 15);
  return (z >>> 0) % SEED_SPACE;
}

/** Ticket-level empirical RTP tolerance (widened for longshot variance). */
const RTP_SIGMA_TOLERANCE = 5;
const RTP_ABS_TOLERANCE = 0.02;
/** Per-ball / per-chute-position uniformity tolerance, in relative terms. */
const UNIFORMITY_TOLERANCE = 0.03;

const PAYOUT_WAGER = 10_000;

console.log('Lucky Cage RTP/fairness verification');
console.log(`  tickets: ${LUCKY_CAGE_TICKET_COUNT}`);
console.log(`  combinations: C(20,5) = ${LUCKY_CAGE_COMBINATIONS.toLocaleString()}`);
console.log(`  monte-carlo rounds: ${MONTE_CARLO_ROUNDS.toLocaleString()}`);
console.log('');

/* ══════════════════════════════════════════════════════════════════════
   0. Shape
   ══════════════════════════════════════════════════════════════════════ */

assert(
  LUCKY_CAGE_TICKET_COUNT === 51,
  `ticket count ${LUCKY_CAGE_TICKET_COUNT}, expected 51`,
);
assert(
  LUCKY_CAGE_COMBINATIONS === luckyCageBinomial(20, 5),
  `LUCKY_CAGE_COMBINATIONS ${LUCKY_CAGE_COMBINATIONS} != C(20,5) ${luckyCageBinomial(20, 5)}`,
);
assert(
  LUCKY_CAGE_COMBINATIONS === 15_504,
  `C(20,5) computed as ${LUCKY_CAGE_COMBINATIONS}, expected 15504`,
);
assert(
  LUCKY_CAGE_ORDERED_HEAD_SPACE === 77_520,
  `head sample space ${LUCKY_CAGE_ORDERED_HEAD_SPACE}, expected 77520`,
);
assert(
  LUCKY_CAGE_RTP === ARCADE_RTP['arcade-lucky-cage'] && LUCKY_CAGE_RTP === 0.99,
  `LUCKY_CAGE_RTP ${LUCKY_CAGE_RTP}, expected 0.99 and equal to ARCADE_RTP entry`,
);

{
  const ids = new Set(LUCKY_CAGE_TICKETS.map((t) => t.id));
  assert(
    ids.size === LUCKY_CAGE_TICKET_COUNT,
    `duplicate ticket ids: ${LUCKY_CAGE_TICKET_COUNT - ids.size}`,
  );
  const byFamily: Record<string, number> = {};
  for (const t of LUCKY_CAGE_TICKETS) {
    byFamily[t.family] = (byFamily[t.family] ?? 0) + 1;
  }
  assert(byFamily.ball === 20, `ball family has ${byFamily.ball}, expected 20`);
  assert(byFamily.head === 20, `head family has ${byFamily.head}, expected 20`);
  assert(byFamily.rack === 5, `rack family has ${byFamily.rack}, expected 5`);
  assert(byFamily.tier === 6, `tier family has ${byFamily.tier}, expected 6`);
  for (const t of LUCKY_CAGE_TICKETS) {
    assert(
      getLuckyCageTicket(t.id) === t,
      `getLuckyCageTicket('${t.id}') did not round-trip`,
    );
  }
  assert(
    getLuckyCageTicket('ball:0') === null &&
      getLuckyCageTicket('ball:21') === null &&
      getLuckyCageTicket('tier:6') === null &&
      getLuckyCageTicket('rack:5') === null &&
      getLuckyCageTicket('nope') === null,
    'out-of-range ticket ids must resolve to null',
  );
}

/* ══════════════════════════════════════════════════════════════════════
   1. Closed form — probabilities and multipliers
   ══════════════════════════════════════════════════════════════════════ */

/** Independently re-derived exact rational for a ticket. */
function expectedOdds(ticket: LuckyCageTicket): { num: number; den: number } {
  switch (ticket.family) {
    // P(ball N drawn) = C(19,4)/C(20,5) = 3876/15504 = 1/4
    case 'ball':
      return { num: luckyCageBinomial(19, 4), den: luckyCageBinomial(20, 5) };
    // P(ball N is head) = P(N drawn) x 1/5 = 3876/77520 = 1/20
    case 'head':
      return {
        num: luckyCageBinomial(19, 4),
        den: luckyCageBinomial(20, 5) * 5,
      };
    // P(>=3 of 5 from a rack of 4) = [C(4,3)C(16,2) + C(4,4)C(16,1)]/C(20,5)
    case 'rack':
      return {
        num:
          luckyCageBinomial(4, 3) * luckyCageBinomial(16, 2) +
          luckyCageBinomial(4, 4) * luckyCageBinomial(16, 1),
        den: luckyCageBinomial(20, 5),
      };
    // P(exactly k high) = C(10,k)C(10,5-k)/C(20,5)
    case 'tier':
      return {
        num:
          luckyCageBinomial(10, ticket.value) *
          luckyCageBinomial(10, 5 - ticket.value),
        den: luckyCageBinomial(20, 5),
      };
    default:
      return { num: 0, den: 1 };
  }
}

for (const ticket of LUCKY_CAGE_TICKETS) {
  const exp = expectedOdds(ticket);
  assert(
    ticket.odds.num === exp.num && ticket.odds.den === exp.den,
    `${ticket.id}: odds ${ticket.odds.num}/${ticket.odds.den} != closed form ${exp.num}/${exp.den}`,
  );
  assert(
    ticket.probability === exp.num / exp.den,
    `${ticket.id}: probability ${ticket.probability} != ${exp.num}/${exp.den}`,
  );
  assert(
    ticket.probability > 0 && ticket.probability < 1,
    `${ticket.id}: probability ${ticket.probability} outside (0,1)`,
  );
  // The whole design: multiplier === (1/p) * 0.99, so p * multiplier === 0.99.
  const rebuilt = (1 / ticket.probability) * LUCKY_CAGE_RTP;
  assert(
    ticket.multiplier === rebuilt,
    `${ticket.id}: multiplier ${ticket.multiplier} != (1/p)*RTP ${rebuilt}`,
  );
  const closedRtp = ticket.probability * ticket.multiplier;
  assert(
    Math.abs(closedRtp - LUCKY_CAGE_RTP) < 1e-12,
    `${ticket.id}: closed-form RTP ${closedRtp} != ${LUCKY_CAGE_RTP}`,
  );
  assert(
    ticket.multiplier > 1,
    `${ticket.id}: multiplier ${ticket.multiplier} must exceed 1x`,
  );
}

// Spot-check the four headline multipliers against hand arithmetic.
{
  const spot = (id: string, expected: number) => {
    const t = getLuckyCageTicket(id)!;
    assert(
      Math.abs(t.multiplier - expected) < 1e-9,
      `${id}: multiplier ${t.multiplier}, expected ~${expected}`,
    );
  };
  spot('ball:7', 3.96); //  1/4       -> 4 * 0.99
  spot('head:7', 19.8); //  1/20      -> 20 * 0.99
  spot('rack:0', (15504 / 496) * 0.99);
  spot('tier:0', (15504 / 252) * 0.99);
  spot('tier:1', (15504 / 2100) * 0.99);
  spot('tier:2', (15504 / 5400) * 0.99);
}

console.log('1/4  closed-form probabilities + multipliers: OK');

/* ══════════════════════════════════════════════════════════════════════
   2. Exhaustive enumeration over all C(20,5) draws
   ══════════════════════════════════════════════════════════════════════ */

const allCombinations: number[][] = [];
for (let a = 1; a <= 16; a += 1)
  for (let b = a + 1; b <= 17; b += 1)
    for (let c = b + 1; c <= 18; c += 1)
      for (let d = c + 1; d <= 19; d += 1)
        for (let e = d + 1; e <= 20; e += 1) allCombinations.push([a, b, c, d, e]);

assert(
  allCombinations.length === LUCKY_CAGE_COMBINATIONS,
  `enumerated ${allCombinations.length} combinations, expected ${LUCKY_CAGE_COMBINATIONS}`,
);

/**
 * Brute-force win counts.
 *  - unordered families (ball/rack/tier) are counted over the 15,504 draws;
 *  - the head family is counted over all 15,504 x 5 = 77,520 (draw, position)
 *    pairs, matching its stated denominator.
 */
const winCounts = new Map<string, number>();
for (const ticket of LUCKY_CAGE_TICKETS) winCounts.set(ticket.id, 0);

// Sanity accumulators for the mutually-exclusive families.
let tierPartitionTotal = 0;
let rackMultiWinDraws = 0;

for (const combo of allCombinations) {
  // Unordered families: any ordering of the combo gives the same answer, so
  // evaluate once with the sorted ordering.
  for (const ticket of LUCKY_CAGE_TICKETS) {
    if (ticket.family === 'head') continue;
    if (luckyCageTicketWins(ticket, combo)) {
      winCounts.set(ticket.id, winCounts.get(ticket.id)! + 1);
      if (ticket.family === 'tier') tierPartitionTotal += 1;
    }
  }

  let racksHit = 0;
  for (let r = 0; r < LUCKY_CAGE_RACK_COUNT; r += 1) {
    let n = 0;
    for (const ball of combo) if (luckyCageRackOf(ball) === r) n += 1;
    if (n >= LUCKY_CAGE_RACK_THRESHOLD) racksHit += 1;
  }
  if (racksHit > 1) rackMultiWinDraws += 1;

  // Head family: every one of the five balls is the head in exactly 1/5 of the
  // orderings of this combo, so each (combo, position) pair is one outcome.
  for (let pos = 0; pos < LUCKY_CAGE_DRAW_COUNT; pos += 1) {
    const headBall = combo[pos]!;
    const id = `head:${headBall}`;
    winCounts.set(id, winCounts.get(id)! + 1);
  }
}

assert(
  tierPartitionTotal === LUCKY_CAGE_COMBINATIONS,
  `tier family is not a partition: ${tierPartitionTotal} wins over ${LUCKY_CAGE_COMBINATIONS} draws`,
);
assert(
  rackMultiWinDraws === 0,
  `${rackMultiWinDraws} draws satisfied two racks at once — racks must be mutually exclusive`,
);

let exhaustiveBallWins = 0;
let exhaustiveHeadWins = 0;
for (const ticket of LUCKY_CAGE_TICKETS) {
  const count = winCounts.get(ticket.id)!;
  assert(
    count === ticket.odds.num,
    `${ticket.id}: exhaustive win count ${count} != stated numerator ${ticket.odds.num}`,
  );
  const empirical = count / ticket.odds.den;
  assert(
    Math.abs(empirical - ticket.probability) < 1e-12,
    `${ticket.id}: exhaustive probability ${empirical} != stated ${ticket.probability}`,
  );
  const exhaustiveRtp = empirical * ticket.multiplier;
  assert(
    Math.abs(exhaustiveRtp - LUCKY_CAGE_RTP) < 1e-12,
    `${ticket.id}: exhaustive RTP ${exhaustiveRtp} != ${LUCKY_CAGE_RTP}`,
  );
  if (ticket.family === 'ball') exhaustiveBallWins += count;
  if (ticket.family === 'head') exhaustiveHeadWins += count;
}

// Every draw lights exactly 5 ball tickets and exactly 1 head ticket.
assert(
  exhaustiveBallWins === LUCKY_CAGE_COMBINATIONS * LUCKY_CAGE_DRAW_COUNT,
  `ball family total wins ${exhaustiveBallWins}, expected ${LUCKY_CAGE_COMBINATIONS * LUCKY_CAGE_DRAW_COUNT}`,
);
assert(
  exhaustiveHeadWins === LUCKY_CAGE_ORDERED_HEAD_SPACE,
  `head family total wins ${exhaustiveHeadWins}, expected ${LUCKY_CAGE_ORDERED_HEAD_SPACE}`,
);

console.log(
  `2/4  exhaustive enumeration of ${allCombinations.length.toLocaleString()} draws: OK`,
);

/* ══════════════════════════════════════════════════════════════════════
   3. Monte Carlo over real session seeds — legality + uniformity
   ══════════════════════════════════════════════════════════════════════ */

const ballFrequency = new Array<number>(LUCKY_CAGE_BALL_COUNT + 1).fill(0);
const headFrequency = new Array<number>(LUCKY_CAGE_BALL_COUNT + 1).fill(0);
/** positionFrequency[pos][ball] — checks every chute slot is unbiased too. */
const positionFrequency: number[][] = Array.from(
  { length: LUCKY_CAGE_DRAW_COUNT },
  () => new Array<number>(LUCKY_CAGE_BALL_COUNT + 1).fill(0),
);
const highCountFrequency = new Array<number>(LUCKY_CAGE_DRAW_COUNT + 1).fill(0);

const ticketWinCounts = new Map<string, number>();
for (const t of LUCKY_CAGE_TICKETS) ticketWinCounts.set(t.id, 0);

let illegalDraws = 0;
let nondeterministicDraws = 0;
let outOfRangeSeeds = 0;

for (let i = 0; i < MONTE_CARLO_ROUNDS; i += 1) {
  const seed = seedAt(i);
  if (!Number.isInteger(seed) || seed < 0 || seed >= SEED_SPACE) outOfRangeSeeds += 1;
  const draw = drawLuckyCage(seed);

  if (i < 5_000) {
    // Determinism: the same seed always yields the same ordered draw.
    const again = drawLuckyCage(seed);
    if (again.join(',') !== draw.join(',')) nondeterministicDraws += 1;
  }

  if (draw.length !== LUCKY_CAGE_DRAW_COUNT) {
    illegalDraws += 1;
    continue;
  }
  const seen = new Set<number>();
  let legal = true;
  for (const ball of draw) {
    if (
      !Number.isInteger(ball) ||
      ball < 1 ||
      ball > LUCKY_CAGE_BALL_COUNT ||
      seen.has(ball)
    ) {
      legal = false;
      break;
    }
    seen.add(ball);
  }
  if (!legal) {
    illegalDraws += 1;
    continue;
  }

  for (let p = 0; p < LUCKY_CAGE_DRAW_COUNT; p += 1) {
    const ball = draw[p]!;
    ballFrequency[ball] += 1;
    positionFrequency[p]![ball] += 1;
  }
  headFrequency[draw[0]!] += 1;
  highCountFrequency[luckyCageHighCount(draw)] += 1;

  for (const ticket of LUCKY_CAGE_TICKETS) {
    if (luckyCageTicketWins(ticket, draw)) {
      ticketWinCounts.set(ticket.id, ticketWinCounts.get(ticket.id)! + 1);
    }
  }
}

assert(illegalDraws === 0, `${illegalDraws} illegal draws (duplicate/out-of-range/short)`);
assert(
  nondeterministicDraws === 0,
  `${nondeterministicDraws} seeds produced a different draw on re-evaluation`,
);
assert(
  outOfRangeSeeds === 0,
  `${outOfRangeSeeds} generated seeds fell outside [0, 2^31)`,
);

// Uniformity: each ball should appear in 5/20 = 25% of draws, and should be
// the head ball in 1/20 = 5% of draws.
const expectedBallRate = LUCKY_CAGE_DRAW_COUNT / LUCKY_CAGE_BALL_COUNT;
const expectedHeadRate = 1 / LUCKY_CAGE_BALL_COUNT;
const expectedPositionRate = 1 / LUCKY_CAGE_BALL_COUNT;

for (let ball = 1; ball <= LUCKY_CAGE_BALL_COUNT; ball += 1) {
  const ballRate = ballFrequency[ball] / MONTE_CARLO_ROUNDS;
  assert(
    Math.abs(ballRate - expectedBallRate) / expectedBallRate <= UNIFORMITY_TOLERANCE,
    `ball ${ball} appearance rate ${pct(ballRate)} deviates from ${pct(expectedBallRate)}`,
  );
  const headRate = headFrequency[ball] / MONTE_CARLO_ROUNDS;
  assert(
    Math.abs(headRate - expectedHeadRate) / expectedHeadRate <= UNIFORMITY_TOLERANCE,
    `ball ${ball} head rate ${pct(headRate)} deviates from ${pct(expectedHeadRate)}`,
  );
  for (let p = 0; p < LUCKY_CAGE_DRAW_COUNT; p += 1) {
    const rate = positionFrequency[p]![ball]! / MONTE_CARLO_ROUNDS;
    assert(
      Math.abs(rate - expectedPositionRate) / expectedPositionRate <=
        UNIFORMITY_TOLERANCE,
      `ball ${ball} at chute position ${p} rate ${pct(rate)} deviates from ${pct(expectedPositionRate)}`,
    );
  }
}

// The high-ball histogram must track the hypergeometric distribution.
for (let k = 0; k <= LUCKY_CAGE_DRAW_COUNT; k += 1) {
  const expected =
    (luckyCageBinomial(10, k) * luckyCageBinomial(10, 5 - k)) /
    LUCKY_CAGE_COMBINATIONS;
  const observed = highCountFrequency[k] / MONTE_CARLO_ROUNDS;
  assert(
    Math.abs(observed - expected) / expected <= UNIFORMITY_TOLERANCE,
    `high-count k=${k} rate ${pct(observed)} deviates from hypergeometric ${pct(expected)}`,
  );
}

// Empirical RTP per ticket = winRate x multiplier.
type TicketSummary = {
  id: string;
  family: string;
  probability: number;
  winRate: number;
  multiplier: number;
  rtp: number;
};
const summaries: TicketSummary[] = [];
for (const ticket of LUCKY_CAGE_TICKETS) {
  const wins = ticketWinCounts.get(ticket.id)!;
  const winRate = wins / MONTE_CARLO_ROUNDS;
  const rtp = winRate * ticket.multiplier;
  const variance =
    ticket.probability * (1 - ticket.probability) * ticket.multiplier * ticket.multiplier;
  const stderr = Math.sqrt(variance / MONTE_CARLO_ROUNDS);
  const tolerance = Math.max(RTP_ABS_TOLERANCE, RTP_SIGMA_TOLERANCE * stderr);
  assert(
    Math.abs(rtp - LUCKY_CAGE_RTP) <= tolerance,
    `${ticket.id}: empirical RTP ${rtp.toFixed(5)} differs from ${LUCKY_CAGE_RTP} by more than ${tolerance.toFixed(5)}`,
  );
  summaries.push({
    id: ticket.id,
    family: ticket.family,
    probability: ticket.probability,
    winRate,
    multiplier: ticket.multiplier,
    rtp,
  });
}

console.log(
  `3/4  monte-carlo ${MONTE_CARLO_ROUNDS.toLocaleString()} rounds — legality + uniformity + RTP: OK`,
);

/* ══════════════════════════════════════════════════════════════════════
   4. Payout path — resolveLuckyCage + computeLuckyCagePayout
   ══════════════════════════════════════════════════════════════════════ */

const PAYOUT_ROUNDS = 40_000;
let payoutStaked = 0;
let payoutReturned = 0;
let payoutOnLoss = 0;
let payoutOutOfBand = 0;
let unknownTicketNotNull = 0;

if (resolveLuckyCage(12345, 'nope:1') !== null) unknownTicketNotNull += 1;
if (resolveLuckyCage(12345, 'ball:99') !== null) unknownTicketNotNull += 1;
assert(unknownTicketNotNull === 0, 'resolveLuckyCage must return null for unknown tickets');

for (let i = 0; i < PAYOUT_ROUNDS; i += 1) {
  const seed = seedAt(MONTE_CARLO_ROUNDS + i);
  const ticket = LUCKY_CAGE_TICKETS[i % LUCKY_CAGE_TICKET_COUNT]!;
  const result = resolveLuckyCage(seed, ticket.id);
  if (!result) {
    fail(`resolveLuckyCage returned null for known ticket ${ticket.id}`);
    continue;
  }

  // The resolved draw must equal the raw draw for the same seed.
  const raw = drawLuckyCage(seed);
  if (raw.join(',') !== result.draw.join(',')) {
    fail(`seed ${seed}: resolve draw ${result.draw} != drawLuckyCage ${raw}`);
  }
  if (result.head !== raw[0]) {
    fail(`seed ${seed}: head ${result.head} != draw[0] ${raw[0]}`);
  }
  if (result.won !== luckyCageTicketWins(ticket, raw)) {
    fail(`seed ${seed} ${ticket.id}: won flag disagrees with luckyCageTicketWins`);
  }
  if (result.won && result.multiplier !== ticket.multiplier) {
    fail(`seed ${seed} ${ticket.id}: winning multiplier ${result.multiplier} != ${ticket.multiplier}`);
  }
  if (!result.won && result.multiplier !== 0) {
    fail(`seed ${seed} ${ticket.id}: losing multiplier ${result.multiplier} != 0`);
  }
  // Rack/tier hit lists must be consistent with the draw.
  for (const ball of result.hitBalls) {
    if (!raw.includes(ball)) {
      fail(`seed ${seed} ${ticket.id}: hit ball ${ball} is not in the draw`);
    }
  }

  const payout = computeLuckyCagePayout(PAYOUT_WAGER, result, seed);
  payoutStaked += PAYOUT_WAGER;
  payoutReturned += payout;

  if (!result.won && payout !== 0) payoutOnLoss += 1;
  if (result.won) {
    const exact = PAYOUT_WAGER * ticket.multiplier;
    // Unbiased fractional rounding: floor(exact) or floor(exact)+1, never more.
    if (payout < Math.floor(exact) || payout > Math.floor(exact) + 1) {
      payoutOutOfBand += 1;
    }
  }
}

assert(payoutOnLoss === 0, `${payoutOnLoss} losing rounds paid out`);
assert(
  payoutOutOfBand === 0,
  `${payoutOutOfBand} winning payouts fell outside floor(exact)..floor(exact)+1`,
);

const aggregateRtp = payoutReturned / payoutStaked;
assert(
  Math.abs(aggregateRtp - LUCKY_CAGE_RTP) <= 0.05,
  `aggregate payout RTP ${aggregateRtp.toFixed(5)} differs from ${LUCKY_CAGE_RTP} by more than 0.05`,
);

console.log(
  `4/4  payout path over ${PAYOUT_ROUNDS.toLocaleString()} rounds — aggregate RTP ${pct(aggregateRtp)}: OK`,
);

/* ── report ─────────────────────────────────────────────────────────── */

console.log('');
console.log('Ticket table (one row per family, plus every tier)');
console.log('  ticket      p (exact)        1/p        multiplier   closed RTP   empirical RTP');
const showcase = [
  'ball:1',
  'head:1',
  'rack:0',
  'tier:0',
  'tier:1',
  'tier:2',
  'tier:3',
  'tier:4',
  'tier:5',
];
for (const id of showcase) {
  const t = getLuckyCageTicket(id)!;
  const s = summaries.find((row) => row.id === id)!;
  console.log(
    `  ${id.padEnd(10)}  ${t.odds.num}/${String(t.odds.den).padEnd(7)}  ${(1 / t.probability)
      .toFixed(4)
      .padStart(10)}  ${t.multiplier.toFixed(6).padStart(12)}  ${(t.probability * t.multiplier)
      .toFixed(8)
      .padStart(11)}  ${pct(s.rtp).padStart(13)}`,
  );
}

console.log('');
console.log('Family summary');
for (const family of ['ball', 'head', 'rack', 'tier']) {
  const rows = summaries.filter((s) => s.family === family);
  const minRtp = Math.min(...rows.map((r) => r.rtp));
  const maxRtp = Math.max(...rows.map((r) => r.rtp));
  console.log(
    `  ${family.padEnd(6)} ${String(rows.length).padStart(2)} tickets   empirical RTP ${pct(minRtp)} .. ${pct(maxRtp)}`,
  );
}

console.log('');
console.log(
  `Board geometry: ${LUCKY_CAGE_RACK_COUNT} racks of ${LUCKY_CAGE_RACK_SIZE}, rack threshold ${LUCKY_CAGE_RACK_THRESHOLD}, high balls from ${LUCKY_CAGE_HIGH_THRESHOLD}`,
);

if (failures.length > 0) {
  console.error(`\nFAILURES (${failures.length + suppressedFailures}):`);
  for (const f of failures) console.error('  FAIL: ' + f);
  if (suppressedFailures > 0) {
    console.error(`  ... ${suppressedFailures} more failure(s) suppressed`);
  }
  process.exit(1);
}

console.log('\nALL LUCKY CAGE RTP/FAIRNESS CHECKS PASS.');
process.exit(0);
