'use client';

/* The prize in place, over its card while a pointer is on it: a skin's
   in-game shot, or a profile prize on your own header. Mounted the first
   time the card is pointed at, so the grid loads nothing for it until then;
   it fades in once its image is ready. Touch never mounts it. */

import Image from 'next/image';
import { useState } from 'react';

import { isSkinGame, readSkinSet, type SkinGame } from '@/features/arcade/lib/skins/skin-set';

import { IdentityPreview, isIdentityItem, profilePatch, type Me, type ProfileLook } from './identity-preview';
import { shotFor, stageAspect } from './in-game-stage';

type HoverItem = { id: string; name: string; gameType: string; slots: string[]; assetRef: Record<string, unknown> | null };

export function PrizeHover({ item, me, look }: { item: HoverItem; me: Me | null; look: ProfileLook }) {
  const [ready, setReady] = useState(false);
  const skin = readSkinSet(item.assetRef);
  if (skin && isSkinGame(skin.game)) {
    const game = skin.game as SkinGame;
    const src = shotFor(game, item.id);
    if (!src) return null;
    return (
      <span className='pc-prize-hover' data-ready={ready || undefined} data-fit={stageAspect(game) < 1.2 ? 'contain' : 'cover'} aria-hidden>
        <Image src={src} alt='' fill sizes='(max-width: 1023px) 34vw, 300px' onLoad={() => setReady(true)} />
      </span>
    );
  }
  if (item.gameType === 'profile' && isIdentityItem(item)) {
    const who: Me = me ?? { name: 'you', avatarUrl: null, level: null };
    return (
      <span className='pc-prize-hover' data-ready aria-hidden>
        <IdentityPreview me={who} look={{ ...look, ...profilePatch(item) }} compact />
      </span>
    );
  }
  return null;
}
