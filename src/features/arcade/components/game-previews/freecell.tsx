/* Hover preview for FreeCell Sprint — a tiny solitaire table on the Midway
 * cabinet: four free cells + four foundation piles across the top, a couple of
 * short cascades below, and one red card sliding home to its foundation on a
 * loop. Classic red/black ink on a green felt. Purely decorative — not a real
 * board. Loops cheaply; degrades under prefers-reduced-motion to the static
 * layout. NOTHING glows. */
export default function FreecellPreview() {
  const cell = (key: string, label: string, red: boolean, cls = '') => (
    <span key={key} className={`gp-fc-card ${red ? 'gp-fc-red' : 'gp-fc-black'} ${cls}`}>
      {label}
    </span>
  );

  return (
    <div className="absolute inset-0 overflow-hidden gp-fc">
      <div className="gp-fc-table">
        <div className="gp-fc-top">
          <div className="gp-fc-frees">
            <span className="gp-fc-slot" />
            {cell('f1', '♠', false)}
            <span className="gp-fc-slot" />
            <span className="gp-fc-slot" />
          </div>
          <div className="gp-fc-founds">
            <span className="gp-fc-slot gp-fc-found">{'A'}</span>
            <span className="gp-fc-slot gp-fc-found gp-fc-found-target" />
            <span className="gp-fc-slot gp-fc-found">{'A'}</span>
            <span className="gp-fc-slot gp-fc-found">{'2'}</span>
          </div>
        </div>
        <div className="gp-fc-cascades">
          <div className="gp-fc-col">
            {cell('c1', 'K', false)}
            {cell('c2', 'Q', true)}
            {cell('c3', 'J', false)}
          </div>
          <div className="gp-fc-col">
            {cell('c4', '9', true)}
            {cell('c5', '8', false)}
          </div>
          <div className="gp-fc-col">
            {cell('c6', '7', false)}
            {cell('c7', '6', true)}
            {cell('c8', '5', false)}
          </div>
          <div className="gp-fc-col">
            {cell('c9', '4', true)}
          </div>
        </div>
        {/* the traveling card that flies home */}
        <span className="gp-fc-card gp-fc-red gp-fc-fly">2</span>
      </div>

      <style jsx>{`
        .gp-fc {
          background: linear-gradient(180deg, #14322b 0%, #0c211d 100%);
          display: grid;
          place-items: center;
          padding: 9%;
        }
        .gp-fc-table {
          position: relative;
          width: 100%;
          height: 100%;
          border-radius: 10px;
          padding: 7%;
          background: radial-gradient(120% 90% at 50% 0%, #1a3e35 0%, #0f2822 70%);
          box-shadow: inset 0 0 0 3px #2c2013, inset 0 2px 10px rgba(0, 0, 0, 0.5);
          display: flex;
          flex-direction: column;
          gap: 9%;
        }
        .gp-fc-top {
          display: flex;
          justify-content: space-between;
          gap: 6%;
        }
        .gp-fc-frees,
        .gp-fc-founds {
          display: flex;
          gap: 5%;
          flex: 1;
        }
        .gp-fc-slot {
          flex: 1;
          aspect-ratio: 5 / 7;
          border-radius: 3px;
          border: 1px dashed rgba(255, 255, 255, 0.22);
          display: grid;
          place-items: center;
          font-size: 8px;
          font-weight: 800;
          color: rgba(255, 255, 255, 0.5);
          background: rgba(0, 0, 0, 0.16);
        }
        .gp-fc-found {
          border-style: solid;
          border-color: rgba(29, 133, 121, 0.7);
          color: #d7b46a;
        }
        .gp-fc-cascades {
          display: flex;
          justify-content: center;
          gap: 6%;
          flex: 1;
        }
        .gp-fc-col {
          flex: 1;
          display: flex;
          flex-direction: column;
        }
        .gp-fc-card {
          aspect-ratio: 5 / 7;
          border-radius: 3px;
          background: linear-gradient(135deg, #fbf6ea, #ede0c6);
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.4);
          display: grid;
          place-items: center;
          font-size: 9px;
          font-weight: 900;
          line-height: 1;
        }
        .gp-fc-col .gp-fc-card:not(:first-child) {
          margin-top: -58%;
        }
        .gp-fc-red {
          color: #c0322f;
        }
        .gp-fc-black {
          color: #1c1712;
        }
        .gp-fc-fly {
          position: absolute;
          left: 6%;
          bottom: 6%;
          width: 11%;
          animation: gpFcFly 3.4s ease-in-out infinite;
        }
        @keyframes gpFcFly {
          0%,
          12% {
            transform: translate(0, 0) scale(1);
            opacity: 0;
          }
          20% {
            opacity: 1;
          }
          70% {
            transform: translate(180%, -290%) scale(0.82);
            opacity: 1;
          }
          82%,
          100% {
            transform: translate(180%, -290%) scale(0.82);
            opacity: 0;
          }
        }
        .gp-fc-found-target {
          animation: gpFcPulse 3.4s ease-in-out infinite;
        }
        @keyframes gpFcPulse {
          0%,
          66% {
            background: rgba(0, 0, 0, 0.16);
          }
          74% {
            background: rgba(29, 133, 121, 0.4);
          }
          100% {
            background: rgba(0, 0, 0, 0.16);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .gp-fc-fly,
          .gp-fc-found-target {
            animation: none;
          }
          .gp-fc-fly {
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
