/* Hover preview for Crossy Chicken: top-down highway view matching the real
 * game. A cream chicken hops forward (rightward) strip-to-strip across vertical
 * asphalt lanes split by dashed cream dividers, while enamel cars slide
 * vertically through the lanes (alternating direction per strip). A mono amber
 * multiplier climbs one tick per strip crossed. Pure CSS/SVG. Loops. */
export default function ChickenPreview() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* dark lacquered road base */}
      <div className="gp-chicken-road">
        {/* teal infield start zone on the far left */}
        <span className="gp-chicken-grass" />
        {/* amber curb between infield and asphalt */}
        <span className="gp-chicken-curb" />
        {/* cream shoulder lines top + bottom of the road */}
        <span className="gp-chicken-edge gp-chicken-edge-top" />
        <span className="gp-chicken-edge gp-chicken-edge-bot" />
        {/* dashed cream dividers between strips */}
        <span className="gp-chicken-div gp-chicken-div0" />
        <span className="gp-chicken-div gp-chicken-div1" />
        <span className="gp-chicken-div gp-chicken-div2" />
        <span className="gp-chicken-div gp-chicken-div3" />

        {/* enamel cars riding the strips (vertical traffic, alt directions) */}
        <span className="gp-chicken-car gp-chicken-carA" />
        <span className="gp-chicken-car gp-chicken-carB" />
        <span className="gp-chicken-car gp-chicken-carC" />

        {/* the chicken — anchored low, hops forward (right) lane by lane */}
        <span className="gp-chicken-bird">
          <span className="gp-chicken-tail" />
          <span className="gp-chicken-wing" />
          <span className="gp-chicken-head" />
          <span className="gp-chicken-comb" />
          <span className="gp-chicken-beak" />
        </span>
      </div>

      {/* rising multiplier readout — one tick per strip crossed */}
      <div className="gp-chicken-mult">
        <span className="gp-chicken-mult-n gp-chicken-mult-n0">1.06x</span>
        <span className="gp-chicken-mult-n gp-chicken-mult-n1">1.21x</span>
        <span className="gp-chicken-mult-n gp-chicken-mult-n2">1.37x</span>
        <span className="gp-chicken-mult-n gp-chicken-mult-n3">1.56x</span>
      </div>

      <style jsx>{`
        .gp-chicken-road {
          position: absolute;
          inset: 0;
          /* dark lacquered asphalt */
          background: #1b140d;
        }

        /* teal-enamel infield safe zone on the left */
        .gp-chicken-grass {
          position: absolute;
          top: 0;
          bottom: 0;
          left: 0;
          width: 18%;
          background: #1d8579;
          background-image: repeating-linear-gradient(
            90deg,
            rgba(63, 201, 182, 0.18) 0,
            rgba(63, 201, 182, 0.18) 7%,
            transparent 7%,
            transparent 14%
          );
        }
        /* amber curb edge of the infield */
        .gp-chicken-curb {
          position: absolute;
          top: 0;
          bottom: 0;
          left: 18%;
          width: 1.5%;
          background: #f2a33c;
          box-shadow: inset -1px 0 0 #9a621a;
        }

        /* cream road shoulder lines */
        .gp-chicken-edge {
          position: absolute;
          left: 19.5%;
          right: 0;
          height: 2px;
          background: #e8d9b8;
          opacity: 0.85;
        }
        .gp-chicken-edge-top {
          top: 8%;
        }
        .gp-chicken-edge-bot {
          bottom: 8%;
        }

        /* dashed cream lane dividers, scrolling left as the camera advances */
        .gp-chicken-div {
          position: absolute;
          top: 10%;
          bottom: 10%;
          width: 0;
          border-left: 2px dashed rgba(246, 237, 220, 0.42);
          animation: gp-chicken-scroll 3.4s linear infinite;
        }
        .gp-chicken-div0 {
          left: 38%;
        }
        .gp-chicken-div1 {
          left: 58%;
        }
        .gp-chicken-div2 {
          left: 78%;
        }
        .gp-chicken-div3 {
          left: 98%;
        }

        /* enamel cars — flat saturated body on a dark ink stroke */
        .gp-chicken-car {
          position: absolute;
          width: 10%;
          height: 22%;
          border-radius: 3px;
          box-shadow: inset 0 1px 1px rgba(255, 247, 234, 0.18),
            inset 0 -2px 3px rgba(0, 0, 0, 0.45);
        }
        /* dark windshield band across each car */
        .gp-chicken-car::before {
          content: '';
          position: absolute;
          left: 14%;
          right: 14%;
          top: 30%;
          height: 26%;
          border-radius: 2px;
          background: rgba(12, 9, 7, 0.82);
        }
        /* strip 1 car — enamel red, traveling DOWN */
        .gp-chicken-carA {
          left: 44%;
          background: #c73538;
          border: 1.5px solid #5a1719;
          animation: gp-chicken-down 2.2s linear infinite;
        }
        /* strip 2 car — enamel blue, traveling UP */
        .gp-chicken-carB {
          left: 64%;
          background: #3b6fd4;
          border: 1.5px solid #1c3469;
          animation: gp-chicken-up 2.8s linear infinite;
          animation-delay: 0.6s;
        }
        /* strip 3 car — ticket amber, traveling DOWN */
        .gp-chicken-carC {
          left: 84%;
          background: #f2a33c;
          border: 1.5px solid #7a4f17;
          animation: gp-chicken-down 2.5s linear infinite;
          animation-delay: 1.1s;
        }

        /* chicken: cream body, anchored low-left, hops rightward strip-to-strip */
        .gp-chicken-bird {
          position: absolute;
          bottom: 40%;
          left: 28%;
          width: 12%;
          aspect-ratio: 1.18 / 1;
          border-radius: 50%;
          background: #f3e6c4;
          border: 1.5px solid #0a0704;
          transform-origin: 50% 100%;
          animation: gp-chicken-hop 3.4s ease-in-out infinite;
        }
        /* amber tail feathers at the back (left) */
        .gp-chicken-tail {
          position: absolute;
          left: -34%;
          top: 18%;
          width: 44%;
          height: 44%;
          background: #f2a33c;
          border: 1.5px solid #0a0704;
          clip-path: polygon(100% 30%, 0 0, 18% 100%);
        }
        /* amber wing on the body */
        .gp-chicken-wing {
          position: absolute;
          left: 18%;
          top: 42%;
          width: 50%;
          height: 38%;
          border-radius: 50%;
          background: #e8a23a;
          border: 1px solid #0a0704;
        }
        /* head, front (right) */
        .gp-chicken-head {
          position: absolute;
          right: -10%;
          top: -22%;
          width: 52%;
          height: 52%;
          border-radius: 50%;
          background: #f3e6c4;
          border: 1.5px solid #0a0704;
        }
        /* red enamel comb crest on top of the head */
        .gp-chicken-comb {
          position: absolute;
          right: 6%;
          top: -38%;
          width: 30%;
          height: 26%;
          border-radius: 999px 999px 4px 4px;
          background: #c73538;
        }
        /* amber/orange beak pointing right */
        .gp-chicken-beak {
          position: absolute;
          right: -22%;
          top: 2%;
          border-top: 4px solid transparent;
          border-bottom: 4px solid transparent;
          border-left: 9px solid #e8902a;
        }

        /* rising multiplier readout, mono amber, top-left of the road */
        .gp-chicken-mult {
          position: absolute;
          left: 4%;
          top: 8%;
          font-family: var(--font-mono-arcade), monospace;
        }
        .gp-chicken-mult-n {
          position: absolute;
          left: 0;
          top: 0;
          font-size: clamp(11px, 3.4vw, 20px);
          font-weight: 700;
          line-height: 1;
          color: #f2a33c;
          text-shadow: 0 1px 0 rgba(10, 7, 4, 0.85),
            0 0 6px rgba(0, 0, 0, 0.5);
          opacity: 0;
          animation: gp-chicken-tick 3.4s steps(1, end) infinite;
        }
        .gp-chicken-mult-n0 {
          animation-name: gp-chicken-tick0;
        }
        .gp-chicken-mult-n1 {
          animation-name: gp-chicken-tick1;
        }
        .gp-chicken-mult-n2 {
          animation-name: gp-chicken-tick2;
        }
        .gp-chicken-mult-n3 {
          animation-name: gp-chicken-tick3;
        }

        /* chicken hops forward across four strips, pausing between each hop,
         * each hop a small upward arc + squash/stretch, then loops back. */
        @keyframes gp-chicken-hop {
          0%,
          6% {
            left: 28%;
            bottom: 40%;
            transform: scaleY(1);
          }
          11% {
            bottom: 52%;
            transform: scaleY(1.12);
          }
          17%,
          27% {
            left: 44%;
            bottom: 40%;
            transform: scaleY(1);
          }
          32% {
            bottom: 52%;
            transform: scaleY(1.12);
          }
          38%,
          48% {
            left: 60%;
            bottom: 40%;
            transform: scaleY(1);
          }
          53% {
            bottom: 52%;
            transform: scaleY(1.12);
          }
          59%,
          69% {
            left: 76%;
            bottom: 40%;
            transform: scaleY(1);
          }
          74% {
            bottom: 52%;
            transform: scaleY(1.12);
          }
          80%,
          92% {
            left: 92%;
            bottom: 40%;
            transform: scaleY(1);
          }
          /* reset back to the infield for the next run */
          100% {
            left: 28%;
            bottom: 40%;
            transform: scaleY(1);
          }
        }

        /* dividers drift left one strip-width then reset, selling forward motion */
        @keyframes gp-chicken-scroll {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-20%);
          }
        }

        /* vertical traffic */
        @keyframes gp-chicken-down {
          0% {
            top: -26%;
          }
          100% {
            top: 104%;
          }
        }
        @keyframes gp-chicken-up {
          0% {
            top: 104%;
          }
          100% {
            top: -26%;
          }
        }

        /* multiplier ticks: each value shows only while the chicken sits on
         * the matching strip, climbing one rung per crossed strip. */
        @keyframes gp-chicken-tick0 {
          0%,
          16% {
            opacity: 1;
          }
          17%,
          100% {
            opacity: 0;
          }
        }
        @keyframes gp-chicken-tick1 {
          0%,
          16% {
            opacity: 0;
          }
          17%,
          37% {
            opacity: 1;
          }
          38%,
          100% {
            opacity: 0;
          }
        }
        @keyframes gp-chicken-tick2 {
          0%,
          37% {
            opacity: 0;
          }
          38%,
          58% {
            opacity: 1;
          }
          59%,
          100% {
            opacity: 0;
          }
        }
        @keyframes gp-chicken-tick3 {
          0%,
          58% {
            opacity: 0;
          }
          59%,
          92% {
            opacity: 1;
          }
          93%,
          100% {
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
