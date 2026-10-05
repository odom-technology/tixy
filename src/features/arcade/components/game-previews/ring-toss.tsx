/* Ring toss: the booth from the counter (ring-toss/_ring-toss-theme.ts).
   The sign, then the maple crate of sixteen bottles on the walnut platform,
   a row per glass (brown at the back, then blue, green, pale in front), the
   gold bottle in the blue row, and the row values painted at the sides. The
   move: the red ring arcs out of your hand and drops over the gold
   bottle's neck; the bottle flashes and +100 pops. */
import { C, EASE, Num, Part, PreviewScreen, move, type PreviewProps } from './kit';

const WOOD = { booth: '#2A211B', platform: '#7D5A3C', platformEdge: '#6B4A31', crate: '#B98D57', seam: '#8A6338' };
/** Back to front: glass, base line, scale, column pitch, value. */
const ROWS = [
  { glass: '#7C3A2C', base: 42, s: 0.62, pitch: 11.5, value: '50' },
  { glass: '#2F6683', base: 54, s: 0.7, pitch: 12.5, value: '30' },
  { glass: '#3F7F62', base: 66, s: 0.8, pitch: 13.5, value: '20' },
  { glass: '#9FB7A6', base: 79, s: 0.9, pitch: 14.5, value: '10' },
];
const colX = (row: number, c: number) => 80 + (c - 1.5) * ROWS[row].pitch;
const GOLD = { row: 1, c: 1 };

/** A bottle standing at (x, base): body, shoulder, long neck, bead. */
function Bottle({ x, base, s, fill }: { x: number; base: number; s: number; fill: string }) {
  const w = 5.2 * s;
  const n = 1.7 * s;
  const h = 30 * s;
  return (
    <>
      <path
        d={`M${x - w},${base} V${base - h * 0.46} Q${x - w},${base - h * 0.62} ${x - n},${base - h * 0.72} V${base - h} H${x + n} V${base - h * 0.72} Q${x + w},${base - h * 0.62} ${x + w},${base - h * 0.46} V${base} Z`}
        fill={fill}
      />
      <rect x={x - n - 0.5} y={base - h - 0.4} width={2 * n + 1} height={1.6 * s} rx='.6' fill={fill} />
      <rect x={x - w + 1.2 * s} y={base - h * 0.42} width={1.2 * s} height={h * 0.3} fill='#FFFFFF' fillOpacity='.18' />
    </>
  );
}

const gold = { x: colX(GOLD.row, GOLD.c), base: ROWS[GOLD.row].base, s: ROWS[GOLD.row].s };
const NECK_Y = gold.base - 30 * gold.s * 0.82;
const HAND = { x: 80, y: 95 };
const FLY = 560;
const RING = { rx: 12, ry: 3.6 };
/* The ring flies from the hand to the neck, shrinking with distance. */
const css = `@keyframes gp-rt-flash{0%{opacity:0}1%,50%{opacity:1}100%{opacity:0}}`;
const flight = move('to', FLY, { delay: 40, x: gold.x - HAND.x, y: NECK_Y - HAND.y, s: 0.45, ease: 'cubic-bezier(.35,.6,.5,1)' });

export default function RingTossPreview({ still }: PreviewProps) {
  return (
    <PreviewScreen css={css} still={still} rest={0}>
      <rect width='160' height='100' fill={WOOD.booth} />
      {/* The sign: score, the ring lamps, the clock. */}
      <rect x='48' y='2' width='64' height='14' rx='1.4' fill={C.ink} stroke={C.amber} strokeWidth='.9' />
      <Num x={53} y={13} size={9} fill={C.amber} anchor='start'>
        0
      </Num>
      {Array.from({ length: 10 }, (_, i) => (
        <circle key={i} cx={69 + (i % 5) * 4} cy={i < 5 ? 6.8 : 11} r='1.3' fill='none' stroke={C.amber} strokeWidth='.7' />
      ))}
      <Num x={107} y={13} size={9} fill={C.paper} anchor='end'>
        0:30
      </Num>
      {/* The platform, the values at its sides, the crate. */}
      <path d='M32,21 H128 L146,92 H14 Z' fill={WOOD.platform} />
      {ROWS.map((row) => (
        <g key={row.value}>
          <Num x={44 - (row.s - 0.62) * 24} y={row.base - 1} size={4.6 + row.s * 2.4} fill={C.paper}>
            {row.value}
          </Num>
          <Num x={116 + (row.s - 0.62) * 24} y={row.base - 1} size={4.6 + row.s * 2.4} fill={C.paper}>
            {row.value}
          </Num>
        </g>
      ))}
      <path d='M55,24 H105 L111,84 H49 Z' fill={WOOD.seam} />
      {ROWS.slice(0, GOLD.row + 1).map((row, r) =>
        [0, 1, 2, 3].map((c) => (r === GOLD.row && c === GOLD.c ? null : <Bottle key={`${r}-${c}`} x={colX(r, c)} base={row.base} s={row.s} fill={row.glass} />)),
      )}
      {/* The ring's back half goes behind the gold neck. */}
      <Part style={flight}>
        <path d={`M${HAND.x - RING.rx},${HAND.y} A${RING.rx},${RING.ry} 0 0 1 ${HAND.x + RING.rx},${HAND.y}`} fill='none' stroke={C.red} strokeWidth='3.4' />
      </Part>
      <Bottle x={gold.x} base={gold.base} s={gold.s} fill={C.amber} />
      <Part style={move('gp-rt-flash', 300, { delay: FLY + 40, ease: EASE.linear })}>
        <Bottle x={gold.x} base={gold.base} s={gold.s} fill={C.lit} />
      </Part>
      {ROWS.slice(GOLD.row + 1).map((row, k) =>
        [0, 1, 2, 3].map((c) => <Bottle key={`f${k}-${c}`} x={colX(GOLD.row + 1 + k, c)} base={row.base} s={row.s} fill={row.glass} />),
      )}
      <rect x='46' y='80' width='68' height='7' fill={WOOD.crate} />
      <rect x='46' y='83' width='68' height='.8' fill={WOOD.seam} />
      {/* The ring's front half, in front of the neck. */}
      <Part style={flight}>
        <path d={`M${HAND.x - RING.rx},${HAND.y} A${RING.rx},${RING.ry} 0 0 0 ${HAND.x + RING.rx},${HAND.y}`} fill='none' stroke={C.red} strokeWidth='3.4' />
      </Part>
      <Part style={move('from', 280, { delay: FLY + 60, y: 6, o: 0, ease: EASE.spring })}>
        <Num x={gold.x} y={NECK_Y - 8} size={12} fill={C.amber}>
          +100
        </Num>
      </Part>
    </PreviewScreen>
  );
}
