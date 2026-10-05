// ---------------------------------------------------------------------------
// Tetris Theme Builder
// Reads equipped cosmetic items and builds a theme object the renderer uses.
// ---------------------------------------------------------------------------

import { PIECE_COLORS } from './_tetris-config';
import type {
  InventoryCosmeticResponse,
  TetrisBlockShading,
  TetrisBoardBgMode,
  TetrisCosmeticTheme,
  TetrisGhostStyle,
  TetrisLineClearStyle,
} from './_tetris-types';

const BLOCK_SHADINGS: readonly TetrisBlockShading[] = [
  'flat',
  'bevel',
  'gradient',
  'neon',
];
const BG_MODES: readonly TetrisBoardBgMode[] = ['solid', 'linear', 'radial'];
const LINE_CLEAR_STYLES: readonly TetrisLineClearStyle[] = [
  'flash',
  'dissolve',
  'shatter',
  'sweep',
];
const GHOST_STYLES: readonly TetrisGhostStyle[] = [
  'outline',
  'filled-translucent',
  'dashed',
];

// ---------------------------------------------------------------------------
// Midway enamel tetromino palette — the production --piece-1..7 paints.
// Mapping (per the per-game audit): I→1 cyan, O→2 amber, T→3 violet,
// S→4 green, Z→5 red, J→6 blue, L→7 orange. These are literal fallbacks
// for the shell tokens; the real values are resolved from --piece-N at
// theme-build time so the cells stay correct across all four sub-themes.
// ---------------------------------------------------------------------------
const MIDWAY_PIECE_PAINTS: Record<keyof typeof PIECE_COLORS, string> = {
  I: '#38c6d4', // --piece-1
  O: '#f2a33c', // --piece-2
  T: '#9a52d6', // --piece-3
  S: '#5fc06a', // --piece-4
  Z: '#c73538', // --piece-5
  J: '#3b6fd4', // --piece-6
  L: '#e8a23a', // --piece-7
};

const PIECE_TOKEN_BY_TYPE: Record<keyof typeof PIECE_COLORS, string> = {
  I: '--piece-1',
  O: '--piece-2',
  T: '--piece-3',
  S: '--piece-4',
  Z: '--piece-5',
  J: '--piece-6',
  L: '--piece-7',
};

export const DEFAULT_TETRIS_THEME: TetrisCosmeticTheme = {
  // Blocks — enamel paints with a hard bevel (top/left highlight + bottom
  // shade), no glow. The renderer's bevel recipe mirrors .mk-cell[data-p].
  blockColors: { ...MIDWAY_PIECE_PAINTS },
  blockShading: 'bevel',
  blockHighlightColor: '#ffffff',
  blockHighlightIntensity: 34,
  blockBorderColor: '#000000',
  blockBorderWidth: 0,
  blockGlowEnabled: false,
  blockGlowColor: '#ffffff',
  blockGlowSize: 40,

  // Board — recessed dark cool "screen" well, faint warm grid, hard ink frame.
  boardBgMode: 'solid',
  // Pre-fetch fallbacks for the shell-token chrome.
  boardBgStart: '#0f1512', // --screen-well
  boardBgEnd: '#0f1512',
  gridLineColor: '#ffffff',
  gridLineWidth: 1,
  gridVisible: true,
  borderColor: '#0f0a06', // --border-ink
  borderWidth: 2,
  borderGlowEnabled: false,
  borderGlowColor: '#64c8ff',
  emptyCellTint: '#ffffff',
  emptyCellTintStrength: 0,
  vignette: 14,

  // Effects — clean enamel flash, amber Tetris pop, no glow.
  lineClearStyle: 'flash',
  lineClearColor: '#f6eddc', // cream ink
  lineClearIntensity: 78,
  tetrisClearColor: '#f2a33c', // --enamel-tickets / amber
  tspinHighlightColor: '#9a52d6', // --piece-3 violet
  lockFlashColor: '#f6eddc',
  lockFlashIntensity: 20,
  hardDropImpactColor: '#f6eddc',
  hardDropImpactSize: 50,

  // Ghost & panels — translucent paint ghost; HUD chrome reads Midway tokens.
  ghostStyle: 'filled-translucent',
  ghostOpacity: 16,
  ghostTintEnabled: false,
  ghostTintColor: '#ffffff',
  panelBgColor: 'var(--surface-well)',
  panelBorderColor: 'var(--border-ink)',
  panelAccentColor: 'var(--text-muted)',
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

const readAssetNumber = (
  assetRef: Record<string, unknown> | null | undefined,
  key: string,
  fallback: number,
  min: number,
  max: number,
) => {
  const value = assetRef?.[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
};

const readAssetBool = (
  assetRef: Record<string, unknown> | null | undefined,
  key: string,
  fallback: boolean,
) => {
  const value = assetRef?.[key];
  return typeof value === 'boolean' ? value : fallback;
};

const readEnum = <T extends string>(
  assetRef: Record<string, unknown> | null | undefined,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T => {
  const value = assetRef?.[key];
  return typeof value === 'string' && allowed.includes(value as T)
    ? (value as T)
    : fallback;
};

/* Canvas can't resolve var() strings, so chrome defaults drawn on the
   board (frame + backdrop) are read from the live shell tokens. */
const readShellToken = (name: string, fallback: string): string => {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
};

export const buildTetrisTheme = (
  response: InventoryCosmeticResponse,
): TetrisCosmeticTheme => {
  const theme: TetrisCosmeticTheme = {
    ...DEFAULT_TETRIS_THEME,
    blockColors: { ...DEFAULT_TETRIS_THEME.blockColors },
  };

  // Default block paints follow the live --piece-N tokens so the enamel
  // tetrominoes stay correct across all four Midway sub-themes. Canvas can't
  // resolve var(), so we read the computed token values here.
  for (const type of Object.keys(PIECE_TOKEN_BY_TYPE) as Array<
    keyof typeof PIECE_TOKEN_BY_TYPE
  >) {
    theme.blockColors[type] = readShellToken(
      PIECE_TOKEN_BY_TYPE[type],
      theme.blockColors[type],
    );
  }

  // Default board chrome follows the Midway shell; equipped board
  // cosmetics below may still override these. The recessed playfield uses the
  // cool "screen" well token.
  theme.boardBgStart = readShellToken('--screen-well', theme.boardBgStart);
  theme.boardBgEnd = readShellToken('--screen-well', theme.boardBgEnd);
  theme.borderColor = readShellToken('--border-ink', theme.borderColor);

  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;

    if (slot === 'blocks') {
      theme.blockColors = {
        I: readAssetColor(assetRef, 'colorI', theme.blockColors.I),
        O: readAssetColor(assetRef, 'colorO', theme.blockColors.O),
        T: readAssetColor(assetRef, 'colorT', theme.blockColors.T),
        S: readAssetColor(assetRef, 'colorS', theme.blockColors.S),
        Z: readAssetColor(assetRef, 'colorZ', theme.blockColors.Z),
        J: readAssetColor(assetRef, 'colorJ', theme.blockColors.J),
        L: readAssetColor(assetRef, 'colorL', theme.blockColors.L),
      };
      theme.blockShading = readEnum(
        assetRef,
        'blockShading',
        BLOCK_SHADINGS,
        theme.blockShading,
      );
      theme.blockHighlightColor = readAssetColor(
        assetRef,
        'highlightColor',
        theme.blockHighlightColor,
      );
      theme.blockHighlightIntensity = readAssetNumber(
        assetRef,
        'highlightIntensity',
        theme.blockHighlightIntensity,
        0,
        100,
      );
      theme.blockBorderColor = readAssetColor(
        assetRef,
        'borderColor',
        theme.blockBorderColor,
      );
      theme.blockBorderWidth = readAssetNumber(
        assetRef,
        'borderWidth',
        theme.blockBorderWidth,
        0,
        4,
      );
      theme.blockGlowEnabled = readAssetBool(
        assetRef,
        'blockGlowEnabled',
        theme.blockGlowEnabled,
      );
      theme.blockGlowColor = readAssetColor(
        assetRef,
        'blockGlowColor',
        theme.blockGlowColor,
      );
      theme.blockGlowSize = readAssetNumber(
        assetRef,
        'blockGlowSize',
        theme.blockGlowSize,
        0,
        100,
      );
    } else if (slot === 'board') {
      theme.boardBgMode = readEnum(
        assetRef,
        'boardBgMode',
        BG_MODES,
        theme.boardBgMode,
      );
      theme.boardBgStart = readAssetColor(
        assetRef,
        'boardBgStart',
        theme.boardBgStart,
      );
      theme.boardBgEnd = readAssetColor(
        assetRef,
        'boardBgEnd',
        theme.boardBgEnd,
      );
      theme.gridLineColor = readAssetColor(
        assetRef,
        'gridLineColor',
        theme.gridLineColor,
      );
      theme.gridLineWidth = readAssetNumber(
        assetRef,
        'gridLineWidth',
        theme.gridLineWidth,
        0,
        4,
      );
      theme.gridVisible = readAssetBool(
        assetRef,
        'gridVisible',
        theme.gridVisible,
      );
      theme.borderColor = readAssetColor(
        assetRef,
        'borderColor',
        theme.borderColor,
      );
      theme.borderWidth = readAssetNumber(
        assetRef,
        'borderWidth',
        theme.borderWidth,
        0,
        8,
      );
      theme.borderGlowEnabled = readAssetBool(
        assetRef,
        'borderGlowEnabled',
        theme.borderGlowEnabled,
      );
      theme.borderGlowColor = readAssetColor(
        assetRef,
        'borderGlowColor',
        theme.borderGlowColor,
      );
      theme.emptyCellTint = readAssetColor(
        assetRef,
        'emptyCellTint',
        theme.emptyCellTint,
      );
      theme.emptyCellTintStrength = readAssetNumber(
        assetRef,
        'emptyCellTintStrength',
        theme.emptyCellTintStrength,
        0,
        20,
      );
      theme.vignette = readAssetNumber(
        assetRef,
        'vignette',
        theme.vignette,
        0,
        100,
      );
    } else if (slot === 'effects') {
      theme.lineClearStyle = readEnum(
        assetRef,
        'lineClearStyle',
        LINE_CLEAR_STYLES,
        theme.lineClearStyle,
      );
      theme.lineClearColor = readAssetColor(
        assetRef,
        'lineClearColor',
        theme.lineClearColor,
      );
      theme.lineClearIntensity = readAssetNumber(
        assetRef,
        'lineClearIntensity',
        theme.lineClearIntensity,
        0,
        100,
      );
      theme.tetrisClearColor = readAssetColor(
        assetRef,
        'tetrisClearColor',
        theme.tetrisClearColor,
      );
      theme.tspinHighlightColor = readAssetColor(
        assetRef,
        'tspinHighlightColor',
        theme.tspinHighlightColor,
      );
      theme.lockFlashColor = readAssetColor(
        assetRef,
        'lockFlashColor',
        theme.lockFlashColor,
      );
      theme.lockFlashIntensity = readAssetNumber(
        assetRef,
        'lockFlashIntensity',
        theme.lockFlashIntensity,
        0,
        100,
      );
      theme.hardDropImpactColor = readAssetColor(
        assetRef,
        'hardDropImpactColor',
        theme.hardDropImpactColor,
      );
      theme.hardDropImpactSize = readAssetNumber(
        assetRef,
        'hardDropImpactSize',
        theme.hardDropImpactSize,
        0,
        100,
      );
    } else if (slot === 'ghost') {
      theme.ghostStyle = readEnum(
        assetRef,
        'ghostStyle',
        GHOST_STYLES,
        theme.ghostStyle,
      );
      theme.ghostOpacity = readAssetNumber(
        assetRef,
        'ghostOpacity',
        theme.ghostOpacity,
        5,
        60,
      );
      theme.ghostTintEnabled = readAssetBool(
        assetRef,
        'ghostTintEnabled',
        theme.ghostTintEnabled,
      );
      theme.ghostTintColor = readAssetColor(
        assetRef,
        'ghostTintColor',
        theme.ghostTintColor,
      );
      theme.panelBgColor = readAssetColor(
        assetRef,
        'panelBgColor',
        theme.panelBgColor,
      );
      theme.panelBorderColor = readAssetColor(
        assetRef,
        'panelBorderColor',
        theme.panelBorderColor,
      );
      theme.panelAccentColor = readAssetColor(
        assetRef,
        'panelAccentColor',
        theme.panelAccentColor,
      );
    }
  }

  return theme;
};
