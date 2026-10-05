/* Tin duck gallery: the booth from behind the counter (tin-duck/_tin-duck-
   theme.ts). The sign with the score and the clock, then three rows on
   their chains: red ducks at the back, amber ducks in the middle running
   the other way, paper ducks in front, and a plate on each row. The move:
   the rows slide, the cork gun fires, an amber duck flips back on its
   hinge with a flash and +2 rises. */
import { C, EASE, Num, Part, PreviewScreen, move, type PreviewProps } from './kit';

const BOOTH = { back: '#2B231D', line: '#3B3028', shelf: '#6B4A2E', chain: '#E8DCC0' };
const ROWS = [
  { base: 38, s: 0.62, body: C.red, bill: C.paper, wing: C.amber, dir: 1, ducks: [44, 70, 96], plate: 122, stripe: C.red },
  { base: 61, s: 0.78, body: C.amber, bill: C.red, wing: '#D9CDB8', dir: -1, ducks: [38, 72, 106], plate: 134, stripe: C.amber },
  { base: 88, s: 0.95, body: C.paper, bill: C.red, wing: C.amber, dir: 1, ducks: [60, 94, 128], plate: 26, stripe: C.red },
] as const;
const HIT = { row: 1, x: 72 };
const FIRE = 380;

/** A tin duck in profile facing right, standing on (x, base). */
function Duck({ x, base, s, dir, body, bill, wing }: { x: number; base: number; s: number; dir: number; body: string; bill: string; wing: string }) {
  return (
    <g transform={`translate(${x} ${base}) scale(${s * dir} ${s})`}>
      <rect x='-2.5' y='-1.6' width='5' height='2.4' fill={C.ink} />
      <path d='M-8,-9 L-13,-15 L-5,-11 Z' fill={body} />
      <ellipse cx='-1' cy='-6.5' rx='9' ry='5.4' fill={body} />
      <path d='M2.5,-9 L3,-16 L8,-16 L7.5,-8 Z' fill={body} />
      <circle cx='5.5' cy='-17' r='4.2' fill={body} />
      <path d='M9,-18.4 L15,-16.6 L9,-15 Z' fill={bill} />
      <ellipse cx='-2' cy='-6.6' rx='5' ry='2.6' fill={wing} />
      <circle cx='6.4' cy='-18' r='.8' fill={C.ink} />
    </g>
  );
}

/** A plate: dark edge, paper, red ring, paper, amber bullseye. */
function Plate({ x, base, s }: { x: number; base: number; s: number }) {
  const cy = base - 10 * s;
  return (
    <>
      <circle cx={x} cy={cy} r={9 * s} fill='#54483D' />
      <circle cx={x} cy={cy} r={8.2 * s} fill={C.paper} />
      <circle cx={x} cy={cy} r={6.4 * s} fill={C.red} />
      <circle cx={x} cy={cy} r={4.8 * s} fill={C.paper} />
      <circle cx={x} cy={cy} r={3.2 * s} fill={C.amber} />
    </>
  );
}

const css = [
  // Back on its hinge past flat, a bounce, and it lies there.
  `@keyframes gp-duck-down{0%{transform:none}55%{transform:scaleY(-.08)}75%{transform:scaleY(.2)}100%{transform:scaleY(.12)}}`,
  `@keyframes gp-duck-white{0%{opacity:0}1%{opacity:.85}100%{opacity:0}}`,
  `@keyframes gp-duck-chip{0%{transform:none;opacity:0}1%{opacity:1}100%{transform:translate(var(--x),var(--y));opacity:0}}`,
  `@keyframes gp-duck-kick{0%{transform:none}30%{transform:translateY(2.5px)}100%{transform:none}}`,
  `@keyframes gp-duck-flash{0%{transform:scale(.4);opacity:0}1%{opacity:1}100%{transform:scale(1.3);opacity:0}}`,
].join('');

export default function TinDuckPreview({ still }: PreviewProps) {
  const hitRow = ROWS[HIT.row];
  return (
    <PreviewScreen css={css} still={still} rest={0}>
      <rect width='160' height='100' fill={BOOTH.back} />
      {[24, 48, 72].map((y) => (
        <rect key={y} x='0' y={y} width='160' height='.8' fill={BOOTH.line} />
      ))}
      {/* The sign: score left in amber, the clock right in paper. */}
      <rect x='52' y='3' width='56' height='15' rx='1.5' fill={C.ink} stroke={C.amber} strokeWidth='1' />
      <Num x={58} y={14.6} size={10} fill={C.amber} anchor='start'>
        0
      </Num>
      <Num x={103} y={14.6} size={10} fill={C.paper} anchor='end'>
        0:30
      </Num>
      {ROWS.map((row, r) => (
        <g key={r}>
          <rect x='0' y={row.base} width='160' height={4 * row.s + 1} fill={BOOTH.shelf} />
          <rect x='0' y={row.base + 4 * row.s + 1} width='160' height='1.2' fill={row.stripe} />
          <path d={`M0,${row.base - 1} H160`} stroke={BOOTH.chain} strokeWidth='.8' strokeDasharray='1.6 1.4' strokeOpacity='.7' />
          <Part style={move('from', 520, { x: -8 * row.dir, ease: EASE.out })}>
            <Plate x={row.plate} base={row.base} s={row.s} />
            {row.ducks.map((x) =>
              r === HIT.row && x === HIT.x ? null : <Duck key={x} x={x} base={row.base} s={row.s} dir={row.dir} body={row.body} bill={row.bill} wing={row.wing} />,
            )}
            {r === HIT.row ? (
              <>
                <g style={move('gp-duck-down', 240, { delay: FIRE + 40, origin: [HIT.x, row.base], ease: EASE.out })}>
                  <Duck x={HIT.x} base={row.base} s={row.s} dir={row.dir} body={row.body} bill={row.bill} wing={row.wing} />
                  <Part style={move('gp-duck-white', 180, { delay: FIRE + 40, ease: EASE.linear })}>
                    <ellipse cx={HIT.x} cy={row.base - 8} rx='8' ry='7' fill='#FFFFFF' />
                  </Part>
                </g>
                {[-1, 1].flatMap((sx) =>
                  [-1, 0, 1].map((k) => (
                    <Part key={`${sx}${k}`} style={move('gp-duck-chip', 380, { delay: FIRE + 40, x: sx * (7 + Math.abs(k) * 3), y: -6 + k * 5 })}>
                      <rect x={HIT.x - 0.8} y={row.base - 10} width='1.6' height='1.6' fill={C.paper} />
                    </Part>
                  )),
                )}
              </>
            ) : null}
          </Part>
        </g>
      ))}
      {/* The +2 rises off the duck. */}
      <Part style={move('from', 360, { delay: FIRE + 80, y: 8, o: 0, ease: EASE.spring })}>
        <Num x={HIT.x + 15} y={hitRow.base - 10} size={11} fill={C.amber}>
          +2
        </Num>
      </Part>
      {/* The cork gun on the counter: it kicks back and flashes. */}
      <rect x='0' y='94' width='160' height='6' fill='#5A3D28' />
      <Part style={move('gp-duck-kick', 220, { delay: FIRE })}>
        <path d='M77.5,100 L79,80 H81.5 L83,100 Z' fill={C.ink} />
        <rect x='78.6' y='79' width='3.2' height='2.4' rx='.6' fill={C.brass} />
      </Part>
      <Part style={move('gp-duck-flash', 140, { delay: FIRE })}>
        <circle cx='80.2' cy='77' r='3.4' fill={C.amber} />
        <circle cx='80.2' cy='77' r='1.6' fill='#FFF1CF' />
      </Part>
    </PreviewScreen>
  );
}
