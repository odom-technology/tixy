/* ──────────────────────────────────────────────────────────────────────────
   REACTION-TIME cosmetic theme — equipped-skin pipeline (mirrors the Snake
   pattern in src/app/(games)/snake/_snake-theme.ts).

   Slots:
     target     → the click-target colors per state: waitColor (the red "wait
                  for green" panel), goColor (the green "smack it" panel), and
                  tooSoonColor (the orange "too early" panel). Carries an
                  optional target glow (OFF by default).
     background → the neutral panel bg colors (panelBg / panelBorder) + the
                  accent (badge/readout color).

   DEFAULT_REACTION_THEME reproduces the previous hardcoded look EXACTLY. Legacy
   slot names (flash_theme / bg_theme / result_badge) and the old readyColor key
   are still honored so previously-authored items keep working.
   ────────────────────────────────────────────────────────────────────────── */

export type ReactionTimeCosmeticTheme = {
  // background slot
  panelBg: string;
  panelBorder: string;
  badgeColor: string;
  // target slot
  waitColor: string; // red "wait for green" panel (game 'ready' state)
  goColor: string; // green "go" panel (game 'click' state)
  tooSoonColor: string; // orange "too early" panel
  // optional effect (OFF / neutral by default)
  targetGlowEnabled: boolean;
  targetGlowColor: string;
  targetGlowSize: number; // px; 0 = none
};

/* Defaults read shell tokens so the neutral stage matches the Midway chrome;
   wait/go stay literal red/green — that contrast IS the game. Equipped
   cosmetics override any of these. */
export const DEFAULT_REACTION_THEME: ReactionTimeCosmeticTheme = {
  panelBg: 'var(--surface-well)',
  panelBorder: 'var(--border-ink)',
  badgeColor: 'var(--enamel-tickets)',
  waitColor: '#dc2626',
  goColor: '#16a34a',
  tooSoonColor: '#ea580c',
  targetGlowEnabled: false,
  targetGlowColor: '',
  targetGlowSize: 0,
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

export const buildReactionTimeTheme = (
  response: InventoryCosmeticResponse,
): ReactionTimeCosmeticTheme => {
  const theme = { ...DEFAULT_REACTION_THEME };
  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;

    // ── target: per-state click-target colors + optional glow ──
    if (slot === 'target' || slot === 'flash_theme') {
      theme.waitColor = readAssetColor(
        assetRef,
        'waitColor',
        readAssetColor(assetRef, 'readyColor', theme.waitColor),
      );
      theme.goColor = readAssetColor(
        assetRef,
        'goColor',
        readAssetColor(assetRef, 'readyColor', theme.goColor),
      );
      theme.tooSoonColor = readAssetColor(
        assetRef,
        'tooSoonColor',
        theme.tooSoonColor,
      );
      if (typeof assetRef.targetGlowEnabled === 'boolean') {
        theme.targetGlowEnabled = assetRef.targetGlowEnabled;
      }
      theme.targetGlowColor = readAssetColor(
        assetRef,
        'targetGlowColor',
        theme.targetGlowColor,
      );
      theme.targetGlowSize = readAssetNumber(
        assetRef,
        'targetGlowSize',
        theme.targetGlowEnabled
          ? Math.max(24, theme.targetGlowSize)
          : theme.targetGlowSize,
        0,
        120,
      );
    } else if (slot === 'background' || slot === 'bg_theme') {
      // ── background: neutral panel colors + accent ──
      theme.panelBg = readAssetColor(
        assetRef,
        'panelBg',
        readAssetColor(assetRef, 'bgColor', theme.panelBg),
      );
      theme.panelBorder = readAssetColor(
        assetRef,
        'panelBorder',
        theme.panelBorder,
      );
      theme.badgeColor = readAssetColor(
        assetRef,
        'badgeColor',
        readAssetColor(assetRef, 'accent', theme.badgeColor),
      );
    } else if (slot === 'result_badge') {
      // legacy: a dedicated badge slot still recolors the accent.
      theme.badgeColor = readAssetColor(assetRef, 'badgeColor', theme.badgeColor);
    }
  }
  return theme;
};
