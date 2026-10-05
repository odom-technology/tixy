/* Hover preview for Dragon Tower: a lacquered-wood tower of beveled keycaps in
 * a recessed well. A teal-flame climber rises row by row from the bottom,
 * lighting the safe tile on each row it clears, while a mono amber multiplier
 * ticks upward through the compounding climb. The top row hides a dark dragon
 * egg. Pure CSS/SVG. Flat matte — NO glow. Loops; reduced-motion safe. */
export default function DragonPreview() {
  const ROWS = 5;
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="gp-dragon-well">
        <div className="gp-dragon-tower">
          {Array.from({ length: ROWS }).map((_, i) => {
            // row 0 = top (the dragon row); row ROWS-1 = bottom (start)
            const climbStep = ROWS - 1 - i; // 0 at bottom .. ROWS-1 at top
            return (
              <div
                key={i}
                className="gp-dragon-row"
                style={{ ['--step' as string]: String(climbStep) }}
              >
                <span className="gp-dragon-tile gp-dragon-tile-l" />
                <span className="gp-dragon-tile gp-dragon-tile-r">
                  {i === 0 ? <span className="gp-dragon-egg" /> : null}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* rising multiplier readout — one tick per row climbed */}
      <div className="gp-dragon-mult">
        <span className="gp-dragon-mult-n gp-dragon-mult-n0">1.45x</span>
        <span className="gp-dragon-mult-n gp-dragon-mult-n1">2.18x</span>
        <span className="gp-dragon-mult-n gp-dragon-mult-n2">3.27x</span>
        <span className="gp-dragon-mult-n gp-dragon-mult-n3">4.91x</span>
      </div>

      <style jsx>{`
        .gp-dragon-well {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          /* recessed dark lacquered screen */
          background: #14100b;
          background-image: repeating-linear-gradient(
            0deg,
            rgba(255, 255, 255, 0.03) 0,
            rgba(255, 255, 255, 0.03) 1px,
            transparent 1px,
            transparent 20%
          );
        }
        .gp-dragon-tower {
          display: flex;
          flex-direction: column;
          gap: 6%;
          width: 64%;
          height: 86%;
          justify-content: center;
        }
        .gp-dragon-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8%;
          flex: 1;
          min-height: 0;
        }
        /* beveled lacquered keycaps */
        .gp-dragon-tile {
          position: relative;
          border-radius: 4px;
          border: 1px solid #0a0704;
          background: linear-gradient(180deg, #3a2c1d, #241a10);
          box-shadow: inset 0 2px 0 rgba(255, 247, 234, 0.12),
            inset 0 -3px 5px rgba(0, 0, 0, 0.5);
        }
        /* the climber lights the LEFT tile of each cleared row as it rises.
         * Each row's left tile becomes a teal-enamel "safe step" exactly while
         * the climber sits on that row, staggered by --step (0 = bottom). */
        .gp-dragon-tile-l {
          animation: gp-dragon-light 3.6s steps(1, end) infinite;
          animation-delay: calc(var(--step) * 0.62s);
        }
        /* dark dragon egg on the top-right tile */
        .gp-dragon-egg {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 42%;
          height: 58%;
          transform: translate(-50%, -50%);
          border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
          background: radial-gradient(120% 100% at 50% 32%, #2a2018, #0c0805);
          border: 1px solid #0a0704;
          box-shadow: inset 0 2px 2px rgba(255, 247, 234, 0.1);
        }
        /* teal-flame climber marker overlaid on the lit step */
        .gp-dragon-tile-l::after {
          content: '';
          position: absolute;
          left: 50%;
          top: 50%;
          width: 46%;
          height: 56%;
          transform: translate(-50%, -50%) scale(0.4);
          border-radius: 50% 50% 50% 50% / 70% 70% 40% 40%;
          background: linear-gradient(180deg, #3fc9b6, #1d8579);
          border: 1px solid #134d44;
          opacity: 0;
          animation: gp-dragon-flame 3.6s steps(1, end) infinite;
          animation-delay: calc(var(--step) * 0.62s);
        }

        /* mono amber multiplier readout, top-left */
        .gp-dragon-mult {
          position: absolute;
          left: 5%;
          top: 7%;
          font-family: var(--font-mono-arcade), monospace;
        }
        .gp-dragon-mult-n {
          position: absolute;
          left: 0;
          top: 0;
          font-size: clamp(11px, 3.4vw, 20px);
          font-weight: 700;
          line-height: 1;
          color: #f2a33c;
          text-shadow: 0 1px 0 rgba(10, 7, 4, 0.85);
          opacity: 0;
        }
        .gp-dragon-mult-n0 {
          animation: gp-dragon-tick0 3.6s steps(1, end) infinite;
        }
        .gp-dragon-mult-n1 {
          animation: gp-dragon-tick1 3.6s steps(1, end) infinite;
        }
        .gp-dragon-mult-n2 {
          animation: gp-dragon-tick2 3.6s steps(1, end) infinite;
        }
        .gp-dragon-mult-n3 {
          animation: gp-dragon-tick3 3.6s steps(1, end) infinite;
        }

        /* a tile lights from when its step is reached until the loop resets */
        @keyframes gp-dragon-light {
          0%,
          12% {
            background: linear-gradient(180deg, #3a2c1d, #241a10);
          }
          16%,
          92% {
            background: linear-gradient(180deg, #2f8d7f, #1a6e62);
          }
          96%,
          100% {
            background: linear-gradient(180deg, #3a2c1d, #241a10);
          }
        }
        @keyframes gp-dragon-flame {
          0%,
          12% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.4);
          }
          16% {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
          }
          92% {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
          }
          96%,
          100% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.4);
          }
        }

        /* multiplier ticks: each value shows only while the climber sits on the
         * matching row, climbing one rung per cleared row. */
        @keyframes gp-dragon-tick0 {
          0%,
          15% {
            opacity: 0;
          }
          16%,
          38% {
            opacity: 1;
          }
          39%,
          100% {
            opacity: 0;
          }
        }
        @keyframes gp-dragon-tick1 {
          0%,
          38% {
            opacity: 0;
          }
          39%,
          61% {
            opacity: 1;
          }
          62%,
          100% {
            opacity: 0;
          }
        }
        @keyframes gp-dragon-tick2 {
          0%,
          61% {
            opacity: 0;
          }
          62%,
          84% {
            opacity: 1;
          }
          85%,
          100% {
            opacity: 0;
          }
        }
        @keyframes gp-dragon-tick3 {
          0%,
          84% {
            opacity: 0;
          }
          85%,
          96% {
            opacity: 1;
          }
          97%,
          100% {
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
