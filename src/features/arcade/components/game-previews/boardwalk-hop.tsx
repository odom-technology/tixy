/* Hover preview for Boardwalk Hop — a frogger-like carnival hopper. Inline SVG
 * matching the real game's default Midway look: warm boardwalk planks, a grey
 * cart road with a red bumper-cart, and a teal water flume where the yellow
 * duckling mascot rides a drifting log before hopping onward. CSS-animated,
 * no game imports. Respects prefers-reduced-motion. */
export default function BoardwalkHopPreview() {
  return (
    <div className="absolute inset-0 overflow-hidden bh-prev">
      <svg
        viewBox="0 0 200 120"
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full"
        aria-hidden
      >
        <defs>
          <linearGradient id="bhp-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f6c8a0" />
            <stop offset="1" stopColor="#f4e3c6" />
          </linearGradient>
          <linearGradient id="bhp-water" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3d93a1" />
            <stop offset="1" stopColor="#1f5763" />
          </linearGradient>
          <linearGradient id="bhp-road" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5b5450" />
            <stop offset="1" stopColor="#3f3a37" />
          </linearGradient>
          <linearGradient id="bhp-log" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8f6238" />
            <stop offset="0.6" stopColor="#7a5230" />
            <stop offset="1" stopColor="#553920" />
          </linearGradient>
        </defs>

        <rect width="200" height="120" fill="url(#bhp-sky)" />

        {/* far plank row */}
        <g>
          <rect x="-4" y="8" width="208" height="22" fill="#c79a5e" />
          <g fill="#a9773f">
            {Array.from({ length: 9 }).map((_, i) => (
              <rect key={i} x={i * 24 + 10} y="8" width="2.5" height="22" />
            ))}
          </g>
          <rect x="-4" y="27" width="208" height="4" fill="#6b4525" />
        </g>

        {/* cart road */}
        <g>
          <rect x="-4" y="34" width="208" height="24" fill="url(#bhp-road)" />
          <line x1="0" y1="46" x2="200" y2="46" stroke="#8e8781" strokeWidth="1.6" strokeDasharray="7 6" opacity="0.6" />
          <g className="bhp-cart">
            <rect x="0" y="38" width="26" height="15" rx="4" fill="#8f2427" />
            <rect x="0" y="36" width="26" height="13" rx="4" fill="#c73538" />
            <rect x="2.5" y="37.5" width="21" height="3.5" rx="1.6" fill="#e8888a" />
            <circle cx="24" cy="43" r="1.8" fill="#ffe9a8" />
          </g>
          <rect x="-4" y="54" width="208" height="4" fill="#2e2a28" />
        </g>

        {/* mid plank row */}
        <g>
          <rect x="-4" y="62" width="208" height="22" fill="#c79a5e" />
          <g fill="#a9773f">
            {Array.from({ length: 9 }).map((_, i) => (
              <rect key={i} x={i * 24 - 2} y="62" width="2.5" height="22" />
            ))}
          </g>
          <rect x="-4" y="81" width="208" height="4" fill="#6b4525" />
        </g>

        {/* water flume with a ridden log */}
        <g>
          <rect x="-4" y="88" width="208" height="26" fill="url(#bhp-water)" />
          <path
            className="bhp-wave"
            d="M -8 96 Q 2 93 12 96 T 32 96 T 52 96 T 72 96 T 92 96 T 112 96 T 132 96 T 152 96 T 172 96 T 192 96 T 212 96"
            fill="none"
            stroke="#7fd0da"
            strokeWidth="1.4"
            opacity="0.55"
          />
          <g className="bhp-log-group">
            {/* log */}
            <rect x="-30" y="94" width="52" height="14" rx="7" fill="url(#bhp-log)" />
            <ellipse cx="-24" cy="101" rx="4.5" ry="6" fill="#a97c48" />
            <ellipse cx="-24" cy="101" rx="2.2" ry="3" fill="none" stroke="#553920" strokeWidth="1" />
            <rect x="-14" y="95.5" width="30" height="2.5" rx="1.2" fill="#ffffff" opacity="0.16" />
            {/* the duckling riding it */}
            <g className="bhp-duck-bob">
              <ellipse cx="0" cy="93" rx="8.5" ry="7" fill="#f2c14e" stroke="#8a5c10" strokeWidth="1" />
              <ellipse cx="0" cy="95" rx="4.6" ry="3.6" fill="#fbe6b4" />
              <ellipse cx="0" cy="85.5" rx="5" ry="4.2" fill="#f7cd66" />
              <ellipse cx="4" cy="86.5" rx="2.6" ry="1.5" fill="#e0a23f" />
              <circle cx="1.6" cy="84.6" r="1.1" fill="#3a2414" />
            </g>
          </g>
          <rect x="-4" y="110" width="208" height="4" fill="#173f48" />
        </g>

        {/* gull circling */}
        <g className="bhp-gull">
          <ellipse cx="0" cy="0" rx="6" ry="3" fill="#f2efe9" />
          <path d="M -2 -1 Q -8 -6 -12 -3" stroke="#b9b2a4" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M 2 -1 Q 8 -6 12 -3" stroke="#b9b2a4" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>

        {/* close-call spark + score pop */}
        <g className="bhp-pop">
          <text x="120" y="80" fontFamily="ui-monospace, monospace" fontWeight="900" fontSize="10" fill="#fff6e2" stroke="#1c160d" strokeWidth="0.6">
            +3
          </text>
        </g>
      </svg>

      <style jsx>{`
        .bhp-cart {
          animation: bhp-cart-slide 2.8s linear infinite;
        }
        .bhp-log-group {
          animation: bhp-log-drift 5.2s linear infinite;
        }
        .bhp-duck-bob {
          animation: bhp-bob 1.3s ease-in-out infinite;
        }
        .bhp-wave {
          animation: bhp-wave-slide 2.4s linear infinite;
        }
        .bhp-gull {
          transform: translate(46px, 22px);
          animation: bhp-gull-circle 5.2s ease-in-out infinite;
        }
        .bhp-pop {
          opacity: 0;
          animation: bhp-pop 5.2s ease-out infinite;
        }
        @keyframes bhp-cart-slide {
          0% { transform: translateX(-30px); }
          100% { transform: translateX(215px); }
        }
        @keyframes bhp-log-drift {
          0% { transform: translateX(210px); }
          100% { transform: translateX(-40px); }
        }
        @keyframes bhp-bob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(1.6px); }
        }
        @keyframes bhp-wave-slide {
          0% { transform: translateX(0); }
          100% { transform: translateX(-20px); }
        }
        @keyframes bhp-gull-circle {
          0%, 100% { transform: translate(46px, 22px); }
          25% { transform: translate(70px, 16px); }
          50% { transform: translate(52px, 26px); }
          75% { transform: translate(30px, 18px); }
        }
        @keyframes bhp-pop {
          0%, 55% { opacity: 0; transform: translateY(0); }
          62% { opacity: 1; }
          85%, 100% { opacity: 0; transform: translateY(-12px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .bhp-cart, .bhp-log-group, .bhp-duck-bob, .bhp-wave, .bhp-gull, .bhp-pop {
            animation: none;
          }
          .bhp-log-group { transform: translateX(90px); }
          .bhp-pop { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
