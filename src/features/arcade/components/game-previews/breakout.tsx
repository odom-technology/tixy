/* Hover preview for Breakout — emulates the real game's default Midway look
 * from _breakout-client.tsx: a recessed dark cabinet "screen" (#0f1512 well)
 * holding rows of enamel bricks banded red → amber → teal (the real ROW_POINTS
 * palette: #c73538 red, #f2a33c amber, #2fb8a6 teal, each with a hard top
 * highlight + offset bottom edge), a cream keycap paddle (#f6eddc) at the
 * bottom, and a cream ball chip that bounces. NOTHING glows — a brick break is
 * a hard shard/flash via opacity + transform.
 *
 * Motion: the ball arcs up into the brick wall; one teal brick "breaks" (a hard
 * flash + shard burst, no glow) while the paddle slides under the ball. */
export default function BreakoutPreview() {
  return (
    <div className="absolute inset-0 overflow-hidden gp-bk-well">
      {/* brick wall — 3 enamel bands (red / amber / teal) */}
      <div className="gp-bk-wall">
        {/* red row */}
        <i className="gp-bk-brick gp-bk-red" style={{ left: '6%' }} />
        <i className="gp-bk-brick gp-bk-red" style={{ left: '28%' }} />
        <i className="gp-bk-brick gp-bk-red" style={{ left: '50%' }} />
        <i className="gp-bk-brick gp-bk-red" style={{ left: '72%' }} />
      </div>
      <div className="gp-bk-wall gp-bk-wall-2">
        <i className="gp-bk-brick gp-bk-amber" style={{ left: '6%' }} />
        <i className="gp-bk-brick gp-bk-amber" style={{ left: '28%' }} />
        <i className="gp-bk-brick gp-bk-amber" style={{ left: '50%' }} />
        <i className="gp-bk-brick gp-bk-amber" style={{ left: '72%' }} />
      </div>
      <div className="gp-bk-wall gp-bk-wall-3">
        <i className="gp-bk-brick gp-bk-teal" style={{ left: '6%' }} />
        {/* this teal brick breaks */}
        <i className="gp-bk-brick gp-bk-teal gp-bk-breaking" style={{ left: '28%' }} />
        <i className="gp-bk-brick gp-bk-teal" style={{ left: '50%' }} />
        <i className="gp-bk-brick gp-bk-teal" style={{ left: '72%' }} />
      </div>

      {/* shard burst at the breaking brick (hard flash, no glow) */}
      <div className="gp-bk-shards">
        <span style={{ ['--dx' as string]: '-14px', ['--dy' as string]: '-12px' }} />
        <span style={{ ['--dx' as string]: '12px', ['--dy' as string]: '-14px' }} />
        <span style={{ ['--dx' as string]: '-10px', ['--dy' as string]: '10px' }} />
        <span style={{ ['--dx' as string]: '14px', ['--dy' as string]: '8px' }} />
      </div>

      {/* cream ball chip, bouncing up to the wall and back */}
      <div className="gp-bk-ball" />

      {/* cream keycap paddle sliding along the bottom */}
      <div className="gp-bk-paddle" />

      <style jsx>{`
        .gp-bk-well {
          background: linear-gradient(180deg, #0f1512 0%, #080b0a 100%);
          box-shadow: inset 0 0 22px rgba(0, 0, 0, 0.55);
        }

        /* ── brick rows ── */
        .gp-bk-wall {
          position: absolute;
          left: 0;
          right: 0;
          top: 14%;
          height: 11%;
        }
        .gp-bk-wall-2 {
          top: 27%;
        }
        .gp-bk-wall-3 {
          top: 40%;
        }
        .gp-bk-brick {
          position: absolute;
          top: 0;
          width: 22%;
          height: 100%;
          box-shadow:
            inset 0 22% 0 rgba(255, 255, 255, 0.2),
            inset 0 -22% 0 rgba(0, 0, 0, 0.4),
            1px 2px 0 rgba(0, 0, 0, 0.35);
        }
        .gp-bk-red {
          background: #c73538;
        }
        .gp-bk-amber {
          background: #f2a33c;
        }
        .gp-bk-teal {
          background: #2fb8a6;
        }

        /* breaking brick: hard flash to white then vanish (opacity + scale) */
        .gp-bk-breaking {
          transform-origin: 50% 50%;
          animation: gp-bk-break 2.8s ease-out infinite;
        }

        /* ── shard burst ── */
        .gp-bk-shards {
          position: absolute;
          left: calc(28% + 11%);
          top: calc(40% + 5.5%);
          width: 0;
          height: 0;
        }
        .gp-bk-shards span {
          position: absolute;
          width: 4px;
          height: 4px;
          margin-left: -2px;
          margin-top: -2px;
          background: #46cdbb;
          opacity: 0;
          animation: gp-bk-shard 2.8s ease-out infinite;
        }

        /* ── ball ── */
        .gp-bk-ball {
          position: absolute;
          left: 36%;
          bottom: 14%;
          width: 5%;
          height: 8%;
          border-radius: 50%;
          background: radial-gradient(circle at 38% 32%, #ffffff 0%, #f6eddc 60%, #b9ad95 100%);
          box-shadow: 1px 1px 0 rgba(0, 0, 0, 0.4);
          animation: gp-bk-ball 2.8s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }

        /* ── paddle ── */
        .gp-bk-paddle {
          position: absolute;
          bottom: 8%;
          left: 30%;
          width: 24%;
          height: 6%;
          background: linear-gradient(180deg, #ffffff 0%, #f6eddc 40%, #b9ad95 100%);
          box-shadow: 1px 2px 0 rgba(0, 0, 0, 0.4);
          animation: gp-bk-paddle 2.8s ease-in-out infinite;
        }

        @keyframes gp-bk-break {
          0%,
          40% {
            background: #2fb8a6;
            opacity: 1;
            transform: scale(1);
          }
          /* ball arrives ~48%: hard white flash, then shatter away */
          48% {
            background: #ffffff;
            opacity: 1;
            transform: scale(1.12);
          }
          60% {
            opacity: 0;
            transform: scale(0.6);
          }
          100% {
            opacity: 0;
            transform: scale(0.6);
          }
        }

        @keyframes gp-bk-shard {
          0%,
          46% {
            opacity: 0;
            transform: translate(0, 0) scale(1);
          }
          50% {
            opacity: 1;
            transform: translate(0, 0) scale(1);
          }
          78% {
            opacity: 0;
            transform: translate(var(--dx), var(--dy)) scale(0.5);
          }
          100% {
            opacity: 0;
          }
        }

        /* ball: rests near paddle, arcs up to the teal row (~48%), back down */
        @keyframes gp-bk-ball {
          0% {
            left: 36%;
            bottom: 16%;
          }
          48% {
            left: 30%;
            bottom: 52%;
          }
          100% {
            left: 44%;
            bottom: 16%;
          }
        }

        /* paddle slides to stay under the returning ball */
        @keyframes gp-bk-paddle {
          0% {
            left: 28%;
          }
          50% {
            left: 24%;
          }
          100% {
            left: 36%;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .gp-bk-breaking,
          .gp-bk-shards span,
          .gp-bk-ball,
          .gp-bk-paddle {
            animation: none;
          }
          .gp-bk-ball {
            bottom: 30%;
            left: 36%;
          }
        }
      `}</style>
    </div>
  );
}
