'use client';

// Game-accurate mini previews for the 2026-06 cosmetics expansion (gopher,
// ricochet, swerve, tumbler, breakout, stack, sequence, reaction-time, sudoku,
// math, connect-four, checkers, connections, word-grid, pangram) plus profile
// cosmetics. Each reads the SAME asset_ref keys the game's theme reader uses, so
// the store / admin / battlepass preview matches what equipping actually does.
//
// Every renderer returns a full-bleed <svg viewBox="0 0 100 100">; the caller
// wraps it in an h-full/w-full box. resolveNewGamePreview() returns null for
// games handled elsewhere (snake/flappy/tetris/...) so the dispatcher can fall
// through.

import type { ReactNode } from 'react';

import { getAssetImageUrl, lerpHex, readStr } from './helpers';

type Ref = Record<string, unknown> | null;

/** First non-empty string among keys, else fallback. */
const pick = (ar: Ref, keys: string[], fb: string): string => {
  for (const k of keys) {
    const v = readStr(ar, k, '');
    if (v) return v;
  }
  return fb;
};

/** First array of strings among keys, else fallback list. */
const pickArr = (ar: Ref, keys: string[], fb: string[]): string[] => {
  for (const k of keys) {
    const v = ar?.[k];
    if (Array.isArray(v)) {
      const colors = v.filter(
        (x): x is string => typeof x === 'string' && x.trim().length > 0,
      );
      if (colors.length) return colors;
    }
  }
  return fb;
};

const readBoolRef = (ar: Ref, key: string, fb = false): boolean => {
  const v = ar?.[key];
  return typeof v === 'boolean' ? v : fb;
};

/**
 * Resolve a `count`-length colour ramp from either a `palette` array key or
 * per-index `color0..colorN` keys (both patterns are emitted by the gumball /
 * gem seeders), folded over a fallback ramp so an unspecified tier keeps a
 * sensible colour. Never throws on non-array / non-string values.
 */
const pickPalette = (
  ar: Ref,
  arrKeys: string[],
  count: number,
  fb: string[],
): string[] => {
  const base = pickArr(ar, arrKeys, fb);
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(pick(ar, [`color${i}`], base[i % base.length] ?? fb[i % fb.length] ?? '#888'));
  }
  return out;
};

const hasKey = (ar: Ref, k: string): boolean => ar != null && ar[k] !== undefined;

/**
 * The store pipeline strips an item's slots when its gameType isn't registered
 * in GAME_SLOTS (the not-yet-shipped games: baccarat / boardwalk-hop /
 * fortune-teller / freecell / gem-roll all arrive with slots=[]). Recover the
 * intended slot from the asset_ref's own keys so slot-specific art still shows.
 * `probes` are ordered [slot, identifyingKeys]; the first key-match wins. If
 * `slots` already names a known slot, it's used unchanged.
 */
const effSlots = (
  ar: Ref,
  slots: string[],
  probes: Array<[string, string[]]>,
): string[] => {
  const known = new Set(probes.map(([s]) => s));
  if (slots.some((s) => known.has(s))) return slots;
  for (const [slot, keys] of probes) {
    if (keys.some((k) => hasKey(ar, k))) return [slot, ...slots];
  }
  return slots;
};

const safe = (hex: string, amt: number, fb: string) => {
  try {
    return lerpHex(hex, amt < 0 ? '#000000' : '#ffffff', Math.abs(amt));
  } catch {
    return fb;
  }
};

function Svg({ children, bg }: { children: ReactNode; bg?: string }) {
  return (
    <svg
      viewBox='0 0 100 100'
      width='100%'
      height='100%'
      preserveAspectRatio='xMidYMid slice'
      style={{ display: 'block' }}
    >
      {bg ? <rect x='0' y='0' width='100' height='100' fill={bg} /> : null}
      {children}
    </svg>
  );
}

const has = (slots: string[], s: string) => slots.includes(s);

/* ───────────────────────────── GOPHER ───────────────────────────── */
function GopherPreview(ar: Ref, slots: string[]) {
  if (has(slots, 'turf')) {
    const top = pick(ar, ['woodTop', 'turfColor'], '#3f7d3a');
    const mid = pick(ar, ['woodMid'], safe(top, -0.15, '#356b31'));
    const bot = pick(ar, ['woodBottom'], safe(top, -0.3, '#274f24'));
    const holeDark = pick(ar, ['holeDark', 'holeColor'], '#1c2a1a');
    const rim = pick(ar, ['rimHi', 'holeRim'], safe(top, 0.18, '#4f9447'));
    return (
      <Svg bg={top}>
        <rect x='0' y='40' width='100' height='30' fill={mid} />
        <rect x='0' y='70' width='100' height='30' fill={bot} />
        <ellipse cx='50' cy='64' rx='30' ry='14' fill={rim} />
        <ellipse cx='50' cy='66' rx='23' ry='10' fill={holeDark} />
      </Svg>
    );
  }
  if (has(slots, 'effects')) {
    const flash = pick(ar, ['bonkFlashColor', 'hitFlashColor', 'popColor'], '#fff7cc');
    const parts = pickArr(ar, ['particleColors'], [pick(ar, ['particleColor'], '#facc15')]);
    const rays = Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2;
      return (
        <line
          key={i}
          x1={50 + Math.cos(a) * 16}
          y1={50 + Math.sin(a) * 16}
          x2={50 + Math.cos(a) * 36}
          y2={50 + Math.sin(a) * 36}
          stroke={parts[i % parts.length]}
          strokeWidth='5'
          strokeLinecap='round'
        />
      );
    });
    return (
      <Svg bg='#140f06'>
        {rays}
        <circle cx='50' cy='50' r='14' fill={flash} />
      </Svg>
    );
  }
  // gopher (the mole)
  const body = pick(ar, ['gopherBody', 'gopherPrimary'], '#b07a47');
  const hi = pick(ar, ['gopherBodyHi', 'gopherSecondary'], safe(body, 0.18, '#c79363'));
  const edge = pick(ar, ['gopherEdge', 'gopherBodyLo'], safe(body, -0.3, '#5d3d20'));
  const nose = pick(ar, ['gopherNose', 'gopherSnout'], '#3a2414');
  return (
    <Svg bg='#1a130a'>
      <ellipse cx='50' cy='84' rx='30' ry='10' fill='#00000055' />
      <ellipse cx='50' cy='56' rx='30' ry='28' fill={body} stroke={edge} strokeWidth='2' />
      <ellipse cx='50' cy='64' rx='18' ry='17' fill={hi} />
      {/* ears */}
      <circle cx='26' cy='34' r='9' fill={body} stroke={edge} strokeWidth='2' />
      <circle cx='74' cy='34' r='9' fill={body} stroke={edge} strokeWidth='2' />
      {/* eyes */}
      <circle cx='40' cy='50' r='6' fill='#fff' />
      <circle cx='60' cy='50' r='6' fill='#fff' />
      <circle cx='41' cy='51' r='3' fill='#1a1a1a' />
      <circle cx='59' cy='51' r='3' fill='#1a1a1a' />
      {/* nose + teeth */}
      <circle cx='50' cy='62' r='5' fill={nose} />
      <rect x='46' y='66' width='8' height='8' rx='1' fill='#fffaf0' />
      <line x1='50' y1='66' x2='50' y2='74' stroke={nose} strokeWidth='1' />
    </Svg>
  );
}

/* ──────────────────────────── RICOCHET ───────────────────────────── */
function RicochetPreview(ar: Ref, slots: string[]) {
  if (has(slots, 'obstacle')) {
    const col = pick(ar, ['obstacleColor', 'spikeColor'], '#6b7280');
    const lit = pick(ar, ['spikeColor'], safe(col, 0.25, '#9ca3af'));
    const edge = pick(ar, ['obstacleEdge'], safe(col, -0.4, '#374151'));
    const spike = (x: number, up: boolean) =>
      up ? `${x},38 ${x + 10},8 ${x + 20},38` : `${x},62 ${x + 10},92 ${x + 20},62`;
    return (
      <Svg bg='#0b1b2b'>
        {[10, 35, 60].map((x) => (
          <polygon key={`u${x}`} points={spike(x, true)} fill={lit} stroke={edge} strokeWidth='1.5' />
        ))}
        {[22, 47, 72].map((x) => (
          <polygon key={`d${x}`} points={spike(x, false)} fill={col} stroke={edge} strokeWidth='1.5' />
        ))}
      </Svg>
    );
  }
  if (has(slots, 'background')) {
    const top = pick(ar, ['well', 'bgTop'], '#0b1b2b');
    const bot = pick(ar, ['wellEdge', 'bgBottom'], safe(top, -0.4, '#05101a'));
    const accent = pick(ar, ['accent'], '#34d399');
    const stars = readBoolRef(ar, 'stars', false);
    return (
      <Svg>
        <defs>
          <linearGradient id='ric-bg' x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0%' stopColor={top} />
            <stop offset='100%' stopColor={bot} />
          </linearGradient>
        </defs>
        <rect width='100' height='100' fill='url(#ric-bg)' />
        {stars
          ? [
              [18, 22],
              [70, 16],
              [40, 40],
              [82, 54],
              [28, 68],
              [60, 80],
            ].map(([x, y], i) => <circle key={i} cx={x} cy={y} r='1.6' fill='#ffffffcc' />)
          : null}
        <circle cx='78' cy='26' r='10' fill={accent} opacity='0.5' />
      </Svg>
    );
  }
  if (has(slots, 'trail')) {
    const col = pick(ar, ['trailColor'], '#38bdf8');
    return (
      <Svg bg='#06121a'>
        {[20, 34, 48, 62, 76].map((x, i) => (
          <circle key={x} cx={x} cy='50' r={3 + i * 1.6} fill={col} opacity={0.25 + i * 0.16} />
        ))}
      </Svg>
    );
  }
  // bird
  const primary = pick(ar, ['birdPrimary'], '#f97316');
  const secondary = pick(ar, ['birdSecondary'], safe(primary, -0.2, '#c2410c'));
  const belly = pick(ar, ['birdBelly', 'birdHighlight'], safe(primary, 0.3, '#fed7aa'));
  const beak = pick(ar, ['beak'], '#fbbf24');
  return (
    <Svg bg='#0b1b2b'>
      <ellipse cx='48' cy='52' rx='26' ry='21' fill={primary} />
      <ellipse cx='44' cy='58' rx='15' ry='11' fill={belly} />
      <ellipse cx='40' cy='52' rx='13' ry='9' fill={secondary} transform='rotate(-12 40 52)' />
      <circle cx='62' cy='44' r='7' fill='#fff' />
      <circle cx='64' cy='44' r='3.4' fill='#111' />
      <polygon points='72,48 90,52 72,57' fill={beak} />
    </Svg>
  );
}

/* ───────────────────────────── SWERVE ───────────────────────────── */
function SwervePreview(ar: Ref, slots: string[]) {
  if (has(slots, 'track')) {
    const road = pick(ar, ['trackColor'], '#1e293b');
    const lane = pick(ar, ['laneLineColor'], '#fbbf24');
    const edge = pick(ar, ['edgeColor'], safe(road, -0.3, '#0f172a'));
    return (
      <Svg bg={safe(road, -0.2, '#0a0f1a')}>
        <polygon points='30,100 44,0 56,0 70,100' fill={road} />
        <polygon points='30,100 36,0 44,0 34,100' fill={edge} />
        <polygon points='70,100 64,0 56,0 66,100' fill={edge} />
        {[6, 26, 50, 78].map((y, i) => (
          <rect key={i} x='48' y={y} width='4' height='12' fill={lane} />
        ))}
      </Svg>
    );
  }
  if (has(slots, 'environment')) {
    const sky = pick(ar, ['skyColor'], '#f97316');
    const fog = pick(ar, ['fogColor'], safe(sky, 0.1, '#fb7185'));
    const ground = pick(ar, ['groundColor'], '#7c2d12');
    const accent = pick(ar, ['accent'], '#fde68a');
    return (
      <Svg>
        <defs>
          <linearGradient id='sw-sky' x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0%' stopColor={sky} />
            <stop offset='100%' stopColor={fog} />
          </linearGradient>
        </defs>
        <rect width='100' height='62' fill='url(#sw-sky)' />
        <circle cx='50' cy='58' r='16' fill={accent} opacity='0.85' />
        <rect y='60' width='100' height='40' fill={ground} />
      </Svg>
    );
  }
  // cart (top-down)
  const primary = pick(ar, ['cartPrimary'], '#dc2626');
  const secondary = pick(ar, ['cartSecondary'], safe(primary, -0.3, '#7f1d1d'));
  const glass = pick(ar, ['cartGlass', 'cartStripe'], safe(primary, 0.4, '#1e293b'));
  return (
    <Svg bg='#10151f'>
      <rect x='34' y='22' width='32' height='56' rx='9' fill={secondary} />
      <rect x='37' y='26' width='26' height='48' rx='7' fill={primary} />
      <rect x='40' y='34' width='20' height='14' rx='3' fill={glass} />
      <rect x='30' y='30' width='6' height='14' rx='2' fill='#111' />
      <rect x='64' y='30' width='6' height='14' rx='2' fill='#111' />
      <rect x='30' y='56' width='6' height='14' rx='2' fill='#111' />
      <rect x='64' y='56' width='6' height='14' rx='2' fill='#111' />
    </Svg>
  );
}

/* ───────────────────────────── TUMBLER ──────────────────────────── */
function TumblerPreview(ar: Ref, slots: string[]) {
  if (has(slots, 'background')) {
    const top = pick(ar, ['bgTop'], '#4a3322');
    const bot = pick(ar, ['bgBottom'], safe(top, -0.4, '#241509'));
    const accent = pick(ar, ['accent', 'accentAmber'], '#34d399');
    return (
      <Svg>
        <defs>
          <linearGradient id='tum-bg' x1='0' y1='0' x2='1' y2='1'>
            <stop offset='0%' stopColor={top} />
            <stop offset='100%' stopColor={bot} />
          </linearGradient>
        </defs>
        <rect width='100' height='100' fill='url(#tum-bg)' />
        <rect x='10' y='10' width='80' height='80' rx='8' fill='none' stroke={accent} strokeWidth='2' opacity='0.6' />
      </Svg>
    );
  }
  if (has(slots, 'pegs')) {
    const peg = pick(ar, ['pegColor'], '#fbbf24');
    const active = pick(ar, ['pegActiveColor'], safe(peg, 0.25, '#fde68a'));
    const edge = pick(ar, ['pegEdge'], safe(peg, -0.4, '#92400e'));
    return (
      <Svg bg='#160d05'>
        <circle cx='50' cy='50' r='32' fill='none' stroke={edge} strokeWidth='6' />
        <circle cx='50' cy='18' r='8' fill={active} stroke={edge} strokeWidth='2' />
        <circle cx='82' cy='50' r='6' fill={peg} />
        <circle cx='18' cy='50' r='6' fill={peg} />
        <circle cx='50' cy='82' r='6' fill={peg} />
      </Svg>
    );
  }
  // dial
  const col = pick(ar, ['dialColor'], '#caa85a');
  const mid = pick(ar, ['dialMid'], safe(col, -0.2, '#a8842f'));
  const lo = pick(ar, ['dialLo', 'dialDeep'], safe(col, -0.45, '#6b521b'));
  const pointer = pick(ar, ['pointerColor', 'dialAccent'], '#fef3c7');
  return (
    <Svg bg='#160d05'>
      <circle cx='50' cy='50' r='38' fill={lo} />
      <circle cx='50' cy='50' r='32' fill={mid} />
      <circle cx='50' cy='50' r='22' fill={col} />
      <circle cx='50' cy='50' r='8' fill={lo} />
      <rect x='47' y='8' width='6' height='20' rx='3' fill={pointer} />
    </Svg>
  );
}

/* ──────────────────────────── BREAKOUT ──────────────────────────── */
function BreakoutPreview(ar: Ref, slots: string[]) {
  if (has(slots, 'bricks')) {
    const rows = pickArr(
      ar,
      ['brickColors'],
      [
        pick(ar, ['brickColorA'], '#ef4444'),
        pick(ar, ['brickColorB'], '#fbbf24'),
        pick(ar, ['brickColorC'], '#22c55e'),
      ],
    );
    const edge = pick(ar, ['brickEdge'], '#0f172a');
    return (
      <Svg bg='#0b1120'>
        {[0, 1, 2, 3].map((r) =>
          [0, 1, 2, 3].map((c) => (
            <rect
              key={`${r}-${c}`}
              x={6 + c * 23}
              y={14 + r * 17}
              width='20'
              height='13'
              rx='2'
              fill={rows[r % rows.length]}
              stroke={edge}
              strokeWidth='1'
            />
          )),
        )}
      </Svg>
    );
  }
  if (has(slots, 'ball')) {
    const col = pick(ar, ['ballColor'], '#f472b6');
    const edge = pick(ar, ['ballEdge'], safe(col, -0.4, '#be185d'));
    return (
      <Svg bg='#0b1120'>
        <circle cx='50' cy='50' r='20' fill={col} stroke={edge} strokeWidth='3' />
        <circle cx='43' cy='43' r='6' fill='#ffffff88' />
      </Svg>
    );
  }
  if (has(slots, 'background')) {
    const top = pick(ar, ['bgTop'], '#0b1120');
    const bot = pick(ar, ['bgBottom'], '#020617');
    const accent = pick(ar, ['accent'], '#22d3ee');
    return (
      <Svg>
        <defs>
          <linearGradient id='bk-bg' x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0%' stopColor={top} />
            <stop offset='100%' stopColor={bot} />
          </linearGradient>
        </defs>
        <rect width='100' height='100' fill='url(#bk-bg)' />
        <rect x='35' y='82' width='30' height='6' rx='3' fill={accent} />
      </Svg>
    );
  }
  // paddle
  const col = pick(ar, ['paddleColor'], '#e2e8f0');
  const accent = pick(ar, ['paddleAccent'], safe(col, -0.3, '#94a3b8'));
  const ball = pick(ar, ['ballColor'], '#f472b6');
  return (
    <Svg bg='#0b1120'>
      <circle cx='50' cy='40' r='8' fill={ball} />
      <rect x='25' y='66' width='50' height='10' rx='5' fill={col} />
      <rect x='25' y='66' width='50' height='4' rx='2' fill={accent} />
    </Svg>
  );
}

/* ───────────────────────────── STACK ────────────────────────────── */
function StackPreview(ar: Ref, slots: string[]) {
  if (has(slots, 'background')) {
    const top = pick(ar, ['screenTop', 'bgTop'], '#1e1b4b');
    const bot = pick(ar, ['screenBottom', 'bgBottom'], '#020617');
    return (
      <Svg>
        <defs>
          <linearGradient id='st-bg' x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0%' stopColor={top} />
            <stop offset='100%' stopColor={bot} />
          </linearGradient>
        </defs>
        <rect width='100' height='100' fill='url(#st-bg)' />
        <rect x='30' y='70' width='40' height='12' fill={pick(ar, ['accent'], '#818cf8')} opacity='0.7' />
      </Svg>
    );
  }
  if (has(slots, 'effects')) {
    const slice = pick(ar, ['sliceColor'], '#f472b6');
    const flash = pick(ar, ['perfectFlashColor'], '#fde047');
    const part = pick(ar, ['particleColor'], '#22d3ee');
    return (
      <Svg bg='#0b1120'>
        <rect x='28' y='44' width='44' height='16' fill={slice} />
        <rect x='28' y='40' width='44' height='5' fill={flash} />
        {[18, 34, 66, 82].map((x, i) => (
          <circle key={x} cx={x} cy={i % 2 ? 30 : 70} r='3' fill={part} />
        ))}
      </Svg>
    );
  }
  // blocks
  const base = pick(ar, ['blockBase', 'toneAFace'], '#f97316');
  const baseEdge = pick(ar, ['blockBaseEdge', 'toneAEdge'], safe(base, -0.3, '#9a3412'));
  const top = pick(ar, ['blockTop', 'toneBFace'], '#fbbf24');
  const topEdge = pick(ar, ['blockTopEdge', 'toneBEdge'], safe(top, -0.3, '#b45309'));
  return (
    <Svg bg='#0b1120'>
      {[0, 1, 2, 3].map((i) => {
        const c = i % 2 ? top : base;
        const e = i % 2 ? topEdge : baseEdge;
        const w = 56 - i * 4;
        return (
          <rect
            key={i}
            x={(100 - w) / 2 + (i % 2 ? 4 : -4)}
            y={70 - i * 16}
            width={w}
            height='15'
            fill={c}
            stroke={e}
            strokeWidth='1.5'
          />
        );
      })}
    </Svg>
  );
}

/* ──────────────────────────── SEQUENCE ──────────────────────────── */
function SequencePreview(ar: Ref, slots: string[]) {
  if (has(slots, 'background')) {
    const top = pick(ar, ['bezelTop', 'bgTop'], '#27272a');
    const bot = pick(ar, ['bezelBottom', 'bgBottom'], '#09090b');
    return (
      <Svg>
        <defs>
          <radialGradient id='sq-bg'>
            <stop offset='0%' stopColor={top} />
            <stop offset='100%' stopColor={bot} />
          </radialGradient>
        </defs>
        <rect width='100' height='100' fill='url(#sq-bg)' />
        <circle cx='50' cy='50' r='12' fill={pick(ar, ['accent'], '#f4f4f5')} opacity='0.7' />
      </Svg>
    );
  }
  // pads
  const pads = pickArr(
    ar,
    ['padColors'],
    [
      pick(ar, ['pad1'], '#22c55e'),
      pick(ar, ['pad2'], '#ef4444'),
      pick(ar, ['pad3'], '#fbbf24'),
      pick(ar, ['pad4'], '#3b82f6'),
    ],
  );
  const p = (i: number) => pads[i % pads.length];
  return (
    <Svg bg='#09090b'>
      <path d='M50 50 L50 8 A42 42 0 0 0 8 50 Z' fill={p(0)} />
      <path d='M50 50 L8 50 A42 42 0 0 0 50 92 Z' fill={p(1)} />
      <path d='M50 50 L50 92 A42 42 0 0 0 92 50 Z' fill={p(2)} />
      <path d='M50 50 L92 50 A42 42 0 0 0 50 8 Z' fill={p(3)} />
      <circle cx='50' cy='50' r='12' fill='#09090b' />
    </Svg>
  );
}

/* ───────────────────────── REACTION-TIME ────────────────────────── */
function ReactionPreview(ar: Ref, slots: string[]) {
  if (has(slots, 'background')) {
    const bg = pick(ar, ['bgColor', 'panelBg'], '#0f172a');
    const accent = pick(ar, ['accent', 'badgeColor'], '#38bdf8');
    return (
      <Svg bg={bg}>
        <rect x='14' y='30' width='72' height='40' rx='8' fill={safe(bg, 0.12, '#1e293b')} stroke={accent} strokeWidth='2' />
      </Svg>
    );
  }
  const go = pick(ar, ['goColor', 'readyColor'], '#22c55e');
  return (
    <Svg bg={pick(ar, ['bgColor'], '#052e16')}>
      <circle cx='50' cy='50' r='30' fill={go} />
      <circle cx='42' cy='42' r='8' fill='#ffffff55' />
    </Svg>
  );
}

/* ───────────────────────────── SUDOKU ───────────────────────────── */
function SudokuPreview(ar: Ref, slots: string[]) {
  const cell = pick(ar, ['cellBg'], '#faf7ef');
  const grid = pick(ar, ['gridLineColor'], '#cbb89a');
  const box = pick(ar, ['boxBorderColor'], '#5b4a2e');
  const given = pick(ar, ['givenDigitColor'], '#1e293b');
  const entered = pick(ar, ['enteredDigitColor'], '#2563eb');
  const accent = pick(ar, ['accentColor', 'selectedCellColor'], '#10b981');
  const showAccent = has(slots, 'accent');
  const showNums = has(slots, 'numbers') || showAccent;
  const nums = [
    ['5', '', '8'],
    ['', '3', ''],
    ['7', '', '1'],
  ];
  return (
    <Svg bg={box}>
      <rect x='8' y='8' width='84' height='84' fill={cell} />
      {showAccent ? <rect x='8' y='8' width='28' height='28' fill={accent} opacity='0.35' /> : null}
      {[1, 2].map((i) => (
        <g key={i}>
          <line x1={8 + i * 28} y1='8' x2={8 + i * 28} y2='92' stroke={grid} strokeWidth='2' />
          <line x1='8' y1={8 + i * 28} x2='92' y2={8 + i * 28} stroke={grid} strokeWidth='2' />
        </g>
      ))}
      {showNums
        ? nums.flatMap((row, r) =>
            row.map((n, c) =>
              n ? (
                <text
                  key={`${r}-${c}`}
                  x={22 + c * 28}
                  y={30 + r * 28}
                  fontSize='16'
                  fontWeight='700'
                  textAnchor='middle'
                  fill={r === 0 && c === 0 ? entered : given}
                >
                  {n}
                </text>
              ) : null,
            ),
          )
        : null}
    </Svg>
  );
}

/* ─────────────────────────── PUNCH CARD ─────────────────────────── */
function PunchCardPreview(ar: Ref, slots: string[]) {
  const cell = pick(ar, ['cellBg'], '#f4ead4');
  const board = pick(ar, ['boardBg'], '#1c160d');
  const grid = pick(ar, ['gridLineColor'], '#d3bd93');
  const clueBg = pick(ar, ['clueBg'], '#e6d8b8');
  const clueColor = pick(ar, ['clueColor'], '#4a3922');
  const fill = pick(ar, ['fillColor'], '#2c2114');
  const x = pick(ar, ['xColor'], '#b0703f');
  const accent = pick(ar, ['accentColor'], '#2fb8a6');
  // A tiny 5×5 nonogram (a little "duck") revealing the picture.
  const pattern = [
    0, 0, 1, 1, 0,
    0, 1, 1, 1, 1,
    0, 1, 1, 1, 0,
    0, 1, 1, 1, 0,
    0, 0, 1, 1, 0,
  ];
  const xs = new Set([0, 5, 20]);
  const g = 12; // cell size
  const ox = 30;
  const oy = 30;
  return (
    <Svg bg={board}>
      <rect x={ox - 22} y={oy - 22} width='22' height={g * 5 + 22} fill={clueBg} rx='2' />
      <rect x={ox} y={oy - 22} width={g * 5} height='22' fill={clueBg} rx='2' />
      {[0, 1, 2, 3, 4].map((i) => (
        <text key={`c${i}`} x={ox + i * g + g / 2} y={oy - 8} fontSize='7' fontWeight='700' textAnchor='middle' fill={clueColor}>
          {[1, 3, 5, 4, 2][i]}
        </text>
      ))}
      <rect x={ox} y={oy} width={g * 5} height={g * 5} fill={grid} />
      {pattern.map((v, i) => {
        const r = Math.floor(i / 5);
        const c = i % 5;
        const cx = ox + c * g + 0.6;
        const cy = oy + r * g + 0.6;
        const w = g - 1.2;
        if (v === 1) {
          return <rect key={i} x={cx} y={cy} width={w} height={w} fill={fill} />;
        }
        return (
          <g key={i}>
            <rect x={cx} y={cy} width={w} height={w} fill={cell} />
            {xs.has(i) ? (
              <text x={cx + w / 2} y={cy + w / 2 + 3} fontSize='8' fontWeight='700' textAnchor='middle' fill={x}>
                ×
              </text>
            ) : null}
          </g>
        );
      })}
      {has(slots, 'reveal') ? (
        <rect x={ox} y={oy} width={g * 5} height={g * 5} fill='none' stroke={accent} strokeWidth='2' />
      ) : null}
    </Svg>
  );
}

/* ────────────────────────────── MATH ────────────────────────────── */
function MathPreview(ar: Ref, slots: string[]) {
  if (has(slots, 'accent')) {
    const correct = pick(ar, ['correctColor'], '#22c55e');
    const wrong = pick(ar, ['wrongColor'], '#ef4444');
    const accent = pick(ar, ['accentColor'], '#22d3ee');
    const timer = pick(ar, ['timerColor'], '#facc15');
    return (
      <Svg bg='#0b1120'>
        <rect x='10' y='14' width='80' height='6' rx='3' fill={timer} />
        {[correct, accent, wrong].map((c, i) => (
          <rect key={i} x={14 + i * 26} y='40' width='20' height='20' rx='4' fill={c} />
        ))}
        {[accent, correct, wrong].map((c, i) => (
          <rect key={`b${i}`} x={14 + i * 26} y='66' width='20' height='20' rx='4' fill={c} opacity='0.7' />
        ))}
      </Svg>
    );
  }
  const panel = pick(ar, ['panelBg'], '#0f2419');
  const border = pick(ar, ['panelBorder'], '#1f4d36');
  const text = pick(ar, ['problemTextColor'], '#ecfdf5');
  return (
    <Svg bg={safe(panel, -0.2, '#06140d')}>
      <rect x='12' y='28' width='76' height='44' rx='8' fill={panel} stroke={border} strokeWidth='2.5' />
      <text x='50' y='57' fontSize='22' fontWeight='800' textAnchor='middle' fill={text}>
        7+5
      </text>
    </Svg>
  );
}

/* ────────────────────────── CONNECT FOUR ────────────────────────── */
function ConnectFourPreview(ar: Ref, slots: string[]) {
  const p1 = pick(ar, ['player1Color'], '#b83627');
  const p2 = pick(ar, ['player2Color'], '#f2a33c');
  if (has(slots, 'discs')) {
    return (
      <Svg bg='#0b1120'>
        <circle cx='34' cy='50' r='22' fill={p1} stroke={pick(ar, ['player1Edge'], safe(p1, -0.3, '#991b1b'))} strokeWidth='3' />
        <circle cx='28' cy='44' r='6' fill={pick(ar, ['player1Glint'], '#ffffff66')} />
        <circle cx='70' cy='50' r='22' fill={p2} stroke={pick(ar, ['player2Edge'], safe(p2, -0.3, '#a16207'))} strokeWidth='3' />
        <circle cx='64' cy='44' r='6' fill={pick(ar, ['player2Glint'], '#ffffff66')} />
      </Svg>
    );
  }
  if (has(slots, 'background')) {
    const top = pick(ar, ['bgTop'], '#1e1b4b');
    const bot = pick(ar, ['bgBottom'], '#020617');
    return (
      <Svg>
        <defs>
          <linearGradient id='c4-bg' x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0%' stopColor={top} />
            <stop offset='100%' stopColor={bot} />
          </linearGradient>
        </defs>
        <rect width='100' height='100' fill='url(#c4-bg)' />
      </Svg>
    );
  }
  // board
  const board = pick(ar, ['boardColor'], '#5e4d3e');
  const deep = pick(ar, ['boardColorDeep'], safe(board, -0.3, '#46392e'));
  const hole = pick(ar, ['holeColor'], '#1f1a16');
  return (
    <Svg bg={deep}>
      <rect x='10' y='14' width='80' height='72' rx='8' fill={board} />
      {[0, 1, 2].map((r) =>
        [0, 1, 2].map((c) => (
          <circle key={`${r}-${c}`} cx={26 + c * 24} cy={30 + r * 22} r='9' fill={hole} />
        )),
      )}
    </Svg>
  );
}

/* ──────────────────────────── CHECKERS ──────────────────────────── */
function CheckersPreview(ar: Ref, slots: string[]) {
  if (has(slots, 'pieces')) {
    const light = pick(ar, ['lightPieceColor'], '#f5f0e1');
    const dark = pick(ar, ['darkPieceColor'], '#c0392b');
    const crown = pick(ar, ['kingAccent', 'crownColor'], '#facc15');
    return (
      <Svg bg='#1a120c'>
        <ellipse cx='34' cy='62' rx='20' ry='18' fill={dark} stroke={pick(ar, ['darkPieceEdge'], safe(dark, -0.3, '#7b241c'))} strokeWidth='2' />
        <ellipse cx='66' cy='50' rx='20' ry='18' fill={light} stroke={pick(ar, ['lightPieceEdge'], safe(light, -0.2, '#bcae8a'))} strokeWidth='2' />
        <ellipse cx='66' cy='44' rx='20' ry='18' fill={light} stroke={pick(ar, ['lightPieceEdge'], safe(light, -0.2, '#bcae8a'))} strokeWidth='2' />
        <text x='66' y='50' fontSize='16' textAnchor='middle' fill={crown}>♛</text>
      </Svg>
    );
  }
  // board
  const lightSq = pick(ar, ['lightSquareColor'], '#e8d4a8');
  const darkSq = pick(ar, ['darkSquareColor'], '#6b4423');
  const border = pick(ar, ['boardBorder'], safe(darkSq, -0.3, '#3a2414'));
  return (
    <Svg bg={border}>
      {[0, 1, 2, 3].map((r) =>
        [0, 1, 2, 3].map((c) => (
          <rect
            key={`${r}-${c}`}
            x={8 + c * 21}
            y={8 + r * 21}
            width='21'
            height='21'
            fill={(r + c) % 2 ? darkSq : lightSq}
          />
        )),
      )}
    </Svg>
  );
}

/* ─────────────────────────── CONNECTIONS ────────────────────────── */
function ConnectionsPreview(ar: Ref, slots: string[]) {
  if (has(slots, 'accent')) {
    const accent = pick(ar, ['accentColor', 'mistakeColor'], '#e11d48');
    return (
      <Svg bg='#1a1a16'>
        {[0, 1, 2, 3].map((i) => (
          <circle key={i} cx={26 + i * 16} cy='50' r='7' fill={i < 3 ? accent : '#3a3a36'} />
        ))}
      </Svg>
    );
  }
  const g = [
    pick(ar, ['groupColor1'], '#f7da21'),
    pick(ar, ['groupColor2'], '#7dd87d'),
    pick(ar, ['groupColor3'], '#6aaae4'),
    pick(ar, ['groupColor4'], '#b886e0'),
  ];
  return (
    <Svg bg={pick(ar, ['tileBg'], '#efefe6')}>
      {g.map((c, i) => (
        <rect key={i} x='10' y={10 + i * 21} width='80' height='16' rx='3' fill={c} />
      ))}
    </Svg>
  );
}

/* ──────────────────────────── WORD GRID ─────────────────────────── */
function WordGridPreview(ar: Ref, slots: string[]) {
  if (has(slots, 'keyboard')) {
    const keyBg = pick(ar, ['keyBg'], '#818384');
    const keyActive = pick(ar, ['keyActive'], safe(keyBg, -0.2, '#565758'));
    return (
      <Svg bg='#0f0f10'>
        {[0, 1, 2].map((r) =>
          [0, 1, 2, 3].map((c) => (
            <rect
              key={`${r}-${c}`}
              x={8 + c * 22}
              y={20 + r * 22}
              width='18'
              height='17'
              rx='3'
              fill={r === 1 && c === 1 ? keyActive : keyBg}
            />
          )),
        )}
      </Svg>
    );
  }
  if (has(slots, 'accent')) {
    const accent = pick(ar, ['accentColor'], '#34d399');
    return (
      <Svg bg='#0f0f10'>
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={i} x={6 + i * 18} y='40' width='15' height='20' rx='2' fill='none' stroke={accent} strokeWidth='2' />
        ))}
      </Svg>
    );
  }
  // tiles
  const correct = pick(ar, ['correctColor', 'greenColor'], '#6aaa64');
  const present = pick(ar, ['presentColor', 'yellowColor'], '#c9b458');
  const absent = pick(ar, ['absentColor', 'grayColor'], '#787c7e');
  const text = pick(ar, ['tileText'], '#ffffff');
  const cells = [correct, absent, present, correct, absent];
  const letters = ['W', 'O', 'R', 'D', 'S'];
  return (
    <Svg bg='#0f0f10'>
      {cells.map((c, i) => (
        <g key={i}>
          <rect x={4 + i * 18.4} y='38' width='16' height='24' rx='2' fill={c} />
          <text x={12 + i * 18.4} y='55' fontSize='12' fontWeight='800' textAnchor='middle' fill={text}>
            {letters[i]}
          </text>
        </g>
      ))}
    </Svg>
  );
}

/* ───────────────────────────── PANGRAM ──────────────────────────── */
function PangramPreview(ar: Ref, slots: string[]) {
  if (has(slots, 'accent')) {
    const accent = pick(ar, ['accentColor', 'rankColor'], '#f59e0b');
    return (
      <Svg bg='#0f172a'>
        <rect x='10' y='46' width='80' height='8' rx='4' fill='#1e293b' />
        <rect x='10' y='46' width='52' height='8' rx='4' fill={accent} />
      </Svg>
    );
  }
  if (has(slots, 'background')) {
    const top = pick(ar, ['bgTop'], '#0f172a');
    const bot = pick(ar, ['bgBottom'], '#020617');
    return (
      <Svg>
        <defs>
          <linearGradient id='pg-bg' x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0%' stopColor={top} />
            <stop offset='100%' stopColor={bot} />
          </linearGradient>
        </defs>
        <rect width='100' height='100' fill='url(#pg-bg)' />
      </Svg>
    );
  }
  // honeycomb
  const center = pick(ar, ['centerCellColor'], '#f7da21');
  const outer = pick(ar, ['outerCellColor'], '#efefe6');
  const hex = (cx: number, cy: number, r: number, fill: string) => {
    const pts = Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i - Math.PI / 6;
      return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
    }).join(' ');
    return <polygon points={pts} fill={fill} />;
  };
  return (
    <Svg bg='#1a1a16'>
      {hex(50, 22, 13, outer)}
      {hex(28, 38, 13, outer)}
      {hex(72, 38, 13, outer)}
      {hex(28, 62, 13, outer)}
      {hex(72, 62, 13, outer)}
      {hex(50, 78, 13, outer)}
      {hex(50, 50, 14, center)}
    </Svg>
  );
}

/* ───────────────────────────── PROFILE ──────────────────────────── */
function ProfilePreview(ar: Ref, slots: string[]) {
  if (has(slots, 'background')) {
    const start = pick(ar, ['bgStart', 'previewBgStart'], '#4c1d95');
    const end = pick(ar, ['bgEnd', 'previewBgEnd'], safe(start, -0.4, '#0b1120'));
    return (
      <Svg>
        <defs>
          <linearGradient id='pf-bg' x1='0' y1='0' x2='1' y2='1'>
            <stop offset='0%' stopColor={start} />
            <stop offset='100%' stopColor={end} />
          </linearGradient>
        </defs>
        <rect width='100' height='100' fill='url(#pf-bg)' />
      </Svg>
    );
  }
  if (has(slots, 'frame')) {
    const color = pick(ar, ['color', 'frameColor'], '#f59e0b');
    return (
      <Svg bg='#0b1120'>
        <circle cx='50' cy='50' r='30' fill='none' stroke={color} strokeWidth='6' />
        <circle cx='50' cy='50' r='20' fill={safe(color, -0.5, '#334155')} />
      </Svg>
    );
  }
  if (has(slots, 'nameColor')) {
    const color = pick(ar, ['color', 'nameColor'], '#22d3ee');
    return (
      <Svg bg='#0b1120'>
        <text x='50' y='62' fontSize='34' fontWeight='800' textAnchor='middle' fill={color}>
          Aa
        </text>
      </Svg>
    );
  }
  if (has(slots, 'title')) {
    const txt = pick(ar, ['text', 'title'], 'Title');
    return (
      <Svg bg='#0b1120'>
        <rect x='8' y='40' width='84' height='20' rx='10' fill='#1e293b' />
        <text x='50' y='54' fontSize='11' fontWeight='700' textAnchor='middle' fill='#e2e8f0'>
          {txt.length > 12 ? `${txt.slice(0, 11)}…` : txt}
        </text>
      </Svg>
    );
  }
  // badge (emoji)
  const emoji = pick(ar, ['emoji', 'badge'], '⭐');
  return (
    <Svg bg='#0b1120'>
      <text x='50' y='66' fontSize='46' textAnchor='middle'>
        {emoji}
      </text>
    </Svg>
  );
}

/* ─────────────────────────── BUBBLE SHOOTER ─────────────────────────
   A gumball game: `bubbles` is a tier palette (array or color0..colorN);
   `background` themes the jar (bgColor/fieldColor/wallColor/aimColor). */
const GUMBALL_FB = [
  '#e2504c', '#ef8b3c', '#f2c33c', '#7bc043', '#3fb9a0',
  '#3aa0d6', '#7a6fd6', '#c266c9', '#e86fa0', '#cf3b34',
];
function BubbleShooterPreview(ar: Ref, slots: string[]) {
  if (has(slots, 'background')) {
    const bg = pick(ar, ['bgColor'], '#160f08');
    const jar = pick(ar, ['fieldColor', 'jarColor'], '#241a0f');
    const wall = pick(ar, ['wallColor', 'rimColor'], '#caa86a');
    const aim = pick(ar, ['aimColor', 'guideColor'], '#f3e6cb');
    const death = pick(ar, ['deathLineColor', 'fillLineColor'], '#c4413f');
    return (
      <Svg bg={bg}>
        <rect x='24' y='14' width='52' height='74' rx='8' fill={jar} stroke={wall} strokeWidth='4' />
        <line x1='24' y1='30' x2='76' y2='30' stroke={death} strokeWidth='2' strokeDasharray='3 3' />
        {[[38, 46], [50, 40], [62, 46], [44, 58], [56, 58]].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r='7' fill={GUMBALL_FB[i % GUMBALL_FB.length]} />
        ))}
        <line x1='50' y1='88' x2='50' y2='64' stroke={aim} strokeWidth='1.5' strokeDasharray='2 2' />
      </Svg>
    );
  }
  // bubbles / default → a gumball cluster
  const pal = pickPalette(ar, ['palette'], 10, GUMBALL_FB);
  const rows = [
    [30, 46, 62, 78],
    [38, 54, 70],
    [46, 62],
  ];
  return (
    <Svg bg='#160f08'>
      {rows.flatMap((row, r) =>
        row.map((cx, c) => (
          <circle
            key={`${r}-${c}`}
            cx={cx}
            cy={26 + r * 22}
            r='9'
            fill={pal[(r * 4 + c) % pal.length]}
            stroke='#00000033'
            strokeWidth='1'
          />
        )),
      )}
    </Svg>
  );
}

/* ────────────────────────────── GEM SWAP ─────────────────────────────
   `gems` is a jewel palette (array/colorN); `board` themes the grid. */
const GEM_FB = ['#f43f5e', '#22d3ee', '#facc15', '#4ade80', '#a855f7', '#f472b6'];
function gemDiamond(cx: number, cy: number, r: number, fill: string, key: string) {
  const pts = `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`;
  return (
    <g key={key}>
      <polygon points={pts} fill={fill} stroke='#00000040' strokeWidth='1' />
      <polygon points={`${cx},${cy - r} ${cx + r * 0.5},${cy - r * 0.2} ${cx},${cy}`} fill='#ffffff44' />
    </g>
  );
}
function GemSwapPreview(ar: Ref, slots: string[]) {
  if (has(slots, 'board')) {
    const board = pick(ar, ['boardColor'], '#18181b');
    const grid = pick(ar, ['gridColor'], '#3f3f46');
    const cell = pick(ar, ['cellColor'], '#09090b');
    const sel = pick(ar, ['selectColor'], '#a5f3fc');
    return (
      <Svg bg={board}>
        {[0, 1, 2].map((r) =>
          [0, 1, 2].map((c) => (
            <rect
              key={`${r}-${c}`}
              x={16 + c * 24}
              y={16 + r * 24}
              width='20'
              height='20'
              rx='4'
              fill={cell}
              stroke={r === 1 && c === 1 ? sel : grid}
              strokeWidth={r === 1 && c === 1 ? '2.5' : '1.5'}
            />
          )),
        )}
      </Svg>
    );
  }
  // gems / default → a grid of jewels
  const pal = pickPalette(ar, ['palette'], 6, GEM_FB);
  return (
    <Svg bg='#0b0b12'>
      {[0, 1, 2].map((r) =>
        [0, 1, 2].map((c) =>
          gemDiamond(26 + c * 24, 26 + r * 24, 10, pal[(r * 3 + c) % pal.length], `${r}-${c}`),
        ),
      )}
    </Svg>
  );
}

/* ───────────────────────────── SKY CLIMBER ───────────────────────────
   Doodle-jump style tower. climber / platforms / background. */
function SkyClimberPreview(ar: Ref, slots: string[]) {
  if (has(slots, 'background')) {
    const top = pick(ar, ['skyTop'], '#041022');
    const bot = pick(ar, ['skyBottom'], '#0f5132');
    const haze = pick(ar, ['hazeColor'], '#34d399');
    return (
      <Svg>
        <defs>
          <linearGradient id='sky-bg' x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0%' stopColor={top} />
            <stop offset='100%' stopColor={bot} />
          </linearGradient>
        </defs>
        <rect width='100' height='100' fill='url(#sky-bg)' />
        <ellipse cx='50' cy='62' rx='54' ry='14' fill={haze} opacity='0.45' />
      </Svg>
    );
  }
  const normal = pick(ar, ['normal'], '#f472b6');
  const moving = pick(ar, ['moving'], '#22d3ee');
  const breakable = pick(ar, ['breakable'], '#fbbf24');
  const spring = pick(ar, ['spring'], '#a3e635');
  const edge = pick(ar, ['platformEdge'], '#3a0a2a');
  const springCol = pick(ar, ['springColor'], '#ecfccb');
  const plat = (x: number, y: number, fill: string, key: string) => (
    <g key={key}>
      <rect x={x} y={y} width='30' height='7' rx='3' fill={fill} />
      <rect x={x} y={y + 5} width='30' height='2' rx='1' fill={edge} />
    </g>
  );
  if (has(slots, 'platforms')) {
    return (
      <Svg bg='#08131f'>
        {plat(12, 18, breakable, 'b')}
        {plat(52, 34, moving, 'm')}
        {plat(20, 54, spring, 's')}
        <rect x='30' y='49' width='8' height='5' rx='1' fill={springCol} />
        {plat(56, 74, normal, 'n')}
      </Svg>
    );
  }
  // climber / default → a jumper on a platform
  const body = pick(ar, ['climberBody'], '#22d3ee');
  const accent = pick(ar, ['climberAccent'], '#0e2a33');
  return (
    <Svg bg='#08131f'>
      {plat(34, 70, normal, 'p')}
      <ellipse cx='50' cy='50' rx='15' ry='16' fill={body} stroke={accent} strokeWidth='2' />
      <circle cx='44' cy='46' r='3' fill={accent} />
      <circle cx='56' cy='46' r='3' fill={accent} />
      <rect x='40' y='64' width='6' height='8' rx='2' fill={body} />
      <rect x='54' y='64' width='6' height='8' rx='2' fill={body} />
    </Svg>
  );
}

/* ──────────────────────────── MINESWEEPER ────────────────────────────
   board (covered/revealed cells) / numbers (digits, mine, flag) / accent. */
function MinesweeperPreview(ar: Ref, slots: string[]) {
  const cover = pick(ar, ['coverBg'], '#334155');
  const revealed = pick(ar, ['revealedBg'], '#0f172a');
  const grid = pick(ar, ['gridLineColor'], '#0b1120');
  const box = pick(ar, ['boxBorderColor'], '#64748b');
  const digit = pick(ar, ['revealedDigitColor'], '#e2e8f0');
  const mine = pick(ar, ['mineColor'], '#dc2626');
  const flag = pick(ar, ['flagColor'], '#f59e0b');
  const accent = pick(ar, ['accentColor'], '#f59e0b');
  const showNums = has(slots, 'numbers');
  const showAccent = has(slots, 'accent');
  // layout: which cells are revealed vs covered; a couple of digits, a flag, a mine
  const layout = [
    ['1', '', 'F'],
    ['', 'M', '2'],
    ['3', '', ''],
  ];
  const revealedSet = new Set(['0-0', '1-1', '1-2', '2-0']);
  return (
    <Svg bg={box}>
      {[0, 1, 2].map((r) =>
        [0, 1, 2].map((c) => {
          const key = `${r}-${c}`;
          const isRev = showNums ? revealedSet.has(key) : (r + c) % 2 === 0;
          const cellFill =
            showAccent && key === '0-0' ? accent : isRev ? revealed : cover;
          const val = layout[r]![c]!;
          return (
            <g key={key}>
              <rect
                x={9 + c * 28}
                y={9 + r * 28}
                width='26'
                height='26'
                fill={cellFill}
                stroke={grid}
                strokeWidth='1.5'
              />
              {showNums && isRev && val === 'M' ? (
                <circle cx={22 + c * 28} cy={22 + r * 28} r='7' fill={mine} />
              ) : null}
              {showNums && isRev && val === 'F' ? (
                <polygon
                  points={`${18 + c * 28},${14 + r * 28} ${28 + c * 28},${18 + r * 28} ${18 + c * 28},${22 + r * 28}`}
                  fill={flag}
                />
              ) : null}
              {showNums && isRev && val && val !== 'M' && val !== 'F' ? (
                <text
                  x={22 + c * 28}
                  y={27 + r * 28}
                  fontSize='15'
                  fontWeight='800'
                  textAnchor='middle'
                  fill={digit}
                >
                  {val}
                </text>
              ) : null}
            </g>
          );
        }),
      )}
    </Svg>
  );
}

/* ──────────────────────────────── KENO ───────────────────────────────
   spots (picked/hit grid) / balls (drawn balls) / background (well). */
function KenoPreview(ar: Ref, slots: string[]) {
  if (has(slots, 'balls')) {
    const ball = pick(ar, ['ballColor', 'ballBg'], '#e0a23a');
    const hi = pick(ar, ['ballHi'], safe(ball, 0.25, '#f4c057'));
    const on = pick(ar, ['ballOn'], '#2a1b06');
    return (
      <Svg bg='#12080a'>
        {[[30, 40, '7'], [54, 34, '23'], [40, 62, '55'], [66, 60, '9']].map(
          ([cx, cy, n], i) => (
            <g key={i}>
              <circle cx={cx as number} cy={cy as number} r='13' fill={ball} />
              <circle cx={(cx as number) - 4} cy={(cy as number) - 4} r='4' fill={hi} />
              <text x={cx as number} y={(cy as number) + 4} fontSize='9' fontWeight='800' textAnchor='middle' fill={on}>
                {n}
              </text>
            </g>
          ),
        )}
      </Svg>
    );
  }
  if (has(slots, 'background')) {
    const well = pick(ar, ['wellColor', 'boardWell'], '#1a060c');
    const accent = pick(ar, ['accent', 'accentColor'], '#f43f5e');
    return (
      <Svg bg={safe(well, -0.2, '#0a0305')}>
        <rect x='12' y='16' width='76' height='68' rx='8' fill={well} stroke={accent} strokeWidth='2' />
        <line x1='12' y1='40' x2='88' y2='40' stroke={accent} strokeWidth='1' opacity='0.5' />
      </Svg>
    );
  }
  // spots / default → a keno card with picked + hit numbers
  const pick_ = pick(ar, ['pickColor'], '#c73538');
  const pickOn = pick(ar, ['pickOn'], '#ffefe4');
  const hit = pick(ar, ['hitColor'], '#2fb8a6');
  const hitOn = pick(ar, ['hitOn'], '#04231e');
  const cells = [
    { on: false }, { on: 'pick' }, { on: false }, { on: 'hit' },
    { on: 'hit' }, { on: false }, { on: 'pick' }, { on: false },
    { on: false }, { on: 'hit' }, { on: false }, { on: 'pick' },
  ];
  return (
    <Svg bg='#0c1c1a'>
      {cells.map((cell, i) => {
        const r = Math.floor(i / 4);
        const c = i % 4;
        const fill = cell.on === 'pick' ? pick_ : cell.on === 'hit' ? hit : '#16302c';
        const tc = cell.on === 'pick' ? pickOn : cell.on === 'hit' ? hitOn : '#3c5a54';
        return (
          <g key={i}>
            <rect x={10 + c * 21} y={16 + r * 23} width='18' height='20' rx='4' fill={fill} />
            <text x={19 + c * 21} y={30 + r * 23} fontSize='8' fontWeight='700' textAnchor='middle' fill={tc}>
              {i + 1}
            </text>
          </g>
        );
      })}
    </Svg>
  );
}

/* ────────────────────────────── PRIZE WHEEL ──────────────────────────
   wheel (rim/hub/pointer) / segments (7 enamel bands). */
function PrizeWheelPreview(ar: Ref, slots: string[]) {
  const bandFaces =
    has(slots, 'segments')
      ? [
          pick(ar, ['lossFace'], '#3a444c'),
          pick(ar, ['smallFace'], '#2fb8a6'),
          pick(ar, ['baseFace'], '#3fae54'),
          pick(ar, ['midFace'], '#3a86c4'),
          pick(ar, ['bigFace'], '#8a52c4'),
          pick(ar, ['hugeFace'], '#e0a23a'),
          pick(ar, ['jackpotFace'], '#c73538'),
        ]
      : ['#3a444c', '#2fb8a6', '#3fae54', '#3a86c4', '#8a52c4', '#e0a23a', '#c73538', '#3a86c4'];
  const rim = pick(ar, ['rim'], '#241a10');
  const rimEdge = pick(ar, ['rimEdge'], '#0f0a05');
  const hub = pick(ar, ['hub'], '#2a1d10');
  const hubOn = pick(ar, ['hubOn'], '#f6e4bd');
  const pointer = pick(ar, ['pointer'], '#f2c14e');
  const pointerEdge = pick(ar, ['pointerEdge'], '#7a4e16');
  const spoke = pick(ar, ['spoke'], '#0f0a05');
  const n = 8;
  const cx = 50;
  const cy = 52;
  const R = 40;
  const segs = Array.from({ length: n }, (_, i) => {
    const a0 = (i / n) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
    const x0 = cx + R * Math.cos(a0);
    const y0 = cy + R * Math.sin(a0);
    const x1 = cx + R * Math.cos(a1);
    const y1 = cy + R * Math.sin(a1);
    return (
      <path
        key={i}
        d={`M${cx},${cy} L${x0},${y0} A${R},${R} 0 0 1 ${x1},${y1} Z`}
        fill={bandFaces[i % bandFaces.length]}
        stroke={spoke}
        strokeWidth='1'
      />
    );
  });
  return (
    <Svg bg={rimEdge}>
      <circle cx={cx} cy={cy} r={R + 4} fill={rim} stroke={rimEdge} strokeWidth='2' />
      {segs}
      <circle cx={cx} cy={cy} r='9' fill={hub} stroke={hubOn} strokeWidth='2' />
      <polygon points={`${cx - 5},10 ${cx + 5},10 ${cx},22`} fill={pointer} stroke={pointerEdge} strokeWidth='1' />
    </Svg>
  );
}

/* ────────────────────────────── KNIFE BOOTH ──────────────────────────
   knife / target (wood rings + bull) / effects (sparks + fruit). */
function KnifeBoothPreview(ar: Ref, slots: string[]) {
  if (has(slots, 'target')) {
    const wood = pick(ar, ['woodColor'], '#7f1d1d');
    const woodHi = pick(ar, ['woodHi'], safe(wood, 0.2, '#b91c1c'));
    const woodEdge = pick(ar, ['woodEdge'], safe(wood, -0.4, '#1c0505'));
    const ring = pick(ar, ['ringColor'], '#991b1b');
    const bull = pick(ar, ['bullColor'], '#fde047');
    const bullEdge = pick(ar, ['bullEdge'], '#a16207');
    return (
      <Svg bg='#140805'>
        <circle cx='50' cy='50' r='40' fill={wood} stroke={woodEdge} strokeWidth='3' />
        <circle cx='50' cy='50' r='30' fill='none' stroke={ring} strokeWidth='3' />
        <circle cx='50' cy='50' r='20' fill={woodHi} />
        <circle cx='50' cy='50' r='11' fill={bull} stroke={bullEdge} strokeWidth='2' />
      </Svg>
    );
  }
  if (has(slots, 'effects')) {
    const spark = pick(ar, ['sparkColor'], '#fbbf24');
    const sparkHot = pick(ar, ['sparkHotColor'], '#fef9c3');
    const fruit = pick(ar, ['fruitColor'], '#f97316');
    const fruitHi = pick(ar, ['fruitHi'], safe(fruit, 0.3, '#fed7aa'));
    const leaf = pick(ar, ['fruitLeaf'], '#65a30d');
    const rays = Array.from({ length: 7 }, (_, i) => {
      const a = (i / 7) * Math.PI * 2;
      return (
        <line
          key={i}
          x1={64 + Math.cos(a) * 6}
          y1={40 + Math.sin(a) * 6}
          x2={64 + Math.cos(a) * 18}
          y2={40 + Math.sin(a) * 18}
          stroke={i % 2 ? sparkHot : spark}
          strokeWidth='3'
          strokeLinecap='round'
        />
      );
    });
    return (
      <Svg bg='#160d05'>
        <circle cx='38' cy='60' r='18' fill={fruit} />
        <ellipse cx='32' cy='53' rx='6' ry='4' fill={fruitHi} />
        <path d='M38 42 Q44 34 50 40 Q44 44 38 42 Z' fill={leaf} />
        {rays}
        <circle cx='64' cy='40' r='5' fill={sparkHot} />
      </Svg>
    );
  }
  // knife / default → a throwing knife
  const blade = pick(ar, ['bladeColor'], '#a5f3fc');
  const bladeHi = pick(ar, ['bladeHi'], safe(blade, 0.3, '#ecfeff'));
  const bladeEdge = pick(ar, ['bladeEdge'], safe(blade, -0.4, '#0e7490'));
  const handle = pick(ar, ['handleColor'], '#1e3a5f');
  const handleAccent = pick(ar, ['handleAccent'], '#38bdf8');
  return (
    <Svg bg='#0a1420'>
      <g transform='rotate(35 50 50)'>
        <polygon points='50,12 58,52 42,52' fill={blade} stroke={bladeEdge} strokeWidth='2' />
        <polygon points='50,12 52,50 50,50' fill={bladeHi} />
        <rect x='40' y='52' width='20' height='6' rx='2' fill={bladeEdge} />
        <rect x='44' y='58' width='12' height='28' rx='4' fill={handle} />
        <rect x='44' y='66' width='12' height='3' fill={handleAccent} />
        <rect x='44' y='74' width='12' height='3' fill={handleAccent} />
      </g>
    </Svg>
  );
}

/* ────────────────────────────── LOG SPLITTER ─────────────────────────
   axe / tree (log cross-section) / background / effects (chips). */
function LogSplitterPreview(ar: Ref, slots: string[]) {
  if (has(slots, 'tree')) {
    const bark = pick(ar, ['barkColor'], '#7c5a3a');
    const barkHi = pick(ar, ['barkHi'], safe(bark, 0.2, '#9c7550'));
    const barkLo = pick(ar, ['barkLo'], safe(bark, -0.3, '#4a3320'));
    const grain = pick(ar, ['grain'], safe(bark, -0.15, '#5c4530'));
    const ring = pick(ar, ['ring'], safe(bark, 0.35, '#c9a877'));
    return (
      <Svg bg='#150f08'>
        <circle cx='50' cy='50' r='38' fill={bark} stroke={barkLo} strokeWidth='4' />
        <circle cx='50' cy='50' r='30' fill={barkHi} />
        <circle cx='50' cy='50' r='23' fill='none' stroke={ring} strokeWidth='2' />
        <circle cx='50' cy='50' r='15' fill='none' stroke={grain} strokeWidth='2' />
        <circle cx='50' cy='50' r='7' fill={ring} />
      </Svg>
    );
  }
  if (has(slots, 'background')) {
    const top = pick(ar, ['skyTop'], '#f0894e');
    const bot = pick(ar, ['skyBottom'], '#3a2352');
    const ground = pick(ar, ['ground'], '#4a3320');
    const groundEdge = pick(ar, ['groundEdge'], safe(ground, -0.3, '#2a1c10'));
    const accent = pick(ar, ['accent'], '#ffd27f');
    return (
      <Svg>
        <defs>
          <linearGradient id='ls-bg' x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0%' stopColor={top} />
            <stop offset='100%' stopColor={bot} />
          </linearGradient>
        </defs>
        <rect width='100' height='70' fill='url(#ls-bg)' />
        <circle cx='72' cy='24' r='10' fill={accent} opacity='0.8' />
        <rect y='68' width='100' height='4' fill={groundEdge} />
        <rect y='72' width='100' height='28' fill={ground} />
      </Svg>
    );
  }
  if (has(slots, 'effects')) {
    const chip = pick(ar, ['chipColor'], '#f7c05a');
    const chipAlt = pick(ar, ['chipColorAlt'], '#e8763a');
    const flash = pick(ar, ['flashColor'], '#fff1cf');
    return (
      <Svg bg='#140a04'>
        <circle cx='50' cy='50' r='12' fill={flash} opacity='0.9' />
        {[[24, 30], [70, 26], [30, 70], [74, 68], [50, 20], [50, 80]].map(([x, y], i) => (
          <rect
            key={i}
            x={x}
            y={y}
            width='8'
            height='5'
            rx='1'
            fill={i % 2 ? chipAlt : chip}
            transform={`rotate(${i * 40} ${x + 4} ${y + 2})`}
          />
        ))}
      </Svg>
    );
  }
  // axe / default
  const blade = pick(ar, ['bladeColor'], '#a5d8f0');
  const bladeHi = pick(ar, ['bladeHi'], safe(blade, 0.3, '#e0f4ff'));
  const bladeEdge = pick(ar, ['bladeEdge'], safe(blade, -0.4, '#3b7ea1'));
  const handle = pick(ar, ['handleColor'], '#5b6b7a');
  return (
    <Svg bg='#0c1620'>
      <rect x='47' y='24' width='6' height='60' rx='3' fill={handle} transform='rotate(20 50 50)' />
      <g transform='rotate(20 50 50)'>
        <path d='M40 24 Q66 20 66 40 Q52 40 40 34 Z' fill={blade} stroke={bladeEdge} strokeWidth='2' />
        <path d='M40 24 Q56 22 60 30 L44 30 Z' fill={bladeHi} />
      </g>
    </Svg>
  );
}

/* ────────────────────────────── MELON CHOP ───────────────────────────
   blade (slash trail) / fruit (sliced fruits) / splatter (juice). */
function MelonChopPreview(ar: Ref, slots: string[]) {
  if (has(slots, 'fruit')) {
    const bodies = Array.from({ length: 5 }, (_, i) =>
      pick(ar, [`fruitBody${i}`], GEM_FB[i % GEM_FB.length]),
    );
    const his = Array.from({ length: 5 }, (_, i) =>
      pick(ar, [`fruitHi${i}`], safe(bodies[i]!, 0.3, '#ffffff')),
    );
    const rind = pick(ar, ['fruitRind'], '#0f766e');
    const leaf = pick(ar, ['leaf'], '#34d399');
    const spots = [[28, 40], [58, 32], [40, 66], [70, 62], [50, 50]];
    return (
      <Svg bg='#0a0620'>
        {spots.map(([cx, cy], i) => (
          <g key={i}>
            <circle cx={cx} cy={cy} r='13' fill={bodies[i]!} stroke={rind} strokeWidth='2' />
            <ellipse cx={cx - 4} cy={cy - 4} rx='4' ry='3' fill={his[i]!} />
          </g>
        ))}
        <path d='M50 37 Q56 30 60 36 Q54 40 50 37 Z' fill={leaf} />
      </Svg>
    );
  }
  if (has(slots, 'splatter')) {
    const juice = pick(ar, ['juiceColor'], '#e11d74');
    const juiceHi = pick(ar, ['juiceHiColor'], safe(juice, 0.4, '#ffd7ea'));
    const blobs = [
      [50, 50, 16], [28, 34, 7], [72, 32, 6], [30, 70, 8], [74, 66, 7], [50, 22, 5],
    ];
    return (
      <Svg bg='#160512'>
        {blobs.map(([cx, cy, r], i) => (
          <circle key={i} cx={cx} cy={cy} r={r} fill={i === 0 ? juice : juice} opacity={i === 0 ? 0.9 : 0.7} />
        ))}
        <circle cx='44' cy='44' r='5' fill={juiceHi} />
      </Svg>
    );
  }
  // blade / default → a slash trail
  const trail = pick(ar, ['trailColor'], '#38bdf8');
  const core = pick(ar, ['trailCore'], '#e0f2fe');
  return (
    <Svg bg='#04141c'>
      <path d='M12 78 Q40 20 90 26' fill='none' stroke={trail} strokeWidth='10' strokeLinecap='round' opacity='0.55' />
      <path d='M12 78 Q40 20 90 26' fill='none' stroke={core} strokeWidth='3' strokeLinecap='round' />
    </Svg>
  );
}

/* ─────────────────────────────── TIN DUCK ────────────────────────────
   duck / sight (reticle + muzzle) / booth (carnival stall). */
function TinDuckPreview(ar: Ref, slots: string[]) {
  if (has(slots, 'sight')) {
    const sight = pick(ar, ['sightColor'], '#a5f3fc');
    const accent = pick(ar, ['sightAccent'], '#22d3ee');
    const muzzle = pick(ar, ['muzzleColor'], '#67e8f9');
    const muzzleHot = pick(ar, ['muzzleHot'], '#ecfeff');
    return (
      <Svg bg='#04141a'>
        <circle cx='50' cy='50' r='30' fill='none' stroke={sight} strokeWidth='3' />
        <circle cx='50' cy='50' r='6' fill={accent} />
        {[[50, 8, 50, 26], [50, 74, 50, 92], [8, 50, 26, 50], [74, 50, 92, 50]].map(
          ([x1, y1, x2, y2], i) => (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={sight} strokeWidth='2.5' />
          ),
        )}
        <circle cx='74' cy='26' r='7' fill={muzzle} />
        <circle cx='74' cy='26' r='3' fill={muzzleHot} />
      </Svg>
    );
  }
  if (has(slots, 'booth')) {
    const curtainA = pick(ar, ['curtainColor'], '#5b3ea8');
    const curtainB = pick(ar, ['curtainLo'], safe(curtainA, -0.25, '#3f2a7a'));
    const valance = pick(ar, ['valanceColor'], '#f2c14e');
    const skyTop = pick(ar, ['skyTop'], '#2a4d8f');
    const skyBottom = pick(ar, ['skyBottom'], '#12234a');
    const backboard = pick(ar, ['backboardColor'], '#1a2c52');
    const rail = pick(ar, ['railColor'], '#4a3320');
    const railHi = pick(ar, ['railHi'], safe(rail, 0.25, '#6a4a2c'));
    return (
      <Svg>
        <defs>
          <linearGradient id='td-sky' x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0%' stopColor={skyTop} />
            <stop offset='100%' stopColor={skyBottom} />
          </linearGradient>
        </defs>
        <rect width='100' height='100' fill={backboard} />
        <rect x='10' y='30' width='80' height='38' fill='url(#td-sky)' />
        {[14, 30, 46, 62, 78].map((x) => (
          <rect key={x} x={x} y='8' width='9' height={x % 3 ? 18 : 22} fill={x % 2 ? curtainA : curtainB} />
        ))}
        <rect x='8' y='4' width='84' height='8' fill={valance} />
        <rect x='8' y='70' width='84' height='7' fill={rail} />
        <rect x='8' y='70' width='84' height='2' fill={railHi} />
      </Svg>
    );
  }
  // duck / default → a tin duck target
  const body = pick(ar, ['duckColor', 'goldBody'], '#f2b93f');
  const hi = pick(ar, ['duckHi', 'goldBodyHi'], safe(body, 0.3, '#ffe08a'));
  const belly = pick(ar, ['bellyColor'], '#fff3cd');
  const beak = pick(ar, ['beakColor'], '#c87a1a');
  const eye = pick(ar, ['eyeColor'], '#3a2408');
  const edge = pick(ar, ['duckEdge', 'goldEdge'], safe(body, -0.4, '#8a5c10'));
  return (
    <Svg bg='#0c2038'>
      <ellipse cx='48' cy='58' rx='26' ry='18' fill={body} stroke={edge} strokeWidth='2' />
      <ellipse cx='44' cy='62' rx='16' ry='10' fill={belly} />
      <circle cx='66' cy='40' r='15' fill={hi} stroke={edge} strokeWidth='2' />
      <circle cx='70' cy='37' r='3.5' fill={eye} />
      <polygon points='78,38 92,42 78,46' fill={beak} />
      <rect x='44' y='76' width='4' height='12' fill={edge} />
    </Svg>
  );
}

/* ─────────────────────────────── BACCARAT ────────────────────────────
   felt / zones (player/banker/tie) / accent (card back). */
function BaccaratPreview(ar: Ref, slotsIn: string[]) {
  const slots = effSlots(ar, slotsIn, [
    ['zones', ['playerColor', 'bankerColor']],
    ['felt', ['feltTop', 'feltBottom']],
    ['accent', ['accent']],
  ]);
  if (has(slots, 'zones')) {
    const player = pick(ar, ['playerColor'], '#2563eb');
    const banker = pick(ar, ['bankerColor'], '#c73538');
    const tie = pick(ar, ['tieColor'], '#16a34a');
    const playerOn = pick(ar, ['playerOn'], '#f0f6ff');
    const bankerOn = pick(ar, ['bankerOn'], '#fff0ee');
    const tieOn = pick(ar, ['tieOn'], '#04210f');
    const zone = (x: number, w: number, fill: string, tc: string, label: string, key: string) => (
      <g key={key}>
        <rect x={x} y='34' width={w} height='40' rx='5' fill={fill} />
        <text x={x + w / 2} y='58' fontSize='9' fontWeight='800' textAnchor='middle' fill={tc}>
          {label}
        </text>
      </g>
    );
    return (
      <Svg bg='#0a2419'>
        {zone(8, 34, player, playerOn, 'P', 'p')}
        {zone(44, 14, tie, tieOn, 'T', 't')}
        {zone(60, 32, banker, bankerOn, 'B', 'b')}
      </Svg>
    );
  }
  if (has(slots, 'accent')) {
    const accent = pick(ar, ['accent'], '#f4c057');
    return (
      <Svg bg='#160d03'>
        <rect x='30' y='18' width='40' height='58' rx='6' fill={safe(accent, -0.55, '#2a1c08')} stroke={accent} strokeWidth='2.5' />
        <rect x='38' y='28' width='24' height='38' rx='3' fill='none' stroke={accent} strokeWidth='1.5' opacity='0.7' />
        <circle cx='50' cy='47' r='8' fill={accent} opacity='0.85' />
      </Svg>
    );
  }
  // felt / default
  const top = pick(ar, ['feltTop'], '#4a1220');
  const bot = pick(ar, ['feltBottom'], '#2a0a12');
  const rail = pick(ar, ['rail'], '#1a0509');
  return (
    <Svg bg={rail}>
      <defs>
        <linearGradient id='bac-felt' x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0%' stopColor={top} />
          <stop offset='100%' stopColor={bot} />
        </linearGradient>
      </defs>
      <rect x='6' y='6' width='88' height='88' rx='12' fill='url(#bac-felt)' />
      <ellipse cx='50' cy='50' rx='34' ry='26' fill='none' stroke={safe(top, 0.2, '#6a2436')} strokeWidth='2' opacity='0.6' />
    </Svg>
  );
}

/* ───────────────────────────── BOARDWALK HOP ─────────────────────────
   Frogger-style. hopper / lane (crossing rows) / scene (sky). */
function BoardwalkHopPreview(ar: Ref, slotsIn: string[]) {
  const slots = effSlots(ar, slotsIn, [
    ['lane', ['plankLight', 'roadTop', 'cartBody']],
    ['scene', ['horizon', 'skyTop']],
  ]);
  if (has(slots, 'lane')) {
    const plankLight = pick(ar, ['plankLight'], '#3c4a63');
    const plankDark = pick(ar, ['plankDark'], '#2a3348');
    const roadTop = pick(ar, ['roadTop'], '#1c2233');
    const flumeTop = pick(ar, ['flumeTop'], '#3b2f6b');
    const cart = pick(ar, ['cartBody'], '#ec4899');
    const log = pick(ar, ['logBody'], '#5a4a8a');
    const edge = pick(ar, ['laneEdge'], '#0a0d18');
    return (
      <Svg bg={edge}>
        <rect x='0' y='8' width='100' height='20' fill={roadTop} />
        <rect x='14' y='14' width='18' height='8' rx='2' fill={cart} />
        <rect x='0' y='30' width='100' height='20' fill={flumeTop} />
        <rect x='40' y='36' width='24' height='8' rx='4' fill={log} />
        <rect x='0' y='52' width='100' height='10' fill={plankLight} />
        <rect x='0' y='62' width='100' height='10' fill={plankDark} />
        <rect x='0' y='74' width='100' height='10' fill={plankLight} />
      </Svg>
    );
  }
  if (has(slots, 'scene')) {
    const top = pick(ar, ['skyTop'], '#f6a06a');
    const bot = pick(ar, ['skyBottom'], '#ffe0a8');
    const horizon = pick(ar, ['horizon'], '#f0b070');
    const accent = pick(ar, ['accent'], '#ff7e54');
    return (
      <Svg>
        <defs>
          <linearGradient id='bh-sky' x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0%' stopColor={top} />
            <stop offset='100%' stopColor={bot} />
          </linearGradient>
        </defs>
        <rect width='100' height='100' fill='url(#bh-sky)' />
        <circle cx='50' cy='58' r='18' fill={accent} opacity='0.85' />
        <rect y='64' width='100' height='6' fill={horizon} />
      </Svg>
    );
  }
  // hopper / default → a little hopper character
  const body = pick(ar, ['hopperBody'], '#f2c14e');
  const shade = pick(ar, ['hopperShade'], safe(body, -0.3, '#c8942f'));
  const belly = pick(ar, ['hopperBelly'], safe(body, 0.3, '#fbe6b4'));
  const face = pick(ar, ['hopperFace'], '#3a2414');
  return (
    <Svg bg='#141a12'>
      <ellipse cx='50' cy='84' rx='24' ry='7' fill='#00000055' />
      <ellipse cx='50' cy='56' rx='26' ry='24' fill={body} stroke={shade} strokeWidth='2' />
      <ellipse cx='50' cy='64' rx='15' ry='13' fill={belly} />
      <circle cx='36' cy='34' r='9' fill={body} stroke={shade} strokeWidth='2' />
      <circle cx='64' cy='34' r='9' fill={body} stroke={shade} strokeWidth='2' />
      <circle cx='36' cy='34' r='4' fill={face} />
      <circle cx='64' cy='34' r='4' fill={face} />
      <ellipse cx='38' cy='78' rx='9' ry='5' fill={shade} />
      <ellipse cx='62' cy='78' rx='9' ry='5' fill={shade} />
    </Svg>
  );
}

/* ────────────────────────────── FORTUNE TELLER ───────────────────────
   ball (crystal ball) / cardback (tarot back) / cloth (table). */
function FortuneTellerPreview(ar: Ref, slotsIn: string[]) {
  const slots = effSlots(ar, slotsIn, [
    ['cardback', ['backFace', 'backInk']],
    ['cloth', ['clothTop', 'clothTrim']],
    ['ball', ['ballCore', 'ballHalo']],
  ]);
  if (has(slots, 'cardback')) {
    const face = pick(ar, ['backFace'], '#3a2466');
    const edge = pick(ar, ['backEdge'], '#0f0a05');
    const ink = pick(ar, ['backInk'], '#ffd45e');
    return (
      <Svg bg={safe(face, -0.5, '#160d24')}>
        <rect x='30' y='14' width='40' height='72' rx='6' fill={face} stroke={edge} strokeWidth='3' />
        <rect x='36' y='20' width='28' height='60' rx='3' fill='none' stroke={ink} strokeWidth='1.5' />
        <circle cx='50' cy='50' r='11' fill='none' stroke={ink} strokeWidth='1.5' />
        <polygon points='50,42 53,49 60,49 54,54 56,61 50,57 44,61 46,54 40,49 47,49' fill={ink} />
      </Svg>
    );
  }
  if (has(slots, 'cloth')) {
    const top = pick(ar, ['clothTop'], '#0d3b2e');
    const bot = pick(ar, ['clothBottom'], '#06211a');
    const trim = pick(ar, ['clothTrim'], '#f4c057');
    const frame = pick(ar, ['boothFrame'], '#10251c');
    return (
      <Svg bg={frame}>
        <defs>
          <linearGradient id='ft-cloth' x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0%' stopColor={top} />
            <stop offset='100%' stopColor={bot} />
          </linearGradient>
        </defs>
        <rect x='8' y='20' width='84' height='72' rx='6' fill='url(#ft-cloth)' />
        <rect x='8' y='20' width='84' height='6' fill={trim} />
        <path d='M12 30 Q50 46 88 30' fill='none' stroke={trim} strokeWidth='1.5' opacity='0.6' />
      </Svg>
    );
  }
  // ball / default → crystal ball
  const core = pick(ar, ['ballCore'], '#c9a8e8');
  const halo = pick(ar, ['ballHalo'], '#a855f7');
  const rim = pick(ar, ['ballRim'], '#2a1d10');
  const on = pick(ar, ['ballOn'], '#1e0733');
  return (
    <Svg bg={safe(on, -0.3, '#12061f')}>
      <defs>
        <radialGradient id='ft-ball' cx='40%' cy='35%'>
          <stop offset='0%' stopColor={safe(core, 0.4, '#ffffff')} />
          <stop offset='55%' stopColor={core} />
          <stop offset='100%' stopColor={halo} />
        </radialGradient>
      </defs>
      <ellipse cx='50' cy='82' rx='24' ry='6' fill={rim} />
      <rect x='34' y='74' width='32' height='10' rx='3' fill={rim} />
      <circle cx='50' cy='46' r='30' fill='url(#ft-ball)' />
      <ellipse cx='40' cy='36' rx='9' ry='6' fill='#ffffff66' />
    </Svg>
  );
}

/* ──────────────────────────────── FREECELL ───────────────────────────
   cards (foundation/free cells) / cascade / felt. */
function FreecellPreview(ar: Ref, slotsIn: string[]) {
  const slots = effSlots(ar, slotsIn, [
    ['cascade', ['burstColor']],
    ['cards', ['slotFrame', 'foundationTint']],
    ['felt', ['feltTop', 'feltBottom']],
  ]);
  if (has(slots, 'cascade')) {
    const burst = pick(ar, ['burstColor'], '#ffd76a');
    return (
      <Svg bg='#0e2a1c'>
        {[18, 32, 46, 60, 74].map((x, i) => (
          <rect
            key={x}
            x={x}
            y={20 + i * 8}
            width='20'
            height='28'
            rx='3'
            fill='#f5f5f0'
            stroke='#00000033'
            strokeWidth='1'
            transform={`rotate(${(i - 2) * 6} ${x + 10} ${34 + i * 8})`}
          />
        ))}
        {[[24, 20], [72, 24], [50, 16]].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r='3.5' fill={burst} />
        ))}
      </Svg>
    );
  }
  if (has(slots, 'cards')) {
    const frame = pick(ar, ['slotFrame'], '#5a3e20');
    const foundation = pick(ar, ['foundationTint'], '#c0322f');
    const freeCell = pick(ar, ['freeCellTint'], '#8a5a30');
    return (
      <Svg bg='#123024'>
        {[0, 1, 2, 3].map((i) => (
          <rect key={`f${i}`} x={8 + i * 22} y='14' width='17' height='24' rx='3' fill={freeCell} stroke={frame} strokeWidth='2' />
        ))}
        {[0, 1, 2, 3].map((i) => (
          <rect key={`o${i}`} x={8 + i * 22} y='44' width='17' height='24' rx='3' fill={foundation} stroke={frame} strokeWidth='2' />
        ))}
      </Svg>
    );
  }
  // felt / default
  const top = pick(ar, ['feltTop'], '#3a1420');
  const bot = pick(ar, ['feltBottom'], '#210a11');
  const rail = pick(ar, ['railColor'], '#2a1710');
  return (
    <Svg bg={rail}>
      <defs>
        <linearGradient id='fc-felt' x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0%' stopColor={top} />
          <stop offset='100%' stopColor={bot} />
        </linearGradient>
      </defs>
      <rect x='6' y='6' width='88' height='88' rx='10' fill='url(#fc-felt)' />
      {[22, 44, 66].map((x) => (
        <rect key={x} x={x} y='24' width='14' height='20' rx='2' fill='#ffffff14' />
      ))}
    </Svg>
  );
}

/* ─────────────────────────────── GEM ROLL ────────────────────────────
   gems (named faceted gems) / tray (sockets) / flare (burst). */
const GEM_ROLL_KEYS = ['ruby', 'amber', 'citrine', 'emerald', 'sapphire', 'amethyst', 'rose'];
const GEM_ROLL_FB = ['#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#2563eb', '#7c3aed', '#db2777'];
function GemRollPreview(ar: Ref, slotsIn: string[]) {
  const slots = effSlots(ar, slotsIn, [
    ['tray', ['trayBody', 'socket']],
    ['flare', ['flare', 'callout']],
    ['gems', ['rubyFace', 'emeraldFace']],
  ]);
  if (has(slots, 'tray')) {
    const tray = pick(ar, ['trayBody'], '#14151b');
    const rim = pick(ar, ['trayRim'], '#04060a');
    const socket = pick(ar, ['socket'], '#0c0d12');
    const socketEdge = pick(ar, ['socketEdge'], '#04060a');
    return (
      <Svg bg={safe(tray, -0.3, '#0a0b10')}>
        <rect x='8' y='24' width='84' height='52' rx='8' fill={tray} stroke={rim} strokeWidth='3' />
        {[0, 1, 2, 3].map((c) =>
          [0, 1].map((r) => (
            <circle
              key={`${r}-${c}`}
              cx={22 + c * 19}
              cy={40 + r * 20}
              r='7'
              fill={socket}
              stroke={socketEdge}
              strokeWidth='1.5'
            />
          )),
        )}
      </Svg>
    );
  }
  if (has(slots, 'flare')) {
    const flare = pick(ar, ['flare'], '#22d3ee');
    const callout = pick(ar, ['callout'], '#e0f7ff');
    const rays = Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      return (
        <line
          key={i}
          x1={50 + Math.cos(a) * 12}
          y1={50 + Math.sin(a) * 12}
          x2={50 + Math.cos(a) * (i % 2 ? 40 : 28)}
          y2={50 + Math.sin(a) * (i % 2 ? 40 : 28)}
          stroke={flare}
          strokeWidth='3'
          strokeLinecap='round'
          opacity='0.85'
        />
      );
    });
    return (
      <Svg bg='#03151b'>
        {rays}
        <circle cx='50' cy='50' r='12' fill={flare} />
        <circle cx='50' cy='50' r='6' fill={callout} />
      </Svg>
    );
  }
  // gems / default → a row of faceted gems
  const faces = GEM_ROLL_KEYS.map((k, i) => pick(ar, [`${k}Face`], GEM_ROLL_FB[i]!));
  const his = GEM_ROLL_KEYS.map((k, i) => pick(ar, [`${k}Hi`], safe(faces[i]!, 0.3, '#ffffff')));
  const edges = GEM_ROLL_KEYS.map((k, i) => pick(ar, [`${k}Edge`], safe(faces[i]!, -0.4, '#333')));
  const show = [0, 3, 5]; // ruby, emerald, amethyst as a representative trio
  return (
    <Svg bg='#160b10'>
      {show.map((gi, idx) => {
        const cx = 28 + idx * 22;
        const cy = 50;
        const r = 15;
        return (
          <g key={gi}>
            <polygon
              points={`${cx},${cy - r} ${cx + r},${cy - r * 0.3} ${cx + r * 0.6},${cy + r} ${cx - r * 0.6},${cy + r} ${cx - r},${cy - r * 0.3}`}
              fill={faces[gi]!}
              stroke={edges[gi]!}
              strokeWidth='1.5'
            />
            <polygon
              points={`${cx},${cy - r} ${cx + r},${cy - r * 0.3} ${cx},${cy - r * 0.3}`}
              fill={his[gi]!}
            />
          </g>
        );
      })}
    </Svg>
  );
}

/* ─────────────────────────── HIGH STRIKER ─────────────────────────── */
function HighStrikerPreview(ar: Ref, slots: string[]) {
  if (has(slots, 'background')) {
    const top = pick(ar, ['bgTop'], '#2b1a0c');
    const bot = pick(ar, ['bgBottom'], safe(top, -0.4, '#140a04'));
    const accent = pick(ar, ['accent', 'accentAmber'], '#e3a52e');
    return (
      <Svg>
        <defs>
          <linearGradient id='hs-bg' x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0%' stopColor={top} />
            <stop offset='100%' stopColor={bot} />
          </linearGradient>
        </defs>
        <rect width='100' height='100' fill='url(#hs-bg)' />
        <circle cx='20' cy='18' r='2' fill={accent} opacity='0.7' />
        <circle cx='80' cy='14' r='2' fill={accent} opacity='0.7' />
        <circle cx='50' cy='10' r='2' fill={accent} opacity='0.7' />
      </Svg>
    );
  }
  if (has(slots, 'puck')) {
    const puck = pick(ar, ['puckColor'], '#c33a2b');
    const puckHi = pick(ar, ['puckHi'], safe(puck, 0.3, '#ec7a7c'));
    const hammer = pick(ar, ['hammerColor'], '#8a5a2b');
    return (
      <Svg bg='#160d05'>
        <rect x='44' y='8' width='12' height='72' rx='4' fill='#3a2412' />
        <circle cx='50' cy='46' r='11' fill={puck} />
        <circle cx='47' cy='42' r='4' fill={puckHi} />
        <rect x='24' y='76' width='34' height='8' rx='3' fill={hammer} transform='rotate(-24 24 80)' />
        <circle cx='22' cy='82' r='6' fill={hammer} />
      </Svg>
    );
  }
  // tower
  const tower = pick(ar, ['towerColor'], '#5a3a1c');
  const towerLo = pick(ar, ['towerLo'], safe(tower, -0.4, '#33200f'));
  const bell = pick(ar, ['bellColor', 'towerAccent'], '#e3a52e');
  return (
    <Svg bg='#160d05'>
      <rect x='38' y='16' width='24' height='76' rx='3' fill={tower} />
      <rect x='38' y='16' width='24' height='76' rx='3' fill='none' stroke={towerLo} strokeWidth='3' />
      <rect x='46' y='22' width='8' height='64' rx='3' fill={towerLo} />
      <path d='M40 16 a10 10 0 0 1 20 0 z' fill={bell} />
      <circle cx='50' cy='8' r='3' fill={bell} />
    </Svg>
  );
}

/* ─────────────────────────── SKEE-BALL ─────────────────────────── */
function SkeeBallPreview(ar: Ref, slots: string[]) {
  if (has(slots, 'background')) {
    const top = pick(ar, ['bgTop'], '#2b1a0c');
    const bot = pick(ar, ['bgBottom'], safe(top, -0.4, '#140a04'));
    const accent = pick(ar, ['accent', 'accentAmber'], '#e3a52e');
    return (
      <Svg>
        <defs>
          <linearGradient id='sb-bg' x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0%' stopColor={top} />
            <stop offset='100%' stopColor={bot} />
          </linearGradient>
        </defs>
        <rect width='100' height='100' fill='url(#sb-bg)' />
        <circle cx='20' cy='18' r='2' fill={accent} opacity='0.7' />
        <circle cx='80' cy='14' r='2' fill={accent} opacity='0.7' />
        <circle cx='50' cy='10' r='2' fill={accent} opacity='0.7' />
      </Svg>
    );
  }
  if (has(slots, 'rings')) {
    const field = pick(ar, ['fieldColor'], '#241505');
    const ring = pick(ar, ['ringColor', 'ring30'], '#e3a52e');
    const ringOuter = pick(ar, ['ring10'], '#2bb2a0');
    const pocket = pick(ar, ['pocketColor', 'ringAccent'], '#f8c45f');
    const ball = pick(ar, ['ballColor'], '#f2e5c8');
    const ballHi = pick(ar, ['ballHi'], safe(ball, 0.3, '#fdf6e7'));
    return (
      <Svg bg='#160d05'>
        <rect x='16' y='14' width='68' height='60' rx='5' fill={field} />
        <circle cx='50' cy='46' r='24' fill={ringOuter} />
        <circle cx='50' cy='46' r='16' fill={ring} />
        <circle cx='50' cy='46' r='7' fill='#140a04' />
        <circle cx='28' cy='24' r='5' fill='#140a04' stroke={pocket} strokeWidth='2' />
        <circle cx='72' cy='24' r='5' fill='#140a04' stroke={pocket} strokeWidth='2' />
        <circle cx='50' cy='86' r='8' fill={ball} />
        <circle cx='47' cy='83' r='3' fill={ballHi} />
      </Svg>
    );
  }
  // lane
  const lane = pick(ar, ['laneColor'], '#5a3a1c');
  const laneLo = pick(ar, ['laneLo'], safe(lane, -0.4, '#33200f'));
  const rail = pick(ar, ['railColor'], '#241505');
  return (
    <Svg bg='#160d05'>
      <polygon points='38,88 62,88 56,20 44,20' fill={lane} />
      <polygon points='44,20 56,20 54,10 46,10' fill={laneLo} />
      <polygon points='34,88 38,88 44,20 41,20' fill={rail} />
      <polygon points='62,88 66,88 59,20 56,20' fill={rail} />
      <circle cx='50' cy='80' r='7' fill='#f2e5c8' />
    </Svg>
  );
}

/* ───────────────────────────── GUNRUSH ─────────────────────────── */
/** Squad formation used by the `squad` card: [cx, cy, scale], front gunner
 *  first so the muzzle flash lands on the one that is actually firing. */
const GUNRUSH_SQUAD: ReadonlyArray<readonly [number, number, number]> = [
  [50, 44, 1],
  [32, 62, 0.85],
  [68, 62, 0.85],
  [50, 76, 0.75],
];

/** A boardwalk plank quad at depth `y` (the lane narrows toward the horizon at
 *  y=30, matching the deck polygon below). */
const gunrushPlank = (y: number, h: number) => {
  const near = 42 - 24 * ((y - 30) / 70);
  const far = 42 - 24 * ((y + h - 30) / 70);
  return `${near},${y} ${100 - near},${y} ${100 - far},${y + h} ${far},${y + h}`;
};

function GunrushPreview(ar: Ref, slots: string[]) {
  if (has(slots, 'squad')) {
    const body = pick(ar, ['squadPrimary'], '#3fb8c8');
    const head = pick(ar, ['squadSecondary'], '#f2e4c6');
    const glow = pick(ar, ['squadGlow'], '');
    const muzzle = pick(ar, ['muzzleColor'], '#ffd98a');
    const bodyLo = safe(body, -0.3, '#2a7d88');
    return (
      <Svg bg='#140f0a'>
        {glow ? <ellipse cx='50' cy='60' rx='38' ry='30' fill={glow} opacity='0.22' /> : null}
        {GUNRUSH_SQUAD.map(([cx, cy, s], i) => (
          <g key={i}>
            <rect x={cx - 6 * s} y={cy - 8 * s} width={12 * s} height={17 * s} rx={3 * s} fill={body} />
            <rect x={cx - 6 * s} y={cy + 3 * s} width={12 * s} height={6 * s} rx={2 * s} fill={bodyLo} />
            <circle cx={cx} cy={cy - 12 * s} r={4.4 * s} fill={head} />
          </g>
        ))}
        {/* muzzle flash off the front gunner + the flanks' sparks */}
        <circle cx='50' cy='26' r='5' fill={muzzle} />
        <circle cx='34' cy='40' r='2.6' fill={muzzle} opacity='0.8' />
        <circle cx='66' cy='40' r='2.6' fill={muzzle} opacity='0.8' />
      </Svg>
    );
  }
  if (has(slots, 'arsenal')) {
    const gun = pick(ar, ['gunColor'], '#2b2f36');
    const accent = pick(ar, ['gunAccent'], '#8c6a3a');
    const tracer = pick(ar, ['tracerColor'], '#ffe7a8');
    const good = pick(ar, ['gateGood'], '#35d0e8');
    const bad = pick(ar, ['gateBad'], '#e0483f');
    const weapon = pick(ar, ['gateWeapon'], '#c07be8');
    return (
      <Svg bg='#140f0a'>
        {/* the paired gate arch — take-me left, wreck-me right, weapon divider */}
        <rect x='8' y='14' width='38' height='34' rx='2' fill={good} opacity='0.3' />
        <rect x='54' y='14' width='38' height='34' rx='2' fill={bad} opacity='0.3' />
        <rect x='8' y='14' width='38' height='34' rx='2' fill='none' stroke={good} strokeWidth='3' />
        <rect x='54' y='14' width='38' height='34' rx='2' fill='none' stroke={bad} strokeWidth='3' />
        <rect x='46' y='10' width='8' height='42' rx='2' fill={weapon} />
        {/* tracers streaking up through the arch */}
        <rect x='25' y='52' width='2.5' height='12' rx='1' fill={tracer} />
        <rect x='49' y='56' width='2.5' height='14' rx='1' fill={tracer} />
        <rect x='73' y='52' width='2.5' height='12' rx='1' fill={tracer} />
        {/* the weapon itself, shouldered under the gate */}
        <rect x='24' y='74' width='46' height='9' rx='2' fill={gun} />
        <rect x='60' y='76' width='26' height='5' rx='2' fill={accent} />
        <rect x='40' y='69' width='14' height='5' rx='2' fill={accent} />
        <rect x='30' y='83' width='10' height='11' rx='2' fill={gun} />
      </Svg>
    );
  }
  // track — the boardwalk lane running to the horizon between lit rails
  const deck = pick(ar, ['trackColor'], '#6a4a28');
  const stripe = pick(ar, ['trackStripeColor'], safe(deck, 0.12, '#7c5430'));
  const rail = pick(ar, ['railColor'], '#4a3118');
  const railTop = pick(ar, ['railTopColor'], '#a9762f');
  const sky = pick(ar, ['skyColor'], '#140f0a');
  const fog = pick(ar, ['fogColor'], sky);
  const enemy = pick(ar, ['enemyColor'], '#4f8f45');
  const elite = pick(ar, ['enemyEliteColor'], '#9c3b2f');
  const accent = pick(ar, ['accent'], '#ffe7c4');
  return (
    <Svg>
      <defs>
        <linearGradient id='gr-sky' x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0%' stopColor={sky} />
          <stop offset='100%' stopColor={fog} />
        </linearGradient>
      </defs>
      <rect width='100' height='100' fill='url(#gr-sky)' />
      {/* string bulbs over the horizon */}
      <circle cx='22' cy='14' r='2' fill={accent} opacity='0.7' />
      <circle cx='50' cy='9' r='2' fill={accent} opacity='0.7' />
      <circle cx='78' cy='14' r='2' fill={accent} opacity='0.7' />
      {/* deck + scrolling planks */}
      <polygon points='18,100 42,30 58,30 82,100' fill={deck} />
      {[38, 54, 76].map((y, i) => (
        <polygon key={i} points={gunrushPlank(y, 4)} fill={stripe} />
      ))}
      {/* side rails with their bright caps */}
      <polygon points='42,30 18,100 12,100 39,30' fill={rail} />
      <polygon points='58,30 82,100 88,100 61,30' fill={rail} />
      <polyline points='39,30 12,100' fill='none' stroke={railTop} strokeWidth='2.5' />
      <polyline points='61,30 88,100' fill='none' stroke={railTop} strokeWidth='2.5' />
      {/* the pack guarding the lane */}
      <circle cx='42' cy='52' r='4' fill={enemy} />
      <circle cx='60' cy='66' r='6' fill={elite} />
    </Svg>
  );
}

const RENDERERS: Record<string, (ar: Ref, slots: string[]) => ReactNode> = {
  gopher: GopherPreview,
  ricochet: RicochetPreview,
  swerve: SwervePreview,
  tumbler: TumblerPreview,
  'high-striker': HighStrikerPreview,
  'skee-ball': SkeeBallPreview,
  gunrush: GunrushPreview,
  breakout: BreakoutPreview,
  stack: StackPreview,
  sequence: SequencePreview,
  'reaction-time': ReactionPreview,
  sudoku: SudokuPreview,
  'punch-card': PunchCardPreview,
  math: MathPreview,
  'connect-four': ConnectFourPreview,
  checkers: CheckersPreview,
  connections: ConnectionsPreview,
  'word-grid': WordGridPreview,
  pangram: PangramPreview,
  profile: ProfilePreview,
  'bubble-shooter': BubbleShooterPreview,
  'gem-swap': GemSwapPreview,
  'sky-climber': SkyClimberPreview,
  minesweeper: MinesweeperPreview,
  keno: KenoPreview,
  'prize-wheel': PrizeWheelPreview,
  'knife-booth': KnifeBoothPreview,
  'log-splitter': LogSplitterPreview,
  'melon-chop': MelonChopPreview,
  'tin-duck': TinDuckPreview,
  baccarat: BaccaratPreview,
  'boardwalk-hop': BoardwalkHopPreview,
  'fortune-teller': FortuneTellerPreview,
  freecell: FreecellPreview,
  'gem-roll': GemRollPreview,
};

/**
 * Returns a game-accurate mini preview for the newer games + profile cosmetics,
 * or null if this gameType is handled by a dedicated preview elsewhere.
 */
export function resolveNewGamePreview(
  gameType: string,
  slots: string[],
  assetRef: Ref,
): ReactNode | null {
  // If the item ships a real generated image (badge/banner asset), defer to the
  // <img> branch in StoreItemPreview rather than drawing the SVG placeholder.
  if (getAssetImageUrl(assetRef)) return null;
  const renderer = RENDERERS[gameType];
  if (!renderer) return null;
  return renderer(assetRef, slots);
}
