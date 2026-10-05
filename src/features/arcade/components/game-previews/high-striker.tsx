/* High striker, the endless tower: the fill climbs the channel past the
   paper line into the red band at the top, the mallet comes down, the puck
   runs up the tower and the bell rings. The still is the moment before the
   swing: the fill in the band, the mallet drawn back. */
import { C, EASE, Part, PreviewScreen, move, type PreviewProps } from './kit';

/** The mallet's shoulder. */
const PIVOT: [number, number] = [138, 92];
/** The channel's floor, the red band and the line. */
const FLOOR = 84;
const BAND_TOP = 23;
const BAND_BOTTOM = 28;
const LINE_Y = 38;
/** The fill climbs for this long; the still holds its last frame. */
const WIND = 380;

const css = [
  // The mallet draws back as the fill climbs, then drops onto the plate.
  `@keyframes gp-hs-mallet{0%{transform:rotate(0deg)}61%{transform:rotate(16deg)}78%{transform:rotate(-60deg)}100%{transform:rotate(-54deg)}}`,
  // The fill climbs from the floor to the band, at a steady rate.
  `@keyframes gp-hs-fill{from{transform:scaleY(.04)}to{transform:none}}`,
].join('');

export default function HighStrikerPreview({ still }: PreviewProps) {
  return (
    <PreviewScreen css={css} still={still} rest={WIND}>
      {/* The tower: the cabinet, an enamel stripe each side, the dark channel. */}
      <rect x='62' y='20' width='36' height='68' rx='2' fill={C.screen2} />
      <rect x='65' y='22' width='6' height='64' fill={C.red} />
      <rect x='89' y='22' width='6' height='64' fill={C.lit} />
      <rect x='74' y={BAND_TOP} width='12' height={FLOOR - BAND_TOP + 2} fill={C.hole} />
      {/* The window, from the line to the bell band, and the band itself. */}
      <rect x='74' y={BAND_BOTTOM} width='12' height={LINE_Y - BAND_BOTTOM} fill={C.dim} />
      <rect x='74' y={BAND_TOP} width='12' height={BAND_BOTTOM - BAND_TOP} fill={C.red} />
      {/* The fill: dim under the line, amber over it. It drains on the swing. */}
      <Part style={move('off', 120, { delay: WIND + 40 })}>
        <g style={{ ...move('gp-hs-fill', WIND, { ease: EASE.linear }), transformBox: 'view-box', transformOrigin: `80px ${FLOOR}px` }}>
          <rect x='76' y={LINE_Y} width='8' height={FLOOR - LINE_Y} fill={C.amber} fillOpacity='0.45' />
          <rect x='76' y={BAND_TOP + 1} width='8' height={LINE_Y - BAND_TOP - 1} fill={C.amber} />
          <rect x='76' y={BAND_TOP + 1} width='8' height='2' fill={C.lit} />
        </g>
      </Part>
      <rect x='70' y={LINE_Y - 1} width='20' height='2' fill={C.lit} />
      {/* The crown and the bell, and the ring when the puck reaches it. */}
      <path d='M58 21 H102 L96 16 H64 Z' fill={C.dim} />
      <path d='M71 16 Q71 6 80 6 Q89 6 89 16 Z' fill={C.brass} />
      <Part style={move('pop', 160, { delay: 740, s: 1.5 })}>
        <circle cx='80' cy='11' r='9' fill='none' stroke={C.amber} strokeWidth='1.6' />
      </Part>
      {/* The puck: up the channel to the bell. */}
      <Part style={move('to', 260, { delay: 480, y: BAND_TOP - (FLOOR - 5), ease: EASE.out })}>
        <rect x='75' y={FLOOR - 5} width='10' height='5' rx='1.5' fill={C.lit} />
      </Part>
      {/* The plinth and the strike plate. */}
      <rect x='50' y={FLOOR + 3} width='60' height='8' rx='1.5' fill={C.dim} />
      <rect x='102' y={FLOOR} width='18' height='3' rx='1' fill={C.brass} />
      {/* The mallet. */}
      <g style={move('gp-hs-mallet', 620, { origin: PIVOT, ease: EASE.linear })}>
        <path d={`M${PIVOT[0]},${PIVOT[1]} L${PIVOT[0] - 6},${PIVOT[1] - 32}`} stroke={C.brass} strokeWidth='3.5' strokeLinecap='round' />
        <rect x={PIVOT[0] - 16} y={PIVOT[1] - 44} width='20' height='12' rx='2' fill={C.tan} transform={`rotate(-12 ${PIVOT[0] - 6} ${PIVOT[1] - 38})`} />
      </g>
    </PreviewScreen>
  );
}
