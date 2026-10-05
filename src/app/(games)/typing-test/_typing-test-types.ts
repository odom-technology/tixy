export type TypingCosmeticTheme = {
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
  textWordSpacing: number;
  textCurrentWordStyle: 'none' | 'underline' | 'glow' | 'box';
  textCurrentWordColor: string;
  textCurrentWordStrength: number;
  panelBg: string;
  panelBorder: string;
  hudSurfaceColor: string;
  hudBorderColor: string;
  hudFontFamily: 'mono' | 'sans' | 'serif';
  hudFontWeight: 400 | 500 | 600 | 700;
  missEffectColor: string;
  feedbackStyle: 'none' | 'underline' | 'shake' | 'flash' | 'particles';
  feedbackStrength: number;
  feedbackDurationMs: number;
  feedbackParticlesEnabled: boolean;
  hudFrameStyle: 'minimal' | 'glass' | 'neon' | 'terminal';
  hudBadgeStyle: 'pill' | 'chip' | 'block' | 'outline';
  hudMeterStyle: 'none' | 'bar' | 'ring' | 'pulse';
  hudAccentColor: string;
  hudTextColor: string;
  hudShadowStrength: number;
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

export type GameState = 'idle' | 'playing' | 'finished' | 'error';
export type GameMode = 15 | 30 | 60;

export type WpmDataPoint = {
  time: number;
  wpm: number;
  rawWpm: number;
  accuracy: number;
};

// Maximum extra characters allowed per word (like Monkeytype)
export const MAX_EXTRA_CHARS = 24;
const _REWARDS_HINT_TEXT =
  'Minimum score for 1/5/10 Tickets: 15s mode WPM 20/91/209 | 30s mode WPM 14/64/148 | 60s mode WPM 10/46/105. Rewards taper at higher WPM.';

/* Default (nothing equipped) reads shell tokens so the out-of-the-box
   playfield matches the Midway chrome. Equipped cosmetics still override
   any of these with their own colors. */
export const DEFAULT_TYPING_THEME: TypingCosmeticTheme = {
  caretColor: 'var(--enamel-tickets)',
  caretType: 'bar',
  caretThickness: 3,
  caretGlowStrength: 0,
  caretPulseMode: 'none',
  caretTrailEnabled: false,
  textColor: 'var(--text-muted)',
  correctColor: 'var(--text-strong)',
  errorColor: 'var(--enamel-danger-text)',
  textFontFamily: 'mono',
  textFontWeight: 500,
  textLetterSpacing: 0,
  textWordSpacing: 12,
  textCurrentWordStyle: 'underline',
  textCurrentWordColor: 'var(--enamel-tickets)',
  textCurrentWordStrength: 45,
  panelBg: 'var(--surface-well)',
  panelBorder: 'var(--border-ink)',
  hudSurfaceColor: 'var(--surface-well)',
  hudBorderColor: 'var(--border-ink)',
  hudFontFamily: 'mono',
  hudFontWeight: 500,
  missEffectColor: 'var(--enamel-danger-text)',
  feedbackStyle: 'underline',
  feedbackStrength: 45,
  feedbackDurationMs: 160,
  feedbackParticlesEnabled: false,
  hudFrameStyle: 'minimal',
  hudBadgeStyle: 'pill',
  hudMeterStyle: 'bar',
  hudAccentColor: 'var(--enamel-tickets-text)',
  hudTextColor: 'var(--text-strong)',
  hudShadowStrength: 0,
};
