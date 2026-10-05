/* Lucky cage: the cabinet from the front (lucky-cage/_lucky-cage-theme.ts).
   The brass barrel cage turns on its axle between two yokes, cream balls
   with painted bands tumbling inside, the crank on the right, the walnut
   cabinet with its felt top and ink sign, the five cradles, and the bulbs
   and pennants overhead. The move: the crank turns a full circle, the bars
   roll past, the balls tumble, and ball 7 drops into the first cradle. */
import { C, EASE, Num, Part, PreviewScreen, Word, move, type PreviewProps } from './kit';

const BRASS = { hi: '#F0D79A', mid: '#C79A4C', lo: '#78581F' };
const WOOD = { body: '#5A3A1C', hi: '#6E4A26', lo: '#3A2412' };
const BALL = { cream: '#F2E7CD', ink: '#1D1409' };
const BAND = ['#A8342C', '#2F7F74', '#C9922F', '#5A5F96', '#7C4A86'];
const band = (n: number) => BAND[Math.floor((n - 1) / 4)];
const DRUM = { x: 63, y: 21, w: 34, h: 44 };
const MID = { x: DRUM.x + DRUM.w / 2, y: DRUM.y + DRUM.h / 2 };
const AXLE = { y: MID.y, crank: 115 };
const CRADLES = [62, 71, 80, 89, 98];
const TURN = 760;

/** A ball with its band and number. */
function Ball({ x, y, n, r }: { x: number; y: number; n: number; r: number }) {
  const h = r * 0.42;
  const w = +Math.sqrt(r * r - h * h).toFixed(2);
  return (
    <>
      <circle cx={x} cy={y} r={r} fill={BALL.cream} />
      <path d={`M${x - w},${y - h}H${x + w}A${r},${r} 0 0 1 ${x + w},${y + h}H${x - w}A${r},${r} 0 0 1 ${x - w},${y - h}Z`} fill={band(n)} />
      <circle cx={x} cy={y} r={r * 0.46} fill={BALL.cream} />
    </>
  );
}

// The balls in the bottom of the drum: x, y, number.
const INSIDE: [number, number, number][] = [
  [70, 58, 3], [76, 60, 14], [82, 60, 9], [88, 58, 18], [73, 53, 5], [79, 54, 11], [85, 53, 2], [79, 48, 16],
];
const css = [
  `@keyframes gp-cage-bars{from{transform:none}to{transform:translateY(-15px)}}`,
  // The balls ride up the turning drum and fall back to the bottom.
  `@keyframes gp-cage-tumble{0%{transform:none}45%{transform:rotate(130deg)}100%{transform:none}}`,
].join('');

export default function LuckyCagePreview({ still }: PreviewProps) {
  return (
    <PreviewScreen css={css} still={still} rest={900}>
      <rect width='160' height='100' fill={C.ink} />
      {/* The bulb string and the pennants. */}
      <path d='M0,4 Q80,9 160,4' fill='none' stroke={C.dim} strokeWidth='.6' />
      {Array.from({ length: 12 }, (_, i) => {
        const x = 7 + i * 13;
        const y = 4 + Math.sin((x / 160) * Math.PI) * 5;
        return <path key={`p${i}`} d={`M${x - 3},${y} h6 l-3,5 Z`} fill={i % 2 ? C.paper : C.red} />;
      })}
      {Array.from({ length: 6 }, (_, i) => {
        const x = 13.5 + i * 26;
        const y = 4 + Math.sin((x / 160) * Math.PI) * 5;
        return <circle key={`b${i}`} cx={x} cy={y + 1} r='2.4' fill={[C.amber, C.red, C.paper][i % 3]} />;
      })}
      {/* The axle on its yokes, and the crank. */}
      <path d={`M48,${AXLE.y} H${AXLE.crank}`} stroke={BRASS.mid} strokeWidth='1.6' />
      <path d={`M51,${AXLE.y} V72 M109,${AXLE.y} V72`} stroke={WOOD.hi} strokeWidth='3' />
      <g style={move('turn', TURN, { r: 360, origin: [AXLE.crank, AXLE.y], ease: EASE.out })}>
        <path d={`M${AXLE.crank},${AXLE.y} V${AXLE.y - 10} H${AXLE.crank + 4}`} fill='none' stroke={BRASS.mid} strokeWidth='1.8' strokeLinejoin='round' />
        <rect x={AXLE.crank + 3.5} y={AXLE.y - 11.6} width='6' height='3.2' rx='1.4' fill={WOOD.body} />
      </g>
      {/* The balls tumble as the drum turns. */}
      <g style={move('gp-cage-tumble', TURN, { origin: [MID.x, MID.y + 2], ease: 'ease-in-out' })}>
        {INSIDE.map(([x, y, n]) => (
          <Ball key={n} x={x} y={y} n={n} r={3.2} />
        ))}
      </g>
      {/* The cage: horizontal bars rolling past inside its window, the
          hoops and the end rings over them. */}
      <svg x={DRUM.x} y={DRUM.y} width={DRUM.w} height={DRUM.h} viewBox={`${DRUM.x} ${DRUM.y} ${DRUM.w} ${DRUM.h}`} overflow='hidden'>
        <g style={move('gp-cage-bars', TURN, { ease: EASE.out })}>
          {Array.from({ length: 13 }, (_, i) => (
            <rect key={i} x={DRUM.x} y={DRUM.y + 1 + i * 5} width={DRUM.w} height='1' fill={BRASS.mid} />
          ))}
        </g>
      </svg>
      {[0.25, 0.5, 0.75].map((f) => (
        <rect key={f} x={DRUM.x + DRUM.w * f - 0.5} y={DRUM.y} width='1' height={DRUM.h} fill={BRASS.mid} />
      ))}
      <rect x={DRUM.x} y={DRUM.y} width={DRUM.w} height={DRUM.h} rx='12' ry='9' fill='none' stroke={BRASS.mid} strokeWidth='2.6' />
      <circle cx={DRUM.x - 1} cy={AXLE.y} r='2.4' fill={BRASS.lo} />
      <circle cx={DRUM.x + DRUM.w + 1} cy={AXLE.y} r='2.4' fill={BRASS.lo} />
      {/* The collar and chute under the drum. */}
      <rect x={MID.x - 4} y={DRUM.y + DRUM.h} width='8' height='4' rx='1' fill={BRASS.mid} />
      {/* The cabinet: felt top, walnut body, the sign. */}
      <rect x='26' y='70' width='108' height='3' fill={C.felt} />
      <rect x='26' y='73' width='108' height='27' fill={WOOD.body} />
      <rect x='26' y='73' width='108' height='1.2' fill={WOOD.lo} />
      {CRADLES.map((x) => (
        <ellipse key={x} cx={x} cy='71.4' rx='3.6' ry='1.4' fill='none' stroke={BRASS.mid} strokeWidth='1' />
      ))}
      <rect x='52' y='80' width='56' height='14' rx='1.4' fill={C.ink} stroke={BRASS.hi} strokeWidth='.7' />
      <Word x={80} y={87.6} size={6.4} fill={C.paper}>
        lucky cage
      </Word>
      <Word x={80} y={92} size={3.4} fill={C.paper} weight={400}>
        20 balls, 5 drawn
      </Word>
      {/* Ball 7 drops out of the collar and rolls to the first cradle. */}
      <Part style={move('from', 320, { delay: 520, x: MID.x - CRADLES[0], y: DRUM.y + DRUM.h - 66, o: 0, ease: EASE.drop })}>
        <Ball x={CRADLES[0]} y={66.6} n={7} r={4.2} />
        <Num x={CRADLES[0]} y={68.6} size={5.4} fill={BALL.ink}>
          7
        </Num>
      </Part>
    </PreviewScreen>
  );
}
