/* Mines: the machine's 5 x 5 field (mines/_mines-machine.css). Covered
   tiles sit a step above the screen on a hard lower edge; a gem turns its
   tile amber with an ink gem. The move: one more tile flips over to a gem
   and the gem pops. */
import { C, Part, PreviewScreen, move, type PreviewProps } from './kit';

const PITCH = 17.4;
const SIZE = 15;
const pos = (i: number) => ({ x: 37.5 + (i % 5) * PITCH, y: 6 + Math.floor(i / 5) * PITCH });
const GEMS = [1, 7, 8, 16];
const PICK = 12;
const TILE = { covered: '#4A3E35', coveredEdge: '#2F2620', gem: C.amber, gemEdge: '#C47C1F' };

function Covered({ i }: { i: number }) {
  const { x, y } = pos(i);
  return (
    <>
      <rect x={x} y={y + 1.6} width={SIZE} height={SIZE} rx='2.6' fill={TILE.coveredEdge} />
      <rect x={x} y={y} width={SIZE} height={SIZE} rx='2.6' fill={TILE.covered} />
    </>
  );
}

function GemTile({ i }: { i: number }) {
  const { x, y } = pos(i);
  return (
    <>
      <rect x={x} y={y + 1.6} width={SIZE} height={SIZE} rx='2.6' fill={TILE.gemEdge} />
      <rect x={x} y={y} width={SIZE} height={SIZE} rx='2.6' fill={TILE.gem} />
    </>
  );
}

/** The ink gem: a diamond, a little taller than wide. */
function Gem({ i }: { i: number }) {
  const { x, y } = pos(i);
  const cx = x + SIZE / 2;
  const cy = y + SIZE / 2;
  return <path d={`M${cx},${cy - 5} L${cx + 4.4},${cy} L${cx},${cy + 5} L${cx - 4.4},${cy} Z`} fill={C.ink} strokeLinejoin='round' stroke={C.ink} strokeWidth='.8' />;
}

export default function MinesPreview({ still }: PreviewProps) {
  return (
    <PreviewScreen still={still} rest={900}>
      {Array.from({ length: 25 }, (_, i) => {
        if (i === PICK) return null;
        if (GEMS.includes(i))
          return (
            <g key={i}>
              <GemTile i={i} />
              <Gem i={i} />
            </g>
          );
        return <Covered key={i} i={i} />;
      })}
      <Part style={move('flip-out', 340, { delay: 60, ease: 'ease-in-out' })}>
        <Covered i={PICK} />
      </Part>
      <Part style={move('flip-in', 340, { delay: 60, ease: 'ease-in-out' })}>
        <GemTile i={PICK} />
      </Part>
      <Part style={move('pop', 240, { delay: 400, s: 1.4 })}>
        <Gem i={PICK} />
      </Part>
    </PreviewScreen>
  );
}
