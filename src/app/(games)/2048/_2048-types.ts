import type { SoundTint } from '@/features/arcade/lib/sound-manager';
import type { AccountXpReward } from '@/server/arcade/rewards/types';

export type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

export type TileColor = {
  bg: string;
  fg: string;
  /** A lighter ring round the tile, for the dark tiles that would
   *  otherwise sink into the grid. */
  edge?: string;
};

export type GradientDirection = 'horizontal' | 'vertical' | 'diagonal' | 'radial';

/**
 * A positioned tile on the board, with a stable id so React can animate
 * its motion across moves. Set during `moveTiles` and consumed by the
 * client's render layer.
 */
export type Tile = {
  id: number;
  value: number;
  row: number;
  col: number;
  /** True for the tile produced by a merge this turn — triggers pop animation. */
  merged?: boolean;
  /** True for the newly-spawned tile this turn — triggers fade-in. */
  spawned?: boolean;
};

export type Game2048CosmeticTheme = {
  // --- 'tiles' slot ---
  tileColors: Record<number, TileColor>;
  tileFallback: TileColor;
  mergePulseEnabled: boolean;
  spawnAnimEnabled: boolean;
  /** Slide transition duration. 60..260ms sensible range. */
  slideDurationMs: number;
  /** Tiles with value >= threshold get glow. 128 | 256 | 512 | 1024. */
  glowThreshold: number;
  glowColor: string;
  /** Glow blur radius in px (0 disables). */
  glowSize: number;
  /** Animate the glow opacity. */
  glowPulse: boolean;

  // --- 'grid' slot ---
  gridBg: string;
  gridBorder: string;
  cellBg: string;

  // --- 'background' slot ---
  containerBg: string;
  containerBorder: string;
  containerGradientEnabled: boolean;
  containerGradientStart: string;
  containerGradientEnd: string;
  containerGradientDirection: GradientDirection;

  /* A skin set (SKINS.md). Null for the house look and older skins. */
  skin: Game2048SkinLook | null;
};

/* What a 2048 skin set adds: the board's material, the tiles' signature
   shape and the sound tint. Tile size, place and slide time never change. */
export type Game2048SkinLook = {
  material: 'ink' | 'planks' | 'felt' | 'slate' | 'paper';
  shape: 'square' | 'stub' | 'coin' | 'block' | 'badge';
  sound: SoundTint;
  /* The material's seam or weave colour. */
  line: string;
};

export type InventoryCosmeticResponse = {
  wallet?: {
    credits?: number;
  };
  dailyGameCredits?: {
    earned?: number;
    cap?: number;
  };
  equipped?: Array<{
    slot?: string;
    item?: {
      assetRef?: Record<string, unknown> | null;
    } | null;
  }>;
};

export type Game2048ScoreSubmitResponse = {
  error?: string;
  details?: string;
  retryAfterSec?: number;
  success?: boolean;
  reward?: {
    awardedCredits?: number;
    wantedCredits?: number;
    capRemaining?: number;
    earnedTodayTotal?: number;
    balanceAfter?: number;
    account?: AccountXpReward;
  };
  leaderboard?: Array<{
    id: string;
    userName: string;
    score: number;
    highestTile?: number;
  }>;
};
