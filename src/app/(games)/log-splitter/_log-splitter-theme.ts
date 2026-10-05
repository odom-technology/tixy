/* ──────────────────────────────────────────────────────────────────────────
   Log Splitter cosmetic theme.

   The canvas paints with plain hex literals pulled from a LogSplitterCosmeticTheme
   object. DEFAULT_LOG_SPLITTER_THEME reproduces the game's original hard-coded
   Midway palette EXACTLY, so an empty loadout renders identically. Equipped store
   cosmetics overlay onto a copy of the default per slot:

     axe        → the lumberjack's axe blade + handle + flannel accent
                  (bladeColor, bladeHi, bladeEdge, handleColor, shirtColor) and
                  an optional blade glow
     tree       → trunk bark + descending branches + cut-end ring
                  (barkColor, barkHi, barkLo, grain, branchColor, branchHi,
                  branchEdge, ring)
     background → the sky gradient + ground band (skyTop, skyBottom, ground,
                  groundEdge, accent)
     effects    → flying wood-chip particles (chipColor, chipColorAlt, flashColor)

   buildLogSplitterTheme(response) folds response.equipped onto the default,
   reading each asset_ref field by name with a fallback to the current value, so
   partial skins behave gracefully.
   ────────────────────────────────────────────────────────────────────────── */

export type LogSplitterCosmeticTheme = {
  // Sky + ground (background slot).
  skyTop: string;
  skyBottom: string;
  ground: string;
  groundEdge: string;
  accent: string;
  // Trunk + branches (tree slot).
  barkColor: string;
  barkHi: string;
  barkLo: string;
  grain: string;
  ring: string;
  branchColor: string;
  branchHi: string;
  branchEdge: string;
  // Lumberjack + axe (axe slot).
  bladeColor: string;
  bladeHi: string;
  bladeEdge: string;
  handleColor: string;
  shirtColor: string;
  skinColor: string;
  // Wood-chip particles + hit flash (effects slot).
  chipColor: string;
  chipColorAlt: string;
  flashColor: string;
  // UI chrome on the canvas.
  ink: string;
  cream: string;
  // Optional, off-by-default axe-blade glow (axe slot effect).
  axeGlowEnabled: boolean;
  axeGlowColor: string;
};

// The original hard-coded Midway palette. Empty loadout = this, pixel-for-pixel.
export const DEFAULT_LOG_SPLITTER_THEME: LogSplitterCosmeticTheme = {
  skyTop: '#2c4a63',
  skyBottom: '#7a9db0',
  ground: '#3f2d1a',
  groundEdge: '#241609',
  accent: '#f2d98a',
  barkColor: '#7c5a3a',
  barkHi: '#9c7a52',
  barkLo: '#4e3820',
  grain: '#5e4326',
  ring: '#d8b98f',
  branchColor: '#8a6440',
  branchHi: '#ad8558',
  branchEdge: '#4a3018',
  bladeColor: '#c7cdd4',
  bladeHi: '#eef2f6',
  bladeEdge: '#5b626b',
  handleColor: '#8a5a2b',
  shirtColor: '#c0392b',
  skinColor: '#e0a878',
  chipColor: '#e8c07a',
  chipColorAlt: '#b98a4e',
  flashColor: '#fff1cf',
  ink: '#0c0804',
  cream: '#f7eedd',
  axeGlowEnabled: false,
  axeGlowColor: '#7fd3f0',
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

export const buildLogSplitterTheme = (
  response: InventoryCosmeticResponse,
): LogSplitterCosmeticTheme => {
  const theme: LogSplitterCosmeticTheme = { ...DEFAULT_LOG_SPLITTER_THEME };
  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;

    if (slot === 'axe') {
      theme.bladeColor = readAssetColor(assetRef, 'bladeColor', theme.bladeColor);
      theme.bladeHi = readAssetColor(assetRef, 'bladeHi', theme.bladeHi);
      theme.bladeEdge = readAssetColor(assetRef, 'bladeEdge', theme.bladeEdge);
      theme.handleColor = readAssetColor(assetRef, 'handleColor', theme.handleColor);
      theme.shirtColor = readAssetColor(assetRef, 'shirtColor', theme.shirtColor);
      theme.axeGlowEnabled = readAssetBool(assetRef, 'axeGlowEnabled', theme.axeGlowEnabled);
      theme.axeGlowColor = readAssetColor(assetRef, 'axeGlowColor', theme.bladeColor);
    } else if (slot === 'tree') {
      theme.barkColor = readAssetColor(assetRef, 'barkColor', theme.barkColor);
      theme.barkHi = readAssetColor(assetRef, 'barkHi', theme.barkHi);
      theme.barkLo = readAssetColor(assetRef, 'barkLo', theme.barkLo);
      theme.grain = readAssetColor(assetRef, 'grain', theme.grain);
      theme.ring = readAssetColor(assetRef, 'ring', theme.ring);
      theme.branchColor = readAssetColor(assetRef, 'branchColor', theme.branchColor);
      theme.branchHi = readAssetColor(assetRef, 'branchHi', theme.branchHi);
      theme.branchEdge = readAssetColor(assetRef, 'branchEdge', theme.branchEdge);
    } else if (slot === 'background') {
      theme.skyTop = readAssetColor(assetRef, 'skyTop', theme.skyTop);
      theme.skyBottom = readAssetColor(assetRef, 'skyBottom', theme.skyBottom);
      theme.ground = readAssetColor(assetRef, 'ground', theme.ground);
      theme.groundEdge = readAssetColor(assetRef, 'groundEdge', theme.groundEdge);
      theme.accent = readAssetColor(assetRef, 'accent', theme.accent);
    } else if (slot === 'effects') {
      theme.chipColor = readAssetColor(assetRef, 'chipColor', theme.chipColor);
      theme.chipColorAlt = readAssetColor(assetRef, 'chipColorAlt', theme.chipColorAlt);
      theme.flashColor = readAssetColor(assetRef, 'flashColor', theme.flashColor);
    }
  }
  return theme;
};
