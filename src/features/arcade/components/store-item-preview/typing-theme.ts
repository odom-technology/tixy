import { readStr, readNum, readBool, readEnum } from './helpers';

export type TypingPreviewSlot = 'theme' | 'caret' | 'feedback' | 'text-style';
export type TypingPreviewContext = Partial<
  Record<TypingPreviewSlot, Record<string, unknown> | null>
>;
type TypingPreviewTheme = {
  caretColor: string;
  caretType: 'bar' | 'block' | 'underline';
  caretThickness: number;
  caretGlowStrength: number;
  caretPulseMode: 'none' | 'soft' | 'strong';
  caretTrailEnabled: boolean;
  textColor: string;
  correctColor: string;
  errorColor: string;
  textFontFamily: 'mono' | 'sans' | 'serif';
  textFontWeight: 400 | 500 | 600 | 700;
  textLetterSpacing: number;
  textCurrentWordStyle: 'none' | 'underline' | 'glow' | 'box';
  textCurrentWordColor: string;
  textCurrentWordStrength: number;
  panelBg: string;
  panelBorder: string;
  hudSurfaceColor: string;
  hudBorderColor: string;
  hudFrameStyle: 'minimal' | 'glass' | 'neon' | 'terminal';
  hudBadgeStyle: 'pill' | 'chip' | 'block' | 'outline';
  hudMeterStyle: 'none' | 'bar' | 'ring' | 'pulse';
  hudAccentColor: string;
  hudTextColor: string;
  hudShadowStrength: number;
  missEffectColor: string;
  feedbackStyle: 'none' | 'underline' | 'shake' | 'flash' | 'particles';
  feedbackStrength: number;
  feedbackDurationMs: number;
  feedbackParticlesEnabled: boolean;
};

const DEFAULT_TYPING_PREVIEW_THEME: TypingPreviewTheme = {
  caretColor: '#facc15',
  caretType: 'bar',
  caretThickness: 3,
  caretGlowStrength: 30,
  caretPulseMode: 'none',
  caretTrailEnabled: false,
  textColor: '#64748b',
  correctColor: '#e2e8f0',
  errorColor: '#ef4444',
  textFontFamily: 'mono',
  textFontWeight: 500,
  textLetterSpacing: 0,
  textCurrentWordStyle: 'underline',
  textCurrentWordColor: '#facc15',
  textCurrentWordStrength: 45,
  panelBg: '#1e1e2e',
  panelBorder: '#334155',
  hudSurfaceColor: '#0f172a',
  hudBorderColor: '#334155',
  hudFrameStyle: 'glass',
  hudBadgeStyle: 'pill',
  hudMeterStyle: 'bar',
  hudAccentColor: '#22d3ee',
  hudTextColor: '#e2e8f0',
  hudShadowStrength: 42,
  missEffectColor: '#fb7185',
  feedbackStyle: 'underline',
  feedbackStrength: 45,
  feedbackDurationMs: 160,
  feedbackParticlesEnabled: false,
};

export const resolveTypingPreviewSlot = (slots: string[]): TypingPreviewSlot | null => {
  if (slots.includes('theme') || slots.includes('hud')) return 'theme';
  if (slots.includes('caret')) return 'caret';
  if (slots.includes('feedback')) return 'feedback';
  if (slots.includes('text-style')) return 'text-style';
  return null;
};

const applyTypingCaretFields = (
  theme: TypingPreviewTheme,
  assetRef: Record<string, unknown> | null,
): void => {
  if (!assetRef) return;
  theme.caretColor = readStr(assetRef, 'caretColor', theme.caretColor);
  theme.caretType = readEnum(
    assetRef.caretType,
    ['bar', 'block', 'underline'] as const,
    theme.caretType,
  );
  theme.caretThickness = readNum(
    assetRef,
    'caretThickness',
    theme.caretThickness,
    1,
    12,
  );
  theme.caretGlowStrength = readNum(
    assetRef,
    'caretGlowStrength',
    theme.caretGlowStrength,
    0,
    100,
  );
  theme.caretPulseMode = readEnum(
    assetRef.caretPulseMode,
    ['none', 'soft', 'strong'] as const,
    theme.caretPulseMode,
  );
  theme.caretTrailEnabled = readBool(
    assetRef,
    'caretTrailEnabled',
    theme.caretTrailEnabled,
  );
};

const applyTypingTextStyleFields = (
  theme: TypingPreviewTheme,
  assetRef: Record<string, unknown> | null,
): void => {
  if (!assetRef) return;
  theme.textColor = readStr(assetRef, 'textColor', theme.textColor);
  theme.correctColor = readStr(assetRef, 'correctColor', theme.correctColor);
  theme.errorColor = readStr(assetRef, 'errorColor', theme.errorColor);
  theme.textFontFamily = readEnum(
    assetRef.textFontFamily ?? assetRef.fontFamily,
    ['mono', 'sans', 'serif'] as const,
    theme.textFontFamily,
  );
  const fontWeightRaw = Number(assetRef.textFontWeight ?? assetRef.fontWeight);
  if (fontWeightRaw === 400 || fontWeightRaw === 500 || fontWeightRaw === 600 || fontWeightRaw === 700) {
    theme.textFontWeight = fontWeightRaw;
  }
  theme.textLetterSpacing = readNum(
    assetRef,
    'textLetterSpacing',
    readNum(assetRef, 'letterSpacing', theme.textLetterSpacing, -1, 4),
    -1,
    4,
  );
  theme.textCurrentWordStyle = readEnum(
    assetRef.textCurrentWordStyle,
    ['none', 'underline', 'glow', 'box'] as const,
    theme.textCurrentWordStyle,
  );
  theme.textCurrentWordColor = readStr(
    assetRef,
    'textCurrentWordColor',
    theme.textCurrentWordColor,
  );
  theme.textCurrentWordStrength = readNum(
    assetRef,
    'textCurrentWordStrength',
    theme.textCurrentWordStrength,
    0,
    100,
  );
};

const applyTypingThemeFields = (
  theme: TypingPreviewTheme,
  assetRef: Record<string, unknown> | null,
): void => {
  if (!assetRef) return;
  theme.panelBg = readStr(
    assetRef,
    'panelBg',
    readStr(assetRef, 'themeSurfaceColor', theme.panelBg),
  );
  theme.panelBorder = readStr(
    assetRef,
    'panelBorder',
    readStr(assetRef, 'themeBorderColor', theme.panelBorder),
  );
  theme.hudSurfaceColor = readStr(
    assetRef,
    'hudSurfaceColor',
    readStr(assetRef, 'themeSurfaceColor', theme.hudSurfaceColor),
  );
  theme.hudBorderColor = readStr(
    assetRef,
    'hudBorderColor',
    readStr(assetRef, 'themeBorderColor', theme.hudBorderColor),
  );
  theme.hudFrameStyle = readEnum(
    assetRef.hudFrameStyle,
    ['minimal', 'glass', 'neon', 'terminal'] as const,
    theme.hudFrameStyle,
  );
  theme.hudBadgeStyle = readEnum(
    assetRef.hudBadgeStyle,
    ['pill', 'chip', 'block', 'outline'] as const,
    theme.hudBadgeStyle,
  );
  theme.hudMeterStyle = readEnum(
    assetRef.hudMeterStyle,
    ['none', 'bar', 'ring', 'pulse'] as const,
    theme.hudMeterStyle,
  );
  theme.hudAccentColor = readStr(
    assetRef,
    'hudAccentColor',
    readStr(assetRef, 'themeAccentColor', theme.hudAccentColor),
  );
  theme.hudTextColor = readStr(
    assetRef,
    'hudTextColor',
    readStr(assetRef, 'themeTextColor', theme.hudTextColor),
  );
  theme.hudShadowStrength = readNum(
    assetRef,
    'hudShadowStrength',
    theme.hudShadowStrength,
    0,
    100,
  );

  theme.missEffectColor = readStr(
    assetRef,
    'themeErrorColor',
    theme.missEffectColor,
  );
};

const applyTypingFeedbackFields = (
  theme: TypingPreviewTheme,
  assetRef: Record<string, unknown> | null,
): void => {
  if (!assetRef) return;

  theme.missEffectColor = readStr(
    assetRef,
    'missEffectColor',
    readStr(assetRef, 'themeErrorColor', theme.missEffectColor),
  );
  theme.feedbackStyle = readEnum(
    assetRef.feedbackStyle,
    ['none', 'underline', 'shake', 'flash', 'particles'] as const,
    theme.feedbackStyle,
  );
  theme.feedbackStrength = readNum(
    assetRef,
    'feedbackStrength',
    theme.feedbackStrength,
    0,
    100,
  );
  theme.feedbackDurationMs = readNum(
    assetRef,
    'feedbackDurationMs',
    theme.feedbackDurationMs,
    80,
    500,
  );
  theme.feedbackParticlesEnabled = readBool(
    assetRef,
    'feedbackParticlesEnabled',
    theme.feedbackParticlesEnabled,
  );
};

export const buildTypingPreviewTheme = (
  context: TypingPreviewContext,
): TypingPreviewTheme => {
  const theme = { ...DEFAULT_TYPING_PREVIEW_THEME };
  applyTypingThemeFields(theme, context.theme ?? null);
  applyTypingTextStyleFields(theme, context['text-style'] ?? null);
  applyTypingCaretFields(theme, context.caret ?? null);
  applyTypingFeedbackFields(theme, context.feedback ?? null);

  return theme;
};

export const typingPreviewKeyframes = `
  @keyframes typingPreviewCaretPulseSoft {
    0%, 100% { opacity: 0.72; transform: scale(0.98); }
    50% { opacity: 1; transform: scale(1.02); }
  }
  @keyframes typingPreviewCaretPulseStrong {
    0%, 100% { opacity: 0.55; transform: scale(0.94); }
    50% { opacity: 1; transform: scale(1.08); }
  }
  @keyframes typingFeedbackShake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(calc(var(--typing-feedback-shake-distance, 1px) * -1)); }
    75% { transform: translateX(var(--typing-feedback-shake-distance, 1px)); }
  }
  @keyframes typingFeedbackFlash {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.45; }
  }
  @keyframes typingFeedbackParticlePulse {
    0%, 100% { filter: brightness(0.9); }
    50% { filter: brightness(1.35); }
  }
  @keyframes typingPreviewHudPulse {
    0% { opacity: 0.72; filter: brightness(0.9); box-shadow: 0 0 0 rgba(0,0,0,0); }
    50% { opacity: 1; filter: brightness(1.18); box-shadow: 0 0 10px currentColor; }
    100% { opacity: 0.72; filter: brightness(0.9); box-shadow: 0 0 0 rgba(0,0,0,0); }
  }
`;
