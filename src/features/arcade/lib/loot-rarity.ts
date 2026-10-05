/**
 * Rarity tiers for the loot games (packs, cases): one shared structure,
 * per-game palettes.
 *
 * The palettes are deliberately NOT merged — the games are themed
 * independently, e.g. "mythic" is rose (#f43f5e) in packs but orange
 * (#f97316) in cases, and each game has tiers the other lacks. Changing
 * any color value here changes rendered pixels; treat them as frozen.
 */

export type RarityTier = {
  label: string;
  /** Solid accent color — borders, labels, canvas strokes. */
  solid: string;
  /** `solid` as [r, g, b] for alpha compositing. */
  rgb: [number, number, number];
};

/** Packs card faces carry extra CSS on top of the base tier. */
export type CardRarityStyle = RarityTier & {
  /** Card-face background. */
  bg: string;
  /** Box-shadow glow behind revealed cards. */
  glow: string;
  /** Card text color. */
  text: string;
};

export type PackRarity =
  | 'dud'
  | 'common'
  | 'uncommon'
  | 'rare'
  | 'epic'
  | 'legendary'
  | 'ultra'
  | 'mythic';

export type CaseRarity =
  | 'loss'
  | 'common'
  | 'uncommon'
  | 'rare'
  | 'mythic'
  | 'legendary'
  | 'covert';

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function tier(label: string, solid: string): RarityTier {
  return { label, solid, rgb: hexToRgb(solid) };
}

function cardStyle(
  label: string,
  solid: string,
  bg: string,
  glow: string,
  text: string,
): CardRarityStyle {
  return { ...tier(label, solid), bg, glow, text };
}

export const PACK_RARITY_STYLES: Record<PackRarity, CardRarityStyle> = {
  dud:       cardStyle('DUD',       '#475569', 'linear-gradient(145deg, #1e293b 0%, #0f172a 100%)', 'none',                                '#64748b'),
  common:    cardStyle('COMMON',    '#60a5fa', 'linear-gradient(145deg, #1e3a5f 0%, #172554 100%)', '0 0 12px rgba(96,165,250,0.3)',       '#93c5fd'),
  uncommon:  cardStyle('UNCOMMON',  '#a78bfa', 'linear-gradient(145deg, #312e81 0%, #1e1b4b 100%)', '0 0 16px rgba(167,139,250,0.35)',     '#c4b5fd'),
  rare:      cardStyle('RARE',      '#ec4899', 'linear-gradient(145deg, #831843 0%, #500724 100%)', '0 0 20px rgba(236,72,153,0.4)',       '#f9a8d4'),
  epic:      cardStyle('EPIC',      '#f97316', 'linear-gradient(145deg, #7c2d12 0%, #431407 100%)', '0 0 24px rgba(249,115,22,0.45)',      '#fdba74'),
  legendary: cardStyle('LEGENDARY', '#fbbf24', 'linear-gradient(145deg, #78350f 0%, #451a03 100%)', '0 0 30px rgba(251,191,36,0.5)',       '#fde68a'),
  ultra:     cardStyle('ULTRA',     '#22d3ee', 'linear-gradient(145deg, #164e63 0%, #0c2d3f 100%)', '0 0 36px rgba(34,211,238,0.5)',       '#a5f3fc'),
  mythic:    cardStyle('MYTHIC',    '#f43f5e', 'linear-gradient(145deg, #4c0519 0%, #1a0006 100%)', '0 0 50px rgba(244,63,94,0.6)',        '#fda4af'),
};

export const CASE_RARITY_COLORS: Record<CaseRarity, RarityTier> = {
  loss:      tier('BUST',      '#64748b'),
  common:    tier('COMMON',    '#60a5fa'),
  uncommon:  tier('UNCOMMON',  '#a78bfa'),
  rare:      tier('RARE',      '#ec4899'),
  mythic:    tier('MYTHIC',    '#f97316'),
  legendary: tier('LEGENDARY', '#fbbf24'),
  covert:    tier('COVERT',    '#ef4444'),
};

export function rarityRgba(rarityTier: RarityTier, alpha: number): string {
  const [r, g, b] = rarityTier.rgb;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
