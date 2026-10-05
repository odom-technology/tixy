'use client';

/* Gem Roll hover preview — emulates the real instant pattern wager
   (src/app/(games)/gem-roll/_gem-roll-client.tsx). The real game rolls five
   faceted gems into a socket tray; matching colours flare and pay the poker
   pattern they form. This standalone preview drops five gems in a staggered
   cascade and settles a full house (three ruby + two sapphire), flaring the
   matched trio. Flat enamel, nothing glows beyond the match flare. No game
   imports. */

// Faceted-gem clip-path (matches the SVG jewel silhouette in the real game).
const GEM_CLIP = 'polygon(20% 22%, 80% 22%, 92% 44%, 50% 92%, 8% 44%)';

type Jewel = { face: string; hi: string; edge: string; matched: boolean };

// Settled full house: 3× ruby (matched) + 2× sapphire (matched pair).
const JEWELS: Jewel[] = [
  { face: '#c73538', hi: '#e6595c', edge: '#5a181b', matched: true },
  { face: '#3a86c4', hi: '#63aae4', edge: '#163e5e', matched: true },
  { face: '#c73538', hi: '#e6595c', edge: '#5a181b', matched: true },
  { face: '#3a86c4', hi: '#63aae4', edge: '#163e5e', matched: true },
  { face: '#c73538', hi: '#e6595c', edge: '#5a181b', matched: true },
];

export default function GemRollPreview() {
  return (
    <div className='absolute inset-0 overflow-hidden gp-gr-root'>
      <div className='gp-gr-row'>
        {JEWELS.map((j, i) => (
          <span className='gp-gr-socket' key={i} style={{ ['--d' as string]: `${i * 0.14}s` }}>
            <span className='gp-gr-gem' style={{ ['--face' as string]: j.face, ['--edge' as string]: j.edge }}>
              <span className='gp-gr-table' style={{ background: j.hi }} />
            </span>
            {j.matched ? <span className='gp-gr-flare' /> : null}
          </span>
        ))}
      </div>

      <style jsx>{`
        .gp-gr-root {
          background: var(--screen-well);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .gp-gr-row {
          display: flex;
          align-items: center;
          gap: 6%;
          width: 84%;
          justify-content: center;
        }
        .gp-gr-socket {
          position: relative;
          width: 15%;
          aspect-ratio: 3 / 4;
          border-radius: 26%;
          background: #171009;
          border: 1px solid #0c0803;
          box-shadow: inset 0 2px 6px #000000aa, inset 0 0 0 1px #ffffff10;
          display: grid;
          place-items: center;
        }
        .gp-gr-gem {
          position: relative;
          width: 76%;
          aspect-ratio: 1;
          background: var(--face);
          clip-path: ${GEM_CLIP};
          outline: 2px solid var(--edge);
          outline-offset: -2px;
          animation: gp-gr-drop 2.6s ease-in-out var(--d) infinite;
        }
        .gp-gr-table {
          position: absolute;
          left: 27%;
          top: 27%;
          width: 46%;
          height: 16%;
          clip-path: polygon(0 0, 100% 0, 85% 100%, 15% 100%);
        }
        .gp-gr-flare {
          position: absolute;
          inset: -8%;
          border-radius: 30%;
          border: 2px solid #f2c14e;
          opacity: 0;
          animation: gp-gr-flare 2.6s ease-out var(--d) infinite;
        }
        @keyframes gp-gr-drop {
          0% { transform: translateY(-120%) rotate(-14deg); opacity: 0; }
          14% { transform: translateY(0) rotate(0deg); opacity: 1; }
          70% { transform: translateY(0) rotate(0deg); opacity: 1; }
          86%, 100% { transform: translateY(-120%) rotate(-14deg); opacity: 0; }
        }
        @keyframes gp-gr-flare {
          0%, 20% { opacity: 0; transform: scale(0.9); }
          30% { opacity: 0.9; transform: scale(1); }
          55% { opacity: 0; transform: scale(1.14); }
          100% { opacity: 0; transform: scale(1.14); }
        }
      `}</style>
    </div>
  );
}
