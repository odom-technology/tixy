/* ──────────────────────────────────────────────────────────────────────────
   Breakout cosmetic theme.

   The canvas paints with values from a BreakoutCosmeticTheme. resolveBreakoutTheme()
   reproduces the game's original look EXACTLY — it reads the live Midway CSS
   tokens with the same hard-coded fallbacks the game shipped with, so an empty
   loadout renders identically to before (and tracks the active sub-theme). Equipped
   store cosmetics overlay onto that base per slot:

     paddle     → paddleColor, paddleAccent, paddleGlow (optional glow)
     ball       → ballColor, ballGlow (optional glow), ballTrail (optional)
     bricks     → brickColors[] OR brickColorA/B/C (row banding) + brickEdge
     background → bgTop, bgBottom, accent

   buildBreakoutTheme(response) folds response.equipped onto resolveBreakoutTheme()
   so partial skins behave gracefully and the default look is preserved.
   ────────────────────────────────────────────────────────────────────────── */

export type BreakoutCosmeticTheme = {
  // Background slot.
  well: string; // recessed screen — gradient top
  bgBottom: string; // gradient bottom
  accent: string; // side-rail / framing tint
  // Bricks slot — 6 rows (3 enamel color pairs, hi/lo).
  rowFill: string[];
  rowEdge: string[];
  // Paddle slot.
  paddle: string;
  paddleEdge: string;
  paddleGlowEnabled: boolean;
  paddleGlowColor: string;
  // Ball slot.
  ball: string;
  ballEdge: string;
  ballGlowEnabled: boolean;
  ballGlowColor: string;
  ballTrailEnabled: boolean;
  // UI chrome.
  ink: string;
};

// Enamel row colors (red / amber / teal banding) — fallbacks when tokens are
// unavailable (SSR). These mirror the game's original ROW_TOKEN_FALLBACKS.
const ROW_TOKEN_FALLBACKS: { fill: string; edge: string }[] = [
  { fill: '#c73538', edge: '#7e2225' }, // row 0 — red
  { fill: '#d34b4e', edge: '#7e2225' }, // row 1 — red-hi
  { fill: '#f2a33c', edge: '#9a621a' }, // row 2 — amber
  { fill: '#f7bd5e', edge: '#9a621a' }, // row 3 — amber-hi
  { fill: '#2fb8a6', edge: '#1b7466' }, // row 4 — teal
  { fill: '#46cdbb', edge: '#1b7466' }, // row 5 — teal-hi
];

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

// The SSR/default fallback theme. Equals the game's original constant palette.
export const DEFAULT_BREAKOUT_THEME: BreakoutCosmeticTheme = {
  well: '#0f1512',
  bgBottom: '#080b0a',
  accent: 'rgba(255,255,255,0.04)',
  rowFill: ROW_TOKEN_FALLBACKS.map((r) => r.fill),
  rowEdge: ROW_TOKEN_FALLBACKS.map((r) => r.edge),
  paddle: '#f6eddc',
  paddleEdge: '#b9ad95',
  paddleGlowEnabled: false,
  paddleGlowColor: '#f6eddc',
  ball: '#f6eddc',
  ballEdge: '#b9ad95',
  ballGlowEnabled: false,
  ballGlowColor: '#f6eddc',
  ballTrailEnabled: false,
  ink: '#0c0804',
};

// Resolve the live Midway tokens into the default look — identical to the game's
// original resolveTheme(). Equipped skins overlay on top in buildBreakoutTheme().
export const resolveBreakoutTheme = (): BreakoutCosmeticTheme => ({
  ...DEFAULT_BREAKOUT_THEME,
  well: readToken('--screen-well', DEFAULT_BREAKOUT_THEME.well),
  rowFill: [
    readToken('--enamel-primary', ROW_TOKEN_FALLBACKS[0].fill),
    readToken('--enamel-primary-hi', ROW_TOKEN_FALLBACKS[1].fill),
    readToken('--enamel-tickets', ROW_TOKEN_FALLBACKS[2].fill),
    readToken('--enamel-tickets-hi', ROW_TOKEN_FALLBACKS[3].fill),
    readToken('--enamel-prize', ROW_TOKEN_FALLBACKS[4].fill),
    readToken('--enamel-prize-hi', ROW_TOKEN_FALLBACKS[5].fill),
  ],
  rowEdge: [
    readToken('--enamel-primary-edge', ROW_TOKEN_FALLBACKS[0].edge),
    readToken('--enamel-primary-edge', ROW_TOKEN_FALLBACKS[1].edge),
    readToken('--enamel-tickets-edge', ROW_TOKEN_FALLBACKS[2].edge),
    readToken('--enamel-tickets-edge', ROW_TOKEN_FALLBACKS[3].edge),
    readToken('--enamel-prize-edge', ROW_TOKEN_FALLBACKS[4].edge),
    readToken('--enamel-prize-edge', ROW_TOKEN_FALLBACKS[5].edge),
  ],
});

export type InventoryCosmeticResponse = {
  wallet?: { credits?: number };
  dailyGameCredits?: { earned?: number; cap?: number };
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

const readAssetBool = (
  assetRef: Record<string, unknown> | null | undefined,
  key: string,
  fallback: boolean,
) => {
  const value = assetRef?.[key];
  return typeof value === 'boolean' ? value : fallback;
};

const readAssetColorArray = (
  assetRef: Record<string, unknown> | null | undefined,
  key: string,
): string[] | null => {
  const value = assetRef?.[key];
  if (!Array.isArray(value)) return null;
  const colors = value.filter(
    (v): v is string => typeof v === 'string' && v.trim().length > 0,
  );
  return colors.length > 0 ? colors.map((s) => s.trim()) : null;
};

export const buildBreakoutTheme = (
  response: InventoryCosmeticResponse,
): BreakoutCosmeticTheme => {
  const theme = resolveBreakoutTheme();
  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;

    if (slot === 'paddle') {
      theme.paddle = readAssetColor(assetRef, 'paddleColor', theme.paddle);
      theme.paddleEdge = readAssetColor(
        assetRef,
        'paddleAccent',
        theme.paddleEdge,
      );
      const glow = readAssetColor(assetRef, 'paddleGlow', '');
      if (glow) {
        theme.paddleGlowColor = glow;
        theme.paddleGlowEnabled = true;
      }
      theme.paddleGlowEnabled = readAssetBool(
        assetRef,
        'paddleGlowEnabled',
        theme.paddleGlowEnabled,
      );
    } else if (slot === 'ball') {
      theme.ball = readAssetColor(assetRef, 'ballColor', theme.ball);
      theme.ballEdge = readAssetColor(assetRef, 'ballEdge', theme.ballEdge);
      const glow = readAssetColor(assetRef, 'ballGlow', '');
      if (glow) {
        theme.ballGlowColor = glow;
        theme.ballGlowEnabled = true;
      }
      theme.ballGlowEnabled = readAssetBool(
        assetRef,
        'ballGlowEnabled',
        theme.ballGlowEnabled,
      );
      theme.ballTrailEnabled = readAssetBool(
        assetRef,
        'ballTrail',
        theme.ballTrailEnabled,
      );
    } else if (slot === 'bricks') {
      // Preferred: an explicit per-row color array. Fills/cycles all 6 rows.
      const colors = readAssetColorArray(assetRef, 'brickColors');
      if (colors) {
        theme.rowFill = theme.rowFill.map(
          (fallback, i) => colors[i % colors.length] ?? fallback,
        );
      } else {
        // Otherwise three banding colors map to the three hi/lo row pairs.
        const a = readAssetColor(assetRef, 'brickColorA', theme.rowFill[0]);
        const b = readAssetColor(assetRef, 'brickColorB', theme.rowFill[2]);
        const c = readAssetColor(assetRef, 'brickColorC', theme.rowFill[4]);
        theme.rowFill = [a, a, b, b, c, c];
      }
      const edge = readAssetColor(assetRef, 'brickEdge', '');
      if (edge) theme.rowEdge = theme.rowEdge.map(() => edge);
    } else if (slot === 'background') {
      theme.well = readAssetColor(assetRef, 'bgTop', theme.well);
      theme.bgBottom = readAssetColor(assetRef, 'bgBottom', theme.bgBottom);
      theme.accent = readAssetColor(assetRef, 'accent', theme.accent);
    }
  }
  return theme;
};
