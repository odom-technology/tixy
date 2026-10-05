/* Chess: a middlegame on the whole board. The knight hops its L, lands, and
   the move's two squares light. */
import { C, EASE, Part, PreviewScreen, move, type PreviewProps } from './kit';

const SQ = 11.7;
const X0 = 33.2;
const Y0 = 3.2;
/* The board's own colours (chess/_midway-theme.ts): paper and a step darker. */
const LIGHT = '#F4EBDC';
const DARK = '#CDBD9F';
const at = (file: number, rank: number) => ({ x: X0 + file * SQ, y: Y0 + rank * SQ });
// Ranks count from the top: 0 is black's back rank.
const FROM = at(2, 5);
const TO = at(4, 4);

// Silhouettes on a 45 x 45 grid. The knight is from _piece-svg.tsx.
const SHAPE = {
  knight:
    'M 22,10 C 32.5,11 38.5,18 38,39 L 15,39 C 15,30 25,32.5 23,18 M 24,18 C 24.38,20.91 18.45,25.37 16,27 C 13,29 13.18,31.34 11,31 C 9.958,30.06 12.41,27.96 11,28 C 10,28 11.19,29.23 10,30 C 9,30 5.997,31 6,26 C 6,24 12,14 12,14 C 12,14 13.89,12.1 14,10.5 C 13.27,9.506 13.5,8.5 13.5,7.5 C 14.5,5.5 16.5,4 16.5,4 C 16.5,4 18.55,2.454 19,2.5 C 20,2.5 19.08,5.25 19,5 C 19,5 24,3 25,5 C 25,5 21.5,7 23,10',
  king: 'M11 39 H34 L32 32 H13 Z M14 31 C11 23 15 17 22.5 16 C30 17 34 23 31 31 Z M20.5 3 h4 v4 h4 v4 h-4 v4 h-4 v-4 h-4 v-4 h4 z',
  rook: 'M11 39 H34 V33 H11 Z M14 33 L15.5 17 H29.5 L31 33 Z M11 17 V6 H16.5 V10 H20 V6 H25 V10 H28.5 V6 H34 V17 Z',
  bishop:
    'M11 39 H34 V34 H11 Z M15 34 C14 26 19 22 22.5 18 C26 22 31 26 30 34 Z M22.5 4 C27 8 28 14 22.5 18 C17 14 18 8 22.5 4 Z',
  pawn: 'M12 39 H33 V34 H12 Z M16 34 C16 26 19 23 22.5 22 C26 23 29 26 29 34 Z M16.5 15 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0 Z',
} as const;
type Kind = keyof typeof SHAPE;

type Placed = { kind: Kind; file: number; rank: number; white: boolean };
const BLACK: Placed[] = [
  { kind: 'rook', file: 0, rank: 0, white: false },
  { kind: 'bishop', file: 2, rank: 0, white: false },
  { kind: 'rook', file: 5, rank: 0, white: false },
  { kind: 'king', file: 6, rank: 0, white: false },
  { kind: 'pawn', file: 0, rank: 1, white: false },
  { kind: 'pawn', file: 1, rank: 1, white: false },
  { kind: 'pawn', file: 5, rank: 1, white: false },
  { kind: 'pawn', file: 6, rank: 1, white: false },
  { kind: 'pawn', file: 7, rank: 1, white: false },
  { kind: 'pawn', file: 3, rank: 3, white: false },
];
const WHITE: Placed[] = [
  { kind: 'pawn', file: 0, rank: 6, white: true },
  { kind: 'pawn', file: 1, rank: 6, white: true },
  { kind: 'pawn', file: 5, rank: 6, white: true },
  { kind: 'pawn', file: 6, rank: 6, white: true },
  { kind: 'pawn', file: 7, rank: 6, white: true },
  { kind: 'rook', file: 0, rank: 7, white: true },
  { kind: 'rook', file: 5, rank: 7, white: true },
  { kind: 'king', file: 6, rank: 7, white: true },
  { kind: 'bishop', file: 3, rank: 5, white: true },
];

function Piece({ kind, x, y, white }: { kind: Kind; x: number; y: number; white: boolean }) {
  // x, y: the square's top left. The piece stands on the square's bottom edge.
  const scale = (SQ * 1.32) / 45;
  return (
    <g transform={`translate(${x + SQ / 2 - 22.5 * scale} ${y + SQ - 38 * scale}) scale(${scale})`}>
      <path
        d={SHAPE[kind]}
        fill={white ? '#FBF6EC' : C.ink}
        stroke={white ? C.ink : C.paper}
        strokeWidth={white ? 2.6 : 2}
        strokeLinejoin='round'
      />
    </g>
  );
}

export default function ChessPreview({ still }: PreviewProps) {
  return (
    <PreviewScreen still={still} rest={900}>
      <rect x={X0 - 2} y={Y0 - 2} width={SQ * 8 + 4} height={SQ * 8 + 4} rx='2' fill={C.ink} />
      {Array.from({ length: 64 }, (_, i) => {
        const f = i % 8;
        const r = Math.floor(i / 8);
        return <rect key={i} x={X0 + f * SQ} y={Y0 + r * SQ} width={SQ} height={SQ} fill={(f + r) % 2 ? DARK : LIGHT} />;
      })}
      {[FROM, TO].map((sq, i) => (
        <Part key={i} style={move('on', 160, { delay: 560 })}>
          <rect x={sq.x} y={sq.y} width={SQ} height={SQ} fill={C.amber} fillOpacity='0.45' />
        </Part>
      ))}
      {[...BLACK, ...WHITE].map((p) => {
        const sq = at(p.file, p.rank);
        return <Piece key={`${p.file}-${p.rank}`} kind={p.kind} x={sq.x} y={sq.y} white={p.white} />;
      })}
      <Part style={move('hop', 480, { delay: 80, x: TO.x - FROM.x, y: TO.y - FROM.y, lift: 12, ease: EASE.out })}>
        <Part style={move('thunk', 220, { delay: 560 })}>
          <Piece kind='knight' x={FROM.x} y={FROM.y} white />
        </Part>
      </Part>
    </PreviewScreen>
  );
}
