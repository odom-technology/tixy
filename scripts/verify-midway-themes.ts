/**
 * Checks that owned cosmetics still look as they were sold after the 3D kit's
 * palette became the default (docs/design/tixy-rebrand/THREE.md).
 *
 * - An empty loadout is the palette default.
 * - An equipped slot fills the fields its skin leaves out from the frozen
 *   LEGACY_*_THEME, the defaults the skin and its store preview were made for.
 * - Slots with nothing equipped keep the palette.
 *
 *   npx tsx scripts/verify-midway-themes.ts
 */
import {
  DEFAULT_HIGH_STRIKER_THEME,
  LEGACY_HIGH_STRIKER_THEME,
  buildHighStrikerTheme,
} from '../src/app/(games)/high-striker/_high-striker-theme';
import {
  DEFAULT_LUCKY_CAGE_THEME,
  LEGACY_LUCKY_CAGE_THEME,
  buildLuckyCageTheme,
} from '../src/app/(games)/lucky-cage/_lucky-cage-theme';
import {
  DEFAULT_PRIZE_CLAW_THEME,
  LEGACY_PRIZE_CLAW_THEME,
  buildPrizeClawTheme,
} from '../src/app/(games)/prize-claw/_prize-claw-theme';
import {
  DEFAULT_SKEE_BALL_THEME,
  LEGACY_SKEE_BALL_THEME,
  buildSkeeBallTheme,
} from '../src/app/(games)/skee-ball/_skee-ball-theme';

let failures = 0;
function check(condition: boolean, message: string) {
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${message}`);
  if (!condition) failures += 1;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The skin from the brief: a background with only bgTop, bgBottom and accent. */
const SKIN = { bgTop: '#102030', bgBottom: '#203040', accent: '#40e0d0' };
const background = [{ slot: 'background', item: { assetRef: SKIN } }];

type Case = {
  game: string;
  empty: object;
  skinned: Record<string, unknown>;
  defaults: Record<string, unknown>;
  legacy: Record<string, unknown>;
  /** Background fields the skin leaves out: must come from the legacy theme. */
  legacyFields: string[];
  /** Fields of other slots: must stay the palette default. */
  paletteFields: string[];
};

const cases: Case[] = [
  {
    game: 'skee-ball',
    empty: buildSkeeBallTheme({ equipped: [] }),
    skinned: buildSkeeBallTheme({ equipped: background }),
    defaults: DEFAULT_SKEE_BALL_THEME,
    legacy: LEGACY_SKEE_BALL_THEME,
    legacyFields: ['groundColor', 'bulbRed', 'bulbTeal'],
    paletteFields: ['woodMid', 'rail', 'trim', 'field'],
  },
  {
    game: 'high-striker',
    empty: buildHighStrikerTheme({ equipped: [] }),
    skinned: buildHighStrikerTheme({ equipped: background }),
    defaults: DEFAULT_HIGH_STRIKER_THEME,
    legacy: LEGACY_HIGH_STRIKER_THEME,
    legacyFields: ['groundColor', 'bulbRed', 'bulbTeal'],
    paletteFields: ['woodMid', 'channel', 'tick', 'trim'],
  },
  {
    game: 'lucky-cage',
    empty: buildLuckyCageTheme([]),
    skinned: buildLuckyCageTheme(background),
    defaults: DEFAULT_LUCKY_CAGE_THEME,
    legacy: LEGACY_LUCKY_CAGE_THEME,
    legacyFields: ['deckColor', 'bulbWarm', 'bulbRose', 'pennantA', 'pennantB'],
    paletteFields: ['woodMid', 'trim', 'enamel', 'felt', 'brass'],
  },
  {
    game: 'prize-claw',
    empty: buildPrizeClawTheme([]),
    skinned: buildPrizeClawTheme(background),
    defaults: DEFAULT_PRIZE_CLAW_THEME,
    legacy: LEGACY_PRIZE_CLAW_THEME,
    legacyFields: ['deckColor', 'bulbWarm', 'bulbRose'],
    paletteFields: ['woodMid', 'enamelA', 'signPlate', 'felt', 'brass'],
  },
];

for (const c of cases) {
  check(same(c.empty, c.defaults), `${c.game}: an empty loadout is the palette default`);
  check(
    c.skinned.skyTop === SKIN.bgTop && c.skinned.skyBottom === SKIN.bgBottom,
    `${c.game}: the skin's sky is used`,
  );
  check(c.skinned.bulbAmber === SKIN.accent, `${c.game}: the skin's accent lights the amber bulbs`);
  for (const field of c.legacyFields) {
    check(
      same(c.skinned[field], c.legacy[field]) && !same(c.legacy[field], c.defaults[field]),
      `${c.game}: ${field} the skin leaves out comes from the legacy theme (${String(c.skinned[field])})`,
    );
  }
  for (const field of c.paletteFields) {
    check(
      same(c.skinned[field], c.defaults[field]),
      `${c.game}: ${field} in an empty slot stays the palette (${String(c.skinned[field])})`,
    );
  }
  check(Object.isFrozen(c.legacy), `${c.game}: the legacy theme is frozen`);
}

if (failures > 0) {
  console.log(`\n${failures} MIDWAY THEME CHECK(S) FAILED.`);
  process.exit(1);
}
console.log('\nALL MIDWAY THEME CHECKS PASS.');
