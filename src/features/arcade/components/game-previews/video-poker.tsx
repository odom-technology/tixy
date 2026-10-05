/* Video poker: the machine (video-poker/_video-poker-client.tsx). The
   paytable on the glass, five machine cards (rank over suit top left, a big
   suit low right), the two held aces lifted with their amber tags, and a
   hold key under each card. The move: the other three turn on the draw, a
   third ace lands, the paying cards lift with a red bar, the rest step back,
   and the three of a kind row lights red. */
import { C, EASE, Num, Part, PreviewScreen, Word, move, type PreviewProps } from './kit';

const W = 25;
const H = 35;
const GAP = 4;
const cardX = (i: number) => 80 - (5 * W + 4 * GAP) / 2 + i * (W + GAP);
const Y = 34;
const FACE = '#FBF5EA';
const HELD = [0, 1];
const AFTER = ['A♠', 'A♥', '7♣', 'A♦', 'K♠'];
const PAID = [0, 1, 3];
const DRAW = 60;
const PAY = 520;
const red = (face: string) => /[♥♦]/.test(face);

function Card({ i, face, y = Y }: { i: number; face: string; y?: number }) {
  const x = cardX(i);
  const rank = face.slice(0, -1);
  const suit = face.slice(-1);
  const ink = red(face) ? C.red : C.ink;
  return (
    <>
      <rect x={x} y={y + 1.2} width={W} height={H} rx='2' fill={C.hole} fillOpacity='.32' />
      <rect x={x} y={y} width={W} height={H} rx='2' fill={FACE} />
      <Word x={x + 3} y={y + 10} size={10} fill={ink} weight={900} anchor='start'>
        {rank}
      </Word>
      <Word x={x + 3.3} y={y + 16} size={5.6} fill={ink} weight={700} anchor='start'>
        {suit}
      </Word>
      {rank === 'A' ? (
        <Word x={x + W / 2 + 1} y={y + H / 2 + 6.4} size={18} fill={ink} weight={700}>
          {suit}
        </Word>
      ) : (
        <Word x={x + W - 2.4} y={y + H - 3.4} size={14} fill={ink} weight={700} anchor='end'>
          {suit}
        </Word>
      )}
    </>
  );
}

function Back({ i }: { i: number }) {
  const x = cardX(i);
  return (
    <>
      <rect x={x} y={Y} width={W} height={H} rx='2' fill={C.ink} />
      <rect x={x + 2} y={Y + 2} width={W - 4} height={H - 4} rx='1.2' fill='none' stroke={C.screen2} strokeWidth='.8' />
      <rect x={x + W / 2 - 5} y={Y + H / 2 - 3} width='10' height='6' rx='1' fill={C.paper} fillOpacity='.24' />
    </>
  );
}

/** The paytable on the glass: the rows nearest the hand, small. */
const PAYS: [string, string][] = [
  ['four of a kind', '25×'],
  ['three of a kind', '3×'],
  ['two pair', '2×'],
];

export default function VideoPokerPreview({ still }: PreviewProps) {
  return (
    <PreviewScreen still={still} rest={900}>
      <rect x='0' y='0' width='160' height='17' fill={C.screen2} />
      {PAYS.map(([name, pay], k) => {
        const x = 8 + k * 50;
        return (
          <g key={name}>
            <Word x={x} y={11} size={5.2} fill='#C9C1B4' weight={400} anchor='start'>
              {name}
            </Word>
            <Num x={x + 44} y={11.4} size={6.4} fill={C.paper} anchor='end'>
              {pay}
            </Num>
          </g>
        );
      })}
      <Part style={move('on', 120, { delay: PAY })}>
        <rect x='55' y='3' width='50' height='11' rx='1.6' fill={C.red} />
        <Word x={58} y={11} size={5.2} fill={C.paper} weight={700} anchor='start'>
          three of a kind
        </Word>
        <Num x={102} y={11.4} size={6.4} fill={C.paper} anchor='end'>
          3×
        </Num>
      </Part>
      {/* The held aces, lifted, with their tags. */}
      {HELD.map((i) => (
        <g key={i}>
          <rect x={cardX(i) + 3} y={Y - 12} width={W - 6} height='7' rx='1.6' fill={C.amber} />
          <Word x={cardX(i) + W / 2} y={Y - 6.8} size={5.4} fill={C.ink} weight={700}>
            held
          </Word>
          <Card i={i} face={AFTER[i]} y={Y - 3} />
        </g>
      ))}
      {/* The draw: three cards turn. */}
      {[2, 3, 4].map((i, k) => (
        <g key={i}>
          <Part style={move('flip-out', 240, { delay: DRAW + k * 90, ease: 'ease-in-out' })}>
            <Back i={i} />
          </Part>
          <Part style={move('flip-in', 240, { delay: DRAW + k * 90, ease: 'ease-in-out' })}>
            <Part style={move('to', 180, { delay: PAY, y: i === 3 ? -3 : 0, o: i === 3 ? 1 : 0.55, ease: EASE.out })}>
              <Card i={i} face={AFTER[i]} />
            </Part>
          </Part>
        </g>
      ))}
      {/* The paying cards' red bars. */}
      {PAID.map((i) => (
        <Part key={i} style={move('on', 140, { delay: PAY + 60 })}>
          <rect x={cardX(i) + W * 0.15} y={Y + H + 1.6} width={W * 0.7} height='2' rx='1' fill={C.red} />
        </Part>
      ))}
      {/* The hold keys: amber under the held cards. */}
      {[0, 1, 2, 3, 4].map((i) => {
        const held = HELD.includes(i);
        return (
          <g key={i}>
            <rect x={cardX(i)} y='80' width={W} height='12' rx='2.4' fill={held ? C.amber : C.screen2} />
            <circle cx={cardX(i) + W / 2} cy='86' r='2.2' fill={held ? C.ink : '#54483D'} />
          </g>
        );
      })}
    </PreviewScreen>
  );
}
