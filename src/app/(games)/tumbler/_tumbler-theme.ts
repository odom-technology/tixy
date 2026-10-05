/* ──────────────────────────────────────────────────────────────────────────
   Tumbler cosmetic theme.

   The canvas paints with plain hex literals pulled from a TumblerCosmeticTheme
   object. DEFAULT_TUMBLER_THEME reproduces the game's original hard-coded Midway
   palette EXACTLY, so an empty loadout renders identically to before. Equipped
   store cosmetics overlay onto a copy of the default per slot:

     dial       → the polished brass safe-dial + the orbiting marker bead
                  (dialColor, dialAccent, pointerColor) and an optional bead glow
     pegs       → the lit gold target notch
                  (pegColor, pegActiveColor, pegHitColor)
     background → the lacquered-walnut frame + recessed screen well
                  (bgTop, bgBottom, accent)

   buildTumblerTheme(response) folds response.equipped onto the default, reading
   each asset_ref field by name with a fallback to the current value, so partial
   skins (one field) behave gracefully.
   ────────────────────────────────────────────────────────────────────────── */

export type TumblerCosmeticTheme = {
  // Lacquered walnut frame (background slot).
  woodHi: string;
  woodMid: string;
  woodLo: string;
  woodGrain: string;
  // Recessed screen well behind the dial (background slot).
  well: string;
  wellEdge: string;
  // Brass tiers — the safe-dial (dial slot), lit from upper-left.
  brassHi: string;
  brass: string;
  brassMid: string;
  brassLo: string;
  brassDeep: string;
  brassGroove: string;
  // Enamel-red marker bead — the orbiting pointer (dial slot).
  marker: string;
  markerHi: string;
  markerEdge: string;
  // Gold lit target notch (pegs slot).
  notch: string;
  notchHi: string;
  notchEdge: string;
  notchHit: string; // the flash sheen / shard color on a successful pop
  // Deco enamel accents in the frame corners (background slot accent).
  enamelRed: string;
  enamelAmber: string;
  enamelTeal: string;
  // Ink + cream (UI chrome on the canvas).
  ink: string;
  cream: string;
  creamDim: string;
  // Optional, neutral-by-default marker bead glow (dial slot effect).
  dialGlowEnabled: boolean;
  dialGlowColor: string;
};

// The original hard-coded Midway palette. Empty loadout = this, pixel-for-pixel.
export const DEFAULT_TUMBLER_THEME: TumblerCosmeticTheme = {
  woodHi: '#4a3018',
  woodMid: '#33200f',
  woodLo: '#1b1006',
  woodGrain: '#5a3a1c',
  well: '#140f0a',
  wellEdge: '#070503',
  brassHi: '#f6e09a',
  brass: '#d8b257',
  brassMid: '#c19a44',
  brassLo: '#7c5d24',
  brassDeep: '#4d3914',
  brassGroove: '#241a0b',
  marker: '#cb3a3b',
  markerHi: '#ec7a7c',
  markerEdge: '#5e1a1c',
  notch: '#f8c45f',
  notchHi: '#fff1cf',
  notchEdge: '#9a621a',
  notchHit: '#fff1cf',
  enamelRed: '#c33b3c',
  enamelAmber: '#e8a23c',
  enamelTeal: '#2bb2a0',
  ink: '#0c0804',
  cream: '#f7eedd',
  creamDim: '#cdbfa6',
  dialGlowEnabled: false,
  dialGlowColor: '#cb3a3b',
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

export const buildTumblerTheme = (
  response: InventoryCosmeticResponse,
): TumblerCosmeticTheme => {
  const theme: TumblerCosmeticTheme = { ...DEFAULT_TUMBLER_THEME };
  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;

    if (slot === 'dial') {
      // The brass safe-dial. dialColor sets the main metal; dialAccent the bright
      // highlight rim; mids/lows derive from whichever is supplied for cohesion.
      theme.brass = readAssetColor(assetRef, 'dialColor', theme.brass);
      theme.brassMid = readAssetColor(assetRef, 'dialMid', theme.brass);
      theme.brassLo = readAssetColor(assetRef, 'dialLo', theme.brassLo);
      theme.brassHi = readAssetColor(assetRef, 'dialAccent', theme.brassHi);
      theme.brassDeep = readAssetColor(assetRef, 'dialDeep', theme.brassDeep);
      theme.brassGroove = readAssetColor(
        assetRef,
        'dialGroove',
        theme.brassGroove,
      );
      // The orbiting marker bead (the "pointer").
      theme.marker = readAssetColor(assetRef, 'pointerColor', theme.marker);
      theme.markerHi = readAssetColor(assetRef, 'pointerHi', theme.markerHi);
      theme.markerEdge = readAssetColor(
        assetRef,
        'pointerEdge',
        theme.markerEdge,
      );
      // Optional bead glow (off by default).
      theme.dialGlowEnabled = readAssetBool(
        assetRef,
        'dialGlowEnabled',
        theme.dialGlowEnabled,
      );
      theme.dialGlowColor = readAssetColor(
        assetRef,
        'dialGlowColor',
        theme.marker,
      );
    } else if (slot === 'pegs') {
      theme.notch = readAssetColor(assetRef, 'pegColor', theme.notch);
      theme.notchHi = readAssetColor(
        assetRef,
        'pegActiveColor',
        theme.notchHi,
      );
      theme.notchHit = readAssetColor(
        assetRef,
        'pegHitColor',
        readAssetColor(assetRef, 'pegActiveColor', theme.notchHit),
      );
      theme.notchEdge = readAssetColor(assetRef, 'pegEdge', theme.notchEdge);
    } else if (slot === 'background') {
      theme.woodHi = readAssetColor(assetRef, 'bgTop', theme.woodHi);
      theme.woodMid = readAssetColor(assetRef, 'bgMid', theme.woodMid);
      theme.woodLo = readAssetColor(assetRef, 'bgBottom', theme.woodLo);
      theme.woodGrain = readAssetColor(assetRef, 'bgGrain', theme.woodGrain);
      theme.well = readAssetColor(assetRef, 'bgWell', theme.well);
      theme.wellEdge = readAssetColor(assetRef, 'bgWellEdge', theme.wellEdge);
      // A single accent recolors the leading deco-corner band; the other two
      // bands keep the default banding unless explicitly overridden.
      const accent = readAssetColor(assetRef, 'accent', '');
      if (accent) theme.enamelTeal = accent;
      theme.enamelTeal = readAssetColor(
        assetRef,
        'accentTeal',
        theme.enamelTeal,
      );
      theme.enamelAmber = readAssetColor(
        assetRef,
        'accentAmber',
        theme.enamelAmber,
      );
      theme.enamelRed = readAssetColor(assetRef, 'accentRed', theme.enamelRed);
    }
  }
  return theme;
};
