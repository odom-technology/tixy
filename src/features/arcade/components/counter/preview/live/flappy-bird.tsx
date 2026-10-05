'use client';

/* Flappy bird, drawn by the game's own sprite painter (_flappy-draw.ts): the
   flyer climbing through a gap between two pairs of posts over the pier. */

import { useMemo } from 'react';

import { createFlappySprites, drawBackdrop, drawBird, drawGround, drawPipePair, drawScore } from '@/app/(games)/flappy-bird/_flappy-draw';
import { FLAPPY_BIRD_X, FLAPPY_HEIGHT, FLAPPY_WIDTH } from '@/app/(games)/flappy-bird/_flappy-sim';
import { HOUSE_FLAPPY_LOOK, applyFlappySkinSet } from '@/app/(games)/flappy-bird/_flappy-theme';
import type { SkinSet } from '@/features/arcade/lib/skins/skin-set';

import { CanvasStill } from './canvas-still';
import type { LiveProps } from './types';

export default function FlappyLive({ skin }: LiveProps) {
  const look = useMemo(() => (skin ? applyFlappySkinSet(skin as SkinSet<'flappy-bird'>) : HOUSE_FLAPPY_LOOK), [skin]);
  return (
    <CanvasStill
      deps={[look]}
      draw={(ctx, width, height, dpr) => {
        const scale = Math.min(width / FLAPPY_WIDTH, height / FLAPPY_HEIGHT) * dpr;
        const sprites = createFlappySprites(look, scale);
        if (!sprites) return;
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        const scroll = 260;
        drawBackdrop(ctx, sprites, scroll);
        drawPipePair(ctx, sprites, -20, 230);
        drawPipePair(ctx, sprites, 250, 200);
        drawGround(ctx, sprites, scroll);
        drawBird(ctx, look, { x: FLAPPY_BIRD_X + 40, y: 300, rot: -0.28, scaleX: 1, scaleY: 1, wing: -0.7, spin: 3, dead: false });
        drawScore(ctx, look, 14, 0);
      }}
    />
  );
}
