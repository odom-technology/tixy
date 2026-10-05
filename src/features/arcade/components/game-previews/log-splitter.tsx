/* Hover preview for Log Splitter — emulates the real game's default Midway look
 * from _log-splitter-client.tsx: a dusk sky over a ground band, a vertical tree
 * trunk with branches sticking out left/right, a draining time bar up top, and a
 * lumberjack at the base who swings his axe. Hard bevels + offset shadows;
 * NOTHING glows.
 *
 * Motion: the axe swings down onto the trunk on a loop; on each strike a couple
 * of wood chips fly off and the time bar refills with a quick jump then drains —
 * exactly the real loop's "chop + refill" feedback. Pure CSS, loops cheaply
 * (mounted only while the card is hovered). */
export default function LogSplitterPreview() {
  return (
    <div className="absolute inset-0 overflow-hidden gp-ls-screen">
      <div className="gp-ls-field">
        {/* draining/refilling time bar */}
        <span className="gp-ls-bar">
          <i className="gp-ls-bar-fill" />
        </span>
        {/* ground band */}
        <span className="gp-ls-ground" />
        {/* trunk with branches */}
        <span className="gp-ls-trunk" />
        <span className="gp-ls-branch gp-ls-branch-r gp-ls-branch-1" />
        <span className="gp-ls-branch gp-ls-branch-l gp-ls-branch-2" />
        <span className="gp-ls-branch gp-ls-branch-r gp-ls-branch-3" />
        {/* the lumberjack: body + swinging axe arm */}
        <span className="gp-ls-jack">
          <i className="gp-ls-jack-body" />
          <i className="gp-ls-axe" />
        </span>
        {/* wood chips that flash off on the strike */}
        <span className="gp-ls-chip gp-ls-chip-a" />
        <span className="gp-ls-chip gp-ls-chip-b" />
      </div>

      <style jsx>{`
        .gp-ls-screen {
          background: linear-gradient(180deg, #2c4a63 0%, #7a9db0 100%);
        }
        .gp-ls-field {
          position: absolute;
          inset: 6% 16%;
          background: linear-gradient(180deg, #2c4a63 0%, #7a9db0 78%);
          box-shadow:
            0 0 0 2px #0f0a06,
            inset 0 0 18px rgba(0, 0, 0, 0.45);
          overflow: hidden;
        }

        /* time bar across the top */
        .gp-ls-bar {
          position: absolute;
          left: 10%;
          top: 8%;
          width: 80%;
          height: 8%;
          border-radius: 3px;
          background: #1c130a;
          box-shadow: 0 0 0 2px #0f0a06, inset 0 1px 2px rgba(0, 0, 0, 0.6);
          overflow: hidden;
        }
        .gp-ls-bar-fill {
          position: absolute;
          inset: 0;
          transform-origin: left center;
          background: linear-gradient(180deg, #6cc06f 0%, #4fae52 100%);
          animation: gp-ls-drain 1.6s ease-in infinite;
        }

        /* ground band */
        .gp-ls-ground {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          height: 22%;
          background: linear-gradient(180deg, #3f2d1a 0%, #241609 100%);
          box-shadow: inset 0 2px 0 rgba(242, 217, 138, 0.5);
        }

        /* trunk */
        .gp-ls-trunk {
          position: absolute;
          left: 50%;
          top: 20%;
          width: 20%;
          height: 62%;
          transform: translateX(-50%);
          background: linear-gradient(90deg, #4e3820 0%, #7c5a3a 30%, #9c7a52 50%, #7c5a3a 70%, #4e3820 100%);
          box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.3);
        }

        /* branches: fat limbs with a leaf clump */
        .gp-ls-branch {
          position: absolute;
          width: 22%;
          height: 9%;
          border-radius: 6px;
          background: linear-gradient(180deg, #ad8558 0%, #8a6440 60%, #4a3018 100%);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2);
        }
        .gp-ls-branch::after {
          content: '';
          position: absolute;
          top: -70%;
          width: 60%;
          height: 150%;
          border-radius: 50%;
          background: #f2d98a;
          opacity: 0.8;
        }
        .gp-ls-branch-r {
          left: 62%;
          transform-origin: left center;
        }
        .gp-ls-branch-r::after {
          right: 0;
        }
        .gp-ls-branch-l {
          right: 62%;
          transform-origin: right center;
        }
        .gp-ls-branch-l::after {
          left: 0;
        }
        .gp-ls-branch-1 { top: 26%; }
        .gp-ls-branch-2 { top: 44%; }
        .gp-ls-branch-3 { top: 60%; }

        /* lumberjack at the base, on the right of the trunk */
        .gp-ls-jack {
          position: absolute;
          left: 62%;
          bottom: 20%;
          width: 20%;
          height: 30%;
        }
        .gp-ls-jack-body {
          position: absolute;
          left: 20%;
          bottom: 0;
          width: 55%;
          height: 78%;
          border-radius: 22% 22% 8% 8%;
          background: #c0392b;
          box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.18);
        }
        .gp-ls-jack-body::before {
          content: '';
          position: absolute;
          left: 50%;
          top: -42%;
          width: 58%;
          height: 46%;
          transform: translateX(-50%);
          border-radius: 50%;
          background: #e0a878;
        }
        /* axe: a bar with a blade, pivoting from the shoulder */
        .gp-ls-axe {
          position: absolute;
          left: 6%;
          top: 18%;
          width: 66%;
          height: 8%;
          transform-origin: left center;
          background: #8a5a2b;
          animation: gp-ls-swing 1.6s ease-in infinite;
        }
        .gp-ls-axe::after {
          content: '';
          position: absolute;
          right: -12%;
          top: -110%;
          width: 26%;
          height: 320%;
          clip-path: polygon(0 30%, 100% 0, 100% 100%, 0 70%);
          background: linear-gradient(135deg, #eef2f6 0%, #5b626b 100%);
        }

        /* wood chips */
        .gp-ls-chip {
          position: absolute;
          left: 56%;
          top: 74%;
          width: 5%;
          height: 4%;
          border-radius: 1px;
          background: #e8c07a;
          opacity: 0;
        }
        .gp-ls-chip-a { animation: gp-ls-chip-a 1.6s ease-out infinite; }
        .gp-ls-chip-b { animation: gp-ls-chip-b 1.6s ease-out infinite; }

        /* the bar drains over the loop, then snaps back full at the strike (~62%) */
        @keyframes gp-ls-drain {
          0% { transform: scaleX(1); }
          60% { transform: scaleX(0.28); background: linear-gradient(180deg, #e0a24a, #d9483b); }
          62% { transform: scaleX(1); background: linear-gradient(180deg, #6cc06f, #4fae52); }
          100% { transform: scaleX(0.55); }
        }
        /* the axe cocks back, then strikes down around 60% of the loop */
        @keyframes gp-ls-swing {
          0%, 45% { transform: rotate(-58deg); }
          60% { transform: rotate(24deg); }
          72% { transform: rotate(24deg); }
          100% { transform: rotate(-58deg); }
        }
        @keyframes gp-ls-chip-a {
          0%, 58% { opacity: 0; transform: translate(0, 0) rotate(0deg); }
          62% { opacity: 1; transform: translate(0, 0) rotate(0deg); }
          82% { opacity: 0; transform: translate(-120%, -80%) rotate(-70deg); }
          100% { opacity: 0; }
        }
        @keyframes gp-ls-chip-b {
          0%, 58% { opacity: 0; transform: translate(0, 0) rotate(0deg); }
          62% { opacity: 0.95; transform: translate(0, 0) rotate(0deg); }
          82% { opacity: 0; transform: translate(-70%, 90%) rotate(60deg); }
          100% { opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .gp-ls-bar-fill,
          .gp-ls-axe,
          .gp-ls-chip-a,
          .gp-ls-chip-b {
            animation: none;
          }
          .gp-ls-bar-fill { transform: scaleX(0.6); }
          .gp-ls-axe { transform: rotate(-30deg); }
        }
      `}</style>
    </div>
  );
}
