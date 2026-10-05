/* Flappy bird's look: the house pier at night, a skin set over it, or an
   older per-slot item read the old way.

   The house look (docs/design/tixy-rebrand/FLAPPY.md): the ink screen is the
   night sky, the boardwalk is a flat silhouette behind it, the pipes are red
   enamel posts with paper caps, and the bird is ticket amber, because the
   bird is you. Flat fills, one hard shadow on the score, no glow and no
   gradients. A skin set (SKINS.md) replaces the palette, the posts'
   material and the bird's shape, and tints the sounds. It never moves
   anything: the hitbox, the gaps and the timing are _flappy-sim.ts'. */

import { findEquippedSkinSet, mixHex, type SkinSet, type SkinSoundTint } from '@/features/arcade/lib/skins/skin-set';

export type FlappyMaterial = SkinSet<'flappy-bird'>['material'];
export type FlappyShape = SkinSet<'flappy-bird'>['shape'];

export type FlappyLook = {
  /** The sky, flat. */
  sky: string;
  /** The far boardwalk: the wheel, the tents, the roofs. */
  far: string;
  /** The near rail and its posts. */
  rail: string;
  /** The string lights on the rail. */
  bulb: string;
  /** The pipes' body, its lit edge and its cap. */
  pipe: string;
  pipeLight: string;
  pipeCap: string;
  /** Marks on the pipe's material: seams, rivets, rules, the pinstripe. */
  pipeMark: string;
  material: FlappyMaterial;
  /** The pier's boards and their seams. */
  ground: string;
  groundAlt: string;
  groundMark: string;
  /** The bird. */
  shape: FlappyShape;
  bird: string;
  wing: string;
  beak: string;
  eye: string;
  pupil: string;
  /** An older trail item's colours, drawn as flat dots. Null for none. */
  trail: string[] | null;
  /** An older bird item's outline. */
  outline: { colour: string; width: number } | null;
  /** The score and the flash. */
  score: string;
  scoreShadow: string;
  sound: SkinSoundTint;
};

/* The mockup's screen palette (game-previews/kit.tsx). */
const K = {
  paper: '#f4ebdc',
  ink: '#1f1a16',
  amber: '#f2a33c',
  amberDark: '#c98524',
  red: '#b83627',
  screen: '#2a231d',
  screen2: '#3a3029',
  dim: '#4a3d33',
  lit: '#f7e7c6',
} as const;

export const HOUSE_FLAPPY_LOOK: FlappyLook = {
  sky: K.screen,
  far: K.screen2,
  rail: '#453930',
  bulb: K.amberDark,
  // Brick red, a step lighter than the brand red so the posts hold 3:1 on
  // the night sky.
  pipe: '#c4432e',
  pipeLight: '#d4573f',
  pipeCap: K.paper,
  pipeMark: K.paper,
  material: 'enamel',
  ground: K.dim,
  groundAlt: '#433730',
  groundMark: K.screen,
  shape: 'bird',
  bird: K.amber,
  wing: K.amberDark,
  beak: K.red,
  eye: K.paper,
  pupil: K.ink,
  trail: null,
  outline: null,
  score: K.paper,
  scoreShadow: K.ink,
  sound: 'house',
};

/** A skin set's look. Every role it has is the skin's; the rest follow. */
export function applyFlappySkinSet(skin: SkinSet<'flappy-bird'>): FlappyLook {
  const p = skin.palette;
  return {
    ...HOUSE_FLAPPY_LOOK,
    sky: p.sky,
    far: p.far,
    rail: mixHex(p.far, p.ground, 0.5),
    bulb: p.bird === p.pipeCap ? mixHex(p.bird, p.sky, 0.4) : mixHex(p.pipeCap, p.sky, 0.35),
    pipe: p.pipe,
    pipeLight: mixHex(p.pipe, '#ffffff', 0.14),
    pipeCap: p.pipeCap,
    pipeMark: p.pipeMark,
    material: skin.material,
    ground: p.ground,
    groundAlt: mixHex(p.ground, p.sky, 0.25),
    groundMark: mixHex(p.ground, '#000000', 0.35),
    shape: skin.shape,
    bird: p.bird,
    wing: p.wing,
    beak: p.beak,
    eye: K.paper,
    pupil: K.ink,
    sound: skin.sound,
  };
}

type Equipped = Array<{
  slot?: string;
  item?: { assetRef?: Record<string, unknown> | null } | null;
}>;

const readColour = (assetRef: Record<string, unknown>, key: string, fallback: string) => {
  const value = assetRef[key];
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : fallback;
};

/**
 * The look for what the player has equipped. A skin set wins. Otherwise
 * older bird, pipe, background and trail items keep working on the house
 * look, read the way they always were, minus the glow (the art is flat now)
 * and the sky's gradient (its top colour is the sky).
 */
export function buildFlappyLook(equipped: Equipped | undefined): FlappyLook {
  const skin = findEquippedSkinSet(equipped, 'flappy-bird');
  if (skin) return applyFlappySkinSet(skin);

  const look: FlappyLook = { ...HOUSE_FLAPPY_LOOK };
  for (const entry of equipped ?? []) {
    const slot = entry?.slot;
    const ref = entry?.item?.assetRef ?? null;
    if (!slot || !ref) continue;
    if (slot === 'bird') {
      look.bird = readColour(ref, 'birdPrimary', look.bird);
      look.wing = readColour(ref, 'birdSecondary', look.wing);
      if (ref.birdOutline === true) {
        look.outline = {
          colour: readColour(ref, 'birdOutlineColor', K.paper),
          width: typeof ref.birdOutlineWidth === 'number' ? Math.min(4, Math.max(1, ref.birdOutlineWidth)) : 2,
        };
      }
    } else if (slot === 'pipe') {
      // The old pipes were a dark edge (primary) and a lit spine (secondary).
      look.pipe = readColour(ref, 'pipeSecondary', look.pipe);
      look.pipeCap = readColour(ref, 'pipePrimary', look.pipeCap);
      look.pipeLight = mixHex(look.pipe, '#ffffff', 0.14);
      look.pipeMark = look.pipeCap;
    } else if (slot === 'background') {
      look.sky = readColour(ref, 'skyTop', look.sky);
      look.far = mixHex(look.sky, readColour(ref, 'skyBottom', look.sky), 0.6);
      look.rail = mixHex(look.far, '#000000', 0.12);
      look.ground = readColour(ref, 'ground', look.ground);
      look.groundAlt = mixHex(look.ground, look.sky, 0.25);
      look.groundMark = mixHex(look.ground, '#000000', 0.35);
    } else if (slot === 'trail') {
      const colours = Array.isArray(ref.trailColors)
        ? (ref.trailColors as unknown[]).filter((c): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))
        : [];
      const single = typeof ref.trailColor === 'string' ? [ref.trailColor] : [];
      const trail = colours.length > 0 ? colours : single;
      look.trail = trail.length > 0 ? trail : null;
    }
  }
  return look;
}
