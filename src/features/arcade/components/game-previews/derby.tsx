/* Derby: the water race booth. Horses on rails across the backboard, your
   target on the wall under it and your water gun on the counter. The move:
   the jet runs out onto the target, the bull lights, the ring round it
   fills, and your horse (the amber marker) surges up its rail past the
   others toward the wire. */
import { C, EASE, Part, PreviewScreen, move, type PreviewProps } from './kit';

/** A flat toy horse facing right, its nose at (x, y), hooves on y + 8. */
function Horse({ x, y, coat, silk }: { x: number; y: number; coat: string; silk: string }) {
  return (
    <g>
      <ellipse cx={x - 8} cy={y + 1} rx='6' ry='3.2' fill={coat} />
      <path d={`M${x - 4},${y + 1} L${x - 2},${y - 4} L${x + 1},${y - 3} L${x - 1},${y + 2} Z`} fill={coat} />
      <rect x={x - 12} y={y + 3} width='1.6' height='5' fill={coat} />
      <rect x={x - 5.5} y={y + 3} width='1.6' height='5' fill={coat} />
      <rect x={x - 10} y={y - 1.5} width='4.5' height='4' fill={silk} />
    </g>
  );
}

const RAILS = [
  { y: 9, x: 74, coat: '#8A4B2A', silk: '#C8402F' },
  { y: 21, x: 88, coat: '#B98A5A', silk: '#2F63B4' },
  { y: 45, x: 66, coat: '#3B2B22', silk: '#7B4FA0' },
];
const MINE = { y: 33, from: 58, to: 112 };
const WIRE = 148;
const TARGET = { x: 98, y: 74 };
const GUN = { x: 60, y: 97 };
const RING = 2 * Math.PI * 13.5;

export default function DerbyPreview({ still }: PreviewProps) {
  return (
    <PreviewScreen still={still} rest={900}>
      {/* The backboard and its rails. */}
      <rect x='0' y='0' width='160' height='56' fill='#2A231D' />
      {[...RAILS.map((r) => r.y), MINE.y].map((y) => (
        <rect key={y} x='14' y={y + 3} width='140' height='7' rx='3.5' fill='#9A713F' />
      ))}
      <rect x='13' y={MINE.y + 2} width='142' height='9' rx='4.5' fill='none' stroke={C.amber} strokeWidth='1.2' />
      {Array.from({ length: 7 }, (_, i) => (
        <rect key={i} x={WIRE} y={4 + i * 7.4} width='2.4' height='3.7' fill={i % 2 ? C.ink : C.paper} />
      ))}
      {Array.from({ length: 7 }, (_, i) => (
        <rect key={`b${i}`} x={WIRE} y={7.7 + i * 7.4} width='2.4' height='3.7' fill={i % 2 ? C.paper : C.ink} />
      ))}
      {RAILS.map((r) => (
        <Horse key={r.y} x={r.x} y={r.y} coat={r.coat} silk={r.silk} />
      ))}
      <Part style={move('from', 700, { delay: 120, x: MINE.from - MINE.to, ease: EASE.out })}>
        <Horse x={MINE.to} y={MINE.y} coat='#C97B3F' silk={C.paper} />
        <circle cx={MINE.to - 7} cy={MINE.y - 6} r='2' fill={C.amber} />
      </Part>
      {/* The target wall. */}
      <rect x='0' y='56' width='160' height='44' fill='#1F1A16' />
      <circle cx={TARGET.x} cy={TARGET.y} r='11' fill={C.paper} />
      <circle cx={TARGET.x} cy={TARGET.y} r='8.6' fill='#C8402F' />
      <circle cx={TARGET.x} cy={TARGET.y} r='6' fill={C.paper} />
      <circle cx={TARGET.x} cy={TARGET.y} r='3.3' fill='#C8402F' />
      <Part style={move('on', 140, { delay: 200 })}>
        <circle cx={TARGET.x} cy={TARGET.y} r='3.3' fill={C.amber} />
      </Part>
      <circle cx={TARGET.x} cy={TARGET.y} r='13.5' fill='none' stroke='rgba(244,235,220,0.16)' strokeWidth='2.4' />
      <circle
        cx={TARGET.x}
        cy={TARGET.y}
        r='13.5'
        fill='none'
        stroke={C.amber}
        strokeWidth='2.4'
        strokeDasharray={RING}
        transform={`rotate(-90 ${TARGET.x} ${TARGET.y})`}
        style={move('dash', 520, { delay: 160, dash: [RING, 0], ease: EASE.out })}
      />
      {/* The jet, out from the gun onto the bull. */}
      <path
        d={`M${GUN.x + 4},${GUN.y - 9} Q${(GUN.x + TARGET.x) / 2},${TARGET.y - 18} ${TARGET.x},${TARGET.y}`}
        fill='none'
        stroke='#8FD3F4'
        strokeWidth='2.6'
        strokeLinecap='round'
        strokeDasharray='80'
        style={move('dash', 160, { dash: [80, 0], ease: EASE.linear })}
      />
      <Part style={move('on', 120, { delay: 160 })}>
        {[[-5, -4], [4, -5], [6, 2], [-6, 3]].map(([dx, dy]) => (
          <circle key={`${dx}${dy}`} cx={TARGET.x + dx!} cy={TARGET.y + dy!} r='0.9' fill='#EAF8FF' />
        ))}
      </Part>
      {/* The gun on the counter. */}
      <rect x='0' y='91' width='160' height='9' fill='#5A3A1C' />
      <path d={`M${GUN.x - 2},${GUN.y - 2} L${GUN.x + 2.5},${GUN.y - 11} L${GUN.x + 6},${GUN.y - 9.5} L${GUN.x + 2.5},${GUN.y - 1} Z`} fill={C.paper} />
      <circle cx={GUN.x} cy={GUN.y - 2} r='3.4' fill={C.lit} stroke={C.ink} strokeWidth='1' />
    </PreviewScreen>
  );
}
