// ---------------------------------------------------------------------------
// Inline SVG card illustrations for each Packs theme.
// Each icon renders at the given size and uses `accent` for highlights.
// ---------------------------------------------------------------------------

type Props = { size?: number; accent?: string; className?: string };

function Snake({ size = 48, accent = '#4ade80', className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      {/* Body coil */}
      <path d="M12 38c0-6 8-6 8-12s-6-6-6-12c0-4 3-7 7-7" stroke={accent} strokeWidth={4} strokeLinecap="round" fill="none" opacity={0.4} />
      {/* Head */}
      <rect x={22} y={5} width={14} height={11} rx={4} fill={accent} />
      {/* Eyes */}
      <circle cx={28} cy={9} r={2} fill="#0f172a" />
      <circle cx={33} cy={9} r={2} fill="#0f172a" />
      <circle cx={28.7} cy={8.5} r={0.8} fill="white" />
      <circle cx={33.7} cy={8.5} r={0.8} fill="white" />
      {/* Tongue */}
      <path d="M36 11l3 2m-3 0l3-2" stroke="#ef4444" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

function Flappy({ size = 48, accent = '#facc15', className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      {/* Body */}
      <ellipse cx={22} cy={24} rx={12} ry={10} fill={accent} />
      {/* Wing */}
      <ellipse cx={16} cy={22} rx={7} ry={5} fill="white" opacity={0.5} transform="rotate(-15 16 22)" />
      {/* Eye white */}
      <circle cx={28} cy={20} r={5} fill="white" />
      {/* Pupil */}
      <circle cx={29.5} cy={20} r={2.5} fill="#0f172a" />
      <circle cx={30} cy={19.2} r={1} fill="white" />
      {/* Beak */}
      <path d="M33 23l7 2-7 2z" fill="#f97316" />
      {/* Tail feathers */}
      <path d="M10 20l-3-4M10 24l-4 0M10 28l-3 4" stroke={accent} strokeWidth={2} strokeLinecap="round" opacity={0.6} />
    </svg>
  );
}

function EightBall({ size = 48, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      {/* Ball */}
      <circle cx={24} cy={24} r={18} fill="#1e293b" />
      <circle cx={24} cy={24} r={18} fill="url(#eb-grad)" />
      {/* Shine */}
      <ellipse cx={18} cy={16} rx={6} ry={4} fill="white" opacity={0.15} transform="rotate(-20 18 16)" />
      {/* Number circle */}
      <circle cx={24} cy={22} r={8} fill="white" />
      {/* Number */}
      <text x={24} y={26} textAnchor="middle" fontSize={11} fontWeight="bold" fill="#0f172a" fontFamily="system-ui">8</text>
      <defs>
        <radialGradient id="eb-grad" cx="0.35" cy="0.3">
          <stop offset="0%" stopColor="#475569" />
          <stop offset="100%" stopColor="#0f172a" />
        </radialGradient>
      </defs>
    </svg>
  );
}

function Tetris({ size = 48, accent = '#a78bfa', className }: Props) {
  const s = 8;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      {/* T-piece */}
      <rect x={12} y={8} width={s} height={s} rx={1.5} fill="#a855f7" />
      <rect x={20} y={8} width={s} height={s} rx={1.5} fill="#a855f7" />
      <rect x={28} y={8} width={s} height={s} rx={1.5} fill="#a855f7" />
      <rect x={20} y={16} width={s} height={s} rx={1.5} fill="#a855f7" />
      {/* L-piece */}
      <rect x={8} y={22} width={s} height={s} rx={1.5} fill="#f97316" />
      <rect x={8} y={30} width={s} height={s} rx={1.5} fill="#f97316" />
      <rect x={16} y={30} width={s} height={s} rx={1.5} fill="#f97316" />
      {/* S-piece */}
      <rect x={26} y={26} width={s} height={s} rx={1.5} fill="#22c55e" />
      <rect x={34} y={26} width={s} height={s} rx={1.5} fill="#22c55e" />
      <rect x={18} y={34} width={s} height={s} rx={1.5} fill={accent} opacity={0.5} />
      <rect x={26} y={34} width={s} height={s} rx={1.5} fill="#22c55e" />
      {/* I-piece bottom */}
      <rect x={34} y={34} width={s} height={s} rx={1.5} fill="#06b6d4" />
    </svg>
  );
}

function CoinFlip({ size = 48, accent = '#fbbf24', className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      {/* Coin */}
      <circle cx={24} cy={24} r={17} fill="url(#cf-grad)" stroke={accent} strokeWidth={2.5} />
      {/* Inner ring */}
      <circle cx={24} cy={24} r={13} stroke={accent} strokeWidth={1} opacity={0.4} fill="none" />
      {/* H */}
      <text x={24} y={29} textAnchor="middle" fontSize={16} fontWeight="900" fill="#78350f" fontFamily="system-ui">H</text>
      {/* Shine */}
      <ellipse cx={17} cy={16} rx={5} ry={3} fill="white" opacity={0.2} transform="rotate(-25 17 16)" />
      <defs>
        <radialGradient id="cf-grad" cx="0.35" cy="0.3">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="100%" stopColor="#d97706" />
        </radialGradient>
      </defs>
    </svg>
  );
}

function TypingTest({ size = 48, accent = '#a78bfa', className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      {/* Keyboard base */}
      <rect x={4} y={18} width={40} height={22} rx={4} fill="#1e293b" stroke={accent} strokeWidth={1.5} opacity={0.8} />
      {/* Key row 1 */}
      <rect x={8} y={22} width={6} height={5} rx={1} fill={accent} opacity={0.6} />
      <rect x={16} y={22} width={6} height={5} rx={1} fill={accent} opacity={0.4} />
      <rect x={24} y={22} width={6} height={5} rx={1} fill={accent} opacity={0.6} />
      <rect x={32} y={22} width={8} height={5} rx={1} fill={accent} opacity={0.4} />
      {/* Key row 2 — spacebar */}
      <rect x={8} y={29} width={6} height={5} rx={1} fill={accent} opacity={0.3} />
      <rect x={16} y={29} width={16} height={5} rx={1} fill={accent} opacity={0.5} />
      <rect x={34} y={29} width={6} height={5} rx={1} fill={accent} opacity={0.3} />
      {/* Cursor blink */}
      <rect x={22} y={8} width={2.5} height={10} rx={1} fill={accent}>
        <animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite" />
      </rect>
    </svg>
  );
}

function Reaction({ size = 48, accent = '#facc15', className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      {/* Lightning bolt */}
      <path d="M28 4L14 26h10L20 44l16-24H26L28 4z" fill={accent} />
      <path d="M28 4L14 26h10L20 44l16-24H26L28 4z" fill="white" opacity={0.3} />
      {/* Glow */}
      <path d="M28 4L14 26h10L20 44l16-24H26L28 4z" fill="none" stroke={accent} strokeWidth={1} opacity={0.5} />
    </svg>
  );
}

function Connections({ size = 48, className }: Props) {
  const colors = ['#f8d74e', '#7ed66e', '#6eb4f8', '#c97ed6'];
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      {[0, 1, 2, 3].map((row) =>
        [0, 1, 2, 3].map((col) => (
          <rect
            key={`${row}-${col}`}
            x={5 + col * 10.5}
            y={5 + row * 10.5}
            width={9}
            height={9}
            rx={2}
            fill={colors[row]!}
            opacity={col === row ? 1 : 0.5}
          />
        )),
      )}
    </svg>
  );
}

function Mines({ size = 48, accent = '#4ade80', className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      {/* Bomb body */}
      <circle cx={24} cy={26} r={13} fill="#334155" />
      <circle cx={24} cy={26} r={13} fill="url(#mine-grad)" />
      {/* Shine */}
      <ellipse cx={19} cy={20} rx={4} ry={3} fill="white" opacity={0.15} />
      {/* Fuse */}
      <path d="M24 13V8" stroke="#94a3b8" strokeWidth={2.5} strokeLinecap="round" />
      {/* Spark */}
      <circle cx={24} cy={6} r={2.5} fill={accent} />
      <circle cx={24} cy={6} r={2.5} fill="white" opacity={0.5} />
      {/* Spikes */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <line
          key={angle}
          x1={24 + Math.cos((angle * Math.PI) / 180) * 13}
          y1={26 + Math.sin((angle * Math.PI) / 180) * 13}
          x2={24 + Math.cos((angle * Math.PI) / 180) * 16}
          y2={26 + Math.sin((angle * Math.PI) / 180) * 16}
          stroke="#475569"
          strokeWidth={2.5}
          strokeLinecap="round"
        />
      ))}
      <defs>
        <radialGradient id="mine-grad" cx="0.4" cy="0.35">
          <stop offset="0%" stopColor="#475569" />
          <stop offset="100%" stopColor="#1e293b" />
        </radialGradient>
      </defs>
    </svg>
  );
}

function Slots({ size = 48, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      {/* Cherry 1 */}
      <circle cx={17} cy={28} r={8} fill="#ef4444" />
      <ellipse cx={14} cy={25} rx={3} ry={2} fill="white" opacity={0.25} />
      {/* Cherry 2 */}
      <circle cx={33} cy={30} r={7} fill="#dc2626" />
      <ellipse cx={30} cy={27} rx={2.5} ry={1.5} fill="white" opacity={0.25} />
      {/* Stems */}
      <path d="M17 20c2-6 8-8 12-6" stroke="#65a30d" strokeWidth={2} strokeLinecap="round" fill="none" />
      <path d="M33 23c-1-6-3-9-4-10" stroke="#65a30d" strokeWidth={2} strokeLinecap="round" fill="none" />
      {/* Leaf */}
      <ellipse cx={30} cy={10} rx={4} ry={2.5} fill="#4ade80" transform="rotate(30 30 10)" />
    </svg>
  );
}

function Crash({ size = 48, accent = '#f97316', className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      {/* Flame trail */}
      <path d="M24 44c-3-2-6-6-5-12 0.5-3 2-5 3-8-2 3-1 7 2 10" fill={accent} opacity={0.4} />
      <path d="M22 44c-2-3-3-7-1-11 1-2 2-3 3-5-1 2 0 5 1 7" fill="#ef4444" opacity={0.5} />
      {/* Rocket body */}
      <path d="M24 6c-5 4-8 12-8 20h16c0-8-3-16-8-20z" fill="#e2e8f0" />
      <path d="M24 6c-3 3-5 8-6 14h12c-1-6-3-11-6-14z" fill="white" opacity={0.3} />
      {/* Window */}
      <circle cx={24} cy={18} r={3.5} fill="#38bdf8" />
      <circle cx={24} cy={18} r={3.5} fill="white" opacity={0.2} />
      {/* Fins */}
      <path d="M16 26l-4 6h4z" fill={accent} />
      <path d="M32 26l4 6h-4z" fill={accent} />
      {/* Nose cone */}
      <ellipse cx={24} cy={8} rx={2} ry={3} fill="#f43f5e" />
    </svg>
  );
}

function Wheel({ size = 48, className }: Props) {
  const segments = ['#374151', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899'];
  const segAngle = 360 / segments.length;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      {segments.map((color, i) => {
        const startAngle = (i * segAngle - 90) * (Math.PI / 180);
        const endAngle = ((i + 1) * segAngle - 90) * (Math.PI / 180);
        const r = 18;
        const x1 = 24 + r * Math.cos(startAngle);
        const y1 = 24 + r * Math.sin(startAngle);
        const x2 = 24 + r * Math.cos(endAngle);
        const y2 = 24 + r * Math.sin(endAngle);
        return (
          <path
            key={i}
            d={`M24 24L${x1} ${y1}A${r} ${r} 0 0 1 ${x2} ${y2}Z`}
            fill={color}
            stroke="#0f172a"
            strokeWidth={0.5}
          />
        );
      })}
      {/* Center hub */}
      <circle cx={24} cy={24} r={4} fill="#1e293b" stroke="white" strokeWidth={1.5} />
      {/* Pointer */}
      <path d="M24 2l-3 6h6z" fill="white" />
    </svg>
  );
}

function Plinko({ size = 48, accent = '#22d3ee', className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      {/* Pegs */}
      {[
        [24], [18, 30], [12, 24, 36], [8, 18, 28, 38],
      ].map((row, ri) =>
        row.map((x, ci) => (
          <circle key={`${ri}-${ci}`} cx={x} cy={10 + ri * 8} r={2} fill="#64748b" />
        )),
      )}
      {/* Ball */}
      <circle cx={24} cy={6} r={3} fill={accent} />
      <circle cx={23} cy={5} r={1} fill="white" opacity={0.4} />
      {/* Slots at bottom */}
      {[6, 14, 22, 30, 38].map((x, i) => (
        <rect key={i} x={x} y={40} width={7} height={5} rx={1} fill={i === 2 ? accent : '#334155'} opacity={i === 2 ? 0.8 : 0.5} />
      ))}
    </svg>
  );
}

function Dice({ size = 48, accent = '#60a5fa', className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      {/* Die body - slight 3D tilt */}
      <rect x={7} y={7} width={34} height={34} rx={6} fill="#1e293b" stroke={accent} strokeWidth={2} />
      {/* Dots (showing 5) */}
      <circle cx={16} cy={16} r={3} fill="white" />
      <circle cx={32} cy={16} r={3} fill="white" />
      <circle cx={24} cy={24} r={3} fill="white" />
      <circle cx={16} cy={32} r={3} fill="white" />
      <circle cx={32} cy={32} r={3} fill="white" />
      {/* Subtle shine */}
      <rect x={7} y={7} width={34} height={17} rx={6} fill="white" opacity={0.05} />
    </svg>
  );
}

function Chicken({ size = 48, accent = '#fbbf24', className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      {/* Body */}
      <ellipse cx={24} cy={28} rx={12} ry={10} fill="white" />
      <ellipse cx={24} cy={28} rx={12} ry={10} fill={accent} opacity={0.15} />
      {/* Wing */}
      <ellipse cx={16} cy={28} rx={5} ry={7} fill="#e5e7eb" transform="rotate(10 16 28)" />
      {/* Head */}
      <circle cx={30} cy={16} r={8} fill="white" />
      {/* Eye */}
      <circle cx={33} cy={14} r={2.5} fill="#0f172a" />
      <circle cx={33.5} cy={13.5} r={1} fill="white" />
      {/* Beak */}
      <path d="M37 17l5 2-5 2z" fill="#f97316" />
      {/* Comb */}
      <path d="M26 9c1-3 3-3 4 0 1-3 3-3 4 0" fill="#ef4444" />
      {/* Feet */}
      <path d="M20 38l-3 4M20 38l0 5M20 38l3 4" stroke="#f97316" strokeWidth={1.5} strokeLinecap="round" />
      <path d="M28 38l-3 4M28 38l0 5M28 38l3 4" stroke="#f97316" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

function HiLo({ size = 48, accent = '#e879f9', className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      {/* Card back */}
      <rect x={24} y={6} width={20} height={28} rx={3} fill="#1e293b" stroke="#475569" strokeWidth={1.5} transform="rotate(8 34 20)" />
      {/* Card front */}
      <rect x={5} y={10} width={22} height={30} rx={3} fill="white" stroke="#e2e8f0" strokeWidth={1} />
      {/* Suit + rank */}
      <text x={10} y={22} fontSize={10} fontWeight="bold" fill="#0f172a" fontFamily="system-ui">A</text>
      {/* Heart pip */}
      <path
        d="M12 21.1 10.55 19.8C5.4 15.1 2 12 2 8.3 2 5.3 4.42 3 7.4 3c1.74 0 3.41.8 4.6 2.1C13.19 3.8 14.86 3 16.6 3 19.58 3 22 5.3 22 8.3c0 3.7-3.4 6.8-8.55 11.5L12 21.1Z"
        fill="#e11d48"
        transform="translate(9.5, 23.5) scale(0.55)"
      />
      {/* Arrow indicators */}
      <path d="M36 14l4-5 4 5" stroke={accent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M36 34l4 5 4-5" stroke={accent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function Cases({ size = 48, accent = '#f43f5e', className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      {/* Box bottom */}
      <path d="M6 22l18 8 18-8v14l-18 8-18-8z" fill="#1e293b" />
      <path d="M6 22l18 8v22l-18-8z" fill="#334155" />
      <path d="M24 30l18-8v14l-18 8z" fill="#1e293b" />
      {/* Box lid (open) */}
      <path d="M6 22l18-8 18 8-18 8z" fill="#475569" />
      {/* Glow from inside */}
      <ellipse cx={24} cy={28} rx={8} ry={4} fill={accent} opacity={0.4} />
      {/* Shine on lid */}
      <path d="M14 18l10-4 10 4" stroke="white" strokeWidth={0.5} opacity={0.3} fill="none" />
    </svg>
  );
}

function Packs({ size = 48, accent = '#818cf8', className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      {/* Back cards */}
      <rect x={10} y={4} width={22} height={32} rx={3} fill="#312e81" stroke="#4f46e5" strokeWidth={1} transform="rotate(-6 21 20)" />
      <rect x={14} y={5} width={22} height={32} rx={3} fill="#3730a3" stroke="#6366f1" strokeWidth={1} transform="rotate(-2 25 21)" />
      {/* Front card */}
      <rect x={14} y={8} width={22} height={32} rx={3} fill="#1e1b4b" stroke={accent} strokeWidth={1.5} />
      {/* Star/question mark */}
      <text x={25} y={29} textAnchor="middle" fontSize={16} fontWeight="bold" fill={accent} fontFamily="system-ui">?</text>
      {/* Shimmer line */}
      <line x1={18} y1={12} x2={32} y2={12} stroke={accent} strokeWidth={0.5} opacity={0.4} />
      <line x1={18} y1={36} x2={32} y2={36} stroke={accent} strokeWidth={0.5} opacity={0.4} />
    </svg>
  );
}

function Chrome({ size = 48, accent = '#94a3b8', className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      {/* Shield */}
      <path d="M24 4L6 14v12c0 10 8 16 18 18 10-2 18-8 18-18V14L24 4z" fill="url(#chrome-grad)" stroke={accent} strokeWidth={1.5} />
      {/* Polished visor */}
      <path d="M14 20h20M24 20v10" stroke="#0f172a" strokeWidth={3} strokeLinecap="round" />
      {/* Metallic shine */}
      <path d="M24 4L6 14v6l18-6 18 6v-6L24 4z" fill="white" opacity={0.1} />
      <defs>
        <linearGradient id="chrome-grad" x1="24" y1="4" x2="24" y2="44">
          <stop offset="0%" stopColor="#d4d4d8" />
          <stop offset="50%" stopColor="#a1a1aa" />
          <stop offset="100%" stopColor="#71717a" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function Holocron({ size = 48, accent = '#f43f5e', className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      {/* Outer glow */}
      <path d="M24 4L4 24l20 20 20-20z" fill={accent} opacity={0.15} />
      {/* Crystal */}
      <path d="M24 8L8 24l16 16 16-16z" fill="url(#holo-grad)" stroke={accent} strokeWidth={1.5} />
      {/* Facets */}
      <path d="M24 8v32M8 24h32" stroke="white" strokeWidth={0.5} opacity={0.2} />
      <path d="M16 16l8-8 8 8M16 32l8 8 8-8" stroke="white" strokeWidth={0.5} opacity={0.15} />
      {/* Core glow */}
      <circle cx={24} cy={24} r={5} fill={accent} opacity={0.6} />
      <circle cx={24} cy={24} r={3} fill="white" opacity={0.5} />
      <defs>
        <radialGradient id="holo-grad" cx="0.5" cy="0.5">
          <stop offset="0%" stopColor="#4c0519" />
          <stop offset="100%" stopColor="#1a0006" />
        </radialGradient>
      </defs>
    </svg>
  );
}

/* ---- Public API ---- */

const CARD_ART: Record<string, (props: Props) => React.ReactNode> = {
  snake: Snake,
  flappy: Flappy,
  eightball: EightBall,
  tetris: Tetris,
  coinflip: CoinFlip,
  typing: TypingTest,
  reaction: Reaction,
  connections: Connections,
  mines: Mines,
  slots: Slots,
  crash: Crash,
  wheel: Wheel,
  plinko: Plinko,
  dice: Dice,
  chicken: Chicken,
  hilo: HiLo,
  cases: Cases,
  packs: Packs,
  chrome: Chrome,
  holocron: Holocron,
};

export function CardArt({
  theme,
  size = 48,
  accent,
  className,
}: {
  theme: string;
  size?: number;
  accent?: string;
  className?: string;
}) {
  const Renderer = CARD_ART[theme];
  if (!Renderer) return null;
  return <>{Renderer({ size, accent, className })}</>;
}
