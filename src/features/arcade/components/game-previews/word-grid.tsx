/* Word grid: the game's 5 x 6 board (word-grid/_word-grid-midway.css). A
   hit is green with a white dot, a near letter is yellow with a ring, a miss
   goes grey; empty tiles are rings. The move: the third guess flips tile by
   tile, all five land green, and the row bounces. */
import { C, Part, PreviewScreen, Word, move, type PreviewProps } from './kit';

type Mark = 'hit' | 'near' | 'miss';
const ROWS: { word: string; marks: Mark[] }[] = [
  { word: 'TIXYS', marks: ['near', 'miss', 'miss', 'miss', 'hit'] },
  { word: 'RACKO', marks: ['miss', 'miss', 'miss', 'miss', 'near'] },
];
const GUESS = 'STOPS';
const ROW = 2;
const PITCH = 15;
const SIZE = 13;
const at = (c: number, r: number) => ({ x: 43.5 + c * PITCH, y: 5.5 + r * PITCH });
const LOOK: Record<Mark | 'typed', { fill: string; ink: string }> = {
  hit: { fill: '#538D4E', ink: '#FFFFFF' },
  near: { fill: '#B59F3B', ink: '#FFFFFF' },
  miss: { fill: '#3A3A3C', ink: '#FFFFFF' },
  typed: { fill: 'none', ink: C.paper },
};

function Tile({ c, r, ch, mark }: { c: number; r: number; ch: string; mark: Mark | 'typed' }) {
  const { x, y } = at(c, r);
  const look = LOOK[mark];
  return (
    <>
      {mark === 'typed' ? (
        <rect x={x + 0.4} y={y + 0.4} width={SIZE - 0.8} height={SIZE - 0.8} rx='1.6' fill='none' stroke='#B0A89D' strokeWidth='.8' />
      ) : (
        <rect x={x} y={y} width={SIZE} height={SIZE} rx='1.6' fill={look.fill} />
      )}
      {mark === 'hit' ? <circle cx={x + SIZE - 1.9} cy={y + 1.9} r='.9' fill='#FFFFFF' /> : null}
      {mark === 'near' ? <circle cx={x + SIZE - 1.9} cy={y + 1.9} r='.8' fill='none' stroke='#FFFFFF' strokeWidth='.5' /> : null}
      <Word x={x + SIZE / 2 - 0.3} y={y + 9.8} size={8.6} fill={look.ink}>
        {ch}
      </Word>
    </>
  );
}

export default function WordGridPreview({ still }: PreviewProps) {
  return (
    <PreviewScreen still={still} rest={900}>
      {ROWS.map(({ word, marks }, r) => [...word].map((ch, c) => <Tile key={`${r}-${c}`} c={c} r={r} ch={ch} mark={marks[c]} />))}
      {[3, 4, 5].flatMap((r) =>
        [0, 1, 2, 3, 4].map((c) => {
          const { x, y } = at(c, r);
          return <rect key={`e-${r}-${c}`} x={x + 0.4} y={y + 0.4} width={SIZE - 0.8} height={SIZE - 0.8} rx='1.6' fill='none' stroke='#6B5E51' strokeWidth='.8' />;
        }),
      )}
      <Part style={move('thunk', 220, { delay: 660 })}>
        {[...GUESS].map((ch, c) => (
          <g key={c}>
            <Part style={move('flip-out', 260, { delay: c * 90, ease: 'ease-in-out' })}>
              <Tile c={c} r={ROW} ch={ch} mark='typed' />
            </Part>
            <Part style={move('flip-in', 260, { delay: c * 90, ease: 'ease-in-out' })}>
              <Tile c={c} r={ROW} ch={ch} mark='hit' />
            </Part>
          </g>
        ))}
      </Part>
    </PreviewScreen>
  );
}
