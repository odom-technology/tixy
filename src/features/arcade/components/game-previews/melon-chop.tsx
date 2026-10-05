/* Hover preview for Melon Chop — emulates the real game's default Midway look:
 * a carnival booth with enamel bunting over a chopping board, a piece of fruit
 * lobbed up in a ballistic arc, a blade streak that swipes across it, and a
 * juice splat. Hard bevels; NOTHING glows. Pure CSS, loops cheaply (mounted
 * only while the card is hovered). */
export default function MelonChopPreview() {
  return (
    <div className="absolute inset-0 overflow-hidden gp-mc-screen">
      <div className="gp-mc-field">
        {/* enamel bunting swag */}
        <span className="gp-mc-bunting" />
        {/* chopping board along the bottom */}
        <span className="gp-mc-board" />
        {/* a fruit lobbed up in an arc, sliced mid-flight */}
        <span className="gp-mc-fruit" />
        {/* the blade streak that swipes across */}
        <span className="gp-mc-blade" />
        {/* juice splat where it's cut */}
        <span className="gp-mc-splat gp-mc-splat-a" />
        <span className="gp-mc-splat gp-mc-splat-b" />
        <span className="gp-mc-splat gp-mc-splat-c" />
      </div>

      <style jsx>{`
        .gp-mc-screen {
          background: radial-gradient(120% 100% at 50% 30%, #123028 0%, #071612 100%);
        }
        .gp-mc-field {
          position: absolute;
          inset: 6% 12%;
          overflow: hidden;
          box-shadow:
            0 0 0 2px #06120d,
            inset 0 0 20px rgba(0, 0, 0, 0.55);
        }

        .gp-mc-bunting {
          position: absolute;
          left: 0;
          right: 0;
          top: 4%;
          height: 12%;
          background: repeating-linear-gradient(
            90deg,
            #c33b3c 0 8%,
            #e8a23c 8% 16%,
            #2bb2a0 16% 24%
          );
          clip-path: polygon(
            0 0, 100% 0, 100% 40%,
            96% 100%, 92% 40%, 88% 100%, 84% 40%, 80% 100%, 76% 40%,
            72% 100%, 68% 40%, 64% 100%, 60% 40%, 56% 100%, 52% 40%,
            48% 100%, 44% 40%, 40% 100%, 36% 40%, 32% 100%, 28% 40%,
            24% 100%, 20% 40%, 16% 100%, 12% 40%, 8% 100%, 4% 40%, 0 100%
          );
          opacity: 0.85;
        }

        .gp-mc-board {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          height: 26%;
          background:
            repeating-linear-gradient(90deg, #1c4034 0 14%, #17362b 14% 15%),
            #1c4034;
          box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.16);
        }

        /* the flying fruit: rises + falls in a parabola, spinning */
        .gp-mc-fruit {
          position: absolute;
          left: 20%;
          bottom: 24%;
          width: 22%;
          aspect-ratio: 1 / 1;
          border-radius: 50%;
          background: radial-gradient(circle at 38% 34%, #ff8aa0 0%, #d63b56 100%);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.4),
            0 0 0 3px #3c8a4a;
          animation: gp-mc-arc 3.4s ease-in-out infinite;
        }

        /* the blade: a bright streak that sweeps diagonally across the fruit */
        .gp-mc-blade {
          position: absolute;
          left: 8%;
          top: 30%;
          width: 84%;
          height: 5%;
          border-radius: 999px;
          background: linear-gradient(90deg, transparent 0%, #ffffff 50%, transparent 100%);
          transform: translateY(0) rotate(-24deg) scaleX(0);
          transform-origin: left center;
          opacity: 0;
          animation: gp-mc-slice 3.4s ease-out infinite;
        }

        .gp-mc-splat {
          position: absolute;
          left: 42%;
          top: 40%;
          width: 6%;
          aspect-ratio: 1 / 1;
          border-radius: 50%;
          background: #e34d63;
          opacity: 0;
        }
        .gp-mc-splat-a { animation: gp-mc-splat-a 3.4s ease-out infinite; }
        .gp-mc-splat-b { animation: gp-mc-splat-b 3.4s ease-out infinite; }
        .gp-mc-splat-c { left: 48%; top: 44%; background: #ffd7de; animation: gp-mc-splat-c 3.4s ease-out infinite; }

        @keyframes gp-mc-arc {
          0% { left: 16%; bottom: 20%; transform: rotate(0deg); }
          40% { left: 42%; bottom: 60%; transform: rotate(200deg); }
          50% { left: 48%; bottom: 62%; transform: rotate(240deg); opacity: 1; }
          52% { opacity: 0; }
          58% { opacity: 0; }
          100% { left: 72%; bottom: 20%; transform: rotate(360deg); opacity: 0; }
        }
        @keyframes gp-mc-slice {
          0%, 44% { opacity: 0; transform: translateY(60px) rotate(-24deg) scaleX(0); }
          48% { opacity: 1; transform: translateY(0) rotate(-24deg) scaleX(1); }
          58% { opacity: 0; transform: translateY(-30px) rotate(-24deg) scaleX(1); }
          100% { opacity: 0; }
        }
        @keyframes gp-mc-splat-a {
          0%, 48% { opacity: 0; transform: translate(0, 0) scale(0.5); }
          52% { opacity: 0.95; transform: translate(0, 0) scale(1); }
          70% { opacity: 0; transform: translate(-160%, 120%) scale(0.6); }
          100% { opacity: 0; }
        }
        @keyframes gp-mc-splat-b {
          0%, 48% { opacity: 0; transform: translate(0, 0) scale(0.5); }
          52% { opacity: 0.95; transform: translate(0, 0) scale(1); }
          70% { opacity: 0; transform: translate(150%, 130%) scale(0.6); }
          100% { opacity: 0; }
        }
        @keyframes gp-mc-splat-c {
          0%, 48% { opacity: 0; transform: translate(0, 0) scale(0.4); }
          52% { opacity: 0.9; transform: translate(0, 0) scale(0.9); }
          70% { opacity: 0; transform: translate(40%, 170%) scale(0.5); }
          100% { opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .gp-mc-fruit,
          .gp-mc-blade,
          .gp-mc-splat-a,
          .gp-mc-splat-b,
          .gp-mc-splat-c {
            animation: none;
          }
          .gp-mc-fruit { left: 42%; bottom: 52%; }
          .gp-mc-blade { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
