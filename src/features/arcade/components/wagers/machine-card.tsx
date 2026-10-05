'use client';

/* The machines' playing card (21, video poker). Flat paper with one hard
   shadow: a big index (rank over suit) top left, which stays readable when
   the next card covers the right of it, and one big suit low right. An ace
   has one huge suit in the middle. Red suits are tixy red, black suits ink.
   The back is ink with a hard stripe and a stub in the middle. The card
   takes its width from --mc-w and sizes everything from it, so a game sets
   one variable. MACHINES_LOOK.md, "21". */

import type { CSSProperties } from 'react';

import { SuitPip, type PlayingCardSuit } from '@/features/arcade/components/ui/playing-card';

import './machine-card.css';

const SUIT_NAME: Record<PlayingCardSuit, string> = {
  0: 'spades',
  1: 'hearts',
  2: 'diamonds',
  3: 'clubs',
};

const RANK_NAME: Record<number, string> = { 1: 'ace', 11: 'jack', 12: 'queen', 13: 'king', 14: 'ace' };

/** A, 2 to 10, J, Q, K. Uppercase: playing cards are the one place for it. */
export function cardRank(rank: number): string {
  if (rank === 1 || rank === 14) return 'A';
  if (rank === 11) return 'J';
  if (rank === 12) return 'Q';
  if (rank === 13) return 'K';
  return String(rank);
}

/** "queen of hearts", for screen readers. */
export function cardName(rank: number, suit: PlayingCardSuit): string {
  return `${RANK_NAME[rank] ?? String(rank)} of ${SUIT_NAME[suit] ?? 'spades'}`;
}

export function MachineCardFace({
  rank,
  suit,
  className,
  style,
}: {
  rank: number;
  suit: PlayingCardSuit;
  className?: string;
  style?: CSSProperties;
}) {
  const ace = rank === 1 || rank === 14;
  const red = suit === 1 || suit === 2;
  return (
    <div
      className={['mc-card', 'mc-face', className].filter(Boolean).join(' ')}
      data-red={red || undefined}
      data-ace={ace || undefined}
      role='img'
      aria-label={cardName(rank, suit)}
      style={style}
    >
      <span className='mc-index' aria-hidden>
        <b>{cardRank(rank)}</b>
        <SuitPip suit={suit} className='mc-index-suit' />
      </span>
      <SuitPip suit={suit} className='mc-big' />
    </div>
  );
}

export function MachineCardBack({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div className={['mc-card', 'mc-back', className].filter(Boolean).join(' ')} style={style} aria-hidden>
      <svg className='mc-back-stub' viewBox='0 0 40 24' aria-hidden>
        {/* The stub: a rounded ticket with a half-circle notch on each short end. */}
        <path d='M4 0h32a4 4 0 0 1 4 4v4.5a3.5 3.5 0 0 0 0 7V20a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4v-4.5a3.5 3.5 0 0 0 0-7V4a4 4 0 0 1 4-4Z' />
      </svg>
    </div>
  );
}
