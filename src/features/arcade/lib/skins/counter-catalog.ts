/* The prize counter's catalog (docs/design/tixy-rebrand/SKINS.md, "The
   catalog"). Every prize is priced on one of four shelves, and that is the
   only thing the price says: no rarity words reach a player.

   - Skins: five per floor skill game, one skin set each (skin-set.ts). A
     game's skins go on sale when the game draws skin sets (`renders` in
     SKIN_GAMES); until then they are designed here and not seeded.
   - Profile items: the art kit's counter frames and namecards, and text
     titles.

   Ids are stored keys and never change. `newOn` is the Monday a prize joins
   the counter; the counter's "new this week" is the prizes whose Monday is
   this week, and a prize with a later Monday stays off the counter until
   then. Prizes with no Monday were there from the start. */

import { FRAMES, NAMECARDS, artPath, type ArtItem } from '@/features/brand/avatars/catalog';
import type { RewardGameType, StoreRarity } from '@/features/arcade/lib/rewards';

import {
  SKIN_GAMES,
  SKIN_SET_VERSION,
  type SkinGame,
  type SkinMaterialOf,
  type SkinPaletteOf,
  type SkinSet,
  type SkinShapeOf,
  type SkinSoundTint,
} from './skin-set';

export const COUNTER_SHELVES = [450, 750, 1200, 2000] as const;
export type CounterShelf = (typeof COUNTER_SHELVES)[number];

/* store_items.rarity is NOT NULL and older code sorts by it, so each shelf
   keeps one internal rarity. Players never see it. */
export const SHELF_RARITY: Record<CounterShelf, StoreRarity> = {
  450: 'common',
  750: 'rare',
  1200: 'epic',
  2000: 'legendary',
};

export type CounterItem = {
  id: string;
  /* Lowercase, as players read it. */
  name: string;
  gameType: RewardGameType;
  slots: string[];
  price: CounterShelf;
  /* What the prize is, in two or three words: "snake skin", "avatar". */
  kind: string;
  assetRef: Record<string, unknown>;
  /* The Monday it joins the counter, YYYY-MM-DD. */
  newOn?: string;
  /* False for skins whose game doesn't draw skin sets yet. */
  onSale: boolean;
};

/* Every counter id starts with one of these, so the reset can tell the new
   catalog (and the art kit's rows, which other workstreams seed by the kit's
   ids) from everything seeded before it. 0059_counter_reset.sql lists the
   same prefixes. */
export const COUNTER_ID_PREFIXES = ['counter-', 'frame-', 'namecard-', 'medal-', 'stub-'] as const;
export const isCounterItemId = (id: string) => COUNTER_ID_PREFIXES.some((prefix) => id.startsWith(prefix));

/* ── skins ──────────────────────────────────────────────────────────── */

const GAME_SLOTS_FOR_SKIN: Record<SkinGame, string[]> = {
  snake: ['body', 'food', 'board'],
  '2048': ['tiles', 'grid', 'background'],
  '8-ball': ['table', 'balls', 'cue'],
  chess: ['pieces', 'board'],
  'connect-four': ['discs', 'board', 'background'],
  'skee-ball': ['lane', 'rings', 'background'],
  'high-striker': ['tower', 'puck', 'background'],
  'tin-duck': ['duck', 'sight', 'booth'],
  ricochet: ['bird', 'obstacle', 'background', 'trail'],
  stack: ['blocks', 'background', 'effects'],
  'word-grid': ['tiles', 'keyboard', 'accent'],
  'flappy-bird': ['bird', 'pipe', 'background', 'trail'],
  'ring-toss': ['crate', 'rings', 'booth'],
  'mini-golf': ['course', 'ball', 'flag'],
  'bumper-cars': ['car', 'rink', 'rail'],
  derby: ['track', 'horses', 'lane'],
};

type SkinDef<G extends SkinGame> = {
  slug: string;
  name: string;
  price: CounterShelf;
  material: SkinMaterialOf<G>;
  shape: SkinShapeOf<G>;
  sound: SkinSoundTint;
  palette: SkinPaletteOf<G>;
  newOn?: string;
};

/* The two colours the store card's backdrop uses, picked from the skin. */
const PREVIEW_KEYS: Record<SkinGame, [string, string]> = {
  snake: ['ground', 'body'],
  '2048': ['board', 'mid'],
  '8-ball': ['felt', 'rail'],
  chess: ['light', 'dark'],
  'connect-four': ['frame', 'you'],
  'skee-ball': ['lane', 'rings'],
  'high-striker': ['tower', 'puck'],
  'tin-duck': ['booth', 'target'],
  ricochet: ['ground', 'wall'],
  stack: ['ground', 'block'],
  'word-grid': ['ground', 'hit'],
  'flappy-bird': ['sky', 'pipe'],
  'ring-toss': ['booth', 'ring'],
  'mini-golf': ['felt', 'rail'],
  'bumper-cars': ['floor', 'rail'],
  derby: ['band', 'infield'],
};

function skins<G extends SkinGame>(game: G, defs: SkinDef<G>[]): CounterItem[] {
  const spec = SKIN_GAMES[game];
  return defs.map((def) => {
    const skin: SkinSet<G> = {
      v: SKIN_SET_VERSION,
      game,
      palette: def.palette,
      material: def.material,
      shape: def.shape,
      sound: spec.sound ? def.sound : 'house',
    };
    const [a, b] = PREVIEW_KEYS[game];
    const palette = def.palette as Record<string, string>;
    return {
      id: `counter-${game}-${def.slug}`,
      name: def.name,
      gameType: game as RewardGameType,
      slots: GAME_SLOTS_FOR_SKIN[game],
      price: def.price,
      kind: `${spec.label} skin`,
      assetRef: { skin, previewBgStart: palette[a], previewBgEnd: palette[b] },
      newOn: def.newOn,
      onSale: spec.renders,
    };
  });
}

/* House colours the skins draw from (the art kit's list, plus woods, slate
   and navy for materials). */
const C = {
  paper: '#f4ebdc',
  paper2: '#eadfcb',
  paper3: '#ded0b7',
  ink: '#1f1a16',
  ink2: '#54483d',
  rail: '#2b2119',
  screen2: '#3a3029',
  amber: '#f2a33c',
  amberDark: '#c98524',
  red: '#b83627',
  redDark: '#8e281d',
  lit: '#f7e7c6',
  litDark: '#e0cb9b',
  brass: '#c9a25a',
  brassDark: '#a8843f',
  blue: '#4f7fc0',
  blueDark: '#3e659f',
  green: '#7fb069',
  greenDark: '#628f4f',
  felt: '#2e7566',
  feltDark: '#245e52',
  walnut: '#5b3a24',
  walnutDark: '#3b2616',
  plank: '#6b4a2e',
  plankAlt: '#5e4128',
  plankLine: '#4a331f',
  maple: '#e9c48a',
  mapleDark: '#c99a62',
  slate: '#2f3b36',
  slateAlt: '#3a4842',
  chalk: '#56635c',
  navy: '#1e3550',
  navyDark: '#16273d',
  navyAlt: '#263f5e',
  tin: '#aab2b6',
  tinDark: '#2b3236',
  blush: '#e7b8a8',
  wine: '#5d2a35',
  wineDark: '#4b212b',
} as const;

const SNAKE_SKINS = skins('snake', [
  {
    slug: 'picnic',
    name: 'picnic',
    price: 450,
    material: 'tile',
    shape: 'tube',
    sound: 'warm',
    palette: { ground: C.paper, groundAlt: C.blush, line: '#d99a88', body: C.felt, bodyAlt: C.feltDark, mark: C.paper, food: C.red, foodMark: C.green },
  },
  {
    slug: 'chalk-line',
    name: 'chalk line',
    price: 750,
    material: 'slate',
    shape: 'links',
    sound: 'felt',
    palette: { ground: C.slate, groundAlt: '#2a3530', line: C.chalk, body: C.paper, bodyAlt: C.litDark, mark: C.slate, food: C.amber, foodMark: C.slate },
    newOn: '2026-09-28',
  },
  {
    slug: 'wood-blocks',
    name: 'wood blocks',
    price: 750,
    material: 'planks',
    shape: 'blocks',
    sound: 'wood',
    palette: { ground: C.plank, groundAlt: C.plankAlt, line: C.plankLine, body: C.maple, bodyAlt: C.mapleDark, mark: C.rail, food: C.red, foodMark: C.paper },
  },
  {
    slug: 'string-lights',
    name: 'string lights',
    price: 1200,
    material: 'ink',
    shape: 'beads',
    sound: 'bright',
    palette: { ground: C.navy, groundAlt: '#1b2f48', line: '#2a4466', body: C.amber, bodyAlt: C.lit, mark: C.navy, food: C.red, foodMark: C.paper },
    newOn: '2026-10-05',
  },
  {
    slug: 'ticket-roll',
    name: 'ticket roll',
    price: 2000,
    material: 'paper',
    shape: 'tickets',
    sound: 'paper',
    palette: { ground: C.paper, groundAlt: C.paper2, line: C.paper3, body: C.amber, bodyAlt: C.amberDark, mark: C.ink, food: C.red, foodMark: C.paper },
  },
]);

const GAME_2048_SKINS = skins('2048', [
  {
    slug: 'slate',
    name: 'slate',
    price: 450,
    material: 'slate',
    shape: 'square',
    sound: 'felt',
    palette: { ground: '#26302c', board: C.slate, cell: C.slateAlt, low: C.paper, mid: '#9fc3b5', high: C.amber, top: C.red, ink: C.ink, paper: C.paper },
  },
  {
    slug: 'poker-chips',
    name: 'poker chips',
    price: 750,
    material: 'felt',
    shape: 'coin',
    sound: 'bright',
    palette: { ground: '#1d4a40', board: C.felt, cell: C.feltDark, low: C.paper, mid: C.blue, high: C.red, top: C.ink, ink: C.ink, paper: C.paper },
    newOn: '2026-09-28',
  },
  {
    slug: 'ticket-stubs',
    name: 'ticket stubs',
    price: 750,
    material: 'paper',
    shape: 'stub',
    sound: 'paper',
    palette: { ground: C.paper, board: C.paper3, cell: C.paper2, low: '#f7d9a8', mid: C.amber, high: '#d06a2c', top: C.red, ink: C.ink, paper: C.paper },
  },
  {
    slug: 'crates',
    name: 'boardwalk crates',
    price: 1200,
    material: 'planks',
    shape: 'block',
    sound: 'wood',
    palette: { ground: C.plankLine, board: C.plank, cell: C.plankAlt, low: '#e9d3a8', mid: C.brass, high: '#8a5a2b', top: C.rail, ink: C.ink, paper: C.paper },
    newOn: '2026-10-12',
  },
  {
    slug: 'brass-badges',
    name: 'brass badges',
    price: 2000,
    material: 'ink',
    shape: 'badge',
    sound: 'tin',
    palette: { ground: C.navyDark, board: C.navy, cell: C.navyAlt, low: C.lit, mid: C.brass, high: '#b07a2f', top: C.red, ink: C.ink, paper: C.paper },
  },
]);

const POOL_SKINS = skins('8-ball', [
  {
    slug: 'pub-table',
    name: 'pub table',
    price: 450,
    material: 'walnut',
    shape: 'gloss',
    sound: 'wood',
    palette: { felt: C.felt, feltDark: C.feltDark, rail: C.walnut, railEdge: '#2b1a0f', pocket: '#0c0907', sight: C.lit, cue: '#e8d3a6', cueTip: C.blueDark },
  },
  {
    slug: 'red-room',
    name: 'red room',
    price: 750,
    material: 'maple',
    shape: 'flat',
    sound: 'warm',
    palette: { felt: '#8f2f24', feltDark: '#74251c', rail: C.mapleDark, railEdge: '#6e4a26', pocket: '#120b08', sight: C.ink, cue: C.paper, cueTip: C.ink },
  },
  {
    slug: 'enamel-blue',
    name: 'enamel blue',
    price: 750,
    material: 'enamel',
    shape: 'ringed',
    sound: 'bright',
    palette: { felt: '#2f5f8f', feltDark: '#264f78', rail: C.paper2, railEdge: C.red, pocket: C.ink, sight: C.red, cue: C.ink, cueTip: C.amber },
    newOn: '2026-10-05',
  },
  {
    slug: 'midnight-felt',
    name: 'midnight felt',
    price: 1200,
    material: 'ink',
    shape: 'pearl',
    sound: 'felt',
    palette: { felt: C.navy, feltDark: '#182c44', rail: C.rail, railEdge: '#120d09', pocket: '#0a0806', sight: C.lit, cue: C.brass, cueTip: C.lit },
    newOn: '2026-09-28',
  },
  {
    slug: 'wine-and-brass',
    name: 'wine and brass',
    price: 2000,
    material: 'brass',
    shape: 'flat',
    sound: 'tin',
    palette: {
      felt: C.wine,
      feltDark: C.wineDark,
      rail: C.brass,
      railEdge: '#7a5a26',
      pocket: '#120b08',
      sight: C.rail,
      cue: C.rail,
      cueTip: C.brass,
      ball1: C.amber,
      ball2: C.blue,
      ball3: C.red,
      ball4: '#6c4f8f',
      ball5: '#e07a2c',
      ball6: C.felt,
      ball7: C.redDark,
    },
  },
]);

const CHESS_SKINS = skins('chess', [
  { slug: 'walnut', name: 'walnut board', price: 450, material: 'walnut', shape: 'staunton', sound: 'wood', palette: { light: '#e9d3a8', dark: '#8a5a2b', frame: C.walnutDark, white: '#fbf6ec', black: C.ink, mark: C.amber } },
  { slug: 'tickets', name: 'ticket chess', price: 750, material: 'paper', shape: 'stub', sound: 'paper', palette: { light: C.paper, dark: C.paper3, frame: C.ink, white: C.amber, black: C.ink, mark: C.red } },
  { slug: 'slate', name: 'slate chess', price: 750, material: 'slate', shape: 'block', sound: 'felt', palette: { light: C.chalk, dark: C.slate, frame: C.ink, white: C.paper, black: C.red, mark: C.lit } },
  { slug: 'felt', name: 'felt chess', price: 1200, material: 'felt', shape: 'token', sound: 'felt', palette: { light: '#3a8a78', dark: C.felt, frame: C.rail, white: C.lit, black: C.ink, mark: C.amber } },
  { slug: 'maple-brass', name: 'maple and brass', price: 2000, material: 'maple', shape: 'staunton', sound: 'tin', palette: { light: '#f0dcb4', dark: '#b07d45', frame: '#6e4a26', white: C.brass, black: C.rail, mark: C.red } },
]);

const CONNECT_FOUR_SKINS = skins('connect-four', [
  { slug: 'classic-blue', name: 'classic blue', price: 450, material: 'enamel', shape: 'disc', sound: 'house', palette: { frame: C.blueDark, hole: C.paper, you: C.amber, them: C.red, mark: C.ink } },
  { slug: 'crate', name: 'boardwalk crate', price: 750, material: 'planks', shape: 'coin', sound: 'wood', palette: { frame: C.plank, hole: C.rail, you: C.brass, them: C.paper, mark: C.paper } },
  { slug: 'tin-can', name: 'tin can', price: 750, material: 'tin', shape: 'button', sound: 'tin', palette: { frame: '#9aa3a8', hole: C.tinDark, you: '#e2583f', them: C.paper, mark: C.paper } },
  { slug: 'night-drop', name: 'night drop', price: 1200, material: 'ink', shape: 'ring', sound: 'warm', palette: { frame: C.ink, hole: C.screen2, you: C.amber, them: C.blue, mark: C.paper } },
  { slug: 'red-enamel', name: 'red enamel', price: 2000, material: 'enamel', shape: 'coin', sound: 'bright', palette: { frame: C.red, hole: C.paper, you: C.brass, them: C.ink, mark: C.ink } },
]);

const SKEE_BALL_SKINS = skins('skee-ball', [
  { slug: 'maple-lane', name: 'maple lane', price: 450, material: 'maple', shape: 'ball', sound: 'wood', palette: { lane: C.maple, laneAlt: '#d9b072', rings: C.rail, ringMark: C.paper, ball: C.red, cabinet: C.ink } },
  { slug: 'boardwalk', name: 'boardwalk lane', price: 750, material: 'planks', shape: 'striped', sound: 'wood', palette: { lane: '#8a5a2b', laneAlt: '#7a4e24', rings: C.paper, ringMark: C.red, ball: C.amber, cabinet: C.rail } },
  { slug: 'tin-lane', name: 'tin lane', price: 750, material: 'tin', shape: 'dotted', sound: 'tin', palette: { lane: C.tin, laneAlt: '#9aa3a8', rings: C.navy, ringMark: C.amber, ball: C.paper, cabinet: C.tinDark } },
  { slug: 'night-lane', name: 'night lane', price: 1200, material: 'ink', shape: 'ringed', sound: 'warm', palette: { lane: '#2a231d', laneAlt: '#231d18', rings: C.amber, ringMark: C.ink, ball: C.paper, cabinet: C.ink } },
  { slug: 'blue-ribbon', name: 'blue ribbon', price: 2000, material: 'maple', shape: 'ringed', sound: 'bright', palette: { lane: '#f0dcb4', laneAlt: '#e3cb9c', rings: C.blueDark, ringMark: C.paper, ball: C.blueDark, cabinet: C.navy } },
]);

const HIGH_STRIKER_SKINS = skins('high-striker', [
  { slug: 'county-fair', name: 'county fair', price: 450, material: 'planks', shape: 'puck', sound: 'wood', palette: { tower: C.red, scale: C.paper, puck: C.ink, bell: C.brass, mark: C.ink, ground: C.plank } },
  { slug: 'brass-bell', name: 'brass bell', price: 750, material: 'brass', shape: 'star', sound: 'tin', palette: { tower: C.rail, scale: C.brass, puck: C.brass, bell: C.amber, mark: C.paper, ground: C.ink } },
  { slug: 'ticket-tower', name: 'ticket tower', price: 750, material: 'enamel', shape: 'stub', sound: 'paper', palette: { tower: C.paper, scale: C.amber, puck: C.amber, bell: C.red, mark: C.ink, ground: C.paper2 } },
  { slug: 'sweetheart', name: 'sweetheart', price: 1200, material: 'enamel', shape: 'heart', sound: 'bright', palette: { tower: C.paper, scale: C.red, puck: C.red, bell: C.brass, mark: C.ink, ground: C.blush } },
  { slug: 'strongman', name: 'night strongman', price: 2000, material: 'ink', shape: 'star', sound: 'warm', palette: { tower: C.navy, scale: C.lit, puck: C.amber, bell: C.brass, mark: C.paper, ground: C.navyDark } },
]);

const TIN_DUCK_SKINS = skins('tin-duck', [
  { slug: 'pond', name: 'duck pond', price: 450, material: 'tin', shape: 'duck', sound: 'tin', palette: { booth: C.blueDark, boothAlt: '#2f5f8f', target: C.amber, targetMark: C.ink, sight: C.red, water: C.blue } },
  { slug: 'rabbit-run', name: 'rabbit run', price: 750, material: 'planks', shape: 'rabbit', sound: 'wood', palette: { booth: C.plank, boothAlt: C.plankAlt, target: C.paper, targetMark: C.ink, sight: C.amber, water: C.felt } },
  { slug: 'fish-fry', name: 'fish fry', price: 750, material: 'tin', shape: 'fish', sound: 'tin', palette: { booth: C.felt, boothAlt: C.feltDark, target: C.amber, targetMark: C.ink, sight: C.paper, water: C.navy } },
  { slug: 'red-booth', name: 'red booth', price: 1200, material: 'enamel', shape: 'duck', sound: 'bright', palette: { booth: C.red, boothAlt: C.paper, target: C.paper, targetMark: C.ink, sight: C.amber, water: C.blueDark } },
  { slug: 'star-gallery', name: 'star gallery', price: 2000, material: 'ink', shape: 'star', sound: 'warm', palette: { booth: C.navy, boothAlt: C.navyDark, target: C.brass, targetMark: C.ink, sight: C.paper, water: C.ink } },
]);

/* Ricochet's palette roles (SKINS.md): `ground` is the field, `wall` the two
   walls, `spike` the teeth, `bird` the body, `birdAlt` its wing, tail and
   beak, `mark` the light details (the score, the safe slot on a wall, the
   sparks). Teeth read 3:1 on the field and on the wall, the bird 3:1 on the
   field, and the score 4.5:1 on the field. The shape is the bird's form. */
const RICOCHET_SKINS = skins('ricochet', [
  { slug: 'gull', name: 'pier gull', price: 450, material: 'planks', shape: 'bird', sound: 'wood', palette: { ground: C.navy, wall: C.plank, spike: C.lit, bird: C.paper, birdAlt: C.tin, mark: C.paper } },
  { slug: 'owl', name: 'night owl', price: 750, material: 'ink', shape: 'owl', sound: 'warm', palette: { ground: C.ink, wall: '#4a3d33', spike: C.amber, bird: '#b07a4a', birdAlt: C.plank, mark: C.lit } },
  { slug: 'plane', name: 'ticket plane', price: 750, material: 'paper', shape: 'plane', sound: 'paper', palette: { ground: C.paper, wall: C.amber, spike: C.ink, bird: C.red, birdAlt: C.redDark, mark: C.ink } },
  { slug: 'canary', name: 'canary', price: 1200, material: 'enamel', shape: 'chick', sound: 'bright', palette: { ground: C.navyDark, wall: C.blue, spike: C.lit, bird: '#f6d44a', birdAlt: C.amberDark, mark: C.paper } },
  { slug: 'swift', name: 'brass swift', price: 2000, material: 'brass', shape: 'bird', sound: 'tin', palette: { ground: C.ink, wall: '#9c7a38', spike: C.lit, bird: '#d9503a', birdAlt: C.redDark, mark: C.lit } },
]);

/* Stacker's palette roles (SKINS.md): `ground` is the cabinet's backing,
   `block` the tower, `blockAlt` the moving row (and endless's second course),
   `mark` the seams and straps on a piece, `prize` the marks at rows 11 and 15.
   Block, moving row and prize marks each read 3:1 or better on the ground. */
const STACK_SKINS = skins('stack', [
  { slug: 'bricks', name: 'brick stack', price: 450, material: 'tile', shape: 'brick', sound: 'warm', palette: { ground: C.ink, block: '#c4432e', blockAlt: C.paper2, mark: C.lit, prize: C.amber } },
  { slug: 'tickets', name: 'ticket stack', price: 750, material: 'ink', shape: 'stub', sound: 'paper', palette: { ground: C.ink, block: C.amber, blockAlt: C.paper, mark: C.ink, prize: C.lit } },
  { slug: 'crates', name: 'crate stack', price: 750, material: 'planks', shape: 'crate', sound: 'wood', palette: { ground: C.rail, block: '#a8743f', blockAlt: '#f0dcb4', mark: C.walnut, prize: C.amber } },
  { slug: 'blue-tile', name: 'blue tile', price: 1200, material: 'tile', shape: 'block', sound: 'bright', palette: { ground: C.navyDark, block: C.blue, blockAlt: C.paper, mark: C.navyDark, prize: C.amber } },
  { slug: 'brass', name: 'brass stack', price: 2000, material: 'brass', shape: 'block', sound: 'tin', palette: { ground: C.ink, block: C.brass, blockAlt: '#d9503a', mark: C.rail, prize: C.lit } },
]);

/* Word grid's palette roles: `ground` is the page behind the grid, `tile` an
   unguessed tile and `tileInk` its letter. The three results stay told apart
   by lightness as well as hue: `miss` is the darkest, `hit` the middle, `near`
   the lightest, and every result letter reads 4.5:1. Each also keeps its mark
   (a dot, a ring, a dash) for players who don't see colour. */
const WORD_GRID_SKINS = skins('word-grid', [
  { slug: 'notebook', name: 'notebook', price: 450, material: 'paper', shape: 'square', sound: 'house', palette: { ground: C.paper, tile: C.paper2, tileInk: C.ink, hit: C.felt, near: C.amber, miss: C.rail } },
  { slug: 'chalk', name: 'chalk words', price: 750, material: 'slate', shape: 'square', sound: 'house', palette: { ground: C.slate, tile: C.slateAlt, tileInk: C.paper, hit: '#35704a', near: C.amber, miss: '#1a211e' } },
  { slug: 'tickets', name: 'ticket words', price: 750, material: 'paper', shape: 'stub', sound: 'house', palette: { ground: C.paper3, tile: C.paper, tileInk: C.ink, hit: C.blueDark, near: C.amber, miss: C.ink } },
  { slug: 'felt', name: 'felt words', price: 1200, material: 'felt', shape: 'round', sound: 'house', palette: { ground: '#1d4a40', tile: C.felt, tileInk: C.paper, hit: C.red, near: C.lit, miss: '#14302a' } },
  { slug: 'boardwalk', name: 'boardwalk words', price: 2000, material: 'planks', shape: 'tag', sound: 'house', palette: { ground: C.plank, tile: '#e9d3a8', tileInk: C.rail, hit: C.felt, near: C.amber, miss: C.rail } },
]);

/* Flappy bird's palette roles (FLAPPY.md): `sky` and `far` the night
   behind, `pipe`, `pipeCap` and `pipeMark` the posts, `ground` the pier,
   `bird`, `wing` and `beak` the flyer (the plane's beak is its propeller).
   Posts and flyer each hold 3:1 on the sky, and the flyer 1.4:1 off a post. */
const FLAPPY_SKINS = skins('flappy-bird', [
  { slug: 'boardwalk-gull', name: 'boardwalk gull', price: 450, material: 'planks', shape: 'gull', sound: 'wood', palette: { sky: '#25313b', far: '#34434f', pipe: '#a8743f', pipeCap: C.walnut, pipeMark: C.plankLine, ground: C.plank, bird: C.paper, wing: '#9aa5ad', beak: C.amber } },
  { slug: 'ticket-flyer', name: 'ticket flyer', price: 750, material: 'paper', shape: 'stub', sound: 'paper', palette: { sky: C.ink, far: '#2f2822', pipe: C.paper, pipeCap: C.red, pipeMark: C.paper3, ground: C.screen2, bird: C.amber, wing: C.paper, beak: C.ink } },
  { slug: 'tin-duck', name: 'tin duck', price: 750, material: 'tin', shape: 'duck', sound: 'tin', palette: { sky: C.navy, far: C.navyAlt, pipe: '#8a9499', pipeCap: '#c3cacd', pipeMark: '#6f797e', ground: C.tinDark, bird: '#f2c94c', wing: C.amberDark, beak: '#d9622b' }, newOn: '2026-10-12' },
  { slug: 'barn-owl', name: 'barn owl', price: 1200, material: 'ink', shape: 'owl', sound: 'felt', palette: { sky: '#121219', far: '#20202b', pipe: '#5b6683', pipeCap: C.amber, pipeMark: '#4a536c', ground: '#2a2a36', bird: '#b08462', wing: '#6e4f38', beak: C.amber }, newOn: '2026-10-12' },
  { slug: 'banner-plane', name: 'banner plane', price: 2000, material: 'brass', shape: 'plane', sound: 'bright', palette: { sky: '#284f86', far: '#335d97', pipe: C.brass, pipeCap: C.brassDark, pipeMark: C.lit, ground: C.maple, bird: C.paper, wing: C.red, beak: C.ink } },
]);

/* Ring toss's palette roles (RING_TOSS.md): `booth` the walls, `crate` and
   `platform` the wood, `glass` and `glassAlt` the front and back rows, `ring`
   and `ringMark` the rings and their tape, `mark` the row values. The rings
   hold 3:1 on the crate they land in and 2:1 on the booth and the platform
   they fly past, the values 4.5:1 on the platform, and the back rows' glass
   (where the gold stands) stays 1.5:1 off its amber. */
const RING_TOSS_SKINS = skins('ring-toss', [
  { slug: 'soda-crate', name: 'soda crate', price: 450, material: 'planks', shape: 'hoop', sound: 'wood', palette: { booth: C.rail, crate: '#c4432e', platform: C.plank, glass: '#3f7f62', glassAlt: '#5a3a22', ring: C.lit, ringMark: C.red, mark: C.paper } },
  { slug: 'rope-rings', name: 'rope rings', price: 750, material: 'walnut', shape: 'rope', sound: 'warm', palette: { booth: C.ink, crate: C.walnut, platform: '#3f2a1b', glass: '#9fb7a6', glassAlt: '#2f6683', ring: '#e0c08a', ringMark: '#8a6a3c', mark: C.lit } },
  { slug: 'tin-crate', name: 'tin crate', price: 750, material: 'tin', shape: 'band', sound: 'tin', palette: { booth: C.navy, crate: '#6f797e', platform: C.tinDark, glass: C.blue, glassAlt: C.felt, ring: C.paper, ringMark: C.red, mark: C.paper } },
  { slug: 'ticket-beads', name: 'ticket beads', price: 1200, material: 'enamel', shape: 'beads', sound: 'paper', palette: { booth: C.redDark, crate: C.ink2, platform: C.rail, glass: '#3f7f62', glassAlt: C.navy, ring: C.amber, ringMark: C.ink, mark: C.lit } },
  { slug: 'midnight-maple', name: 'midnight maple', price: 2000, material: 'maple', shape: 'band', sound: 'bright', palette: { booth: C.navyDark, crate: C.maple, platform: C.mapleDark, glass: '#9fb7a6', glassAlt: '#5b2a6e', ring: C.blueDark, ringMark: C.paper, mark: C.ink } },
]);

/* Mini golf's palette roles (MINI_GOLF.md): `felt` and `feltAlt` the
   putting surface, `rail` and `railTop` the rails and caps, `deck` the
   boardwalk, `ball` and `ballMark` the ball, `flag` the pennant. The ball
   holds 3:1 on the felt, its mark 1.5:1 on the ball and the rail caps 1.5:1
   on the felt (test:counter). */
const MINI_GOLF_SKINS = skins('mini-golf', [
  { slug: 'putting-green', name: 'putting green', price: 450, material: 'felt', shape: 'dots', sound: 'felt', palette: { felt: '#3c8f4f', feltAlt: '#337c44', rail: '#7a5532', railTop: C.paper, deck: '#4a3524', ball: '#f7f1e6', ballMark: C.red, flag: C.amber } },
  { slug: 'boardwalk', name: 'boardwalk course', price: 750, material: 'planks', shape: 'band', sound: 'wood', palette: { felt: '#a77446', feltAlt: '#946437', rail: '#3a2412', railTop: '#e8c98f', deck: '#2b2119', ball: C.paper, ballMark: C.ink, flag: C.red } },
  { slug: 'ticket', name: 'ticket course', price: 750, material: 'paper', shape: 'ringed', sound: 'paper', palette: { felt: '#efe3cc', feltAlt: '#d9c7a6', rail: C.red, railTop: C.ink, deck: C.ink, ball: C.red, ballMark: C.paper, flag: C.ink } },
  { slug: 'night', name: 'night course', price: 1200, material: 'felt', shape: 'star', sound: 'warm', palette: { felt: '#24395c', feltAlt: '#1d2f4d', rail: C.brass, railTop: '#f0d79a', deck: '#14141c', ball: C.amber, ballMark: C.ink, flag: C.paper } },
  { slug: 'gilded', name: 'gilded green', price: 2000, material: 'enamel', shape: 'dots', sound: 'bright', palette: { felt: '#1f5a46', feltAlt: '#174536', rail: C.ink, railTop: C.brass, deck: '#2a231d', ball: '#f0d79a', ballMark: '#78581f', flag: C.red } },
]);

/* Bumper cars' palette roles (BUMPER_CARS.md): `floor` and `floorAlt` the
   rink's floor, `rail` and `railAlt` the padding's bands, `cap` the rail's
   cap, `deck` round the rink, `mark` the floor's seams. Every seat's car
   holds 1.35:1 against the floor by its colour or its ink ring, and the two
   bands hold 1.5:1 against each other (test:counter). */
const BUMPER_CARS_SKINS = skins('bumper-cars', [
  { slug: 'county-fair', name: 'county fair', price: 450, material: 'tile', shape: 'dodgem', sound: 'house', palette: { floor: '#2f343a', floorAlt: '#3b4148', rail: '#2f6683', railAlt: C.paper, cap: C.maple, deck: C.rail, mark: '#4c535a' } },
  { slug: 'pier-planks', name: 'pier planks', price: 750, material: 'planks', shape: 'coupe', sound: 'wood', palette: { floor: C.plank, floorAlt: C.plankAlt, rail: C.red, railAlt: C.amber, cap: C.walnutDark, deck: '#241a12', mark: C.plankLine } },
  { slug: 'tin-rink', name: 'tin rink', price: 750, material: 'tin', shape: 'rocket', sound: 'tin', palette: { floor: '#5f686d', floorAlt: '#535b60', rail: C.navy, railAlt: C.paper, cap: C.brass, deck: '#2a231d', mark: '#7d878c' } },
  { slug: 'teacup-ride', name: 'teacup ride', price: 1200, material: 'enamel', shape: 'teacup', sound: 'bright', palette: { floor: '#24395c', floorAlt: '#1d2f4d', rail: C.amber, railAlt: C.red, cap: C.paper, deck: '#14141c', mark: C.paper } },
  { slug: 'night-shift', name: 'night shift', price: 2000, material: 'ink', shape: 'rocket', sound: 'warm', palette: { floor: '#1a1612', floorAlt: '#241f1a', rail: C.brass, railAlt: C.ink, cap: '#f0d79a', deck: '#100c09', mark: '#3a3029' } },
]);

/* Derby's palette roles (DERBY.md, SKINS.md): `band` the rails the horses
   run on and `bandLine` the slot along them, `rail` the trims (rail edges,
   the wire's posts, the target wall's frame), `infield` the backboard and
   the target wall, `board` the counter, `ball` the water gun. The gun holds
   3:1 on the counter, the slot 1.25:1 on the band, and the trims 1.5:1 on
   the band (test:counter). Lane silks, the target's rings and the water are
   game information and don't change. Keys never change. */
const DERBY_SKINS = skins('derby', [
  { slug: 'county-fair', name: 'county fair', price: 450, material: 'planks', shape: 'wheels', sound: 'wood', palette: { band: '#a77446', bandLine: '#7d5326', rail: C.paper, infield: C.rail, board: C.plank, ball: C.paper } },
  { slug: 'turf-club', name: 'turf club', price: 750, material: 'felt', shape: 'rocker', sound: 'felt', palette: { band: '#3c8f4f', bandLine: '#2c6b3a', rail: C.paper, infield: '#1d2a21', board: C.walnut, ball: C.paper } },
  { slug: 'ticket-stakes', name: 'ticket stakes', price: 750, material: 'paper', shape: 'wheels', sound: 'paper', palette: { band: '#efe3cc', bandLine: '#cdb994', rail: C.red, infield: C.ink, board: C.walnut, ball: C.amber } },
  { slug: 'night-meet', name: 'night meet', price: 1200, material: 'enamel', shape: 'carousel', sound: 'warm', palette: { band: '#2b4a73', bandLine: '#1e3550', rail: C.brass, infield: '#14141c', board: C.walnutDark, ball: C.amber }, newOn: '2026-10-19' },
  { slug: 'gilded-cup', name: 'gilded cup', price: 2000, material: 'maple', shape: 'carousel', sound: 'bright', palette: { band: C.maple, bandLine: C.mapleDark, rail: C.ink, infield: '#1f5a46', board: C.walnutDark, ball: C.paper } },
]);

export const COUNTER_SKINS: CounterItem[] = [
  ...POOL_SKINS,
  ...CHESS_SKINS,
  ...CONNECT_FOUR_SKINS,
  ...SKEE_BALL_SKINS,
  ...HIGH_STRIKER_SKINS,
  ...TIN_DUCK_SKINS,
  ...RICOCHET_SKINS,
  ...SNAKE_SKINS,
  ...GAME_2048_SKINS,
  ...STACK_SKINS,
  ...WORD_GRID_SKINS,
  ...FLAPPY_SKINS,
  ...RING_TOSS_SKINS,
  ...MINI_GOLF_SKINS,
  ...BUMPER_CARS_SKINS,
  ...DERBY_SKINS,
];

/* ── profile items from the art kit ─────────────────────────────────── */

/* The art kit's frames and namecards keep the kit's own ids on the counter
   (`frame-brass`, `namecard-awning`), the same rows the profile's seed
   (scripts/seed-art-kit-items.ts, #79) writes, with the same asset_ref. The
   kit's stub avatars are free defaults, never sold, and its medals are the
   achievement badges. The season card's kit items (`source: 'season'`)
   are earned there and never sold. */
export const artStoreItemId = (item: Pick<ArtItem, 'id'>) => item.id;

const counterArt = <T extends ArtItem>(items: T[]) => items.filter((item) => item.source === 'counter');

const FRAME_PRICE: Record<string, CounterShelf> = { 'frame-brass': 1200, 'frame-bulbs': 750 };
const NAMECARD_PRICE: Record<string, CounterShelf> = {
  'namecard-awning': 450,
  'namecard-planks': 450,
  'namecard-bezel': 750,
  'namecard-rail': 1200,
};

const PROFILE_FRAMES: CounterItem[] = counterArt(FRAMES).map((item) => ({
  id: artStoreItemId(item),
  name: item.name,
  gameType: 'profile' as const,
  slots: ['frame'],
  price: FRAME_PRICE[item.id] ?? 750,
  kind: 'avatar frame',
  assetRef: { frame: item.frame, imageUrl: artPath(item, 'svg') },
  newOn: item.id === 'frame-bulbs' ? '2026-10-05' : undefined,
  onSale: true,
}));

const PROFILE_NAMECARDS: CounterItem[] = counterArt(NAMECARDS).map((item) => ({
  id: artStoreItemId(item),
  name: item.name,
  gameType: 'profile' as const,
  slots: ['background'],
  price: NAMECARD_PRICE[item.id] ?? 750,
  kind: 'namecard',
  assetRef: { namecard: item.card, imageUrl: artPath(item, 'svg') },
  newOn: item.id === 'namecard-rail' ? '2026-10-12' : undefined,
  onSale: true,
}));

const title = (slug: string, text: string, price: CounterShelf, newOn?: string): CounterItem => ({
  id: `counter-title-${slug}`,
  name: text,
  gameType: 'profile',
  slots: ['title'],
  price,
  kind: 'title',
  assetRef: { text, previewBgStart: C.paper2, previewBgEnd: C.paper3 },
  newOn,
  onSale: true,
});

const PROFILE_TITLES: CounterItem[] = [
  title('regular', 'regular', 450),
  title('prize-hound', 'prize hound', 450),
  title('rail-bird', 'rail bird', 750),
  title('lane-captain', 'lane captain', 750),
  title('bell-ringer', 'bell ringer', 750, '2026-10-05'),
  title('sharpshooter', 'sharpshooter', 750),
  title('night-shift', 'night shift', 1200),
  title('ticket-baron', 'ticket baron', 2000),
];

export const COUNTER_PROFILE_ITEMS: CounterItem[] = [...PROFILE_FRAMES, ...PROFILE_NAMECARDS, ...PROFILE_TITLES];

export const COUNTER_CATALOG: CounterItem[] = [...COUNTER_SKINS, ...COUNTER_PROFILE_ITEMS];

const BY_ID = new Map(COUNTER_CATALOG.map((item) => [item.id, item]));
export const getCounterItem = (id: string) => BY_ID.get(id) ?? null;

/* ── the week ───────────────────────────────────────────────────────── */

/* The Monday (UTC) of the week a YYYY-MM-DD date falls in. */
export function counterWeekStart(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

/* Whether a counter item has reached the counter by this date. Items not in
   the catalog (added in the admin) are always there. */
export function isOnCounterBy(itemId: string, dateKey: string): boolean {
  const newOn = BY_ID.get(itemId)?.newOn;
  return !newOn || newOn <= dateKey;
}

/* Whether an item is in this week's drop. */
export function isNewThisWeek(itemId: string, dateKey: string): boolean {
  const newOn = BY_ID.get(itemId)?.newOn;
  if (!newOn) return false;
  const monday = counterWeekStart(dateKey);
  return newOn >= monday && newOn <= dateKey;
}
