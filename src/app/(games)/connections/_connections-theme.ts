import type { CSSProperties } from 'react';

/* ──────────────────────────────────────────────────────────────────────
   Connections cosmetic theme.

   Connections is DOM/CSS-rendered. The base look lives in the route-scoped
   stylesheet _connections-midway.css (imported by page.tsx) and is painted from Midway CSS tokens via
   `var(--token, #fallback)`. To layer equipped cosmetics on top without
   disturbing the live Midway sub-theme, each themeable color is also wired
   to a connections-specific CSS variable that FALLS BACK to the existing
   token expression, e.g.:

       var(--cn-group-1, var(--enamel-tickets, #f2a33c))

   When nothing is equipped we emit NO `--cn-*` variables, so the render is
   byte-identical to today (it still tracks the live Midway tokens). When a
   cosmetic is equipped we set the relevant `--cn-*` variables on a wrapper
   element and they win.

   Slots:
     tiles  → word-tile colors (tileBg/tileText, selectedTileBg/selectedTileText)
              and the 4 category/difficulty group colors (groupColor1..4).
     accent → primary accent (focus ring) + mistakes/lives dots.
   ────────────────────────────────────────────────────────────────────── */

export type ConnectionsCosmeticTheme = {
  // tiles slot
  tileBg: string;
  tileText: string;
  selectedTileBg: string;
  selectedTileText: string;
  groupColor1: string;
  groupColor2: string;
  groupColor3: string;
  groupColor4: string;
  // accent slot
  accentColor: string;
  mistakeColor: string;
};

/* These literals mirror the current hardcoded fallbacks in page.tsx EXACTLY.
   An empty loadout produces zero CSS-variable overrides (see
   connectionsThemeToCssVars), so the default render is unchanged. */
export const DEFAULT_CONNECTIONS_THEME: ConnectionsCosmeticTheme = {
  tileBg: '#f6eddc', // --key-face
  tileText: '#1b140d', // --key-face-on
  selectedTileBg: '#f2a33c', // --enamel-tickets
  selectedTileText: '#2a1b06', // --enamel-tickets-on
  groupColor1: '#f2a33c', // --enamel-tickets
  groupColor2: '#2fb8a6', // --enamel-prize
  groupColor3: '#6c8fe0', // --enamel-info
  groupColor4: '#c73538', // --enamel-primary
  accentColor: '#f2a33c', // --focus-ring
  mistakeColor: '#c73538', // --enamel-primary
};

type InventoryCosmeticResponse = {
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

/* Lighten a #rrggbb hex toward white by `amt` (0..1). Used to derive the
   top stop of the beveled tile/band gradients from a single equipped color
   so skinned surfaces keep a subtle highlight. Non-hex inputs return as-is. */
const lighten = (hex: string, amt: number): string => {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const mix = (c: number) => Math.round(c + (255 - c) * amt);
  const to2 = (c: number) => c.toString(16).padStart(2, '0');
  return `#${to2(mix(r))}${to2(mix(g))}${to2(mix(b))}`;
};

export const buildConnectionsTheme = (
  response: InventoryCosmeticResponse,
): ConnectionsCosmeticTheme => {
  const theme: ConnectionsCosmeticTheme = { ...DEFAULT_CONNECTIONS_THEME };
  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;
    if (slot === 'tiles') {
      theme.tileBg = readAssetColor(assetRef, 'tileBg', theme.tileBg);
      theme.tileText = readAssetColor(assetRef, 'tileText', theme.tileText);
      theme.selectedTileBg = readAssetColor(
        assetRef,
        'selectedTileBg',
        theme.selectedTileBg,
      );
      theme.selectedTileText = readAssetColor(
        assetRef,
        'selectedTileText',
        theme.selectedTileText,
      );
      theme.groupColor1 = readAssetColor(
        assetRef,
        'groupColor1',
        theme.groupColor1,
      );
      theme.groupColor2 = readAssetColor(
        assetRef,
        'groupColor2',
        theme.groupColor2,
      );
      theme.groupColor3 = readAssetColor(
        assetRef,
        'groupColor3',
        theme.groupColor3,
      );
      theme.groupColor4 = readAssetColor(
        assetRef,
        'groupColor4',
        theme.groupColor4,
      );
    } else if (slot === 'accent') {
      theme.accentColor = readAssetColor(
        assetRef,
        'accentColor',
        theme.accentColor,
      );
      theme.mistakeColor = readAssetColor(
        assetRef,
        'mistakeColor',
        theme.mistakeColor,
      );
    }
  }
  return theme;
};

/* Emit ONLY the CSS variables that differ from default, so an empty loadout
   sets nothing and the live Midway-token render is preserved. For gradient
   surfaces we also set a lightened `-hi` companion var for the top stop. */
export const connectionsThemeToCssVars = (
  theme: ConnectionsCosmeticTheme,
): CSSProperties => {
  const vars: Record<string, string> = {};
  const d = DEFAULT_CONNECTIONS_THEME;
  if (theme.tileBg !== d.tileBg) {
    vars['--cn-tile-bg'] = theme.tileBg;
    vars['--cn-tile-bg-hi'] = lighten(theme.tileBg, 0.18);
  }
  if (theme.tileText !== d.tileText) vars['--cn-tile-text'] = theme.tileText;
  if (theme.selectedTileBg !== d.selectedTileBg) {
    vars['--cn-sel-bg'] = theme.selectedTileBg;
    vars['--cn-sel-bg-hi'] = lighten(theme.selectedTileBg, 0.18);
  }
  if (theme.selectedTileText !== d.selectedTileText) {
    vars['--cn-sel-text'] = theme.selectedTileText;
  }
  if (theme.groupColor1 !== d.groupColor1) {
    vars['--cn-group-1'] = theme.groupColor1;
    vars['--cn-group-1-hi'] = lighten(theme.groupColor1, 0.18);
  }
  if (theme.groupColor2 !== d.groupColor2) {
    vars['--cn-group-2'] = theme.groupColor2;
    vars['--cn-group-2-hi'] = lighten(theme.groupColor2, 0.18);
  }
  if (theme.groupColor3 !== d.groupColor3) {
    vars['--cn-group-3'] = theme.groupColor3;
    vars['--cn-group-3-hi'] = lighten(theme.groupColor3, 0.18);
  }
  if (theme.groupColor4 !== d.groupColor4) {
    vars['--cn-group-4'] = theme.groupColor4;
    vars['--cn-group-4-hi'] = lighten(theme.groupColor4, 0.18);
  }
  if (theme.accentColor !== d.accentColor) vars['--cn-accent'] = theme.accentColor;
  if (theme.mistakeColor !== d.mistakeColor) {
    vars['--cn-mistake'] = theme.mistakeColor;
  }
  return vars as CSSProperties;
};
