'use client';

/* 8-ball, on the game's own table (_pool-canvas.tsx): the rack set for the
   break with the cue behind the white, as the lobby draws it. The skin is
   mapped onto the table the same way the match page maps it. */

import { useEffect, useMemo, useRef, useState } from 'react';

import { DEFAULT_POOL_THEME, PoolCanvas, type PoolCosmeticTheme } from '@/app/(games)/8-ball/[id]/_pool-canvas';
import { createBreakRack } from '@/features/arcade/lib/pool-physics';
import type { SkinSet } from '@/features/arcade/lib/skins/skin-set';

import type { LiveProps } from './types';

function poolTheme(skin: SkinSet<'8-ball'> | null): PoolCosmeticTheme {
  if (!skin) return DEFAULT_POOL_THEME;
  const p = skin.palette;
  const suits = [p.ball1, p.ball2, p.ball3, p.ball4, p.ball5, p.ball6, p.ball7];
  const ballColors: Record<number, string> = {};
  suits.forEach((colour, i) => {
    if (colour) {
      ballColors[i + 1] = colour;
      ballColors[i + 9] = colour;
    }
  });
  return {
    feltColor: p.felt,
    feltDark: p.feltDark,
    railColor: p.rail,
    railBorder: p.railEdge,
    pocketColor: p.pocket,
    cueColor: p.cue,
    cueTipColor: p.cueTip,
    cueGlow: false,
    cueGlowColor: DEFAULT_POOL_THEME.cueGlowColor,
    ...(Object.keys(ballColors).length > 0 ? { ballColors } : {}),
    skin: { material: skin.material, finish: skin.shape, sight: p.sight, railEdge: p.railEdge },
  };
}

export default function PoolLive({ skin }: LiveProps) {
  const theme = useMemo(() => poolTheme(skin as SkinSet<'8-ball'> | null), [skin]);
  const rack = useMemo(() => createBreakRack(), []);
  const cue = useMemo(() => {
    const white = rack.find((ball) => ball.id === 0);
    return white ? { angle: 0, power: 0.35, cuePos: white.pos } : null;
  }, [rack]);
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 2 && rect.height > 2) {
        setBox((prev) =>
          prev && prev.width === Math.floor(rect.width) && prev.height === Math.floor(rect.height)
            ? prev
            : { width: Math.floor(rect.width), height: Math.floor(rect.height) },
        );
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={boxRef} className='pp-pool'>
      {box ? <PoolCanvas balls={rack} theme={theme} cueStick={cue} fitBox={box} canvasClassName='block' /> : null}
    </div>
  );
}
