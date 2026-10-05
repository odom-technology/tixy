/* Hover preview for Knife Booth — emulates the real game's default Midway look:
 * a carnival booth backdrop with a spinning wooden target ringed by a few lodged
 * knives, and a fresh knife that flies up from the lane, thunks into a gap on the
 * rim, and sparks. Hard bevels + offset shadows; NOTHING glows. Pure CSS, loops
 * cheaply (mounted only while the card is hovered). */
export default function KnifeBoothPreview() {
  return (
    <div className="absolute inset-0 overflow-hidden gp-kb-screen">
      <div className="gp-kb-field">
        {/* enamel bunting swag */}
        <span className="gp-kb-bunting" />
        {/* the spinning wooden target (rotates); lodged knives ride with it */}
        <span className="gp-kb-target">
          <i className="gp-kb-grain" />
          <i className="gp-kb-bull" />
          <i className="gp-kb-lodged gp-kb-lodged-a" />
          <i className="gp-kb-lodged gp-kb-lodged-b" />
          <i className="gp-kb-lodged gp-kb-lodged-c" />
          {/* a bonus fruit pinned to the rim */}
          <i className="gp-kb-fruit" />
        </span>
        {/* the flying knife thrown from the lane */}
        <span className="gp-kb-flyer" />
        {/* thunk sparks where it lands (bottom of the target) */}
        <span className="gp-kb-spark gp-kb-spark-a" />
        <span className="gp-kb-spark gp-kb-spark-b" />
        {/* the throwing lane rail */}
        <span className="gp-kb-lane" />
      </div>

      <style jsx>{`
        .gp-kb-screen {
          background: radial-gradient(120% 100% at 50% 34%, #2a1a10 0%, #140c06 100%);
        }
        .gp-kb-field {
          position: absolute;
          inset: 6% 14%;
          overflow: hidden;
          box-shadow:
            0 0 0 2px #0f0a06,
            inset 0 0 20px rgba(0, 0, 0, 0.55);
        }

        .gp-kb-bunting {
          position: absolute;
          left: 0;
          right: 0;
          top: 4%;
          height: 12%;
          background:
            repeating-linear-gradient(
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

        /* the wooden target */
        .gp-kb-target {
          position: absolute;
          left: 50%;
          top: 48%;
          width: 62%;
          aspect-ratio: 1 / 1;
          transform: translate(-50%, -50%) rotate(0deg);
          transform-origin: 50% 50%;
          border-radius: 50%;
          background: radial-gradient(circle at 40% 34%, #c98f52 0%, #a5703c 55%, #6f4a24 100%);
          box-shadow:
            inset 0 0 0 4px #3c2712,
            inset 0 3px 0 rgba(255, 246, 210, 0.25),
            0 3px 6px rgba(0, 0, 0, 0.45);
          animation: gp-kb-spin 4.2s linear infinite;
        }
        .gp-kb-grain {
          position: absolute;
          inset: 14%;
          border-radius: 50%;
          border: 1.5px solid rgba(129, 86, 49, 0.6);
          box-shadow:
            0 0 0 10px rgba(129, 86, 49, 0.12),
            inset 0 0 0 10px rgba(129, 86, 49, 0.12);
        }
        .gp-kb-bull {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 20%;
          aspect-ratio: 1 / 1;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          background: radial-gradient(circle at 40% 34%, #c8402f 0%, #7c1f18 100%);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.3);
        }

        /* a lodged knife: a thin steel blade + brown handle poking from the rim.
           Each is an absolutely-placed bar rotated to its seat on the rim. */
        .gp-kb-lodged {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 6%;
          height: 44%;
          transform-origin: 50% 100%;
          background: linear-gradient(
            180deg,
            #8a3b22 0%,
            #8a3b22 34%,
            #c7d0da 34%,
            #f4f7fb 60%,
            #8b95a1 100%
          );
          border-radius: 2px 2px 40% 40%;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
        }
        .gp-kb-lodged-a { transform: translate(-50%, -100%) rotate(28deg); }
        .gp-kb-lodged-b { transform: translate(-50%, -100%) rotate(-52deg); }
        .gp-kb-lodged-c { transform: translate(-50%, -100%) rotate(150deg); }

        .gp-kb-fruit {
          position: absolute;
          left: 78%;
          top: 30%;
          width: 12%;
          aspect-ratio: 1 / 1;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          background: radial-gradient(circle at 38% 34%, #ff8aa0 0%, #d63b56 100%);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4);
        }

        /* the flying knife: starts in the lane, flies up to the target's bottom */
        .gp-kb-flyer {
          position: absolute;
          left: 50%;
          bottom: 6%;
          width: 4%;
          height: 20%;
          transform: translate(-50%, 0);
          background: linear-gradient(
            180deg,
            #f4f7fb 0%,
            #c7d0da 46%,
            #8a3b22 46%,
            #8a3b22 100%
          );
          border-radius: 40% 40% 2px 2px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
          animation: gp-kb-fly 4.2s ease-in infinite;
        }

        .gp-kb-spark {
          position: absolute;
          left: 50%;
          top: 78%;
          width: 4%;
          height: 4%;
          border-radius: 1px;
          background: #f8c45f;
          opacity: 0;
        }
        .gp-kb-spark-a { animation: gp-kb-spark-a 4.2s ease-out infinite; }
        .gp-kb-spark-b { animation: gp-kb-spark-b 4.2s ease-out infinite; }

        .gp-kb-lane {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 4%;
          height: 4%;
          background: rgba(0, 0, 0, 0.4);
          box-shadow: inset 0 1px 0 rgba(255, 246, 210, 0.12);
        }

        @keyframes gp-kb-spin {
          from { transform: translate(-50%, -50%) rotate(0deg); }
          to { transform: translate(-50%, -50%) rotate(360deg); }
        }
        /* fly up over the first ~18% of the loop, then rest in the lane */
        @keyframes gp-kb-fly {
          0% { transform: translate(-50%, 0); opacity: 1; }
          14% { transform: translate(-50%, -150%); opacity: 1; }
          16% { transform: translate(-50%, -150%); opacity: 0; }
          18% { transform: translate(-50%, 0); opacity: 0; }
          40% { transform: translate(-50%, 0); opacity: 1; }
          100% { transform: translate(-50%, 0); opacity: 1; }
        }
        @keyframes gp-kb-spark-a {
          0%, 12% { opacity: 0; transform: translate(0, 0) rotate(0deg); }
          15% { opacity: 0.95; transform: translate(0, 0); }
          26% { opacity: 0; transform: translate(120%, 60%) rotate(60deg); }
          100% { opacity: 0; }
        }
        @keyframes gp-kb-spark-b {
          0%, 12% { opacity: 0; transform: translate(0, 0) rotate(0deg); }
          15% { opacity: 0.9; transform: translate(0, 0); }
          26% { opacity: 0; transform: translate(-110%, 70%) rotate(-50deg); }
          100% { opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .gp-kb-target,
          .gp-kb-flyer,
          .gp-kb-spark-a,
          .gp-kb-spark-b {
            animation: none;
          }
          .gp-kb-flyer { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
