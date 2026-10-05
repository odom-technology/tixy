/* Hover preview for Sudoku — emulates the real game's Midway look from
 * _sudoku-client.tsx / _sudoku-midway.css: a 9×9 grid of cream keycap cells on
 * an ink cabinet plate with HARD 3×3 box rules (thick ink seams), darker
 * engraved "given" chips, and a few amber player digits that pencil-in one by
 * one. One cell is the amber "selected" key. NOTHING GLOWS — a fill is a hard
 * keycap pop (opacity/transform only). Loops cheaply; degrades under
 * prefers-reduced-motion to a static filled state.
 *
 * To keep the markup small we draw a representative 9×9 with a sparse set of
 * givens + three animated fills, not a full solvable board (it's decorative). */
export default function SudokuPreview() {
  // A representative givens layout (1..9, 0 = blank) — purely visual.
  const givens = [
    5, 0, 0, 0, 7, 0, 0, 0, 2,
    0, 3, 0, 1, 0, 5, 0, 8, 0,
    0, 0, 8, 0, 0, 0, 6, 0, 0,
    0, 6, 0, 0, 9, 0, 0, 1, 0,
    4, 0, 0, 8, 0, 3, 0, 0, 7,
    0, 9, 0, 0, 2, 0, 0, 5, 0,
    0, 0, 1, 0, 0, 0, 3, 0, 0,
    0, 7, 0, 6, 0, 9, 0, 4, 0,
    8, 0, 0, 0, 1, 0, 0, 0, 6,
  ];
  // Cells that animate a player "fill". (index -> digit)
  const fills: Record<number, number> = { 2: 1, 30: 4, 60: 7 };
  const selected = 30;

  return (
    <div className="absolute inset-0 overflow-hidden gp-su">
      <div className="gp-su-board">
        {givens.map((g, i) => {
          const col = i % 9;
          const row = Math.floor(i / 9);
          const boxLeft = col % 3 === 0 && col !== 0;
          const boxTop = row % 3 === 0 && row !== 0;
          const fillDigit = fills[i];
          const cls = [
            'gp-su-cell',
            g !== 0 ? 'gp-su-given' : '',
            fillDigit ? 'gp-su-fill' : '',
            i === selected ? 'gp-su-sel' : '',
            boxLeft ? 'gp-su-bl' : '',
            boxTop ? 'gp-su-bt' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <span
              key={i}
              className={cls}
              style={
                fillDigit
                  ? { ['--fi' as string]: String(Object.keys(fills).indexOf(String(i))) }
                  : undefined
              }
            >
              {g !== 0 ? g : fillDigit ? fillDigit : ''}
            </span>
          );
        })}
      </div>

      <style jsx>{`
        .gp-su {
          background: linear-gradient(180deg, #2a2114 0%, #17110a 100%);
          display: grid;
          place-items: center;
          padding: 7%;
        }
        .gp-su-board {
          width: 100%;
          height: 100%;
          aspect-ratio: 1 / 1;
          display: grid;
          grid-template-columns: repeat(9, 1fr);
          grid-template-rows: repeat(9, 1fr);
          gap: 1px;
          padding: 3px;
          background: #1c160d;
          border-radius: 8px;
          box-shadow:
            inset 0 2px 6px rgba(0, 0, 0, 0.6),
            inset 0 0 0 2px #0f0a06,
            0 3px 0 #00000055,
            0 8px 16px rgba(0, 0, 0, 0.45);
        }
        .gp-su-cell {
          display: grid;
          place-items: center;
          background: linear-gradient(180deg, #f6eddc 0%, #ece0c6 100%);
          color: #1c160d;
          font-family: var(--font-mono-arcade, ui-monospace, monospace);
          font-weight: 600;
          font-size: clamp(7px, 2vw, 13px);
          line-height: 1;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.55),
            inset 0 -1px 2px rgba(0, 0, 0, 0.18),
            inset 0 0 0 1px rgba(0, 0, 0, 0.12);
        }
        /* thick ink rules between the 3×3 boxes */
        .gp-su-bl {
          margin-left: 2px;
        }
        .gp-su-bt {
          margin-top: 2px;
        }
        /* given (clue) chips — darker, engraved */
        .gp-su-given {
          background: linear-gradient(180deg, #e7dabd 0%, #d8c8a6 100%);
          color: #14100a;
          font-weight: 700;
        }
        /* player fills — amber ink, popped in on a beat */
        .gp-su-fill {
          color: #b46b16;
          font-weight: 700;
          animation: gp-su-pop 4.5s ease-in-out infinite;
          animation-delay: calc(var(--fi, 0) * 0.9s + 0.4s);
        }
        /* the selected key — amber enamel face */
        .gp-su-sel {
          background: linear-gradient(180deg, #f7d79a 0%, #f0bf6a 100%);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.5),
            inset 0 -2px 3px rgba(0, 0, 0, 0.28),
            inset 0 0 0 2px #9a621a;
        }

        /* a fill: the digit pops from nothing (scale + fade), held, then resets
           so the loop replays the "writing in" motion. No glow. */
        @keyframes gp-su-pop {
          0%,
          5% {
            color: transparent;
            transform: scale(0.4);
          }
          12% {
            color: #b46b16;
            transform: scale(1.18);
          }
          18%,
          88% {
            color: #b46b16;
            transform: scale(1);
          }
          96%,
          100% {
            color: transparent;
            transform: scale(0.4);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .gp-su-fill {
            animation: none;
            color: #b46b16;
            transform: none;
          }
        }
      `}</style>
    </div>
  );
}
