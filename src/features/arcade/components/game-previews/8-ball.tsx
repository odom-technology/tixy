/* 8-ball: the cue strikes, the cue ball runs into the rack, the rack spreads. */
import { C, EASE, Part, PreviewScreen, move, type PreviewProps } from './kit';
import { PoolBall } from './pool-ball';

const R = 4.2;
const ORDER = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 6, 13, 7, 14, 15];
const APEX = { x: 104, y: 50 };
const RACK = (() => {
  const out: { x: number; y: number; n: number }[] = [];
  let k = 0;
  for (let row = 0; row < 5; row++)
    for (let i = 0; i <= row; i++) out.push({ x: APEX.x + row * R * 1.75, y: APEX.y + (i - row / 2) * R * 2.02, n: ORDER[k++] });
  return out;
})();
const MID = { x: APEX.x + 2 * R * 1.75, y: APEX.y };
const CUE = { x: 50, y: 50 };
const POCKETS = [[11, 11], [80, 9], [149, 11], [11, 89], [80, 91], [149, 89]];

const css = `@keyframes gp-8b-cue{0%{transform:none}55%{transform:translateX(-9px)}80%{transform:translateX(3px)}100%{transform:translateX(1px)}}`;

export default function EightBallPreview({ still }: PreviewProps) {
  return (
    <PreviewScreen css={css} still={still} rest={0}>
      <rect width='160' height='100' rx='6' fill={C.rail} />
      <rect x='7' y='7' width='146' height='86' rx='2' fill={C.cushion} />
      <rect x='10' y='10' width='140' height='80' rx='3' fill={C.felt} />
      {POCKETS.map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r='6' fill='#0C0907' />
      ))}
      {RACK.map((b) => (
        <Part
          key={b.n}
          style={move('to', 260, { delay: 620, x: (b.x - MID.x) * 0.35 + 3, y: (b.y - MID.y) * 0.45 })}
        >
          <PoolBall x={b.x} y={b.y} n={b.n} r={R} />
        </Part>
      ))}
      <Part style={move('to', 340, { delay: 280, x: APEX.x - 2 * R - CUE.x })}>
        <circle cx={CUE.x} cy={CUE.y} r={R} fill='#F7F2E8' />
      </Part>
      <Part style={move('gp-8b-cue', 300, { ease: EASE.linear })}>
        <path d={`M${CUE.x - R - 4} ${CUE.y} H-4`} stroke='#F0E2C2' strokeWidth='2.6' strokeLinecap='round' />
        <path d={`M${CUE.x - R - 4} ${CUE.y} h-2`} stroke='#6B5631' strokeWidth='2.6' strokeLinecap='round' />
      </Part>
    </PreviewScreen>
  );
}
