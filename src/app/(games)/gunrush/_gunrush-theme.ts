// ──────────────────────────────────────────────────────────────────────────
// Gunrush cosmetic theme. Gunrush is a three.js scene, so the theme is a flat
// bag of hex-string colors that map onto THREE.Material `.color`/`.emissive`,
// the scene background and the fog. DEFAULT_GUNRUSH_THEME below matches the
// hardcoded palette in _gunrush-client.tsx EXACTLY, so the idle/SSR look is
// unchanged until an equipped skin overlays on top.
//
// Slots (defined in the shared registry — not edited here):
//   squad   → the gunner figures + their muzzle flash    (squadPrimary, squadSecondary, squadGlow)
//   arsenal → the weapon bodies, tracers and gate arches (gunColor, tracerColor, gateGood, gateBad)
//   track   → the boardwalk lane, rails, sky and fog     (trackColor, railColor, skyColor, fogColor)
// ──────────────────────────────────────────────────────────────────────────

export type GunrushCosmeticTheme = {
  // ── squad slot ──
  squadBody: string; // gunner torso (squadPrimary)
  squadHead: string; // gunner head/helmet (squadSecondary)
  squadGlow: string; // gunner rim glow ('' = neutral / no glow)
  squadGlowIntensity: number; // 0 = off (neutral default)
  muzzleColor: string; // muzzle flash + impact sparks

  // ── arsenal slot ──
  gunBody: string; // weapon chassis
  gunAccent: string; // barrel shroud / heat guard
  tracerColor: string; // bullet tracer streaks
  gateGoodColor: string; // the blue "take me" gate arch
  gateBadColor: string; // the red "avoid me" gate arch
  gateWeaponColor: string; // the purple/gold weapon gate arch

  // ── track slot ──
  laneColor: string; // boardwalk deck
  laneStripeColor: string; // scrolling deck planks
  railColor: string; // side rails
  railTopColor: string; // bright rail cap
  enemyColor: string; // tin enemy bodies
  enemyEliteColor: string; // brute/elite enemy bodies
  skyColor: string; // scene.background
  fogColor: string; // fog color
  groundColor: string; // HemisphereLight ground bounce
  accentColor: string; // HemisphereLight sky tint + string bulbs
};

// Matches the C palette + scene/light literals in _gunrush-client.tsx.
export const DEFAULT_GUNRUSH_THEME: GunrushCosmeticTheme = {
  // squad
  squadBody: '#3fb8c8',
  squadHead: '#f2e4c6',
  squadGlow: '', // neutral — no emissive glow
  squadGlowIntensity: 0,
  muzzleColor: '#ffd98a',
  // arsenal
  gunBody: '#2b2f36',
  gunAccent: '#8c6a3a',
  tracerColor: '#ffe7a8',
  gateGoodColor: '#35d0e8',
  gateBadColor: '#e0483f',
  gateWeaponColor: '#c07be8',
  // track
  laneColor: '#6a4a28',
  laneStripeColor: '#7c5430',
  railColor: '#4a3118',
  railTopColor: '#a9762f',
  enemyColor: '#4f8f45',
  enemyEliteColor: '#9c3b2f',
  skyColor: '#140f0a',
  fogColor: '#140f0a',
  groundColor: '#241708',
  accentColor: '#ffe7c4',
};

// Minimal shape of the /api/store/inventory?gameType=gunrush payload we read.
export type GunrushInventoryResponse = {
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
export const buildGunrushTheme = (
  response: GunrushInventoryResponse,
): GunrushCosmeticTheme => {
  const theme: GunrushCosmeticTheme = { ...DEFAULT_GUNRUSH_THEME };
  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;

    if (slot === 'squad') {
      theme.squadBody = readAssetColor(assetRef, 'squadPrimary', theme.squadBody);
      theme.squadHead = readAssetColor(
        assetRef,
        'squadSecondary',
        theme.squadHead,
      );
      // Glow is keyed off the asset: a squadGlow color turns it on; intensity is
      // neutral (0) unless the skin asks for it.
      theme.squadGlow = readAssetColor(assetRef, 'squadGlow', theme.squadGlow);
      theme.squadGlowIntensity = readAssetNumber(
        assetRef,
        'squadGlowIntensity',
        theme.squadGlow ? 0.6 : 0,
        0,
        2,
      );
      theme.muzzleColor = readAssetColor(
        assetRef,
        'muzzleColor',
        theme.muzzleColor,
      );
    } else if (slot === 'arsenal') {
      theme.gunBody = readAssetColor(assetRef, 'gunColor', theme.gunBody);
      theme.gunAccent = readAssetColor(assetRef, 'gunAccent', theme.gunAccent);
      // A tracer recolor also tints the muzzle flash unless the squad slot
      // already overrode it with an explicit muzzleColor.
      theme.tracerColor = readAssetColor(
        assetRef,
        'tracerColor',
        theme.tracerColor,
      );
      theme.gateGoodColor = readAssetColor(
        assetRef,
        'gateGood',
        theme.gateGoodColor,
      );
      theme.gateBadColor = readAssetColor(assetRef, 'gateBad', theme.gateBadColor);
      theme.gateWeaponColor = readAssetColor(
        assetRef,
        'gateWeapon',
        theme.gateWeaponColor,
      );
    } else if (slot === 'track') {
      theme.laneColor = readAssetColor(assetRef, 'trackColor', theme.laneColor);
      // The plank stripe follows the deck unless given explicitly.
      theme.laneStripeColor = readAssetColor(
        assetRef,
        'trackStripeColor',
        theme.laneStripeColor,
      );
      theme.railColor = readAssetColor(assetRef, 'railColor', theme.railColor);
      theme.railTopColor = readAssetColor(
        assetRef,
        'railTopColor',
        readAssetColor(assetRef, 'railColor', theme.railTopColor),
      );
      theme.enemyColor = readAssetColor(assetRef, 'enemyColor', theme.enemyColor);
      theme.enemyEliteColor = readAssetColor(
        assetRef,
        'enemyEliteColor',
        theme.enemyEliteColor,
      );
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
      theme.accentColor = readAssetColor(assetRef, 'accent', theme.accentColor);
    }
  }
  return theme;
};
