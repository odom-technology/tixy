/* Hover preview for Gopher Pop — emulates the real game's default Midway look
 * from _gopher-client.tsx: a lacquered planked-wood cabinet panel with bevelled
 * dark holes, an enamel gopher (warm tan body #c98a4e, cream belly #f3ddb6) that
 * POPS UP out of the center hole and gets bonked, a rare GOLDEN gopher peeking
 * from the right hole (the big-points special), plus a small dark bomb with a
 * red warning band in the left hole. NOTHING glows — the bonk is a hard cream
 * STAR flash via opacity + scale, chased by a floating "+30" combo popup.
 *
 * Motion: the center gopher rises out of its hole, a hammer-like cream star
 * pops over it (the "bonk"), a score popup drifts up, and it ducks back down —
 * then loops. */
export default function GopherPreview() {
  return (
    <div className="absolute inset-0 overflow-hidden gp-gp-field">
      {/* three bevelled holes across the middle */}
      <span className="gp-gp-hole" style={{ left: '18%' }} />
      <span className="gp-gp-hole gp-gp-hole-c" style={{ left: '50%' }} />
      <span className="gp-gp-hole" style={{ left: '82%' }} />

      {/* a small bomb peeking from the left hole (danger flavor) */}
      <span className="gp-gp-bomb" />

      {/* golden gopher peeking from the right hole (big-points special) */}
      <div className="gp-gp-goldie">
        <span className="gp-gp-ear gp-gp-ear-l gp-gp-gold" />
        <span className="gp-gp-ear gp-gp-ear-r gp-gp-gold" />
        <span className="gp-gp-body gp-gp-body-gold" />
        <span className="gp-gp-eye gp-gp-eye-l" />
        <span className="gp-gp-eye gp-gp-eye-r" />
      </div>

      {/* the gopher that pops up from the center hole and gets bonked */}
      <div className="gp-gp-gopher">
        <span className="gp-gp-ear gp-gp-ear-l" />
        <span className="gp-gp-ear gp-gp-ear-r" />
        <span className="gp-gp-body" />
        <span className="gp-gp-belly" />
        <span className="gp-gp-eye gp-gp-eye-l" />
        <span className="gp-gp-eye gp-gp-eye-r" />
        <span className="gp-gp-nose" />
      </div>

      {/* bonk star — hard cream flash over the gopher, no glow */}
      <span className="gp-gp-bonk" />

      {/* floating combo score popup that chases the bonk */}
      <span className="gp-gp-pop">+30</span>

      <style jsx>{`
        .gp-gp-field {
          /* warm planked lacquered wood */
          background:
            repeating-linear-gradient(
              90deg,
              rgba(0, 0, 0, 0.06) 0px,
              rgba(0, 0, 0, 0.06) 1px,
              transparent 1px,
              transparent 9px
            ),
            linear-gradient(180deg, #6b4a2c 0%, #4a3019 100%);
          box-shadow: inset 0 0 22px rgba(0, 0, 0, 0.5);
        }

        /* ── holes: dark recessed mouths with a hard rim + offset shadow ── */
        .gp-gp-hole {
          position: absolute;
          top: 56%;
          width: 26%;
          height: 17%;
          margin-left: -13%;
          border-radius: 50%;
          background: #140d07;
          box-shadow:
            0 0 0 3px #3a2614,
            0 4px 0 rgba(0, 0, 0, 0.4),
            inset 0 3px 5px rgba(0, 0, 0, 0.7);
        }
        .gp-gp-hole-c {
          top: 50%;
          width: 30%;
          height: 19%;
          margin-left: -15%;
          z-index: 2;
        }

        /* ── the gopher (stacked enamel shapes), clipped behind the hole lip ── */
        .gp-gp-gopher {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 24%;
          height: 30%;
          margin-left: -12%;
          z-index: 1;
          transform: translateY(60%);
          animation: gp-gp-pop-rise 2.8s cubic-bezier(0.34, 1.4, 0.4, 1) infinite;
        }
        .gp-gp-body {
          position: absolute;
          left: 8%;
          top: 18%;
          width: 84%;
          height: 78%;
          border-radius: 48% 48% 46% 46%;
          background: linear-gradient(180deg, #e3ad72 0%, #c98a4e 60%, #a06d39 100%);
          box-shadow:
            inset 0 14% 0 rgba(255, 255, 255, 0.22),
            inset 0 0 0 2px #7c5025;
        }
        .gp-gp-belly {
          position: absolute;
          left: 28%;
          top: 44%;
          width: 44%;
          height: 44%;
          border-radius: 50%;
          background: #f3ddb6;
        }
        .gp-gp-ear {
          position: absolute;
          top: 14%;
          width: 26%;
          height: 26%;
          border-radius: 50%;
          background: #c98a4e;
          box-shadow: inset 0 0 0 2px #7c5025;
        }
        .gp-gp-ear-l {
          left: 2%;
        }
        .gp-gp-ear-r {
          right: 2%;
        }
        .gp-gp-eye {
          position: absolute;
          top: 44%;
          width: 9%;
          height: 13%;
          border-radius: 50%;
          background: #0c0804;
        }
        .gp-gp-eye-l {
          left: 32%;
        }
        .gp-gp-eye-r {
          right: 32%;
        }
        .gp-gp-nose {
          position: absolute;
          left: 44%;
          top: 60%;
          width: 12%;
          height: 11%;
          border-radius: 50%;
          background: #7e2225;
        }

        /* ── golden gopher — enamel gold, gentle peek from the right hole ── */
        .gp-gp-goldie {
          position: absolute;
          left: 82%;
          top: 55%;
          width: 19%;
          height: 24%;
          margin-left: -9.5%;
          z-index: 1;
          transform: translateY(46%);
          animation: gp-gp-goldie-peek 2.8s ease-in-out infinite;
        }
        .gp-gp-body-gold {
          position: absolute;
          left: 8%;
          top: 18%;
          width: 84%;
          height: 78%;
          border-radius: 48% 48% 46% 46%;
          background: linear-gradient(180deg, #ffe08a 0%, #f2b93f 60%, #c78d1f 100%);
          box-shadow:
            inset 0 14% 0 rgba(255, 255, 255, 0.3),
            inset 0 0 0 2px #8a5c10;
        }
        .gp-gp-gold {
          background: #f2b93f;
          box-shadow: inset 0 0 0 2px #8a5c10;
        }

        /* ── bomb peeking from the left hole (red band = danger readable) ── */
        .gp-gp-bomb {
          position: absolute;
          left: 18%;
          top: 50%;
          width: 15%;
          height: 19%;
          margin-left: -7.5%;
          border-radius: 50%;
          background:
            linear-gradient(
              180deg,
              transparent 42%,
              #c33b3c 42%,
              #c33b3c 56%,
              transparent 56%
            ),
            radial-gradient(circle at 38% 32%, #4a443c 0%, #2a2622 70%);
          box-shadow: inset 0 0 0 2px #0c0804;
          z-index: 1;
        }
        .gp-gp-bomb::after {
          /* fuse spark */
          content: '';
          position: absolute;
          right: 14%;
          top: -22%;
          width: 18%;
          height: 18%;
          border-radius: 50%;
          background: #f7bd5e;
        }

        /* ── bonk star — hard cream flash over the gopher at the top of the pop ── */
        .gp-gp-bonk {
          position: absolute;
          left: 50%;
          top: 34%;
          width: 16%;
          height: 16%;
          margin-left: -8%;
          background: #f6eddc;
          clip-path: polygon(
            50% 0%,
            61% 35%,
            98% 35%,
            68% 57%,
            79% 91%,
            50% 70%,
            21% 91%,
            32% 57%,
            2% 35%,
            39% 35%
          );
          opacity: 0;
          transform: scale(0.4);
          z-index: 3;
          animation: gp-gp-bonk 2.8s ease-out infinite;
        }

        /* ── "+30" popup that floats up right after the bonk ── */
        .gp-gp-pop {
          position: absolute;
          left: 58%;
          top: 30%;
          z-index: 3;
          font-family: ui-monospace, monospace;
          font-weight: 900;
          font-size: 0.8rem;
          color: #f6eddc;
          text-shadow:
            0 1px 0 #1c160d,
            0 -1px 0 #1c160d,
            1px 0 0 #1c160d,
            -1px 0 0 #1c160d;
          opacity: 0;
          animation: gp-gp-pop-float 2.8s ease-out infinite;
        }

        /* gopher rises with a springy overshoot, holds, then ducks after the bonk */
        @keyframes gp-gp-pop-rise {
          0%,
          8% {
            transform: translateY(62%);
          }
          30%,
          50% {
            transform: translateY(-6%);
          }
          70%,
          100% {
            transform: translateY(62%);
          }
        }

        /* golden gopher takes a shy mid-loop peek */
        @keyframes gp-gp-goldie-peek {
          0%,
          40% {
            transform: translateY(52%);
          }
          58%,
          72% {
            transform: translateY(6%);
          }
          88%,
          100% {
            transform: translateY(52%);
          }
        }

        /* the bonk star flashes right as the gopher peaks (~46%) */
        @keyframes gp-gp-bonk {
          0%,
          40% {
            opacity: 0;
            transform: scale(0.4);
          }
          48% {
            opacity: 1;
            transform: scale(1.05);
          }
          62% {
            opacity: 0;
            transform: scale(0.7);
          }
          100% {
            opacity: 0;
          }
        }

        /* score popup chases the bonk then fades while drifting up */
        @keyframes gp-gp-pop-float {
          0%,
          46% {
            opacity: 0;
            transform: translateY(0);
          }
          52% {
            opacity: 1;
          }
          78% {
            opacity: 0;
            transform: translateY(-130%);
          }
          100% {
            opacity: 0;
            transform: translateY(-130%);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .gp-gp-gopher {
            animation: none;
            transform: translateY(4%);
          }
          .gp-gp-goldie {
            animation: none;
            transform: translateY(30%);
          }
          .gp-gp-bonk {
            animation: none;
            opacity: 0;
          }
          .gp-gp-pop {
            animation: none;
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
