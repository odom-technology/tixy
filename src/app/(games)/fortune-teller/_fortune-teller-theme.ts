/* ──────────────────────────────────────────────────────────────────────
   FORTUNE TELLER — Midway carnival enamel theme (presentation only).

   The multiplier DISTRIBUTIONS and RNG live in the shared server module
   `src/server/arcade/wager-games/fortune-teller.ts` and are never touched here.
   This file only decides how the booth is PAINTED: the velvet cloth, the
   crystal ball, the face-down card backs, and the enamel band a revealed card
   is painted with by its multiplier size (dust-grey bust → teal → green → blue
   → violet → amber → red jackpot). Flat lacquer, nothing glows on its own.

   Every colour the client draws is resolved from a FortuneTellerTheme, so a
   cosmetic overlay (buildFortuneTellerTheme) can re-skin the booth wholesale
   without the client hardcoding a single hex.
   ────────────────────────────────────────────────────────────────────── */

/** A painted enamel band on a revealed card: flat face + edge + the ink on it. */
export type EnamelBand = {
  face: string;
  edge: string;
  on: string;
};

export type FortuneTellerTheme = {
  /* Booth / velvet cloth backdrop. */
  clothTop: string;
  clothBottom: string;
  clothTrim: string;
  boothFrame: string;
  /* Crystal ball on its stand. */
  ballCore: string;
  ballHalo: string;
  ballRim: string;
  ballOn: string;
  /* Face-down card back. */
  backFace: string;
  backEdge: string;
  backInk: string;
  /* Revealed-card enamel bands, climbing the Midway ladder by multiplier size. */
  bust: EnamelBand; //   0× (crumbles to dust)
  small: EnamelBand; //  (0, 1)
  base: EnamelBand; //   [1, 1.5)
  mid: EnamelBand; //    [1.5, 3)
  big: EnamelBand; //    [3, 6)
  huge: EnamelBand; //   [6, top)
  jackpot: EnamelBand; //  the tier's single top card
};

/* Warm carnival enamel — mirrors the Midway family tone-for-tone so the booth
   sits on the boardwalk without glowing. */
export const DEFAULT_FORTUNE_TELLER_THEME: FortuneTellerTheme = {
  clothTop: '#2a1140',
  clothBottom: '#170a26',
  clothTrim: '#e0a23a',
  boothFrame: '#241a10',
  ballCore: '#b9d9e8',
  ballHalo: '#7fc7e0',
  ballRim: '#2a1d10',
  ballOn: '#0b2733',
  backFace: '#3a2466',
  backEdge: '#0f0a05',
  backInk: '#e6c96a',
  bust: { face: '#3a444c', edge: '#1a2228', on: '#c9d3da' },
  small: { face: '#2fb8a6', edge: '#145a51', on: '#04231e' },
  base: { face: '#3fae54', edge: '#1c5a2a', on: '#04210c' },
  mid: { face: '#3a86c4', edge: '#163e5e', on: '#04161f' },
  big: { face: '#8a52c4', edge: '#3a1d66', on: '#f3e9ff' },
  huge: { face: '#e0a23a', edge: '#7a4e16', on: '#2a1b06' },
  jackpot: { face: '#c73538', edge: '#5a181b', on: '#ffefe4' },
};

/**
 * Pick the enamel band for a revealed card from its multiplier. `isTop` (the
 * tier's unique maximum card) always paints the red jackpot band so the headline
 * card reads at a glance regardless of its numeric value.
 */
export function cardBand(
  theme: FortuneTellerTheme,
  mult: number,
  isTop: boolean,
): EnamelBand {
  if (mult <= 0) return theme.bust;
  if (isTop) return theme.jackpot;
  if (mult < 1) return theme.small;
  if (mult < 1.5) return theme.base;
  if (mult < 3) return theme.mid;
  if (mult < 6) return theme.big;
  return theme.huge;
}

/* ── Cosmetic overlay (convention parity with keno / prize-wheel) ─────────
   Overlays equipped store cosmetics onto the Midway default. The store slots
   are `cloth` (velvet backdrop + booth frame + trim), `ball` (crystal ball core,
   halo, rim, printed ink) and `cardback` (the face-down card). Seeded items live
   in scripts/seed-cosmetics.ts and their assetRef keys match the readers below;
   the client fetches /api/store/inventory?gameType=fortune-teller and passes the
   equipped list here. An empty loadout returns the unchanged default. */
type EquippedEntry = {
  slot?: string;
  item?: { assetRef?: Record<string, unknown> | null } | null;
};

function str(
  ref: Record<string, unknown> | null | undefined,
  key: string,
  fallback: string,
): string {
  const v = ref?.[key];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : fallback;
}

export function buildFortuneTellerTheme(
  equipped: EquippedEntry[] = [],
): FortuneTellerTheme {
  const theme: FortuneTellerTheme = { ...DEFAULT_FORTUNE_TELLER_THEME };
  for (const entry of equipped) {
    const ref = entry?.item?.assetRef ?? null;
    if (!ref) continue;
    if (entry.slot === 'cloth') {
      theme.clothTop = str(ref, 'clothTop', theme.clothTop);
      theme.clothBottom = str(ref, 'clothBottom', theme.clothBottom);
      theme.clothTrim = str(ref, 'clothTrim', theme.clothTrim);
      theme.boothFrame = str(ref, 'boothFrame', theme.boothFrame);
    } else if (entry.slot === 'ball') {
      theme.ballCore = str(ref, 'ballCore', theme.ballCore);
      theme.ballHalo = str(ref, 'ballHalo', theme.ballHalo);
      theme.ballRim = str(ref, 'ballRim', theme.ballRim);
      theme.ballOn = str(ref, 'ballOn', theme.ballOn);
    } else if (entry.slot === 'cardback') {
      theme.backFace = str(ref, 'backFace', theme.backFace);
      theme.backEdge = str(ref, 'backEdge', theme.backEdge);
      theme.backInk = str(ref, 'backInk', theme.backInk);
    }
  }
  return theme;
}
