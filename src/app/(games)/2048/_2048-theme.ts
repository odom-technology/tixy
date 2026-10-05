import { contrastRatio, findEquippedSkinSet, mixHex, readableOn, type SkinSet } from '@/features/arcade/lib/skins/skin-set';

import type {
  Game2048CosmeticTheme,
  GradientDirection,
  InventoryCosmeticResponse,
  TileColor,
} from './_2048-types';

export const DEFAULT_2048_THEME: Game2048CosmeticTheme = {
  // Tiles step up the tixy palette as they grow: paper, paper 2, paper 3,
  // then ticket amber, then red (docs/design/tixy-rebrand/PLAN.md). The
  // steps between are mixes of the neighbouring palette colours, spread so
  // 128 to 1024 are four different oranges and reds. Ink numbers up to 512,
  // paper numbers from 1024; every pair clears 4:1 and the numerals are
  // large. The two darkest tiles (2048 and 4096 and up) carry a paper ring so
  // they read against the grid. The board is an ink cabinet in every theme,
  // so these are fixed hex values, not theme tokens.
  tileColors: {
    2: { bg: '#f4ebdc', fg: '#1f1a16' }, // paper
    4: { bg: '#eadfcb', fg: '#1f1a16' }, // paper 2
    8: { bg: '#ded0b7', fg: '#1f1a16' }, // paper 3
    16: { bg: '#e5c08c', fg: '#1f1a16' },
    32: { bg: '#ecb061', fg: '#1f1a16' },
    64: { bg: '#f2a33c', fg: '#1f1a16' }, // ticket amber
    128: { bg: '#e88f38', fg: '#1f1a16' },
    256: { bg: '#dc7a34', fg: '#1f1a16' },
    512: { bg: '#cf622f', fg: '#1f1a16' },
    1024: { bg: '#c34a2a', fg: '#f4ebdc' },
    2048: { bg: '#a12e20', fg: '#f4ebdc', edge: '#f4ebdc' }, // red
  },
  tileFallback: { bg: '#6a2016', fg: '#f4ebdc', edge: '#ded0b7' },
  mergePulseEnabled: true,
  spawnAnimEnabled: true,
  // Tiles slide in 100 ms (an equipped skin can still set 60 to 260).
  slideDurationMs: 100,
  // Keep the glow effect available for equipped skins but off by default
  // (size 0 = no glow).
  glowThreshold: 0,
  glowColor: '#f2a33c',
  glowSize: 0,
  glowPulse: false,
  // The board sits in the ink screen: a darker well with lighter empty cells.
  gridBg: '#1f1a16',
  gridBorder: '#3a3029',
  cellBg: '#f4ebdc14',
  // The screen behind the board; equipped backgrounds can override it.
  containerBg: '#2a231d',
  containerBorder: '#1f1a16',
  containerGradientEnabled: false,
  containerGradientStart: '#0f172a',
  containerGradientEnd: '#1e293b',
  containerGradientDirection: 'diagonal',
  skin: null,
};

const TILE_TIERS = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048] as const;

/* A skin set's board material as CSS background layers: flat, hard-edged
   patterns over the board colour. */
export const materialBackground = (
  theme: Game2048CosmeticTheme,
): { backgroundImage?: string; backgroundSize?: string } => {
  const skin = theme.skin;
  if (!skin) return {};
  const line = skin.line;
  switch (skin.material) {
    case 'planks':
      return { backgroundImage: `repeating-linear-gradient(180deg, transparent 0 calc(12.5% - 2px), ${line} calc(12.5% - 2px) 12.5%)` };
    case 'paper':
      return { backgroundImage: `repeating-linear-gradient(180deg, transparent 0 calc(6.25% - 1px), ${line} calc(6.25% - 1px) 6.25%)` };
    case 'felt':
      return { backgroundImage: `radial-gradient(circle, ${line} 0.9px, transparent 1.2px)`, backgroundSize: '7px 7px' };
    default:
      return {};
  }
};

const readAssetString = (
  assetRef: Record<string, unknown> | null | undefined,
  key: string,
  fallback: string,
): string => {
  const value = assetRef?.[key];
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : fallback;
};

const readAssetNumber = (
  assetRef: Record<string, unknown> | null | undefined,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number => {
  const value = assetRef?.[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
};

const readAssetBoolean = (
  assetRef: Record<string, unknown> | null | undefined,
  key: string,
  fallback: boolean,
): boolean => {
  const value = assetRef?.[key];
  return typeof value === 'boolean' ? value : fallback;
};

const readAssetTileColor = (
  assetRef: Record<string, unknown> | null | undefined,
  bgKey: string,
  fgKey: string,
  fallback: TileColor,
): TileColor => ({
  bg: readAssetString(assetRef, bgKey, fallback.bg),
  fg: readAssetString(assetRef, fgKey, fallback.fg),
});

const readGradientDirection = (
  assetRef: Record<string, unknown> | null | undefined,
  key: string,
  fallback: GradientDirection,
): GradientDirection => {
  const value = assetRef?.[key];
  if (
    value === 'horizontal' ||
    value === 'vertical' ||
    value === 'diagonal' ||
    value === 'radial'
  ) {
    return value;
  }
  return fallback;
};


/**
 * Builds a 2048 theme from the inventory payload. Recognized slots:
 *   - 'tiles'      → tileColors + tileFallback + effect config (merge pulse,
 *                    spawn anim, slide duration, glow threshold/color/size/pulse)
 *   - 'grid'       → gridBg, gridBorder, cellBg
 *   - 'background' → containerBg, containerBorder, gradient fields
 * Missing fields fall through to DEFAULT_2048_THEME.
 */
/* A skin set fills tiles, grid and background at once. The eleven tile
   colours step from low to mid to high to top; each numeral takes ink or
   paper, whichever reads better on its tile. The slide time is the game's. */
export const applyGame2048SkinSet = (skin: SkinSet<'2048'>): Game2048CosmeticTheme => {
  const p = skin.palette;
  const ramp = (i: number) => {
    if (i <= 3) return mixHex(p.low, p.mid, i / 3);
    if (i <= 7) return mixHex(p.mid, p.high, (i - 3) / 4);
    return mixHex(p.high, p.top, (i - 7) / 3);
  };
  const tileColors: Game2048CosmeticTheme['tileColors'] = {};
  // Numerals hold 4:1 like the house tiles: a mid tone that misses with
  // both text colours steps away from its numeral until it reads.
  const readable = (fill: string) => {
    let bg = fill;
    const fg = readableOn(fill, p.ink, p.paper);
    for (let step = 1; step <= 6 && contrastRatio(bg, fg) < 4; step++) {
      bg = mixHex(fill, fg === p.ink ? '#ffffff' : '#000000', step * 0.05);
    }
    return { bg, fg };
  };
  TILE_TIERS.forEach((tier, i) => {
    tileColors[tier] = readable(ramp(i));
  });
  return {
    ...DEFAULT_2048_THEME,
    tileColors,
    tileFallback: readable(mixHex(p.top, '#000000', 0.25)),
    glowThreshold: 0,
    glowSize: 0,
    glowPulse: false,
    gridBg: p.board,
    gridBorder: mixHex(p.board, p.ink, 0.35),
    cellBg: p.cell,
    containerBg: p.ground,
    containerBorder: p.ground,
    containerGradientEnabled: false,
    skin: {
      material: skin.material,
      shape: skin.shape,
      sound: skin.sound,
      line: mixHex(p.board, p.ink, 0.3),
    },
  };
};

export const buildGame2048Theme = (
  response: InventoryCosmeticResponse,
): Game2048CosmeticTheme => {
  const skinSet = findEquippedSkinSet(response.equipped, '2048');
  if (skinSet) return applyGame2048SkinSet(skinSet);

  const theme: Game2048CosmeticTheme = {
    ...DEFAULT_2048_THEME,
    tileColors: { ...DEFAULT_2048_THEME.tileColors },
  };

  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;

    if (slot === 'tiles') {
      for (const tier of TILE_TIERS) {
        theme.tileColors[tier] = readAssetTileColor(
          assetRef,
          `tile${tier}Bg`,
          `tile${tier}Fg`,
          theme.tileColors[tier],
        );
      }
      theme.tileFallback = readAssetTileColor(
        assetRef,
        'tileFallbackBg',
        'tileFallbackFg',
        theme.tileFallback,
      );
      theme.mergePulseEnabled = readAssetBoolean(
        assetRef,
        'mergePulseEnabled',
        theme.mergePulseEnabled,
      );
      theme.spawnAnimEnabled = readAssetBoolean(
        assetRef,
        'spawnAnimEnabled',
        theme.spawnAnimEnabled,
      );
      theme.slideDurationMs = readAssetNumber(
        assetRef,
        'slideDurationMs',
        theme.slideDurationMs,
        60,
        260,
      );
      const threshold = readAssetNumber(
        assetRef,
        'glowThreshold',
        theme.glowThreshold,
        0,
        4096,
      );
      theme.glowThreshold = threshold;
      theme.glowColor = readAssetString(assetRef, 'glowColor', theme.glowColor);
      theme.glowSize = readAssetNumber(
        assetRef,
        'glowSize',
        theme.glowSize,
        0,
        40,
      );
      theme.glowPulse = readAssetBoolean(assetRef, 'glowPulse', theme.glowPulse);
    } else if (slot === 'grid') {
      theme.gridBg = readAssetString(assetRef, 'gridBg', theme.gridBg);
      theme.gridBorder = readAssetString(assetRef, 'gridBorder', theme.gridBorder);
      theme.cellBg = readAssetString(assetRef, 'cellBg', theme.cellBg);
    } else if (slot === 'background') {
      theme.containerBg = readAssetString(
        assetRef,
        'containerBg',
        theme.containerBg,
      );
      theme.containerBorder = readAssetString(
        assetRef,
        'containerBorder',
        theme.containerBorder,
      );
      theme.containerGradientEnabled = readAssetBoolean(
        assetRef,
        'containerGradientEnabled',
        theme.containerGradientEnabled,
      );
      theme.containerGradientStart = readAssetString(
        assetRef,
        'containerGradientStart',
        theme.containerGradientStart,
      );
      theme.containerGradientEnd = readAssetString(
        assetRef,
        'containerGradientEnd',
        theme.containerGradientEnd,
      );
      theme.containerGradientDirection = readGradientDirection(
        assetRef,
        'containerGradientDirection',
        theme.containerGradientDirection,
      );
    }
  }

  return theme;
};

export const resolveTileColor = (
  value: number,
  theme: Game2048CosmeticTheme,
): TileColor => theme.tileColors[value] ?? theme.tileFallback;

export const buildContainerBackground = (
  theme: Game2048CosmeticTheme,
): string => {
  if (!theme.containerGradientEnabled) return theme.containerBg;
  const { containerGradientStart: a, containerGradientEnd: b } = theme;
  switch (theme.containerGradientDirection) {
    case 'horizontal':
      return `linear-gradient(90deg, ${a}, ${b})`;
    case 'vertical':
      return `linear-gradient(180deg, ${a}, ${b})`;
    case 'radial':
      return `radial-gradient(circle at 30% 30%, ${a}, ${b})`;
    case 'diagonal':
    default:
      return `linear-gradient(135deg, ${a}, ${b})`;
  }
};
