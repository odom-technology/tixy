// ──────────────────────────────────────────────────────────────────────────
// Swerve cosmetic theme. Swerve is the only 3D game (three.js), so the theme is
// a flat bag of hex-string colors that map onto THREE.Material `.color`/
// `.emissive`, the scene background, and the fog. The DEFAULT_SWERVE_THEME below
// matches the hardcoded material/scene palette in _swerve-client.tsx EXACTLY, so
// the idle/SSR look is unchanged until an equipped skin overlays on top.
//
// Slots (defined in the shared registry — not edited here):
//   cart        → player cart material colors (cartPrimary, cartSecondary, cartGlow)
//   track       → road/lane colors            (trackColor, laneLineColor, edgeColor)
//   environment → skybox/fog/ground           (skyColor, fogColor, groundColor, accent)
// ──────────────────────────────────────────────────────────────────────────

export type SwerveCosmeticTheme = {
  // ── cart slot ──
  cartBody: string; // chassis body color (cartPrimary)
  cartRoof: string; // cabin/roof color (cartSecondary)
  cartStripe: string; // hood stripe (optional cartStripe; defaults stay)
  cartGlass: string; // windows (optional cartGlass; defaults stay)
  cartGlow: string; // emissive glow color ('' = neutral / no glow)
  cartGlowIntensity: number; // 0 = off (neutral default)

  // ── track slot ──
  roadColor: string; // road deck (trackColor)
  railColor: string; // side rails (edgeColor)
  railTopColor: string; // bright rail cap
  laneLineRed: string; // left lane divider (laneLineColor)
  laneLineTeal: string; // right lane divider (laneLineColor)
  tieColor: string; // scrolling cross-ties
  blockRed: string; // odd-row obstacle blocks
  blockTeal: string; // even-row obstacle blocks

  // ── environment slot ──
  skyColor: string; // scene.background (skyColor)
  fogColor: string; // fog color (fogColor)
  groundColor: string; // hemisphere-light ground bounce (groundColor)
  accentColor: string; // hemisphere-light sky tint (accent)
};

// Matches C3 + scene/light literals in _swerve-client.tsx byte-for-byte.
export const DEFAULT_SWERVE_THEME: SwerveCosmeticTheme = {
  // cart
  cartBody: '#f2e4c6', // C3.carBody
  cartRoof: '#e7d3a8', // C3.carRoof
  cartStripe: '#c73538', // C3.carStripe
  cartGlass: '#265f66', // C3.carGlass
  cartGlow: '', // neutral — no emissive glow
  cartGlowIntensity: 0,
  // track
  roadColor: '#6a4a28', // C3.road
  railColor: '#4a3118', // C3.rail
  railTopColor: '#7c5430', // C3.railTop
  laneLineRed: '#c4413f', // C3.laneRed
  laneLineTeal: '#2ba596', // C3.laneTeal
  tieColor: '#33230f', // C3.tie
  blockRed: '#c73538', // C3.blockRed
  blockTeal: '#2fb8a6', // C3.blockTeal
  // environment
  skyColor: '#1b130b', // C3.sky (scene.background + fog default)
  fogColor: '#1b130b', // fog default tracks the sky
  groundColor: '#241708', // HemisphereLight ground color
  accentColor: '#ffe7c4', // HemisphereLight sky color
};

// Minimal shape of the /api/store/inventory?gameType=swerve payload we read.
export type SwerveInventoryResponse = {
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
): string => {
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
): number => {
  const value = assetRef?.[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
};

// Fold the equipped cosmetics over the default look. Equipped skins overlay the
// defaults (so an unequipped slot keeps the exact current palette).
export const buildSwerveTheme = (
  response: SwerveInventoryResponse,
): SwerveCosmeticTheme => {
  const theme: SwerveCosmeticTheme = { ...DEFAULT_SWERVE_THEME };
  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;

    if (slot === 'cart') {
      theme.cartBody = readAssetColor(assetRef, 'cartPrimary', theme.cartBody);
      theme.cartRoof = readAssetColor(
        assetRef,
        'cartSecondary',
        theme.cartRoof,
      );
      // Optional extras — keep faithful defaults when absent.
      theme.cartStripe = readAssetColor(
        assetRef,
        'cartStripe',
        theme.cartStripe,
      );
      theme.cartGlass = readAssetColor(assetRef, 'cartGlass', theme.cartGlass);
      // Glow is keyed off the asset: a cartGlow color turns it on; intensity is
      // neutral (0) unless the skin asks for it.
      theme.cartGlow = readAssetColor(assetRef, 'cartGlow', theme.cartGlow);
      theme.cartGlowIntensity = readAssetNumber(
        assetRef,
        'cartGlowIntensity',
        theme.cartGlow ? 0.6 : 0,
        0,
        2,
      );
    } else if (slot === 'track') {
      theme.roadColor = readAssetColor(assetRef, 'trackColor', theme.roadColor);
      theme.railColor = readAssetColor(assetRef, 'edgeColor', theme.railColor);
      // Derive the rail cap from the edge color when overridden (optional
      // explicit key wins); otherwise the default cap is kept.
      theme.railTopColor = readAssetColor(
        assetRef,
        'edgeTopColor',
        readAssetColor(assetRef, 'edgeColor', theme.railTopColor),
      );
      // A single laneLineColor recolors both dividers; explicit per-side keys
      // (laneLineRed / laneLineTeal) win if supplied.
      const laneLine = readAssetColor(assetRef, 'laneLineColor', '');
      theme.laneLineRed = readAssetColor(
        assetRef,
        'laneLineRed',
        laneLine || theme.laneLineRed,
      );
      theme.laneLineTeal = readAssetColor(
        assetRef,
        'laneLineTeal',
        laneLine || theme.laneLineTeal,
      );
      theme.tieColor = readAssetColor(assetRef, 'tieColor', theme.tieColor);
      // Optional obstacle-block recolor (bonus; default stays).
      theme.blockRed = readAssetColor(assetRef, 'blockRed', theme.blockRed);
      theme.blockTeal = readAssetColor(assetRef, 'blockTeal', theme.blockTeal);
    } else if (slot === 'environment') {
      theme.skyColor = readAssetColor(assetRef, 'skyColor', theme.skyColor);
      // Fog tracks the sky unless an explicit fogColor is given.
      theme.fogColor = readAssetColor(
        assetRef,
        'fogColor',
        readAssetColor(assetRef, 'skyColor', theme.fogColor),
      );
      theme.groundColor = readAssetColor(
        assetRef,
        'groundColor',
        theme.groundColor,
      );
      theme.accentColor = readAssetColor(
        assetRef,
        'accent',
        theme.accentColor,
      );
    }
  }
  return theme;
};
