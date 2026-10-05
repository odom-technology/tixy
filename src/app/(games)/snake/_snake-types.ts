import type { SoundTint } from '@/features/arcade/lib/sound-manager';
import type { AccountXpReward } from '@/server/arcade/rewards/types';

export type Position = {
  x: number;
  y: number;
};

export type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

export type BodyGradientMode = 'flat' | 'linear' | 'radial' | 'combined';
export type BodyGlowStyle = 'none' | 'steady' | 'pulse' | 'pulse-dual';
export type BodyPatternStyle = 'none' | 'stripes' | 'dots';

export type SnakeCosmeticTheme = {
  bodyPrimary: string;
  bodySecondary: string;
  bodyGradient: BodyGradientMode;
  bodyPatternStyle: BodyPatternStyle;
  bodyPatternColor: string;
  bodyPatternIntensity: number;
  bodyGlowEnabled: boolean;
  bodyGlowColor: string;
  bodyGlowColorAlt: string;
  bodyGlowStyle: BodyGlowStyle;
  bodyGlowSpeed: number;
  bodyGlowSize: number;
  foodPrimary: string;
  foodHighlight: string;
  foodStemColor: string;
  foodLeafColor: string;
  foodShape: 'apple' | 'orb' | 'diamond';
  foodSize: number;
  foodPulse: number;
  foodGlowEnabled: boolean;
  foodGlowColor: string;
  foodGlowSize: number;
  boardColorA: string;
  boardColorB: string;
  boardTileColorA2: string;
  boardTileColorB2: string;
  boardTileGradientEnabled: boolean;
  boardTileGradientDirection: 'horizontal' | 'vertical' | 'diagonal' | 'radial';
  boardGlobalGradientEnabled: boolean;
  boardGlobalGradientStart: string;
  boardGlobalGradientEnd: string;
  boardGlobalGradientDirection:
    | 'horizontal'
    | 'vertical'
    | 'diagonal'
    | 'radial';
  boardGlobalGradientStrength: number;
  boardGridLineColor: string;
  boardGridLineWidth: number;
  boardBorderColor: string;
  boardBorderWidth: number;
  boardVignette: number;
  boardImageUrl: string;
  boardImageZoom: number;
  boardImageOffsetX: number;
  boardImageOffsetY: number;
  /* A skin set (SKINS.md). Null for the house look and older skins. */
  skin: SnakeSkinLook | null;
};

/* What a snake skin set adds on top of the colours above: the board's
   material, the body's signature shape (and the food that goes with it),
   and the sound tint. */
export type SnakeSkinLook = {
  material: 'ink' | 'planks' | 'paper' | 'slate' | 'tile';
  shape: 'tube' | 'beads' | 'blocks' | 'tickets' | 'links';
  sound: SoundTint;
  line: string;
  mark: string;
  foodMark: string;
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

export type SnakeScoreSubmitResponse = {
  error?: string;
  details?: string;
  retryAfterSec?: number;
  reward?: {
    awardedCredits?: number;
    wantedCredits?: number;
    capRemaining?: number;
    earnedTodayTotal?: number;
    balanceAfter?: number;
    account?: AccountXpReward;
  };
};
