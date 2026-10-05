'use client';

import type { CSSProperties, ReactNode } from 'react';

/**
 * Shared playing-card primitives for the card games (Hi-Lo, 21).
 *
 * Faces render crisp SVG suit pips (no text glyphs), classic pip layouts for
 * number cards at the large sizes, and a monogram panel for court cards.
 * Backs render a diamond-lattice pattern with a center suit medallion,
 * themed per game. Game state stays server-driven — these are visuals only.
 *
 * Sizing is fluid: each size sets one width (a `clamp()` in `--pcw`); the card
 * font-size is derived from that width and every interior metric is expressed
 * in `em`, so a card scales as one unit across breakpoints — small on phones,
 * big and immersive on desktop — with no per-element media queries.
 */

export type PlayingCardSuit = 0 | 1 | 2 | 3; // spades, hearts, diamonds, clubs
export type PlayingCardSize = 'sm' | 'md' | 'lg' | 'xl';
export type PlayingCardBackTheme = 'fuchsia' | 'emerald';

/* Cards are physical paper: classic red/black ink that stays constant across
   every theme (the red tokens are themed per scheme, so they can't drive
   card pips). */
const SUIT_COLOR: Record<PlayingCardSuit, string> = {
  0: 'text-[#1c1712]',
  1: 'text-[#c0322f]',
  2: 'text-[#c0322f]',
  3: 'text-[#1c1712]',
};

const SUIT_NAME: Record<PlayingCardSuit, string> = {
  0: 'spades',
  1: 'hearts',
  2: 'diamonds',
  3: 'clubs',
};

/* Fluid card width per size. min ≈ phone, max ≈ desktop; the vw term scales
   between. Everything else on the card derives from this single value. */
const SIZE_WIDTH: Record<PlayingCardSize, string> = {
  sm: 'clamp(4.5rem, 11vw, 5.75rem)',
  md: 'clamp(5.5rem, 14vw, 7.5rem)',
  lg: 'clamp(7rem, 17vw, 9.5rem)',
  xl: 'clamp(8rem, 23vw, 12.5rem)',
};

/* Pip grids (classic number-card layouts) only read well on the larger cards;
   smaller cards show a single center pip instead. */
const PIP_GRID_SIZES = new Set<PlayingCardSize>(['lg', 'xl']);

/** The aspect ratio + font scale that turns one width into a whole card. */
function cardRootStyle(size: PlayingCardSize, extra?: CSSProperties): CSSProperties {
  return {
    '--pcw': SIZE_WIDTH[size],
    width: 'var(--pcw)',
    aspectRatio: '5 / 7',
    fontSize: 'calc(var(--pcw) * 0.16)',
    ...extra,
  } as CSSProperties;
}

/** Crisp inline suit pip. Sized by className, colored via currentColor. */
export function SuitPip({ suit, className = '' }: { suit: PlayingCardSuit; className?: string }) {
  return (
    <svg viewBox='0 0 24 24' fill='currentColor' className={className} aria-hidden>
      {suit === 0 && (
        <path d='M12 2C9.2 6.7 4 9.4 4 13.3 4 15.9 6 18 8.5 18c1 0 2-.36 2.74-1-.32 1.7-1.06 3.1-2.24 4h6c-1.18-.9-1.92-2.3-2.24-4 .75.64 1.73 1 2.74 1 2.5 0 4.5-2.1 4.5-4.7 0-3.9-5.2-6.6-8-11.3Z' />
      )}
      {suit === 1 && (
        <path d='M12 21.1 10.55 19.8C5.4 15.1 2 12 2 8.3 2 5.3 4.42 3 7.4 3c1.74 0 3.41.8 4.6 2.1C13.19 3.8 14.86 3 16.6 3 19.58 3 22 5.3 22 8.3c0 3.7-3.4 6.8-8.55 11.5L12 21.1Z' />
      )}
      {suit === 2 && (
        <path d='M12 1.8c1.62 3.3 4 6.9 6.9 10.2-2.9 3.3-5.28 6.9-6.9 10.2-1.62-3.3-4-6.9-6.9-10.2C8 8.7 10.38 5.1 12 1.8Z' />
      )}
      {suit === 3 && (
        <>
          <circle cx='12' cy='6.6' r='4.1' />
          <circle cx='6.8' cy='13.4' r='4.1' />
          <circle cx='17.2' cy='13.4' r='4.1' />
          <path d='M12 11c-.2 4-.9 7.4-2.6 9.6h5.2C12.9 18.4 12.2 15 12 11Z' />
        </>
      )}
    </svg>
  );
}

/** 1 or 14 reads as ace; 11/12/13 are court cards; 2-10 are pip cards. */
function rankLabel(rank: number): string {
  if (rank === 1 || rank === 14) return 'A';
  if (rank === 11) return 'J';
  if (rank === 12) return 'Q';
  if (rank === 13) return 'K';
  return String(rank);
}

/**
 * Classic pip positions for number cards, as [x%, y%, flipped] inside the
 * pip field. Bottom-half pips render upside down like a real card.
 */
const PIP_LAYOUTS: Record<number, ReadonlyArray<readonly [number, number, boolean]>> = {
  2: [[50, 10, false], [50, 90, true]],
  3: [[50, 10, false], [50, 50, false], [50, 90, true]],
  4: [[18, 10, false], [82, 10, false], [18, 90, true], [82, 90, true]],
  5: [[18, 10, false], [82, 10, false], [50, 50, false], [18, 90, true], [82, 90, true]],
  6: [[18, 10, false], [82, 10, false], [18, 50, false], [82, 50, false], [18, 90, true], [82, 90, true]],
  7: [[18, 10, false], [82, 10, false], [50, 30, false], [18, 50, false], [82, 50, false], [18, 90, true], [82, 90, true]],
  8: [[18, 10, false], [82, 10, false], [50, 30, false], [18, 50, false], [82, 50, false], [50, 70, true], [18, 90, true], [82, 90, true]],
  9: [[18, 8, false], [82, 8, false], [18, 36, false], [82, 36, false], [50, 50, false], [18, 64, true], [82, 64, true], [18, 92, true], [82, 92, true]],
  10: [[18, 8, false], [82, 8, false], [50, 22, false], [18, 36, false], [82, 36, false], [18, 64, true], [82, 64, true], [50, 78, true], [18, 92, true], [82, 92, true]],
};

export function PlayingCardFace({
  rank,
  suit,
  size = 'lg',
  dealIn = false,
  dealInMs = 480,
  className = '',
  style,
}: {
  rank: number;
  suit: PlayingCardSuit;
  size?: PlayingCardSize;
  /** Play the slide-and-flip deal animation on mount. */
  dealIn?: boolean;
  dealInMs?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const color = SUIT_COLOR[suit] ?? SUIT_COLOR[0];
  const label = rankLabel(rank);
  const isAce = rank === 1 || rank === 14;
  const isCourt = rank >= 11 && rank <= 13;
  const pips = !isAce && !isCourt ? PIP_LAYOUTS[rank] : undefined;
  const showPipGrid = PIP_GRID_SIZES.has(size) && pips !== undefined;

  return (
    <div
      className={`arc-card-face relative rounded-[0.62em] bg-[linear-gradient(135deg,var(--key-face-hi),var(--key-face))] ring-1 ring-[var(--key-face-edge)] ${className}`}
      role='img'
      aria-label={`${label} of ${SUIT_NAME[suit] ?? 'spades'}`}
      style={cardRootStyle(size, {
        transformStyle: 'preserve-3d',
        boxShadow: '0 0.28em 0 var(--shadow-color), 0 0.45em 0.9em #00000055',
        animation: dealIn ? `pcDealIn ${dealInMs}ms var(--ease-spring)` : undefined,
        ...style,
      })}
    >
      {/* Paper grain */}
      <div
        className='pointer-events-none absolute inset-0 rounded-[0.62em] opacity-50'
        style={{
          backgroundImage:
            'repeating-linear-gradient(105deg, rgba(40,28,12,0.05) 0 1px, transparent 1px 3px)',
        }}
      />
      {/* Decorative frame */}
      <div className='absolute inset-[0.28em] rounded-[0.45em] border border-ink/40' />

      {/* Corner indices */}
      <div className={`absolute left-[0.42em] top-[0.38em] flex flex-col items-center leading-none ${color}`}>
        <span className='text-[1em] font-black'>{label}</span>
        <SuitPip suit={suit} className='mt-[0.08em] h-[0.72em] w-[0.72em]' />
      </div>
      <div className={`absolute bottom-[0.38em] right-[0.42em] flex rotate-180 flex-col items-center leading-none ${color}`}>
        <span className='text-[1em] font-black'>{label}</span>
        <SuitPip suit={suit} className='mt-[0.08em] h-[0.72em] w-[0.72em]' />
      </div>

      {/* Center: pip grid (large number cards), court monogram, or big pip */}
      {showPipGrid && pips ? (
        <div className='absolute inset-x-[27%] inset-y-[16%]'>
          {pips.map(([px, py, flipped], i) => (
            <div
              key={i}
              className='absolute -translate-x-1/2 -translate-y-1/2'
              style={{ left: `${px}%`, top: `${py}%` }}
            >
              <SuitPip
                suit={suit}
                className={`h-[1em] w-[1em] drop-shadow-sm ${color} ${flipped ? 'rotate-180' : ''}`}
              />
            </div>
          ))}
        </div>
      ) : isCourt ? (
        <div className='absolute inset-0 flex items-center justify-center'>
          <div className={`relative flex flex-col items-center rounded-[0.45em] border border-current/40 px-[0.55em] py-[0.28em] ${color}`}>
            <div className='absolute inset-[0.1em] rounded-[0.32em] border border-current/25' />
            <SuitPip suit={suit} className='h-[0.78em] w-[0.78em] self-start' />
            <span className='text-[2.35em] font-serif font-bold leading-none drop-shadow-sm'>
              {label}
            </span>
            <SuitPip suit={suit} className='h-[0.78em] w-[0.78em] rotate-180 self-end' />
          </div>
        </div>
      ) : (
        <div className='absolute inset-0 flex items-center justify-center'>
          <SuitPip
            suit={suit}
            className={`${isAce ? 'h-[3.5em] w-[3.5em]' : 'h-[3.05em] w-[3.05em]'} drop-shadow-sm ${color}`}
          />
        </div>
      )}

      <style jsx global>{`
        @keyframes pcDealIn {
          0% {
            transform: translate(-120px, 0) rotateY(180deg) scale(0.9);
            opacity: 0;
          }
          60% {
            opacity: 1;
          }
          100% {
            transform: translate(0, 0) rotateY(0deg) scale(1);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}

const BACK_THEMES: Record<PlayingCardBackTheme, {
  border: string;
  gradient: string;
  innerBorder: string;
  lattice: string;
  medallion: string;
  medallionSuit: PlayingCardSuit;
}> = {
  /* Wood-cabinet backs: lacquered espresso stock with an enamel lattice +
     medallion. 'fuchsia' → amber/red house deck, 'emerald' → teal house deck.
     Keys kept so callers (21, Hi-Lo) are unchanged. */
  fuchsia: {
    border: 'border-[#3c2c1a]',
    gradient: 'bg-[linear-gradient(135deg,#2c2013,#1f1710_55%,#16100a)]',
    innerBorder: 'border-[#5a3e20]',
    lattice: 'rgba(242, 163, 60, 0.16)',
    medallion: 'border-[#c47c1f] text-[#f2a33c]',
    medallionSuit: 2,
  },
  emerald: {
    border: 'border-[#1c3a36]',
    gradient: 'bg-[linear-gradient(135deg,#15241f,#101a17_55%,#0c1512)]',
    innerBorder: 'border-[#1d8579]',
    lattice: 'rgba(47, 184, 166, 0.16)',
    medallion: 'border-[#1d8579] text-[#2fb8a6]',
    medallionSuit: 0,
  },
};

export function PlayingCardBack({
  theme = 'fuchsia',
  size = 'lg',
  className = '',
  style,
}: {
  theme?: PlayingCardBackTheme;
  size?: PlayingCardSize;
  className?: string;
  style?: CSSProperties;
}) {
  const t = BACK_THEMES[theme];
  return (
    <div
      className={`relative overflow-hidden rounded-[0.62em] border ${t.border} ${t.gradient} shadow-lg ${className}`}
      style={cardRootStyle(size, style)}
      aria-hidden
    >
      {/* Diamond lattice */}
      <div
        className='absolute inset-[0.2em]'
        style={{
          backgroundImage: `repeating-linear-gradient(45deg, ${t.lattice} 0 1px, transparent 1px 8px), repeating-linear-gradient(-45deg, ${t.lattice} 0 1px, transparent 1px 8px)`,
        }}
      />
      <div className={`absolute inset-[0.28em] rounded-[0.45em] border ${t.innerBorder}`} />
      {/* Center medallion */}
      <div className='absolute inset-0 flex items-center justify-center'>
        <div className={`flex items-center justify-center rounded-full border-[0.12em] ${t.medallion} bg-black/25 shadow-inner`} style={{ width: '2.7em', height: '2.7em' }}>
          <SuitPip suit={t.medallionSuit} className='h-[1.35em] w-[1.35em]' />
        </div>
      </div>
    </div>
  );
}

/** Stack of three card backs used as the idle deck. Each back is wrapped in an
    absolutely-positioned layer so the stack overlaps (the back's own `relative`
    base class would otherwise win and stack the cards in-flow). */
export function PlayingCardDeck({
  theme,
  size = 'lg',
}: {
  theme: PlayingCardBackTheme;
  size?: PlayingCardSize;
}) {
  return (
    <div className='relative' style={cardRootStyle(size)}>
      {[0.4, 0.2, 0].map((offset) => (
        <div
          key={offset}
          className='absolute left-0 top-0'
          style={{ transform: `translate(${offset}em, ${-offset}em)` }}
        >
          <PlayingCardBack theme={theme} size={size} />
        </div>
      ))}
    </div>
  );
}

/**
 * Two-sided card that flips from back to front when `revealed` turns true
 * (the dealer hole-card reveal in 21).
 */
export function PlayingCardFlip({
  revealed,
  front,
  back,
  size = 'lg',
  className = '',
}: {
  revealed: boolean;
  front: ReactNode;
  back: ReactNode;
  size?: PlayingCardSize;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`} style={cardRootStyle(size, { perspective: '900px' })}>
      <div
        className='relative h-full w-full'
        style={{
          transformStyle: 'preserve-3d',
          transform: revealed ? 'rotateY(0deg)' : 'rotateY(180deg)',
          transition: 'transform calc(var(--motion-reveal) * 1.5) var(--ease-spring)',
        }}
      >
        <div className='absolute inset-0' style={{ backfaceVisibility: 'hidden' }}>
          {front}
        </div>
        <div className='absolute inset-0' style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
          {back}
        </div>
      </div>
    </div>
  );
}
