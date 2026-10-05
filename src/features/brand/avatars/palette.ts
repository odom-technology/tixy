/* The colours every piece of art in the kit may use. PROGRESSION.md's art
   rules: the shell colours, the game-art colours, and one darker step for
   a single hard shadow. Nothing in this folder writes a hex outside this
   list, and scripts/check-art-kit.ts fails the build if an exported file
   does. Felt is in the list for the pool rail namecard and nothing else. */

import { TIXY_COLORS } from '../tixy-brand-geometry';

export const ART = {
  paper: TIXY_COLORS.paper,
  paper2: TIXY_COLORS.paper2,
  paper3: TIXY_COLORS.paper3,
  ink: TIXY_COLORS.ink,
  ink2: '#54483D',
  rail: '#2B2119',
  screen2: '#3A3029',
  amber: TIXY_COLORS.ticket,
  amberDark: '#C98524',
  red: TIXY_COLORS.red,
  redDark: '#8E281D',
  lit: '#F7E7C6',
  litDark: '#E0CB9B',
  brass: '#C9A25A',
  brassDark: '#A8843F',
  blue: '#4F7FC0',
  blueDark: '#3E659F',
  green: '#7FB069',
  greenDark: '#628F4F',
  felt: '#2E7566',
} as const;

export type ArtColor = keyof typeof ART;

/* Every hex the kit may use, lowercase, for the lint. */
export const ART_HEXES: ReadonlySet<string> = new Set(
  Object.values(ART).map((hex) => hex.toLowerCase()),
);

/* A colour and its one darker step. */
export const TONES = {
  amber: { main: ART.amber, dark: ART.amberDark },
  red: { main: ART.red, dark: ART.redDark },
  lit: { main: ART.lit, dark: ART.litDark },
  brass: { main: ART.brass, dark: ART.brassDark },
  blue: { main: ART.blue, dark: ART.blueDark },
  green: { main: ART.green, dark: ART.greenDark },
  ink: { main: ART.ink, dark: ART.ink2 },
} as const;

export type ToneName = keyof typeof TONES;
