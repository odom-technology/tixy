import type { PieceType } from './_tetris-config';

// ---------------------------------------------------------------------------
// Tetris Cosmetic Theme
// Flattens all 4 slot assetRefs into one theme object used at render time.
// ---------------------------------------------------------------------------

export type TetrisBlockShading = 'flat' | 'bevel' | 'gradient' | 'neon';
export type TetrisBoardBgMode = 'solid' | 'linear' | 'radial';
export type TetrisLineClearStyle = 'flash' | 'dissolve' | 'shatter' | 'sweep';
export type TetrisGhostStyle = 'outline' | 'filled-translucent' | 'dashed';

export type TetrisCosmeticTheme = {
  // Blocks
  blockColors: Record<PieceType, string>;
  blockShading: TetrisBlockShading;
  blockHighlightColor: string;
  blockHighlightIntensity: number;
  blockBorderColor: string;
  blockBorderWidth: number;
  blockGlowEnabled: boolean;
  blockGlowColor: string;
  blockGlowSize: number;

  // Board
  boardBgMode: TetrisBoardBgMode;
  boardBgStart: string;
  boardBgEnd: string;
  gridLineColor: string;
  gridLineWidth: number;
  gridVisible: boolean;
  borderColor: string;
  borderWidth: number;
  borderGlowEnabled: boolean;
  borderGlowColor: string;
  emptyCellTint: string;
  emptyCellTintStrength: number;
  vignette: number;

  // Effects
  lineClearStyle: TetrisLineClearStyle;
  lineClearColor: string;
  lineClearIntensity: number;
  tetrisClearColor: string;
  tspinHighlightColor: string;
  lockFlashColor: string;
  lockFlashIntensity: number;
  hardDropImpactColor: string;
  hardDropImpactSize: number;

  // Ghost & panels
  ghostStyle: TetrisGhostStyle;
  ghostOpacity: number;
  ghostTintEnabled: boolean;
  ghostTintColor: string;
  panelBgColor: string;
  panelBorderColor: string;
  panelAccentColor: string;
};

export type InventoryCosmeticResponse = {
  wallet?: {
    credits?: number;
  };
  dailyGameCredits?: {
    earned?: number;
    cap?: number;
    remaining?: number;
  };
  equipped?: Array<{
    slot?: string;
    item?: {
      assetRef?: Record<string, unknown> | null;
    } | null;
  }>;
};
