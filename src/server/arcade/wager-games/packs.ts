// ---------------------------------------------------------------------------
// Arcade — Packs (card-pack opening) game logic
// ---------------------------------------------------------------------------

import {
  PACKS_CARD_POOL,
  PACKS_CARDS_PER_PACK,
  PACKS_HOLO_CHANCE,
  PACKS_THEMES,
  type PacksCardBucket,
  type PacksRarity,
  type PacksTheme,
} from '../arcade-constants';
import { roundArcadePayout } from '../arcade-payout';
import { mulberry32, deriveSubSeed } from '../arcade-rng';

export type PacksCard = {
  mult: number;
  rarity: PacksRarity;
  theme: PacksTheme;
  holo: boolean;
};

export type PacksResult = {
  cards: PacksCard[];
  totalMultiplier: number;
};

/** Packs has no config — always the same mode. */
export function validatePacksConfig(_config: unknown): Record<string, never> {
  return {};
}

/** Weighted-pick a single card from the pool. */
function pickCard(pool: PacksCardBucket[], roll: number): PacksCardBucket {
  const totalWeight = pool.reduce((s, it) => s + it.weight, 0);
  const target = roll * totalWeight;
  let cum = 0;
  for (const item of pool) {
    cum += item.weight;
    if (target < cum) return item;
  }
  return pool[pool.length - 1]!;
}

/** Draw 5 cards from the pool using the session seed. */
export function resolvePacks(seed: number): PacksResult {
  const cards: PacksCard[] = [];

  for (let i = 0; i < PACKS_CARDS_PER_PACK; i++) {
    // Each card gets its own sub-seed so draws are independent
    const cardSeed = deriveSubSeed(seed, `pack-card:${i}`);
    const rng = mulberry32(cardSeed);

    // 1. Pick multiplier/rarity
    const multRoll = rng();
    const bucket = pickCard(PACKS_CARD_POOL, multRoll);

    // 2. Pick theme (mythic is always holocron)
    let theme: PacksTheme;
    if (bucket.rarity === 'mythic') {
      theme = 'holocron';
    } else if (bucket.rarity === 'dud') {
      // Duds still get a theme for visual interest
      const themeIdx = Math.floor(rng() * PACKS_THEMES.length);
      theme = PACKS_THEMES[themeIdx]!;
    } else {
      const themeIdx = Math.floor(rng() * PACKS_THEMES.length);
      theme = PACKS_THEMES[themeIdx]!;
    }

    // 3. Holo roll
    const holoRoll = rng();
    const holo = holoRoll < PACKS_HOLO_CHANCE[bucket.rarity];

    cards.push({
      mult: bucket.mult,
      rarity: bucket.rarity,
      theme,
      holo,
    });
  }

  const totalMultiplier = cards.reduce((sum, c) => sum + c.mult, 0);

  return { cards, totalMultiplier };
}

/** Compute integer payout from the total multiplier. */
export function computePacksPayout(
  wager: number,
  totalMultiplier: number,
  seed: number,
): number {
  if (totalMultiplier <= 0) return 0;
  return roundArcadePayout(wager * totalMultiplier, seed, `packs:${totalMultiplier}`);
}
