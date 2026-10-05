// ──────────────────────────────────────────────────────────────────────────
// Boardwalk Hop cosmetic theme. The game is a chunky 2.5D <canvas> hopper, so
// the theme is a flat bag of hex-string colors the renderer reads for every
// drawn shape (no hardcoded canvas colors). DEFAULT_BOARDWALK_THEME matches the
// renderer's built-in Midway enamel palette EXACTLY, so the idle/SSR look is
// unchanged until an equipped skin overlays on top.
//
// Slots (defined in the shared registry — not edited here):
//   hopper  → the player mascot        (hopperBody, hopperShade, hopperFace, hopperGlow)
//   lane    → the boardwalk + hazards  (plank/road/flume/hazard/edge colors)
//   scene   → sky / horizon / shadow   (skyTop, skyBottom, horizon, shadow, accent)
// ──────────────────────────────────────────────────────────────────────────

export type BoardwalkCosmeticTheme = {
  // ── hopper slot ──
  hopperBody: string; // mascot body top color
  hopperShade: string; // mascot body shaded side (the 2.5D dark face)
  hopperBelly: string; // belly / highlight
  hopperFace: string; // eyes / beak accent
  hopperGlow: string; // emissive rim ('' = none)
  hopperGlowIntensity: number; // 0 = off

  // ── lane slot ──
  plankLight: string; // safe boardwalk plank (light stripe)
  plankDark: string; // safe boardwalk plank (dark stripe)
  roadTop: string; // cart-road deck top face
  roadSide: string; // cart-road deck shaded side
  flumeTop: string; // log-flume channel top face
  flumeSide: string; // log-flume channel shaded side
  cartBody: string; // road hazard (cart) body
  cartShade: string; // road hazard shaded side
  logBody: string; // flume hazard (log) body
  logShade: string; // flume hazard shaded side
  laneEdge: string; // beveled tile edge / rim line

  // ── scene slot ──
  skyTop: string; // sky gradient top
  skyBottom: string; // sky gradient bottom (horizon)
  horizon: string; // distant boardwalk haze band
  tileShadow: string; // drop shadow under raised tiles / hopper
  accent: string; // UI accent (score pop, close-call flash)
  gullBody: string; // the idle-punish gull's body
  gullWing: string; // gull wing/tail shade
  gullBeak: string; // gull beak accent
};

// Matches the renderer's literal palette in _boardwalk-hop-client.tsx byte-for-byte.
export const DEFAULT_BOARDWALK_THEME: BoardwalkCosmeticTheme = {
  // hopper — warm enamel duckling/fox mascot
  hopperBody: '#f2c14e',
  hopperShade: '#c8942f',
  hopperBelly: '#fbe6b4',
  hopperFace: '#3a2414',
  hopperGlow: '',
  hopperGlowIntensity: 0,
  // lane
  plankLight: '#c79a5e',
  plankDark: '#a9773f',
  roadTop: '#5b5450',
  roadSide: '#3f3a37',
  flumeTop: '#2f7d8a',
  flumeSide: '#1f5763',
  cartBody: '#c73538',
  cartShade: '#8f2427',
  logBody: '#7a5230',
  logShade: '#553920',
  laneEdge: '#2c1d0f',
  // scene
  skyTop: '#f6c8a0',
  skyBottom: '#f4e3c6',
  horizon: '#e7b98e',
  tileShadow: 'rgba(24,14,6,0.32)',
  accent: '#ffce54',
  gullBody: '#f2efe9',
  gullWing: '#b9b2a4',
  gullBeak: '#e0a23f',
};

// Minimal shape of the /api/store/inventory?gameType=boardwalk-hop payload we read.
export type BoardwalkInventoryResponse = {
  wallet?: { credits?: number };
  dailyGameCredits?: { earned?: number; cap?: number };
  equipped?: Array<{
    slot?: string;
    item?: {
      assetRef?: Record<string, unknown> | null;
    } | null;
  }>;
};

const readColor = (
  assetRef: Record<string, unknown> | null | undefined,
  key: string,
  fallback: string,
): string => {
  const value = assetRef?.[key];
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : fallback;
};

const readNumber = (
  assetRef: Record<string, unknown> | null | undefined,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number => {
  const value = assetRef?.[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
};

// Fold the equipped cosmetics over the default look. An unequipped slot keeps the
// exact current palette, so an empty loadout leaves the game visually unchanged.
export const buildBoardwalkTheme = (
  response: BoardwalkInventoryResponse,
): BoardwalkCosmeticTheme => {
  const theme: BoardwalkCosmeticTheme = { ...DEFAULT_BOARDWALK_THEME };
  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;

    if (slot === 'hopper') {
      theme.hopperBody = readColor(assetRef, 'hopperBody', theme.hopperBody);
      theme.hopperShade = readColor(assetRef, 'hopperShade', theme.hopperShade);
      theme.hopperBelly = readColor(assetRef, 'hopperBelly', theme.hopperBelly);
      theme.hopperFace = readColor(assetRef, 'hopperFace', theme.hopperFace);
      theme.hopperGlow = readColor(assetRef, 'hopperGlow', theme.hopperGlow);
      theme.hopperGlowIntensity = readNumber(
        assetRef,
        'hopperGlowIntensity',
        theme.hopperGlow ? 0.6 : 0,
        0,
        2,
      );
    } else if (slot === 'lane') {
      theme.plankLight = readColor(assetRef, 'plankLight', theme.plankLight);
      theme.plankDark = readColor(assetRef, 'plankDark', theme.plankDark);
      theme.roadTop = readColor(assetRef, 'roadTop', theme.roadTop);
      theme.roadSide = readColor(assetRef, 'roadSide', theme.roadSide);
      theme.flumeTop = readColor(assetRef, 'flumeTop', theme.flumeTop);
      theme.flumeSide = readColor(assetRef, 'flumeSide', theme.flumeSide);
      theme.cartBody = readColor(assetRef, 'cartBody', theme.cartBody);
      theme.cartShade = readColor(assetRef, 'cartShade', theme.cartShade);
      theme.logBody = readColor(assetRef, 'logBody', theme.logBody);
      theme.logShade = readColor(assetRef, 'logShade', theme.logShade);
      theme.laneEdge = readColor(assetRef, 'laneEdge', theme.laneEdge);
    } else if (slot === 'scene') {
      theme.skyTop = readColor(assetRef, 'skyTop', theme.skyTop);
      theme.skyBottom = readColor(assetRef, 'skyBottom', theme.skyBottom);
      theme.horizon = readColor(assetRef, 'horizon', theme.horizon);
      theme.tileShadow = readColor(assetRef, 'tileShadow', theme.tileShadow);
      theme.accent = readColor(assetRef, 'accent', theme.accent);
      theme.gullBody = readColor(assetRef, 'gullBody', theme.gullBody);
      theme.gullWing = readColor(assetRef, 'gullWing', theme.gullWing);
      theme.gullBeak = readColor(assetRef, 'gullBeak', theme.gullBeak);
    }
  }
  return theme;
};
