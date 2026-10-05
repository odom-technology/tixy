'use client';

/* Keno hover preview — emulates the real Keno board
   (src/app/(games)/keno/_keno-client.tsx): a grid of numbered enamel keycaps
   where the player's picked spots sit in primary-red enamel, then 10 numbers
   are drawn — matched picks light prize-teal (a HIT), unpicked draws light
   amber-ticket (a "ball"). This mini 5×4 slice picks four spots and draws five
   balls, landing two hits, looping. Flat enamel, nothing glows. */

const COLS = 5;
const ROWS = 4;
const CELLS = COLS * ROWS; // 20-cell readable slice

// Picked spots (player's board) and the draw order (balls), with hits where a
// drawn number coincides with a pick.
const PICKS = new Set([2, 6, 11, 17]);
const DRAW_ORDER = [6, 3, 11, 14, 8]; // 6 & 11 are hits

// reveal step (as a fraction of the 3s loop) for each drawn cell
const STEP = 0.5 / DRAW_ORDER.length;

export default function KenoPreview() {
  const drawIndex = new Map<number, number>();
  DRAW_ORDER.forEach((cell, i) => drawIndex.set(cell, i));

  return (
    <div className='absolute inset-0 overflow-hidden gp-keno-root'>
      <div className='gp-keno-board'>
        {Array.from({ length: CELLS }, (_, i) => {
          const picked = PICKS.has(i);
          const order = drawIndex.get(i);
          const drawn = order !== undefined;
          const hit = picked && drawn;
          const cls = hit ? 'is-hit' : drawn ? 'is-ball' : picked ? 'is-pick' : '';
          const delay = drawn ? (0.15 + order! * STEP).toFixed(3) : '0';
          return (
            <span
              className={`gp-keno-cell ${cls}`}
              key={i}
              style={{ ['--d' as string]: `${delay}s` }}
            >
              {i + 1}
            </span>
          );
        })}
      </div>

      <style jsx>{`
        .gp-keno-root {
          background:
            repeating-linear-gradient(
              90deg,
              transparent 0 calc(12.5% - 1px),
              #ffffff08 calc(12.5% - 1px) 12.5%
            ),
            var(--screen-well);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 8%;
        }
        .gp-keno-board {
          display: grid;
          grid-template-columns: repeat(${COLS}, 1fr);
          gap: 5px;
          width: 100%;
          max-width: 90%;
        }
        .gp-keno-cell {
          aspect-ratio: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-mono-arcade);
          font-weight: 700;
          font-size: clamp(7px, 2.4vw, 12px);
          border-radius: var(--radius-tag, 4px);
          border: 1px solid var(--border-ink);
          color: var(--text-body);
          background: linear-gradient(180deg, var(--surface-raised), var(--surface-panel));
          box-shadow: inset 0 1px 0 var(--bevel-hi), inset 0 -2px 4px #00000045,
            0 2px 0 var(--shadow-color);
        }
        .gp-keno-cell.is-pick {
          background: linear-gradient(180deg, var(--enamel-primary-hi), var(--enamel-primary));
          border-color: var(--enamel-primary-edge);
          color: var(--enamel-primary-on);
        }
        .gp-keno-cell.is-ball {
          background: linear-gradient(180deg, var(--enamel-tickets-hi), var(--enamel-tickets));
          border-color: var(--enamel-tickets-edge);
          color: var(--enamel-tickets-on);
          animation: gp-keno-pop 3s ease-in-out infinite;
          animation-delay: var(--d);
        }
        .gp-keno-cell.is-hit {
          background: linear-gradient(180deg, var(--enamel-prize-hi), var(--enamel-prize));
          border-color: var(--enamel-prize-edge);
          color: var(--enamel-prize-on);
          box-shadow: inset 0 1px 0 #ffffff55, 0 0 0 1.5px var(--enamel-tickets),
            0 2px 0 var(--shadow-color);
          animation: gp-keno-pop 3s ease-in-out infinite;
          animation-delay: var(--d);
        }
        /* balls/hits pop in on their step, hold, then reset at loop end */
        @keyframes gp-keno-pop {
          0%,
          4% {
            transform: scale(0.55);
            opacity: 0.15;
          }
          12%,
          92% {
            transform: scale(1);
            opacity: 1;
          }
          100% {
            transform: scale(0.55);
            opacity: 0.15;
          }
        }
      `}</style>
    </div>
  );
}
