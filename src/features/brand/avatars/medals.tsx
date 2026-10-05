/* Medals: a paper 2 disc, an ink ring and one glyph from the floor. Badges
   and achievement medals share it. A medal carries no words and no digits: an
   achievement's tier is a number the app sets in Big Shoulders over the
   lower half of the disc. */

import { MARK_FACE, STUB_PATH } from '../tixy-brand-geometry';
import { ART } from './palette';
import { AVATAR_SIZE } from './stub-avatar';

export type MedalId =
  | 'ticket'
  | 'eight-ball'
  | 'target'
  | 'bell'
  | 'claw'
  | 'pawn'
  | 'drop'
  | 'cabinet'
  | 'crown'
  | 'season-1'
  | 'board-first';

/* Medals with a ring of their own, drawn around another medal's glyph or their own. */
type RingedMedal = 'season-1' | 'board-first';

export const MEDAL_GLYPHS: Record<Exclude<MedalId, RingedMedal>, () => React.ReactNode> = {
  /* The stub, with its face. */
  ticket: () => (
    <g transform='translate(48 48) scale(0.42) translate(-60 -36)'>
      <path d={STUB_PATH} fill={ART.amber} />
      <circle cx={MARK_FACE.eyes[0][0]} cy={MARK_FACE.eyes[0][1]} r={5} fill={ART.ink} />
      <circle cx={MARK_FACE.eyes[1][0]} cy={MARK_FACE.eyes[1][1]} r={5} fill={ART.ink} />
      <path d={MARK_FACE.smile} fill='none' stroke={ART.ink} strokeWidth={5.5} strokeLinecap='round' />
    </g>
  ),
  'eight-ball': () => (
    <>
      <circle cx={48} cy={48} r={19} fill={ART.ink} />
      <circle cx={48} cy={43} r={9} fill={ART.paper} />
      <g fill='none' stroke={ART.ink} strokeWidth={1.8}>
        <circle cx={48} cy={40.5} r={2.4} />
        <circle cx={48} cy={46} r={3} />
      </g>
    </>
  ),
  target: () => (
    <>
      <circle cx={48} cy={48} r={20} fill={ART.blue} />
      <circle cx={48} cy={48} r={13} fill={ART.lit} />
      <circle cx={48} cy={48} r={6} fill={ART.red} />
    </>
  ),
  bell: () => (
    <>
      <path d='M30,62 Q31,35 48,33 Q65,35 66,62 Z' fill={ART.amber} />
      <rect x={28} y={60} width={40} height={5} rx={2.5} fill={ART.amberDark} />
      <circle cx={48} cy={30} r={3.5} fill={ART.ink} />
      <circle cx={48} cy={69} r={4} fill={ART.ink} />
    </>
  ),
  claw: () => (
    <>
      <path d='M48,22 V38' stroke={ART.ink} strokeWidth={3} strokeLinecap='round' />
      <circle cx={48} cy={40} r={6} fill={ART.brass} />
      <path d='M44,44 Q30,46 32,62 M52,44 Q66,46 64,62 M48,46 V64' fill='none' stroke={ART.ink} strokeWidth={4} strokeLinecap='round' />
    </>
  ),
  pawn: () => (
    <>
      <circle cx={48} cy={34} r={7.5} fill={ART.ink} />
      <path d='M48,40 C40,46 41,55 36,62 H60 C55,55 56,46 48,40 Z' fill={ART.ink} />
      <rect x={32} y={61} width={32} height={7} rx={3.5} fill={ART.ink} />
    </>
  ),
  drop: () => (
    <>
      <circle cx={48} cy={28} r={6} fill={ART.red} />
      {[[48, 43], [40, 52], [56, 52], [32, 61], [48, 61], [64, 61]].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={3.2} fill={ART.ink} />
      ))}
    </>
  ),
  cabinet: () => (
    <>
      <rect x={33} y={24} width={30} height={46} rx={4} fill={ART.ink} />
      <rect x={36} y={27} width={24} height={6} rx={1.5} fill={ART.red} />
      <rect x={36} y={36} width={24} height={15} rx={2} fill={ART.amber} />
      <rect x={33} y={55} width={30} height={5} fill={ART.screen2} />
    </>
  ),
  crown: () => (
    <>
      <path d='M29,64 V36 L39,45 L48,30 L57,45 L67,36 V64 Z' fill={ART.amber} />
      <path d='M32,57 H64' stroke={ART.ink} strokeWidth={2.4} strokeDasharray='3 3.5' />
    </>
  ),
};

/* First place on a weekly board: a cup, in a solid red ring. */
function BoardCup() {
  return (
    <>
      <path d='M35,33 Q26,33 27,41 Q28,47 36,48' fill='none' stroke={ART.amberDark} strokeWidth={4} strokeLinecap='round' />
      <path d='M61,33 Q70,33 69,41 Q68,47 60,48' fill='none' stroke={ART.amberDark} strokeWidth={4} strokeLinecap='round' />
      <path d='M34,27 H62 V40 Q62,54 48,56 Q34,54 34,40 Z' fill={ART.amber} />
      <path d='M40,31 V40' stroke={ART.lit} strokeWidth={3} strokeLinecap='round' />
      <rect x={45} y={55} width={6} height={7} fill={ART.amberDark} />
      <rect x={36} y={61} width={24} height={7} rx={2.5} fill={ART.ink} />
    </>
  );
}

export function MedalArt({ id }: { id: MedalId }) {
  return (
    <>
      <circle cx={48} cy={48} r={44} fill={ART.ink} />
      <circle cx={48} cy={48} r={38} fill={ART.paper2} />
      {id === 'season-1' ? (
        <circle cx={48} cy={48} r={41} fill='none' stroke={ART.amber} strokeWidth={2} strokeDasharray='4 3.6' />
      ) : null}
      {id === 'board-first' ? <circle cx={48} cy={48} r={41} fill='none' stroke={ART.red} strokeWidth={2.4} /> : null}
      {id === 'board-first' ? <BoardCup /> : MEDAL_GLYPHS[id === 'season-1' ? 'ticket' : id]()}
    </>
  );
}

export function Medal({ id, size = AVATAR_SIZE, className }: { id: MedalId; size?: number; className?: string }) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      viewBox={`0 0 ${AVATAR_SIZE} ${AVATAR_SIZE}`}
      width={size}
      height={size}
      className={className}
      aria-hidden
      focusable='false'
    >
      <MedalArt id={id} />
    </svg>
  );
}
