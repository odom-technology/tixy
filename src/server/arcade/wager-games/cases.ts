// ---------------------------------------------------------------------------
// Arcade — Cases (CS:GO-style box opening) game logic
// ---------------------------------------------------------------------------

import {
  CASES_ITEMS,
  CASE_RISKS,
  type CaseRisk,
  type CasesItem,
  type CasesRarity,
} from '../arcade-constants';
import { roundArcadePayout } from '../arcade-payout';
import { mulberry32 } from '../arcade-rng';

export type CasesConfig = {
  risk: CaseRisk;
};

export type CasesResult = {
  risk: CaseRisk;
  multiplier: number;
  itemIndex: number;
  rarity: CasesRarity;
};

/** Validate cases configuration from client. */
export function validateCasesConfig(config: unknown): CasesConfig | null {
  if (!config || typeof config !== 'object') return null;
  const risk = (config as { risk?: unknown }).risk;
  if (typeof risk !== 'string') return null;
  if (!(CASE_RISKS as readonly string[]).includes(risk)) return null;
  return { risk: risk as CaseRisk };
}

/** Weighted-pick the landing item for a given seed + risk. */
export function resolveCases(seed: number, risk: CaseRisk): CasesResult {
  const items: CasesItem[] = CASES_ITEMS[risk];
  const totalWeight = items.reduce((s, it) => s + it.weight, 0);

  const rng = mulberry32(seed);
  const r = rng();
  const target = r * totalWeight;

  let cum = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    cum += item.weight;
    if (target < cum) {
      return {
        risk,
        multiplier: item.mult,
        itemIndex: i,
        rarity: item.rarity,
      };
    }
  }

  // Numerical tail — fall back to last item.
  const last = items[items.length - 1]!;
  return {
    risk,
    multiplier: last.mult,
    itemIndex: items.length - 1,
    rarity: last.rarity,
  };
}

/** Compute payout for the landing item. */
export function computeCasesPayout(
  wager: number,
  multiplier: number,
  seed: number,
): number {
  if (multiplier <= 0) return 0;
  return roundArcadePayout(wager * multiplier, seed, `cases:${multiplier}`);
}
