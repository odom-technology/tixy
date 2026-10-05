import { findEquippedSkinSet, mixHex, type SkinSet } from '@/features/arcade/lib/skins/skin-set';

import type {
  BodyGradientMode,
  BodyGlowStyle,
  BodyPatternStyle,
  InventoryCosmeticResponse,
  SnakeCosmeticTheme,
} from './_snake-types';

const BODY_GRADIENT_MODES: readonly BodyGradientMode[] = [
  'flat',
  'linear',
  'radial',
  'combined',
] as const;

const BODY_GLOW_STYLES: readonly BodyGlowStyle[] = [
  'none',
  'steady',
  'pulse',
  'pulse-dual',
] as const;
const BODY_PATTERN_STYLES: readonly BodyPatternStyle[] = [
  'none',
  'stripes',
  'dots',
] as const;

/* ──────────────────────────────────────────────────────────────────────
   MIDWAY DEFAULT LOOK — enamel-on-wood inside a recessed dark "screen" well.
   The canvas reads plain hex from this theme object, so the literals below
   are the SSR/fallback Midway palette. At runtime, resolveMidwaySnakeTheme()
   folds in the live Midway CSS tokens (--screen-well / --enamel-* / --pos /
   --neg) so the default look tracks all four sub-themes. Equipped skins still
   overlay on top of whatever this resolves to — the skin pipeline is intact.
   ────────────────────────────────────────────────────────────────────── */
export const DEFAULT_SNAKE_THEME: SnakeCosmeticTheme = {
  // Snake body: prize-teal enamel with a slightly deeper underside, lacquered
  // via the radial-aware 'combined' gradient and a hard cream rim-light pattern.
  bodyPrimary: '#52e0cb',
  bodySecondary: '#25a08f',
  bodyGradient: 'combined',
  bodyPatternStyle: 'none',
  bodyPatternColor: '#f6eddc',
  bodyPatternIntensity: 35,
  bodyGlowEnabled: false,
  bodyGlowColor: '#2fb8a6',
  bodyGlowColorAlt: '#f2a33c',
  bodyGlowStyle: 'none',
  bodyGlowSpeed: 50,
  bodyGlowSize: 50,
  // Food: CTA-red enamel apple with a cream gloss highlight.
  foodPrimary: '#c73538',
  foodHighlight: '#f2a33c',
  foodStemColor: '#6b4a26',
  foodLeafColor: '#5fc06a',
  foodShape: 'apple',
  foodSize: 100,
  foodPulse: 40,
  foodGlowEnabled: false,
  foodGlowColor: '#c73538',
  foodGlowSize: 48,
  // Board: recessed dark cabinet screen — near-black cool well with a barely
  // perceptible warm tile alternation, hairline grid, dark edge, and vignette.
  boardColorA: '#0f1512',
  boardColorB: '#0c110f',
  boardTileColorA2: '#0d1310',
  boardTileColorB2: '#0a0f0d',
  boardTileGradientEnabled: false,
  boardTileGradientDirection: 'diagonal',
  boardGlobalGradientEnabled: true,
  boardGlobalGradientStart: '#13201b',
  boardGlobalGradientEnd: '#070a09',
  boardGlobalGradientDirection: 'radial',
  boardGlobalGradientStrength: 55,
  boardGridLineColor: '#ffffff10',
  boardGridLineWidth: 1,
  boardBorderColor: '#08110d',
  boardBorderWidth: 4,
  boardVignette: 70,
  boardImageUrl: '',
  boardImageZoom: 100,
  boardImageOffsetX: 0,
  boardImageOffsetY: 0,
  skin: null,
};

/* Read a Midway CSS custom property off :root / the themed wrapper. Returns
   the trimmed value or the fallback when unavailable (SSR, missing token). */
const readToken = (name: string, fallback: string): string => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return fallback;
  }
  try {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    return value.length > 0 ? value : fallback;
  } catch {
    return fallback;
  }
};

/* The tixy look. The screen is ink in every phase, so the art uses fixed
   colours: under tixy the enamel tokens are ink on ink. The snake is you, so
   it is ticket amber. The apple is paper with a green leaf, because red is
   kept for a new best. */
export const TIXY_SNAKE_THEME: SnakeCosmeticTheme = {
  ...DEFAULT_SNAKE_THEME,
  bodyPrimary: '#f2a33c',
  bodySecondary: '#f7c877',
  bodyGradient: 'combined',
  foodPrimary: '#f4ebdc',
  foodHighlight: '#ffffff',
  foodStemColor: '#b8a98f',
  foodLeafColor: '#7fb069',
  foodSize: 108,
  boardColorA: '#272019',
  boardColorB: '#1f1a16',
  boardTileColorA2: '#241e18',
  boardTileColorB2: '#1c1713',
  boardGlobalGradientStart: '#2b231c',
  boardGlobalGradientEnd: '#1a1511',
  boardGridLineColor: '#f4ebdc12',
  boardBorderColor: '#1f1a16',
  boardVignette: 45,
};

const isTixyTheme = () =>
  typeof document !== 'undefined' &&
  document.documentElement.getAttribute('data-arcade-theme') === 'tixy';

/* Lift a hex colour toward white by `share`. The token teal read dull on the
   dark screen. Anything that isn't a 6-digit hex passes through. */
const lighten = (color: string, share: number): string => {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return color;
  const value = Number.parseInt(match[1]!, 16);
  const lift = (channel: number) =>
    Math.round(channel + (255 - channel) * share)
      .toString(16)
      .padStart(2, '0');
  return `#${lift((value >> 16) & 255)}${lift((value >> 8) & 255)}${lift(value & 255)}`;
};

/* Resolve the live Midway tokens into a copy of DEFAULT_SNAKE_THEME so the
   DEFAULT look follows whichever sub-theme is active. Only the default-look
   colors are touched; the shape/behavior knobs are kept as-is. Equipped skins
   are applied AFTER this in buildSnakeTheme(), so they still win. Under tixy
   the art is TIXY_SNAKE_THEME. */
export const resolveMidwaySnakeTheme = (): SnakeCosmeticTheme => {
  if (isTixyTheme()) return { ...TIXY_SNAKE_THEME };
  return {
    ...DEFAULT_SNAKE_THEME,
    bodyPrimary: lighten(
      readToken('--enamel-prize', DEFAULT_SNAKE_THEME.bodyPrimary),
      0.22,
    ),
    bodySecondary: readToken(
      '--enamel-prize-edge',
      DEFAULT_SNAKE_THEME.bodySecondary,
    ),
    foodPrimary: readToken('--enamel-primary', DEFAULT_SNAKE_THEME.foodPrimary),
    foodHighlight: readToken(
      '--enamel-tickets-hi',
      DEFAULT_SNAKE_THEME.foodHighlight,
    ),
    foodLeafColor: readToken('--pos', DEFAULT_SNAKE_THEME.foodLeafColor),
    boardColorA: readToken('--screen-well', DEFAULT_SNAKE_THEME.boardColorA),
  };
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

const readAssetUrl = (
  assetRef: Record<string, unknown> | null | undefined,
  keys: string[],
  fallback = '',
) => {
  for (const key of keys) {
    const value = assetRef?.[key];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (
      trimmed.startsWith('/') ||
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('data:image/')
    ) {
      return trimmed;
    }
  }
  return fallback;
};

/* A skin set fills every snake slot at once and is drawn flat: no glow, no
   gradients, no vignette. Shapes, timing and the grid are the game's. */
export const applySnakeSkinSet = (base: SnakeCosmeticTheme, skin: SkinSet<'snake'>): SnakeCosmeticTheme => {
  const p = skin.palette;
  const checker = skin.material === 'tile' || skin.material === 'ink';
  return {
    ...base,
    bodyPrimary: p.body,
    bodySecondary: p.bodyAlt,
    bodyGradient: 'flat',
    bodyPatternStyle: 'none',
    bodyGlowEnabled: false,
    bodyGlowStyle: 'none',
    foodPrimary: p.food,
    foodHighlight: mixHex(p.food, '#ffffff', 0.45),
    foodStemColor: p.mark,
    foodLeafColor: p.foodMark,
    foodShape: 'apple',
    foodGlowEnabled: false,
    foodPulse: 30,
    boardColorA: p.ground,
    boardColorB: checker ? p.groundAlt : p.ground,
    boardTileColorA2: p.ground,
    boardTileColorB2: p.groundAlt,
    boardTileGradientEnabled: false,
    boardGlobalGradientEnabled: false,
    boardGridLineColor: p.line,
    boardGridLineWidth: skin.material === 'slate' || skin.material === 'ink' ? 1 : 0,
    boardBorderColor: mixHex(p.line, '#000000', 0.25),
    boardBorderWidth: 4,
    boardVignette: 0,
    boardImageUrl: '',
    skin: {
      material: skin.material,
      shape: skin.shape,
      sound: skin.sound,
      line: p.line,
      mark: p.mark,
      foodMark: p.foodMark,
    },
  };
};

export const buildSnakeTheme = (
  response: InventoryCosmeticResponse,
): SnakeCosmeticTheme => {
  const skinSet = findEquippedSkinSet(response.equipped, 'snake');
  if (skinSet) return applySnakeSkinSet(resolveMidwaySnakeTheme(), skinSet);
  // Start from the token-resolved Midway default so the base look tracks the
  // active sub-theme; equipped skins overlay on top below (pipeline intact).
  const theme = resolveMidwaySnakeTheme();
  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;
    if (slot === 'body') {
      theme.bodyPrimary = readAssetColor(
        assetRef,
        'bodyPrimary',
        theme.bodyPrimary,
      );
      theme.bodySecondary = readAssetColor(
        assetRef,
        'bodySecondary',
        theme.bodySecondary,
      );
      const patternVal = assetRef?.bodyPatternStyle;
      if (patternVal === 'scales') {
        theme.bodyPatternStyle = 'stripes';
      }
      if (
        typeof patternVal === 'string' &&
        (BODY_PATTERN_STYLES as readonly string[]).includes(patternVal)
      ) {
        theme.bodyPatternStyle = patternVal as BodyPatternStyle;
      }
      theme.bodyPatternColor = readAssetColor(
        assetRef,
        'bodyPatternColor',
        theme.bodyPatternColor,
      );
      if (typeof assetRef?.bodyPatternIntensity === 'number') {
        theme.bodyPatternIntensity = Math.max(
          0,
          Math.min(100, assetRef.bodyPatternIntensity),
        );
      }
      const gradVal = assetRef?.bodyGradient;
      if (
        typeof gradVal === 'string' &&
        (BODY_GRADIENT_MODES as readonly string[]).includes(gradVal)
      ) {
        theme.bodyGradient = gradVal as BodyGradientMode;
      }
      if (typeof assetRef?.bodyGlowEnabled === 'boolean') {
        theme.bodyGlowEnabled = assetRef.bodyGlowEnabled;
      }
      theme.bodyGlowColor = readAssetColor(
        assetRef,
        'bodyGlowColor',
        theme.bodyGlowColor,
      );
      theme.bodyGlowColorAlt = readAssetColor(
        assetRef,
        'bodyGlowColorAlt',
        theme.bodyGlowColorAlt,
      );
      const glowStyleVal = assetRef?.bodyGlowStyle;
      if (
        typeof glowStyleVal === 'string' &&
        (BODY_GLOW_STYLES as readonly string[]).includes(glowStyleVal)
      ) {
        theme.bodyGlowStyle = glowStyleVal as BodyGlowStyle;
      }
      if (typeof assetRef?.bodyGlowSpeed === 'number') {
        theme.bodyGlowSpeed = Math.max(
          10,
          Math.min(100, assetRef.bodyGlowSpeed),
        );
      }
      if (typeof assetRef?.bodyGlowSize === 'number') {
        theme.bodyGlowSize = Math.max(10, Math.min(200, assetRef.bodyGlowSize));
      }
    } else if (slot === 'food') {
      theme.foodPrimary = readAssetColor(
        assetRef,
        'foodPrimary',
        theme.foodPrimary,
      );
      theme.foodHighlight = readAssetColor(
        assetRef,
        'foodHighlight',
        theme.foodHighlight,
      );
      theme.foodStemColor = readAssetColor(
        assetRef,
        'foodStemColor',
        theme.foodStemColor,
      );
      theme.foodLeafColor = readAssetColor(
        assetRef,
        'foodLeafColor',
        theme.foodLeafColor,
      );
      if (
        assetRef.foodShape === 'apple' ||
        assetRef.foodShape === 'orb' ||
        assetRef.foodShape === 'diamond'
      ) {
        theme.foodShape = assetRef.foodShape;
      }
      theme.foodSize = readAssetNumber(
        assetRef,
        'foodSize',
        theme.foodSize,
        60,
        140,
      );
      theme.foodPulse = readAssetNumber(
        assetRef,
        'foodPulse',
        theme.foodPulse,
        0,
        100,
      );
      if (typeof assetRef.foodGlowEnabled === 'boolean') {
        theme.foodGlowEnabled = assetRef.foodGlowEnabled;
      }
      theme.foodGlowColor = readAssetColor(
        assetRef,
        'foodGlowColor',
        theme.foodGlowColor,
      );
      theme.foodGlowSize = readAssetNumber(
        assetRef,
        'foodGlowSize',
        theme.foodGlowSize,
        10,
        140,
      );
    } else if (slot === 'board') {
      theme.boardColorA = readAssetColor(
        assetRef,
        'boardColorA',
        readAssetColor(assetRef, 'boardBg', theme.boardColorA),
      );
      theme.boardColorB = readAssetColor(
        assetRef,
        'boardColorB',
        readAssetColor(assetRef, 'gridLine', theme.boardColorB),
      );
      theme.boardTileColorA2 = readAssetColor(
        assetRef,
        'boardTileColorA2',
        theme.boardTileColorA2,
      );
      theme.boardTileColorB2 = readAssetColor(
        assetRef,
        'boardTileColorB2',
        theme.boardTileColorB2,
      );
      if (typeof assetRef?.boardTileGradientEnabled === 'boolean') {
        theme.boardTileGradientEnabled = assetRef.boardTileGradientEnabled;
      }
      const tileGradientDirection = assetRef?.boardTileGradientDirection;
      if (
        tileGradientDirection === 'horizontal' ||
        tileGradientDirection === 'vertical' ||
        tileGradientDirection === 'diagonal' ||
        tileGradientDirection === 'radial'
      ) {
        theme.boardTileGradientDirection = tileGradientDirection;
      }
      if (typeof assetRef?.boardGlobalGradientEnabled === 'boolean') {
        theme.boardGlobalGradientEnabled = assetRef.boardGlobalGradientEnabled;
      }
      theme.boardGlobalGradientStart = readAssetColor(
        assetRef,
        'boardGlobalGradientStart',
        theme.boardGlobalGradientStart,
      );
      theme.boardGlobalGradientEnd = readAssetColor(
        assetRef,
        'boardGlobalGradientEnd',
        theme.boardGlobalGradientEnd,
      );
      const boardGlobalGradientDirection = assetRef?.boardGlobalGradientDirection;
      if (
        boardGlobalGradientDirection === 'horizontal' ||
        boardGlobalGradientDirection === 'vertical' ||
        boardGlobalGradientDirection === 'diagonal' ||
        boardGlobalGradientDirection === 'radial'
      ) {
        theme.boardGlobalGradientDirection = boardGlobalGradientDirection;
      }
      theme.boardGlobalGradientStrength = readAssetNumber(
        assetRef,
        'boardGlobalGradientStrength',
        theme.boardGlobalGradientStrength,
        0,
        100,
      );
      theme.boardGridLineColor = readAssetColor(
        assetRef,
        'boardGridLineColor',
        readAssetColor(assetRef, 'gridLine', theme.boardGridLineColor),
      );
      theme.boardGridLineWidth = readAssetNumber(
        assetRef,
        'boardGridLineWidth',
        theme.boardGridLineWidth,
        0,
        4,
      );
      theme.boardBorderColor = readAssetColor(
        assetRef,
        'boardBorderColor',
        theme.boardBorderColor,
      );
      theme.boardBorderWidth = readAssetNumber(
        assetRef,
        'boardBorderWidth',
        theme.boardBorderWidth,
        0,
        10,
      );
      theme.boardVignette = readAssetNumber(
        assetRef,
        'boardVignette',
        theme.boardVignette,
        0,
        200,
      );
      theme.boardImageUrl = readAssetUrl(
        assetRef,
        ['boardImageUrl', 'imageUrl', 'image', 'previewUrl', 'url', 'src'],
        theme.boardImageUrl,
      );
      theme.boardImageZoom = readAssetNumber(
        assetRef,
        'boardImageZoom',
        theme.boardImageZoom,
        60,
        220,
      );
      theme.boardImageOffsetX = readAssetNumber(
        assetRef,
        'boardImageOffsetX',
        theme.boardImageOffsetX,
        -100,
        100,
      );
      theme.boardImageOffsetY = readAssetNumber(
        assetRef,
        'boardImageOffsetY',
        theme.boardImageOffsetY,
        -100,
        100,
      );
    }
  }
  return theme;
};
