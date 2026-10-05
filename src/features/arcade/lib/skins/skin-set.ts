/* The skin set: what one skin is for a floor game (docs/design/tixy-rebrand/SKINS.md).

   A skin set changes four things together, and nothing else:
   - palette: named colours, each with one job in that game;
   - material: what the board, table or cabinet is made of (planks, felt,
     brass), drawn as a flat pattern;
   - shape: one signature shape (the snake's body, 2048's tiles, the balls);
   - sound: a tint on the game's own sounds, where the game has sounds.

   A skin never changes rules, hitboxes or timing. Every renderer draws the
   same thing at the same place and the same time; only how it looks and
   sounds changes.

   A skin set is one store item that fills every slot of its game. It lives
   in the item's `asset_ref` under `skin`, beside the preview keys the store
   reads. Older items keep their per-slot keys and their old readers. This
   module is import-safe on client and server: pure data and helpers. */

export const SKIN_SET_VERSION = 2 as const;

/* What a board, table or cabinet can be made of. Each game allows a few. */
export type SkinMaterial =
  | 'ink' // the house cabinet: ink with a faint tone step
  | 'planks' // boardwalk boards with seams
  | 'paper' // ticket stock with ruled lines
  | 'slate' // chalkboard with chalk lines
  | 'tile' // a two-tone checker
  | 'felt' // cloth with a fine weave
  | 'walnut' // dark wood with grain
  | 'maple' // light wood with grain
  | 'brass' // metal with rivets
  | 'enamel' // painted metal with a pinstripe
  | 'tin'; // stamped tin with dimples

/* A tint on a game's sounds: one filter, and a pitch step. */
export type SkinSoundTint = 'house' | 'warm' | 'bright' | 'wood' | 'tin' | 'felt' | 'paper';

export const SKIN_SOUND_TINTS: readonly SkinSoundTint[] = [
  'house',
  'warm',
  'bright',
  'wood',
  'tin',
  'felt',
  'paper',
];

type GameSpec = {
  /* Lowercase, as players read it: "snake", "2048", "8-ball". */
  label: string;
  /* The palette roles this game reads. A skin must give every one. */
  palette: readonly string[];
  /* Optional extra roles (for example a ball set) that fall back to the
     game's house colours when a skin leaves them out. */
  optionalPalette?: readonly string[];
  materials: readonly SkinMaterial[];
  shapes: readonly string[];
  /* Whether the game has sounds a tint can colour. */
  sound: boolean;
  /* True once the game draws skin sets. The counter only sells skins for
     games that do. */
  renders: boolean;
};

/* Every floor skill game, with the hooks its skin set fills. The ones with
   `renders: false` are designed in SKINS.md and the catalog, and go on sale
   when their game group's follow-up draws them. */
export const SKIN_GAMES = {
  snake: {
    label: 'snake',
    palette: ['ground', 'groundAlt', 'line', 'body', 'bodyAlt', 'mark', 'food', 'foodMark'],
    materials: ['ink', 'planks', 'paper', 'slate', 'tile'],
    shapes: ['tube', 'beads', 'blocks', 'tickets', 'links'],
    sound: true,
    renders: true,
  },
  '2048': {
    label: '2048',
    palette: ['ground', 'board', 'cell', 'low', 'mid', 'high', 'top', 'ink', 'paper'],
    materials: ['ink', 'planks', 'felt', 'slate', 'paper'],
    shapes: ['square', 'stub', 'coin', 'block', 'badge'],
    sound: true,
    renders: true,
  },
  '8-ball': {
    label: '8-ball',
    palette: ['felt', 'feltDark', 'rail', 'railEdge', 'pocket', 'sight', 'cue', 'cueTip'],
    optionalPalette: ['ball1', 'ball2', 'ball3', 'ball4', 'ball5', 'ball6', 'ball7'],
    materials: ['walnut', 'maple', 'ink', 'brass', 'enamel'],
    shapes: ['gloss', 'flat', 'pearl', 'ringed'],
    sound: true,
    renders: true,
  },
  chess: {
    label: 'chess',
    palette: ['light', 'dark', 'frame', 'white', 'black', 'mark'],
    materials: ['paper', 'walnut', 'maple', 'slate', 'felt'],
    shapes: ['staunton', 'stub', 'token', 'block'],
    sound: true,
    renders: true,
  },
  'connect-four': {
    label: 'connect four',
    palette: ['frame', 'hole', 'you', 'them', 'mark'],
    materials: ['enamel', 'planks', 'ink', 'tin'],
    shapes: ['disc', 'coin', 'button', 'ring'],
    sound: true,
    renders: true,
  },
  'skee-ball': {
    label: 'skee-ball',
    palette: ['lane', 'laneAlt', 'rings', 'ringMark', 'ball', 'cabinet'],
    materials: ['planks', 'maple', 'ink', 'tin'],
    shapes: ['ball', 'striped', 'dotted', 'ringed'],
    sound: true,
    renders: true,
  },
  'high-striker': {
    label: 'high striker',
    palette: ['tower', 'scale', 'puck', 'bell', 'mark', 'ground'],
    materials: ['planks', 'brass', 'enamel', 'ink'],
    shapes: ['puck', 'star', 'stub', 'heart'],
    sound: true,
    renders: true,
  },
  'tin-duck': {
    label: 'tin duck',
    palette: ['booth', 'boothAlt', 'target', 'targetMark', 'sight', 'water'],
    materials: ['tin', 'planks', 'enamel', 'ink'],
    shapes: ['duck', 'rabbit', 'fish', 'star'],
    sound: true,
    renders: true,
  },
  ricochet: {
    label: 'ricochet',
    palette: ['ground', 'wall', 'spike', 'bird', 'birdAlt', 'mark'],
    materials: ['ink', 'planks', 'paper', 'brass', 'enamel', 'tin'],
    shapes: ['bird', 'owl', 'chick', 'plane'],
    sound: true,
    renders: true,
  },
  stack: {
    label: 'stacker',
    palette: ['ground', 'block', 'blockAlt', 'mark', 'prize'],
    materials: ['ink', 'planks', 'tile', 'brass'],
    shapes: ['block', 'stub', 'brick', 'crate'],
    sound: true,
    renders: true,
  },
  'word-grid': {
    label: 'word grid',
    palette: ['ground', 'tile', 'tileInk', 'hit', 'near', 'miss'],
    materials: ['paper', 'slate', 'planks', 'felt'],
    shapes: ['square', 'stub', 'round', 'tag'],
    sound: false,
    renders: true,
  },
  /* Flappy bird (FLAPPY.md): `sky` and `far` the night behind, `pipe`,
     `pipeCap` and `pipeMark` the posts, `ground` the pier, `bird`, `wing`
     and `beak` the flyer. The material is the posts'; the shape is the
     flyer, drawn inside the same hitbox. */
  'flappy-bird': {
    label: 'flappy bird',
    palette: ['sky', 'far', 'pipe', 'pipeCap', 'pipeMark', 'ground', 'bird', 'wing', 'beak'],
    materials: ['enamel', 'planks', 'paper', 'tin', 'brass', 'ink'],
    shapes: ['bird', 'gull', 'stub', 'duck', 'owl', 'plane'],
    sound: true,
    renders: true,
  },
  /* Ring toss (RING_TOSS.md): `booth` the walls behind, `crate` and
     `platform` the wood the bottles stand in and on, `glass` the front two
     rows and `glassAlt` the back two, `ring` the rings and `ringMark` their
     tape, `mark` the row values painted beside the crate. The material is
     the crate's; the shape is the ring, inside the same collider. The gold
     bottle stays gold. */
  'ring-toss': {
    label: 'ring toss',
    palette: ['booth', 'crate', 'platform', 'glass', 'glassAlt', 'ring', 'ringMark', 'mark'],
    materials: ['planks', 'maple', 'walnut', 'tin', 'enamel'],
    shapes: ['hoop', 'band', 'rope', 'beads'],
    sound: true,
    renders: true,
  },
  /* Mini golf (MINI_GOLF.md): `felt` and `feltAlt` the putting surface and
     its pattern's second tone, `rail` and `railTop` the rails and their caps,
     `deck` the boardwalk round the course, `ball` and `ballMark` the ball,
     `flag` the pennant. The material is the putting surface's; the shape is
     the ball's markings. The windmill and the loop keep the house look. */
  'mini-golf': {
    label: 'mini golf',
    palette: ['felt', 'feltAlt', 'rail', 'railTop', 'deck', 'ball', 'ballMark', 'flag'],
    materials: ['felt', 'tile', 'planks', 'paper', 'enamel'],
    shapes: ['dots', 'band', 'ringed', 'star'],
    sound: true,
    renders: true,
  },
  /* Bumper cars (BUMPER_CARS.md): `floor` and `floorAlt` the rink's floor
     and its pattern's second tone, `rail` and `railAlt` the padding's bands,
     `cap` the rail's cap, `deck` the boardwalk round the rink, `mark` the
     floor's seams and rivets. The material is the floor's; the shape is the
     cars' bodywork, inside the same rubber ring. The cars' colours are the
     seats' and never change: they tell eight players apart. A skin is what
     you see; the other players see their own. */
  'bumper-cars': {
    label: 'bumper cars',
    palette: ['floor', 'floorAlt', 'rail', 'railAlt', 'cap', 'deck', 'mark'],
    materials: ['tin', 'tile', 'planks', 'enamel', 'ink'],
    shapes: ['dodgem', 'rocket', 'coupe', 'teacup'],
    sound: true,
    renders: true,
  },
  /* Derby (DERBY.md): `band` the rails the horses run on, `bandLine` the
     slot along them, `rail` the trims and the wire's posts, `infield` the
     backboard and the target wall, `board` the counter, `ball` the water
     gun. The material is the rails'; the shape is how the toy horses are
     made (on wheels, on rocking runners, on a carousel pole). Lane silks,
     the target's rings and the water carry game information and never
     change. */
  derby: {
    label: 'derby',
    palette: ['band', 'bandLine', 'rail', 'infield', 'board', 'ball'],
    materials: ['planks', 'felt', 'paper', 'enamel', 'maple'],
    shapes: ['wheels', 'rocker', 'carousel'],
    sound: true,
    renders: true,
  },
} as const satisfies Record<string, GameSpec>;

export type SkinGame = keyof typeof SKIN_GAMES;
export type SkinShapeOf<G extends SkinGame> = (typeof SKIN_GAMES)[G]['shapes'][number];
export type SkinMaterialOf<G extends SkinGame> = (typeof SKIN_GAMES)[G]['materials'][number];
type OptionalRoles<G extends SkinGame> = (typeof SKIN_GAMES)[G] extends { optionalPalette: readonly (infer R)[] }
  ? R & string
  : never;
export type SkinPaletteOf<G extends SkinGame> = Record<(typeof SKIN_GAMES)[G]['palette'][number], string> &
  Partial<Record<OptionalRoles<G>, string>>;

export type SkinSet<G extends SkinGame = SkinGame> = {
  v: typeof SKIN_SET_VERSION;
  game: G;
  palette: SkinPaletteOf<G>;
  material: SkinMaterialOf<G>;
  shape: SkinShapeOf<G>;
  sound: SkinSoundTint;
};

export const isSkinGame = (value: unknown): value is SkinGame =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(SKIN_GAMES, value);

const HEX = /^#[0-9a-fA-F]{6}$/;

/* Read a skin set from an item's asset_ref. Returns null for older items,
   for another game's skin, or for anything malformed, so a game falls back
   to its own look and never draws half a skin. */
export function readSkinSet<G extends SkinGame>(
  assetRef: Record<string, unknown> | null | undefined,
  game?: G,
): SkinSet<G> | null {
  const raw = assetRef?.skin;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const skin = raw as Record<string, unknown>;
  if (skin.v !== SKIN_SET_VERSION || !isSkinGame(skin.game)) return null;
  if (game && skin.game !== game) return null;
  const spec: GameSpec = SKIN_GAMES[skin.game];
  if (!(spec.materials as readonly string[]).includes(skin.material as string)) return null;
  if (!(spec.shapes as readonly string[]).includes(skin.shape as string)) return null;
  const sound = SKIN_SOUND_TINTS.includes(skin.sound as SkinSoundTint) ? (skin.sound as SkinSoundTint) : 'house';
  const paletteIn = skin.palette as Record<string, unknown> | undefined;
  if (!paletteIn || typeof paletteIn !== 'object') return null;
  const palette: Record<string, string> = {};
  for (const role of spec.palette) {
    const colour = paletteIn[role];
    if (typeof colour !== 'string' || !HEX.test(colour)) return null;
    palette[role] = colour.toLowerCase();
  }
  for (const role of spec.optionalPalette ?? []) {
    const colour = paletteIn[role];
    if (typeof colour === 'string' && HEX.test(colour)) palette[role] = colour.toLowerCase();
  }
  return {
    v: SKIN_SET_VERSION,
    game: skin.game as G,
    palette: palette as SkinPaletteOf<G>,
    material: skin.material as SkinMaterialOf<G>,
    shape: skin.shape as SkinShapeOf<G>,
    sound,
  };
}

/* The first equipped skin set for a game, from an inventory payload. Every
   slot of the game holds the same item, so any slot will do. */
export function findEquippedSkinSet<G extends SkinGame>(
  equipped: ReadonlyArray<{ item?: { assetRef?: Record<string, unknown> | null } | null } | null | undefined> | undefined,
  game: G,
): SkinSet<G> | null {
  for (const entry of equipped ?? []) {
    const skin = readSkinSet(entry?.item?.assetRef ?? null, game);
    if (skin) return skin;
  }
  return null;
}

/* ── colour helpers the renderers share ─────────────────────────────── */

const toRgb = (hex: string) => {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255] as const;
};

const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;

/* Mix two #rrggbb colours: 0 is `a`, 1 is `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = toRgb(a);
  const [br, bg, bb] = toRgb(b);
  return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/* Relative luminance, for picking ink or paper text on a fill. */
export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* Whichever of two text colours reads better on a fill. */
export function readableOn(fill: string, dark: string, light: string): string {
  return contrastRatio(fill, dark) >= contrastRatio(fill, light) ? dark : light;
}
