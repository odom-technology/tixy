/* Hover preview for Gunrush — emulates the real game's default Midway look from
 * _gunrush-client.tsx: a night boardwalk lane (#6a4a28 deck, #4a3118 rails)
 * running to a near-black horizon, with paired gate arches painted cyan
 * (#35d0e8 "take me") and red (#e0483f "wreck me") straddling the divider, and
 * a cluster of tin gunners (#3fb8c8 bodies, #f2e4c6 heads) auto-running down it.
 *
 * Motion: the deck planks scroll toward the viewer while a gate pair sweeps down
 * the lane and past the camera; the squad slides under the cyan side and pops a
 * size bigger as it passes through — the game's core "pick the good gate, grow
 * the squad" beat. Pure CSS, loops cheaply, no WebGL. */
export default function GunrushPreview() {
  return (
    <div className="absolute inset-0 overflow-hidden gp-gr-frame">
      {/* night sky above the horizon + a couple of string bulbs */}
      <div className="gp-gr-sky">
        <i className="gp-gr-bulb gp-gr-bulb-a" />
        <i className="gp-gr-bulb gp-gr-bulb-b" />
        <i className="gp-gr-bulb gp-gr-bulb-c" />
      </div>

      {/* perspective-tilted boardwalk deck with scrolling planks + rails */}
      <div className="gp-gr-scene">
        <div className="gp-gr-plane" />
      </div>

      {/* the paired gate arch sweeping toward the camera */}
      <div className="gp-gr-gate">
        <span className="gp-gr-panel gp-gr-panel-good" />
        <span className="gp-gr-divider" />
        <span className="gp-gr-panel gp-gr-panel-bad" />
      </div>

      {/* the squad: a cluster of gunner dots that pops bigger past the cyan gate */}
      <div className="gp-gr-squad">
        <i className="gp-gr-gunner gp-gr-gunner-lead" />
        <i className="gp-gr-gunner gp-gr-gunner-l" />
        <i className="gp-gr-gunner gp-gr-gunner-r" />
        <i className="gp-gr-gunner gp-gr-gunner-back" />
        <i className="gp-gr-muzzle" />
      </div>

      <style jsx>{`
        .gp-gr-frame {
          background: #140f0a;
        }
        /* night sky fading down to the fog color at the horizon */
        .gp-gr-sky {
          position: absolute;
          inset: 0 0 66% 0;
          background: linear-gradient(180deg, #0c0906 0%, #140f0a 70%, #241708 100%);
        }
        .gp-gr-bulb {
          position: absolute;
          width: 3px;
          height: 3px;
          border-radius: 50%;
          background: #ffe7c4;
          box-shadow: 0 1px 0 #00000066;
        }
        .gp-gr-bulb-a { top: 30%; left: 18%; }
        .gp-gr-bulb-b { top: 20%; left: 50%; }
        .gp-gr-bulb-c { top: 30%; left: 82%; }

        /* the 3D scene: perspective container + rotated boardwalk plane */
        .gp-gr-scene {
          position: absolute;
          inset: 0;
          perspective: 210px;
          perspective-origin: 50% 34%;
          overflow: hidden;
        }
        .gp-gr-plane {
          position: absolute;
          left: -30%;
          right: -30%;
          top: 34%;
          height: 130%;
          transform-origin: top center;
          transform: rotateX(58deg);
          overflow: hidden;
          /* scrolling planks + side rails with bright caps + the deck itself
             (layered gradients; only background-position animates) */
          background-image:
            repeating-linear-gradient(
              180deg,
              transparent 0 22px,
              rgba(36, 23, 8, 0.55) 22px 30px
            ),
            linear-gradient(
              90deg,
              #241708 0 20%,
              #a9762f 20% 21.5%,
              #4a3118 21.5% 24%,
              transparent 24% 76%,
              #4a3118 76% 78.5%,
              #a9762f 78.5% 80%,
              #241708 80% 100%
            ),
            linear-gradient(180deg, #5c4022 0%, #6a4a28 42%, #7c5430 100%);
          animation: gp-gr-deck 1s linear infinite;
        }
        @keyframes gp-gr-deck {
          from {
            background-position: 0 0, 0 0, 0 0;
          }
          to {
            background-position: 0 52px, 0 0, 0 0;
          }
        }

        /* a gate row: two enamel panels either side of the divider post, riding
           the lane from the horizon out past the camera */
        .gp-gr-gate {
          position: absolute;
          left: 50%;
          width: 56%;
          height: 22%;
          margin-left: -28%;
          animation: gp-gr-sweep 3s linear infinite;
        }
        .gp-gr-panel {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 47%;
          border-radius: 2px;
        }
        .gp-gr-panel-good {
          left: 0;
          background: rgba(53, 208, 232, 0.32);
          box-shadow: inset 0 0 0 2px #35d0e8;
        }
        .gp-gr-panel-bad {
          right: 0;
          background: rgba(224, 72, 63, 0.32);
          box-shadow: inset 0 0 0 2px #e0483f;
        }
        .gp-gr-divider {
          position: absolute;
          left: 50%;
          top: -8%;
          bottom: -8%;
          width: 4%;
          margin-left: -2%;
          background: #c07be8;
        }
        /* the gate starts small and far, grows as it nears the camera, then
           slides off the bottom of the frame */
        @keyframes gp-gr-sweep {
          0% {
            top: 30%;
            transform: scale(0.28);
            opacity: 0;
          }
          14% {
            opacity: 1;
          }
          70% {
            top: 62%;
            transform: scale(1);
            opacity: 1;
          }
          100% {
            top: 104%;
            transform: scale(1.7);
            opacity: 0;
          }
        }

        /* the squad, anchored on the cyan (left) half of the lane and popping a
           size bigger the moment the good gate passes over it */
        .gp-gr-squad {
          position: absolute;
          left: 38%;
          bottom: 9%;
          width: 24%;
          height: 22%;
          animation: gp-gr-grow 3s ease-out infinite;
        }
        .gp-gr-gunner {
          position: absolute;
          width: 26%;
          height: 34%;
          border-radius: 40% 40% 26% 26%;
          background: linear-gradient(180deg, #f2e4c6 0 30%, #3fb8c8 30% 100%);
          box-shadow: 0 2px 0 rgba(0, 0, 0, 0.45);
        }
        .gp-gr-gunner-lead { left: 37%; top: 6%; }
        .gp-gr-gunner-l { left: 8%; top: 38%; }
        .gp-gr-gunner-r { left: 66%; top: 38%; }
        .gp-gr-gunner-back { left: 37%; top: 64%; }
        /* muzzle flash off the lead gunner, on the game's fire cadence */
        .gp-gr-muzzle {
          position: absolute;
          left: 44%;
          top: -8%;
          width: 12%;
          height: 12%;
          border-radius: 50%;
          background: #ffd98a;
          animation: gp-gr-fire 0.24s steps(2, end) infinite;
        }
        @keyframes gp-gr-fire {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        /* +N: the squad snaps bigger as it clears the cyan gate, then settles */
        @keyframes gp-gr-grow {
          0%, 66% {
            transform: scale(0.82);
          }
          72% {
            transform: scale(1.18);
          }
          100% {
            transform: scale(1.06);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .gp-gr-plane,
          .gp-gr-gate,
          .gp-gr-squad,
          .gp-gr-muzzle {
            animation: none;
          }
          /* park the gate mid-lane, fully visible, and the squad at rest */
          .gp-gr-gate {
            top: 58%;
            transform: scale(0.92);
            opacity: 1;
          }
          .gp-gr-squad {
            transform: scale(1);
          }
        }
      `}</style>
    </div>
  );
}
