'use client';

/* Chess, on the game's own board (_chess-board.tsx) four moves into an
   Italian game, the last move marked. */

import { useMemo } from 'react';

import { ChessBoard } from '@/app/(games)/chess/_chess-board';
import { chessSkinLook } from '@/app/(games)/chess/_chess-skin';
import {
  MIDWAY_CHESS_BOARD_THEME,
  MIDWAY_CHESS_PIECES_THEME,
  MIDWAY_PIECE_STROKE,
} from '@/app/(games)/chess/_midway-theme';
import type { SkinSet } from '@/features/arcade/lib/skins/skin-set';

import type { LiveProps } from './types';

const FEN = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R b KQkq - 0 5';
const noop = () => {};

export default function ChessLive({ skin }: LiveProps) {
  const look = useMemo(() => (skin ? chessSkinLook(skin as SkinSet<'chess'>) : null), [skin]);
  return (
    <div className='pp-chess'>
      <ChessBoard
        fen={FEN}
        orientation='white'
        myColor={null}
        isMyTurn={false}
        lastMoveUci='d2d3'
        onMove={noop}
        interactive={false}
        boardTheme={look?.board ?? MIDWAY_CHESS_BOARD_THEME}
        piecesTheme={look?.pieces ?? MIDWAY_CHESS_PIECES_THEME}
        pieceStrokeWhite={look?.strokeWhite ?? MIDWAY_PIECE_STROKE.white}
        pieceStrokeBlack={look?.strokeBlack ?? MIDWAY_PIECE_STROKE.black}
        skin={look}
      />
    </div>
  );
}
