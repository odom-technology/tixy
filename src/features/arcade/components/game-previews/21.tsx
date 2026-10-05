/* 21: the machine's table (MACHINES_LOOK.md, "21"). Flat felt in a rail,
   the dealer's up card and hole card at the top, the shoe top right, your
   hand at the bottom with its count and its bet stub in a printed circle
   under it. The move: your second card slides
   out of the shoe onto the ace, and the count pops red, a natural 21. */
import { C, Part, PreviewScreen, Word, Num, move, type PreviewProps } from './kit';

const CARD_W = 22;
const CARD_H = 31;

/* A machine card (wagers/machine-card.css): paper, a hard shadow, the rank
   over a small suit top left and one big suit low right; an ace has one
   big suit in the middle. Uppercase is for playing cards only. */
function Card({ x, y, rank, suit, red }: { x: number; y: number; rank: string; suit: string; red?: boolean }) {
  const ink = red ? C.red : C.ink;
  return (
    <g>
      <rect x={x} y={y + 1.5} width={CARD_W} height={CARD_H} rx='2.5' fill={C.hole} fillOpacity='.35' />
      <rect x={x} y={y} width={CARD_W} height={CARD_H} rx='2.5' fill='#FBF5EA' />
      <Word x={x + 3} y={y + 10} size={9.5} fill={ink} weight={900} anchor='start'>
        {rank}
      </Word>
      <Word x={x + 3.2} y={y + 16.5} size={6} fill={ink} weight={700} anchor='start'>
        {suit}
      </Word>
      {rank === 'A' ? (
        <Word x={x + CARD_W / 2} y={y + CARD_H / 2 + 5.4} size={16} fill={ink} weight={700}>
          {suit}
        </Word>
      ) : (
        <Word x={x + CARD_W - 2} y={y + CARD_H - 2.6} size={13} fill={ink} weight={700} anchor='end'>
          {suit}
        </Word>
      )}
    </g>
  );
}

/* A card back: ink with a faint stub. */
function Back({ x, y, w = CARD_W, h = CARD_H }: { x: number; y: number; w?: number; h?: number }) {
  return (
    <g>
      <rect x={x} y={y + 1.5} width={w} height={h} rx='2.5' fill={C.hole} fillOpacity='.35' />
      <rect x={x} y={y} width={w} height={h} rx='2.5' fill={C.ink} />
      <rect x={x + w / 2 - w * 0.22} y={y + h / 2 - w * 0.13} width={w * 0.44} height={w * 0.26} rx='1.2' fill={C.paper} fillOpacity='.25' />
    </g>
  );
}

/* The bet: a ticket stub with a half-circle notch on each short end. */
function Stub({ x, y, children }: { x: number; y: number; children: string }) {
  const w = 18;
  const h = 10;
  return (
    <g>
      <path
        d={`M${x + 2} ${y}h${w - 4}a2 2 0 0 1 2 2v1.6a1.4 1.4 0 0 0 0 2.8V${y + h - 2}a2 2 0 0 1 -2 2h-${w - 4}a2 2 0 0 1 -2 -2v-1.6a1.4 1.4 0 0 0 0 -2.8V${y + 2}a2 2 0 0 1 2 -2z`}
        fill={C.amber}
      />
      <Num x={x + w / 2} y={y + 8} size={8} fill={C.ink}>
        {children}
      </Num>
    </g>
  );
}

export default function TwentyOnePreview({ still }: PreviewProps) {
  return (
    <PreviewScreen still={still} rest={900}>
      {/* The felt in its rail, with a fine weave. */}
      <rect x='5' y='5' width='150' height='90' rx='9' fill={C.cushion} />
      <rect x='8' y='8' width='144' height='84' rx='7' fill={C.felt} />
      {/* The shoe: a flat ink box top right, two cards standing in it. */}
      <g transform='rotate(-6 136 16)'>
        <rect x='127' y='10' width='17' height='10' rx='1' fill={C.paper} />
        <rect x='129' y='12' width='17' height='10' rx='1' fill='#EADFCB' />
      </g>
      <rect x='124' y='17' width='24' height='11' rx='1.6' fill={C.ink} />
      <rect x='128' y='22' width='16' height='1' fill='#54483D' />

      {/* The dealer: the up card, the hole card, the count on the left. */}
      <rect x='43' y='17' width='13' height='12' rx='3' fill={C.paper} />
      <Num x={49.5} y={26.5} size={10} fill={C.ink}>
        10
      </Num>
      <Card x={60} y={11} rank='10' suit='♣' />
      <Back x={74} y={11} />

      {/* You: the ace, then the king slides out of the shoe onto it. */}
      <Card x={64} y={45} rank='A' suit='♠' />
      <Part style={move('from', 380, { delay: 60, x: 52, y: -30, r: 20, s: 0.6 })}>
        <Card x={78} y={45} rank='K' suit='♥' red />
      </Part>

      {/* Under the hand: its count, which turns red on the natural, and the
          bet stub in its printed circle. */}
      <rect x='60' y='80' width='16' height='13' rx='3' fill={C.paper} />
      <Num x={68} y={90.5} size={11} fill={C.ink}>
        11
      </Num>
      <Part style={move('pop', 260, { delay: 480, s: 1.35, origin: [68, 86] })}>
        <rect x='60' y='80' width='16' height='13' rx='3' fill={C.red} />
        <Num x={68} y={90.5} size={11} fill={C.paper}>
          21
        </Num>
      </Part>
      <circle cx='92' cy='86.5' r='8.6' fill='none' stroke={C.paper} strokeOpacity='.6' strokeWidth='.9' />
      <Stub x={83} y={81.5}>
        10
      </Stub>
    </PreviewScreen>
  );
}
