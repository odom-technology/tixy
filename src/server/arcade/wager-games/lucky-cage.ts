// ---------------------------------------------------------------------------
// tixy — Lucky Cage game logic (hand-built carnival lottery cabinet)
//
// Twenty numbered balls tumble in a brass cage; five are released in order
// through a mechanical chute. The draw is a seeded Fisher-Yates shuffle of
// 1..20 truncated to five — the SAME seededShuffle the rest of the
// provably-fair stack uses — so the ORDER of the five is meaningful (ball one
// out of the chute is the "head ball").
//
//   draw = seededShuffle([1..20], seed).slice(0, 5)   // ordered
//
// The player buys exactly ONE ticket per round from four families, 51 tickets
// in total:
//
//   ball  (20)  number N is among the five drawn
//   head  (20)  number N is the FIRST ball through the chute
//   rack   (5)  at least three of the five come from one painted rack of four
//   tier    (6)  exactly k of the five are high balls (11..20), k = 0..5
//
// Every ticket's probability is an EXACT combinatoric rational over
// C(20,5) = 15,504 (the head family divides that again by the five chute
// positions, i.e. a denominator of 77,520), and every multiplier is built as
//
//   multiplier = (1 / exactProbability) * ARCADE_RTP['arcade-lucky-cage']
//
// so the theoretical return of EVERY ticket is exactly 0.99 by construction —
// there is no hand-tuned paytable to drift and no per-column correction factor.
// See scripts/verify-lucky-cage-rtp.ts for the closed-form + exhaustive
// 15,504-combination proof.
//
// Because the edge is built into each multiplier here, the settle route must
// NOT discount the payout a second time.
// ---------------------------------------------------------------------------

import { ARCADE_RTP } from '../arcade-constants';
import { roundArcadePayout } from '../arcade-payout';
import { seededShuffle } from '../arcade-rng';

export const LUCKY_CAGE_BALL_COUNT = 20;
export const LUCKY_CAGE_DRAW_COUNT = 5;

/** C(20, 5) — the number of distinct unordered five-ball draws. */
export const LUCKY_CAGE_COMBINATIONS = 15_504;

/**
 * Distinct (unordered draw, chute position) pairs. The head family is uniform
 * over these, which is why its denominator is C(20,5) x 5.
 */
export const LUCKY_CAGE_ORDERED_HEAD_SPACE =
  LUCKY_CAGE_COMBINATIONS * LUCKY_CAGE_DRAW_COUNT;

/** Balls 11..20 are the "high" half — the tier family counts these. */
export const LUCKY_CAGE_HIGH_THRESHOLD = 11;

/** Painted racks of four, front of cabinet, left to right. */
export const LUCKY_CAGE_RACK_SIZE = 4;
export const LUCKY_CAGE_RACK_COUNT = LUCKY_CAGE_BALL_COUNT / LUCKY_CAGE_RACK_SIZE; // 5
/** A rack pays when at least this many of the five drawn balls belong to it. */
export const LUCKY_CAGE_RACK_THRESHOLD = 3;

export const LUCKY_CAGE_FAMILIES = ['ball', 'head', 'rack', 'tier'] as const;
export type LuckyCageFamily = (typeof LUCKY_CAGE_FAMILIES)[number];

export const LUCKY_CAGE_FAMILY_LABELS: Record<LuckyCageFamily, string> = {
  ball: 'Ball tickets',
  head: 'Head tickets',
  rack: 'Rack tickets',
  tier: 'Tier tickets',
};

export const LUCKY_CAGE_FAMILY_BLURBS: Record<LuckyCageFamily, string> = {
  ball: 'Your number is one of the five that leave the cage.',
  head: 'Your number is the first ball through the chute.',
  rack: 'Three or more of the five come from your painted rack of four.',
  tier: 'Exactly this many of the five are high balls (11-20).',
};

/** Human name for rack index 0..4, e.g. "Rack 1 · 1-4". */
export function luckyCageRackLabel(rackIndex: number): string {
  const lo = rackIndex * LUCKY_CAGE_RACK_SIZE + 1;
  const hi = lo + LUCKY_CAGE_RACK_SIZE - 1;
  return `Rack ${rackIndex + 1} · ${lo}-${hi}`;
}

/** The four numbers painted on rack index 0..4. */
export function luckyCageRackNumbers(rackIndex: number): number[] {
  const lo = rackIndex * LUCKY_CAGE_RACK_SIZE + 1;
  return Array.from({ length: LUCKY_CAGE_RACK_SIZE }, (_, i) => lo + i);
}

/** Rack index (0..4) a ball number belongs to. */
export function luckyCageRackOf(ball: number): number {
  return Math.floor((ball - 1) / LUCKY_CAGE_RACK_SIZE);
}

// ---------------------------------------------------------------------------
// Exact combinatorics
// ---------------------------------------------------------------------------

/** Exact binomial coefficient for the small n used here (no overflow risk). */
export function luckyCageBinomial(n: number, k: number): number {
  if (k < 0 || k > n || n < 0) return 0;
  const kk = Math.min(k, n - k);
  let num = 1;
  let den = 1;
  for (let i = 0; i < kk; i += 1) {
    num *= n - i;
    den *= i + 1;
  }
  return num / den;
}

/**
 * Favourable-outcome count and sample-space size for each ticket, written as an
 * exact rational so nothing depends on a hand-typed decimal.
 *
 *   ball  C(19,4) / C(20,5)                       = 3,876 / 15,504  = 1/4
 *   head  C(19,4) / (C(20,5) x 5)                 = 3,876 / 77,520  = 1/20
 *   rack  [C(4,3)C(16,2) + C(4,4)C(16,1)] / C(20,5) = 496 / 15,504
 *   tier  C(10,k)C(10,5-k) / C(20,5)
 */
export type LuckyCageOdds = {
  /** Favourable outcomes. */
  num: number;
  /** Size of the sample space the numerator is counted over. */
  den: number;
};

export function luckyCageBallOdds(): LuckyCageOdds {
  return {
    num: luckyCageBinomial(LUCKY_CAGE_BALL_COUNT - 1, LUCKY_CAGE_DRAW_COUNT - 1),
    den: LUCKY_CAGE_COMBINATIONS,
  };
}

export function luckyCageHeadOdds(): LuckyCageOdds {
  return {
    num: luckyCageBinomial(LUCKY_CAGE_BALL_COUNT - 1, LUCKY_CAGE_DRAW_COUNT - 1),
    den: LUCKY_CAGE_ORDERED_HEAD_SPACE,
  };
}

export function luckyCageRackOdds(): LuckyCageOdds {
  let num = 0;
  for (let k = LUCKY_CAGE_RACK_THRESHOLD; k <= LUCKY_CAGE_RACK_SIZE; k += 1) {
    num +=
      luckyCageBinomial(LUCKY_CAGE_RACK_SIZE, k) *
      luckyCageBinomial(
        LUCKY_CAGE_BALL_COUNT - LUCKY_CAGE_RACK_SIZE,
        LUCKY_CAGE_DRAW_COUNT - k,
      );
  }
  return { num, den: LUCKY_CAGE_COMBINATIONS };
}

export function luckyCageTierOdds(highCount: number): LuckyCageOdds {
  const half = LUCKY_CAGE_BALL_COUNT / 2; // 10 low, 10 high
  return {
    num:
      luckyCageBinomial(half, highCount) *
      luckyCageBinomial(half, LUCKY_CAGE_DRAW_COUNT - highCount),
    den: LUCKY_CAGE_COMBINATIONS,
  };
}

// ---------------------------------------------------------------------------
// Ticket table — 51 tickets, every multiplier built from its exact probability
// ---------------------------------------------------------------------------

export type LuckyCageTicket = {
  /** Stable wire id, e.g. "ball:7", "head:20", "rack:2", "tier:0". */
  id: string;
  family: LuckyCageFamily;
  /** Ball number (ball/head), rack index (rack), or high-ball count (tier). */
  value: number;
  /** Short label for the chip, e.g. "7", "Head 20", "Rack 3", "3 high". */
  label: string;
  /** One-line plain-language description of what wins. */
  detail: string;
  odds: LuckyCageOdds;
  /** Exact probability the ticket wins. */
  probability: number;
  /** (1 / probability) * ARCADE_RTP — theoretical return is exactly 0.99. */
  multiplier: number;
};

/** RTP target every Lucky Cage multiplier is constructed against. */
export const LUCKY_CAGE_RTP = ARCADE_RTP['arcade-lucky-cage'];

function makeTicket(
  id: string,
  family: LuckyCageFamily,
  value: number,
  label: string,
  detail: string,
  odds: LuckyCageOdds,
): LuckyCageTicket {
  const probability = odds.num / odds.den;
  return {
    id,
    family,
    value,
    label,
    detail,
    odds,
    probability,
    multiplier: (1 / probability) * LUCKY_CAGE_RTP,
  };
}

/** All 51 tickets, grouped family by family in board order. */
export const LUCKY_CAGE_TICKETS: readonly LuckyCageTicket[] = (() => {
  const tickets: LuckyCageTicket[] = [];

  for (let n = 1; n <= LUCKY_CAGE_BALL_COUNT; n += 1) {
    tickets.push(
      makeTicket(
        `ball:${n}`,
        'ball',
        n,
        String(n),
        `Ball ${n} is one of the five drawn.`,
        luckyCageBallOdds(),
      ),
    );
  }

  for (let n = 1; n <= LUCKY_CAGE_BALL_COUNT; n += 1) {
    tickets.push(
      makeTicket(
        `head:${n}`,
        'head',
        n,
        `Head ${n}`,
        `Ball ${n} is drawn first.`,
        luckyCageHeadOdds(),
      ),
    );
  }

  for (let r = 0; r < LUCKY_CAGE_RACK_COUNT; r += 1) {
    tickets.push(
      makeTicket(
        `rack:${r}`,
        'rack',
        r,
        `Rack ${r + 1}`,
        `At least ${LUCKY_CAGE_RACK_THRESHOLD} of the five are from ${luckyCageRackNumbers(r)[0]} to ${luckyCageRackNumbers(r)[LUCKY_CAGE_RACK_SIZE - 1]}.`,
        luckyCageRackOdds(),
      ),
    );
  }

  for (let k = 0; k <= LUCKY_CAGE_DRAW_COUNT; k += 1) {
    tickets.push(
      makeTicket(
        `tier:${k}`,
        'tier',
        k,
        `${k} high`,
        `Exactly ${k} of the five ${k === 1 ? 'is' : 'are'} ${LUCKY_CAGE_HIGH_THRESHOLD} to ${LUCKY_CAGE_BALL_COUNT}.`,
        luckyCageTierOdds(k),
      ),
    );
  }

  return tickets;
})();

/** Total number of distinct tickets on the board (51). */
export const LUCKY_CAGE_TICKET_COUNT = LUCKY_CAGE_TICKETS.length;

const TICKET_BY_ID = new Map<string, LuckyCageTicket>(
  LUCKY_CAGE_TICKETS.map((t) => [t.id, t]),
);

export function getLuckyCageTicket(id: string): LuckyCageTicket | null {
  return TICKET_BY_ID.get(id) ?? null;
}

/** Tickets of one family, in board order. */
export function luckyCageFamilyTickets(
  family: LuckyCageFamily,
): LuckyCageTicket[] {
  return LUCKY_CAGE_TICKETS.filter((t) => t.family === family);
}

/** The default ticket a fresh session starts on. */
export const LUCKY_CAGE_DEFAULT_TICKET = 'ball:7';

// ---------------------------------------------------------------------------
// Draw + resolution
// ---------------------------------------------------------------------------

/**
 * The five balls released from the cage, IN CHUTE ORDER. Fisher-Yates over
 * 1..20 with the shared seeded PRNG, truncated to five — index 0 is the head
 * ball. src/features/arcade/lib/lucky-cage-draw.ts is a byte-identical
 * browser-safe replica (proved by scripts/verify-lucky-cage-client-parity.ts).
 */
export function drawLuckyCage(seed: number): number[] {
  const all = Array.from({ length: LUCKY_CAGE_BALL_COUNT }, (_, i) => i + 1);
  return seededShuffle(all, seed).slice(0, LUCKY_CAGE_DRAW_COUNT);
}

/** How many of the drawn balls are high (11..20). */
export function luckyCageHighCount(draw: readonly number[]): number {
  let count = 0;
  for (const ball of draw) {
    if (ball >= LUCKY_CAGE_HIGH_THRESHOLD) count += 1;
  }
  return count;
}

/** How many of the drawn balls belong to each rack, indexed by rack. */
export function luckyCageRackCounts(draw: readonly number[]): number[] {
  const counts = new Array<number>(LUCKY_CAGE_RACK_COUNT).fill(0);
  for (const ball of draw) {
    const rack = luckyCageRackOf(ball);
    if (rack >= 0 && rack < counts.length) counts[rack] += 1;
  }
  return counts;
}

/** Does this ticket win against this ordered draw? Pure, total, no RNG. */
export function luckyCageTicketWins(
  ticket: LuckyCageTicket,
  draw: readonly number[],
): boolean {
  switch (ticket.family) {
    case 'ball':
      return draw.includes(ticket.value);
    case 'head':
      return draw[0] === ticket.value;
    case 'rack':
      return (
        (luckyCageRackCounts(draw)[ticket.value] ?? 0) >=
        LUCKY_CAGE_RACK_THRESHOLD
      );
    case 'tier':
      return luckyCageHighCount(draw) === ticket.value;
    default:
      return false;
  }
}

/**
 * Which of the five drawn balls the ticket actually "hit" — used purely to
 * light the right balls on the reveal plate. Never affects the payout.
 */
export function luckyCageHitBalls(
  ticket: LuckyCageTicket,
  draw: readonly number[],
): number[] {
  switch (ticket.family) {
    case 'ball':
      return draw.filter((b) => b === ticket.value);
    case 'head':
      return draw[0] === ticket.value ? [draw[0]] : [];
    case 'rack':
      return draw.filter((b) => luckyCageRackOf(b) === ticket.value);
    case 'tier':
      return draw.filter((b) => b >= LUCKY_CAGE_HIGH_THRESHOLD);
    default:
      return [];
  }
}

export type LuckyCageConfig = {
  ticket: string;
};

export type LuckyCageResult = {
  ticket: string;
  family: LuckyCageFamily;
  /** The five balls in chute order. */
  draw: number[];
  /** draw[0] — the head ball. */
  head: number;
  /** Count of drawn balls in 11..20. */
  highCount: number;
  /** Per-rack counts of the five drawn balls. */
  rackCounts: number[];
  /** Balls the ticket lit up (cosmetic). */
  hitBalls: number[];
  won: boolean;
  /** The ticket's multiplier when it wins, else 0. */
  multiplier: number;
};

/** Validate a Lucky Cage config from the client. */
export function validateLuckyCageConfig(config: unknown): LuckyCageConfig | null {
  if (!config || typeof config !== 'object') return null;
  const ticket = (config as Record<string, unknown>).ticket;
  if (typeof ticket !== 'string') return null;
  if (!TICKET_BY_ID.has(ticket)) return null;
  return { ticket };
}

/** Resolve the round for a seed + ticket id. Returns null for an unknown id. */
export function resolveLuckyCage(
  seed: number,
  ticketId: string,
): LuckyCageResult | null {
  const ticket = getLuckyCageTicket(ticketId);
  if (!ticket) return null;

  const draw = drawLuckyCage(seed);
  const won = luckyCageTicketWins(ticket, draw);
  return {
    ticket: ticket.id,
    family: ticket.family,
    draw,
    head: draw[0]!,
    highCount: luckyCageHighCount(draw),
    rackCounts: luckyCageRackCounts(draw),
    hitBalls: won ? luckyCageHitBalls(ticket, draw) : [],
    won,
    multiplier: won ? ticket.multiplier : 0,
  };
}

/**
 * Payout for a resolved round. The multiplier already carries the house edge
 * (it was built as (1/p) * 0.99), so nothing is discounted again here — the
 * only adjustment is the shared unbiased fractional-ticket rounding.
 */
export function computeLuckyCagePayout(
  wager: number,
  result: LuckyCageResult,
  seed: number,
): number {
  if (!result.won || result.multiplier <= 0) return 0;
  return roundArcadePayout(
    wager * result.multiplier,
    seed,
    `lucky-cage:${result.ticket}`,
  );
}
