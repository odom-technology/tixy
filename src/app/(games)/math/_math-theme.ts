/* ──────────────────────────────────────────────────────────────────────
   MENTAL MATH SPRINT cosmetic theme. Mirrors the canonical snake pattern: a
   DEFAULT theme matching the current hardcoded Midway look EXACTLY, a read
   helper, and buildMathTheme(response) that overlays equipped skins by slot.

   The DOM/CSS layer (_math-midway.css) reads each themeable value through a
   CSS custom property whose fallback is the *current literal*, so an empty
   loadout renders byte-identically. mathThemeCssVars() only emits a variable
   when the built theme differs from DEFAULT.

   Slots:
     theme  → panel / background colors (panelBg, panelBorder, problemTextColor)
     accent → primary accent (correctColor, wrongColor, accentColor, timerColor)
              + optional panelGlow effect (OFF by default)
   ────────────────────────────────────────────────────────────────────── */

export type MathCosmeticTheme = {
  // theme slot
  panelBg: string;
  panelBorder: string;
  problemTextColor: string;
  // accent slot
  correctColor: string;
  wrongColor: string;
  accentColor: string;
  timerColor: string;
  // optional effect (OFF by default)
  panelGlow: boolean;
};

/* Current Midway look — kept in lockstep with the literals in
   _math-midway.css so an empty loadout is unchanged. Gradient surfaces store
   their dominant color here; the CSS fallback owns the exact gradient. */
export const DEFAULT_MATH_THEME: MathCosmeticTheme = {
  panelBg: '#0f1512',
  panelBorder: '#0f0a06',
  problemTextColor: '#f6eddc',
  correctColor: '#2fb8a6',
  wrongColor: '#c73538',
  accentColor: '#f2a33c',
  timerColor: '#f2a33c',
  panelGlow: false,
};

/* Inventory shape returned by /api/store/inventory (same contract snake uses). */
export type InventoryCosmeticResponse = {
  wallet?: { credits?: number };
  dailyGameCredits?: { earned?: number; cap?: number };
  equipped?: Array<{
    slot?: string;
    item?: { assetRef?: Record<string, unknown> | null } | null;
  }>;
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

export const buildMathTheme = (
  response: InventoryCosmeticResponse,
): MathCosmeticTheme => {
  const theme: MathCosmeticTheme = { ...DEFAULT_MATH_THEME };
  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;

    if (slot === 'theme') {
      theme.panelBg = readAssetColor(assetRef, 'panelBg', theme.panelBg);
      theme.panelBorder = readAssetColor(
        assetRef,
        'panelBorder',
        theme.panelBorder,
      );
      theme.problemTextColor = readAssetColor(
        assetRef,
        'problemTextColor',
        theme.problemTextColor,
      );
    } else if (slot === 'accent') {
      theme.correctColor = readAssetColor(
        assetRef,
        'correctColor',
        theme.correctColor,
      );
      theme.wrongColor = readAssetColor(assetRef, 'wrongColor', theme.wrongColor);
      theme.accentColor = readAssetColor(
        assetRef,
        'accentColor',
        theme.accentColor,
      );
      theme.timerColor = readAssetColor(assetRef, 'timerColor', theme.timerColor);
      if (typeof assetRef.panelGlow === 'boolean') {
        theme.panelGlow = assetRef.panelGlow;
      }
    }
  }
  return theme;
};

/* Gradient builders derive multi-stop paints from a single base color so
   skinned surfaces keep the lacquered-enamel feel of the default look. */
const toPanelGradient = (base: string) =>
  `radial-gradient(120% 140% at 50% 18%, color-mix(in srgb, ${base} 86%, #fff) 0%, ${base} 100%)`;

const toKeyGradient = (base: string) =>
  `radial-gradient(ellipse at 42% 26%, color-mix(in srgb, ${base} 70%, #fff) 0%, ${base} 56%, color-mix(in srgb, ${base} 58%, #000) 100%)`;

const toChipGradient = (base: string) =>
  `radial-gradient(ellipse at 38% 28%, color-mix(in srgb, ${base} 70%, #fff) 0%, ${base} 55%, color-mix(in srgb, ${base} 55%, #000) 100%)`;

const toBarGradient = (base: string) =>
  `linear-gradient(180deg, color-mix(in srgb, ${base} 72%, #fff) 0%, ${base} 55%, color-mix(in srgb, ${base} 65%, #000) 100%)`;

/* Emit ONLY the CSS vars that differ from DEFAULT, so an empty loadout (and
   any slot left at its default) renders exactly as the hardcoded CSS. */
export const mathThemeCssVars = (
  theme: MathCosmeticTheme,
): React.CSSProperties => {
  const vars: Record<string, string> = {};
  // theme slot
  if (theme.panelBg !== DEFAULT_MATH_THEME.panelBg) {
    vars['--mk-panel-bg'] = toPanelGradient(theme.panelBg);
  }
  if (theme.panelBorder !== DEFAULT_MATH_THEME.panelBorder) {
    vars['--mk-panel-border'] = theme.panelBorder;
  }
  if (theme.problemTextColor !== DEFAULT_MATH_THEME.problemTextColor) {
    vars['--mk-problem-text'] = theme.problemTextColor;
  }
  // accent slot — correct (enter key, combo-hot chip, correct flash seam)
  if (theme.correctColor !== DEFAULT_MATH_THEME.correctColor) {
    vars['--mk-correct'] = theme.correctColor;
    vars['--mk-correct-key'] = toKeyGradient(theme.correctColor);
    vars['--mk-correct-fill'] = toChipGradient(theme.correctColor);
  }
  // wrong (clear key, low-time timebar, wrong flash, blaze streak chip)
  if (theme.wrongColor !== DEFAULT_MATH_THEME.wrongColor) {
    vars['--mk-wrong'] = theme.wrongColor;
    vars['--mk-wrong-key'] = toKeyGradient(theme.wrongColor);
    vars['--mk-wrong-fill'] = toBarGradient(theme.wrongColor);
  }
  // accent (entry text, combo chip base)
  if (theme.accentColor !== DEFAULT_MATH_THEME.accentColor) {
    vars['--mk-accent'] = theme.accentColor;
    vars['--mk-accent-fill'] = toChipGradient(theme.accentColor);
  }
  // timer (timebar fill)
  if (theme.timerColor !== DEFAULT_MATH_THEME.timerColor) {
    vars['--mk-timer-fill'] = toBarGradient(theme.timerColor);
  }
  // Optional effect: a soft steady glow around the problem panel. OFF by
  // default (transparent renders nothing). When on, it tracks the accent.
  if (theme.panelGlow) {
    vars['--mk-panel-glow'] = theme.accentColor;
  }
  return vars as React.CSSProperties;
};
