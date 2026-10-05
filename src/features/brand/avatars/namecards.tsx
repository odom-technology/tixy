/* Namecards: a paper card with one pattern. They replace profile
   backgrounds. 256 x 64 units, the card shown at 4:1. The app sets the name
   over it in Gabarito, in the card's text colour, so the pattern stays
   clear of the left two thirds or is quiet enough to read over. */

import { ART } from './palette';

export type NamecardId = 'awning' | 'lights' | 'planks' | 'bezel' | 'rail';

export const NAMECARD_WIDTH = 256;
export const NAMECARD_HEIGHT = 64;

const N = (count: number) => Array.from({ length: count }, (_, i) => i);

const CARDS: Record<NamecardId, { text: 'ink' | 'paper'; draw: () => React.ReactNode }> = {
  /* Blue and cream awning stripes with a scalloped edge, over paper 2. */
  awning: {
    text: 'ink',
    draw: () => (
      <>
        <rect width={256} height={64} fill={ART.paper2} />
        {N(8).map((i) => (
          <rect key={i} x={i * 32} width={32} height={16} fill={i % 2 ? ART.lit : ART.blue} />
        ))}
        {N(8).map((i) => (
          <path
            key={i}
            d={`M${i * 32},16 A16,12 0 0 0 ${i * 32 + 32},16 Z`}
            fill={i % 2 ? ART.lit : ART.blue}
          />
        ))}
      </>
    ),
  },
  /* A string of bulbs along the top. The season's namecard. */
  lights: {
    text: 'ink',
    draw: () => {
      const tones = [ART.amber, ART.red, ART.lit, ART.blue, ART.green, ART.brass];
      return (
        <>
          <rect width={256} height={64} fill={ART.paper2} />
          <path d='M0,6 Q16,20 32,6 T64,6 T96,6 T128,6 T160,6 T192,6 T224,6 T256,6' fill='none' stroke={ART.ink2} strokeWidth={1.6} />
          {N(8).map((i) => (
            <circle key={i} cx={16 + i * 32} cy={19} r={4.2} fill={tones[i % tones.length]} />
          ))}
        </>
      );
    },
  },
  /* Boardwalk planks, brass and darker brass, with nail heads. */
  planks: {
    text: 'ink',
    draw: () => (
      <>
        <rect width={256} height={64} fill={ART.brass} />
        {N(4).map((i) => (
          <rect key={i} y={i * 16} width={256} height={16} fill={i % 2 ? ART.brass : ART.brassDark} />
        ))}
        {N(4).map((i) => (
          <rect key={i} x={(i * 71 + 40) % 256} y={i * 16} width={2} height={16} fill={ART.ink2} />
        ))}
      </>
    ),
  },
  /* A cabinet's bezel: 5 units of ink around a paper screen, three buttons. */
  bezel: {
    text: 'ink',
    draw: () => (
      <>
        <rect width={256} height={64} rx={6} fill={ART.ink} />
        <rect x={5} y={5} width={246} height={54} rx={3} fill={ART.paper2} />
        <circle cx={208} cy={32} r={4.5} fill={ART.red} />
        <circle cx={223} cy={32} r={4.5} fill={ART.amber} />
        <circle cx={238} cy={32} r={4.5} fill={ART.blue} />
      </>
    ),
  },
  /* A pool rail around felt, with brass sights. The one place felt appears. */
  rail: {
    text: 'paper',
    draw: () => (
      <>
        <rect width={256} height={64} rx={8} fill={ART.rail} />
        <rect x={8} y={8} width={240} height={48} rx={3} fill={ART.felt} />
        {N(7).map((i) => (
          <path key={i} d={`M${14 + i * 38},1.5 l2.5,2.5 l-2.5,2.5 l-2.5,-2.5 Z`} fill={ART.brass} />
        ))}
        {N(7).map((i) => (
          <path key={i} d={`M${14 + i * 38},57.5 l2.5,2.5 l-2.5,2.5 l-2.5,-2.5 Z`} fill={ART.brass} />
        ))}
      </>
    ),
  },
};

export const namecardText = (id: NamecardId) => CARDS[id].text;

export function NamecardArt({ id }: { id: NamecardId }) {
  return <>{CARDS[id].draw()}</>;
}

export function Namecard({ id, width = NAMECARD_WIDTH, className }: { id: NamecardId; width?: number; className?: string }) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      viewBox={`0 0 ${NAMECARD_WIDTH} ${NAMECARD_HEIGHT}`}
      width={width}
      height={(width * NAMECARD_HEIGHT) / NAMECARD_WIDTH}
      className={className}
      aria-hidden
      focusable='false'
    >
      <NamecardArt id={id} />
    </svg>
  );
}
