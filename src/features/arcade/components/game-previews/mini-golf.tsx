/* Mini golf: one hole from above (mini-golf/_mini-golf-scene.ts). The lane
   of felt with its cut corners between cream-capped rails, laid on the
   plank deck; the paper tee mat, the cup with its rim, the red flag. The
   move: the ball runs up the lane, banks off the cut corner, rolls to the
   cup and drops; the flag lifts out. */
import { C, Part, PreviewScreen, move, type PreviewProps } from './kit';

const FELT = '#2F7D57';
const RAIL = '#E8DCC4';
const DECK = { board: '#4A3524', seam: '#3A2919', light: '#56402C' };
const TEE = { x: 40, y: 72 };
const BANK = { x: 40, y: 31 };
const CUP = { x: 120, y: 30 };

export default function MiniGolfPreview({ still }: PreviewProps) {
  // The lane: up the left, then along the top to the cup; corners cut.
  const lane = 'M28,100 L28,30 L36,18 L126,18 L134,26 L134,34 L126,42 L52,42 L52,100 Z';
  return (
    <PreviewScreen still={still} rest={0}>
      <rect width='160' height='100' fill={DECK.board} />
      {Array.from({ length: 12 }, (_, i) => (
        <g key={i}>
          <rect x={i * 14} y='0' width='1' height='100' fill={DECK.seam} />
          {i % 3 === 1 ? <rect x={i * 14 + 1} y='0' width='13' height='100' fill={DECK.light} /> : null}
          <rect x={i * 14 + 1} y={(i * 37) % 80 + 6} width='13' height='.8' fill={DECK.seam} />
        </g>
      ))}
      <path d={lane} fill={FELT} stroke={RAIL} strokeWidth='3.4' strokeLinejoin='round' />
      <rect x='33' y='65' width='14' height='14' rx='1' fill='#EADFCB' />
      <circle cx={CUP.x} cy={CUP.y} r='4.4' fill='#F1E8D6' />
      <circle cx={CUP.x} cy={CUP.y} r='3.4' fill='#0B0806' />
      <Part style={move('to', 200, { delay: 680, y: -4, ease: 'cubic-bezier(.2,1.5,.4,1)' })}>
        <line x1={CUP.x} y1={CUP.y} x2={CUP.x} y2={CUP.y - 20} stroke={C.paper} strokeWidth='1.2' />
        <path d={`M${CUP.x},${CUP.y - 20} L${CUP.x + 10},${CUP.y - 16.5} L${CUP.x},${CUP.y - 13} Z`} fill={C.red} />
      </Part>
      <Part style={move('to', 330, { delay: 0, y: BANK.y - TEE.y, ease: 'cubic-bezier(.35,.6,.6,1)' })}>
        <Part style={move('to', 380, { delay: 330, x: CUP.x - BANK.x, y: CUP.y - BANK.y })}>
          <Part style={move('to', 140, { delay: 710, s: 0.4, o: 0, origin: [TEE.x, TEE.y] })}>
            <circle cx={TEE.x + 0.5} cy={TEE.y + 0.8} r='2.8' fill={C.hole} fillOpacity='.35' />
            <circle cx={TEE.x} cy={TEE.y} r='2.8' fill='#F7F1E6' />
            <rect x={TEE.x - 2.8} y={TEE.y - 0.5} width='5.6' height='1' fill={C.red} />
          </Part>
        </Part>
      </Part>
    </PreviewScreen>
  );
}
