/* The tixy brand drawings as numbers, shared by the React components and by
   scripts/brand/build-brand-assets.tsx, which exports the icon files. The
   shapes come from docs/design/tixy-rebrand/build-mockup.mjs, the approved
   mockup. Colours are the PLAN.md values, hardcoded so exported files stand
   alone. */

import { TIXY_WORDMARK_OUTLINE } from './tixy-wordmark-outline';

export const TIXY_COLORS = {
  paper: '#F4EBDC',
  paper2: '#EADFCB',
  paper3: '#DED0B7',
  ink: '#1F1A16',
  ticket: '#F2A33C',
  red: '#B83627',
} as const;

/* The stub: a rounded ticket with a half-circle notch on each short end.
   Drawn in a 120 x 72 box with 4 units of room on every side. */
export const MARK_WIDTH = 120;
export const MARK_HEIGHT = 72;
export const STUB_PATH =
  'M12,4 H108 A8,8 0 0 1 116,12 V27 A9,9 0 0 0 116,45 V60 A8,8 0 0 1 108,68 H12 A8,8 0 0 1 4,60 V45 A9,9 0 0 0 4,27 V12 A8,8 0 0 1 12,4 Z';
export const MARK_FACE = {
  eyes: [
    [34, 31],
    [58, 31],
  ],
  eyeRadius: 5,
  smile: 'M29,43 Q46,56 63,43',
  smileWidth: 5.5,
} as const;
export const MARK_PERF = {
  d: 'M88,13 V59',
  width: 3.5,
  dash: '4.5 5.5',
} as const;

/* The 16 px drawing, on a 16 x 16 grid with edges on whole pixels: a fatter
   stub, bigger notches, square eyes, a
   pixel smile, and no perforation. Used for the
   favicon and the SVG tab icon. */
export const SMALL_GRID = 16;
export const SMALL_GROUND_RADIUS = 3.5;
export const SMALL_STUB_PATH =
  'M2,3 H14 A1,1 0 0 1 15,4 V6 A2,2 0 0 0 15,10 V12 A1,1 0 0 1 14,13 H2 A1,1 0 0 1 1,12 V10 A2,2 0 0 0 1,6 V4 A1,1 0 0 1 2,3 Z';
export const SMALL_FACE = {
  eyes: [
    [5, 5],
    [9, 5],
  ],
  eyeSize: 2,
  /* A filled U on whole pixels, so it stays crisp at 16 px. */
  smile: 'M5,9 H6 V10 H10 V9 H11 V11 H5 Z',
} as const;

/* App icons: the stub, straight, on ink. `markScale` is the mark's box width
   as a share of the icon. The maskable one keeps the stub inside the 80%
   safe circle (its half-diagonal is 0.33 of the icon, under 0.4). */
export const APP_ICON = {
  roundedRadius: 0.22,
  markScale: 0.78,
  maskableMarkScale: 0.62,
} as const;

/* The lockup, in wordmark font units (1000 per em, baseline at y = 0). It
   copies the mockup's CSS: the stub is 1.12em wide, sits .16em left of the
   text, is centred on a line-height 1 box, nudged down .04em, and turned
   -8 degrees. */
const EM = TIXY_WORDMARK_OUTLINE.unitsPerEm;
const LOCKUP_MARK_WIDTH = 1.12 * EM;
const LOCKUP_MARK_SCALE = LOCKUP_MARK_WIDTH / MARK_WIDTH;
const LOCKUP_MARK_HEIGHT = MARK_HEIGHT * LOCKUP_MARK_SCALE;
const LOCKUP_GAP = 0.16 * EM;
const LOCKUP_TILT = -8;
const lineCenter =
  -(TIXY_WORDMARK_OUTLINE.ascender + TIXY_WORDMARK_OUTLINE.descender) / 2;
const markCenterX = LOCKUP_MARK_WIDTH / 2;
const markCenterY = lineCenter + 0.04 * EM;

function rotatedStubBounds() {
  const rad = (LOCKUP_TILT * Math.PI) / 180;
  const halfW = ((MARK_WIDTH - 8) / 2) * LOCKUP_MARK_SCALE;
  const halfH = ((MARK_HEIGHT - 8) / 2) * LOCKUP_MARK_SCALE;
  const dx = Math.abs(halfW * Math.cos(rad)) + Math.abs(halfH * Math.sin(rad));
  const dy = Math.abs(halfW * Math.sin(rad)) + Math.abs(halfH * Math.cos(rad));
  return {
    xMin: markCenterX - dx,
    xMax: markCenterX + dx,
    yMin: markCenterY - dy,
    yMax: markCenterY + dy,
  };
}

const stubBounds = rotatedStubBounds();
const textX = LOCKUP_MARK_WIDTH + LOCKUP_GAP;
const { bounds } = TIXY_WORDMARK_OUTLINE;
const PAD = 12;
const lockupXMin = Math.floor(Math.min(stubBounds.xMin, textX + bounds.xMin) - PAD);
const lockupXMax = Math.ceil(textX + bounds.xMax + PAD);
const lockupYMin = Math.floor(Math.min(stubBounds.yMin, bounds.yMin) - PAD);
const lockupYMax = Math.ceil(Math.max(stubBounds.yMax, bounds.yMax) + PAD);

export const LOCKUP = {
  viewBox: `${lockupXMin} ${lockupYMin} ${lockupXMax - lockupXMin} ${lockupYMax - lockupYMin}`,
  width: lockupXMax - lockupXMin,
  height: lockupYMax - lockupYMin,
  /* Places the 120 x 72 mark drawing. */
  markTransform: `rotate(${LOCKUP_TILT} ${markCenterX} ${markCenterY}) translate(0 ${round(
    markCenterY - LOCKUP_MARK_HEIGHT / 2,
  )}) scale(${round(LOCKUP_MARK_SCALE, 4)})`,
  textTransform: `translate(${textX} 0)`,
} as const;

const WORDMARK_PAD = 12;
export const WORDMARK = {
  viewBox: `${bounds.xMin - WORDMARK_PAD} ${bounds.yMin - WORDMARK_PAD} ${
    bounds.xMax - bounds.xMin + WORDMARK_PAD * 2
  } ${bounds.yMax - bounds.yMin + WORDMARK_PAD * 2}`,
  width: bounds.xMax - bounds.xMin + WORDMARK_PAD * 2,
  height: bounds.yMax - bounds.yMin + WORDMARK_PAD * 2,
} as const;

/* The host: the stub with two arms and two legs, 150 x 170. The body is the
   mark, turned 8 degrees. Each limb is a stroke ending in a round foot or
   hand. */
export const HOST_WIDTH = 150;
export const HOST_HEIGHT = 170;
export const HOST = {
  limbWidth: 6,
  body: 'translate(15,30) rotate(8 60 36)',
  legLeft: { d: 'M58,104 L50,146', foot: [44, 149, 13, 7] },
  legRight: { d: 'M88,106 L94,146', foot: [100, 149, 13, 7] },
  armLeft: { d: 'M22,62 Q8,52 12,34', hand: [12, 31, 8] },
  armRight: { d: 'M128,74 Q142,84 140,102', hand: [140, 105, 8] },
} as const;

function round(value: number, places = 2) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
