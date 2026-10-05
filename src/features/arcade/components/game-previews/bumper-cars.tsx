/* Bumper cars: the rink from above. The yellow car drives into the blue one,
   sparks pop at the bumpers, and the blue car slides off, turning. */
import { C, Part, PreviewScreen, move, EASE, type PreviewProps } from './kit';

const RUBBER = '#1F1A16';

/** A dodgem from above, nose up, centred on (x, y): ring, tub, cowl, seat. */
function Car({ x, y, r = 0, fill }: { x: number; y: number; r?: number; fill: string }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r})`}>
      <rect x='-8' y='-9.5' width='16' height='19' rx='6.5' fill={RUBBER} />
      <rect x='-6.4' y='-7.9' width='12.8' height='15.8' rx='5' fill={fill} />
      <rect x='-5' y='-7.2' width='10' height='5' rx='2.4' fill={fill} stroke={RUBBER} strokeWidth='.8' strokeOpacity='.35' />
      <rect x='-1' y='-7' width='2' height='4.6' fill={C.paper} />
      <rect x='-4.4' y='2.6' width='8.8' height='2.6' rx='1.2' fill={C.dim} />
      <circle cx='0' cy='6.6' r='1.5' fill={C.brass} />
    </g>
  );
}

export default function BumperCarsPreview({ still }: PreviewProps) {
  return (
    <PreviewScreen still={still} rest={0}>
      {/* The plank deck, the wood cap, the rail: red padding in paper bands,
          and the steel floor in plates. */}
      <rect width='160' height='100' fill='#3A2412' />
      <rect x='3' y='2' width='154' height='96' rx='23' fill='#5A3A1C' />
      <rect x='6' y='5' width='148' height='90' rx='20' fill={C.red} />
      <rect x='6' y='5' width='148' height='90' rx='20' fill='none' stroke={C.paper} strokeWidth='4' strokeDasharray='7 11' />
      <rect x='11' y='10' width='138' height='80' rx='16' fill='#4A443D' />
      <path d='M34 10 V90 M57 10 V90 M80 10 V90 M103 10 V90 M126 10 V90 M11 30 H149 M11 50 H149 M11 70 H149' stroke='#3D3832' strokeWidth='.7' />
      {/* Cars at rest round the floor. */}
      <Car x={30} y={30} r={130} fill='#2E9E6B' />
      <Car x={128} y={72} r={-40} fill='#8C5BB0' />
      <Car x={34} y={72} r={60} fill={C.paper} />
      <Car x={122} y={26} r={-120} fill='#E0709A' />
      {/* The blue car takes the hit and slides off, turning. */}
      <Part style={move('to', 520, { delay: 300, x: 14, y: -3, r: 28, ease: EASE.out, origin: [92, 52] })}>
        <Car x={92} y={52} r={90} fill='#3E7CB1' />
      </Part>
      {/* The yellow car drives in from the left and stops on the bump. */}
      <Part style={move('from', 300, { x: -26, ease: EASE.drop })}>
        <Car x={70} y={52} r={90} fill={C.amber} />
      </Part>
      {/* Sparks at the bumpers. */}
      <Part style={move('pop', 360, { delay: 280, s: 1.6, origin: [81, 52] })}>
        <path d='M81 44 L82.6 49.4 L88 50 L82.6 51.6 L81 57 L79.4 51.6 L74 50 L79.4 49.4 Z' fill={C.lit} />
      </Part>
    </PreviewScreen>
  );
}
