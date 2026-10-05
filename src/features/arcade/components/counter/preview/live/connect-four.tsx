'use client';

/* Connect four, on the game's own rack (_board.tsx) halfway through a game:
   your chips and theirs in the bottom rows. */

import { useMemo } from 'react';

import { ConnectFourBoard } from '@/app/(games)/connect-four/_board';
import { DEFAULT_CONNECT_FOUR_THEME, applyConnectFourSkinSet } from '@/app/(games)/connect-four/_connect-four-theme';
import type { SkinSet } from '@/features/arcade/lib/skins/skin-set';

import type { LiveProps } from './types';

/* Six rows of seven, top row first: '.' empty, '1' red (you), '2' yellow. */
const BOARD = [
  '.......',
  '.......',
  '...2...',
  '..112..',
  '..2121.',
  '.12212.',
].join('');
const noop = () => {};

export default function ConnectFourLive({ skin }: LiveProps) {
  const theme = useMemo(
    () => (skin ? applyConnectFourSkinSet(skin as SkinSet<'connect-four'>) : DEFAULT_CONNECT_FOUR_THEME),
    [skin],
  );
  return (
    <div className='pp-c4'>
      <ConnectFourBoard board={BOARD} myColor={null} isMyTurn={false} lastMove={4} onMove={noop} interactive={false} theme={theme} />
    </div>
  );
}
