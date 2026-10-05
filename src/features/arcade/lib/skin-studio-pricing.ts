import { roundCreditsPrice, type StoreRarity } from './rewards';

type AssetRef = Record<string, unknown> | null;
type DesirabilityRule = (asset: AssetRef) => boolean;

const readAssetBool = (asset: Record<string, unknown> | null, key: string) =>
  asset?.[key] === true;

const readAssetNumber = (asset: Record<string, unknown> | null, key: string) => {
  const value = asset?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

const readAssetString = (asset: Record<string, unknown> | null, key: string) => {
  const value = asset?.[key];
  return typeof value === 'string' ? value.toLowerCase() : '';
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const countMatchingRules = (asset: AssetRef, rules: DesirabilityRule[]) =>
  rules.reduce((total, rule) => total + (rule(asset) ? 1 : 0), 0);

const hasCustomBoardImage = (asset: AssetRef) =>
  Boolean(
    readAssetString(asset, 'boardImageUrl') ||
      readAssetString(asset, 'imageUrl') ||
      readAssetString(asset, 'image'),
  );

const hasCustomStringValue = (
  asset: AssetRef,
  keys: readonly string[],
  defaultValue: string,
) => {
  const value = keys.map((key) => readAssetString(asset, key)).find(Boolean);
  return Boolean(value && value !== defaultValue);
};

const desirabilityRulesBySlot: Record<string, DesirabilityRule[]> = {
  body: [
    (asset) => readAssetBool(asset, 'bodyGlowEnabled'),
    (asset) => readAssetString(asset, 'bodyGlowStyle') !== 'none',
    (asset) => readAssetString(asset, 'bodyPatternStyle') !== 'none',
    (asset) => readAssetString(asset, 'bodyGradient') !== 'flat',
  ],
  board: [
    hasCustomBoardImage,
    (asset) => readAssetBool(asset, 'boardTileGradientEnabled'),
    (asset) => readAssetBool(asset, 'boardGlobalGradientEnabled'),
    (asset) => readAssetNumber(asset, 'boardGridLineWidth') >= 1,
    (asset) => readAssetNumber(asset, 'boardVignette') >= 20,
  ],
  food: [
    (asset) => readAssetBool(asset, 'foodGlowEnabled'),
    (asset) => ['diamond', 'orb'].includes(readAssetString(asset, 'foodShape')),
    (asset) => readAssetNumber(asset, 'foodPulse') >= 50,
    (asset) => readAssetNumber(asset, 'foodSize') >= 110,
  ],
  theme: [
    (asset) =>
      hasCustomStringValue(asset, ['themeBackgroundColor', 'backgroundColor'], '#0f172a'),
    (asset) => hasCustomStringValue(asset, ['themeSurfaceColor', 'panelBg'], '#1e1e2e'),
    (asset) => hasCustomStringValue(asset, ['themeAccentColor', 'uiAccentColor'], '#facc15'),
    (asset) =>
      hasCustomStringValue(asset, ['themeErrorColor', 'missEffectColor'], '#ef4444'),
    (asset) => hasCustomStringValue(asset, ['themeSuccessColor'], '#22c55e'),
    (asset) => hasCustomStringValue(asset, ['hudFrameStyle'], 'minimal'),
    (asset) => hasCustomStringValue(asset, ['hudMeterStyle'], 'none'),
    (asset) => readAssetNumber(asset, 'hudShadowStrength') >= 40,
  ],
  'text-style': [
    (asset) => readAssetString(asset, 'textFontFamily') !== 'mono',
    (asset) => readAssetNumber(asset, 'textFontWeight') >= 600,
    (asset) => Math.abs(readAssetNumber(asset, 'textLetterSpacing')) >= 0.5,
    (asset) => readAssetString(asset, 'textCurrentWordStyle') !== 'none',
  ],
  caret: [
    (asset) => readAssetString(asset, 'caretType') !== 'bar',
    (asset) => readAssetNumber(asset, 'caretGlowStrength') >= 30,
    (asset) => readAssetString(asset, 'caretPulseMode') !== 'none',
    (asset) => readAssetBool(asset, 'caretTrailEnabled'),
  ],
  feedback: [
    (asset) => readAssetString(asset, 'feedbackStyle') !== 'none',
    (asset) => readAssetNumber(asset, 'feedbackStrength') >= 50,
    (asset) => readAssetNumber(asset, 'feedbackDurationMs') >= 200,
    (asset) => readAssetBool(asset, 'feedbackParticlesEnabled'),
  ],
};

const computeDesirability = (slot: string, asset: AssetRef) =>
  countMatchingRules(asset, desirabilityRulesBySlot[slot] ?? []);

const basePriceByRarity: Record<
  Exclude<StoreRarity, 'legendary'>,
  { default: number; slots?: Record<string, number> }
> = {
  common: { default: 420, slots: { food: 560 } },
  rare: { default: 650, slots: { board: 700, food: 760 } },
  epic: { default: 1025, slots: { food: 1125 } },
};

const bumpByRarity: Record<Exclude<StoreRarity, 'legendary'>, { max: number; step: number }> = {
  common: { max: 3, step: 15 },
  rare: { max: 4, step: 20 },
  epic: { max: 5, step: 25 },
};

const priceBoundsByRarity: Record<Exclude<StoreRarity, 'legendary'>, [number, number]> = {
  common: [400, 600],
  rare: [600, 850],
  epic: [950, 1250],
};

const getBasePrice = (rarity: Exclude<StoreRarity, 'legendary'>, slot: string) => {
  const priceConfig = basePriceByRarity[rarity];
  return priceConfig.slots?.[slot] ?? priceConfig.default;
};

const getDesirabilityBump = (
  rarity: Exclude<StoreRarity, 'legendary'>,
  desirability: number,
) => {
  const { max, step } = bumpByRarity[rarity];
  return step * Math.min(desirability, max);
};

const clampPrice = (rarity: Exclude<StoreRarity, 'legendary'>, price: number) => {
  const [min, max] = priceBoundsByRarity[rarity];
  return clamp(price, min, max);
};

export const LEGENDARY_CREDITS_PRICE = 2000;

export const computeCreditsItemPriceForSkinStudio = ({
  rarity,
  slot,
  assetRef,
}: {
  rarity: StoreRarity;
  slot: string | null;
  assetRef: Record<string, unknown> | null;
}) => {
  // A legendary costs the same 2,000 tickets the deploy seeds give every
  // seeded legendary (PRICE_BY_RARITY in scripts/seed-cosmetics.ts). It used to
  // return 0, and a free item could be bought once a deploy stopped repricing it.
  if (rarity === 'legendary') return LEGENDARY_CREDITS_PRICE;

  const slotKey = slot ?? '';
  const desirability = computeDesirability(slotKey, assetRef);
  const rawPrice =
    getBasePrice(rarity, slotKey) + getDesirabilityBump(rarity, desirability);

  return roundCreditsPrice(clampPrice(rarity, rawPrice));
};
