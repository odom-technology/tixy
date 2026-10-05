/* ──────────────────────────────────────────────────────────────────────────
   Melon Chop cosmetic theme.

   The canvas paints with plain hex literals pulled from a MelonChopTheme object.
   DEFAULT_MELON_CHOP_THEME reproduces the game's original hard-coded Midway
   palette EXACTLY, so an empty loadout renders identically to before. Equipped
   store cosmetics overlay onto a copy of the default per slot:

     blade    → the swipe trail (trailColor, trailCore) + an optional blade glow
     fruit    → the fruit set body/highlight per variant (fruitBody0..4,
                fruitHi0..4) + the leaf tint
     splatter → the juice-splatter particle tint (juiceColor, juiceHiColor)

   buildMelonChopTheme(response) folds response.equipped onto the default,
   reading each asset_ref field by name with a fallback to the current value, so
   partial skins (one field) behave gracefully.
   ────────────────────────────────────────────────────────────────────────── */

export type MelonChopTheme = {
  // Booth backdrop (canvas board + enamel bunting) — always default (no slot).
  bgTop: string;
  bgBottom: string;
  board: string;
  boardLine: string;
  buntingRed: string;
  buntingAmber: string;
  buntingTeal: string;
  // Swipe trail (blade slot).
  trail: string;
  trailCore: string;
  bladeGlowEnabled: boolean;
  bladeGlowColor: string;
  // Fruit set (fruit slot): a body + highlight per variant, plus a shared leaf.
  fruitBody: string[]; // length MELON_FRUIT_VARIANTS
  fruitHi: string[];
  fruitRind: string;
  leaf: string;
  // Juice splatter (splatter slot).
  juice: string;
  juiceHi: string;
  // Bomb (always default — a bomb must always read as danger, not re-skinnable).
  bombBody: string;
  bombBodyHi: string;
  bombFuse: string;
  bombSpark: string;
  // Ink + cream (UI chrome on the canvas).
  ink: string;
  cream: string;
  creamDim: string;
};

// The original hard-coded Midway palette. Empty loadout = this, pixel-for-pixel.
export const DEFAULT_MELON_CHOP_THEME: MelonChopTheme = {
  bgTop: '#123028',
  bgBottom: '#071612',
  board: '#1c4034',
  boardLine: '#0c2019',
  buntingRed: '#c33b3c',
  buntingAmber: '#e8a23c',
  buntingTeal: '#2bb2a0',
  trail: '#f7eedd',
  trailCore: '#ffffff',
  bladeGlowEnabled: false,
  bladeGlowColor: '#f7eedd',
  fruitBody: ['#d63b56', '#f2a13c', '#8ec63f', '#7b5cd6', '#2bb2a0'],
  fruitHi: ['#ff8aa0', '#ffd08a', '#c9f08a', '#c3b0ff', '#8fe6da'],
  fruitRind: '#3c8a4a',
  leaf: '#4fae52',
  juice: '#e34d63',
  juiceHi: '#ffd7de',
  bombBody: '#26201c',
  bombBodyHi: '#4a3f38',
  bombFuse: '#c98a4a',
  bombSpark: '#ffcf6b',
  ink: '#08110d',
  cream: '#f7eedd',
  creamDim: '#c7bda6',
};

export type InventoryCosmeticResponse = {
  wallet?: { credits?: number };
  dailyGameCredits?: { earned?: number; cap?: number };
  equipped?: Array<{
    slot?: string;
    item?: {
      assetRef?: Record<string, unknown> | null;
    } | null;
  }>;
};

const readAssetColor = (
  assetRef: Record<string, unknown> | null | undefined,
  key: string,
  fallback: string,
) => {
  const value = assetRef?.[key];
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : fallback;
};

const readAssetBool = (
  assetRef: Record<string, unknown> | null | undefined,
  key: string,
  fallback: boolean,
) => {
  const value = assetRef?.[key];
  return typeof value === 'boolean' ? value : fallback;
};

export const buildMelonChopTheme = (
  response: InventoryCosmeticResponse,
): MelonChopTheme => {
  const theme: MelonChopTheme = {
    ...DEFAULT_MELON_CHOP_THEME,
    fruitBody: [...DEFAULT_MELON_CHOP_THEME.fruitBody],
    fruitHi: [...DEFAULT_MELON_CHOP_THEME.fruitHi],
  };
  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;

    if (slot === 'blade') {
      theme.trail = readAssetColor(assetRef, 'trailColor', theme.trail);
      theme.trailCore = readAssetColor(assetRef, 'trailCore', theme.trailCore);
      theme.bladeGlowEnabled = readAssetBool(
        assetRef,
        'bladeGlowEnabled',
        theme.bladeGlowEnabled,
      );
      theme.bladeGlowColor = readAssetColor(
        assetRef,
        'bladeGlowColor',
        theme.trail,
      );
    } else if (slot === 'fruit') {
      for (let i = 0; i < theme.fruitBody.length; i += 1) {
        theme.fruitBody[i] = readAssetColor(
          assetRef,
          `fruitBody${i}`,
          theme.fruitBody[i]!,
        );
        theme.fruitHi[i] = readAssetColor(
          assetRef,
          `fruitHi${i}`,
          theme.fruitHi[i]!,
        );
      }
      theme.leaf = readAssetColor(assetRef, 'leaf', theme.leaf);
      theme.fruitRind = readAssetColor(assetRef, 'fruitRind', theme.fruitRind);
    } else if (slot === 'splatter') {
      theme.juice = readAssetColor(assetRef, 'juiceColor', theme.juice);
      theme.juiceHi = readAssetColor(assetRef, 'juiceHiColor', theme.juiceHi);
    }
  }
  return theme;
};
