/* Checkers hover preview — Midway lacquered draughts board.
 *
 * Matches the in-game look (_checkers.css): warm cream / cocoa squares on an
 * espresso frame, cream + enamel-red discs with hard bevels, a gold crown on
 * kings. NOTHING GLOWS.
 *
 * Motion: a cream disc jumps an enamel-red man — it lifts, arcs diagonally over
 * the red disc (which crumples + fades as it's captured), and lands two squares
 * on with a settle bounce. A crowned red king sits in the corner for context.
 * The amber last-move wash marks the origin + landing squares. Then it re-racks.
 *
 * Pure CSS/Tailwind, no JS/canvas. Mounted only on hover, so the infinite loops
 * are fine (no reduced-motion branch needed — but transforms are subtle).
 */

const LIGHT_SQ = '#e9d3a8';
const DARK_SQ = '#a06a3f';
const FRAME = '#1c130a';

export default function CheckersPreview() {
  return (
    <div className='absolute inset-0 overflow-hidden gp-ck-root'>
      <div className='gp-ck-board'>
        <div className='gp-ck-squares' />

        {/* amber last-move wash on origin + landing */}
        <div className='gp-ck-lastmove gp-ck-lm-from' />
        <div className='gp-ck-lastmove gp-ck-lm-to' />

        {/* a settled red KING in the corner, for company */}
        <div className='gp-ck-piece gp-ck-king'>
          <span className='gp-ck-disc gp-ck-disc-red'>
            <svg className='gp-ck-crown' viewBox='0 0 24 24' aria-hidden>
              <path d='M4 9 L7.5 13 L12 7 L16.5 13 L20 9 L18.5 18 L5.5 18 Z' fill='#e8b23a' stroke='#7a5a14' strokeWidth='1.1' strokeLinejoin='round' />
            </svg>
          </span>
        </div>

        {/* red man that gets jumped */}
        <div className='gp-ck-piece gp-ck-victim'>
          <span className='gp-ck-disc gp-ck-disc-red' />
        </div>

        {/* cream disc: jumps the red man diagonally */}
        <div className='gp-ck-piece gp-ck-jumper'>
          <span className='gp-ck-disc gp-ck-disc-cream' />
        </div>
      </div>

      <style jsx>{`
        .gp-ck-root {
          background: var(--screen-well);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .gp-ck-board {
          position: relative;
          width: 78%;
          height: 78%;
          border-radius: 4px;
          background: linear-gradient(150deg, #3a2614, ${FRAME});
          padding: 4.2%;
          box-shadow: inset 0 1px 0 rgba(74, 56, 34, 0.55),
            inset 0 -2px 5px rgba(0, 0, 0, 0.6),
            0 5px 14px rgba(0, 0, 0, 0.5);
        }
        .gp-ck-squares {
          position: absolute;
          inset: 4.2%;
          border-radius: 1px;
          overflow: hidden;
          background-color: ${LIGHT_SQ};
          background-image: conic-gradient(
            ${DARK_SQ} 90deg,
            transparent 90deg 180deg,
            ${DARK_SQ} 180deg 270deg,
            transparent 270deg
          );
          background-size: 25% 25%;
          background-position: 0 0;
          box-shadow: inset 0 0 10px rgba(28, 19, 10, 0.55);
        }

        /* one square = 11.45% of the board; centre of (file f, row r from top):
             left = 4.2% + (f + 0.5) * 11.45%
             top  = 4.2% + (r + 0.5) * 11.45% */
        .gp-ck-lastmove {
          position: absolute;
          width: 11.45%;
          height: 11.45%;
          border-radius: 1px;
          background: rgba(242, 163, 60, 0.42);
          box-shadow: inset 0 0 0 1px rgba(242, 163, 60, 0.3);
          z-index: 2;
          animation: gp-ck-lm 4.2s ease-in-out infinite;
          opacity: 0;
        }
        /* origin: file 2, row 5 */
        .gp-ck-lm-from { left: 28.85%; top: 61.9%; }
        /* landing: file 4, row 3 */
        .gp-ck-lm-to { left: 51.75%; top: 39%; }

        .gp-ck-piece {
          position: absolute;
          width: 11.45%;
          height: 11.45%;
          left: 0;
          top: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 3;
        }
        .gp-ck-disc {
          position: relative;
          width: 78%;
          height: 78%;
          border-radius: 999px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow:
            inset 0 2px 1px rgb(255 255 255 / 0.35),
            inset 0 -3px 4px rgb(0 0 0 / 0.45),
            0 2px 0 rgb(0 0 0 / 0.5),
            0 3px 5px rgb(0 0 0 / 0.4);
        }
        .gp-ck-disc::before {
          content: '';
          position: absolute;
          inset: 16%;
          border-radius: 999px;
          box-shadow: inset 0 0 0 2px rgb(0 0 0 / 0.18);
        }
        .gp-ck-disc-red {
          background: radial-gradient(circle at 38% 32%, #d8514c, #c43a36 58%, #7c1f1d);
          border: 1px solid #7c1f1d;
        }
        .gp-ck-disc-cream {
          background: radial-gradient(circle at 38% 32%, #fff7e8, #f3e7cf 58%, #b9a274);
          border: 1px solid #b9a274;
        }
        .gp-ck-crown {
          width: 52%;
          height: 52%;
          filter: drop-shadow(0 1px 0 rgb(0 0 0 / 0.45));
        }

        /* red king sits on file 6, row 1 */
        .gp-ck-king { left: 74.65%; top: 16.1%; z-index: 3; }

        /* victim red man on file 3, row 4 (between origin and landing) */
        .gp-ck-victim {
          left: 40.3%;
          top: 50.45%;
          z-index: 3;
          animation: gp-ck-capture 4.2s ease-in-out infinite;
        }

        /* cream jumper: file 2 row 5 → file 4 row 3 (jump over the red man) */
        .gp-ck-jumper {
          left: 28.85%;
          top: 61.9%;
          z-index: 5;
          animation: gp-ck-jump 4.2s cubic-bezier(0.35, 0, 0.25, 1) infinite;
        }

        @keyframes gp-ck-jump {
          0%, 14% {
            left: 28.85%;
            top: 61.9%;
            transform: translateY(0) scale(1);
          }
          /* lift + arc over the red man */
          32% {
            left: 40.3%;
            top: 50.45%;
            transform: translateY(-22%) scale(1.08);
          }
          /* land on file 4 row 3 */
          46% {
            left: 51.75%;
            top: 39%;
            transform: translateY(3%) scale(0.95);
          }
          52% {
            transform: translateY(-3%) scale(1.02);
          }
          58%, 90% {
            left: 51.75%;
            top: 39%;
            transform: translateY(0) scale(1);
          }
          100% {
            left: 28.85%;
            top: 61.9%;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes gp-ck-capture {
          0%, 30% { opacity: 1; transform: scale(1) rotate(0deg); }
          40% { opacity: 0.5; transform: scale(0.72) rotate(-10deg); }
          48% { opacity: 0; transform: scale(0.45) rotate(-16deg); }
          92% { opacity: 0; transform: scale(0.45) rotate(-16deg); }
          96%, 100% { opacity: 1; transform: scale(1) rotate(0deg); }
        }

        @keyframes gp-ck-lm {
          0%, 36% { opacity: 0; }
          50%, 88% { opacity: 1; }
          96%, 100% { opacity: 0; }
        }

        @media (prefers-reduced-motion: reduce) {
          .gp-ck-jumper,
          .gp-ck-victim,
          .gp-ck-lastmove {
            animation: none;
          }
          .gp-ck-jumper { left: 51.75%; top: 39%; }
          .gp-ck-victim { opacity: 0; }
          .gp-ck-lastmove { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
