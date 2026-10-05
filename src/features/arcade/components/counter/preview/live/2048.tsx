'use client';

/* 2048, on the game's own board (_2048-board.tsx) mid-run: tiles from 2 up
   to 512, so every step of the skin's tile colours shows. */

import { useMemo } from 'react';

import { GAME_2048_CSS, Game2048Board } from '@/app/(games)/2048/_2048-board';
import { DEFAULT_2048_THEME, applyGame2048SkinSet } from '@/app/(games)/2048/_2048-theme';
import type { Tile } from '@/app/(games)/2048/_2048-types';
import type { SkinSet } from '@/features/arcade/lib/skins/skin-set';

import type { LiveProps } from './types';

const VALUES = [
  [2, 0, 4, 2],
  [8, 16, 0, 4],
  [32, 64, 128, 8],
  [512, 256, 64, 16],
];
const TILES: Tile[] = VALUES.flatMap((row, r) =>
  row.flatMap((value, c) => (value ? [{ id: r * 4 + c + 1, value, row: r, col: c }] : [])),
);

export default function Game2048Live({ skin }: LiveProps) {
  const theme = useMemo(
    () => (skin ? applyGame2048SkinSet(skin as SkinSet<'2048'>) : DEFAULT_2048_THEME),
    [skin],
  );
  return (
    <div className='pp-fill'>
      <style>{GAME_2048_CSS}</style>
      <Game2048Board theme={theme} tiles={TILES} />
    </div>
  );
}
