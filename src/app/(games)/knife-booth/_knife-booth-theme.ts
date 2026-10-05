/* ──────────────────────────────────────────────────────────────────────────
   Knife Booth cosmetic theme.

   The canvas paints with plain hex literals pulled from a KnifeBoothTheme object.
   DEFAULT_KNIFE_BOOTH_THEME reproduces the game's original hard-coded Midway
   palette EXACTLY, so an empty loadout renders identically to before. Equipped
   store cosmetics overlay onto a copy of the default per slot:

     knife    → the thrown blade + handle (bladeColor, bladeEdge, handleColor,
                handleAccent) and an optional blade glow
     target   → the spinning wooden target (woodColor, woodHi, woodLo, ringColor,
                bullColor)
     effects  → the stick-thunk spark burst + bonus-fruit tint
                (sparkColor, sparkHotColor, fruitColor)

   buildKnifeBoothTheme(response) folds response.equipped onto the default,
   reading each asset_ref field by name with a fallback to the current value, so
   partial skins (one field) behave gracefully.
   ────────────────────────────────────────────────────────────────────────── */

export type KnifeBoothTheme = {
  // Booth backdrop (canvas planks + enamel bunting) — always default (no slot).
  bgTop: string;
  bgBottom: string;
  plank: string;
  plankLine: string;
  buntingRed: string;
  buntingAmber: string;
  buntingTeal: string;
  // Spinning wooden target (target slot).
  woodHi: string;
  wood: string;
  woodLo: string;
  woodEdge: string;
  ring: string; // concentric grain rings
  bull: string; // bullseye hub
  bullEdge: string;
  // Thrown + lodged knives (knife slot).
  bladeHi: string;
  blade: string;
  bladeLo: string;
  bladeEdge: string;
  handle: string;
  handleHi: string;
  handleEdge: string;
  // Pre-placed obstacle knives are a dimmer tint of the blade (derived).
  obstacleBlade: string;
  obstacleHandle: string;
  // Bonus fruit (effects slot).
  fruit: string;
  fruitHi: string;
  fruitLeaf: string;
  // Stick-thunk spark burst (effects slot).
  spark: string;
  sparkHot: string;
  // Ink + cream (UI chrome on the canvas).
  ink: string;
  cream: string;
  creamDim: string;
  // Optional, neutral-by-default blade glow (knife slot effect).
  knifeGlowEnabled: boolean;
  knifeGlowColor: string;
};

// The original hard-coded Midway palette. Empty loadout = this, pixel-for-pixel.
export const DEFAULT_KNIFE_BOOTH_THEME: KnifeBoothTheme = {
  bgTop: '#2a1a10',
  bgBottom: '#140c06',
  plank: '#3a2616',
  plankLine: '#1c120a',
  buntingRed: '#c33b3c',
  buntingAmber: '#e8a23c',
  buntingTeal: '#2bb2a0',
  woodHi: '#c98f52',
  wood: '#a5703c',
  woodLo: '#6f4a24',
  woodEdge: '#3c2712',
  ring: '#815631',
  bull: '#c8402f',
  bullEdge: '#7c1f18',
  bladeHi: '#f4f7fb',
  blade: '#c7d0da',
  bladeLo: '#8b95a1',
  bladeEdge: '#4b525c',
  handle: '#8a3b22',
  handleHi: '#c1613d',
  handleEdge: '#3c1a0f',
  obstacleBlade: '#9aa3ad',
  obstacleHandle: '#5c4633',
  fruit: '#d63b56',
  fruitHi: '#ff8aa0',
  fruitLeaf: '#4fae52',
  spark: '#f8c45f',
  sparkHot: '#fff1cf',
  ink: '#0c0804',
  cream: '#f7eedd',
  creamDim: '#cdbfa6',
  knifeGlowEnabled: false,
  knifeGlowColor: '#c7d0da',
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

export const buildKnifeBoothTheme = (
  response: InventoryCosmeticResponse,
): KnifeBoothTheme => {
  const theme: KnifeBoothTheme = { ...DEFAULT_KNIFE_BOOTH_THEME };
  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;

    if (slot === 'knife') {
      theme.blade = readAssetColor(assetRef, 'bladeColor', theme.blade);
      theme.bladeHi = readAssetColor(assetRef, 'bladeHi', theme.bladeHi);
      theme.bladeLo = readAssetColor(assetRef, 'bladeLo', theme.bladeLo);
      theme.bladeEdge = readAssetColor(assetRef, 'bladeEdge', theme.bladeEdge);
      theme.handle = readAssetColor(assetRef, 'handleColor', theme.handle);
      theme.handleHi = readAssetColor(assetRef, 'handleAccent', theme.handleHi);
      theme.handleEdge = readAssetColor(assetRef, 'handleEdge', theme.handleEdge);
      // Lodged obstacle knives borrow the equipped blade at a muted tone by
      // default (so a full board still reads as "the same kind of knife").
      theme.obstacleBlade = readAssetColor(
        assetRef,
        'obstacleBlade',
        theme.blade,
      );
      theme.knifeGlowEnabled = readAssetBool(
        assetRef,
        'knifeGlowEnabled',
        theme.knifeGlowEnabled,
      );
      theme.knifeGlowColor = readAssetColor(
        assetRef,
        'knifeGlowColor',
        theme.blade,
      );
    } else if (slot === 'target') {
      theme.wood = readAssetColor(assetRef, 'woodColor', theme.wood);
      theme.woodHi = readAssetColor(assetRef, 'woodHi', theme.woodHi);
      theme.woodLo = readAssetColor(assetRef, 'woodLo', theme.woodLo);
      theme.woodEdge = readAssetColor(assetRef, 'woodEdge', theme.woodEdge);
      theme.ring = readAssetColor(assetRef, 'ringColor', theme.ring);
      theme.bull = readAssetColor(assetRef, 'bullColor', theme.bull);
      theme.bullEdge = readAssetColor(assetRef, 'bullEdge', theme.bullEdge);
    } else if (slot === 'effects') {
      theme.spark = readAssetColor(assetRef, 'sparkColor', theme.spark);
      theme.sparkHot = readAssetColor(assetRef, 'sparkHotColor', theme.sparkHot);
      theme.fruit = readAssetColor(assetRef, 'fruitColor', theme.fruit);
      theme.fruitHi = readAssetColor(assetRef, 'fruitHi', theme.fruitHi);
      theme.fruitLeaf = readAssetColor(assetRef, 'fruitLeaf', theme.fruitLeaf);
    }
  }
  return theme;
};
