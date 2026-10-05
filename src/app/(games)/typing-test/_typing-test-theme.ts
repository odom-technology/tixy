import type { TypingCosmeticTheme, InventoryCosmeticResponse } from './_typing-test-types';
import { DEFAULT_TYPING_THEME } from './_typing-test-types';

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
) => {
  const value = assetRef?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

const clampNumber = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export const buildTypingTheme = (response: InventoryCosmeticResponse): TypingCosmeticTheme => {
  const theme = { ...DEFAULT_TYPING_THEME };
  const applyHudVisuals = (assetRef: Record<string, unknown>) => {
    const frameStyle = assetRef.hudFrameStyle;
    if (
      frameStyle === 'minimal' ||
      frameStyle === 'glass' ||
      frameStyle === 'neon' ||
      frameStyle === 'terminal'
    ) {
      theme.hudFrameStyle = frameStyle;
    }
    const badgeStyle = assetRef.hudBadgeStyle;
    if (
      badgeStyle === 'pill' ||
      badgeStyle === 'chip' ||
      badgeStyle === 'block' ||
      badgeStyle === 'outline'
    ) {
      theme.hudBadgeStyle = badgeStyle;
    }
    const meterStyle = assetRef.hudMeterStyle;
    if (
      meterStyle === 'none' ||
      meterStyle === 'bar' ||
      meterStyle === 'ring' ||
      meterStyle === 'pulse'
    ) {
      theme.hudMeterStyle = meterStyle;
    }
    theme.hudAccentColor = readAssetColor(
      assetRef,
      'hudAccentColor',
      readAssetColor(assetRef, 'themeAccentColor', theme.hudAccentColor),
    );
    theme.hudTextColor = readAssetColor(
      assetRef,
      'hudTextColor',
      readAssetColor(assetRef, 'themeTextColor', theme.hudTextColor),
    );
    theme.hudShadowStrength = readAssetNumber(
      assetRef,
      'hudShadowStrength',
      theme.hudShadowStrength,
    );
    theme.hudSurfaceColor = readAssetColor(
      assetRef,
      'hudSurfaceColor',
      readAssetColor(
        assetRef,
        'themeSurfaceColor',
        readAssetColor(assetRef, 'panelBg', theme.hudSurfaceColor),
      ),
    );
    theme.hudBorderColor = readAssetColor(
      assetRef,
      'hudBorderColor',
      readAssetColor(
        assetRef,
        'themeBorderColor',
        readAssetColor(assetRef, 'panelBorder', theme.hudBorderColor),
      ),
    );
  };

  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;
    if (slot === 'caret') {
      theme.caretColor = readAssetColor(assetRef, 'caretColor', theme.caretColor);
      const caretType = assetRef.caretType;
      if (caretType === 'bar' || caretType === 'block' || caretType === 'underline') {
        theme.caretType = caretType;
      }
      theme.caretThickness = clampNumber(
        readAssetNumber(assetRef, 'caretThickness', theme.caretThickness),
        1,
        12,
      );
      theme.caretGlowStrength = clampNumber(
        readAssetNumber(assetRef, 'caretGlowStrength', theme.caretGlowStrength),
        0,
        100,
      );
      const caretPulseMode = assetRef.caretPulseMode;
      if (caretPulseMode === 'none' || caretPulseMode === 'soft' || caretPulseMode === 'strong') {
        theme.caretPulseMode = caretPulseMode;
      }
      if (typeof assetRef.caretTrailEnabled === 'boolean') {
        theme.caretTrailEnabled = assetRef.caretTrailEnabled;
      }
    } else if (slot === 'text-style' || slot === 'word_theme') {
      theme.textColor = readAssetColor(assetRef, 'textColor', theme.textColor);
      theme.correctColor = readAssetColor(
        assetRef,
        'correctColor',
        theme.correctColor,
      );
      theme.errorColor = readAssetColor(assetRef, 'errorColor', theme.errorColor);
      const textFontFamily = assetRef.textFontFamily ?? assetRef.fontFamily;
      if (
        textFontFamily === 'mono' ||
        textFontFamily === 'sans' ||
        textFontFamily === 'serif'
      ) {
        theme.textFontFamily = textFontFamily;
        theme.hudFontFamily = textFontFamily;
      }
      const textFontWeight = Number(assetRef.textFontWeight ?? assetRef.fontWeight);
      if (
        textFontWeight === 400 ||
        textFontWeight === 500 ||
        textFontWeight === 600 ||
        textFontWeight === 700
      ) {
        theme.textFontWeight = textFontWeight;
        theme.hudFontWeight = textFontWeight;
      }
      theme.textLetterSpacing = clampNumber(
        readAssetNumber(
          assetRef,
          'textLetterSpacing',
          readAssetNumber(assetRef, 'letterSpacing', theme.textLetterSpacing),
        ),
        -1,
        4,
      );
      theme.textWordSpacing = clampNumber(
        readAssetNumber(
          assetRef,
          'textWordSpacing',
          readAssetNumber(assetRef, 'wordSpacing', theme.textWordSpacing),
        ),
        8,
        24,
      );
      const currentWordStyle = assetRef.textCurrentWordStyle;
      if (
        currentWordStyle === 'none' ||
        currentWordStyle === 'underline' ||
        currentWordStyle === 'glow' ||
        currentWordStyle === 'box'
      ) {
        theme.textCurrentWordStyle = currentWordStyle;
      }
      theme.textCurrentWordColor = readAssetColor(
        assetRef,
        'textCurrentWordColor',
        theme.textCurrentWordColor,
      );
      theme.textCurrentWordStrength = clampNumber(
        readAssetNumber(
          assetRef,
          'textCurrentWordStrength',
          theme.textCurrentWordStrength,
        ),
        0,
        100,
      );
    } else if (slot === 'theme' || slot === 'background') {
      theme.panelBg = readAssetColor(
        assetRef,
        'panelBg',
        readAssetColor(assetRef, 'themeSurfaceColor', theme.panelBg),
      );
      theme.panelBorder = readAssetColor(
        assetRef,
        'panelBorder',
        readAssetColor(assetRef, 'themeBorderColor', theme.panelBorder),
      );
      applyHudVisuals(assetRef);
    } else if (slot === 'hud') {
      // Legacy fallback: theme now owns HUD visuals.
      applyHudVisuals(assetRef);
    } else if (slot === 'feedback' || slot === 'miss_effect') {
      theme.missEffectColor = readAssetColor(
        assetRef,
        'missEffectColor',
        theme.missEffectColor,
      );
      const feedbackStyle = assetRef.feedbackStyle;
      if (
        feedbackStyle === 'none' ||
        feedbackStyle === 'underline' ||
        feedbackStyle === 'shake' ||
        feedbackStyle === 'flash' ||
        feedbackStyle === 'particles'
      ) {
        theme.feedbackStyle = feedbackStyle;
      }
      theme.feedbackStrength = clampNumber(
        readAssetNumber(assetRef, 'feedbackStrength', theme.feedbackStrength),
        0,
        100,
      );
      theme.feedbackDurationMs = clampNumber(
        readAssetNumber(assetRef, 'feedbackDurationMs', theme.feedbackDurationMs),
        80,
        500,
      );
      if (typeof assetRef.feedbackParticlesEnabled === 'boolean') {
        theme.feedbackParticlesEnabled = assetRef.feedbackParticlesEnabled;
      }
    }
  }

  return theme;
};

export const getFontFamilyCss = (family: TypingCosmeticTheme['textFontFamily']) => {
  if (family === 'sans') return 'ui-sans-serif, system-ui, sans-serif';
  if (family === 'serif') return 'ui-serif, Georgia, Cambria, serif';
  return 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
};
