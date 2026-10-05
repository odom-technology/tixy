/* ──────────────────────────────────────────────────────────────────────────
   Lucky Cage cosmetic theme.

   The three.js cabinet builds every material from plain hex literals pulled
   from a LuckyCageTheme object. DEFAULT_LUCKY_CAGE_THEME takes the cabinet,
   brass, signs, lights and night from the 3D kit's palette. An equipped slot
   fills its missing fields from LEGACY_LUCKY_CAGE_THEME, the pre rev. 2
   defaults its skins were made for. Equipped store cosmetics overlay onto a
   copy of the default, per slot:

     cabinet    → the walnut carcass, apron, chute trough and return rail
                  (cabinetColor, cabinetHi, cabinetLo, trimColor, feltColor)
     cage       → the aged brass cage, axle, crank, gate and cradle wire
                  (cageColor, cageHi, cageLo, gateColor)
     balls      → the five painted rack bands + the ball body/ink
                  (ballBody, ballInk, rackA..rackE)
     background → the night-boardwalk backdrop, deck and practical bulbs
                  (bgTop, bgBottom, groundColor, accent)

   buildLuckyCageTheme(equipped) folds each equipped asset_ref onto the default
   by field name with a fallback to the current value, so a partial skin (one
   field) degrades gracefully instead of blanking the cabinet.

   Nothing here glows. The only emissive surfaces in the scene are the
   incandescent practical bulbs.
   ────────────────────────────────────────────────────────────────────────── */

import { MIDWAY_PALETTE as P, fillSlotFromLegacy } from '@/features/arcade/lib/midway-three';

export type LuckyCageTheme = {
  /* Night boardwalk backdrop + deck. */
  skyTop: string;
  skyBottom: string;
  deckColor: string;
  /* Incandescent practicals strung over the pitch. */
  bulbWarm: string;
  bulbAmber: string;
  bulbRose: string;
  /* Lacquered walnut carcass. */
  woodHi: string;
  woodMid: string;
  woodLo: string;
  /* Painted trim + the enamel sign plate. */
  trim: string;
  enamel: string;
  enamelInk: string;
  /* Green baize under the return rail. */
  felt: string;
  /* Aged brass: cage, axle, crank, cradles. */
  brassHi: string;
  brass: string;
  brassLo: string;
  /* The gate hatch + chute liner read a touch darker than the cage. */
  gate: string;
  chute: string;
  /* Balls: cream body, black ink, and the four rack bands. */
  ballBody: string;
  ballInk: string;
  rackBands: [string, string, string, string, string];
  /* The cream pennant string over the cabinet. */
  pennantA: string;
  pennantB: string;
};

/**
 * The empty loadout. The cabinet, brass, signs, lights and night come from the
 * 3D kit's palette; the balls and their rack bands are game art.
 */
export const DEFAULT_LUCKY_CAGE_THEME: LuckyCageTheme = {
  skyTop: P.nightTop,
  skyBottom: P.nightBottom,
  deckColor: P.deck,
  bulbWarm: P.paper,
  bulbAmber: P.ticket,
  bulbRose: P.red,
  woodHi: P.woodHi,
  woodMid: P.wood,
  woodLo: P.woodLo,
  trim: P.rail,
  enamel: P.ink,
  enamelInk: P.paper,
  felt: P.felt,
  brassHi: P.brassHi,
  brass: P.brass,
  brassLo: P.brassLo,
  gate: P.brassLo,
  chute: P.woodLo,
  ballBody: '#f2e7cd',
  ballInk: '#1d1409',
  rackBands: ['#a8342c', '#2f7f74', '#c9922f', '#5a5f96', '#7c4a86'],
  pennantA: P.paper,
  pennantB: P.red,
};

/**
 * The defaults before rev. 2, frozen. Every skin in the store was designed
 * against these, and the store previews fall back to them, so an equipped
 * slot fills its missing fields from here rather than from the palette.
 * Never change these values.
 */
export const LEGACY_LUCKY_CAGE_THEME: Readonly<LuckyCageTheme> = Object.freeze<LuckyCageTheme>({
  skyTop: '#20130a',
  skyBottom: '#0e0805',
  deckColor: '#1d1208',
  bulbWarm: '#ffd79a',
  bulbAmber: '#e0a33a',
  bulbRose: '#c9584f',
  woodHi: '#6b4526',
  woodMid: '#54341b',
  woodLo: '#2f1d0f',
  trim: '#26170a',
  enamel: '#3d1c0d',
  enamelInk: '#f3e2bd',
  felt: '#20503f',
  brassHi: '#f0d79a',
  brass: '#bf9648',
  brassLo: '#78581f',
  gate: '#8e6b2d',
  chute: '#3b2712',
  ballBody: '#f2e7cd',
  ballInk: '#1d1409',
  rackBands: ['#a8342c', '#2f7f74', '#c9922f', '#5a5f96', '#7c4a86'],
  pennantA: '#e2c98d',
  pennantB: '#a8342c',
});

/** The fields each cosmetic slot owns. */
const SLOT_FIELDS: Record<string, readonly (keyof LuckyCageTheme)[]> = {
  cabinet: ['woodMid', 'woodHi', 'woodLo', 'trim', 'enamel', 'enamelInk', 'felt', 'chute'],
  cage: ['brass', 'brassHi', 'brassLo', 'gate'],
  balls: ['ballBody', 'ballInk', 'rackBands'],
  background: [
    'skyTop',
    'skyBottom',
    'deckColor',
    'bulbWarm',
    'bulbAmber',
    'bulbRose',
    'pennantA',
    'pennantB',
  ],
};

export type LuckyCageEquipped = Array<{
  slot?: string;
  item?: { assetRef?: Record<string, unknown> | null } | null;
}>;

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

export function buildLuckyCageTheme(equipped: LuckyCageEquipped): LuckyCageTheme {
  const theme: LuckyCageTheme = {
    ...DEFAULT_LUCKY_CAGE_THEME,
    rackBands: [...DEFAULT_LUCKY_CAGE_THEME.rackBands] as LuckyCageTheme['rackBands'],
  };

  for (const entry of equipped ?? []) {
    const slot = entry?.slot;
    const ref = entry?.item?.assetRef ?? null;
    if (!slot || !ref) continue;
    fillSlotFromLegacy(theme, LEGACY_LUCKY_CAGE_THEME, SLOT_FIELDS[slot]);

    if (slot === 'cabinet') {
      theme.woodMid = readColor(ref, 'cabinetColor', theme.woodMid);
      theme.woodHi = readColor(ref, 'cabinetHi', theme.woodHi);
      theme.woodLo = readColor(ref, 'cabinetLo', theme.woodLo);
      theme.trim = readColor(ref, 'trimColor', theme.trim);
      theme.enamel = readColor(ref, 'enamelColor', theme.enamel);
      theme.enamelInk = readColor(ref, 'enamelInk', theme.enamelInk);
      theme.felt = readColor(ref, 'feltColor', theme.felt);
      theme.chute = readColor(ref, 'chuteColor', theme.chute);
    } else if (slot === 'cage') {
      // A lone accent recolors the brass; the highlight/shadow keep their aged
      // relationship unless the skin overrides them explicitly.
      theme.brass = readColor(
        ref,
        'cageColor',
        readColor(ref, 'accent', theme.brass),
      );
      theme.brassHi = readColor(ref, 'cageHi', theme.brassHi);
      theme.brassLo = readColor(ref, 'cageLo', theme.brassLo);
      theme.gate = readColor(ref, 'gateColor', theme.gate);
    } else if (slot === 'balls') {
      theme.ballBody = readColor(ref, 'ballBody', theme.ballBody);
      theme.ballInk = readColor(ref, 'ballInk', theme.ballInk);
      const keys = ['rackA', 'rackB', 'rackC', 'rackD', 'rackE'];
      for (let i = 0; i < theme.rackBands.length; i += 1) {
        theme.rackBands[i] = readColor(ref, keys[i]!, theme.rackBands[i]!);
      }
    } else if (slot === 'background') {
      theme.skyTop = readColor(ref, 'bgTop', theme.skyTop);
      theme.skyBottom = readColor(ref, 'bgBottom', theme.skyBottom);
      theme.deckColor = readColor(ref, 'groundColor', theme.deckColor);
      const accent = readColor(ref, 'accent', '');
      if (accent) theme.bulbAmber = accent;
      theme.bulbWarm = readColor(ref, 'accentWarm', theme.bulbWarm);
      theme.bulbAmber = readColor(ref, 'accentAmber', theme.bulbAmber);
      theme.bulbRose = readColor(ref, 'accentRose', theme.bulbRose);
      theme.pennantA = readColor(ref, 'pennantA', theme.pennantA);
      theme.pennantB = readColor(ref, 'pennantB', theme.pennantB);
    }
  }

  return theme;
}

/** Rack band colour for a ball number (1..20). */
export function rackBandColor(theme: LuckyCageTheme, ball: number): string {
  const idx = Math.max(0, Math.min(theme.rackBands.length - 1, Math.floor((ball - 1) / 4)));
  return theme.rackBands[idx]!;
}
