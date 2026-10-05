/* Fortune Teller hover preview — emulates the real tarot booth
   (src/app/(games)/fortune-teller/_fortune-teller-client.tsx). A crystal ball
   on its stand sits above three tarot-style cards that flip face-up in the game
   order middle → left → right, revealing enamel-painted multipliers (teal small,
   blue mid, violet big, amber huge, red jackpot; slate = bust). Velvet plum
   backdrop. transform/opacity only. No game imports. */

type Card = { face: string; edge: string; on: string; label: string; glyph: string };

// left, middle, right — as laid out on screen. The middle card is the jackpot.
const CARDS: Card[] = [
  { face: '#3a86c4', edge: '#163e5e', on: '#04161f', label: '2×', glyph: 'star' },
  { face: '#c73538', edge: '#5a181b', on: '#ffefe4', label: '5×', glyph: 'sun' },
  { face: '#3a444c', edge: '#1a2228', on: '#c9d3da', label: 'BUST', glyph: 'moon' },
];

// Flip delay per card, keyed to the middle→left→right reveal order.
const FLIP_DELAY = ['1.1s', '0.5s', '1.7s']; // left, middle, right

function Glyph({ name, color }: { name: string; color: string }) {
  const common = { fill: 'none', stroke: color, strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (name === 'sun') {
    return (
      <svg viewBox='0 0 24 24' width='100%' height='100%' aria-hidden>
        <circle cx='12' cy='12' r='4' {...common} />
        {Array.from({ length: 8 }).map((_, i) => {
          const a = (i * Math.PI) / 4;
          return <line key={i} x1={12 + Math.cos(a) * 6.4} y1={12 + Math.sin(a) * 6.4} x2={12 + Math.cos(a) * 8.8} y2={12 + Math.sin(a) * 8.8} {...common} />;
        })}
      </svg>
    );
  }
  if (name === 'moon') {
    return (
      <svg viewBox='0 0 24 24' width='100%' height='100%' aria-hidden>
        <path d='M15.5 4 A8 8 0 1 0 20 14.5 A6 6 0 1 1 15.5 4 Z' {...common} />
      </svg>
    );
  }
  return (
    <svg viewBox='0 0 24 24' width='100%' height='100%' aria-hidden>
      <path d='M12 3 L14 9.5 L20.5 9.5 L15.2 13.5 L17.2 20 L12 16 L6.8 20 L8.8 13.5 L3.5 9.5 L10 9.5 Z' {...common} />
    </svg>
  );
}

export default function FortuneTellerPreview() {
  return (
    <div className='absolute inset-0 overflow-hidden gp-ft'>
      {/* crystal ball */}
      <span className='gp-ft-ball' aria-hidden>
        <span className='gp-ft-orb' />
        <span className='gp-ft-base' />
      </span>

      {/* three cards */}
      <div className='gp-ft-cards'>
        {CARDS.map((c, i) => (
          <span
            className='gp-ft-card'
            key={i}
            style={{ animationDelay: FLIP_DELAY[i] }}
          >
            <span className='gp-ft-inner'>
              <span className='gp-ft-back' aria-hidden />
              <span
                className='gp-ft-front'
                style={{ background: c.face, borderColor: c.edge, color: c.on }}
              >
                <span className='gp-ft-glyph'><Glyph name={c.glyph} color={c.on} /></span>
                <span className='gp-ft-mult'>{c.label}</span>
              </span>
            </span>
          </span>
        ))}
      </div>

      <style jsx>{`
        .gp-ft {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8%;
          background:
            radial-gradient(120% 80% at 50% 0%, #3a1a52, transparent 60%),
            linear-gradient(180deg, #2a1140, #170a26);
        }
        .gp-ft-ball {
          position: relative;
          width: clamp(26px, 9vw, 44px);
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .gp-ft-orb {
          width: 100%;
          aspect-ratio: 1;
          border-radius: 50%;
          background: radial-gradient(circle at 38% 32%, #ffffffcc, #7fc7e0 34%, #b9d9e8 66%, #2a1d10 100%);
          box-shadow: inset 0 -4px 8px #00000055, 0 3px 8px #00000060;
          animation: gp-ft-glow 1.6s ease-in-out infinite;
        }
        .gp-ft-base {
          width: 62%;
          height: 6px;
          margin-top: -2px;
          border-radius: 0 0 40% 40% / 0 0 100% 100%;
          background: #2a1d10;
          border: 1px solid #0f0a05;
        }
        @keyframes gp-ft-glow {
          0%, 100% { filter: brightness(1); }
          50% { filter: brightness(1.25); }
        }
        .gp-ft-cards {
          display: flex;
          gap: clamp(5px, 2.4vw, 12px);
          align-items: center;
          perspective: 600px;
        }
        .gp-ft-card {
          width: clamp(26px, 9vw, 46px);
          aspect-ratio: 5 / 7.4;
        }
        .gp-ft-inner {
          position: relative;
          display: block;
          width: 100%;
          height: 100%;
          transform-style: preserve-3d;
          animation: gp-ft-flip 4s cubic-bezier(0.34, 1.3, 0.5, 1) infinite;
        }
        .gp-ft-back,
        .gp-ft-front {
          position: absolute;
          inset: 0;
          border-radius: 6px;
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8%;
          box-shadow: 0 3px 8px #00000055;
        }
        .gp-ft-back {
          background: #3a2466;
          border: 1.5px solid #0f0a05;
        }
        .gp-ft-back::after {
          content: '';
          width: 52%;
          aspect-ratio: 1;
          border: 1.5px solid #e6c96a;
          border-radius: 50%;
          opacity: 0.6;
        }
        .gp-ft-front {
          transform: rotateY(180deg);
          border: 1.5px solid;
        }
        .gp-ft-glyph { width: 42%; aspect-ratio: 1; opacity: 0.9; }
        .gp-ft-mult {
          font-family: var(--font-mono-arcade);
          font-weight: 800;
          font-size: clamp(7px, 2.2vw, 12px);
          line-height: 1;
        }
        /* Hold face-down, flip up, hold face-up, then reset for the loop. */
        @keyframes gp-ft-flip {
          0%, 10% { transform: rotateY(0deg); }
          32%, 88% { transform: rotateY(180deg); }
          98%, 100% { transform: rotateY(0deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .gp-ft-inner { animation: none; transform: rotateY(180deg); }
          .gp-ft-orb { animation: none; }
        }
      `}</style>
    </div>
  );
}
