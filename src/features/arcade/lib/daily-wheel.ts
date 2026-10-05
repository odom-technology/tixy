/* The daily spin (docs/design/tixy-rebrand/DAILY_WHEEL.md): one wheel a
   day, its value times the streak day's multiplier.

   The wheel is 50 units of 7.2 deg, with a peg on every unit line. Each
   unit is one fiftieth of the draw, so a slot's width on screen is its
   chance. Body slots are 2 units wide; the 100 and the 200 are 1 unit.
   The server draws a unit (crypto.randomInt(0, 50)); everything else here
   is a pure function of that unit, the streak day and the legacy hold, so
   the client, the server and the verifier agree.

   Expected base value: (10*8 + 15*12 + 20*14 + 25*10 + 40*4 + 100 + 200) / 50
   = 1250 / 50 = 25, and each ladder day's multiplier is its ladder amount
   over 25, so a day's expected payout is the ladder's (25, 25, 50, 50, 75,
   100, 200). scripts/verify-daily-wheel.ts checks it from these tables. */

import { DAILY_CLAIM_LADDER, DAILY_CLAIM_LADDER_DAYS } from './rewards';

/** Bump when the layout changes; stored with every spin. */
export const DAILY_WHEEL_VERSION = 1;
export const DAILY_WHEEL_UNITS = 50;
/** Degrees per unit (one peg gap). */
export const DAILY_WHEEL_UNIT_DEG = 360 / DAILY_WHEEL_UNITS;
/** The wheel's expected base value; the ladder's first day. */
export const DAILY_WHEEL_BASE = 25;

export type DailyWheelTier = 'body' | 'minor' | 'top';

export type DailyWheelSegment = {
  index: number;
  value: number;
  /** First unit, clockwise from the wheel's top at rest. */
  start: number;
  units: number;
  tier: DailyWheelTier;
};

/* Clockwise from the top of the wheel at rest: [value, units]. The 200 sits
   between two 10s, and the 100 across the wheel between two more. */
const LAYOUT: ReadonlyArray<readonly [number, number]> = [
  [200, 1],
  [10, 2], [20, 2], [15, 2], [25, 2], [20, 2], [15, 2], [40, 2], [20, 2], [15, 2], [25, 2], [20, 2],
  [10, 2],
  [100, 1],
  [10, 2], [20, 2], [15, 2], [25, 2], [20, 2], [15, 2], [40, 2], [25, 2], [15, 2], [20, 2], [25, 2],
  [10, 2],
];

export const DAILY_WHEEL_SEGMENTS: readonly DailyWheelSegment[] = (() => {
  let start = 0;
  return LAYOUT.map(([value, units], index) => {
    const segment: DailyWheelSegment = {
      index,
      value,
      start,
      units,
      tier: value >= 200 ? 'top' : value >= 100 ? 'minor' : 'body',
    };
    start += units;
    return segment;
  });
})();

/** The top slot's base value. */
export const DAILY_WHEEL_TOP = Math.max(...DAILY_WHEEL_SEGMENTS.map((segment) => segment.value));

const SEGMENT_BY_UNIT: readonly DailyWheelSegment[] = DAILY_WHEEL_SEGMENTS.flatMap((segment) =>
  Array.from({ length: segment.units }, () => segment),
);

export function isWheelUnit(unit: unknown): unit is number {
  return typeof unit === 'number' && Number.isInteger(unit) && unit >= 0 && unit < DAILY_WHEEL_UNITS;
}

export function wheelSegmentForUnit(unit: number): DailyWheelSegment {
  const segment = SEGMENT_BY_UNIT[unit];
  if (!segment) throw new Error(`No wheel unit ${unit}.`);
  return segment;
}

/** Day of the 7-day ladder for a streak day (1-based, repeating): 1 to 7. */
export function wheelLadderDay(streakDay: number) {
  return ((Math.max(1, Math.floor(streakDay)) - 1) % DAILY_CLAIM_LADDER_DAYS) + 1;
}

/** The ladder amount over the wheel's base: 1, 1, 2, 2, 3, 4, 8. */
export const DAILY_WHEEL_MULTIPLIERS: readonly number[] = DAILY_CLAIM_LADDER.map(
  (tickets) => tickets / DAILY_WHEEL_BASE,
);

export function wheelMultiplier(streakDay: number) {
  return DAILY_WHEEL_MULTIPLIERS[wheelLadderDay(streakDay) - 1]!;
}

export type DailyWheelPayout = {
  unit: number;
  segment: number;
  value: number;
  multiplier: number;
  /** What the spin pays: value times multiplier, or the hold if larger. */
  tickets: number;
  /** True when a legacy hold paid more than the wheel. */
  held: boolean;
};

/** What unit `unit` pays on streak day `streakDay`, with a legacy hold floor. */
export function wheelPayout(unit: number, streakDay: number, hold = 0): DailyWheelPayout {
  const segment = wheelSegmentForUnit(unit);
  const multiplier = wheelMultiplier(streakDay);
  const won = segment.value * multiplier;
  const floor = Math.max(0, Math.floor(hold));
  return {
    unit,
    segment: segment.index,
    value: segment.value,
    multiplier,
    tickets: Math.max(won, floor),
    held: floor > won,
  };
}

/* ── drawing: angles ───────────────────────────────────────────────── */

/* The wheel turns clockwise. `rotation` is how far it has turned from rest,
   in degrees; the flapper at the top reads the wheel point at -rotation. */

/** Where the flapper rests in a unit: 0 is the unit's leading peg line. */
export function wheelRestFraction(seed: string) {
  // FNV-1a: a stable, cosmetic offset so a spin always draws the same.
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  // murmur3's finaliser, so seeds that differ in one letter spread out.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

/** The rotation (0 to 360) that puts wheel angle `alpha` under the flapper. */
export function rotationForWheelAngle(alpha: number) {
  return (((-alpha) % 360) + 360) % 360;
}

/** The unit under the flapper at `rotation`. */
export function unitAtRotation(rotation: number) {
  const alpha = (((-rotation) % 360) + 360) % 360;
  return Math.min(DAILY_WHEEL_UNITS - 1, Math.floor(alpha / DAILY_WHEEL_UNIT_DEG));
}
