import {
  DEFAULT_PLAYERCARD_THEME,
  PLAYERCARD_ANIMATIONS,
  isPlayercardAnimation,
  type PlayercardAnimation,
} from '@/features/arcade/lib/pool-playercard-theme';

// fallow-ignore-next-line duplicate-export
export type CurrencyType = 'credits';
// fallow-ignore-next-line duplicate-export
export type StoreRarity = 'common' | 'rare' | 'epic' | 'legendary';

export type StoreItem = {
  id: string;
  name: string;
  gameType: string;
  rarity: StoreRarity;
  currencyType: CurrencyType;
  price: number;
  slots: string[];
  active: boolean;
  seasonTag: string | null;
  assetRef: Record<string, unknown> | null;
};

export type SkinGroup = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  gameType: string | null;
  active: boolean;
  itemIds: string[];
};

export type Metadata = {
  gameTypes: string[];
  slots: Record<string, string[]>;
  rarities: StoreRarity[];
};

export type ApiResponse = {
  items: StoreItem[];
  groups: SkinGroup[];
  metadata: Metadata;
  imported?: {
    items: number;
    groups: number;
  };
  error?: string;
};

export type SkinStudioExportFile = {
  format: 'skin-studio-export-v1';
  exportedAt: string;
  source: 'bespick-skin-studio';
  items: StoreItem[];
  groups: SkinGroup[];
  assets?: SkinStudioExportAsset[];
};

export type SkinStudioExportAsset = {
  path: string;
  mimeType: string;
  fileName: string;
  base64Data: string;
};

export type SnakeBodyDraft = {
  bodyPrimary: string;
  bodySecondary: string;
  bodyGradient: 'flat' | 'linear' | 'radial' | 'combined';
  bodyPatternStyle: 'none' | 'stripes' | 'dots';
  bodyPatternColor: string;
  bodyPatternIntensity: number;
  bodyGlowEnabled: boolean;
  bodyGlowColor: string;
  bodyGlowColorAlt: string;
  bodyGlowStyle: 'none' | 'steady' | 'pulse' | 'pulse-dual';
  bodyGlowSpeed: number;
  bodyGlowSize: number;
  previewBgMode: 'auto' | 'solid' | 'custom-gradient';
  previewBgSolid: string;
  previewBgColors: string[];
};

export type SnakeBoardDraft = {
  boardImageUrl: string;
  boardImageZoom: number;
  boardImageOffsetX: number;
  boardImageOffsetY: number;
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
};

export type SnakeFoodDraft = {
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
};

export type TypingThemeDraft = {
  themeBackgroundColor: string;
  themeSurfaceColor: string;
  themeBorderColor: string;
  themeTextColor: string;
  themeAccentColor: string;
  themeErrorColor: string;
  themeSuccessColor: string;
  hudFrameStyle: 'minimal' | 'glass' | 'neon' | 'terminal';
  hudBadgeStyle: 'pill' | 'chip' | 'block' | 'outline';
  hudMeterStyle: 'none' | 'bar' | 'ring' | 'pulse';
  hudShadowStrength: number;
};

export type TypingCaretDraft = {
  caretColor: string;
  caretType: 'bar' | 'block' | 'underline';
  caretThickness: number;
  caretGlowStrength: number;
  caretPulseMode: 'none' | 'soft' | 'strong';
  caretTrailEnabled: boolean;
};

export type TypingFeedbackDraft = {
  missEffectColor: string;
  feedbackStyle: 'none' | 'underline' | 'shake' | 'flash' | 'particles';
  feedbackStrength: number;
  feedbackDurationMs: number;
  feedbackParticlesEnabled: boolean;
};

export type TypingTextStyleDraft = {
  textColor: string;
  correctColor: string;
  errorColor: string;
  textFontFamily: 'mono' | 'sans' | 'serif';
  textFontWeight: 400 | 500 | 600 | 700;
  textLetterSpacing: number;
  textWordSpacing: number;
  textCurrentWordStyle: 'none' | 'underline' | 'glow' | 'box';
  textCurrentWordColor: string;
  textCurrentWordStrength: number;
};

export type AssetFieldType = 'color' | 'text' | 'boolean' | 'number';
export type AssetField = {
  id: string;
  key: string;
  type: AssetFieldType;
  value: string | boolean | number;
};

export type ItemDraft = {
  id: string;
  name: string;
  gameType: string;
  rarity: StoreRarity;
  currencyType: CurrencyType;
  price: number;
  slots: string[];
  active: boolean;
  assetRefText: string;
};

const GRADIENT_MODES = ['flat', 'linear', 'radial', 'combined'] as const;
const PATTERN_STYLES = ['none', 'stripes', 'dots'] as const;
const GLOW_STYLES = ['none', 'steady', 'pulse', 'pulse-dual'] as const;
const PREVIEW_BG_MODES = ['auto', 'solid', 'custom-gradient'] as const;

export const DEFAULT_SNAKE_BODY_DRAFT: SnakeBodyDraft = {
  bodyPrimary: '#22c55e',
  bodySecondary: '#16a34a',
  bodyGradient: 'flat',
  bodyPatternStyle: 'none',
  bodyPatternColor: '#dcfce7',
  bodyPatternIntensity: 35,
  bodyGlowEnabled: false,
  bodyGlowColor: '#22c55e',
  bodyGlowColorAlt: '#60a5fa',
  bodyGlowStyle: 'none',
  bodyGlowSpeed: 50,
  bodyGlowSize: 50,
  previewBgMode: 'auto',
  previewBgSolid: '#0b1220',
  previewBgColors: ['#0f172a', '#16a34a'],
};

export const DEFAULT_SNAKE_BOARD_DRAFT: SnakeBoardDraft = {
  boardImageUrl: '',
  boardImageZoom: 100,
  boardImageOffsetX: 0,
  boardImageOffsetY: 0,
  boardColorA: '#aad751',
  boardColorB: '#a2d149',
  boardTileColorA2: '#8fc34a',
  boardTileColorB2: '#7fbe42',
  boardTileGradientEnabled: false,
  boardTileGradientDirection: 'diagonal',
  boardGlobalGradientEnabled: false,
  boardGlobalGradientStart: '#101a2f',
  boardGlobalGradientEnd: '#000000',
  boardGlobalGradientDirection: 'radial',
  boardGlobalGradientStrength: 30,
  boardGridLineColor: '#6f9953',
  boardGridLineWidth: 0,
  boardBorderColor: '#5d7f45',
  boardBorderWidth: 2,
  boardVignette: 0,
};

export const DEFAULT_SNAKE_FOOD_DRAFT: SnakeFoodDraft = {
  foodPrimary: '#ea4335',
  foodHighlight: '#f28b82',
  foodStemColor: '#7a5230',
  foodLeafColor: '#6abf3b',
  foodShape: 'apple',
  foodSize: 100,
  foodPulse: 40,
  foodGlowEnabled: false,
  foodGlowColor: '#ea4335',
  foodGlowSize: 48,
};

export const DEFAULT_TYPING_THEME_DRAFT: TypingThemeDraft = {
  themeBackgroundColor: '#0f172a',
  themeSurfaceColor: '#1e1e2e',
  themeBorderColor: '#334155',
  themeTextColor: '#94a3b8',
  themeAccentColor: '#facc15',
  themeErrorColor: '#ef4444',
  themeSuccessColor: '#22c55e',
  hudFrameStyle: 'glass',
  hudBadgeStyle: 'pill',
  hudMeterStyle: 'bar',
  hudShadowStrength: 42,
};

export const DEFAULT_TYPING_CARET_DRAFT: TypingCaretDraft = {
  caretColor: '#facc15',
  caretType: 'bar',
  caretThickness: 3,
  caretGlowStrength: 30,
  caretPulseMode: 'none',
  caretTrailEnabled: false,
};

export const DEFAULT_TYPING_FEEDBACK_DRAFT: TypingFeedbackDraft = {
  missEffectColor: '#fb7185',
  feedbackStyle: 'underline',
  feedbackStrength: 45,
  feedbackDurationMs: 160,
  feedbackParticlesEnabled: false,
};

export const DEFAULT_TYPING_TEXT_STYLE_DRAFT: TypingTextStyleDraft = {
  textColor: '#64748b',
  correctColor: '#e2e8f0',
  errorColor: '#ef4444',
  textFontFamily: 'mono',
  textFontWeight: 500,
  textLetterSpacing: 0,
  textWordSpacing: 12,
  textCurrentWordStyle: 'underline',
  textCurrentWordColor: '#facc15',
  textCurrentWordStrength: 45,
};

export const DEFAULT_METADATA: Metadata = {
  gameTypes: ['snake', 'flappy-bird', 'typing-test', '8-ball'],
  slots: {
    snake: ['body', 'food', 'board'],
    'flappy-bird': ['bird', 'pipe', 'background', 'trail'],
    'typing-test': ['theme', 'caret', 'text-style', 'feedback'],
    '8-ball': ['cue', 'table', 'playercard', 'balls'],
    'reaction-time': [],
  },
  rarities: ['common', 'rare', 'epic', 'legendary'],
};

export const SKIN_STUDIO_DRAFT_STORAGE_KEY = 'skin-studio-draft-v2';

export const INITIAL_ITEM_DRAFT: ItemDraft = {
  id: '',
  name: '',
  gameType: 'snake',
  rarity: 'common',
  currencyType: 'credits',
  price: 100,
  slots: ['body'],
  active: true,
  assetRefText: '{}',
};

const clampNumber = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
};

const parseHex = (hex: string) => {
  const n = hex.replace('#', '');
  const e =
    n.length === 3
      ? n
          .split('')
          .map((c) => c + c)
          .join('')
      : n;
  const v = Number.parseInt(e, 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
};

export const contrastRatio = (hexA: string, hexB: string) => {
  const lum = (hex: string) => {
    const { r, g, b } = parseHex(hex);
    const ch = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  };
  const l1 = lum(hexA);
  const l2 = lum(hexB);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

const inferAssetFieldType = (
  key: string,
  value: unknown,
): AssetFieldType => {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (
    typeof value === 'string' &&
    (key.toLowerCase().includes('color') ||
      /^#([0-9a-f]{3,8})$/i.test(value.trim()))
  )
    return 'color';
  return 'text';
};

export const parseAssetFieldsFromAssetRef = (
  assetRef: Record<string, unknown> | null,
): AssetField[] => {
  return Object.entries(assetRef ?? {}).map(([key, value], index) => ({
    id: `asset-field-${index}-${key}`,
    key,
    type: inferAssetFieldType(key, value),
    value:
      typeof value === 'boolean' ||
      typeof value === 'number' ||
      typeof value === 'string'
        ? value
        : JSON.stringify(value),
  }));
};

export const parseSnakeBodyDraftFromAssetRef = (
  ar: Record<string, unknown> | null | undefined,
): SnakeBodyDraft => ({
  bodyPrimary:
    typeof ar?.bodyPrimary === 'string'
      ? ar.bodyPrimary
      : DEFAULT_SNAKE_BODY_DRAFT.bodyPrimary,
  bodySecondary:
    typeof ar?.bodySecondary === 'string'
      ? ar.bodySecondary
      : DEFAULT_SNAKE_BODY_DRAFT.bodySecondary,
  bodyGradient: (GRADIENT_MODES as readonly string[]).includes(
    String(ar?.bodyGradient),
  )
    ? (ar!.bodyGradient as SnakeBodyDraft['bodyGradient'])
    : 'flat',
  bodyPatternStyle:
    String(ar?.bodyPatternStyle) === 'scales'
      ? 'stripes'
      : (PATTERN_STYLES as readonly string[]).includes(
            String(ar?.bodyPatternStyle),
          )
        ? (ar!.bodyPatternStyle as SnakeBodyDraft['bodyPatternStyle'])
        : DEFAULT_SNAKE_BODY_DRAFT.bodyPatternStyle,
  bodyPatternColor:
    typeof ar?.bodyPatternColor === 'string'
      ? ar.bodyPatternColor
      : DEFAULT_SNAKE_BODY_DRAFT.bodyPatternColor,
  bodyPatternIntensity: clampNumber(ar?.bodyPatternIntensity, 35, 0, 100),
  bodyGlowEnabled:
    typeof ar?.bodyGlowEnabled === 'boolean' ? ar.bodyGlowEnabled : false,
  bodyGlowColor:
    typeof ar?.bodyGlowColor === 'string'
      ? ar.bodyGlowColor
      : DEFAULT_SNAKE_BODY_DRAFT.bodyGlowColor,
  bodyGlowColorAlt:
    typeof ar?.bodyGlowColorAlt === 'string'
      ? ar.bodyGlowColorAlt
      : typeof ar?.bodyGlowColor2 === 'string'
        ? ar.bodyGlowColor2
        : DEFAULT_SNAKE_BODY_DRAFT.bodyGlowColorAlt,
  bodyGlowStyle: (GLOW_STYLES as readonly string[]).includes(
    String(ar?.bodyGlowStyle),
  )
    ? (ar!.bodyGlowStyle as SnakeBodyDraft['bodyGlowStyle'])
    : 'none',
  bodyGlowSpeed: clampNumber(ar?.bodyGlowSpeed, 50, 10, 100),
  bodyGlowSize: clampNumber(ar?.bodyGlowSize, 50, 10, 200),
  previewBgMode: (PREVIEW_BG_MODES as readonly string[]).includes(
    String(ar?.previewBgMode),
  )
    ? (ar!.previewBgMode as SnakeBodyDraft['previewBgMode'])
    : 'auto',
  previewBgSolid:
    typeof ar?.previewBgSolid === 'string'
      ? ar.previewBgSolid
      : DEFAULT_SNAKE_BODY_DRAFT.previewBgSolid,
  previewBgColors: Array.isArray(ar?.previewBgColors)
    ? (ar!.previewBgColors as unknown[])
        .filter((v): v is string => typeof v === 'string')
        .slice(0, 4)
    : [...DEFAULT_SNAKE_BODY_DRAFT.previewBgColors],
});

export const composeSnakeBodyAssetRef = (
  draft: SnakeBodyDraft,
): Record<string, unknown> => ({
  bodyPrimary: draft.bodyPrimary,
  bodySecondary: draft.bodySecondary,
  bodyGradient: draft.bodyGradient,
  bodyPatternStyle: draft.bodyPatternStyle,
  bodyPatternColor: draft.bodyPatternColor,
  bodyPatternIntensity: draft.bodyPatternIntensity,
  bodyGlowEnabled: draft.bodyGlowEnabled,
  bodyGlowColor: draft.bodyGlowColor,
  bodyGlowColorAlt: draft.bodyGlowColorAlt,
  bodyGlowStyle: draft.bodyGlowStyle,
  bodyGlowSpeed: draft.bodyGlowSpeed,
  bodyGlowSize: draft.bodyGlowSize,
  previewBgMode: draft.previewBgMode,
  previewBgSolid: draft.previewBgSolid,
  previewBgColors: draft.previewBgColors,
});

export const parseSnakeBoardDraftFromAssetRef = (
  ar: Record<string, unknown> | null | undefined,
): SnakeBoardDraft => ({
  boardImageUrl:
    typeof ar?.boardImageUrl === 'string'
      ? ar.boardImageUrl
      : typeof ar?.imageUrl === 'string'
        ? ar.imageUrl
        : typeof ar?.image === 'string'
          ? ar.image
          : '',
  boardImageZoom: clampNumber(ar?.boardImageZoom, 100, 60, 220),
  boardImageOffsetX: clampNumber(ar?.boardImageOffsetX, 0, -100, 100),
  boardImageOffsetY: clampNumber(ar?.boardImageOffsetY, 0, -100, 100),
  boardColorA:
    typeof ar?.boardColorA === 'string'
      ? ar.boardColorA
      : typeof ar?.boardBg === 'string'
        ? ar.boardBg
        : DEFAULT_SNAKE_BOARD_DRAFT.boardColorA,
  boardColorB:
    typeof ar?.boardColorB === 'string'
      ? ar.boardColorB
      : typeof ar?.gridLine === 'string'
        ? ar.gridLine
        : DEFAULT_SNAKE_BOARD_DRAFT.boardColorB,
  boardTileColorA2:
    typeof ar?.boardTileColorA2 === 'string'
      ? ar.boardTileColorA2
      : DEFAULT_SNAKE_BOARD_DRAFT.boardTileColorA2,
  boardTileColorB2:
    typeof ar?.boardTileColorB2 === 'string'
      ? ar.boardTileColorB2
      : DEFAULT_SNAKE_BOARD_DRAFT.boardTileColorB2,
  boardTileGradientEnabled:
    typeof ar?.boardTileGradientEnabled === 'boolean'
      ? ar.boardTileGradientEnabled
      : DEFAULT_SNAKE_BOARD_DRAFT.boardTileGradientEnabled,
  boardTileGradientDirection:
    ar?.boardTileGradientDirection === 'horizontal' ||
    ar?.boardTileGradientDirection === 'vertical' ||
    ar?.boardTileGradientDirection === 'diagonal' ||
    ar?.boardTileGradientDirection === 'radial'
      ? ar.boardTileGradientDirection
      : DEFAULT_SNAKE_BOARD_DRAFT.boardTileGradientDirection,
  boardGlobalGradientEnabled:
    typeof ar?.boardGlobalGradientEnabled === 'boolean'
      ? ar.boardGlobalGradientEnabled
      : DEFAULT_SNAKE_BOARD_DRAFT.boardGlobalGradientEnabled,
  boardGlobalGradientStart:
    typeof ar?.boardGlobalGradientStart === 'string'
      ? ar.boardGlobalGradientStart
      : DEFAULT_SNAKE_BOARD_DRAFT.boardGlobalGradientStart,
  boardGlobalGradientEnd:
    typeof ar?.boardGlobalGradientEnd === 'string'
      ? ar.boardGlobalGradientEnd
      : DEFAULT_SNAKE_BOARD_DRAFT.boardGlobalGradientEnd,
  boardGlobalGradientDirection:
    ar?.boardGlobalGradientDirection === 'horizontal' ||
    ar?.boardGlobalGradientDirection === 'vertical' ||
    ar?.boardGlobalGradientDirection === 'diagonal' ||
    ar?.boardGlobalGradientDirection === 'radial'
      ? ar.boardGlobalGradientDirection
      : DEFAULT_SNAKE_BOARD_DRAFT.boardGlobalGradientDirection,
  boardGlobalGradientStrength: clampNumber(
    ar?.boardGlobalGradientStrength,
    DEFAULT_SNAKE_BOARD_DRAFT.boardGlobalGradientStrength,
    0,
    100,
  ),
  boardGridLineColor:
    typeof ar?.boardGridLineColor === 'string'
      ? ar.boardGridLineColor
      : typeof ar?.gridLine === 'string'
        ? ar.gridLine
        : DEFAULT_SNAKE_BOARD_DRAFT.boardGridLineColor,
  boardGridLineWidth: clampNumber(ar?.boardGridLineWidth, 0, 0, 4),
  boardBorderColor:
    typeof ar?.boardBorderColor === 'string'
      ? ar.boardBorderColor
      : DEFAULT_SNAKE_BOARD_DRAFT.boardBorderColor,
  boardBorderWidth: clampNumber(ar?.boardBorderWidth, 2, 0, 10),
  boardVignette: clampNumber(ar?.boardVignette, 0, 0, 200),
});

export const parseSnakeFoodDraftFromAssetRef = (
  ar: Record<string, unknown> | null | undefined,
): SnakeFoodDraft => ({
  foodPrimary:
    typeof ar?.foodPrimary === 'string'
      ? ar.foodPrimary
      : DEFAULT_SNAKE_FOOD_DRAFT.foodPrimary,
  foodHighlight:
    typeof ar?.foodHighlight === 'string'
      ? ar.foodHighlight
      : DEFAULT_SNAKE_FOOD_DRAFT.foodHighlight,
  foodStemColor:
    typeof ar?.foodStemColor === 'string'
      ? ar.foodStemColor
      : DEFAULT_SNAKE_FOOD_DRAFT.foodStemColor,
  foodLeafColor:
    typeof ar?.foodLeafColor === 'string'
      ? ar.foodLeafColor
      : DEFAULT_SNAKE_FOOD_DRAFT.foodLeafColor,
  foodShape:
    ar?.foodShape === 'orb' || ar?.foodShape === 'diamond' || ar?.foodShape === 'apple'
      ? ar.foodShape
      : DEFAULT_SNAKE_FOOD_DRAFT.foodShape,
  foodSize: clampNumber(ar?.foodSize, DEFAULT_SNAKE_FOOD_DRAFT.foodSize, 60, 140),
  foodPulse: clampNumber(ar?.foodPulse, DEFAULT_SNAKE_FOOD_DRAFT.foodPulse, 0, 100),
  foodGlowEnabled:
    typeof ar?.foodGlowEnabled === 'boolean'
      ? ar.foodGlowEnabled
      : DEFAULT_SNAKE_FOOD_DRAFT.foodGlowEnabled,
  foodGlowColor:
    typeof ar?.foodGlowColor === 'string'
      ? ar.foodGlowColor
      : DEFAULT_SNAKE_FOOD_DRAFT.foodGlowColor,
  foodGlowSize: clampNumber(
    ar?.foodGlowSize,
    DEFAULT_SNAKE_FOOD_DRAFT.foodGlowSize,
    10,
    140,
  ),
});

export const parseTypingCaretDraftFromAssetRef = (
  ar: Record<string, unknown> | null | undefined,
): TypingCaretDraft => ({
  caretColor:
    typeof ar?.caretColor === 'string'
      ? ar.caretColor
      : DEFAULT_TYPING_CARET_DRAFT.caretColor,
  caretType:
    ar?.caretType === 'bar' || ar?.caretType === 'block' || ar?.caretType === 'underline'
      ? ar.caretType
      : DEFAULT_TYPING_CARET_DRAFT.caretType,
  caretThickness: clampNumber(
    ar?.caretThickness,
    DEFAULT_TYPING_CARET_DRAFT.caretThickness,
    1,
    12,
  ),
  caretGlowStrength: clampNumber(
    ar?.caretGlowStrength,
    DEFAULT_TYPING_CARET_DRAFT.caretGlowStrength,
    0,
    100,
  ),
  caretPulseMode:
    ar?.caretPulseMode === 'none' ||
    ar?.caretPulseMode === 'soft' ||
    ar?.caretPulseMode === 'strong'
      ? ar.caretPulseMode
      : DEFAULT_TYPING_CARET_DRAFT.caretPulseMode,
  caretTrailEnabled:
    typeof ar?.caretTrailEnabled === 'boolean'
      ? ar.caretTrailEnabled
      : DEFAULT_TYPING_CARET_DRAFT.caretTrailEnabled,
});

export const parseTypingFeedbackDraftFromAssetRef = (
  ar: Record<string, unknown> | null | undefined,
): TypingFeedbackDraft => ({
  missEffectColor:
    typeof ar?.missEffectColor === 'string'
      ? ar.missEffectColor
      : typeof ar?.themeErrorColor === 'string'
        ? ar.themeErrorColor
        : DEFAULT_TYPING_FEEDBACK_DRAFT.missEffectColor,
  feedbackStyle:
    ar?.feedbackStyle === 'none' ||
    ar?.feedbackStyle === 'underline' ||
    ar?.feedbackStyle === 'shake' ||
    ar?.feedbackStyle === 'flash' ||
    ar?.feedbackStyle === 'particles'
      ? ar.feedbackStyle
      : DEFAULT_TYPING_FEEDBACK_DRAFT.feedbackStyle,
  feedbackStrength: clampNumber(
    ar?.feedbackStrength,
    DEFAULT_TYPING_FEEDBACK_DRAFT.feedbackStrength,
    0,
    100,
  ),
  feedbackDurationMs: clampNumber(
    ar?.feedbackDurationMs,
    DEFAULT_TYPING_FEEDBACK_DRAFT.feedbackDurationMs,
    80,
    500,
  ),
  feedbackParticlesEnabled:
    typeof ar?.feedbackParticlesEnabled === 'boolean'
      ? ar.feedbackParticlesEnabled
      : DEFAULT_TYPING_FEEDBACK_DRAFT.feedbackParticlesEnabled,
});

export const parseTypingThemeDraftFromAssetRef = (
  ar: Record<string, unknown> | null | undefined,
): TypingThemeDraft => ({
  themeBackgroundColor:
    typeof ar?.themeBackgroundColor === 'string'
      ? ar.themeBackgroundColor
      : typeof ar?.backgroundColor === 'string'
        ? ar.backgroundColor
        : DEFAULT_TYPING_THEME_DRAFT.themeBackgroundColor,
  themeSurfaceColor:
    typeof ar?.themeSurfaceColor === 'string'
      ? ar.themeSurfaceColor
      : typeof ar?.panelBg === 'string'
        ? ar.panelBg
        : DEFAULT_TYPING_THEME_DRAFT.themeSurfaceColor,
  themeBorderColor:
    typeof ar?.themeBorderColor === 'string'
      ? ar.themeBorderColor
      : typeof ar?.panelBorder === 'string'
        ? ar.panelBorder
        : DEFAULT_TYPING_THEME_DRAFT.themeBorderColor,
  themeTextColor:
    typeof ar?.themeTextColor === 'string'
      ? ar.themeTextColor
      : typeof ar?.uiTextColor === 'string'
        ? ar.uiTextColor
        : DEFAULT_TYPING_THEME_DRAFT.themeTextColor,
  themeAccentColor:
    typeof ar?.themeAccentColor === 'string'
      ? ar.themeAccentColor
      : typeof ar?.uiAccentColor === 'string'
        ? ar.uiAccentColor
        : DEFAULT_TYPING_THEME_DRAFT.themeAccentColor,
  themeErrorColor:
    typeof ar?.themeErrorColor === 'string'
      ? ar.themeErrorColor
      : typeof ar?.missEffectColor === 'string'
        ? ar.missEffectColor
        : DEFAULT_TYPING_THEME_DRAFT.themeErrorColor,
  themeSuccessColor:
    typeof ar?.themeSuccessColor === 'string'
      ? ar.themeSuccessColor
      : DEFAULT_TYPING_THEME_DRAFT.themeSuccessColor,
  hudFrameStyle:
    ar?.hudFrameStyle === 'minimal' ||
    ar?.hudFrameStyle === 'glass' ||
    ar?.hudFrameStyle === 'neon' ||
    ar?.hudFrameStyle === 'terminal'
      ? ar.hudFrameStyle
      : DEFAULT_TYPING_THEME_DRAFT.hudFrameStyle,
  hudBadgeStyle:
    ar?.hudBadgeStyle === 'pill' ||
    ar?.hudBadgeStyle === 'chip' ||
    ar?.hudBadgeStyle === 'block' ||
    ar?.hudBadgeStyle === 'outline'
      ? ar.hudBadgeStyle
      : DEFAULT_TYPING_THEME_DRAFT.hudBadgeStyle,
  hudMeterStyle:
    ar?.hudMeterStyle === 'none' ||
    ar?.hudMeterStyle === 'bar' ||
    ar?.hudMeterStyle === 'ring' ||
    ar?.hudMeterStyle === 'pulse'
      ? ar.hudMeterStyle
      : DEFAULT_TYPING_THEME_DRAFT.hudMeterStyle,
  hudShadowStrength: clampNumber(
    ar?.hudShadowStrength,
    DEFAULT_TYPING_THEME_DRAFT.hudShadowStrength,
    0,
    100,
  ),
});

const parseTypingTextFontFamily = (
  value: unknown,
): TypingTextStyleDraft['textFontFamily'] => {
  if (value === 'mono' || value === 'sans' || value === 'serif') return value;
  return DEFAULT_TYPING_TEXT_STYLE_DRAFT.textFontFamily;
};

const parseTypingTextFontWeight = (
  value: unknown,
): TypingTextStyleDraft['textFontWeight'] => {
  if (value === 400 || value === 500 || value === 600 || value === 700) return value;
  return DEFAULT_TYPING_TEXT_STYLE_DRAFT.textFontWeight;
};

export const parseTypingTextStyleDraftFromAssetRef = (
  ar: Record<string, unknown> | null | undefined,
): TypingTextStyleDraft => ({
  textColor:
    typeof ar?.textColor === 'string'
      ? ar.textColor
      : DEFAULT_TYPING_TEXT_STYLE_DRAFT.textColor,
  correctColor:
    typeof ar?.correctColor === 'string'
      ? ar.correctColor
      : DEFAULT_TYPING_TEXT_STYLE_DRAFT.correctColor,
  errorColor:
    typeof ar?.errorColor === 'string'
      ? ar.errorColor
      : DEFAULT_TYPING_TEXT_STYLE_DRAFT.errorColor,
  textFontFamily: parseTypingTextFontFamily(ar?.textFontFamily ?? ar?.fontFamily),
  textFontWeight: parseTypingTextFontWeight(ar?.textFontWeight ?? ar?.fontWeight),
  textLetterSpacing: clampNumber(
    ar?.textLetterSpacing ?? ar?.letterSpacing,
    DEFAULT_TYPING_TEXT_STYLE_DRAFT.textLetterSpacing,
    -1,
    4,
  ),
  textWordSpacing: clampNumber(
    ar?.textWordSpacing ?? ar?.wordSpacing,
    DEFAULT_TYPING_TEXT_STYLE_DRAFT.textWordSpacing,
    8,
    24,
  ),
  textCurrentWordStyle:
    ar?.textCurrentWordStyle === 'none' ||
    ar?.textCurrentWordStyle === 'underline' ||
    ar?.textCurrentWordStyle === 'glow' ||
    ar?.textCurrentWordStyle === 'box'
      ? ar.textCurrentWordStyle
      : DEFAULT_TYPING_TEXT_STYLE_DRAFT.textCurrentWordStyle,
  textCurrentWordColor:
    typeof ar?.textCurrentWordColor === 'string'
      ? ar.textCurrentWordColor
      : DEFAULT_TYPING_TEXT_STYLE_DRAFT.textCurrentWordColor,
  textCurrentWordStrength: clampNumber(
    ar?.textCurrentWordStrength,
    DEFAULT_TYPING_TEXT_STYLE_DRAFT.textCurrentWordStrength,
    0,
    100,
  ),
});

export const composeSnakeBoardAssetRef = (
  draft: SnakeBoardDraft,
): Record<string, unknown> => ({
  boardImageUrl: draft.boardImageUrl.trim(),
  imageUrl: draft.boardImageUrl.trim(),
  boardImageZoom: draft.boardImageZoom,
  boardImageOffsetX: draft.boardImageOffsetX,
  boardImageOffsetY: draft.boardImageOffsetY,
  boardColorA: draft.boardColorA,
  boardColorB: draft.boardColorB,
  boardTileColorA2: draft.boardTileColorA2,
  boardTileColorB2: draft.boardTileColorB2,
  boardTileGradientEnabled: draft.boardTileGradientEnabled,
  boardTileGradientDirection: draft.boardTileGradientDirection,
  boardGlobalGradientEnabled: draft.boardGlobalGradientEnabled,
  boardGlobalGradientStart: draft.boardGlobalGradientStart,
  boardGlobalGradientEnd: draft.boardGlobalGradientEnd,
  boardGlobalGradientDirection: draft.boardGlobalGradientDirection,
  boardGlobalGradientStrength: draft.boardGlobalGradientStrength,
  boardGridLineColor: draft.boardGridLineColor,
  boardGridLineWidth: draft.boardGridLineWidth,
  boardBorderColor: draft.boardBorderColor,
  boardBorderWidth: draft.boardBorderWidth,
  boardVignette: draft.boardVignette,
  // Backward compatibility keys
  boardBg: draft.boardColorA,
  gridLine: draft.boardColorB,
});

export const composeSnakeFoodAssetRef = (
  draft: SnakeFoodDraft,
): Record<string, unknown> => ({
  foodPrimary: draft.foodPrimary,
  foodHighlight: draft.foodHighlight,
  foodStemColor: draft.foodStemColor,
  foodLeafColor: draft.foodLeafColor,
  foodShape: draft.foodShape,
  foodSize: draft.foodSize,
  foodPulse: draft.foodPulse,
  foodGlowEnabled: draft.foodGlowEnabled,
  foodGlowColor: draft.foodGlowColor,
  foodGlowSize: draft.foodGlowSize,
});

export const composeTypingThemeAssetRef = (
  draft: TypingThemeDraft,
): Record<string, unknown> => ({
  themeBackgroundColor: draft.themeBackgroundColor,
  themeSurfaceColor: draft.themeSurfaceColor,
  themeBorderColor: draft.themeBorderColor,
  themeTextColor: draft.themeTextColor,
  themeAccentColor: draft.themeAccentColor,
  themeErrorColor: draft.themeErrorColor,
  themeSuccessColor: draft.themeSuccessColor,
  hudFrameStyle: draft.hudFrameStyle,
  hudBadgeStyle: draft.hudBadgeStyle,
  hudMeterStyle: draft.hudMeterStyle,
  hudShadowStrength: draft.hudShadowStrength,
  hudSurfaceColor: draft.themeSurfaceColor,
  hudBorderColor: draft.themeBorderColor,
  hudAccentColor: draft.themeAccentColor,
  hudTextColor: draft.themeTextColor,
  // Compatibility keys consumed by the typing game today.
  panelBg: draft.themeSurfaceColor,
  panelBorder: draft.themeBorderColor,
  backgroundColor: draft.themeBackgroundColor,
  uiTextColor: draft.themeTextColor,
  uiAccentColor: draft.themeAccentColor,
  missEffectColor: draft.themeErrorColor,
});

export const composeTypingCaretAssetRef = (
  draft: TypingCaretDraft,
): Record<string, unknown> => ({
  caretColor: draft.caretColor,
  caretType: draft.caretType,
  caretThickness: draft.caretThickness,
  caretGlowStrength: draft.caretGlowStrength,
  caretPulseMode: draft.caretPulseMode,
  caretTrailEnabled: draft.caretTrailEnabled,
});

export const composeTypingFeedbackAssetRef = (
  draft: TypingFeedbackDraft,
): Record<string, unknown> => ({
  missEffectColor: draft.missEffectColor,
  feedbackStyle: draft.feedbackStyle,
  feedbackStrength: draft.feedbackStrength,
  feedbackDurationMs: draft.feedbackDurationMs,
  feedbackParticlesEnabled: draft.feedbackParticlesEnabled,
  // Compatibility key used by older readers.
  themeErrorColor: draft.missEffectColor,
});

export const composeTypingTextStyleAssetRef = (
  draft: TypingTextStyleDraft,
): Record<string, unknown> => ({
  textColor: draft.textColor,
  correctColor: draft.correctColor,
  errorColor: draft.errorColor,
  textFontFamily: draft.textFontFamily,
  textFontWeight: draft.textFontWeight,
  textLetterSpacing: draft.textLetterSpacing,
  textWordSpacing: draft.textWordSpacing,
  textCurrentWordStyle: draft.textCurrentWordStyle,
  textCurrentWordColor: draft.textCurrentWordColor,
  textCurrentWordStrength: draft.textCurrentWordStrength,
  // Compatibility aliases for easier cross-reader support.
  fontFamily: draft.textFontFamily,
  fontWeight: draft.textFontWeight,
  letterSpacing: draft.textLetterSpacing,
  wordSpacing: draft.textWordSpacing,
});

// ---------------------------------------------------------------------------
// Flappy Bird drafts
// ---------------------------------------------------------------------------

export type FlappyBirdDraft = {
  birdPrimary: string;
  birdSecondary: string;
};

export type FlappyPipeDraft = {
  pipePrimary: string;
  pipeSecondary: string;
};

export type FlappyBackgroundDraft = {
  skyTop: string;
  skyBottom: string;
  ground: string;
};

export type FlappyTrailDraft = {
  trailColors: string[];
};

export const DEFAULT_FLAPPY_BIRD_DRAFT: FlappyBirdDraft = {
  birdPrimary: '#fbbf24',
  birdSecondary: '#f59e0b',
};

export const DEFAULT_FLAPPY_PIPE_DRAFT: FlappyPipeDraft = {
  pipePrimary: '#16a34a',
  pipeSecondary: '#22c55e',
};

export const DEFAULT_FLAPPY_BACKGROUND_DRAFT: FlappyBackgroundDraft = {
  skyTop: '#0ea5e9',
  skyBottom: '#bae6fd',
  ground: '#84cc16',
};

export const DEFAULT_FLAPPY_TRAIL_DRAFT: FlappyTrailDraft = {
  trailColors: ['#f97316'],
};

// --- Flappy Bird parsers ---

export const parseFlappyBirdDraftFromAssetRef = (
  ar: Record<string, unknown> | null | undefined,
): FlappyBirdDraft => ({
  birdPrimary:
    typeof ar?.birdPrimary === 'string'
      ? ar.birdPrimary
      : DEFAULT_FLAPPY_BIRD_DRAFT.birdPrimary,
  birdSecondary:
    typeof ar?.birdSecondary === 'string'
      ? ar.birdSecondary
      : DEFAULT_FLAPPY_BIRD_DRAFT.birdSecondary,
});

export const parseFlappyPipeDraftFromAssetRef = (
  ar: Record<string, unknown> | null | undefined,
): FlappyPipeDraft => ({
  pipePrimary:
    typeof ar?.pipePrimary === 'string'
      ? ar.pipePrimary
      : DEFAULT_FLAPPY_PIPE_DRAFT.pipePrimary,
  pipeSecondary:
    typeof ar?.pipeSecondary === 'string'
      ? ar.pipeSecondary
      : DEFAULT_FLAPPY_PIPE_DRAFT.pipeSecondary,
});

export const parseFlappyBackgroundDraftFromAssetRef = (
  ar: Record<string, unknown> | null | undefined,
): FlappyBackgroundDraft => ({
  skyTop:
    typeof ar?.skyTop === 'string'
      ? ar.skyTop
      : DEFAULT_FLAPPY_BACKGROUND_DRAFT.skyTop,
  skyBottom:
    typeof ar?.skyBottom === 'string'
      ? ar.skyBottom
      : DEFAULT_FLAPPY_BACKGROUND_DRAFT.skyBottom,
  ground:
    typeof ar?.ground === 'string'
      ? ar.ground
      : DEFAULT_FLAPPY_BACKGROUND_DRAFT.ground,
});

export const parseFlappyTrailDraftFromAssetRef = (
  ar: Record<string, unknown> | null | undefined,
): FlappyTrailDraft => {
  if (Array.isArray(ar?.trailColors) && ar!.trailColors.length > 0) {
    return { trailColors: ar!.trailColors.filter((c: unknown) => typeof c === 'string') as string[] };
  }
  if (typeof ar?.trailColor === 'string') {
    return { trailColors: [ar.trailColor] };
  }
  return { ...DEFAULT_FLAPPY_TRAIL_DRAFT };
};

// --- Flappy Bird composers ---

export const composeFlappyBirdAssetRef = (
  draft: FlappyBirdDraft,
): Record<string, unknown> => ({
  birdPrimary: draft.birdPrimary,
  birdSecondary: draft.birdSecondary,
});

export const composeFlappyPipeAssetRef = (
  draft: FlappyPipeDraft,
): Record<string, unknown> => ({
  pipePrimary: draft.pipePrimary,
  pipeSecondary: draft.pipeSecondary,
});

export const composeFlappyBackgroundAssetRef = (
  draft: FlappyBackgroundDraft,
): Record<string, unknown> => ({
  skyTop: draft.skyTop,
  skyBottom: draft.skyBottom,
  ground: draft.ground,
});

export const composeFlappyTrailAssetRef = (
  draft: FlappyTrailDraft,
): Record<string, unknown> => ({
  trailColors: draft.trailColors,
});

// ---------------------------------------------------------------------------
// Coin Flip drafts
// ---------------------------------------------------------------------------

export type CoinFlipCoinDraft = {
  headsPrimary: string;
  headsSecondary: string;
  headsText: string;
  tailsPrimary: string;
  tailsSecondary: string;
  tailsText: string;
  border: string;
  shine: boolean;
  glow: boolean;
  glowColor: string;
};

export type CoinFlipTrailDraft = {
  particleType: string;
  color: string;
  secondaryColor: string;
  count: number;
  spread: number;
};

export type CoinFlipBackgroundDraft = {
  bgGradientStart: string;
  bgGradientEnd: string;
  accentColor: string;
};

export const DEFAULT_COIN_FLIP_COIN_DRAFT: CoinFlipCoinDraft = {
  headsPrimary: '#fcd34d', headsSecondary: '#f59e0b', headsText: '#92400e',
  tailsPrimary: '#7dd3fc', tailsSecondary: '#0ea5e9', tailsText: '#0c4a6e',
  border: '#d97706', shine: true, glow: false, glowColor: '#ffffff',
};

export const DEFAULT_COIN_FLIP_TRAIL_DRAFT: CoinFlipTrailDraft = {
  particleType: 'sparkle', color: '#fbbf24', secondaryColor: '#f97316',
  count: 8, spread: 15,
};

export const DEFAULT_COIN_FLIP_BACKGROUND_DRAFT: CoinFlipBackgroundDraft = {
  bgGradientStart: '#0f172a', bgGradientEnd: '#1e293b', accentColor: '#334155',
};

// --- Coin Flip parsers ---

const readStr = (ar: Record<string, unknown> | null | undefined, key: string, fallback: string) =>
  typeof ar?.[key] === 'string' ? (ar[key] as string) : fallback;
const readBool = (ar: Record<string, unknown> | null | undefined, key: string, fallback: boolean) =>
  typeof ar?.[key] === 'boolean' ? (ar[key] as boolean) : fallback;
const readNum = (ar: Record<string, unknown> | null | undefined, key: string, fallback: number) =>
  typeof ar?.[key] === 'number' ? (ar[key] as number) : fallback;

export const parseCoinFlipCoinDraftFromAssetRef = (
  ar: Record<string, unknown> | null | undefined,
): CoinFlipCoinDraft => ({
  headsPrimary: readStr(ar, 'headsPrimary', DEFAULT_COIN_FLIP_COIN_DRAFT.headsPrimary),
  headsSecondary: readStr(ar, 'headsSecondary', DEFAULT_COIN_FLIP_COIN_DRAFT.headsSecondary),
  headsText: readStr(ar, 'headsText', DEFAULT_COIN_FLIP_COIN_DRAFT.headsText),
  tailsPrimary: readStr(ar, 'tailsPrimary', DEFAULT_COIN_FLIP_COIN_DRAFT.tailsPrimary),
  tailsSecondary: readStr(ar, 'tailsSecondary', DEFAULT_COIN_FLIP_COIN_DRAFT.tailsSecondary),
  tailsText: readStr(ar, 'tailsText', DEFAULT_COIN_FLIP_COIN_DRAFT.tailsText),
  border: readStr(ar, 'border', DEFAULT_COIN_FLIP_COIN_DRAFT.border),
  shine: readBool(ar, 'shine', DEFAULT_COIN_FLIP_COIN_DRAFT.shine),
  glow: readBool(ar, 'glow', DEFAULT_COIN_FLIP_COIN_DRAFT.glow),
  glowColor: readStr(ar, 'glowColor', DEFAULT_COIN_FLIP_COIN_DRAFT.glowColor),
});

export const parseCoinFlipTrailDraftFromAssetRef = (
  ar: Record<string, unknown> | null | undefined,
): CoinFlipTrailDraft => ({
  particleType: readStr(ar, 'particleType', DEFAULT_COIN_FLIP_TRAIL_DRAFT.particleType),
  color: readStr(ar, 'color', DEFAULT_COIN_FLIP_TRAIL_DRAFT.color),
  secondaryColor: readStr(ar, 'secondaryColor', DEFAULT_COIN_FLIP_TRAIL_DRAFT.secondaryColor),
  count: readNum(ar, 'count', DEFAULT_COIN_FLIP_TRAIL_DRAFT.count),
  spread: readNum(ar, 'spread', DEFAULT_COIN_FLIP_TRAIL_DRAFT.spread),
});

export const parseCoinFlipBackgroundDraftFromAssetRef = (
  ar: Record<string, unknown> | null | undefined,
): CoinFlipBackgroundDraft => ({
  bgGradientStart: readStr(ar, 'bgGradientStart', DEFAULT_COIN_FLIP_BACKGROUND_DRAFT.bgGradientStart),
  bgGradientEnd: readStr(ar, 'bgGradientEnd', DEFAULT_COIN_FLIP_BACKGROUND_DRAFT.bgGradientEnd),
  accentColor: readStr(ar, 'accentColor', DEFAULT_COIN_FLIP_BACKGROUND_DRAFT.accentColor),
});

// --- Coin Flip composers ---

export const composeCoinFlipCoinAssetRef = (draft: CoinFlipCoinDraft): Record<string, unknown> => ({ ...draft });
export const composeCoinFlipTrailAssetRef = (draft: CoinFlipTrailDraft): Record<string, unknown> => ({ ...draft });
export const composeCoinFlipBackgroundAssetRef = (draft: CoinFlipBackgroundDraft): Record<string, unknown> => ({ ...draft });

// ---------------------------------------------------------------------------
// 2048 drafts
// ---------------------------------------------------------------------------

export type Game2048TilesDraft = {
  tile2Bg: string; tile2Fg: string;
  tile4Bg: string; tile4Fg: string;
  tile8Bg: string; tile8Fg: string;
  tile16Bg: string; tile16Fg: string;
  tile32Bg: string; tile32Fg: string;
  tile64Bg: string; tile64Fg: string;
  tile128Bg: string; tile128Fg: string;
  tile256Bg: string; tile256Fg: string;
  tile512Bg: string; tile512Fg: string;
  tile1024Bg: string; tile1024Fg: string;
  tile2048Bg: string; tile2048Fg: string;
  tileFallbackBg: string; tileFallbackFg: string;
  mergePulseEnabled: boolean;
  spawnAnimEnabled: boolean;
  slideDurationMs: number; // 60..260
  glowThreshold: number;   // 64 | 128 | 256 | 512 | 1024
  glowColor: string;
  glowSize: number;        // 0..40
  glowPulse: boolean;
};

export type Game2048GridDraft = {
  gridBg: string;
  gridBorder: string;
  cellBg: string;
};

export type Game2048BackgroundDraft = {
  containerBg: string;
  containerBorder: string;
  containerGradientEnabled: boolean;
  containerGradientStart: string;
  containerGradientEnd: string;
  containerGradientDirection: 'horizontal' | 'vertical' | 'diagonal' | 'radial';
};

export const DEFAULT_GAME_2048_TILES_DRAFT: Game2048TilesDraft = {
  tile2Bg: '#eee4da', tile2Fg: '#776e65',
  tile4Bg: '#ede0c8', tile4Fg: '#776e65',
  tile8Bg: '#f2b179', tile8Fg: '#f9f6f2',
  tile16Bg: '#f59563', tile16Fg: '#f9f6f2',
  tile32Bg: '#f67c5f', tile32Fg: '#f9f6f2',
  tile64Bg: '#f65e3b', tile64Fg: '#f9f6f2',
  tile128Bg: '#edcf72', tile128Fg: '#f9f6f2',
  tile256Bg: '#edcc61', tile256Fg: '#f9f6f2',
  tile512Bg: '#edc850', tile512Fg: '#f9f6f2',
  tile1024Bg: '#edc53f', tile1024Fg: '#f9f6f2',
  tile2048Bg: '#edc22e', tile2048Fg: '#f9f6f2',
  tileFallbackBg: '#3c3a32', tileFallbackFg: '#f9f6f2',
  mergePulseEnabled: true,
  spawnAnimEnabled: true,
  slideDurationMs: 120,
  glowThreshold: 256,
  glowColor: '#ffd166',
  glowSize: 18,
  glowPulse: true,
};

export const DEFAULT_GAME_2048_GRID_DRAFT: Game2048GridDraft = {
  gridBg: '#bbada0',
  gridBorder: '#a59689',
  cellBg: '#cdc1b4',
};

export const DEFAULT_GAME_2048_BACKGROUND_DRAFT: Game2048BackgroundDraft = {
  containerBg: '#1f2937',
  containerBorder: '#334155',
  containerGradientEnabled: false,
  containerGradientStart: '#0f172a',
  containerGradientEnd: '#1e293b',
  containerGradientDirection: 'diagonal',
};

// --- 2048 parsers ---

const readGame2048GradientDirection = (
  ar: Record<string, unknown> | null | undefined,
  key: string,
  fallback: Game2048BackgroundDraft['containerGradientDirection'],
): Game2048BackgroundDraft['containerGradientDirection'] => {
  const value = ar?.[key];
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

export const parseGame2048TilesDraftFromAssetRef = (
  ar: Record<string, unknown> | null | undefined,
): Game2048TilesDraft => ({
  tile2Bg: readStr(ar, 'tile2Bg', DEFAULT_GAME_2048_TILES_DRAFT.tile2Bg),
  tile2Fg: readStr(ar, 'tile2Fg', DEFAULT_GAME_2048_TILES_DRAFT.tile2Fg),
  tile4Bg: readStr(ar, 'tile4Bg', DEFAULT_GAME_2048_TILES_DRAFT.tile4Bg),
  tile4Fg: readStr(ar, 'tile4Fg', DEFAULT_GAME_2048_TILES_DRAFT.tile4Fg),
  tile8Bg: readStr(ar, 'tile8Bg', DEFAULT_GAME_2048_TILES_DRAFT.tile8Bg),
  tile8Fg: readStr(ar, 'tile8Fg', DEFAULT_GAME_2048_TILES_DRAFT.tile8Fg),
  tile16Bg: readStr(ar, 'tile16Bg', DEFAULT_GAME_2048_TILES_DRAFT.tile16Bg),
  tile16Fg: readStr(ar, 'tile16Fg', DEFAULT_GAME_2048_TILES_DRAFT.tile16Fg),
  tile32Bg: readStr(ar, 'tile32Bg', DEFAULT_GAME_2048_TILES_DRAFT.tile32Bg),
  tile32Fg: readStr(ar, 'tile32Fg', DEFAULT_GAME_2048_TILES_DRAFT.tile32Fg),
  tile64Bg: readStr(ar, 'tile64Bg', DEFAULT_GAME_2048_TILES_DRAFT.tile64Bg),
  tile64Fg: readStr(ar, 'tile64Fg', DEFAULT_GAME_2048_TILES_DRAFT.tile64Fg),
  tile128Bg: readStr(ar, 'tile128Bg', DEFAULT_GAME_2048_TILES_DRAFT.tile128Bg),
  tile128Fg: readStr(ar, 'tile128Fg', DEFAULT_GAME_2048_TILES_DRAFT.tile128Fg),
  tile256Bg: readStr(ar, 'tile256Bg', DEFAULT_GAME_2048_TILES_DRAFT.tile256Bg),
  tile256Fg: readStr(ar, 'tile256Fg', DEFAULT_GAME_2048_TILES_DRAFT.tile256Fg),
  tile512Bg: readStr(ar, 'tile512Bg', DEFAULT_GAME_2048_TILES_DRAFT.tile512Bg),
  tile512Fg: readStr(ar, 'tile512Fg', DEFAULT_GAME_2048_TILES_DRAFT.tile512Fg),
  tile1024Bg: readStr(ar, 'tile1024Bg', DEFAULT_GAME_2048_TILES_DRAFT.tile1024Bg),
  tile1024Fg: readStr(ar, 'tile1024Fg', DEFAULT_GAME_2048_TILES_DRAFT.tile1024Fg),
  tile2048Bg: readStr(ar, 'tile2048Bg', DEFAULT_GAME_2048_TILES_DRAFT.tile2048Bg),
  tile2048Fg: readStr(ar, 'tile2048Fg', DEFAULT_GAME_2048_TILES_DRAFT.tile2048Fg),
  tileFallbackBg: readStr(ar, 'tileFallbackBg', DEFAULT_GAME_2048_TILES_DRAFT.tileFallbackBg),
  tileFallbackFg: readStr(ar, 'tileFallbackFg', DEFAULT_GAME_2048_TILES_DRAFT.tileFallbackFg),
  mergePulseEnabled: readBool(ar, 'mergePulseEnabled', DEFAULT_GAME_2048_TILES_DRAFT.mergePulseEnabled),
  spawnAnimEnabled: readBool(ar, 'spawnAnimEnabled', DEFAULT_GAME_2048_TILES_DRAFT.spawnAnimEnabled),
  slideDurationMs: readNum(ar, 'slideDurationMs', DEFAULT_GAME_2048_TILES_DRAFT.slideDurationMs),
  glowThreshold: readNum(ar, 'glowThreshold', DEFAULT_GAME_2048_TILES_DRAFT.glowThreshold),
  glowColor: readStr(ar, 'glowColor', DEFAULT_GAME_2048_TILES_DRAFT.glowColor),
  glowSize: readNum(ar, 'glowSize', DEFAULT_GAME_2048_TILES_DRAFT.glowSize),
  glowPulse: readBool(ar, 'glowPulse', DEFAULT_GAME_2048_TILES_DRAFT.glowPulse),
});

export const parseGame2048GridDraftFromAssetRef = (
  ar: Record<string, unknown> | null | undefined,
): Game2048GridDraft => ({
  gridBg: readStr(ar, 'gridBg', DEFAULT_GAME_2048_GRID_DRAFT.gridBg),
  gridBorder: readStr(ar, 'gridBorder', DEFAULT_GAME_2048_GRID_DRAFT.gridBorder),
  cellBg: readStr(ar, 'cellBg', DEFAULT_GAME_2048_GRID_DRAFT.cellBg),
});

export const parseGame2048BackgroundDraftFromAssetRef = (
  ar: Record<string, unknown> | null | undefined,
): Game2048BackgroundDraft => ({
  containerBg: readStr(ar, 'containerBg', DEFAULT_GAME_2048_BACKGROUND_DRAFT.containerBg),
  containerBorder: readStr(ar, 'containerBorder', DEFAULT_GAME_2048_BACKGROUND_DRAFT.containerBorder),
  containerGradientEnabled: readBool(ar, 'containerGradientEnabled', DEFAULT_GAME_2048_BACKGROUND_DRAFT.containerGradientEnabled),
  containerGradientStart: readStr(ar, 'containerGradientStart', DEFAULT_GAME_2048_BACKGROUND_DRAFT.containerGradientStart),
  containerGradientEnd: readStr(ar, 'containerGradientEnd', DEFAULT_GAME_2048_BACKGROUND_DRAFT.containerGradientEnd),
  containerGradientDirection: readGame2048GradientDirection(ar, 'containerGradientDirection', DEFAULT_GAME_2048_BACKGROUND_DRAFT.containerGradientDirection),
});

// --- 2048 composers ---

export const composeGame2048TilesAssetRef = (draft: Game2048TilesDraft): Record<string, unknown> => ({ ...draft });
export const composeGame2048GridAssetRef = (draft: Game2048GridDraft): Record<string, unknown> => ({ ...draft });
export const composeGame2048BackgroundAssetRef = (draft: Game2048BackgroundDraft): Record<string, unknown> => ({ ...draft });

// ---------------------------------------------------------------------------
// 8-Ball drafts
// ---------------------------------------------------------------------------

export type EightBallCueDraft = {
  cueColor: string;
  cueTipColor: string;
  cueGlow: boolean;
  cueGlowColor: string;
};

export type EightBallBallsDraft = {
  ballYellow: string;
  ballBlue: string;
  ballRed: string;
  ballPurple: string;
  ballOrange: string;
  ballGreen: string;
  ballMaroon: string;
};

export type EightBallTableDraft = {
  feltColor: string;
  feltDark: string;
  railColor: string;
  railBorder: string;
  pocketColor: string;
};

export type EightBallPlayercardDraft = {
  cardBg: string;
  cardAnimation: PlayercardAnimation;
  cardBorder: string;
  nameColor: string;
  eloColor: string;
  animationPrimaryColor: string;
  animationSecondaryColor: string;
};

export const EIGHT_BALL_CARD_ANIMATIONS = PLAYERCARD_ANIMATIONS;

export const DEFAULT_EIGHT_BALL_CUE_DRAFT: EightBallCueDraft = {
  cueColor: '#d4a574',
  cueTipColor: '#1a1a2e',
  cueGlow: false,
  cueGlowColor: '#22d3ee',
};

export const DEFAULT_EIGHT_BALL_BALLS_DRAFT: EightBallBallsDraft = {
  ballYellow: '#f6c700',
  ballBlue: '#003da5',
  ballRed: '#d32f2f',
  ballPurple: '#4a148c',
  ballOrange: '#e65100',
  ballGreen: '#2e7d32',
  ballMaroon: '#6d1b1b',
};

export const DEFAULT_EIGHT_BALL_TABLE_DRAFT: EightBallTableDraft = {
  feltColor: '#0d6b3d',
  feltDark: '#0a5730',
  railColor: '#5c3a1e',
  railBorder: '#3d2512',
  pocketColor: '#111111',
};

export const DEFAULT_EIGHT_BALL_PLAYERCARD_DRAFT: EightBallPlayercardDraft = {
  cardBg: DEFAULT_PLAYERCARD_THEME.cardBg,
  cardAnimation: DEFAULT_PLAYERCARD_THEME.cardAnimation,
  cardBorder: DEFAULT_PLAYERCARD_THEME.cardBorder,
  nameColor: DEFAULT_PLAYERCARD_THEME.nameColor,
  eloColor: DEFAULT_PLAYERCARD_THEME.eloColor,
  animationPrimaryColor: DEFAULT_PLAYERCARD_THEME.animationPrimaryColor,
  animationSecondaryColor: DEFAULT_PLAYERCARD_THEME.animationSecondaryColor,
};

// --- 8-Ball parsers ---

export const parseEightBallCueDraftFromAssetRef = (
  ar: Record<string, unknown> | null | undefined,
): EightBallCueDraft => ({
  cueColor:
    typeof ar?.cueColor === 'string'
      ? ar.cueColor
      : DEFAULT_EIGHT_BALL_CUE_DRAFT.cueColor,
  cueTipColor:
    typeof ar?.cueTipColor === 'string'
      ? ar.cueTipColor
      : DEFAULT_EIGHT_BALL_CUE_DRAFT.cueTipColor,
  cueGlow:
    typeof ar?.cueGlow === 'boolean'
      ? ar.cueGlow
      : DEFAULT_EIGHT_BALL_CUE_DRAFT.cueGlow,
  cueGlowColor:
    typeof ar?.cueGlowColor === 'string'
      ? ar.cueGlowColor
      : DEFAULT_EIGHT_BALL_CUE_DRAFT.cueGlowColor,
});

const BALL_DRAFT_KEYS: (keyof EightBallBallsDraft)[] = [
  'ballYellow', 'ballBlue', 'ballRed', 'ballPurple', 'ballOrange', 'ballGreen', 'ballMaroon',
];

export const parseEightBallBallsDraftFromAssetRef = (
  ar: Record<string, unknown> | null | undefined,
): EightBallBallsDraft => {
  const result = { ...DEFAULT_EIGHT_BALL_BALLS_DRAFT };
  for (const key of BALL_DRAFT_KEYS) {
    if (typeof ar?.[key] === 'string') result[key] = ar[key] as string;
  }
  return result;
};

export const parseEightBallTableDraftFromAssetRef = (
  ar: Record<string, unknown> | null | undefined,
): EightBallTableDraft => ({
  feltColor:
    typeof ar?.feltColor === 'string'
      ? ar.feltColor
      : DEFAULT_EIGHT_BALL_TABLE_DRAFT.feltColor,
  feltDark:
    typeof ar?.feltDark === 'string'
      ? ar.feltDark
      : DEFAULT_EIGHT_BALL_TABLE_DRAFT.feltDark,
  railColor:
    typeof ar?.railColor === 'string'
      ? ar.railColor
      : DEFAULT_EIGHT_BALL_TABLE_DRAFT.railColor,
  railBorder:
    typeof ar?.railBorder === 'string'
      ? ar.railBorder
      : DEFAULT_EIGHT_BALL_TABLE_DRAFT.railBorder,
  pocketColor:
    typeof ar?.pocketColor === 'string'
      ? ar.pocketColor
      : DEFAULT_EIGHT_BALL_TABLE_DRAFT.pocketColor,
});

export const parseEightBallPlayercardDraftFromAssetRef = (
  ar: Record<string, unknown> | null | undefined,
): EightBallPlayercardDraft => ({
  cardBg:
    typeof ar?.cardBg === 'string'
      ? ar.cardBg
      : DEFAULT_EIGHT_BALL_PLAYERCARD_DRAFT.cardBg,
  cardAnimation:
    isPlayercardAnimation(ar?.cardAnimation)
      ? ar.cardAnimation
      : DEFAULT_EIGHT_BALL_PLAYERCARD_DRAFT.cardAnimation,
  cardBorder:
    typeof ar?.cardBorder === 'string'
      ? ar.cardBorder
      : DEFAULT_EIGHT_BALL_PLAYERCARD_DRAFT.cardBorder,
  nameColor:
    typeof ar?.nameColor === 'string'
      ? ar.nameColor
      : DEFAULT_EIGHT_BALL_PLAYERCARD_DRAFT.nameColor,
  eloColor:
    typeof ar?.eloColor === 'string'
      ? ar.eloColor
      : DEFAULT_EIGHT_BALL_PLAYERCARD_DRAFT.eloColor,
  animationPrimaryColor:
    typeof ar?.animationPrimaryColor === 'string'
      ? ar.animationPrimaryColor
      : DEFAULT_EIGHT_BALL_PLAYERCARD_DRAFT.animationPrimaryColor,
  animationSecondaryColor:
    typeof ar?.animationSecondaryColor === 'string'
      ? ar.animationSecondaryColor
      : DEFAULT_EIGHT_BALL_PLAYERCARD_DRAFT.animationSecondaryColor,
});

// --- 8-Ball composers ---

export const composeEightBallCueAssetRef = (
  draft: EightBallCueDraft,
): Record<string, unknown> => ({
  cueColor: draft.cueColor,
  cueTipColor: draft.cueTipColor,
  cueGlow: draft.cueGlow,
  cueGlowColor: draft.cueGlowColor,
});

export const composeEightBallBallsAssetRef = (
  draft: EightBallBallsDraft,
): Record<string, unknown> => ({
  ballYellow: draft.ballYellow,
  ballBlue: draft.ballBlue,
  ballRed: draft.ballRed,
  ballPurple: draft.ballPurple,
  ballOrange: draft.ballOrange,
  ballGreen: draft.ballGreen,
  ballMaroon: draft.ballMaroon,
});

export const composeEightBallTableAssetRef = (
  draft: EightBallTableDraft,
): Record<string, unknown> => ({
  feltColor: draft.feltColor,
  feltDark: draft.feltDark,
  railColor: draft.railColor,
  railBorder: draft.railBorder,
  pocketColor: draft.pocketColor,
});

export const composeEightBallPlayercardAssetRef = (
  draft: EightBallPlayercardDraft,
): Record<string, unknown> => ({
  cardBg: draft.cardBg,
  cardAnimation: draft.cardAnimation,
  cardBorder: draft.cardBorder,
  nameColor: draft.nameColor,
  eloColor: draft.eloColor,
  animationPrimaryColor: draft.animationPrimaryColor,
  animationSecondaryColor: draft.animationSecondaryColor,
});

// ---------------------------------------------------------------------------
// Tetris Drafts
// ---------------------------------------------------------------------------

type TetrisBlockShading = 'flat' | 'bevel' | 'gradient' | 'neon';

export type TetrisBlocksDraft = {
  colorI: string;
  colorO: string;
  colorT: string;
  colorS: string;
  colorZ: string;
  colorJ: string;
  colorL: string;
  blockShading: TetrisBlockShading;
  highlightColor: string;
  highlightIntensity: number;
  borderColor: string;
  borderWidth: number;
  blockGlowEnabled: boolean;
  blockGlowColor: string;
  blockGlowSize: number;
};

type TetrisBoardBgMode = 'solid' | 'linear' | 'radial';

export type TetrisBoardDraft = {
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
};

type TetrisLineClearStyle = 'flash' | 'dissolve' | 'shatter' | 'sweep';

export type TetrisEffectsDraft = {
  lineClearStyle: TetrisLineClearStyle;
  lineClearColor: string;
  lineClearIntensity: number;
  tetrisClearColor: string;
  tspinHighlightColor: string;
  lockFlashColor: string;
  lockFlashIntensity: number;
  hardDropImpactColor: string;
  hardDropImpactSize: number;
};

type TetrisGhostStyle = 'outline' | 'filled-translucent' | 'dashed';

export type TetrisGhostDraft = {
  ghostStyle: TetrisGhostStyle;
  ghostOpacity: number;
  ghostTintEnabled: boolean;
  ghostTintColor: string;
  panelBgColor: string;
  panelBorderColor: string;
  panelAccentColor: string;
};

// --- Defaults ---

export const DEFAULT_TETRIS_BLOCKS_DRAFT: TetrisBlocksDraft = {
  colorI: '#00f0f0',
  colorO: '#f0f000',
  colorT: '#a000f0',
  colorS: '#00f000',
  colorZ: '#f00000',
  colorJ: '#0000f0',
  colorL: '#f0a000',
  blockShading: 'bevel',
  highlightColor: '#ffffff',
  highlightIntensity: 15,
  borderColor: '#000000',
  borderWidth: 0,
  blockGlowEnabled: false,
  blockGlowColor: '#ffffff',
  blockGlowSize: 40,
};

export const DEFAULT_TETRIS_BOARD_DRAFT: TetrisBoardDraft = {
  boardBgMode: 'solid',
  boardBgStart: '#0a0a14',
  boardBgEnd: '#101028',
  gridLineColor: '#ffffff',
  gridLineWidth: 1,
  gridVisible: true,
  borderColor: '#64c8ff',
  borderWidth: 2,
  borderGlowEnabled: false,
  borderGlowColor: '#64c8ff',
  emptyCellTint: '#ffffff',
  emptyCellTintStrength: 0,
  vignette: 0,
};

export const DEFAULT_TETRIS_EFFECTS_DRAFT: TetrisEffectsDraft = {
  lineClearStyle: 'flash',
  lineClearColor: '#ffffff',
  lineClearIntensity: 70,
  tetrisClearColor: '#ffd700',
  tspinHighlightColor: '#a000f0',
  lockFlashColor: '#ffffff',
  lockFlashIntensity: 20,
  hardDropImpactColor: '#ffffff',
  hardDropImpactSize: 50,
};

export const DEFAULT_TETRIS_GHOST_DRAFT: TetrisGhostDraft = {
  ghostStyle: 'filled-translucent',
  ghostOpacity: 20,
  ghostTintEnabled: false,
  ghostTintColor: '#ffffff',
  panelBgColor: '#0a0a14',
  panelBorderColor: '#2a2a3a',
  panelAccentColor: '#64c8ff',
};

const TETRIS_BLOCK_SHADINGS: readonly TetrisBlockShading[] = [
  'flat',
  'bevel',
  'gradient',
  'neon',
];
const TETRIS_BG_MODES: readonly TetrisBoardBgMode[] = ['solid', 'linear', 'radial'];
const TETRIS_LINE_CLEAR_STYLES: readonly TetrisLineClearStyle[] = [
  'flash',
  'dissolve',
  'shatter',
  'sweep',
];
const TETRIS_GHOST_STYLES: readonly TetrisGhostStyle[] = [
  'outline',
  'filled-translucent',
  'dashed',
];

// --- Parsers ---

export const parseTetrisBlocksDraftFromAssetRef = (
  ar: Record<string, unknown> | null | undefined,
): TetrisBlocksDraft => ({
  colorI:
    typeof ar?.colorI === 'string' ? ar.colorI : DEFAULT_TETRIS_BLOCKS_DRAFT.colorI,
  colorO:
    typeof ar?.colorO === 'string' ? ar.colorO : DEFAULT_TETRIS_BLOCKS_DRAFT.colorO,
  colorT:
    typeof ar?.colorT === 'string' ? ar.colorT : DEFAULT_TETRIS_BLOCKS_DRAFT.colorT,
  colorS:
    typeof ar?.colorS === 'string' ? ar.colorS : DEFAULT_TETRIS_BLOCKS_DRAFT.colorS,
  colorZ:
    typeof ar?.colorZ === 'string' ? ar.colorZ : DEFAULT_TETRIS_BLOCKS_DRAFT.colorZ,
  colorJ:
    typeof ar?.colorJ === 'string' ? ar.colorJ : DEFAULT_TETRIS_BLOCKS_DRAFT.colorJ,
  colorL:
    typeof ar?.colorL === 'string' ? ar.colorL : DEFAULT_TETRIS_BLOCKS_DRAFT.colorL,
  blockShading: TETRIS_BLOCK_SHADINGS.includes(
    ar?.blockShading as TetrisBlockShading,
  )
    ? (ar?.blockShading as TetrisBlockShading)
    : DEFAULT_TETRIS_BLOCKS_DRAFT.blockShading,
  highlightColor:
    typeof ar?.highlightColor === 'string'
      ? ar.highlightColor
      : DEFAULT_TETRIS_BLOCKS_DRAFT.highlightColor,
  highlightIntensity: clampNumber(ar?.highlightIntensity, 15, 0, 100),
  borderColor:
    typeof ar?.borderColor === 'string'
      ? ar.borderColor
      : DEFAULT_TETRIS_BLOCKS_DRAFT.borderColor,
  borderWidth: clampNumber(ar?.borderWidth, 0, 0, 4),
  blockGlowEnabled:
    typeof ar?.blockGlowEnabled === 'boolean'
      ? ar.blockGlowEnabled
      : DEFAULT_TETRIS_BLOCKS_DRAFT.blockGlowEnabled,
  blockGlowColor:
    typeof ar?.blockGlowColor === 'string'
      ? ar.blockGlowColor
      : DEFAULT_TETRIS_BLOCKS_DRAFT.blockGlowColor,
  blockGlowSize: clampNumber(ar?.blockGlowSize, 40, 0, 100),
});

export const parseTetrisBoardDraftFromAssetRef = (
  ar: Record<string, unknown> | null | undefined,
): TetrisBoardDraft => ({
  boardBgMode: TETRIS_BG_MODES.includes(ar?.boardBgMode as TetrisBoardBgMode)
    ? (ar?.boardBgMode as TetrisBoardBgMode)
    : DEFAULT_TETRIS_BOARD_DRAFT.boardBgMode,
  boardBgStart:
    typeof ar?.boardBgStart === 'string'
      ? ar.boardBgStart
      : DEFAULT_TETRIS_BOARD_DRAFT.boardBgStart,
  boardBgEnd:
    typeof ar?.boardBgEnd === 'string'
      ? ar.boardBgEnd
      : DEFAULT_TETRIS_BOARD_DRAFT.boardBgEnd,
  gridLineColor:
    typeof ar?.gridLineColor === 'string'
      ? ar.gridLineColor
      : DEFAULT_TETRIS_BOARD_DRAFT.gridLineColor,
  gridLineWidth: clampNumber(ar?.gridLineWidth, 1, 0, 4),
  gridVisible:
    typeof ar?.gridVisible === 'boolean'
      ? ar.gridVisible
      : DEFAULT_TETRIS_BOARD_DRAFT.gridVisible,
  borderColor:
    typeof ar?.borderColor === 'string'
      ? ar.borderColor
      : DEFAULT_TETRIS_BOARD_DRAFT.borderColor,
  borderWidth: clampNumber(ar?.borderWidth, 2, 0, 8),
  borderGlowEnabled:
    typeof ar?.borderGlowEnabled === 'boolean'
      ? ar.borderGlowEnabled
      : DEFAULT_TETRIS_BOARD_DRAFT.borderGlowEnabled,
  borderGlowColor:
    typeof ar?.borderGlowColor === 'string'
      ? ar.borderGlowColor
      : DEFAULT_TETRIS_BOARD_DRAFT.borderGlowColor,
  emptyCellTint:
    typeof ar?.emptyCellTint === 'string'
      ? ar.emptyCellTint
      : DEFAULT_TETRIS_BOARD_DRAFT.emptyCellTint,
  emptyCellTintStrength: clampNumber(ar?.emptyCellTintStrength, 0, 0, 20),
  vignette: clampNumber(ar?.vignette, 0, 0, 100),
});

export const parseTetrisEffectsDraftFromAssetRef = (
  ar: Record<string, unknown> | null | undefined,
): TetrisEffectsDraft => ({
  lineClearStyle: TETRIS_LINE_CLEAR_STYLES.includes(
    ar?.lineClearStyle as TetrisLineClearStyle,
  )
    ? (ar?.lineClearStyle as TetrisLineClearStyle)
    : DEFAULT_TETRIS_EFFECTS_DRAFT.lineClearStyle,
  lineClearColor:
    typeof ar?.lineClearColor === 'string'
      ? ar.lineClearColor
      : DEFAULT_TETRIS_EFFECTS_DRAFT.lineClearColor,
  lineClearIntensity: clampNumber(ar?.lineClearIntensity, 70, 0, 100),
  tetrisClearColor:
    typeof ar?.tetrisClearColor === 'string'
      ? ar.tetrisClearColor
      : DEFAULT_TETRIS_EFFECTS_DRAFT.tetrisClearColor,
  tspinHighlightColor:
    typeof ar?.tspinHighlightColor === 'string'
      ? ar.tspinHighlightColor
      : DEFAULT_TETRIS_EFFECTS_DRAFT.tspinHighlightColor,
  lockFlashColor:
    typeof ar?.lockFlashColor === 'string'
      ? ar.lockFlashColor
      : DEFAULT_TETRIS_EFFECTS_DRAFT.lockFlashColor,
  lockFlashIntensity: clampNumber(ar?.lockFlashIntensity, 20, 0, 100),
  hardDropImpactColor:
    typeof ar?.hardDropImpactColor === 'string'
      ? ar.hardDropImpactColor
      : DEFAULT_TETRIS_EFFECTS_DRAFT.hardDropImpactColor,
  hardDropImpactSize: clampNumber(ar?.hardDropImpactSize, 50, 0, 100),
});

export const parseTetrisGhostDraftFromAssetRef = (
  ar: Record<string, unknown> | null | undefined,
): TetrisGhostDraft => ({
  ghostStyle: TETRIS_GHOST_STYLES.includes(ar?.ghostStyle as TetrisGhostStyle)
    ? (ar?.ghostStyle as TetrisGhostStyle)
    : DEFAULT_TETRIS_GHOST_DRAFT.ghostStyle,
  ghostOpacity: clampNumber(ar?.ghostOpacity, 20, 5, 60),
  ghostTintEnabled:
    typeof ar?.ghostTintEnabled === 'boolean'
      ? ar.ghostTintEnabled
      : DEFAULT_TETRIS_GHOST_DRAFT.ghostTintEnabled,
  ghostTintColor:
    typeof ar?.ghostTintColor === 'string'
      ? ar.ghostTintColor
      : DEFAULT_TETRIS_GHOST_DRAFT.ghostTintColor,
  panelBgColor:
    typeof ar?.panelBgColor === 'string'
      ? ar.panelBgColor
      : DEFAULT_TETRIS_GHOST_DRAFT.panelBgColor,
  panelBorderColor:
    typeof ar?.panelBorderColor === 'string'
      ? ar.panelBorderColor
      : DEFAULT_TETRIS_GHOST_DRAFT.panelBorderColor,
  panelAccentColor:
    typeof ar?.panelAccentColor === 'string'
      ? ar.panelAccentColor
      : DEFAULT_TETRIS_GHOST_DRAFT.panelAccentColor,
});

// --- Composers ---

export const composeTetrisBlocksAssetRef = (
  draft: TetrisBlocksDraft,
): Record<string, unknown> => ({
  colorI: draft.colorI,
  colorO: draft.colorO,
  colorT: draft.colorT,
  colorS: draft.colorS,
  colorZ: draft.colorZ,
  colorJ: draft.colorJ,
  colorL: draft.colorL,
  blockShading: draft.blockShading,
  highlightColor: draft.highlightColor,
  highlightIntensity: draft.highlightIntensity,
  borderColor: draft.borderColor,
  borderWidth: draft.borderWidth,
  blockGlowEnabled: draft.blockGlowEnabled,
  blockGlowColor: draft.blockGlowColor,
  blockGlowSize: draft.blockGlowSize,
});

export const composeTetrisBoardAssetRef = (
  draft: TetrisBoardDraft,
): Record<string, unknown> => ({
  boardBgMode: draft.boardBgMode,
  boardBgStart: draft.boardBgStart,
  boardBgEnd: draft.boardBgEnd,
  gridLineColor: draft.gridLineColor,
  gridLineWidth: draft.gridLineWidth,
  gridVisible: draft.gridVisible,
  borderColor: draft.borderColor,
  borderWidth: draft.borderWidth,
  borderGlowEnabled: draft.borderGlowEnabled,
  borderGlowColor: draft.borderGlowColor,
  emptyCellTint: draft.emptyCellTint,
  emptyCellTintStrength: draft.emptyCellTintStrength,
  vignette: draft.vignette,
});

export const composeTetrisEffectsAssetRef = (
  draft: TetrisEffectsDraft,
): Record<string, unknown> => ({
  lineClearStyle: draft.lineClearStyle,
  lineClearColor: draft.lineClearColor,
  lineClearIntensity: draft.lineClearIntensity,
  tetrisClearColor: draft.tetrisClearColor,
  tspinHighlightColor: draft.tspinHighlightColor,
  lockFlashColor: draft.lockFlashColor,
  lockFlashIntensity: draft.lockFlashIntensity,
  hardDropImpactColor: draft.hardDropImpactColor,
  hardDropImpactSize: draft.hardDropImpactSize,
});

export const composeTetrisGhostAssetRef = (
  draft: TetrisGhostDraft,
): Record<string, unknown> => ({
  ghostStyle: draft.ghostStyle,
  ghostOpacity: draft.ghostOpacity,
  ghostTintEnabled: draft.ghostTintEnabled,
  ghostTintColor: draft.ghostTintColor,
  panelBgColor: draft.panelBgColor,
  panelBorderColor: draft.panelBorderColor,
  panelAccentColor: draft.panelAccentColor,
});

// ---------------------------------------------------------------------------
// Chess drafts — pieces / board / clock slots.
// Field names mirror the assetRef keys consumed by composeChessTheme, so
// saved items drop straight into the in-game theme composer.
// ---------------------------------------------------------------------------

export type ChessBoardDraft = {
  boardLightColor: string;
  boardDarkColor: string;
  boardBorderColor: string;
  boardHighlightColor: string;
  boardSelectedColor: string;
  boardLegalMoveColor: string;
};

export type ChessPiecesDraft = {
  piecesWhiteColor: string;
  piecesBlackColor: string;
  piecesWhiteShadow: string;
  piecesBlackShadow: string;
};

export type ChessClockDraft = {
  clockActiveColor: string;
  clockActiveBg: string;
  clockWarningColor: string;
};

export const DEFAULT_CHESS_BOARD_DRAFT: ChessBoardDraft = {
  boardLightColor: '#f0d9b5',
  boardDarkColor: '#b58863',
  boardBorderColor: '#3d2817',
  boardHighlightColor: '#fbbf2470',
  boardSelectedColor: '#22c55e',
  boardLegalMoveColor: '#22c55e',
};

export const DEFAULT_CHESS_PIECES_DRAFT: ChessPiecesDraft = {
  piecesWhiteColor: '#f8fafc',
  piecesBlackColor: '#0f172a',
  piecesWhiteShadow: 'rgba(0, 0, 0, 0.7)',
  piecesBlackShadow: 'rgba(255, 255, 255, 0.2)',
};

export const DEFAULT_CHESS_CLOCK_DRAFT: ChessClockDraft = {
  clockActiveColor: '#34d399',
  clockActiveBg: 'rgba(16, 185, 129, 0.1)',
  clockWarningColor: '#ef4444',
};

export const parseChessBoardDraftFromAssetRef = (
  ar: Record<string, unknown> | null | undefined,
): ChessBoardDraft => ({
  boardLightColor:
    typeof ar?.boardLightColor === 'string'
      ? ar.boardLightColor
      : DEFAULT_CHESS_BOARD_DRAFT.boardLightColor,
  boardDarkColor:
    typeof ar?.boardDarkColor === 'string'
      ? ar.boardDarkColor
      : DEFAULT_CHESS_BOARD_DRAFT.boardDarkColor,
  boardBorderColor:
    typeof ar?.boardBorderColor === 'string'
      ? ar.boardBorderColor
      : DEFAULT_CHESS_BOARD_DRAFT.boardBorderColor,
  boardHighlightColor:
    typeof ar?.boardHighlightColor === 'string'
      ? ar.boardHighlightColor
      : DEFAULT_CHESS_BOARD_DRAFT.boardHighlightColor,
  boardSelectedColor:
    typeof ar?.boardSelectedColor === 'string'
      ? ar.boardSelectedColor
      : DEFAULT_CHESS_BOARD_DRAFT.boardSelectedColor,
  boardLegalMoveColor:
    typeof ar?.boardLegalMoveColor === 'string'
      ? ar.boardLegalMoveColor
      : DEFAULT_CHESS_BOARD_DRAFT.boardLegalMoveColor,
});

export const parseChessPiecesDraftFromAssetRef = (
  ar: Record<string, unknown> | null | undefined,
): ChessPiecesDraft => ({
  piecesWhiteColor:
    typeof ar?.piecesWhiteColor === 'string'
      ? ar.piecesWhiteColor
      : DEFAULT_CHESS_PIECES_DRAFT.piecesWhiteColor,
  piecesBlackColor:
    typeof ar?.piecesBlackColor === 'string'
      ? ar.piecesBlackColor
      : DEFAULT_CHESS_PIECES_DRAFT.piecesBlackColor,
  piecesWhiteShadow:
    typeof ar?.piecesWhiteShadow === 'string'
      ? ar.piecesWhiteShadow
      : DEFAULT_CHESS_PIECES_DRAFT.piecesWhiteShadow,
  piecesBlackShadow:
    typeof ar?.piecesBlackShadow === 'string'
      ? ar.piecesBlackShadow
      : DEFAULT_CHESS_PIECES_DRAFT.piecesBlackShadow,
});

export const parseChessClockDraftFromAssetRef = (
  ar: Record<string, unknown> | null | undefined,
): ChessClockDraft => ({
  clockActiveColor:
    typeof ar?.clockActiveColor === 'string'
      ? ar.clockActiveColor
      : DEFAULT_CHESS_CLOCK_DRAFT.clockActiveColor,
  clockActiveBg:
    typeof ar?.clockActiveBg === 'string'
      ? ar.clockActiveBg
      : DEFAULT_CHESS_CLOCK_DRAFT.clockActiveBg,
  clockWarningColor:
    typeof ar?.clockWarningColor === 'string'
      ? ar.clockWarningColor
      : DEFAULT_CHESS_CLOCK_DRAFT.clockWarningColor,
});

export const composeChessBoardAssetRef = (
  draft: ChessBoardDraft,
): Record<string, unknown> => ({ ...draft });

export const composeChessPiecesAssetRef = (
  draft: ChessPiecesDraft,
): Record<string, unknown> => ({ ...draft });

export const composeChessClockAssetRef = (
  draft: ChessClockDraft,
): Record<string, unknown> => ({ ...draft });
