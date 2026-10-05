/* Hover preview for Swerve — emulates the real game's default Midway look from
 * _swerve-client.tsx: a chase-cam three-lane highway at dusk. A warm-dark sky
 * sits over a perspective-tilted road plane (wood-warm asphalt #6a4a28 with
 * scrolling lane dashes) framed by dark rails. Oncoming enamel traffic cars —
 * red (#c73538) and teal (#2fb8a6) with warm headlights — sweep down the road
 * plane toward the camera while the player's cream car (#f2e4c6, teal glass,
 * red taillights) swerves between lanes and banks into each move.
 *
 * Motion: the road dashes scroll toward the viewer, two traffic cars loop down
 * alternating lanes, and the player slides to the open lane in time — the real
 * loop's dodge feedback. Pure CSS, loops cheaply, no WebGL. */
export default function SwervePreview() {
  return (
    <div className="absolute inset-0 overflow-hidden gp-sw-frame">
      {/* warm dusk sky above the horizon */}
      <div className="gp-sw-sky" />

      {/* perspective-tilted road plane with scrolling lane dashes */}
      <div className="gp-sw-scene">
        <div className="gp-sw-plane">
          {/* oncoming traffic cars (top-down sprites riding the plane) */}
          <div className="gp-sw-traffic gp-sw-t1">
            <i className="gp-sw-lights" />
          </div>
          <div className="gp-sw-traffic gp-sw-t2">
            <i className="gp-sw-lights" />
          </div>
        </div>
      </div>

      {/* player's cream car, swerving + banking between lanes */}
      <div className="gp-sw-cart">
        <span className="gp-sw-cockpit" />
        <i className="gp-sw-tail" style={{ left: '12%' }} />
        <i className="gp-sw-tail" style={{ right: '12%' }} />
      </div>

      <style jsx>{`
        .gp-sw-frame {
          background: #1b130b;
        }
        /* dusk sky fading down to the fog color at the horizon */
        .gp-sw-sky {
          position: absolute;
          inset: 0 0 62% 0;
          background: linear-gradient(180deg, #140d07 0%, #241708 78%, #33230f 100%);
        }

        /* the 3D scene: perspective container + rotated road plane */
        .gp-sw-scene {
          position: absolute;
          inset: 0;
          perspective: 210px;
          perspective-origin: 50% 32%;
          overflow: hidden;
        }
        .gp-sw-plane {
          position: absolute;
          left: -30%;
          right: -30%;
          top: 37%;
          height: 130%;
          transform-origin: top center;
          transform: rotateX(57deg);
          overflow: hidden;
          /* road deck + dark rails at the edges + two lane dividers + scrolling
             dashes (layered gradients; only background-position animates) */
          background-image:
            /* scrolling centre-of-lane dashes */
            repeating-linear-gradient(
              180deg,
              transparent 0 26px,
              rgba(243, 230, 203, 0.16) 26px 40px
            ),
            /* red + teal lane dividers */
            linear-gradient(90deg, transparent 0 39.5%, #c4413f 39.5% 40.5%, transparent 40.5% 100%),
            linear-gradient(90deg, transparent 0 59.5%, #2ba596 59.5% 60.5%, transparent 60.5% 100%),
            /* rails */
            linear-gradient(90deg, #33230f 0 21%, #4a3118 21% 22.5%, transparent 22.5% 77.5%, #4a3118 77.5% 79%, #33230f 79% 100%),
            /* road deck */
            linear-gradient(180deg, #5d4023 0%, #6a4a28 40%, #75522d 100%);
          animation: gp-sw-road 1.1s linear infinite;
        }
        @keyframes gp-sw-road {
          from {
            background-position: 0 0, 0 0, 0 0, 0 0, 0 0;
          }
          to {
            background-position: 0 66px, 0 0, 0 0, 0 0, 0 0;
          }
        }

        /* an oncoming enamel car: body + hard highlight/bevel + headlights */
        .gp-sw-traffic {
          position: absolute;
          width: 11%;
          height: 13%;
          border-radius: 8% / 14%;
          box-shadow:
            inset 0 26% 0 rgba(255, 255, 255, 0.2),
            inset 0 -28% 0 rgba(0, 0, 0, 0.38),
            0 3px 4px rgba(0, 0, 0, 0.45);
        }
        .gp-sw-lights {
          position: absolute;
          bottom: 4%;
          left: 14%;
          right: 14%;
          height: 16%;
          background:
            radial-gradient(circle at 12% 50%, #fff0cc 0 36%, transparent 40%),
            radial-gradient(circle at 88% 50%, #fff0cc 0 36%, transparent 40%);
        }
        .gp-sw-t1 {
          left: 27.5%; /* left lane */
          background: linear-gradient(180deg, #c73538 0%, #7e2225 100%);
          animation: gp-sw-drive 2.6s linear infinite;
        }
        .gp-sw-t2 {
          left: 61.5%; /* right lane */
          background: linear-gradient(180deg, #2fb8a6 0%, #1b7466 100%);
          animation: gp-sw-drive 2.6s linear infinite;
          animation-delay: -1.3s;
        }
        @keyframes gp-sw-drive {
          from {
            top: -14%;
          }
          to {
            top: 104%;
          }
        }

        /* the player's cream car (rear view) near the bottom, swerving to the
           open lane while each traffic car passes, banking into the move */
        .gp-sw-cart {
          position: absolute;
          bottom: 7%;
          left: 50%;
          width: 15%;
          height: 17%;
          margin-left: -7.5%;
          border-radius: 10% / 16%;
          background: linear-gradient(180deg, #f6eddc 0%, #d9ccb1 100%);
          box-shadow:
            inset 0 18% 0 rgba(255, 255, 255, 0.5),
            inset 0 -20% 0 rgba(0, 0, 0, 0.18),
            0 3px 5px rgba(0, 0, 0, 0.5);
          animation: gp-sw-swerve 2.6s ease-in-out infinite;
        }
        /* teal rear glass */
        .gp-sw-cockpit {
          position: absolute;
          left: 22%;
          top: 12%;
          width: 56%;
          height: 30%;
          border-radius: 12% / 30%;
          background: linear-gradient(180deg, #2fb8a6 0%, #1b7466 100%);
        }
        /* red taillights */
        .gp-sw-tail {
          position: absolute;
          bottom: 16%;
          width: 14%;
          height: 12%;
          border-radius: 2px;
          background: #e0454a;
        }

        /* ride the right lane while the left-lane car passes, slide left while
           the right-lane car passes — always in the clear lane, with bank. */
        @keyframes gp-sw-swerve {
          0%,
          38% {
            transform: translateX(190%) rotate(0deg);
          }
          46% {
            transform: translateX(0%) rotate(-8deg);
          }
          54% {
            transform: translateX(-190%) rotate(-4deg);
          }
          60%,
          88% {
            transform: translateX(-190%) rotate(0deg);
          }
          94% {
            transform: translateX(0%) rotate(8deg);
          }
          100% {
            transform: translateX(190%) rotate(0deg);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .gp-sw-plane,
          .gp-sw-traffic,
          .gp-sw-cart {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
