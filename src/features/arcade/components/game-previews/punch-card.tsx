/* Hover preview for Punch Card — a small nonogram board on the Midway cabinet:
 * cream paper cells with a clue gutter on the top + left, a few dark "punched"
 * pixels forming a little duck, and a couple of X-marks. Cells punch in one by
 * one to hint at the reveal. NOTHING GLOWS. Loops cheaply; degrades under
 * prefers-reduced-motion to the fully-punched picture. Purely decorative — not
 * a real solvable board. */
export default function PunchCardPreview() {
  // A tiny "duck" solution (1 = punched pixel).
  const sol = [
    0, 0, 1, 1, 0,
    0, 1, 1, 1, 1,
    0, 1, 1, 1, 0,
    0, 1, 1, 1, 0,
    0, 0, 1, 1, 0,
  ];
  const xs = new Set([0, 5, 24]);
  // Column + row clue numbers (decorative, roughly matching the duck).
  const colClues = ['2', '3', '5', '4', '2'];
  const rowClues = ['2', '4', '3', '3', '2'];
  // Punch-in animation order for a few cells.
  const order: Record<number, number> = { 2: 0, 7: 1, 12: 2, 17: 3, 23: 4 };

  return (
    <div className="absolute inset-0 overflow-hidden gp-pc">
      <div className="gp-pc-wrap">
        <div className="gp-pc-corner" />
        <div className="gp-pc-cols">
          {colClues.map((v, i) => (
            <span key={i} className="gp-pc-clue">{v}</span>
          ))}
        </div>
        <div className="gp-pc-rows">
          {rowClues.map((v, i) => (
            <span key={i} className="gp-pc-clue">{v}</span>
          ))}
        </div>
        <div className="gp-pc-board">
          {sol.map((v, i) => {
            const cls = [
              'gp-pc-cell',
              v === 1 ? 'gp-pc-fill' : '',
              xs.has(i) ? 'gp-pc-x' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <span
                key={i}
                className={cls}
                style={
                  order[i] !== undefined
                    ? ({ ['--pi' as string]: String(order[i]) })
                    : undefined
                }
              />
            );
          })}
        </div>
      </div>

      <style jsx>{`
        .gp-pc {
          background: linear-gradient(180deg, #2a2114 0%, #17110a 100%);
          display: grid;
          place-items: center;
          padding: 8%;
        }
        .gp-pc-wrap {
          width: 100%;
          height: 100%;
          aspect-ratio: 1 / 1;
          display: grid;
          grid-template-columns: 22% 78%;
          grid-template-rows: 22% 78%;
          gap: 2px;
          padding: 4px;
          background: #1c160d;
          border-radius: 8px;
          box-shadow:
            inset 0 2px 6px rgba(0, 0, 0, 0.6),
            inset 0 0 0 2px #0f0a06,
            0 3px 0 #00000055,
            0 8px 16px rgba(0, 0, 0, 0.45);
        }
        .gp-pc-corner {
          grid-column: 1;
          grid-row: 1;
        }
        .gp-pc-cols {
          grid-column: 2;
          grid-row: 1;
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          align-items: end;
          justify-items: center;
          background: #e6d8b8;
          border-radius: 4px;
          padding-bottom: 4%;
        }
        .gp-pc-rows {
          grid-column: 1;
          grid-row: 2;
          display: grid;
          grid-template-rows: repeat(5, 1fr);
          align-items: center;
          justify-items: end;
          background: #e6d8b8;
          border-radius: 4px;
          padding-right: 8%;
        }
        .gp-pc-clue {
          font-family: var(--font-mono-arcade, ui-monospace, monospace);
          font-weight: 700;
          font-size: clamp(6px, 1.7vw, 11px);
          color: #4a3922;
          line-height: 1;
        }
        .gp-pc-board {
          grid-column: 2;
          grid-row: 2;
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          grid-template-rows: repeat(5, 1fr);
          gap: 1px;
          background: #d3bd93;
          border-radius: 3px;
          overflow: hidden;
        }
        .gp-pc-cell {
          position: relative;
          background: linear-gradient(180deg, #f4ead4 0%, #e7d9bd 100%);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.5),
            inset 0 -2px 2px rgba(0, 0, 0, 0.12);
        }
        .gp-pc-fill {
          background: linear-gradient(180deg, #37291a 0%, #221910 100%);
          box-shadow:
            inset 0 2px 0 rgba(255, 255, 255, 0.12),
            inset 0 -2px 4px rgba(0, 0, 0, 0.55),
            inset 0 0 0 1px #120c06;
          animation: gp-pc-punch 5s ease-in-out infinite;
          animation-delay: calc(var(--pi, 0) * 0.5s + 0.4s);
        }
        .gp-pc-x::before,
        .gp-pc-x::after {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          width: 62%;
          height: 12%;
          border-radius: 2px;
          background: #b0703f;
          opacity: 0.85;
        }
        .gp-pc-x::before {
          transform: translate(-50%, -50%) rotate(45deg);
        }
        .gp-pc-x::after {
          transform: translate(-50%, -50%) rotate(-45deg);
        }

        @keyframes gp-pc-punch {
          0%, 6% {
            transform: scale(0.35);
            opacity: 0.2;
          }
          14% {
            transform: scale(1.12);
            opacity: 1;
          }
          20%, 90% {
            transform: scale(1);
            opacity: 1;
          }
          97%, 100% {
            transform: scale(0.35);
            opacity: 0.2;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .gp-pc-fill {
            animation: none;
            transform: none;
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
