/* Hover preview for Tetris — emulates the real 10-wide × 20-tall well from
 * _tetris-config.ts (COLS 10 / ROWS 20) with the real Midway enamel paints
 * from _tetris-theme.ts: I→#38c6d4 cyan, O→#f2a33c amber, T→#9a52d6 violet,
 * S→#5fc06a green, Z→#c73538 red, J→#3b6fd4 blue, L→#e8a23a orange. Cells use
 * the renderer's bevel recipe (_tetris-renderer.ts drawCell): a bright top
 * highlight band, a soft left edge, and a hard dark bottom shade.
 *
 * Motion: an I-piece (cyan, horizontal, the real PIECE_SHAPES.I row) drops
 * into the well and locks, completing the bottom row, which then flashes amber
 * (tetrisClearColor #f2a33c lineClearStyle 'flash') and the stack settles. */
export default function TetrisPreview() {
  // 10-col well: each cell is 10% wide. Bottom row sits at row 19 (~5% tall
  // cells over a 20-row field, but we use a compact ~9-row visible stack).
  return (
    <div className="absolute inset-0 overflow-hidden gp-tet-well">
      <div className="gp-tet-field">
        {/* faint grid lines like the renderer's 12%-alpha grid */}
        <div className="gp-tet-grid" />

        {/* settled stack — leaves a 4-wide gap on the bottom row for the I */}
        {/* bottom row (y=90%) cols 4..9 filled, cols 0..3 empty for the bar */}
        <i className="gp-tet-cell gp-tet-Z" style={{ left: '40%', top: '90%' }} />
        <i className="gp-tet-cell gp-tet-J" style={{ left: '50%', top: '90%' }} />
        <i className="gp-tet-cell gp-tet-L" style={{ left: '60%', top: '90%' }} />
        <i className="gp-tet-cell gp-tet-T" style={{ left: '70%', top: '90%' }} />
        <i className="gp-tet-cell gp-tet-S" style={{ left: '80%', top: '90%' }} />
        <i className="gp-tet-cell gp-tet-O" style={{ left: '90%', top: '90%' }} />
        {/* second-row debris above the stack */}
        <i className="gp-tet-cell gp-tet-J" style={{ left: '50%', top: '80%' }} />
        <i className="gp-tet-cell gp-tet-J" style={{ left: '60%', top: '80%' }} />
        <i className="gp-tet-cell gp-tet-T" style={{ left: '70%', top: '80%' }} />
        <i className="gp-tet-cell gp-tet-S" style={{ left: '80%', top: '80%' }} />

        {/* falling I-piece (cyan), horizontal 4-wide bar — fills the gap */}
        <div className="gp-tet-faller">
          <i className="gp-tet-cell gp-tet-I" style={{ left: '0%', top: '0%' }} />
          <i className="gp-tet-cell gp-tet-I" style={{ left: '10%', top: '0%' }} />
          <i className="gp-tet-cell gp-tet-I" style={{ left: '20%', top: '0%' }} />
          <i className="gp-tet-cell gp-tet-I" style={{ left: '30%', top: '0%' }} />
        </div>

        {/* amber line-clear flash across the completed bottom row */}
        <div className="gp-tet-flash" />
      </div>

      <style jsx>{`
        .gp-tet-well {
          background: radial-gradient(120% 100% at 50% 45%, #131a16 0%, #0a0e0c 100%);
        }
        /* centered 10-wide well, dark "screen" with ink frame + slight vignette */
        .gp-tet-field {
          position: absolute;
          top: 4%;
          bottom: 4%;
          left: 30%;
          right: 30%;
          background: #0f1512;
          box-shadow:
            0 0 0 2px #0f0a06,
            inset 0 0 18px rgba(0, 0, 0, 0.55);
        }
        .gp-tet-grid {
          position: absolute;
          inset: 0;
          background-image: linear-gradient(
              to right,
              rgba(255, 255, 255, 0.05) 1px,
              transparent 1px
            ),
            linear-gradient(
              to bottom,
              rgba(255, 255, 255, 0.05) 1px,
              transparent 1px
            );
          background-size: 10% 10%;
        }

        /* one grid cell: 10% wide. Bevel = bright top band + dark bottom shade */
        .gp-tet-cell {
          position: absolute;
          width: 10%;
          height: 10%;
          box-sizing: border-box;
          box-shadow:
            inset 0 16% 0 rgba(255, 255, 255, 0.34),
            inset 16% 0 0 rgba(255, 255, 255, 0.18),
            inset 0 -16% 0 rgba(0, 0, 0, 0.55);
        }

        .gp-tet-I { background: #38c6d4; }
        .gp-tet-O { background: #f2a33c; }
        .gp-tet-T { background: #9a52d6; }
        .gp-tet-S { background: #5fc06a; }
        .gp-tet-Z { background: #c73538; }
        .gp-tet-J { background: #3b6fd4; }
        .gp-tet-L { background: #e8a23a; }

        /* falling I bar: spans the empty 4-wide gap (cols 0..3), bottom row */
        .gp-tet-faller {
          position: absolute;
          left: 0;
          top: 90%;
          width: 100%;
          height: 100%;
          animation: gp-tet-fall 3.4s cubic-bezier(0.45, 0, 0.85, 0.35) infinite;
        }

        .gp-tet-flash {
          position: absolute;
          left: 0;
          right: 0;
          top: 90%;
          height: 10%;
          background: #f2a33c;
          opacity: 0;
          animation: gp-tet-flash 3.4s ease-out infinite;
        }

        @keyframes gp-tet-fall {
          0% {
            transform: translateY(-1000%);
          }
          /* drop + lock into the bottom row */
          50% {
            transform: translateY(0);
          }
          64% {
            transform: translateY(0);
          }
          /* row clears: the completed row fades and the stack settles */
          72% {
            transform: translateY(0);
            opacity: 1;
          }
          78% {
            opacity: 0;
          }
          100% {
            transform: translateY(0);
            opacity: 0;
          }
        }

        @keyframes gp-tet-flash {
          0%,
          64% {
            opacity: 0;
          }
          68% {
            opacity: 0.85;
          }
          78% {
            opacity: 0;
          }
          100% {
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
