'use client';

/* A skin on its game's own stage, in an ink cabinet.

   - The 2D games draw it live with the game's own renderer (./live), loaded
     only when a preview opens.
   - The 3D games show a shot of the real scene with the skin on
     (skin-shots.ts); starting a WebGL scene per preview would cost more than
     the preview is worth.
   - Anything without either falls back to the counter card's flat drawing. */

import dynamic from 'next/dynamic';
import Image from 'next/image';
import type { ComponentType } from 'react';

import { SkinSetPreview } from '@/features/arcade/components/store-item-preview/skin-set-preview';
import type { SkinGame, SkinSet } from '@/features/arcade/lib/skins/skin-set';

import type { LiveProps } from './live/types';
import { houseShotId, skinShotAspect, skinShotSrc } from './skin-shots';

type LiveEntry = { aspect: number; Live: ComponentType<LiveProps> };

const live = (load: () => Promise<{ default: ComponentType<LiveProps> }>) =>
  dynamic(load, { ssr: false, loading: () => null });

/* Each live game's stage aspect, width over height, as the game sets it. */
const LIVE: Partial<Record<SkinGame, LiveEntry>> = {
  chess: { aspect: 1, Live: live(() => import('./live/chess')) },
  'connect-four': { aspect: 1.08, Live: live(() => import('./live/connect-four')) },
  '8-ball': { aspect: 1.86, Live: live(() => import('./live/8-ball')) },
  ricochet: { aspect: 480 / 640, Live: live(() => import('./live/ricochet')) },
  'flappy-bird': { aspect: 400 / 600, Live: live(() => import('./live/flappy-bird')) },
  stack: { aspect: 0.8, Live: live(() => import('./live/stack')) },
  '2048': { aspect: 1, Live: live(() => import('./live/2048')) },
  'word-grid': { aspect: 0.84, Live: live(() => import('./live/word-grid')) },
};

/** Whether a game's preview draws live (true) or from a shot (false). */
export const drawsLive = (game: SkinGame) => Boolean(LIVE[game]);

export function stageAspect(game: SkinGame): number {
  return LIVE[game]?.aspect ?? skinShotAspect(game) ?? 1.6;
}

/** The shot for a skin item, or for the game's own look. */
export function shotFor(game: SkinGame, itemId: string | null): string | null {
  return skinShotSrc(itemId ?? houseShotId(game));
}

/** The screen's contents only; the caller draws the cabinet around it. */
export function InGameStage({
  game,
  skin,
  itemId,
  sizes,
}: {
  game: SkinGame;
  /** The skin to draw, or null for the game's own look. */
  skin: SkinSet | null;
  /** The skin's item id, for its shot; null for the game's own look. */
  itemId: string | null;
  sizes: string;
}) {
  const entry = LIVE[game];
  if (entry) {
    return (
      <div className='pp-live'>
        <entry.Live skin={skin} />
      </div>
    );
  }
  const shot = shotFor(game, itemId);
  if (shot) {
    return <Image src={shot} alt='' fill sizes={sizes} className='pp-shot' />;
  }
  /* No renderer and no shot: the card's own drawing. */
  return skin ? (
    <div className='pp-flat'>
      <SkinSetPreview skin={skin} />
    </div>
  ) : null;
}
