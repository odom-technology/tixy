/* The frames and namecards a player owns, for the profile pickers. Pure data,
   safe on both sides. Items bought before rev. 2 stay in the list: a hex ring
   as a frame, a generated banner as a namecard. */

import type { FrameId } from '@/features/brand/avatars/frames';
import type { NamecardId } from '@/features/brand/avatars/namecards';
import type { EquippedStoreItem, OwnedStoreItem } from '@/server/arcade/rewards/types';

export type CosmeticChoice = {
  id: string;
  name: string;
  /** An art kit item. */
  art: FrameId | NamecardId | null;
  /** A legacy hex ring (frames) or a CSS background (namecards). */
  legacy: string | null;
};

export type CosmeticOptions = {
  frames: CosmeticChoice[];
  namecards: CosmeticChoice[];
  equippedFrameId: string | null;
  equippedNamecardId: string | null;
};

const str = (value: unknown) => (typeof value === 'string' ? value : null);

function legacyBackground(ref: Record<string, unknown>): string | null {
  const image = str(ref.imageUrl);
  if (image) return `center / cover no-repeat url('${image}')`;
  const start = str(ref.bgStart);
  return start ? `linear-gradient(135deg, ${start}, ${str(ref.bgEnd) ?? start})` : null;
}

export function profileCosmeticOptions(inventory: {
  ownedItems: OwnedStoreItem[];
  equipped: EquippedStoreItem[];
}): CosmeticOptions {
  const profile = inventory.ownedItems.filter((owned) => owned.item.gameType === 'profile');
  const choices = (slot: 'frame' | 'background'): CosmeticChoice[] =>
    profile
      .filter((owned) => owned.item.slots.includes(slot))
      .map(({ item }) => {
        const ref = item.assetRef ?? {};
        const art = (slot === 'frame' ? str(ref.frame) : str(ref.namecard)) as FrameId | NamecardId | null;
        return {
          id: item.id,
          name: item.name,
          art,
          legacy: art ? null : slot === 'frame' ? str(ref.color) : legacyBackground(ref),
        };
      })
      .sort((a, b) => Number(!a.art) - Number(!b.art) || a.name.localeCompare(b.name));
  const equippedId = (slot: string) =>
    inventory.equipped.find((entry) => entry.item.gameType === 'profile' && entry.slot === slot)?.item.id ?? null;
  return {
    frames: choices('frame'),
    namecards: choices('background'),
    equippedFrameId: equippedId('frame'),
    equippedNamecardId: equippedId('background'),
  };
}
