/* Hover preview for Scratch Cards — emulates the real card from
 * _scratch-client.tsx: a beveled lacquered wood frame holds a 3x3 grid of flat
 * enamel symbol cells (hi→base→deep gradient, hard edge, no glow). A brushed
 * gold foil sheet sits on top printed "SCRATCH"; the loop wipes the foil away
 * left→right to uncover the grid, then the three matching star cells (the win
 * line) pop with a hard cream key-edge, and the foil re-forms to loop. Enamel
 * paints mirror SYMBOL_META (star amber, cherry red, bell teal, diamond blue,
 * clover green). transform/opacity/clip-path only — reduced-motion-safe. */

type Cell = { sym: string; win?: boolean };

// 3x3 grid: three amber STARS form the winning line (top row), the rest mixed.
const CELLS: Cell[] = [
  { sym: 'star', win: true },
  { sym: 'star', win: true },
  { sym: 'star', win: true },
  { sym: 'cherry' },
  { sym: 'bell' },
  { sym: 'diamond' },
  { sym: 'clover' },
  { sym: 'cherry' },
  { sym: 'bell' },
];

const GLYPH: Record<string, string> = {
  star: '★',
  cherry: '🍒',
  bell: '🔔',
  diamond: '◆',
  clover: '♣',
};

export default function ScratchPreview() {
  return (
    <div className="absolute inset-0 overflow-hidden gp-sc">
      <div className="gp-sc-frame">
        <div className="gp-sc-grid">
          {CELLS.map((c, i) => (
            <span
              key={i}
              className={`gp-sc-cell gp-sc-${c.sym}${c.win ? ' gp-sc-cell-win' : ''}`}
            >
              {GLYPH[c.sym]}
            </span>
          ))}
        </div>

        {/* brushed gold foil that wipes away to reveal the grid */}
        <div className="gp-sc-foil">
          <span className="gp-sc-foil-ink">SCRATCH</span>
        </div>
      </div>

      <style jsx>{`
        .gp-sc {
          background: linear-gradient(180deg, #15110d, #0c0907);
          display: grid;
          place-items: center;
        }
        .gp-sc-frame {
          position: relative;
          width: 74%;
          aspect-ratio: 3 / 2;
          border-radius: 12px;
          border: 2px solid #1c160d;
          background: linear-gradient(180deg, #241a10, #160f08);
          box-shadow:
            inset 0 2px 0 rgba(255, 255, 255, 0.06),
            0 5px 0 rgba(0, 0, 0, 0.4),
            0 9px 16px rgba(0, 0, 0, 0.45);
          padding: 5%;
          overflow: hidden;
        }
        .gp-sc-grid {
          position: absolute;
          inset: 5%;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          grid-template-rows: repeat(3, 1fr);
          gap: 4%;
        }
        .gp-sc-cell {
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 7px;
          border: 1.5px solid var(--c-edge);
          background: linear-gradient(
            180deg,
            var(--c-hi) 0%,
            var(--c-base) 52%,
            var(--c-deep) 100%
          );
          box-shadow:
            inset 0 2px 0 rgba(255, 255, 255, 0.22),
            inset 0 -2px 3px rgba(0, 0, 0, 0.3);
          font-size: clamp(10px, 4vw, 22px);
          line-height: 1;
          color: var(--c-on);
          text-shadow: 0 1px 0 rgba(0, 0, 0, 0.35);
        }
        /* enamel ladder (mirrors SYMBOL_META) */
        .gp-sc-star {
          --c-hi: #f4c057;
          --c-base: #e0a23a;
          --c-deep: #9a621a;
          --c-edge: #7a4e16;
          --c-on: #2a1b06;
        }
        .gp-sc-cherry {
          --c-hi: #d34b4e;
          --c-base: #c73538;
          --c-deep: #7e2225;
          --c-edge: #5a181b;
          --c-on: #ffefe4;
        }
        .gp-sc-bell {
          --c-hi: #46cdbb;
          --c-base: #2fb8a6;
          --c-deep: #1b7466;
          --c-edge: #145a51;
          --c-on: #04231e;
        }
        .gp-sc-diamond {
          --c-hi: #5aa0db;
          --c-base: #3a86c4;
          --c-deep: #1f547e;
          --c-edge: #163e5e;
          --c-on: #04161f;
        }
        .gp-sc-clover {
          --c-hi: #5fb56f;
          --c-base: #3f9d52;
          --c-deep: #1f5a2c;
          --c-edge: #174422;
          --c-on: #04210b;
        }
        /* winning cells: hard cream key-edge ring + a small pop, timed to the
           moment the foil has cleared. No glow. */
        .gp-sc-cell-win {
          outline: 2.5px solid #f6eddc;
          outline-offset: -1px;
          animation: gp-sc-pop 3.4s ease-in-out infinite;
        }
        .gp-sc-cell-win:nth-child(2) {
          animation-delay: 0.08s;
        }
        .gp-sc-cell-win:nth-child(3) {
          animation-delay: 0.16s;
        }

        /* brushed gold foil sheet over the grid; wipes away L→R then re-forms */
        .gp-sc-foil {
          position: absolute;
          inset: 5%;
          border-radius: 7px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(120deg, #b9a06a 0%, #9c854f 50%, #7d693b 100%);
          background-size: cover;
          box-shadow: inset 0 0 0 3px rgba(0, 0, 0, 0.35);
          /* brushed striations via a repeating overlay */
          animation: gp-sc-wipe 3.4s ease-in-out infinite;
          will-change: clip-path, opacity;
        }
        .gp-sc-foil::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: 7px;
          background: repeating-linear-gradient(
            12deg,
            rgba(255, 255, 255, 0.07) 0 2px,
            transparent 2px 7px
          );
        }
        .gp-sc-foil-ink {
          font-family: var(--font-display), ui-sans-serif, system-ui, sans-serif;
          font-weight: 800;
          font-size: clamp(7px, 2.6vw, 15px);
          letter-spacing: 0.08em;
          color: rgba(42, 27, 6, 0.55);
        }

        /* foil wipe: full → cleared (clip from the right) → hold cleared →
           re-form. clip-path inset shrinks the visible foil to the right edge,
           then snaps back to full to loop. */
        @keyframes gp-sc-wipe {
          0% {
            clip-path: inset(0 0 0 0);
            opacity: 1;
          }
          8% {
            clip-path: inset(0 0 0 0);
            opacity: 1;
          }
          42% {
            clip-path: inset(0 0 0 100%);
            opacity: 1;
          }
          /* held cleared while the win pops */
          92% {
            clip-path: inset(0 0 0 100%);
            opacity: 1;
          }
          /* re-form for the loop */
          100% {
            clip-path: inset(0 0 0 0);
            opacity: 1;
          }
        }

        @keyframes gp-sc-pop {
          0%,
          44% {
            transform: scale(1);
          }
          /* pop right after the foil finishes clearing (~42%) */
          50% {
            transform: scale(1.12);
          }
          60%,
          100% {
            transform: scale(1);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .gp-sc-foil {
            animation: none;
            clip-path: inset(0 0 0 100%);
          }
          .gp-sc-cell-win {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
