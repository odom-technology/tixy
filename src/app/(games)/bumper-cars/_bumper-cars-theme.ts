/* Bumper cars' look, and how a skin set (SKINS.md) changes it.

   A new game has no legacy theme: the house look is DEFAULT_BUMPER_THEME,
   and an equipped skin set replaces the floor (colours and material), the
   rail's bands and cap, the deck, the cars' bodywork and the sound tint.
   Nothing here moves anything: the rink, the rubber rings and the physics
   are the engine's, and each seat keeps its colour. */

import {
  findEquippedSkinSet,
  type SkinMaterialOf,
  type SkinSet,
  type SkinShapeOf,
  type SkinSoundTint,
} from '@/features/arcade/lib/skins/skin-set';
import { MIDWAY_PALETTE } from '@/features/arcade/lib/midway-three';

export type CarShape = SkinShapeOf<'bumper-cars'>;

export type BumperTheme = {
  floor: string;
  floorAlt: string;
  mark: string;
  rail: string;
  railAlt: string;
  cap: string;
  deck: string;
  /** The floor's material; null is the house's steel plates. */
  material: SkinMaterialOf<'bumper-cars'> | null;
  shape: CarShape;
  sound: SkinSoundTint;
};

export const DEFAULT_BUMPER_THEME: BumperTheme = {
  floor: '#4a443d',
  floorAlt: '#433d37',
  mark: '#5d564e',
  rail: MIDWAY_PALETTE.red,
  railAlt: MIDWAY_PALETTE.paper,
  cap: MIDWAY_PALETTE.wood,
  deck: MIDWAY_PALETTE.wood,
  material: null,
  shape: 'dodgem',
  sound: 'house',
};

export function applyBumperSkinSet(base: BumperTheme, skin: SkinSet<'bumper-cars'>): BumperTheme {
  const p = skin.palette;
  return {
    ...base,
    floor: p.floor,
    floorAlt: p.floorAlt,
    mark: p.mark,
    rail: p.rail,
    railAlt: p.railAlt,
    cap: p.cap,
    deck: p.deck,
    material: skin.material,
    shape: skin.shape,
    sound: skin.sound,
  };
}

export type InventoryCosmeticResponse = {
  wallet?: { credits?: number };
  equipped?: Array<{ slot?: string; item?: { assetRef?: Record<string, unknown> | null } | null } | null>;
};

/** The theme from an inventory payload: the house look, or the equipped skin set. */
export function buildBumperTheme(response: InventoryCosmeticResponse | null | undefined): BumperTheme {
  const skin = findEquippedSkinSet(response?.equipped, 'bumper-cars');
  return skin ? applyBumperSkinSet({ ...DEFAULT_BUMPER_THEME }, skin) : { ...DEFAULT_BUMPER_THEME };
}
