/* Hover preview for Lightspeed: matte enamel star-streak lanes rush OUTWARD from
 * the vanishing point (the real in-game warp), painted as an amber-enamel
 * undercoat beneath a cream core — flat matte, NO glow / bloom. A mono
 * multiplier readout ticks upward through the compounding jumps. Loops. */
export default function LightspeedPreview() {
  // Streaks radiate from center (50,50). Each carries its own angle (so it
  // points straight out from the vanishing point), a normalized start radius,
  // and a stagger delay — matching the real warp star-field.
  const RAYS = 16;
  const streaks = Array.from({ length: RAYS }).map((_, i) => {
    // spread angles around the circle with a little jitter so it isn't a wheel
    const angle = (i / RAYS) * Math.PI * 2 + (i % 3) * 0.21;
    const delay = -((i * 0.137) % 1.6);
    return { angle, delay };
  });

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="gp-lightspeed-field">
        {streaks.map((s, i) => (
          <span
            key={i}
            className="gp-lightspeed-streak"
            style={{
              // angle the streak so its length points radially outward
              ['--gp-lightspeed-rot' as string]: `${s.angle}rad`,
              ['--gp-lightspeed-delay' as string]: `${s.delay}s`,
            }}
          >
            <span className="gp-lightspeed-core" />
          </span>
        ))}
      </div>

      {/* Rising multiplier readout — mono, prize-teal enamel, X.XXx format like
          the real HUD. The values climb through the compounding jumps. */}
      <div className="gp-lightspeed-mult">
        <span className="gp-lightspeed-mult-stack">
          <span className="gp-lightspeed-mult-n gp-lightspeed-mult-n0">1.02x</span>
          <span className="gp-lightspeed-mult-n gp-lightspeed-mult-n1">1.49x</span>
          <span className="gp-lightspeed-mult-n gp-lightspeed-mult-n2">2.77x</span>
          <span className="gp-lightspeed-mult-n gp-lightspeed-mult-n3">4.13x</span>
        </span>
      </div>

      <style jsx>{`
        .gp-lightspeed-field {
          position: absolute;
          inset: 0;
          /* faint flat amber→teal lane wash from the vanishing point — matte,
             low alpha, no bloom (matches the real radial tunnel tint). */
          background: radial-gradient(
            circle at 50% 50%,
            color-mix(in srgb, var(--enamel-tickets) 9%, transparent),
            color-mix(in srgb, var(--enamel-prize) 5%, transparent) 45%,
            transparent 70%
          );
        }

        /* Each streak is a thin rod anchored at the center, rotated to its ray
           angle, that scales/translates outward toward the viewer. The OUTER
           span is the amber enamel undercoat; the inner core is cream. */
        .gp-lightspeed-streak {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 2.2px;
          height: 30%;
          border-radius: 2px;
          transform-origin: top center;
          /* point the rod outward along its ray (offset +90deg so the rod's
             length axis aligns with the radius) */
          transform: translate(-50%, 0)
            rotate(calc(var(--gp-lightspeed-rot) + 90deg)) scaleY(0.12);
          /* amber enamel undercoat — flat color, NO box-shadow glow */
          background: var(--enamel-tickets);
          opacity: 0;
          animation: gp-lightspeed-rush 1.6s linear infinite;
          animation-delay: var(--gp-lightspeed-delay);
        }

        /* cream core riding on top of the amber undercoat */
        .gp-lightspeed-core {
          position: absolute;
          left: 50%;
          top: 0;
          width: 1px;
          height: 100%;
          transform: translateX(-50%);
          border-radius: 2px;
          background: var(--text-strong);
        }

        .gp-lightspeed-mult {
          position: absolute;
          right: 7%;
          bottom: 9%;
          font-family: var(--font-mono-arcade), monospace;
        }
        .gp-lightspeed-mult-stack {
          position: relative;
          display: inline-block;
        }
        .gp-lightspeed-mult-n {
          position: absolute;
          right: 0;
          bottom: 0;
          font-size: 0.85rem;
          font-weight: 700;
          letter-spacing: 0.02em;
          /* prize-teal enamel readout, matte (no text-shadow) */
          color: var(--enamel-prize-text, var(--enamel-prize));
          opacity: 0;
          animation: gp-lightspeed-tick 4.8s steps(1, end) infinite;
        }
        .gp-lightspeed-mult-n0 {
          animation-delay: 0s;
        }
        .gp-lightspeed-mult-n1 {
          animation-delay: 1.2s;
        }
        .gp-lightspeed-mult-n2 {
          animation-delay: 2.4s;
        }
        /* the highest rung swaps to amber enamel, like the real ≥10x readout */
        .gp-lightspeed-mult-n3 {
          color: var(--enamel-tickets-text, var(--enamel-tickets));
          animation-delay: 3.6s;
        }

        @keyframes gp-lightspeed-rush {
          0% {
            opacity: 0;
            transform: translate(-50%, 0)
              rotate(calc(var(--gp-lightspeed-rot) + 90deg)) scaleY(0.1);
          }
          12% {
            opacity: 1;
          }
          85% {
            opacity: 1;
          }
          /* the rod elongates and pushes outward past the frame edge */
          100% {
            opacity: 0;
            transform: translate(-50%, 0)
              rotate(calc(var(--gp-lightspeed-rot) + 90deg))
              translateY(140%) scaleY(2.4);
          }
        }

        /* each multiplier value holds, then hands off to the next rung */
        @keyframes gp-lightspeed-tick {
          0% {
            opacity: 0;
          }
          4% {
            opacity: 1;
          }
          24% {
            opacity: 1;
          }
          26%,
          100% {
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
