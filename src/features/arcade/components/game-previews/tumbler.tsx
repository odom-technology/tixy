/* Hover preview for Tumbler (Pop-the-Lock) — emulates the real game's default
 * Midway look from _tumbler-client.tsx: a recessed dark cabinet "screen" with a
 * lacquered-wood lock plate, a brass safe-dial with stepped vault tiers, a ring
 * of pin-set indicator rivets, a gold lit NOTCH on the ring, and an enamel-red
 * marker (with a short motion trail) that ORBITS the ring. Hard bevels + offset
 * shadows; NOTHING glows.
 *
 * Motion: the red marker sweeps around the brass channel; just as it crosses the
 * gold notch a hard enamel slice-flash pops (opacity + transform, no glow) and a
 * couple of gold shards fly off — exactly the real loop's "pin picked" feedback.
 * Then it continues orbiting to the next pass. The whole scene is pure CSS and
 * loops cheaply (mounted only while the card is hovered). */
export default function TumblerPreview() {
  return (
    <div className="absolute inset-0 overflow-hidden gp-tm-screen">
      <div className="gp-tm-field">
        {/* lacquered wood lock plate */}
        <span className="gp-tm-plate" />
        {/* brass ring channel the marker rides in */}
        <span className="gp-tm-ring" />
        {/* the lit gold notch on the ring (top-right) */}
        <span className="gp-tm-notch" />
        {/* stepped vault tier waiting to unlock */}
        <span className="gp-tm-tier" />
        {/* brass center hub */}
        <span className="gp-tm-hub" />
        {/* pin-set indicator rivets (two already set, one waiting) */}
        <span className="gp-tm-pin gp-tm-pin-a gp-tm-pin-set" />
        <span className="gp-tm-pin gp-tm-pin-b gp-tm-pin-set" />
        <span className="gp-tm-pin gp-tm-pin-c" />
        {/* the orbiting enamel-red marker (rotated arm with a dot at the rim)
            plus two trailing ghost beads on shorter arms behind it */}
        <span className="gp-tm-orbit">
          <i className="gp-tm-marker" />
        </span>
        <span className="gp-tm-orbit gp-tm-orbit-t1">
          <i className="gp-tm-marker gp-tm-ghost gp-tm-ghost-1" />
        </span>
        <span className="gp-tm-orbit gp-tm-orbit-t2">
          <i className="gp-tm-marker gp-tm-ghost gp-tm-ghost-2" />
        </span>
        {/* gold shards that flash off when the marker crosses the notch */}
        <span className="gp-tm-shard gp-tm-shard-a" />
        <span className="gp-tm-shard gp-tm-shard-b" />
      </div>

      <style jsx>{`
        .gp-tm-screen {
          background: radial-gradient(120% 100% at 50% 38%, #1c2a22 0%, #0f1512 100%);
        }
        /* recessed cabinet screen with an ink frame + inner vignette */
        .gp-tm-field {
          position: absolute;
          inset: 6% 18%;
          background: #0f1512;
          box-shadow:
            0 0 0 2px #0f0a06,
            inset 0 0 20px rgba(0, 0, 0, 0.6);
          overflow: hidden;
        }

        /* lacquered-wood lock plate behind the ring */
        .gp-tm-plate {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 78%;
          aspect-ratio: 1 / 1;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          background: radial-gradient(circle at 50% 36%, #3a2616 0%, #1c120a 100%);
          box-shadow:
            inset 0 2px 0 rgba(255, 255, 255, 0.08),
            inset 0 -3px 4px rgba(0, 0, 0, 0.5);
        }

        /* brass ring channel: dark groove with a bright top rail (no glow) */
        .gp-tm-ring {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 58%;
          aspect-ratio: 1 / 1;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          background: transparent;
          border: 8px solid #171009;
          box-shadow:
            inset 0 0 0 1px rgba(199, 162, 74, 0.35),
            0 0 0 1px rgba(126, 95, 35, 0.7),
            inset 0 2px 0 rgba(242, 214, 138, 0.5);
        }

        /* the lit gold notch — a fat enamel chip sitting on the ring, top-right */
        .gp-tm-notch {
          position: absolute;
          left: 78%;
          top: 24%;
          width: 15%;
          height: 15%;
          transform: translate(-50%, -50%) rotate(45deg);
          border-radius: 3px;
          background: linear-gradient(180deg, #fff0cc 0%, #f7bd5e 45%, #9a621a 100%);
          box-shadow:
            inset 0 2px 0 rgba(255, 255, 255, 0.5),
            inset 0 -2px 3px rgba(0, 0, 0, 0.4),
            0 1px 2px rgba(0, 0, 0, 0.4);
          animation: gp-tm-notch-pulse 1.4s ease-in-out infinite;
        }

        /* stepped vault tier between the channel and the hub (machined ring) */
        .gp-tm-tier {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 40%;
          aspect-ratio: 1 / 1;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          background: radial-gradient(circle at 42% 34%, #d8b257 0%, #8a6a2a 100%);
          box-shadow:
            inset 0 0 0 2px #171009,
            inset 0 2px 0 rgba(255, 246, 210, 0.4),
            inset 0 -2px 3px rgba(0, 0, 0, 0.45);
        }

        /* brass center hub with a dark recessed cap */
        .gp-tm-hub {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 24%;
          aspect-ratio: 1 / 1;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          background: radial-gradient(circle at 50% 38%, #c7a24a 0%, #7e5f23 100%);
          box-shadow:
            inset 0 0 0 4px #171009,
            inset 0 2px 0 rgba(255, 255, 255, 0.18);
        }

        /* pin-set indicator rivets: drilled seats; "set" ones filled gold */
        .gp-tm-pin {
          position: absolute;
          width: 5%;
          aspect-ratio: 1 / 1;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          background: #0d0a05;
          box-shadow:
            inset 0 1px 2px rgba(0, 0, 0, 0.8),
            0 1px 0 rgba(242, 214, 138, 0.25);
        }
        .gp-tm-pin-set {
          background: radial-gradient(circle at 38% 32%, #fff0cc 0%, #f7bd5e 55%, #9a621a 100%);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.5),
            0 1px 2px rgba(0, 0, 0, 0.5);
        }
        .gp-tm-pin-a { left: 50%; top: 27%; }
        .gp-tm-pin-b { left: 71%; top: 42%; }
        .gp-tm-pin-c { left: 63%; top: 68%; }

        /* the orbit arm: a full-size rotating box; the marker pins to its top so
           rotating the arm sweeps the dot around the ring rim */
        .gp-tm-orbit {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 58%;
          aspect-ratio: 1 / 1;
          transform: translate(-50%, -50%) rotate(0deg);
          transform-origin: 50% 50%;
          animation: gp-tm-spin 3s linear infinite;
        }
        /* trailing ghost beads ride identical arms, delayed a hair behind */
        .gp-tm-orbit-t1 { animation-delay: -2.94s; }
        .gp-tm-orbit-t2 { animation-delay: -2.88s; }
        .gp-tm-marker {
          position: absolute;
          left: 50%;
          top: 0;
          width: 17%;
          aspect-ratio: 1 / 1;
          transform: translate(-50%, -42%);
          border-radius: 50%;
          background: radial-gradient(circle at 38% 32%, #e2666a 0%, #c73538 60%, #5e1a1c 100%);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.4),
            0 2px 3px rgba(0, 0, 0, 0.45);
        }
        .gp-tm-ghost {
          box-shadow: none;
          background: #c73538;
        }
        .gp-tm-ghost-1 { opacity: 0.3; scale: 0.75; }
        .gp-tm-ghost-2 { opacity: 0.15; scale: 0.55; }

        /* gold shards: invisible until the marker reaches the notch (~37% of the
           spin, where the arm is rotated to the top-right), then flash + fly off */
        .gp-tm-shard {
          position: absolute;
          left: 76%;
          top: 24%;
          width: 5%;
          height: 5%;
          border-radius: 1px;
          background: #f7bd5e;
          opacity: 0;
        }
        .gp-tm-shard-a {
          animation: gp-tm-shard-a 3s ease-out infinite;
        }
        .gp-tm-shard-b {
          animation: gp-tm-shard-b 3s ease-out infinite;
        }

        @keyframes gp-tm-spin {
          from {
            transform: translate(-50%, -50%) rotate(0deg);
          }
          to {
            transform: translate(-50%, -50%) rotate(360deg);
          }
        }
        @keyframes gp-tm-notch-pulse {
          0%, 100% { filter: brightness(1); }
          50% { filter: brightness(1.25); }
        }
        /* the notch is up-and-right of center; the marker (arm top) reaches it
           when the arm has rotated ~45deg, i.e. ~12.5% of the loop. Pop there. */
        @keyframes gp-tm-shard-a {
          0%,
          10% {
            opacity: 0;
            transform: translate(0, 0) rotate(0deg);
          }
          15% {
            opacity: 0.95;
            transform: translate(0, 0) rotate(0deg);
          }
          30% {
            opacity: 0;
            transform: translate(120%, -90%) rotate(60deg);
          }
          100% {
            opacity: 0;
          }
        }
        @keyframes gp-tm-shard-b {
          0%,
          10% {
            opacity: 0;
            transform: translate(0, 0) rotate(0deg);
          }
          15% {
            opacity: 0.9;
            transform: translate(0, 0) rotate(0deg);
          }
          30% {
            opacity: 0;
            transform: translate(60%, 120%) rotate(-50deg);
          }
          100% {
            opacity: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .gp-tm-orbit,
          .gp-tm-notch,
          .gp-tm-shard-a,
          .gp-tm-shard-b {
            animation: none;
          }
          .gp-tm-orbit { transform: translate(-50%, -50%) rotate(45deg); }
        }
      `}</style>
    </div>
  );
}
