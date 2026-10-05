'use client';

/* Baccarat hover preview — emulates the real Baccarat table
   (src/app/(games)/baccarat/_baccarat-client.tsx): a green felt with a Player
   hand and a Banker hand of paper cards dealing in, then the Banker side lights
   as the winner. Standalone CSS/DOM — no game imports. Flat enamel, nothing
   glows beyond the winning-side ring. */

const CARDS = [
  { side: 'player', label: '7', suit: '♥', red: true, delay: 0 },
  { side: 'banker', label: 'K', suit: '♠', red: false, delay: 0.12 },
  { side: 'player', label: '2', suit: '♣', red: false, delay: 0.24 },
  { side: 'banker', label: '9', suit: '♦', red: true, delay: 0.36 },
];

export default function BaccaratPreview() {
  return (
    <div className='absolute inset-0 overflow-hidden gp-bac-root'>
      <div className='gp-bac-table'>
        <div className='gp-bac-side gp-bac-player'>
          <span className='gp-bac-tag'>PLAYER</span>
          <div className='gp-bac-hand'>
            {CARDS.filter((c) => c.side === 'player').map((c, i) => (
              <span
                key={i}
                className={`gp-bac-card ${c.red ? 'is-red' : ''}`}
                style={{ ['--d' as string]: `${c.delay}s` }}
              >
                <b>{c.label}</b>
                <i>{c.suit}</i>
              </span>
            ))}
          </div>
          <span className='gp-bac-total'>9</span>
        </div>

        <div className='gp-bac-side gp-bac-banker is-winner'>
          <span className='gp-bac-tag'>BANKER</span>
          <div className='gp-bac-hand'>
            {CARDS.filter((c) => c.side === 'banker').map((c, i) => (
              <span
                key={i}
                className={`gp-bac-card ${c.red ? 'is-red' : ''}`}
                style={{ ['--d' as string]: `${c.delay}s` }}
              >
                <b>{c.label}</b>
                <i>{c.suit}</i>
              </span>
            ))}
          </div>
          <span className='gp-bac-total'>9</span>
        </div>
      </div>

      <style jsx>{`
        .gp-bac-root {
          background:
            radial-gradient(120% 90% at 50% 8%, #16603f 0%, #0e4630 55%, #0a3325 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 7%;
        }
        .gp-bac-table {
          display: flex;
          gap: 9%;
          width: 100%;
          justify-content: center;
          align-items: center;
        }
        .gp-bac-side {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 5%;
          padding: 6% 5%;
          border-radius: 10px;
          border: 1.5px solid #ffffff22;
          background: #ffffff0c;
          min-width: 34%;
        }
        .gp-bac-side.is-winner {
          border-color: var(--enamel-tickets, #e3a52e);
          box-shadow: 0 0 0 2px var(--enamel-tickets, #e3a52e), 0 0 18px #e3a52e55;
          animation: gp-bac-win 3s ease-in-out infinite;
        }
        .gp-bac-tag {
          font-family: var(--font-mono-arcade);
          font-size: clamp(6px, 2vw, 9px);
          font-weight: 800;
          letter-spacing: 0.12em;
          color: #eafff5;
          opacity: 0.85;
        }
        .gp-bac-hand {
          display: flex;
          gap: 4px;
        }
        .gp-bac-card {
          width: clamp(16px, 6vw, 30px);
          aspect-ratio: 5 / 7;
          border-radius: 4px;
          background: linear-gradient(135deg, #fffdf5, #efe7d4);
          border: 1px solid #cbbf9e;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          color: #1c1712;
          box-shadow: 0 2px 4px #00000055;
          transform: translateY(-8px) scale(0.9);
          opacity: 0;
          animation: gp-bac-deal 3s ease-in-out infinite;
          animation-delay: var(--d);
        }
        .gp-bac-card.is-red { color: #c0322f; }
        .gp-bac-card b {
          font-family: var(--font-mono-arcade);
          font-size: clamp(6px, 2.4vw, 11px);
          font-weight: 800;
          line-height: 1;
        }
        .gp-bac-card i {
          font-style: normal;
          font-size: clamp(6px, 2.2vw, 10px);
          line-height: 1;
        }
        .gp-bac-total {
          font-family: var(--font-mono-arcade);
          font-size: clamp(9px, 3.4vw, 16px);
          font-weight: 800;
          color: #ffffff;
        }
        @keyframes gp-bac-deal {
          0%, 6% { transform: translateY(-8px) scale(0.9); opacity: 0; }
          16%, 92% { transform: translateY(0) scale(1); opacity: 1; }
          100% { transform: translateY(-8px) scale(0.9); opacity: 0; }
        }
        @keyframes gp-bac-win {
          0%, 50% { box-shadow: 0 0 0 2px var(--enamel-tickets, #e3a52e), 0 0 8px #e3a52e33; }
          70%, 100% { box-shadow: 0 0 0 2px var(--enamel-tickets, #e3a52e), 0 0 20px #e3a52e77; }
        }
      `}</style>
    </div>
  );
}
