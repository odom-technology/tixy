/* 2048: the game's board (2048/_2048-theme.ts), an ink panel with faint
   paper cells and tiles that warm from paper to brick as they grow. One row
   slides right, two 64s merge into 128 with a pop, and a new 2 drops in. */
import { C, EASE, Part, PreviewScreen, Num, move, type PreviewProps } from './kit';

const STEP = 19.5;
const cell = (c: number, r: number) => ({ x: 42 + c * STEP, y: 11 + r * STEP });
const BOARD = [
  [0, 0, 2, 4],
  [8, 16, 4, 2],
  [0, 0, 0, 0],
  [128, 256, 512, 8],
];

const FILL: Record<number, string> = {
  2: '#F4EBDC',
  4: '#EADFCB',
  8: '#DED0B7',
  16: '#E5C08C',
  32: '#ECB061',
  64: '#F2A33C',
  128: '#E88F38',
  256: '#DC7A34',
  512: '#CF622F',
};

function Tile({ c, r, v }: { c: number; r: number; v: number }) {
  const { x, y } = cell(c, r);
  const fill = FILL[v];
  return (
    <>
      <rect x={x} y={y} width='17' height='17' rx='2.5' fill={fill} />
      <Num x={x + 8.5} y={y + 12.5} size={v > 99 ? 8.5 : 11} fill={C.ink}>
        {v}
      </Num>
    </>
  );
}

export default function Preview2048({ still }: PreviewProps) {
  return (
    <PreviewScreen still={still} rest={900}>
      <rect x='39' y='8' width='82' height='82' rx='3' fill={C.ink} stroke={C.screen2} strokeWidth='1' />
      {BOARD.flatMap((row, r) =>
        row.map((_, c) => {
          const { x, y } = cell(c, r);
          return <rect key={`${r}-${c}`} x={x} y={y} width='17' height='17' rx='2.5' fill={C.paper} fillOpacity='.08' />;
        }),
      )}
      {BOARD.flatMap((row, r) => row.map((v, c) => (v ? <Tile key={`${r}-${c}`} c={c} r={r} v={v} /> : null)))}
      <Tile c={3} r={2} v={64} />
      <Part style={move('to', 140, { delay: 60, x: 3 * STEP, ease: EASE.linear })}>
        <Tile c={0} r={2} v={64} />
      </Part>
      <Part style={move('pop', 220, { delay: 200, s: 1.2 })}>
        <Tile c={3} r={2} v={128} />
      </Part>
      <Part style={move('pop', 200, { delay: 460 })}>
        <Tile c={0} r={2} v={2} />
      </Part>
    </PreviewScreen>
  );
}
