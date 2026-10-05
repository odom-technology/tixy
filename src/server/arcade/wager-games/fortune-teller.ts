// ---------------------------------------------------------------------------
// tixy — Fortune Teller game logic (tarot-style 3-card wager)
// ---------------------------------------------------------------------------
//
// The player picks a TIER (apprentice / seer / oracle / mystic), bets, and
// three face-down tarot cards are flipped middle → left → right. Each card is
// an INDEPENDENT draw from the tier's published multiplier distribution and the
// three multipliers COMPOUND (product). A 0× on any card busts the whole round.
//
// Provably-fair shape (mirrors packs' multi-draw chain):
//   for i in 0..2:
//     cardSeed = deriveSubSeed(seed, `fortune-card:${i}`)   // sha256(seed:label)
//     rng      = mulberry32(cardSeed)
//     multRoll = rng()   → weighted-pick the card multiplier
//     iconRoll = rng()   → pick the (cosmetic) tarot iconography
// The three draws are independent HMAC-chain sub-streams, so revealing the seed
// at settle re-derives all three cards exactly. The flip ORDER is pure drama —
// every card's multiplier is fixed the instant the round is created.
//
// House edge lives ENTIRELY in the distributions. For iid draws the compounded
// return is E[product] = E[card]^3, so each tier's per-card distribution is
// pinned to a per-card EV of cbrt(0.99) = 0.9966554934… → compounded RTP ≈
// 0.990 for every tier (proven by exact enumeration in the offline test and by
// the load-time assertion below). Because the edge is baked into the tables,
// ARCADE_RTP['arcade-fortune-teller'] is 1.0 — do NOT discount a second time.
//
//   apprentice → low bust (15%), top card 2.7× → product ceiling ≈ 20×
//   seer       → mid bust (30%), top card 5.3× → product ceiling ≈ 150×
//   oracle     → high bust (45%), top card 9.7× → product ceiling ≈ 900×
//   mystic     → brutal bust (55%), top card 17.1× → product ceiling ≈ 5000×
// ---------------------------------------------------------------------------

import { roundArcadePayout } from '../arcade-payout';
import { mulberry32, deriveSubSeed } from '../arcade-rng';

/** The four difficulty tiers, easiest → hardest. */
export const FORTUNE_TIERS = ['apprentice', 'seer', 'oracle', 'mystic'] as const;
export type FortuneTier = (typeof FORTUNE_TIERS)[number];

/** Cards flipped per round (middle → left → right). */
export const FORTUNE_CARDS_PER_ROUND = 3;

/** Compounded return-to-player each tier's tables are pinned to. */
export const FORTUNE_TARGET_RTP = 0.99;
/** Per-card EV target — cube root of the compounded target (iid draws). */
export const FORTUNE_TARGET_CARD_EV = Math.cbrt(FORTUNE_TARGET_RTP);

/**
 * Original tarot-style iconography (NOT copied from any real deck). The drawn
 * icon is cosmetic — it never affects the multiplier — but is seed-derived so
 * the reveal is fully reproducible.
 */
export const FORTUNE_ICONS = [
  'sun',
  'moon',
  'star',
  'comet',
  'eye',
  'key',
  'serpent',
  'lantern',
] as const;
export type FortuneIcon = (typeof FORTUNE_ICONS)[number];

export type FortuneWinBucket = { mult: number; weight: number };
export type FortuneBucket = { mult: number; weight: number };

/**
 * Published WINNING buckets per tier (positives only). The 0× loss weight is
 * derived at load so per-card EV is pinned to FORTUNE_TARGET_CARD_EV — the same
 * technique cases.ts uses. Weights were designed offline (scratchpad design.mjs)
 * so each tier's per-card bust mass rises and the tail fattens with difficulty
 * while the compounded RTP stays ≈ 0.990. These arrays are the single source of
 * truth the client renders in its odds panel and the server resolves against.
 */
export const FORTUNE_WIN_BUCKETS: Record<FortuneTier, readonly FortuneWinBucket[]> = {
  apprentice: [
    { mult: 0.3, weight: 700 },
    { mult: 0.6, weight: 1300 },
    { mult: 1, weight: 2600 },
    { mult: 1.4, weight: 2813 },
    { mult: 1.8, weight: 900 },
    { mult: 2.2, weight: 360 },
    { mult: 2.7, weight: 150 },
  ],
  seer: [
    { mult: 0.3, weight: 900 },
    { mult: 0.8, weight: 1500 },
    { mult: 1.3, weight: 1500 },
    { mult: 2, weight: 1632 },
    { mult: 3, weight: 380 },
    { mult: 4.2, weight: 130 },
    { mult: 5.3, weight: 60 },
  ],
  oracle: [
    { mult: 0.3, weight: 700 },
    { mult: 0.8, weight: 1300 },
    { mult: 1.6, weight: 1200 },
    { mult: 2.6, weight: 1004 },
    { mult: 4.5, weight: 320 },
    { mult: 7, weight: 120 },
    { mult: 9.7, weight: 45 },
  ],
  mystic: [
    { mult: 0.3, weight: 620 },
    { mult: 0.9, weight: 1150 },
    { mult: 1.8, weight: 1050 },
    { mult: 3.2, weight: 205 },
    { mult: 6.5, weight: 320 },
    { mult: 11, weight: 110 },
    { mult: 17.1, weight: 40 },
  ],
};

/**
 * Derive the 0× loss weight for a tier so per-card EV = FORTUNE_TARGET_CARD_EV.
 * EV = winEV / (winWeight + lossWeight)  ⇒  lossWeight = winEV/target − winWeight.
 */
function deriveLossWeight(wins: readonly FortuneWinBucket[]): number {
  let winWeight = 0;
  let winEV = 0;
  for (const b of wins) {
    winWeight += b.weight;
    winEV += b.mult * b.weight;
  }
  return Math.max(0, Math.round(winEV / FORTUNE_TARGET_CARD_EV - winWeight));
}

/**
 * The full frozen per-card distribution for each tier: the derived 0× loss
 * bucket followed by the published winning buckets. Frozen so neither side can
 * mutate a shared table.
 */
export const FORTUNE_TABLES: Record<FortuneTier, readonly FortuneBucket[]> = (() => {
  const out = {} as Record<FortuneTier, readonly FortuneBucket[]>;
  for (const tier of FORTUNE_TIERS) {
    const wins = FORTUNE_WIN_BUCKETS[tier];
    const lossWeight = deriveLossWeight(wins);
    out[tier] = Object.freeze([{ mult: 0, weight: lossWeight }, ...wins]);
  }
  return out;
})();

/** Look up the frozen per-card distribution for a tier. */
export function getFortuneTable(tier: FortuneTier): readonly FortuneBucket[] {
  return FORTUNE_TABLES[tier];
}

/** Total weight of a tier's table. */
function tableTotal(table: readonly FortuneBucket[]): number {
  return table.reduce((s, b) => s + b.weight, 0);
}

/** Exact per-card expected value for a tier (used by the UI + tests). */
export function getFortuneCardEV(tier: FortuneTier): number {
  const table = FORTUNE_TABLES[tier];
  const total = tableTotal(table);
  return table.reduce((s, b) => s + b.mult * b.weight, 0) / total;
}

/** Exact compounded RTP for a tier: iid draws ⇒ E[product] = E[card]^3. */
export function getFortuneCompoundRtp(tier: FortuneTier): number {
  return getFortuneCardEV(tier) ** FORTUNE_CARDS_PER_ROUND;
}

/** Per-card probability of a given multiplier (for the odds panel). */
export function getFortuneCardProb(tier: FortuneTier, mult: number): number {
  const table = FORTUNE_TABLES[tier];
  const total = tableTotal(table);
  const bucket = table.find((b) => b.mult === mult);
  return bucket ? bucket.weight / total : 0;
}

/** Highest single-card multiplier on a tier (top of the tail). */
export function getFortuneTopCard(tier: FortuneTier): number {
  return Math.max(...FORTUNE_TABLES[tier].map((b) => b.mult));
}

/** Product ceiling for a tier = topCard^3 (all three cards hit the tail). */
export function getFortuneMaxProduct(tier: FortuneTier): number {
  return getFortuneTopCard(tier) ** FORTUNE_CARDS_PER_ROUND;
}

// Load-time safety net: every tier's compounded RTP must sit inside the mandated
// [0.985, 0.995] band. A bad hand-edit to a weight fails fast on import rather
// than silently shipping a mis-priced tier.
for (const tier of FORTUNE_TIERS) {
  const rtp = getFortuneCompoundRtp(tier);
  if (rtp < 0.985 || rtp > 0.995) {
    throw new Error(
      `Fortune Teller tier "${tier}" compounded RTP ${rtp.toFixed(5)} is outside [0.985, 0.995].`,
    );
  }
}

// ---------------------------------------------------------------------------
// Types + validation
// ---------------------------------------------------------------------------

export type FortuneConfig = {
  tier: FortuneTier;
};

export type FortuneCard = {
  /** This card's multiplier (0 = bust). */
  mult: number;
  /** Cosmetic tarot iconography index into FORTUNE_ICONS. */
  icon: number;
};

export type FortuneResult = {
  tier: FortuneTier;
  /** cards[0] = middle, cards[1] = left, cards[2] = right (flip order). */
  cards: FortuneCard[];
  /** Compounded multiplier = product of the three card multipliers. */
  product: number;
  /** True if no card busted (product > 0). */
  won: boolean;
};

function isFortuneTier(v: unknown): v is FortuneTier {
  return (FORTUNE_TIERS as readonly string[]).includes(v as string);
}

/** Validate a Fortune Teller configuration from the client. */
export function validateFortuneConfig(config: unknown): FortuneConfig | null {
  if (!config || typeof config !== 'object') return null;
  const tier = (config as { tier?: unknown }).tier;
  if (!isFortuneTier(tier)) return null;
  return { tier };
}

// ---------------------------------------------------------------------------
// Resolve + payout
// ---------------------------------------------------------------------------

/** Weighted-pick a single card multiplier from a tier table. */
function pickBucket(table: readonly FortuneBucket[], roll: number): FortuneBucket {
  const total = tableTotal(table);
  const target = roll * total;
  let cum = 0;
  for (const b of table) {
    cum += b.weight;
    if (target < cum) return b;
  }
  return table[table.length - 1]!;
}

/**
 * Resolve all three cards for a seed + tier. Each card draws from its own
 * HMAC sub-seed so the three multipliers are independent and reproducible.
 */
export function resolveFortune(seed: number, tier: FortuneTier): FortuneResult {
  const table = FORTUNE_TABLES[tier];
  const cards: FortuneCard[] = [];

  for (let i = 0; i < FORTUNE_CARDS_PER_ROUND; i++) {
    const cardSeed = deriveSubSeed(seed, `fortune-card:${i}`);
    const rng = mulberry32(cardSeed);
    const multRoll = rng();
    const bucket = pickBucket(table, multRoll);
    const iconRoll = rng();
    const icon = Math.floor(iconRoll * FORTUNE_ICONS.length);
    cards.push({ mult: bucket.mult, icon });
  }

  const product = cards.reduce((p, c) => p * c.mult, 1);
  return { tier, cards, product, won: product > 0 };
}

/**
 * Integer Ticket payout for a settled round. The edge is already inside the
 * tables, so the payout multiplier is exactly the card product — no extra RTP
 * factor. Rounded once through the shared unbiased helper.
 */
export function computeFortunePayout(
  wager: number,
  result: FortuneResult,
  seed: number,
): number {
  if (!result.won || result.product <= 0) return 0;
  return roundArcadePayout(
    wager * result.product,
    seed,
    `fortune-teller:${result.tier}:${result.product}`,
  );
}
