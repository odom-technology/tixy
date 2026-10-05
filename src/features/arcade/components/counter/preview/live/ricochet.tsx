'use client';

/* Ricochet, drawn by the game's own frame painter (_ricochet-draw.ts): the
   bird mid-flight between the two toothed walls, the score above it. */

import { useMemo } from 'react';

import { buildStaticLayer, drawRicochet, freshFx, type RicochetView } from '@/app/(games)/ricochet/_ricochet-draw';
import { HOUSE_LOOK, applyRicochetSkinSet } from '@/app/(games)/ricochet/_ricochet-theme';
import type { SkinSet } from '@/features/arcade/lib/skins/skin-set';
import { RICOCHET_BASE_HEIGHT, RICOCHET_BASE_WIDTH } from '@/server/arcade/ricochet-replay';

import { CanvasStill } from './canvas-still';
import type { LiveProps } from './types';

const VIEW: RicochetView = {
  x: RICOCHET_BASE_WIDTH * 0.62,
  y: RICOCHET_BASE_HEIGHT * 0.44,
  vy: -2.5,
  dir: 1,
  wall: 6,
  score: 12,
  phase: 'playing',
  seed: 20261004,
};

export default function RicochetLive({ skin }: LiveProps) {
  const look = useMemo(() => (skin ? applyRicochetSkinSet(skin as SkinSet<'ricochet'>) : HOUSE_LOOK), [skin]);
  return (
    <CanvasStill
      deps={[look]}
      draw={(ctx, width, height, dpr) => {
        const scale = Math.min(width / RICOCHET_BASE_WIDTH, height / RICOCHET_BASE_HEIGHT) * dpr;
        const root = getComputedStyle(document.documentElement);
        const fonts = {
          num: root.getPropertyValue('--tixy-font-num').trim() || "'Big Shoulders', sans-serif",
          text: root.getPropertyValue('--tixy-font-text').trim() || "'Gabarito', sans-serif",
        };
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        const fx = { ...freshFx(), reduced: true, tilt: -0.2 };
        drawRicochet(ctx, VIEW, look, fx, { layer: buildStaticLayer(look, scale), fonts });
      }}
    />
  );
}
