/* Ticket stop: the lock (_lock-draw.ts). A brass padlock with an ink dial;
   the cream needle sweeps the track towards the amber dot. The move: the
   needle reaches the dot, the dot pops in a ring of chips, the count rolls
   to 0 and the shackle springs open. */
import { C, EASE, Num, Part, PreviewScreen, move, type PreviewProps } from './kit';

const LOCK = { brass: '#C9A15A', brassDark: '#9C7A3E', track: '#14110E' };
const CX = 80;
const CY = 65;
const R = 27;
const TRACK_IN = R * 0.56;
const TRACK_OUT = R * 0.88;
const MID = (TRACK_IN + TRACK_OUT) / 2;
const DOT_R = MID * Math.sin((12 * Math.PI) / 180);
const SHACKLE_R = R * 0.56;
const SHACKLE_W = R * 0.2;
const ARCH_Y = CY - R * 1.9 + SHACKLE_W / 2 + SHACKLE_R;
const LEG_Y = CY - R * 0.55;

/** Degrees clockwise from 12 o'clock to a point on the track. */
const at = (deg: number, r = MID) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: +(CX + Math.cos(a) * r).toFixed(2), y: +(CY + Math.sin(a) * r).toFixed(2) };
};

const DOT_DEG = 62;
const NEEDLE_FROM = -30;
/** 220 deg/s, a little quicker than level 1 so the move fits. */
const SWEEP = Math.round(((DOT_DEG - NEEDLE_FROM) / 220) * 1000);
const OPEN = SWEEP + 50;
const DOT = at(DOT_DEG);
const N_IN = at(0, TRACK_IN + 1);
const N_OUT = at(0, TRACK_OUT - 1);
/* The trail: a 30 deg wedge of the track behind the needle. */
const T0i = at(-30, TRACK_IN + 1);
const T0o = at(-30, TRACK_OUT - 1);
const TRAIL = `M${N_OUT.x},${N_OUT.y} A${TRACK_OUT - 1},${TRACK_OUT - 1} 0 0 0 ${T0o.x},${T0o.y} L${T0i.x},${T0i.y} A${TRACK_IN + 1},${TRACK_IN + 1} 0 0 1 ${N_IN.x},${N_IN.y} Z`;
/* The digit slot: one digit tall, so the roll never shows outside it. */
const SLOT = { x: CX - 9, y: CY - 6.5, w: 18, h: 12 };

const css = [
  `@keyframes gp-ts-dot{0%{transform:none}35%{transform:scale(1.35)}100%{transform:scale(0)}}`,
  `@keyframes gp-ts-ring{0%{transform:none;opacity:0}1%{opacity:1}100%{transform:scale(3.2);opacity:0}}`,
  `@keyframes gp-ts-chip{0%{transform:none;opacity:0}1%{opacity:1}100%{transform:translate(var(--x),var(--y)) scale(.5);opacity:0}}`,
  `@keyframes gp-ts-flash{0%{opacity:0}1%{opacity:1}60%{opacity:1}100%{opacity:0}}`,
].join('');

export default function TicketStopPreview({ still }: PreviewProps) {
  return (
    <PreviewScreen css={css} still={still} rest={SWEEP - 140}>
      <rect width='160' height='100' fill={C.ink} />
      {/* The shackle: lifts clear and swings its short leg out. */}
      <Part style={move('to', 400, { delay: OPEN, y: -7, r: -14, origin: [CX - SHACKLE_R, LEG_Y], ease: EASE.spring })}>
        <path
          d={`M${CX - SHACKLE_R},${LEG_Y} V${ARCH_Y} A${SHACKLE_R},${SHACKLE_R} 0 0 1 ${CX + SHACKLE_R},${ARCH_Y} V${LEG_Y}`}
          fill='none'
          stroke={LOCK.brassDark}
          strokeWidth={SHACKLE_W}
        />
      </Part>
      {/* The body: a brass rim round an ink face, the track inside. */}
      <circle cx={CX} cy={CY} r={R} fill={LOCK.brass} />
      <Part style={move('gp-ts-flash', 420, { delay: SWEEP, ease: EASE.linear })}>
        <circle cx={CX} cy={CY} r={R} fill={C.amber} />
      </Part>
      <circle cx={CX} cy={CY} r={R * 0.93} fill={C.screen} />
      <circle cx={CX} cy={CY} r={MID} fill='none' stroke={LOCK.track} strokeWidth={TRACK_OUT - TRACK_IN} />
      {/* The dot swells and goes; a ring grows out of it, chips fly. */}
      <Part style={move('gp-ts-dot', 140, { delay: SWEEP, ease: EASE.out })}>
        <circle cx={DOT.x} cy={DOT.y} r={DOT_R} fill={C.amber} />
      </Part>
      <Part style={move('gp-ts-ring', 360, { delay: SWEEP, ease: EASE.out })}>
        <circle cx={DOT.x} cy={DOT.y} r={DOT_R} fill='none' stroke={C.amber} strokeWidth='1.4' />
      </Part>
      {[0, 1, 2, 3, 4, 5, 6].map((i) => {
        const a = (i / 7) * Math.PI * 2 + 0.4;
        const reach = 9 + (i % 3) * 2;
        return (
          <Part
            key={i}
            style={move('gp-ts-chip', 440, { delay: SWEEP, x: +(Math.cos(a) * reach).toFixed(1), y: +(Math.sin(a) * reach).toFixed(1) })}
          >
            <rect x={DOT.x - 1.1} y={DOT.y - 1.1} width='2.2' height='2.2' fill={C.amber} />
          </Part>
        );
      })}
      {/* The needle sweeps at a constant speed to the dot and holds. */}
      <g style={move('turn', SWEEP, { r: DOT_DEG - NEEDLE_FROM, origin: [CX, CY], ease: EASE.linear })}>
        <g transform={`rotate(${NEEDLE_FROM} ${CX} ${CY})`}>
          <path d={TRAIL} fill={C.lit} fillOpacity='.22' />
          <path d={`M${N_IN.x},${N_IN.y} L${N_OUT.x},${N_OUT.y}`} stroke={C.paper} strokeWidth='2.4' strokeLinecap='round' />
        </g>
      </g>
      {/* The count of hits left, rolling down its slot: 1, then 0. */}
      <svg x={SLOT.x} y={SLOT.y} width={SLOT.w} height={SLOT.h} viewBox={`${SLOT.x} ${SLOT.y} ${SLOT.w} ${SLOT.h}`} overflow='hidden'>
        <Part style={move('to', 200, { delay: SWEEP, y: SLOT.h, o: 0 })}>
          <Num x={CX} y={CY + 5} size={14} fill={C.paper}>
            1
          </Num>
        </Part>
        <Part style={move('from', 200, { delay: SWEEP, y: -SLOT.h, o: 0 })}>
          <Num x={CX} y={CY + 5} size={14} fill={C.paper}>
            0
          </Num>
        </Part>
      </svg>
    </PreviewScreen>
  );
}
