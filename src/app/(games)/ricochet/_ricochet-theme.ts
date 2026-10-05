/* Ricochet's look: one flat palette with one job per colour, a material for
   the walls and the field, and the bird's shape. The house look is the tixy
   screen: an ink field between two red walls with cream teeth, and the bird
   in ticket amber, because the bird is you.

   A skin set (SKINS.md) changes all of it at once and never the rules: the
   same walls, gaps, teeth and bird hit the same places on the same steps. An
   older one-slot skin (bird, obstacle, background, trail) is still read, into
   the same flat look. Nothing here glows or blends. */

import {
  findEquippedSkinSet,
  luminance,
  mixHex,
  type SkinMaterial,
  type SkinSet,
  type SkinSoundTint,
} from '@/features/arcade/lib/skins/skin-set';

export type InventoryCosmeticResponse = {
  wallet?: { credits?: number };
  dailyGameCredits?: { earned?: number; cap?: number };
  equipped?: Array<{
    slot?: string;
    item?: { assetRef?: Record<string, unknown> | null } | null;
  }>;
};

export type RicochetShape = 'bird' | 'owl' | 'chick' | 'plane';

export type RicochetLook = {
  /** The field behind the bird. */
  ground: string;
  /** A step off the ground, for the material's pattern. */
  groundAlt: string;
  /** The two walls. */
  wall: string;
  /** A step off the wall, for the material's pattern. */
  wallAlt: string;
  /** The teeth. */
  spike: string;
  /** The bird's body. */
  bird: string;
  /** The bird's wing, tail and beak. */
  birdAlt: string;
  /** Light details: the score, the safe slot on a wall, sparks, the belly. */
  mark: string;
  /** The eye and the numerals on a light bird. */
  eye: string;
  material: SkinMaterial;
  shape: RicochetShape;
  sound: SkinSoundTint;
  /** An older trail skin: dots behind the bird. Null for none. */
  trail: { color: string; length: number } | null;
  /** True when a skin set is drawn. */
  skinned: boolean;
};

const C = {
  paper: '#F4EBDC',
  ink: '#1F1A16',
  amber: '#F2A33C',
  amberDark: '#C98524',
  red: '#B83627',
  lit: '#F7E7C6',
  screen: '#2A231D',
  screen2: '#3A3029',
} as const;

const tidy = (ground: string, mark: string, wall: string) => ({
  groundAlt: mixHex(ground, mark, 0.07),
  wallAlt: mixHex(wall, luminance(wall) > 0.3 ? '#000000' : '#ffffff', 0.12),
});

export const HOUSE_LOOK: RicochetLook = {
  ground: C.screen,
  groundAlt: mixHex(C.screen, C.paper, 0.07),
  wall: C.red,
  wallAlt: mixHex(C.red, '#ffffff', 0.12),
  spike: C.lit,
  bird: C.amber,
  birdAlt: C.amberDark,
  mark: C.paper,
  eye: C.ink,
  material: 'ink',
  shape: 'bird',
  sound: 'house',
  trail: null,
  skinned: false,
};

/** A skin set, drawn flat. The eye is whichever of ink and paper reads on the
 *  bird; the two steps off the ground and the wall are the material's. */
export const applyRicochetSkinSet = (skin: SkinSet<'ricochet'>): RicochetLook => {
  const p = skin.palette;
  const steps = tidy(p.ground, p.mark, p.wall);
  return {
    ground: p.ground,
    groundAlt: steps.groundAlt,
    wall: p.wall,
    wallAlt: steps.wallAlt,
    spike: p.spike,
    bird: p.bird,
    birdAlt: p.birdAlt,
    mark: p.mark,
    eye: luminance(p.bird) > 0.3 ? C.ink : C.paper,
    material: skin.material,
    shape: skin.shape,
    sound: skin.sound,
    trail: null,
    skinned: true,
  };
};

const color = (assetRef: Record<string, unknown> | null | undefined, key: string): string | null => {
  const value = assetRef?.[key];
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim().toLowerCase() : null;
};

/** The one-slot skins from before skin sets, read into the flat look: the
 *  bird's colours, the teeth and wall, the field and a trail of dots. Their
 *  glow, gradients and stars are not drawn. */
const applyLegacySlots = (look: RicochetLook, equipped: NonNullable<InventoryCosmeticResponse['equipped']>) => {
  const next = { ...look };
  for (const entry of equipped) {
    const assetRef = entry?.item?.assetRef ?? null;
    if (!entry?.slot || !assetRef) continue;
    if (entry.slot === 'bird') {
      next.bird = color(assetRef, 'birdPrimary') ?? next.bird;
      next.birdAlt = color(assetRef, 'birdSecondary') ?? next.birdAlt;
      next.eye = luminance(next.bird) > 0.3 ? C.ink : C.paper;
    } else if (entry.slot === 'obstacle') {
      next.spike = color(assetRef, 'spikeColor') ?? color(assetRef, 'obstacleColor') ?? next.spike;
      next.wall = color(assetRef, 'rail') ?? next.wall;
      next.wallAlt = mixHex(next.wall, luminance(next.wall) > 0.3 ? '#000000' : '#ffffff', 0.12);
    } else if (entry.slot === 'background') {
      next.ground = color(assetRef, 'bgTop') ?? color(assetRef, 'well') ?? next.ground;
      next.groundAlt = mixHex(next.ground, next.mark, 0.07);
    } else if (entry.slot === 'trail' && assetRef.trailEnabled !== false) {
      const length = typeof assetRef.trailLength === 'number' ? Math.max(2, Math.min(24, assetRef.trailLength)) : 10;
      next.trail = { color: color(assetRef, 'trailColor') ?? next.bird, length: Math.round(length) };
    }
  }
  return next;
};

/** What the player has equipped, as a look. A skin set replaces the lot; an
 *  older skin changes its own part; nothing equipped is the house look. */
export const buildRicochetLook = (response: InventoryCosmeticResponse): RicochetLook => {
  const skin = findEquippedSkinSet(response.equipped, 'ricochet');
  if (skin) return applyRicochetSkinSet(skin);
  return applyLegacySlots(HOUSE_LOOK, response.equipped ?? []);
};
