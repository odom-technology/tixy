/* ──────────────────────────────────────────────────────────────────────
   GEM ROLL — Midway carnival enamel theme (presentation only).

   The roll logic, RNG, patterns and payout table live in the shared server
   module `src/server/arcade/wager-games/gem-roll.ts` and are never touched
   here. This file only decides how the sockets and gems are PAINTED: each of
   the 7 gem colours maps to a faceted enamel jewel (face + highlight + edge);
   the tray and the match "flare"/callout have their own paints.

   Every colour the client draws is resolved from a GemRollTheme, so a cosmetic
   overlay (buildGemRollTheme) can re-skin the whole set without the client
   hardcoding a single hex.

   Slots (registered in rewards.ts):
     gems  → the 7 gem enamels (ruby..rose)
     tray  → the socket tray body/rim + empty-socket well
     flare → the match-flare + payline callout tint
   ────────────────────────────────────────────────────────────────────── */

import { GEM_COLORS, type GemColor } from '@/server/arcade/wager-games/gem-roll';

/** A faceted enamel jewel: flat face + top highlight + hard edge. */
export type GemFacet = {
  face: string;
  hi: string;
  edge: string;
};

export type GemRollTheme = {
  gems: Record<GemColor, GemFacet>;
  /** Socket tray. */
  trayBody: string;
  trayRim: string;
  /** Empty socket well + its edge. */
  socket: string;
  socketEdge: string;
  /** Match flare ring + the payline/result callout ink. */
  flare: string;
  callout: string;
};

/* Warm carnival enamel — each gem a distinct faceted hue on the Midway ladder,
   nothing glows. */
export const DEFAULT_GEM_ROLL_THEME: GemRollTheme = {
  gems: {
    ruby: { face: '#c73538', hi: '#e6595c', edge: '#5a181b' },
    amber: { face: '#e0a23a', hi: '#f4c057', edge: '#7a4e16' },
    citrine: { face: '#eab308', hi: '#fbe14a', edge: '#6f4310' },
    emerald: { face: '#3fae54', hi: '#65d079', edge: '#1c5a2a' },
    sapphire: { face: '#3a86c4', hi: '#63aae4', edge: '#163e5e' },
    amethyst: { face: '#8a52c4', hi: '#ab74e0', edge: '#3a1d66' },
    rose: { face: '#ec4899', hi: '#f77ab6', edge: '#6a1338' },
  },
  trayBody: 'var(--tixy-screen-2)',
  trayRim: 'var(--tixy-screen)',
  socket: 'var(--tixy-screen-2)',
  socketEdge: 'var(--tixy-screen)',
  flare: 'var(--tixy-paper)',
  callout: 'var(--tixy-paper)',
};

/* ── Cosmetic overlay (convention parity with other games) ───────────────
   Overlays equipped store cosmetics onto the Midway default. Store slots:
   `gems` (per-colour <color>Face/<color>Hi/<color>Edge), `tray`
   (trayBody/trayRim/socket/socketEdge), `flare` (flare/callout). Seeded items
   live in scripts/seed-cosmetics.ts and their assetRef keys match the readers
   below; the client fetches /api/store/inventory?gameType=gem-roll and passes
   the equipped list here. An empty loadout returns the unchanged default. */
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

function facet(
  ref: Record<string, unknown> | null | undefined,
  color: GemColor,
  fallback: GemFacet,
): GemFacet {
  return {
    face: str(ref, `${color}Face`, fallback.face),
    hi: str(ref, `${color}Hi`, fallback.hi),
    edge: str(ref, `${color}Edge`, fallback.edge),
  };
}

export function buildGemRollTheme(equipped: EquippedEntry[] = []): GemRollTheme {
  // Deep-clone the default so overlays never mutate the shared constant.
  const theme: GemRollTheme = {
    ...DEFAULT_GEM_ROLL_THEME,
    gems: { ...DEFAULT_GEM_ROLL_THEME.gems },
  };
  for (const entry of equipped) {
    const ref = entry?.item?.assetRef ?? null;
    if (!ref) continue;
    if (entry.slot === 'gems') {
      const next = { ...theme.gems };
      for (const color of GEM_COLORS) {
        next[color] = facet(ref, color, theme.gems[color]);
      }
      theme.gems = next;
    } else if (entry.slot === 'tray') {
      theme.trayBody = str(ref, 'trayBody', theme.trayBody);
      theme.trayRim = str(ref, 'trayRim', theme.trayRim);
      theme.socket = str(ref, 'socket', theme.socket);
      theme.socketEdge = str(ref, 'socketEdge', theme.socketEdge);
    } else if (entry.slot === 'flare') {
      theme.flare = str(ref, 'flare', theme.flare);
      theme.callout = str(ref, 'callout', theme.callout);
    }
  }
  return theme;
}
