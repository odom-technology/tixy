/* ──────────────────────────────────────────────────────────────────────────
   Prize Claw cosmetic theme.

   The three.js cabinet builds every material from plain hex literals pulled
   from a PrizeClawTheme object. DEFAULT_PRIZE_CLAW_THEME takes the case,
   brass, felt, signs, lights and night from the 3D kit's palette. An equipped
   slot fills its missing fields from LEGACY_PRIZE_CLAW_THEME, the pre rev. 2
   defaults.

   Slots mirror the other midway cabinets (see _lucky-cage-theme.ts), so wiring
   this up to the store later is a matter of adding rows there — nothing in the
   scene needs to change:

     case        the walnut carcass, apron, enamel panels and glazing bars
     prizes      the felt/tin/brass/porcelain/gilt prize palette
     background  the night boardwalk, deck and practical bulbs

   Nothing here glows. The only emissive surfaces in the scene are the
   incandescent practical bulbs.
   ────────────────────────────────────────────────────────────────────────── */

import type { ClawTierId } from '@/features/arcade/lib/prize-claw-bed';

import { MIDWAY_PALETTE as P, fillSlotFromLegacy } from '@/features/arcade/lib/midway-three';

export type PrizeClawTheme = {
  /* Night boardwalk behind the cabinet. */
  skyTop: string;
  skyBottom: string;
  deckColor: string;
  /* Incandescent practicals over the marquee and inside the case. */
  bulbWarm: string;
  bulbAmber: string;
  bulbRose: string;
  /* Lacquered walnut. */
  woodHi: string;
  woodMid: string;
  woodLo: string;
  /* Painted enamel side panels + the gold pinstripe between the stripes. */
  enamelA: string;
  enamelB: string;
  pinstripe: string;
  /* The marquee plate and its lettering. */
  signPlate: string;
  signInk: string;
  /* Aged brass: gantry, trolley, claw, glazing bars, chute lip. */
  brassHi: string;
  brass: string;
  brassLo: string;
  /* The prize bed and the stitched grip crosses. */
  felt: string;
  feltShadow: string;
  cross: string;
  crossActive: string;
  /* One body colour per tier, plus the shared plate paint on each base. */
  prize: Record<ClawTierId, string>;
  prizeAccent: Record<ClawTierId, string>;
  plate: string;
  plateInk: string;
};

/**
 * The empty loadout. The cabinet, brass, felt, signs, lights and night come
 * from the 3D kit's palette; the prizes are game art.
 */
export const DEFAULT_PRIZE_CLAW_THEME: PrizeClawTheme = {
  skyTop: P.nightTop,
  skyBottom: P.nightBottom,
  deckColor: P.deck,
  bulbWarm: P.paper,
  bulbAmber: P.ticket,
  bulbRose: P.red,
  woodHi: P.woodHi,
  woodMid: P.wood,
  woodLo: P.woodLo,
  enamelA: P.felt,
  enamelB: P.red,
  pinstripe: P.brass,
  signPlate: P.ink,
  signInk: P.paper,
  brassHi: P.brassHi,
  brass: P.brass,
  brassLo: P.brassLo,
  felt: P.felt,
  feltShadow: '#122c23',
  cross: P.paper,
  crossActive: P.ticket,
  // Flat colours in the tixy palette, one per tier: paper, ticket, red, ink, gold.
  prize: {
    A: P.paper,
    B: P.ticket,
    C: P.red,
    D: P.ink2,
    E: P.brassHi,
  },
  prizeAccent: {
    A: P.red,
    B: P.ink,
    C: P.paper,
    D: P.ticket,
    E: P.ink,
  },
  plate: P.ink,
  plateInk: P.paper,
};

/**
 * The defaults before rev. 2, frozen. Every skin in the store was designed
 * against these, and the store previews fall back to them, so an equipped
 * slot fills its missing fields from here rather than from the palette.
 * Never change these values.
 */
export const LEGACY_PRIZE_CLAW_THEME: Readonly<PrizeClawTheme> = Object.freeze({
  skyTop: '#1d1209',
  skyBottom: '#0d0704',
  deckColor: '#1c1108',
  bulbWarm: '#ffd79a',
  bulbAmber: '#e0a33a',
  bulbRose: '#c9584f',
  woodHi: '#6a4525',
  woodMid: '#4f321a',
  woodLo: '#2c1b0e',
  enamelA: '#245e59',
  enamelB: '#9c3129',
  pinstripe: '#d8b263',
  signPlate: '#3d1c0d',
  signInk: '#f3e2bd',
  brassHi: '#f0d79a',
  brass: '#bf9648',
  brassLo: '#77571f',
  felt: '#1f4a3b',
  feltShadow: '#122c23',
  cross: '#e8dcc0',
  crossActive: '#ffd27a',
  prize: DEFAULT_PRIZE_CLAW_THEME.prize,
  prizeAccent: DEFAULT_PRIZE_CLAW_THEME.prizeAccent,
  plate: '#26170a',
  plateInk: '#f3e2bd',
});

/** The fields each cosmetic slot owns. */
const SLOT_FIELDS: Record<string, readonly (keyof PrizeClawTheme)[]> = {
  case: [
    'woodMid',
    'woodHi',
    'woodLo',
    'enamelA',
    'enamelB',
    'pinstripe',
    'signPlate',
    'signInk',
    'brass',
    'brassHi',
    'brassLo',
  ],
  prizes: ['felt', 'feltShadow', 'cross', 'crossActive', 'prize', 'prizeAccent'],
  background: ['skyTop', 'skyBottom', 'deckColor', 'bulbWarm', 'bulbAmber', 'bulbRose'],
};

export type PrizeClawEquipped = Array<{
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

/**
 * Fold an equipped loadout onto a copy of the default, field by field, so a
 * partial skin degrades gracefully instead of blanking the cabinet.
 */
export function buildPrizeClawTheme(
  equipped: PrizeClawEquipped,
): PrizeClawTheme {
  const theme: PrizeClawTheme = {
    ...DEFAULT_PRIZE_CLAW_THEME,
    prize: { ...DEFAULT_PRIZE_CLAW_THEME.prize },
    prizeAccent: { ...DEFAULT_PRIZE_CLAW_THEME.prizeAccent },
  };

  for (const entry of equipped ?? []) {
    const slot = entry?.slot;
    const ref = entry?.item?.assetRef ?? null;
    if (!slot || !ref) continue;
    fillSlotFromLegacy(theme, LEGACY_PRIZE_CLAW_THEME, SLOT_FIELDS[slot]);

    if (slot === 'case') {
      theme.woodMid = readColor(ref, 'cabinetColor', theme.woodMid);
      theme.woodHi = readColor(ref, 'cabinetHi', theme.woodHi);
      theme.woodLo = readColor(ref, 'cabinetLo', theme.woodLo);
      theme.enamelA = readColor(ref, 'enamelA', theme.enamelA);
      theme.enamelB = readColor(ref, 'enamelB', theme.enamelB);
      theme.pinstripe = readColor(ref, 'pinstripe', theme.pinstripe);
      theme.signPlate = readColor(ref, 'signPlate', theme.signPlate);
      theme.signInk = readColor(ref, 'signInk', theme.signInk);
      // A lone accent recolours the brass; the highlight and shadow keep their
      // aged relationship unless the skin overrides them explicitly.
      theme.brass = readColor(
        ref,
        'brassColor',
        readColor(ref, 'accent', theme.brass),
      );
      theme.brassHi = readColor(ref, 'brassHi', theme.brassHi);
      theme.brassLo = readColor(ref, 'brassLo', theme.brassLo);
    } else if (slot === 'prizes') {
      theme.felt = readColor(ref, 'feltColor', theme.felt);
      theme.feltShadow = readColor(ref, 'feltShadow', theme.feltShadow);
      theme.cross = readColor(ref, 'crossColor', theme.cross);
      theme.crossActive = readColor(ref, 'crossActive', theme.crossActive);
      for (const tier of ['A', 'B', 'C', 'D', 'E'] as ClawTierId[]) {
        theme.prize[tier] = readColor(ref, `prize${tier}`, theme.prize[tier]);
        theme.prizeAccent[tier] = readColor(
          ref,
          `accent${tier}`,
          theme.prizeAccent[tier],
        );
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
    }
  }

  return theme;
}
