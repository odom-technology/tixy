/* ──────────────────────────────────────────────────────────────────────
   PRIZE WHEEL — Midway carnival enamel theme (presentation only).

   The wheel LAYOUT (segment multipliers) and RNG live in the shared server
   module `src/server/arcade/wager-games/prize-wheel.ts` and are never touched
   here. This file only decides how a segment is PAINTED: a multiplier maps to
   an enamel band on the warm-lacquer Midway ladder (dark slate loss → teal →
   green → blue → violet → amber → red jackpot). Nothing glows.

   Every colour the wheel <svg> draws is resolved from a PrizeWheelTheme, so a
   future cosmetic overlay (buildPrizeWheelTheme) can re-skin the wheel wholesale
   without the client hardcoding a single hex.
   ────────────────────────────────────────────────────────────────────── */

/** A painted enamel band: flat face + edge + the ink that reads on it. */
export type EnamelBand = {
  face: string;
  edge: string;
  on: string;
};

export type PrizeWheelTheme = {
  /** Outer rim ring + its hard edge. */
  rim: string;
  rimEdge: string;
  /** Hub cap + edge + the result number printed on it. */
  hub: string;
  hubEdge: string;
  hubOn: string;
  /** The fixed pointer/flapper at 12 o'clock. */
  pointer: string;
  pointerEdge: string;
  /** Thin divider stroke between segments. */
  spoke: string;
  /** Segment enamel bands, climbing the Midway ladder by multiplier size. */
  loss: EnamelBand; //  0×
  small: EnamelBand; // (0, 1)
  base: EnamelBand; //  [1, 2)
  mid: EnamelBand; //   [2, 5)
  big: EnamelBand; //   [5, 15)
  huge: EnamelBand; //  [15, jackpot)
  jackpot: EnamelBand; // the wheel's single top prize
};

/* Warm carnival enamel — mirrors the Midway --enamel-* family tone-for-tone so
   the wheel sits on the boardwalk wood without glowing. */
export const DEFAULT_PRIZE_WHEEL_THEME: PrizeWheelTheme = {
  rim: '#241a10',
  rimEdge: '#0f0a05',
  hub: '#2a1d10',
  hubEdge: '#0f0a05',
  hubOn: '#f6e4bd',
  pointer: '#f2c14e',
  pointerEdge: '#7a4e16',
  spoke: '#0f0a05',
  loss: { face: '#3a444c', edge: '#1a2228', on: '#c9d3da' },
  small: { face: '#2fb8a6', edge: '#145a51', on: '#04231e' },
  base: { face: '#3fae54', edge: '#1c5a2a', on: '#04210c' },
  mid: { face: '#3a86c4', edge: '#163e5e', on: '#04161f' },
  big: { face: '#8a52c4', edge: '#3a1d66', on: '#f3e9ff' },
  huge: { face: '#e0a23a', edge: '#7a4e16', on: '#2a1b06' },
  jackpot: { face: '#c73538', edge: '#5a181b', on: '#ffefe4' },
};

/**
 * Pick the enamel band for a segment from its multiplier. `isJackpot` (the
 * unique maximum on the wheel) always paints the red jackpot band so the top
 * prize reads at a glance regardless of its numeric value.
 */
export function segmentBand(
  theme: PrizeWheelTheme,
  mult: number,
  isJackpot: boolean,
): EnamelBand {
  if (mult <= 0) return theme.loss;
  if (isJackpot) return theme.jackpot;
  if (mult < 1) return theme.small;
  if (mult < 2) return theme.base;
  if (mult < 5) return theme.mid;
  if (mult < 15) return theme.big;
  return theme.huge;
}

/* ── Cosmetic overlay (convention parity with other games) ───────────────
   Overlays equipped store cosmetics onto the Midway default. The store slots
   are `segments` (the enamel bands each wedge is painted with) and `wheel`
   (rim, hub cap, pointer/flapper, spoke). Seeded items live in
   scripts/seed-cosmetics.ts and their assetRef keys match the readers below;
   the client fetches /api/store/inventory?gameType=prize-wheel and passes the
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

function band(
  ref: Record<string, unknown> | null | undefined,
  prefix: string,
  fallback: EnamelBand,
): EnamelBand {
  return {
    face: str(ref, `${prefix}Face`, fallback.face),
    edge: str(ref, `${prefix}Edge`, fallback.edge),
    on: str(ref, `${prefix}On`, fallback.on),
  };
}

export function buildPrizeWheelTheme(
  equipped: EquippedEntry[] = [],
): PrizeWheelTheme {
  const theme: PrizeWheelTheme = { ...DEFAULT_PRIZE_WHEEL_THEME };
  for (const entry of equipped) {
    const ref = entry?.item?.assetRef ?? null;
    if (!ref) continue;
    if (entry.slot === 'wheel') {
      theme.rim = str(ref, 'rim', theme.rim);
      theme.rimEdge = str(ref, 'rimEdge', theme.rimEdge);
      theme.hub = str(ref, 'hub', theme.hub);
      theme.hubEdge = str(ref, 'hubEdge', theme.hubEdge);
      theme.hubOn = str(ref, 'hubOn', theme.hubOn);
      theme.pointer = str(ref, 'pointer', theme.pointer);
      theme.pointerEdge = str(ref, 'pointerEdge', theme.pointerEdge);
      theme.spoke = str(ref, 'spoke', theme.spoke);
    } else if (entry.slot === 'segments') {
      theme.loss = band(ref, 'loss', theme.loss);
      theme.small = band(ref, 'small', theme.small);
      theme.base = band(ref, 'base', theme.base);
      theme.mid = band(ref, 'mid', theme.mid);
      theme.big = band(ref, 'big', theme.big);
      theme.huge = band(ref, 'huge', theme.huge);
      theme.jackpot = band(ref, 'jackpot', theme.jackpot);
    }
  }
  return theme;
}
