// Cosmetic theme for Gopher Pop. The canvas reads plain hex from this object
// (it never reads CSS tokens per-frame, matching the breakout/snake fallback
// approach). DEFAULT_GOPHER_THEME's literals are the exact current hardcoded
// Midway palette, so an empty loadout renders identically to before. Equipped
// skins overlay on top via buildGopherTheme().
//
// Slots (defined in the shared slot registry — not edited here):
//   gopher  → the mole/gopher sprite colors (+ an optional glow)
//   turf    → the lacquered-wood board, recessed holes, and rims
//   effects → bonk/pop feedback (hit flash + star-burst particles)

export type GopherCosmeticTheme = {
  // ── gopher slot — the critter sprite ──
  gopherBody: string; // gopherPrimary
  gopherBodyHi: string;
  gopherBodyLo: string; // gopherSecondary
  gopherBelly: string;
  gopherEdge: string;
  gopherNose: string; // gopherSnout
  gopherCheek: string;
  gopherInnerEar: string;
  gopherPaw: string;
  gopherEyes: string; // gopherEyes
  // Optional cool effect: a soft glow halo around the critter's head. OFF by
  // default so the stock look is unchanged.
  gopherGlowEnabled: boolean;
  gopherGlowColor: string;

  // ── turf slot — board, holes, rims ──
  woodTop: string;
  woodMid: string;
  woodBottom: string;
  woodGrain: string;
  woodGrainDk: string;
  holeDark: string; // holeColor
  holeFloor: string;
  rimHi: string; // holeRim
  rimLo: string;

  // ── effects slot — bonk/pop feedback ──
  bonkFlashColor: string; // hitFlashColor / popColor
  particleColors: string[]; // star-burst particleColor palette
};

// The exact literals the game shipped with (see _gopher-client.tsx).
export const DEFAULT_GOPHER_THEME: GopherCosmeticTheme = {
  // gopher
  gopherBody: '#c98a4e',
  gopherBodyHi: '#e6b67c',
  gopherBodyLo: '#a96e36',
  gopherBelly: '#f5e2bf',
  gopherEdge: '#6f471f',
  gopherNose: '#52332a',
  gopherCheek: '#e98b7e',
  gopherInnerEar: '#8a5a30',
  gopherPaw: '#b67c40',
  gopherEyes: '#0c0804',
  gopherGlowEnabled: false,
  gopherGlowColor: '#e6b67c',
  // turf
  woodTop: '#7a5532',
  woodMid: '#62421f',
  woodBottom: '#472f17',
  woodGrain: '#8a6135',
  woodGrainDk: '#3a2511',
  holeDark: '#0c0703',
  holeFloor: '#241608',
  rimHi: '#a4774a',
  rimLo: '#3c2613',
  // effects — the original star-burst palette (BOMB_SPARK / amber / cream / red)
  bonkFlashColor: '#ffffff',
  particleColors: ['#f7bd5e', '#e8a23c', '#f6eddc', '#c33b3c'],
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

const isColor = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

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

export const buildGopherTheme = (
  response: InventoryCosmeticResponse,
): GopherCosmeticTheme => {
  const theme: GopherCosmeticTheme = {
    ...DEFAULT_GOPHER_THEME,
    // Clone the array so overrides never mutate the shared default.
    particleColors: [...DEFAULT_GOPHER_THEME.particleColors],
  };

  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;

    if (slot === 'gopher') {
      theme.gopherBody = readAssetColor(
        assetRef,
        'gopherPrimary',
        readAssetColor(assetRef, 'gopherBody', theme.gopherBody),
      );
      theme.gopherBodyLo = readAssetColor(
        assetRef,
        'gopherSecondary',
        readAssetColor(assetRef, 'gopherBodyLo', theme.gopherBodyLo),
      );
      theme.gopherBodyHi = readAssetColor(
        assetRef,
        'gopherBodyHi',
        theme.gopherBodyHi,
      );
      theme.gopherBelly = readAssetColor(
        assetRef,
        'gopherBelly',
        theme.gopherBelly,
      );
      theme.gopherEdge = readAssetColor(assetRef, 'gopherEdge', theme.gopherEdge);
      theme.gopherNose = readAssetColor(
        assetRef,
        'gopherSnout',
        readAssetColor(assetRef, 'gopherNose', theme.gopherNose),
      );
      theme.gopherCheek = readAssetColor(
        assetRef,
        'gopherCheek',
        theme.gopherCheek,
      );
      theme.gopherInnerEar = readAssetColor(
        assetRef,
        'gopherInnerEar',
        theme.gopherInnerEar,
      );
      theme.gopherPaw = readAssetColor(assetRef, 'gopherPaw', theme.gopherPaw);
      theme.gopherEyes = readAssetColor(
        assetRef,
        'gopherEyes',
        theme.gopherEyes,
      );
      if (typeof assetRef.gopherGlowEnabled === 'boolean') {
        theme.gopherGlowEnabled = assetRef.gopherGlowEnabled;
      }
      theme.gopherGlowColor = readAssetColor(
        assetRef,
        'gopherGlowColor',
        // Default the glow tint to the body highlight so it reads as a natural
        // rim-light when a skin only flips the toggle on.
        readAssetColor(assetRef, 'gopherBodyHi', theme.gopherGlowColor),
      );
    } else if (slot === 'turf') {
      theme.woodTop = readAssetColor(
        assetRef,
        'turfColor',
        readAssetColor(assetRef, 'woodTop', theme.woodTop),
      );
      theme.woodMid = readAssetColor(assetRef, 'woodMid', theme.woodMid);
      theme.woodBottom = readAssetColor(
        assetRef,
        'turfShadow',
        readAssetColor(assetRef, 'woodBottom', theme.woodBottom),
      );
      theme.woodGrain = readAssetColor(assetRef, 'woodGrain', theme.woodGrain);
      theme.woodGrainDk = readAssetColor(
        assetRef,
        'woodGrainDk',
        theme.woodGrainDk,
      );
      theme.holeDark = readAssetColor(
        assetRef,
        'holeColor',
        readAssetColor(assetRef, 'holeDark', theme.holeDark),
      );
      theme.holeFloor = readAssetColor(assetRef, 'holeFloor', theme.holeFloor);
      theme.rimHi = readAssetColor(
        assetRef,
        'holeRim',
        readAssetColor(assetRef, 'rimHi', theme.rimHi),
      );
      theme.rimLo = readAssetColor(assetRef, 'rimLo', theme.rimLo);
    } else if (slot === 'effects') {
      theme.bonkFlashColor = readAssetColor(
        assetRef,
        'hitFlashColor',
        readAssetColor(
          assetRef,
          'popColor',
          readAssetColor(assetRef, 'bonkFlashColor', theme.bonkFlashColor),
        ),
      );
      // particleColors[] wins if given; otherwise a single particleColor recolors
      // the whole burst. Either way the stock palette is the fallback.
      const palette = assetRef.particleColors;
      if (Array.isArray(palette)) {
        const colors = palette.filter(isColor).map((c) => c.trim());
        if (colors.length > 0) theme.particleColors = colors;
      } else if (isColor(assetRef.particleColor)) {
        theme.particleColors = [assetRef.particleColor.trim()];
      }
    }
  }

  return theme;
};
