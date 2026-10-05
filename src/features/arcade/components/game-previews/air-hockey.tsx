/* Hover preview for Air Hockey — emulates the real game's default Midway look
 * from _air-hockey-client.tsx: a lacquered-wood rink frame around a cream
 * playfield with a painted teal center line + center circle, a red enamel
 * mallet up top and a teal enamel mallet at the bottom, and a cream puck chip
 * that bounces between them across the center line. NOTHING glows — the goal
 * accent is flat enamel; the puck carries only a hard offset shadow.
 *
 * Motion: the puck ricochets top↔bottom off each mallet while the mallets slide
 * sideways to meet it. Reduced motion freezes the puck mid-rink. */
export default function AirHockeyPreview() {
  return (
    <div className='absolute inset-0 overflow-hidden gp-ah-frame'>
      {/* cream playfield well inside the wood frame */}
      <div className='gp-ah-field'>
        {/* painted center line + circle (teal enamel) */}
        <i className='gp-ah-centerline' />
        <i className='gp-ah-circle' />
        <i className='gp-ah-dot' />

        {/* goal mouths (recessed slots with red posts) top + bottom */}
        <i className='gp-ah-goal gp-ah-goal-top' />
        <i className='gp-ah-goal gp-ah-goal-bottom' />

        {/* red enamel mallet (top) */}
        <i className='gp-ah-mallet gp-ah-mallet-top' />
        {/* teal enamel mallet (bottom) */}
        <i className='gp-ah-mallet gp-ah-mallet-bottom' />

        {/* cream puck chip bouncing between the mallets */}
        <i className='gp-ah-puck' />
      </div>

      <style jsx>{`
        .gp-ah-frame {
          background: linear-gradient(180deg, #6b4a26 0%, #5a3e20 50%, #4a3219 100%);
          box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.4);
        }
        .gp-ah-field {
          position: absolute;
          inset: 7% 9%;
          border-radius: 3px;
          background: linear-gradient(180deg, #efe6d2 0%, #e2d6bd 100%);
          box-shadow:
            inset 0 2px 0 rgba(255, 255, 255, 0.45),
            inset 0 -2px 0 rgba(0, 0, 0, 0.18),
            inset 0 0 18px rgba(0, 0, 0, 0.12);
          overflow: hidden;
        }

        /* center line + circle (teal) */
        .gp-ah-centerline {
          position: absolute;
          left: 0;
          right: 0;
          top: 50%;
          height: 2px;
          margin-top: -1px;
          background: #1d8579;
        }
        .gp-ah-circle {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 34%;
          aspect-ratio: 1;
          transform: translate(-50%, -50%);
          border: 2px solid #1d8579;
          border-radius: 50%;
        }
        .gp-ah-dot {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 5px;
          height: 5px;
          margin: -2.5px 0 0 -2.5px;
          background: #c73538;
          border-radius: 50%;
        }

        /* goals — recessed slots with red posts at the short walls */
        .gp-ah-goal {
          position: absolute;
          left: 50%;
          width: 38%;
          height: 5px;
          transform: translateX(-50%);
          background: #1a120a;
          box-shadow: -3px 0 0 #c73538, 3px 0 0 #c73538;
        }
        .gp-ah-goal-top {
          top: 0;
        }
        .gp-ah-goal-bottom {
          bottom: 0;
        }

        /* mallets — flat enamel discs with a dark ring edge + offset shadow */
        .gp-ah-mallet {
          position: absolute;
          left: 50%;
          width: 22%;
          aspect-ratio: 1;
          margin-left: -11%;
          border-radius: 50%;
          box-shadow:
            1px 2px 0 rgba(0, 0, 0, 0.38),
            inset 0 0 0 3px rgba(0, 0, 0, 0.28),
            inset 0 0 0 5px rgba(255, 255, 255, 0.16);
        }
        .gp-ah-mallet-top {
          top: 12%;
          background: radial-gradient(circle at 40% 36%, #d34b4e 0%, #c73538 55%, #7e2225 100%);
          animation: gp-ah-mallet-top 3s ease-in-out infinite;
        }
        .gp-ah-mallet-bottom {
          bottom: 12%;
          background: radial-gradient(circle at 40% 36%, #46cdbb 0%, #2fb8a6 55%, #1b7466 100%);
          animation: gp-ah-mallet-bottom 3s ease-in-out infinite;
        }

        /* puck — cream chip with a hard offset shadow (no glow) */
        .gp-ah-puck {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 12%;
          aspect-ratio: 1;
          margin: -6% 0 0 -6%;
          border-radius: 50%;
          background: radial-gradient(circle at 38% 34%, #ffffff 0%, #f6eddc 62%, #b9ad95 100%);
          box-shadow: 1px 2px 0 rgba(0, 0, 0, 0.4);
          animation: gp-ah-puck 3s cubic-bezier(0.45, 0, 0.55, 1) infinite;
        }

        /* puck ricochets between the two mallets, drifting side to side */
        @keyframes gp-ah-puck {
          0% {
            top: 24%;
            left: 50%;
          }
          50% {
            top: 70%;
            left: 38%;
          }
          100% {
            top: 24%;
            left: 62%;
          }
        }
        /* mallets slide to meet the puck */
        @keyframes gp-ah-mallet-top {
          0% {
            left: 50%;
          }
          50% {
            left: 44%;
          }
          100% {
            left: 56%;
          }
        }
        @keyframes gp-ah-mallet-bottom {
          0% {
            left: 50%;
          }
          50% {
            left: 38%;
          }
          100% {
            left: 56%;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .gp-ah-puck,
          .gp-ah-mallet-top,
          .gp-ah-mallet-bottom {
            animation: none;
          }
          .gp-ah-puck {
            top: 50%;
            left: 50%;
          }
        }
      `}</style>
    </div>
  );
}
