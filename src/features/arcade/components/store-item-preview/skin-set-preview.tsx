/* Counter previews for skin sets (SKINS.md) and the art kit's profile items.
   Flat SVG in the house style: each preview shows the skin's material, its
   signature shape and its palette, drawn the way the game draws them. */

import { useId } from 'react';

import { FrameArt, type FrameId } from '@/features/brand/avatars/frames';
import { NamecardArt, NAMECARD_HEIGHT, NAMECARD_WIDTH, type NamecardId } from '@/features/brand/avatars/namecards';
import { StubAvatarArt } from '@/features/brand/avatars/stub-avatar';
import { contrastRatio, luminance, mixHex, readableOn, type SkinMaterial, type SkinSet } from '@/features/arcade/lib/skins/skin-set';
import { ChessPieceSvg } from '@/app/(games)/chess/_piece-svg';
import type { PieceCode } from '@/features/arcade/lib/chess';
import { ChipArt } from '@/app/(games)/connect-four/_chip-art';
import { chipLook } from '@/app/(games)/connect-four/_connect-four-theme';

const W = 160;
const H = 100;

/* A material as an SVG pattern fill over its base colour. */
function MaterialFill({
  id,
  material,
  base,
  alt,
  line,
  x = 0,
  y = 0,
  w = W,
  h = H,
  rx = 0,
}: {
  id: string;
  material: SkinMaterial;
  base: string;
  alt: string;
  line: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rx?: number;
}) {
  let pattern: React.ReactNode = null;
  if (material === 'planks') {
    pattern = (
      <pattern id={id} width='40' height='14' patternUnits='userSpaceOnUse'>
        <rect width='40' height='14' fill={base} />
        <rect y='7' width='40' height='7' fill={alt} />
        <path d='M0 0.5H40M0 7.5H40M14 0V7M32 7V14' stroke={line} strokeWidth='1' />
      </pattern>
    );
  } else if (material === 'paper') {
    pattern = (
      <pattern id={id} width='16' height='10' patternUnits='userSpaceOnUse'>
        <rect width='16' height='10' fill={base} />
        <path d='M0 9.5H16' stroke={line} strokeWidth='1' />
      </pattern>
    );
  } else if (material === 'tile') {
    pattern = (
      <pattern id={id} width='20' height='20' patternUnits='userSpaceOnUse'>
        <rect width='20' height='20' fill={base} />
        <rect width='10' height='10' fill={alt} />
        <rect x='10' y='10' width='10' height='10' fill={alt} />
      </pattern>
    );
  } else if (material === 'slate') {
    pattern = (
      <pattern id={id} width='40' height='40' patternUnits='userSpaceOnUse'>
        <rect width='40' height='40' fill={base} />
        <path d='M4 12l14-3M22 30l12-4' stroke={line} strokeWidth='1.2' strokeLinecap='round' opacity='0.7' />
      </pattern>
    );
  } else if (material === 'felt') {
    pattern = (
      <pattern id={id} width='6' height='6' patternUnits='userSpaceOnUse'>
        <rect width='6' height='6' fill={base} />
        <circle cx='1.5' cy='1.5' r='0.7' fill={alt} />
        <circle cx='4.5' cy='4.5' r='0.7' fill={alt} />
      </pattern>
    );
  } else if (material === 'walnut' || material === 'maple') {
    pattern = (
      <pattern id={id} width='60' height='12' patternUnits='userSpaceOnUse'>
        <rect width='60' height='12' fill={base} />
        <path d='M0 4q15-3 30 0t30 0M0 9q20 2 36-1t24 1' stroke={line} strokeWidth='1' fill='none' />
      </pattern>
    );
  } else if (material === 'tin') {
    pattern = (
      <pattern id={id} width='12' height='12' patternUnits='userSpaceOnUse'>
        <rect width='12' height='12' fill={base} />
        <circle cx='6' cy='6' r='2' fill={alt} />
      </pattern>
    );
  }
  return (
    <>
      {pattern ? <defs>{pattern}</defs> : null}
      <rect x={x} y={y} width={w} height={h} rx={rx} fill={pattern ? `url(#${id})` : base} />
      {material === 'brass' ? (
        <g fill={line}>
          {[0.08, 0.92].flatMap((fx) => [0.12, 0.88].map((fy) => <circle key={`${fx}${fy}`} cx={x + w * fx} cy={y + h * fy} r='2.4' />))}
        </g>
      ) : null}
      {material === 'enamel' ? (
        <rect x={x + 5} y={y + 5} width={w - 10} height={h - 10} rx={Math.max(0, rx - 3)} fill='none' stroke={line} strokeWidth='1.5' />
      ) : null}
    </>
  );
}

/* ── snake ──────────────────────────────────────────────────────────── */

function SnakePreview({ skin, uid }: { skin: SkinSet<'snake'>; uid: string }) {
  const p = skin.palette;
  const path: [number, number][] = [
    [26, 70],
    [44, 70],
    [62, 70],
    [62, 52],
    [80, 52],
    [98, 52],
    [98, 34],
    [116, 34],
  ];
  const [hx, hy] = path[path.length - 1]!;
  let body: React.ReactNode;
  if (skin.shape === 'tube') {
    body = (
      <polyline
        points={path.map(([x, y]) => `${x},${y}`).join(' ')}
        fill='none'
        stroke={p.body}
        strokeWidth='13'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    );
  } else if (skin.shape === 'beads') {
    body = path.map(([x, y], i) => <circle key={i} cx={x} cy={y} r='7' fill={i % 2 ? p.bodyAlt : p.body} />);
  } else if (skin.shape === 'blocks') {
    body = path.map(([x, y], i) => (
      <g key={i}>
        <rect x={x - 8} y={y - 8} width='16' height='16' rx='3' fill={i % 2 ? p.bodyAlt : p.body} />
        <rect x={x - 8} y={y + 4} width='16' height='4' rx='2' fill={p.mark} opacity='0.25' />
      </g>
    ));
  } else if (skin.shape === 'tickets') {
    body = path.map(([x, y], i) => (
      <g key={i}>
        <rect x={x - 8.5} y={y - 7} width='17' height='14' rx='2.5' fill={i % 2 ? p.bodyAlt : p.body} />
        <circle cx={x - 8.5} cy={y} r='2.6' fill={p.ground} />
        <circle cx={x + 8.5} cy={y} r='2.6' fill={p.ground} />
        <path d={`M${x} ${y - 5}V${y + 5}`} stroke={p.mark} strokeWidth='1.2' strokeDasharray='2 2' />
      </g>
    ));
  } else {
    body = path.map(([x, y], i) => (
      <circle key={i} cx={x} cy={y} r='6.5' fill='none' stroke={i % 2 ? p.bodyAlt : p.body} strokeWidth='4' />
    ));
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className='h-full w-full' aria-hidden='true' preserveAspectRatio='xMidYMid slice'>
      <MaterialFill id={`${uid}-g`} material={skin.material} base={p.ground} alt={p.groundAlt} line={p.line} />
      {body}
      <circle cx={hx + 2} cy={hy} r='9' fill={p.body} />
      <circle cx={hx + 5} cy={hy - 4} r='2.6' fill={p.mark} />
      <circle cx={hx + 5} cy={hy + 4} r='2.6' fill={p.mark} />
      <SnakeFood skin={skin} x={138} y={70} />
    </svg>
  );
}

function SnakeFood({ skin, x, y }: { skin: SkinSet<'snake'>; x: number; y: number }) {
  const p = skin.palette;
  switch (skin.shape) {
    case 'beads':
      return (
        <g>
          <circle cx={x} cy={y} r='8' fill={p.food} />
          <circle cx={x - 2.5} cy={y - 2.5} r='2.5' fill={p.foodMark} />
        </g>
      );
    case 'blocks':
      return (
        <g>
          <rect x={x - 7} y={y - 7} width='14' height='14' rx='3' fill={p.food} />
          <circle cx={x} cy={y} r='2.2' fill={p.foodMark} />
        </g>
      );
    case 'tickets':
      return (
        <g transform={`rotate(-10 ${x} ${y})`}>
          <rect x={x - 11} y={y - 7} width='22' height='14' rx='2.5' fill={p.food} />
          <circle cx={x - 11} cy={y} r='3' fill={p.ground} />
          <circle cx={x + 11} cy={y} r='3' fill={p.ground} />
          <path d={`M${x + 4} ${y - 5}V${y + 5}`} stroke={p.foodMark} strokeWidth='1.2' strokeDasharray='2 2' />
        </g>
      );
    case 'links':
      return (
        <g>
          <circle cx={x} cy={y} r='8' fill={p.food} />
          <circle cx={x} cy={y} r='5' fill='none' stroke={p.foodMark} strokeWidth='1.5' />
        </g>
      );
    default:
      return (
        <g>
          <circle cx={x} cy={y} r='8' fill={p.food} />
          <path d={`M${x} ${y - 7}l-1-5`} stroke={p.mark} strokeWidth='1.6' />
          <ellipse cx={x + 3.5} cy={y - 10} rx='3.5' ry='1.6' fill={p.foodMark} />
        </g>
      );
  }
}

/* ── 2048 ───────────────────────────────────────────────────────────── */

export function tileShapePath(shape: string, x: number, y: number, s: number): string {
  const r = s * 0.14;
  if (shape === 'coin') {
    const c = s / 2;
    return `M${x + c} ${y}a${c} ${c} 0 1 1 0 ${s}a${c} ${c} 0 1 1 0 ${-s}z`;
  }
  if (shape === 'badge') {
    const k = s * 0.28;
    return `M${x + k} ${y}H${x + s - k}L${x + s} ${y + k}V${y + s - k}L${x + s - k} ${y + s}H${x + k}L${x} ${y + s - k}V${y + k}Z`;
  }
  if (shape === 'block') {
    return `M${x} ${y}H${x + s}V${y + s}H${x}Z`;
  }
  if (shape === 'stub') {
    const n = s * 0.13;
    const m = y + s / 2;
    return `M${x + r} ${y}H${x + s - r}A${r} ${r} 0 0 1 ${x + s} ${y + r}V${m - n}A${n} ${n} 0 0 0 ${x + s} ${m + n}V${y + s - r}A${r} ${r} 0 0 1 ${x + s - r} ${y + s}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + s - r}V${m + n}A${n} ${n} 0 0 0 ${x} ${m - n}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
  }
  return `M${x + r} ${y}H${x + s - r}A${r} ${r} 0 0 1 ${x + s} ${y + r}V${y + s - r}A${r} ${r} 0 0 1 ${x + s - r} ${y + s}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + s - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}

function Game2048Preview({ skin, uid }: { skin: SkinSet<'2048'>; uid: string }) {
  const p = skin.palette;
  const s = 26;
  const gap = 5;
  const ox = (W - (4 * s + 3 * gap)) / 2;
  const oy = (H - (2 * s + gap)) / 2;
  const tiles: [number, number, number, string][] = [
    [0, 0, 2, p.low],
    [1, 0, 8, mixHex(p.low, p.mid, 0.6)],
    [2, 1, 64, p.mid],
    [3, 0, 512, p.high],
    [3, 1, 2048, p.top],
  ];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className='h-full w-full' aria-hidden='true'>
      <rect width={W} height={H} fill={p.ground} />
      <MaterialFill
        id={`${uid}-b`}
        material={skin.material}
        base={p.board}
        alt={p.cell}
        line={mixHex(p.board, p.ink, 0.35)}
        x={ox - 7}
        y={oy - 7}
        w={4 * s + 3 * gap + 14}
        h={2 * s + gap + 14}
        rx={8}
      />
      {Array.from({ length: 8 }, (_, i) => (
        <path key={i} d={tileShapePath(skin.shape, ox + (i % 4) * (s + gap), oy + Math.floor(i / 4) * (s + gap), s)} fill={p.cell} />
      ))}
      {tiles.map(([cx, cy, value, fill]) => {
        const x = ox + cx * (s + gap);
        const y = oy + cy * (s + gap);
        return (
          <g key={value}>
            <path d={tileShapePath(skin.shape, x, y, s)} fill={fill} />
            <text
              x={x + s / 2}
              y={y + s / 2 + (value >= 1000 ? 3.5 : 5)}
              textAnchor='middle'
              fontFamily='var(--tixy-font-num)'
              fontWeight='800'
              fontSize={value >= 1000 ? 8.5 : 14}
              fill={readableOn(fill, p.ink, p.paper)}
            >
              {value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ── 8-ball ─────────────────────────────────────────────────────────── */

const HOUSE_BALLS = ['#f2b705', '#1f4fa8', '#c8102e', '#5b2a86', '#f26a1b', '#0f7b3f', '#7a1f1f'];

function PoolBall({ skin, x, y, n }: { skin: SkinSet<'8-ball'>; x: number; y: number; n: number }) {
  const r = 8;
  const suit = ((n - 1) % 8) + 1;
  const ballKey = `ball${suit}` as keyof SkinSet<'8-ball'>['palette'];
  const colour = n === 8 ? '#141110' : (skin.palette[ballKey] ?? HOUSE_BALLS[suit - 1]!);
  const stripe = n > 8;
  const shape = skin.shape;
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill={stripe ? '#f7f2e8' : colour} />
      {stripe ? (
        <path d={`M${x - r} ${y - 4}H${x + r}V${y + 4}H${x - r}Z`} fill={colour} clipPath={`circle(${r}px at ${x}px ${y}px)`} />
      ) : null}
      {shape === 'ringed' ? <circle cx={x} cy={y} r={r - 1.5} fill='none' stroke='#f7f2e8' strokeWidth='1.6' /> : null}
      <circle cx={x} cy={y} r='3.6' fill='#f7f2e8' />
      <text x={x} y={y + 2.3} textAnchor='middle' fontSize='5.5' fontWeight='800' fontFamily='var(--tixy-font-num)' fill='#141110'>
        {n}
      </text>
      {shape === 'gloss' ? <circle cx={x - 3} cy={y - 3.4} r='1.8' fill='#ffffff' opacity='0.75' /> : null}
      {shape === 'pearl' ? <circle cx={x} cy={y} r={r} fill='none' stroke='#ffffff' strokeOpacity='0.45' strokeWidth='2' /> : null}
    </g>
  );
}

function PoolPreview({ skin, uid }: { skin: SkinSet<'8-ball'>; uid: string }) {
  const p = skin.palette;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className='h-full w-full' aria-hidden='true'>
      <MaterialFill
        id={`${uid}-r`}
        material={skin.material}
        base={p.rail}
        alt={mixHex(p.rail, '#000000', 0.12)}
        line={p.railEdge}
        x={6}
        y={6}
        w={W - 12}
        h={H - 12}
        rx={10}
      />
      <rect x={18} y={18} width={W - 36} height={H - 36} rx={3} fill={p.felt} />
      <rect x={18} y={H - 26} width={W - 36} height={8} fill={p.feltDark} opacity='0.5' />
      {[18, W / 2, W - 18].flatMap((x) => [18, H - 18].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r='6' fill={p.pocket} />))}
      {[48, 80, 112].map((x) => (
        <g key={x}>
          <rect x={x - 2} y={10} width='4' height='4' transform={`rotate(45 ${x} 12)`} fill={p.sight} />
          <rect x={x - 2} y={H - 14} width='4' height='4' transform={`rotate(45 ${x} ${H - 12})`} fill={p.sight} />
        </g>
      ))}
      <PoolBall skin={skin} x={96} y={46} n={1} />
      <PoolBall skin={skin} x={110} y={40} n={11} />
      <PoolBall skin={skin} x={110} y={56} n={8} />
      <PoolBall skin={skin} x={124} y={48} n={6} />
      <circle cx={52} cy={56} r='8' fill='#f7f2e8' />
      <path d='M44 60L10 76' stroke={p.cue} strokeWidth='4.5' strokeLinecap='round' />
      <path d='M44 60L41 61.4' stroke={p.cueTip} strokeWidth='4.5' strokeLinecap='round' />
    </svg>
  );
}

/* ── stacker ────────────────────────────────────────────────────────── */

function StackPiece({
  shape,
  x,
  y,
  w,
  h,
  fill,
  mark,
  ground,
}: {
  shape: SkinSet<'stack'>['shape'];
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  mark: string;
  ground: string;
}) {
  const detail = contrastRatio(fill, mark) >= 1.6 ? mark : ground;
  const r = h * 0.09;
  if (shape === 'stub') {
    const n = h * 0.16;
    const m = y + h / 2;
    const d = `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${m - n}A${n} ${n} 0 0 0 ${x + w} ${m + n}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${m + n}A${n} ${n} 0 0 0 ${x} ${m - n}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
    return (
      <g>
        <path d={d} fill={fill} />
        <path d={`M${x + h * 0.3} ${y + h * 0.16}V${y + h * 0.84}`} stroke={detail} strokeWidth='0.9' strokeDasharray='2 1.6' />
      </g>
    );
  }
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={shape === 'brick' ? r * 0.6 : r} fill={fill} />
      {shape === 'block' ? <rect x={x} y={y + h * 0.84} width={w} height={h * 0.16} rx={r * 0.6} fill={mixHex(fill, '#000000', 0.22)} /> : null}
      {shape === 'brick' ? (
        <path
          d={`M${x} ${y + h / 3}H${x + w}M${x} ${y + (h * 2) / 3}H${x + w}M${x + w / 2} ${y}V${y + h / 3}M${x + w / 2} ${y + (h * 2) / 3}V${y + h}`}
          stroke={detail}
          strokeWidth='0.6'
        />
      ) : null}
      {shape === 'crate' ? (
        <g fill='none' stroke={detail} strokeWidth='0.9'>
          <rect x={x + h * 0.16} y={y + h * 0.16} width={w - h * 0.32} height={h - h * 0.32} />
          <path d={`M${x + h * 0.16} ${y + h * 0.16}L${x + w - h * 0.16} ${y + h - h * 0.16}`} />
        </g>
      ) : null}
    </g>
  );
}

function StackPreview({ skin, uid }: { skin: SkinSet<'stack'>; uid: string }) {
  const p = skin.palette;
  const dark = luminance(p.ground) < 0.3;
  const ground2 = mixHex(p.ground, dark ? '#ffffff' : '#000000', 0.06);
  const line = mixHex(p.ground, dark ? '#000000' : '#ffffff', 0.4);
  const unlit = mixHex(p.ground, dark ? '#ffffff' : '#000000', 0.18);
  const cell = 11;
  const cols = 7;
  const rows = 8;
  const ox = (W - cols * cell) / 2 - 8;
  const oy = (H - rows * cell) / 2;
  // The tower narrows as it rises; the moving row sits on top.
  const tower: [number, number][] = [[1, 5], [1, 5], [2, 5], [2, 4], [2, 4], [3, 4], [3, 3]];
  const moving: [number, number] = [0, 2];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className='h-full w-full' aria-hidden='true'>
      <MaterialFill id={`${uid}-s`} material={skin.material} base={p.ground} alt={ground2} line={line} />
      {skin.material === 'ink' ? <rect x={ox - 3} y={oy - 3} width={cols * cell + 6} height={rows * cell + 6} fill={ground2} /> : null}
      {Array.from({ length: rows * cols }, (_, i) => {
        const row = Math.floor(i / cols);
        const col = i % cols;
        return (
          <StackPiece
            key={i}
            shape={skin.shape}
            x={ox + col * cell + 0.7}
            y={oy + row * cell + 0.7}
            w={cell - 1.4}
            h={cell - 1.4}
            fill={unlit}
            mark={p.mark}
            ground={p.ground}
          />
        );
      })}
      {tower.map(([from, to], i) => {
        const row = rows - 1 - i;
        return Array.from({ length: to - from + 1 }, (_, k) => (
          <StackPiece
            key={`${i}-${k}`}
            shape={skin.shape}
            x={ox + (from + k) * cell + 0.7}
            y={oy + row * cell + 0.7}
            w={cell - 1.4}
            h={cell - 1.4}
            fill={p.block}
            mark={p.mark}
            ground={p.ground}
          />
        ));
      })}
      {Array.from({ length: moving[1] - moving[0] + 1 }, (_, k) => (
        <StackPiece
          key={`m${k}`}
          shape={skin.shape}
          x={ox + (moving[0] + k) * cell + 0.7}
          y={oy + 0.7}
          w={cell - 1.4}
          h={cell - 1.4}
          fill={p.blockAlt}
          mark={p.mark}
          ground={p.ground}
        />
      ))}
      {[3, 6].map((row) => (
        <path
          key={row}
          d={`M${ox - 8} ${oy + row * cell + cell / 2}H${ox - 3}M${ox + cols * cell + 3} ${oy + row * cell + cell / 2}H${ox + cols * cell + 8}`}
          stroke={p.prize}
          strokeWidth='1.6'
        />
      ))}
    </svg>
  );
}

/* ── ricochet ───────────────────────────────────────────────────────── */

/* The bird in each of its four shapes, drawn the way _ricochet-draw.ts draws
   it, centred on (x, y) with radius r and facing right. */
function RicochetBird({ skin, x, y, r }: { skin: SkinSet<'ricochet'>; x: number; y: number; r: number }) {
  const p = skin.palette;
  const eye = luminance(p.bird) > 0.3 ? '#1F1A16' : '#F4EBDC';
  const belly = mixHex(p.bird, p.mark, 0.6);
  if (skin.shape === 'plane') {
    return (
      <g transform={`translate(${x} ${y}) rotate(-10)`}>
        <path d={`M${r * 1.45},0 L${-r * 0.95},${r * 0.6} L${-r * 0.5},0 Z`} fill={p.birdAlt} />
        <path d={`M${r * 1.45},0 L${-r * 0.95},${-r * 0.78} L${-r * 0.5},0 Z`} fill={p.bird} />
      </g>
    );
  }
  return (
    <g transform={`translate(${x} ${y}) rotate(-8)`}>
      <path d={`M${-r * 0.75},${-r * 0.3} L${-r * 1.45},0 L${-r * 0.75},${r * 0.32} Z`} fill={p.birdAlt} />
      {skin.shape === 'owl' ? (
        <g fill={p.birdAlt}>
          <path d={`M${r * 0.72},${-r * 0.62} L${r * 0.88},${-r * 1.28} L${r * 0.22},${-r * 0.9} Z`} />
          <path d={`M${-r * 0.52},${-r * 0.62} L${-r * 0.68},${-r * 1.28} L${-r * 0.02},${-r * 0.9} Z`} />
        </g>
      ) : null}
      {skin.shape === 'chick' ? (
        <g fill={p.birdAlt}>
          {[-0.18, 0.12, 0.42].map((dx, i) => (
            <path key={dx} d={`M${r * dx - r * 0.16},${-r * 0.82} L${r * dx - r * 0.02},${-r * (0.82 + [0.5, 0.7, 0.45][i]!)} L${r * dx + r * 0.14},${-r * 0.82} Z`} />
          ))}
        </g>
      ) : null}
      <ellipse cx='0' cy='0' rx={r * 1.04} ry={r} fill={p.bird} />
      <ellipse cx={r * 0.16} cy={r * 0.34} rx={r * 0.62} ry={r * 0.5} fill={belly} />
      <ellipse cx={-r * 0.32} cy={-r * 0.04} rx={r * (skin.shape === 'chick' ? 0.5 : 0.62)} ry={r * 0.36} fill={p.birdAlt} transform={`rotate(-10 ${-r * 0.32} ${-r * 0.04})`} />
      <path d={`M${r * 0.92},${-r * 0.22} L${r * (skin.shape === 'chick' ? 1.38 : 1.5)},${-r * 0.02} L${r * 0.92},${r * 0.14} Z`} fill={p.birdAlt} />
      {skin.shape === 'owl' ? (
        <g>
          {[0.2, 0.66].map((dx) => (
            <g key={dx}>
              <circle cx={r * dx} cy={-r * 0.26} r={r * 0.3} fill={p.mark} />
              <circle cx={r * dx + r * 0.06} cy={-r * 0.26} r={r * 0.14} fill='#1F1A16' />
            </g>
          ))}
        </g>
      ) : (
        <circle cx={r * 0.46} cy={-r * 0.26} r={r * 0.17} fill={eye} />
      )}
    </g>
  );
}

function RicochetTeeth({ face, dir, gap, fill }: { face: number; dir: 1 | -1; gap: [number, number]; fill: string }) {
  const ys: number[] = [];
  for (let y = 5; y < H; y += 9) if (y < gap[0] - 3 || y > gap[1] + 3) ys.push(y);
  return (
    <g fill={fill}>
      {ys.map((y) => (
        <path key={y} d={`M${face},${y - 4} L${face + dir * 7},${y} L${face},${y + 4} Z`} />
      ))}
    </g>
  );
}

function RicochetPreview({ skin, uid }: { skin: SkinSet<'ricochet'>; uid: string }) {
  const p = skin.palette;
  const dark = luminance(p.ground) < 0.3;
  const ground2 = mixHex(p.ground, p.mark, 0.07);
  const line = mixHex(p.ground, dark ? '#ffffff' : '#000000', 0.14);
  const wall2 = mixHex(p.wall, luminance(p.wall) > 0.3 ? '#000000' : '#ffffff', 0.14);
  const leftFace = 42;
  const rightFace = 118;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className='h-full w-full' aria-hidden='true'>
      <MaterialFill id={`${uid}-g`} material={skin.material} base={p.ground} alt={ground2} line={line} />
      {skin.material === 'ink' ? <rect x={leftFace + 18} width={rightFace - leftFace - 36} height={H} fill={ground2} /> : null}
      <MaterialFill id={`${uid}-l`} material={skin.material} base={p.wall} alt={wall2} line={wall2} x={leftFace - 16} y={0} w={16} h={H} />
      <MaterialFill id={`${uid}-r`} material={skin.material} base={p.wall} alt={wall2} line={wall2} x={rightFace} y={0} w={16} h={H} />
      <rect x={leftFace - 6} y={30} width={6} height={26} rx={3} fill={p.mark} />
      <rect x={rightFace} y={46} width={6} height={26} rx={3} fill={p.mark} />
      <RicochetTeeth face={leftFace} dir={1} gap={[30, 56]} fill={p.spike} />
      <RicochetTeeth face={rightFace} dir={-1} gap={[46, 72]} fill={p.spike} />
      <text x={W / 2} y={30} textAnchor='middle' fontSize={22} fontWeight={800} fill={p.mark} style={{ fontFamily: "var(--font-big-shoulders, 'Big Shoulders'), sans-serif" }}>
        12
      </text>
      <RicochetBird skin={skin} x={86} y={56} r={11} />
    </svg>
  );
}

/* ── word grid ──────────────────────────────────────────────────────── */

function WordTile({
  skin,
  x,
  y,
  s,
  letter,
  state,
}: {
  skin: SkinSet<'word-grid'>;
  x: number;
  y: number;
  s: number;
  letter: string;
  state: 'hit' | 'near' | 'miss' | 'empty';
}) {
  const p = skin.palette;
  const fill = state === 'empty' ? p.tile : p[state];
  const ink = state === 'empty' ? p.tileInk : readableOn(fill, '#1f1a16', '#f4ebdc');
  const edge = mixHex(p.tile, p.tileInk, 0.45);
  const r = s * 0.1;
  const n = s * 0.16;
  const m = y + s / 2;
  let shape: React.ReactNode;
  if (skin.shape === 'round') {
    shape = <circle cx={x + s / 2} cy={y + s / 2} r={s / 2} fill={fill} stroke={state === 'empty' ? edge : 'none'} strokeWidth='1' />;
  } else if (skin.shape === 'stub') {
    shape = (
      <path
        d={`M${x + r} ${y}H${x + s - r}A${r} ${r} 0 0 1 ${x + s} ${y + r}V${m - n}A${n} ${n} 0 0 0 ${x + s} ${m + n}V${y + s - r}A${r} ${r} 0 0 1 ${x + s - r} ${y + s}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + s - r}V${m + n}A${n} ${n} 0 0 0 ${x} ${m - n}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`}
        fill={fill}
        stroke={state === 'empty' ? edge : 'none'}
        strokeWidth='1'
      />
    );
  } else if (skin.shape === 'tag') {
    const c = s * 0.2;
    shape = <path d={`M${x + c} ${y}H${x + s}V${y + s}H${x}V${y + c}Z`} fill={fill} stroke={state === 'empty' ? edge : 'none'} strokeWidth='1' />;
  } else {
    shape = <rect x={x} y={y} width={s} height={s} rx={r} fill={fill} stroke={state === 'empty' ? edge : 'none'} strokeWidth='1' />;
  }
  const mx = skin.shape === 'round' ? x + s * 0.76 : x + s * 0.8;
  const my = skin.shape === 'round' ? y + s * 0.24 : y + s * 0.2;
  return (
    <g>
      {shape}
      {skin.shape === 'tag' ? <circle cx={x + s * 0.22} cy={y + s * 0.22} r={s * 0.07} fill={p.ground} /> : null}
      {skin.shape === 'stub' ? <path d={`M${x + s * 0.24} ${y + s * 0.18}V${y + s * 0.82}`} stroke={ink} strokeOpacity='0.55' strokeWidth='0.9' strokeDasharray='2 1.6' /> : null}
      <text x={x + s / 2} y={y + s / 2 + s * 0.17} textAnchor='middle' fontFamily='var(--tixy-font-text)' fontWeight='800' fontSize={s * 0.5} fill={ink}>
        {letter}
      </text>
      {state === 'hit' ? <circle cx={mx} cy={my} r={s * 0.07} fill={ink} /> : null}
      {state === 'near' ? <circle cx={mx} cy={my} r={s * 0.065} fill='none' stroke={ink} strokeWidth='1' /> : null}
      {state === 'miss' ? <path d={`M${mx - s * 0.08} ${my}H${mx + s * 0.08}`} stroke={ink} strokeWidth='1.2' strokeLinecap='round' /> : null}
    </g>
  );
}

function WordGridPreview({ skin, uid }: { skin: SkinSet<'word-grid'>; uid: string }) {
  const p = skin.palette;
  const dark = luminance(p.ground) < 0.3;
  const s = 22;
  const gap = 5;
  const ox = (W - (5 * s + 4 * gap)) / 2;
  const oy = (H - (3 * s + 2 * gap)) / 2;
  const rows: [string, 'hit' | 'near' | 'miss' | 'empty'][][] = [
    [['t', 'miss'], ['i', 'near'], ['c', 'hit'], ['k', 'miss'], ['e', 'near']],
    [['t', 'hit'], ['i', 'hit'], ['n', 'miss'], ['y', 'near'], ['', 'empty']],
    [['', 'empty'], ['', 'empty'], ['', 'empty'], ['', 'empty'], ['', 'empty']],
  ];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className='h-full w-full' aria-hidden='true'>
      <MaterialFill
        id={`${uid}-w`}
        material={skin.material}
        base={p.ground}
        alt={mixHex(p.ground, dark ? '#ffffff' : '#000000', 0.07)}
        line={mixHex(p.ground, '#000000', dark ? 0.35 : 0.14)}
      />
      {rows.map((row, r) =>
        row.map(([letter, state], c) => (
          <WordTile key={`${r}-${c}`} skin={skin} x={ox + c * (s + gap)} y={oy + r * (s + gap)} s={s} letter={letter} state={state} />
        )),
      )}
    </svg>
  );
}

/* ── chess ──────────────────────────────────────────────────────────── */

const CHESS_PREVIEW_PIECES: [PieceCode, number, number][] = [
  ['bq', 1, 0],
  ['bp', 3, 0],
  ['wn', 2, 1],
  ['wk', 0, 2],
  ['wr', 4, 2],
];

function ChessPreview({ skin, uid }: { skin: SkinSet<'chess'>; uid: string }) {
  const p = skin.palette;
  const s = 22;
  const ox = (W - 5 * s) / 2;
  const oy = (H - 3 * s) / 2;
  const frameTone = readableOn(p.frame, '#1f1a16', '#f4ebdc');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className='h-full w-full' aria-hidden='true'>
      <rect width={W} height={H} fill={mixHex(p.frame, '#000000', 0.25)} />
      <MaterialFill
        id={`${uid}-f`}
        material={skin.material}
        base={p.frame}
        alt={mixHex(p.frame, frameTone, 0.1)}
        line={mixHex(p.frame, frameTone, 0.22)}
        x={ox - 8}
        y={oy - 8}
        w={5 * s + 16}
        h={3 * s + 16}
        rx={4}
      />
      {Array.from({ length: 15 }, (_, i) => {
        const c = i % 5;
        const r = Math.floor(i / 5);
        return <rect key={i} x={ox + c * s} y={oy + r * s} width={s} height={s} fill={(r + c) % 2 ? p.dark : p.light} />;
      })}
      {CHESS_PREVIEW_PIECES.map(([code, c, r]) => (
        <svg key={`${code}${c}${r}`} x={ox + c * s + 1} y={oy + r * s + 1} width={s - 2} height={s - 2} viewBox={`0 0 ${s - 2} ${s - 2}`}>
          <ChessPieceSvg
            piece={code}
            fill={code.startsWith('w') ? p.white : p.black}
            stroke={readableOn(code.startsWith('w') ? p.white : p.black, '#1f1a16', '#f4ebdc')}
            shape={skin.shape}
          />
        </svg>
      ))}
    </svg>
  );
}

/* ── connect four ───────────────────────────────────────────────────── */

const C4_PREVIEW_CHIPS: ['you' | 'them', number, number][] = [
  ['you', 0, 2],
  ['them', 1, 2],
  ['you', 2, 2],
  ['them', 3, 2],
  ['you', 1, 1],
  ['them', 2, 1],
  ['you', 2, 0],
];

function ConnectFourPreview({ skin, uid }: { skin: SkinSet<'connect-four'>; uid: string }) {
  const p = skin.palette;
  const frameTone = readableOn(p.frame, '#1f1a16', '#f4ebdc');
  const look = { you: chipLook(p.you), them: chipLook(p.them) };
  const cx = (c: number) => 38 + c * 28;
  const cy = (r: number) => 22 + r * 28;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className='h-full w-full' aria-hidden='true'>
      <rect width={W} height={H} fill={mixHex(p.frame, readableOn(p.frame, '#1f1a16', '#f4ebdc'), 0.22)} />
      <MaterialFill
        id={`${uid}-f`}
        material={skin.material}
        base={p.frame}
        alt={mixHex(p.frame, frameTone, 0.07)}
        line={mixHex(p.frame, frameTone, 0.3)}
        x={18}
        y={6}
        w={124}
        h={88}
        rx={6}
      />
      {Array.from({ length: 12 }, (_, i) => (
        <circle key={i} cx={cx(i % 4)} cy={cy(Math.floor(i / 4))} r='12' fill={p.hole} />
      ))}
      {C4_PREVIEW_CHIPS.map(([side, c, r]) => (
        <svg
          key={`${side}${c}${r}`}
          x={cx(c) - 11}
          y={cy(r) - 11}
          width='22'
          height='22'
          viewBox='0 0 100 100'
          style={
            {
              '--chip': look[side].fill,
              '--chip-ink': look[side].ink,
              '--chip-edge': look[side].edge,
            } as React.CSSProperties
          }
        >
          <ChipArt shape={skin.shape} side={side} />
        </svg>
      ))}
    </svg>
  );
}

/* ── skee-ball ──────────────────────────────────────────────────────── */

const INK = '#1f1a16';
const PAPER = '#f4ebdc';

function SkeeBallPreview({ skin, uid }: { skin: SkinSet<'skee-ball'>; uid: string }) {
  const p = skin.palette;
  const bx = 80;
  const by = 82;
  const br = 9;
  const line = mixHex(p.lane, p.cabinet, 0.55);
  const mark = contrastRatio(p.ringMark, p.ball) >= 1.5 ? p.ringMark : readableOn(p.ball, INK, PAPER);
  const pocket = contrastRatio(p.rings, p.laneAlt) >= contrastRatio(p.ringMark, p.laneAlt) ? p.rings : p.ringMark;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className='h-full w-full' aria-hidden='true' preserveAspectRatio='xMidYMid slice'>
      <defs>
        <clipPath id={`${uid}-l`}>
          <path d='M48 100L112 100L106 44L54 44Z' />
        </clipPath>
        <clipPath id={`${uid}-b`}>
          <circle cx={bx} cy={by} r={br} />
        </clipPath>
      </defs>
      <rect width={W} height={H} fill={p.cabinet} />
      <g clipPath={`url(#${uid}-l)`}>
        <MaterialFill id={`${uid}-m`} material={skin.material} base={p.lane} alt={p.laneAlt} line={line} />
      </g>
      <rect x='36' y='6' width='88' height='40' rx='4' fill={p.laneAlt} />
      <circle cx='80' cy='26' r='17' fill={p.rings} />
      <circle cx='80' cy='26' r='13' fill={p.ringMark} />
      <circle cx='80' cy='26' r='9' fill={p.rings} />
      <circle cx='80' cy='26' r='5' fill={p.ringMark} />
      <circle cx='80' cy='26' r='2.4' fill={p.cabinet} />
      {[44, 116].map((x) => (
        <circle key={x} cx={x} cy='14' r='3.6' fill={p.cabinet} stroke={pocket} strokeWidth='1.4' />
      ))}
      <circle cx={bx} cy={by} r={br} fill={p.ball} />
      <g clipPath={`url(#${uid}-b)`} fill={mark}>
        {skin.shape === 'striped' ? (
          <>
            <rect x={bx - 5} y={by - br} width='3.5' height={br * 2} />
            <rect x={bx + 1.5} y={by - br} width='3.5' height={br * 2} />
          </>
        ) : null}
        {skin.shape === 'dotted'
          ? [
              [-4, -4],
              [4, -4],
              [0, 0],
              [-5.5, 3.5],
              [5.5, 3.5],
              [0, 6.5],
            ].map(([dx, dy]) => <circle key={`${dx}${dy}`} cx={bx + dx!} cy={by + dy!} r='1.7' />)
          : null}
        {skin.shape === 'ringed' ? <rect x={bx - br} y={by - 1.8} width={br * 2} height='3.6' /> : null}
        {skin.shape === 'ball' ? (
          <>
            <rect x={bx - br} y={by - 0.5} width={br * 2} height='1' opacity='0.6' />
            <circle cx={bx - 3.5} cy={by - 3.5} r='1.6' opacity='0.8' />
          </>
        ) : null}
      </g>
    </svg>
  );
}

/* ── high striker ───────────────────────────────────────────────────── */

function StrikerPuck({ skin, x, y }: { skin: SkinSet<'high-striker'>; x: number; y: number }) {
  const p = skin.palette;
  const markColour = mixHex(p.puck, p.mark, 0.6);
  if (skin.shape === 'star') {
    const pts = (r: number, k: number) =>
      Array.from({ length: 10 }, (_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 === 0 ? r : r * k;
        return `${(x + Math.cos(a) * rr).toFixed(1)},${(y + Math.sin(a) * rr).toFixed(1)}`;
      }).join(' ');
    return (
      <g>
        <polygon points={pts(9, 0.42)} fill={p.puck} />
        <polygon points={pts(4.6, 0.42)} fill={markColour} />
      </g>
    );
  }
  if (skin.shape === 'heart') {
    return (
      <g>
        <path
          d={`M${x} ${y + 8}C${x - 6} ${y + 4} ${x - 9} ${y} ${x - 9} ${y - 3.5}C${x - 9} ${y - 7} ${x - 6.5} ${y - 8} ${x - 4.5} ${y - 8}C${x - 2.5} ${y - 8} ${x - 1} ${y - 6.5} ${x} ${y - 5}C${x + 1} ${y - 6.5} ${x + 2.5} ${y - 8} ${x + 4.5} ${y - 8}C${x + 6.5} ${y - 8} ${x + 9} ${y - 7} ${x + 9} ${y - 3.5}C${x + 9} ${y} ${x + 6} ${y + 4} ${x} ${y + 8}Z`}
          fill={p.puck}
        />
        <circle cx={x - 3.5} cy={y - 3.5} r='1.6' fill={markColour} />
      </g>
    );
  }
  if (skin.shape === 'stub') {
    return (
      <g>
        <path
          d={`M${x - 10} ${y - 6}H${x + 10}V${y - 2}A2 2 0 0 0 ${x + 10} ${y + 2}V${y + 6}H${x - 10}V${y + 2}A2 2 0 0 0 ${x - 10} ${y - 2}Z`}
          fill={p.puck}
        />
        <path d={`M${x + 4} ${y - 4}V${y + 4}`} stroke={markColour} strokeWidth='1.4' strokeDasharray='1.6 1.4' />
      </g>
    );
  }
  return (
    <g>
      <ellipse cx={x} cy={y} rx='9' ry='6' fill={p.puck} />
      <ellipse cx={x} cy={y - 4} rx='9' ry='2' fill={p.bell} opacity='0.9' />
    </g>
  );
}

function HighStrikerPreview({ skin, uid }: { skin: SkinSet<'high-striker'>; uid: string }) {
  const p = skin.palette;
  const channel = readableOn(p.puck, INK, PAPER);
  const tick = contrastRatio(p.scale, p.tower) >= 3 ? p.scale : readableOn(p.tower, INK, PAPER);
  const trim = mixHex(p.tower, INK, 0.45);
  const face = { base: p.tower, alt: mixHex(p.tower, p.scale, 0.3), line: mixHex(p.tower, p.mark, 0.5) };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className='h-full w-full' aria-hidden='true' preserveAspectRatio='xMidYMid slice'>
      <rect width={W} height={H} fill={INK} />
      <rect x='20' y='88' width='120' height='12' fill={p.ground} />
      <rect x='46' y='82' width='68' height='8' fill={trim} />
      <rect x='60' y='14' width='40' height='70' fill={p.tower} />
      <MaterialFill
        id={`${uid}-f`}
        material={skin.material}
        base={face.base}
        alt={face.alt}
        line={face.line}
        x={63}
        y={18}
        w={34}
        h={64}
      />
      <rect x='75' y='18' width='10' height='64' fill={channel} />
      {[26, 38, 50, 62, 74].flatMap((y) =>
        [67, 91].map((x) => <rect key={`${x}${y}`} x={x - 3} y={y} width='6' height='1.6' fill={tick} />),
      )}
      <path d='M58 16Q60 6 70 6H90Q100 6 102 16Z' fill={p.tower} />
      <path d='M72 12a8 8 0 0 1 16 0z' fill={p.bell} />
      <rect x='70' y='11.5' width='20' height='2.2' rx='1' fill={p.bell} />
      <StrikerPuck skin={skin} x={80} y={72} />
    </svg>
  );
}

/* ── tin duck ───────────────────────────────────────────────────────── */

function TinTarget({ skin, x, y, s }: { skin: SkinSet<'tin-duck'>; x: number; y: number; s: number }) {
  const p = skin.palette;
  const tone = mixHex(p.target, p.targetMark, 0.2);
  const t = (cx: number, cy: number) => `${(x + cx * s).toFixed(1)},${(y + cy * s).toFixed(1)}`;
  const el = (cx: number, cy: number, rx: number, ry: number, fill: string, rot = 0) => (
    <ellipse
      cx={x + cx * s}
      cy={y + cy * s}
      rx={rx * s}
      ry={ry * s}
      fill={fill}
      transform={rot ? `rotate(${rot} ${x + cx * s} ${y + cy * s})` : undefined}
    />
  );
  if (skin.shape === 'rabbit') {
    return (
      <g>
        {el(-0.1, 0.27, 0.36, 0.25, p.target)}
        {el(0.27, 0.46, 0.17, 0.15, p.target)}
        {el(0.2, 0.74, 0.05, 0.15, p.target, 6)}
        {el(0.32, 0.72, 0.045, 0.14, p.target, 20)}
        {el(0.2, 0.74, 0.022, 0.1, p.sight, 6)}
        {el(-0.45, 0.3, 0.085, 0.085, tone)}
        {el(-0.12, 0.2, 0.2, 0.15, tone)}
        {el(0.34, 0.5, 0.03, 0.03, p.targetMark)}
      </g>
    );
  }
  if (skin.shape === 'fish') {
    return (
      <g>
        {el(0.02, 0.34, 0.4, 0.26, p.target)}
        <polygon points={[t(-0.3, 0.34), t(-0.58, 0.58), t(-0.47, 0.34), t(-0.58, 0.1)].join(' ')} fill={p.target} />
        <polygon points={[t(-0.12, 0.53), t(0.14, 0.55), t(-0.02, 0.76)].join(' ')} fill={p.sight} />
        {el(0.0, 0.26, 0.28, 0.08, tone)}
        {el(0.28, 0.42, 0.04, 0.04, p.targetMark)}
      </g>
    );
  }
  if (skin.shape === 'star') {
    const pts = (r: number, k: number) =>
      Array.from({ length: 10 }, (_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = (i % 2 === 0 ? r : r * k) * s;
        return `${(x + Math.cos(a) * rr).toFixed(1)},${(y + 0.33 * s + Math.sin(a) * rr).toFixed(1)}`;
      }).join(' ');
    return (
      <g>
        <polygon points={pts(0.42, 0.43)} fill={p.target} />
        <polygon points={pts(0.22, 0.43)} fill={tone} />
        {el(0, 0.33, 0.045, 0.045, p.targetMark)}
      </g>
    );
  }
  return (
    <g>
      {el(-0.02, 0.3, 0.46, 0.3, p.target)}
      <polygon points={[t(-0.3, 0.3), t(-0.62, 0.62), t(-0.46, 0.34), t(-0.2, 0.2)].join(' ')} fill={p.target} />
      <polygon points={[t(0.14, 0.36), t(0.46, 0.34), t(0.5, 0.74), t(0.26, 0.74)].join(' ')} fill={p.target} />
      {el(0.42, 0.78, 0.2, 0.19, p.target)}
      <path
        d={`M${x + 0.54 * s} ${y + 0.86 * s}Q${x + 0.84 * s} ${y + 0.84 * s} ${x + 0.86 * s} ${y + 0.76 * s}Q${x + 0.7 * s} ${y + 0.68 * s} ${x + 0.54 * s} ${y + 0.7 * s}Z`}
        fill={p.sight}
      />
      {el(-0.1, 0.3, 0.22, 0.1, tone, 12)}
      {el(0.5, 0.82, 0.04, 0.04, p.targetMark)}
    </g>
  );
}

function TinDuckPreview({ skin, uid }: { skin: SkinSet<'tin-duck'>; uid: string }) {
  const p = skin.palette;
  const alt = mixHex(p.booth, p.boothAlt, contrastRatio(p.target, p.boothAlt) >= 2.5 ? 1 : 0.4);
  const line = mixHex(p.booth, INK, 0.4);
  const rows = [
    { y: 58, s: 20, xs: [34, 100] },
    { y: 80, s: 26, xs: [20, 84] },
  ];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className='h-full w-full' aria-hidden='true' preserveAspectRatio='xMidYMid slice'>
      <MaterialFill id={`${uid}-b`} material={skin.material} base={p.booth} alt={alt} line={line} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <g key={i}>
          <rect x={i * 26.7} y='0' width='26.7' height='12' fill={i % 2 === 0 ? p.booth : p.boothAlt} />
          <circle cx={i * 26.7 + 13.35} cy='12' r='13.35' fill={i % 2 === 0 ? p.booth : p.boothAlt} />
        </g>
      ))}
      <rect x='0' y='0' width={W} height='3' fill={p.target} />
      {rows.map((row) => (
        <g key={row.y}>
          <rect x='0' y={row.y + 2} width={W} height='9' fill={p.water} />
          <rect x='0' y={row.y + 2} width={W} height='2' fill={mixHex(p.water, '#ffffff', 0.2)} />
          {row.xs.map((x) => (
            <g key={x}>
              <rect x={x - 4} y={row.y - 1} width='14' height='4' fill={INK} />
              <TinTarget skin={skin} x={x + 3} y={row.y - row.s * 0.95} s={row.s * 0.95} />
            </g>
          ))}
        </g>
      ))}
    </svg>
  );
}

/* ── the games that don't draw skin sets yet: palette and shape, plainly ── */

function SwatchPreview({ skin }: { skin: SkinSet }) {
  const colours = Object.values(skin.palette as Record<string, string>).slice(0, 6);
  const step = W / colours.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className='h-full w-full' aria-hidden='true'>
      {colours.map((colour, i) => (
        <rect key={i} x={i * step} y={0} width={step + 0.5} height={H} fill={colour} />
      ))}
    </svg>
  );
}

/* ── ring toss ──────────────────────────────────────────────────────── */

function RingTossBottle({ x, base, s, fill }: { x: number; base: number; s: number; fill: string }) {
  const w = 8 * s;
  const n = 2.6 * s;
  const h = 36 * s;
  return (
    <path
      d={`M${x - w},${base} V${base - h * 0.5} Q${x - w},${base - h * 0.62} ${x - n},${base - h * 0.74} V${base - h} H${x + n} V${base - h * 0.74} Q${x + w},${base - h * 0.62} ${x + w},${base - h * 0.5} V${base} Z`}
      fill={fill}
    />
  );
}

/* The ring as it sits on a neck, in the skin's shape: the back half first. */
function RingTossRing({ skin, cx, cy, half }: { skin: SkinSet<'ring-toss'>; cx: number; cy: number; half: 'back' | 'front' }) {
  const p = skin.palette;
  const rx = 13;
  const ry = 4.4;
  const d = half === 'back' ? `M${cx - rx},${cy} A${rx},${ry} 0 0 1 ${cx + rx},${cy}` : `M${cx - rx},${cy} A${rx},${ry} 0 0 0 ${cx + rx},${cy}`;
  if (skin.shape === 'beads') {
    const beads = Array.from({ length: 12 }, (_, i) => (i / 12) * Math.PI * 2).filter((a) => (half === 'back' ? Math.sin(a) < 0 : Math.sin(a) >= 0));
    return (
      <>
        {beads.map((a, i) => (
          <circle key={a} cx={cx + Math.cos(a) * rx} cy={cy + Math.sin(a) * ry} r='2.5' fill={i % 3 === 0 ? p.ringMark : p.ring} />
        ))}
      </>
    );
  }
  const width = skin.shape === 'band' ? 5.5 : 4.2;
  return (
    <>
      <path d={d} fill='none' stroke={p.ring} strokeWidth={width} strokeLinecap='round' />
      {skin.shape === 'rope' ? <path d={d} fill='none' stroke={p.ringMark} strokeWidth={width} strokeDasharray='2 3' /> : null}
      {skin.shape === 'hoop' ? <path d={d} fill='none' stroke={p.ringMark} strokeWidth={width} strokeDasharray='3 11' /> : null}
      {skin.shape === 'band' ? <path d={d} fill='none' stroke={p.ringMark} strokeWidth='1.2' /> : null}
    </>
  );
}

function RingTossPreview({ skin, uid }: { skin: SkinSet<'ring-toss'>; uid: string }) {
  const p = skin.palette;
  const line = mixHex(p.crate, INK, 0.35);
  const neck = { x: 80, y: 46 };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className='h-full w-full' aria-hidden='true' preserveAspectRatio='xMidYMid slice'>
      <rect width={W} height={H} fill={p.booth} />
      <rect y='74' width={W} height='26' fill={p.platform} />
      {[52, 80, 108].map((x) => (
        <RingTossBottle key={`b${x}`} x={x} base={70} s={0.9} fill={p.glassAlt} />
      ))}
      <RingTossRing skin={skin} cx={neck.x} cy={neck.y} half='back' />
      {[38, 66, 94, 122].map((x) => (
        <RingTossBottle key={`f${x}`} x={x} base={84} s={1} fill={x === 94 ? mixHex(p.glass, PAPER, 0.15) : p.glass} />
      ))}
      <RingTossRing skin={skin} cx={neck.x} cy={neck.y} half='front' />
      <MaterialFill id={`${uid}-m`} material={skin.material} base={p.crate} alt={mixHex(p.crate, INK, 0.15)} line={line} x={26} y={70} w={108} h={20} rx={2} />
      <text x='145' y='94' fontSize='11' textAnchor='middle' fontWeight={800} fill={p.mark} style={{ fontFamily: "var(--font-big-shoulders, 'Big Shoulders'), sans-serif" }}>
        50
      </text>
    </svg>
  );
}

/* ── flappy bird ────────────────────────────────────────────────────── */

/* The flyer, drawn as the game draws it (_flappy-draw.ts), at the origin,
   facing right, about 30 by 24. */
function FlappyFlyer({ skin }: { skin: SkinSet<'flappy-bird'> }) {
  const p = skin.palette;
  const eye = (x: number, y: number, r: number) => (
    <g>
      <circle cx={x} cy={y} r={r} fill='#f4ebdc' />
      <circle cx={x + r * 0.35} cy={y} r={r * 0.5} fill='#1f1a16' />
    </g>
  );
  switch (skin.shape) {
    case 'gull':
      return (
        <g>
          <ellipse cx='-1' cy='1' rx='17' ry='10.8' fill={p.bird} />
          <circle cx='9' cy='-4' r='7.5' fill={p.bird} />
          <path d='M15 -4L25 -1.5L15 0.5Z' fill={p.beak} />
          <path d='M4 -1L-22 -4L-16 4Z' fill={p.wing} />
          <path d='M-22 -4L-16 -2.5L-18 1Z' fill='#1f1a16' />
          {eye(10.5, -6, 2.6)}
        </g>
      );
    case 'stub':
      return (
        <g>
          <ellipse cx='-10' cy='-11' rx='9' ry='5' fill={p.wing} transform='rotate(-20 -3 -8)' />
          <path
            d='M-12 -10.5H12A3 3 0 0 1 15 -7.5V-4.5A4.5 4.5 0 0 0 15 4.5V7.5A3 3 0 0 1 12 10.5H-12A3 3 0 0 1 -15 7.5V4.5A4.5 4.5 0 0 0 -15 -4.5V-7.5A3 3 0 0 1 -12 -10.5Z'
            fill={p.bird}
          />
          <path d='M-5 -8V8' stroke={p.beak} strokeWidth='1.4' strokeDasharray='2.4 2' />
          <circle cx='6' cy='4' r='2.2' fill={p.beak} />
          {eye(6, -3, 3.4)}
        </g>
      );
    case 'duck':
      return (
        <g>
          <path d='M-15 -2Q-19 -10 -13 -8Q-4 2 4 -1Q17 0 13 7Q0 14 -13 8Z' fill={p.bird} />
          <circle cx='7' cy='-7' r='7.5' fill={p.bird} />
          <ellipse cx='17' cy='-5' rx='6' ry='2.6' fill={p.beak} />
          <ellipse cx='-3' cy='1' rx='8' ry='4.5' fill={p.wing} />
          {eye(9, -9, 2.4)}
        </g>
      );
    case 'owl':
      return (
        <g>
          <path d='M-9 -12L-7 -19L-2 -13H4L9 -19L11 -12Z' fill={p.bird} />
          <ellipse cx='1' cy='1' rx='15' ry='13.5' fill={p.bird} />
          <ellipse cx='-8' cy='4' rx='8' ry='5' fill={p.wing} />
          {eye(-2, -3, 4.6)}
          {eye(8, -3, 4.6)}
          <path d='M1.5 0H5.5L3.5 5Z' fill={p.beak} />
        </g>
      );
    case 'plane':
      return (
        <g>
          <rect x='-24' y='-1' width='10' height='1' fill='#1f1a16' />
          <rect x='-42' y='-5' width='18' height='9' fill='#f4ebdc' />
          <rect x='-42' y='-1.5' width='18' height='2' fill={p.wing} />
          <path d='M-15 -2L-11 -11L-7 -2Z' fill={p.wing} />
          <path d='M-15 -2L10 -6Q17 -5 17 0Q17 5 10 5L-13 3Z' fill={p.bird} />
          <rect x='-6' y='-10' width='14' height='3.5' fill={p.wing} />
          <rect x='-6' y='4' width='14' height='3.5' fill={p.wing} />
          <rect x='16' y='-1.5' width='3' height='3' fill={p.beak} />
          <rect x='19' y='-11' width='2.2' height='22' fill={p.beak} />
          {eye(6, -2, 2.6)}
        </g>
      );
    case 'bird':
    default:
      return (
        <g>
          <ellipse cx='0' cy='0' rx='15' ry='12' fill={p.bird} />
          <path d='M12 -1L24 2.5L12 6Z' fill={p.beak} />
          <ellipse cx='-5' cy='2' rx='9' ry='6' fill={p.wing} />
          {eye(7, -4.5, 5.6)}
        </g>
      );
  }
}

function FlappyPost({ skin, uid, x, top, bottom }: { skin: SkinSet<'flappy-bird'>; uid: string; x: number; top: number; bottom: number }) {
  const p = skin.palette;
  const w = 22;
  const cap = 8;
  const mark = skin.material === 'ink' ? mixHex(p.pipe, '#ffffff', 0.14) : p.pipeMark;
  const alt = mixHex(p.pipe, '#ffffff', 0.14);
  const body = (y: number, h: number, key: string) => (
    <g key={key}>
      <MaterialFill id={`${uid}-fp-${key}`} material={skin.material} base={p.pipe} alt={mark} line={mark} x={x} y={y} w={w} h={h} />
      {skin.material === 'enamel' || skin.material === 'ink' ? <rect x={x + 3} y={y} width={4} height={h} fill={alt} /> : null}
    </g>
  );
  return (
    <g>
      {body(-2, top - cap + 2, 't')}
      {body(bottom + cap, H - 12 - bottom - cap, 'b')}
      {[top - cap, bottom].map((y) => (
        <g key={y}>
          <rect x={x - 2} y={y} width={w + 4} height={cap} rx='1.6' fill={p.pipeCap} />
          <rect x={x - 2} y={y + cap / 2 - 0.8} width={w + 4} height='1.6' fill={p.pipe} />
        </g>
      ))}
    </g>
  );
}

function FlappyPreview({ skin, uid }: { skin: SkinSet<'flappy-bird'>; uid: string }) {
  const p = skin.palette;
  const groundY = H - 12;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className='h-full w-full' aria-hidden='true'>
      <rect width={W} height={H} fill={p.sky} />
      <g fill='none' stroke={p.far} strokeWidth='2.5'>
        <circle cx='128' cy='52' r='24' />
        <path d='M128 28V76M104 52H152M111 35L145 69M145 35L111 69M118 88L128 52L138 88' />
      </g>
      <FlappyPost skin={skin} uid={uid} x={36} top={30} bottom={68} />
      <FlappyPost skin={skin} uid={uid} x={98} top={42} bottom={80} />
      <rect y={groundY} width={W} height={12} fill={p.ground} />
      <rect y={groundY} width={W} height='1.5' fill={mixHex(p.ground, '#000000', 0.35)} />
      <g transform='translate(74 52) rotate(-14) scale(0.95)'>
        <FlappyFlyer skin={skin} />
      </g>
    </svg>
  );
}

/* ── mini golf ──────────────────────────────────────────────────────── */

/* One hole from above, drawn as the game draws it: the putting surface in
   the skin's material between its rails, the cup and flag, and the ball
   with its markings. */
function MiniGolfPreview({ skin, uid }: { skin: SkinSet<'mini-golf'>; uid: string }) {
  const p = skin.palette;
  const lane = 'M30,96 L30,30 L42,14 L130,14 L130,52 L58,52 L58,96 Z';
  const bx = 44;
  const by = 74;
  const br = 8;
  const line = mixHex(p.feltAlt, '#000000', 0.25);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className='h-full w-full' aria-hidden='true' preserveAspectRatio='xMidYMid slice'>
      <defs>
        <clipPath id={`${uid}-lane`}>
          <path d={lane} />
        </clipPath>
        <clipPath id={`${uid}-ball`}>
          <circle cx={bx} cy={by} r={br} />
        </clipPath>
      </defs>
      <rect width={W} height={H} fill={p.deck} />
      <g clipPath={`url(#${uid}-lane)`}>
        <MaterialFill id={`${uid}-m`} material={skin.material} base={p.felt} alt={p.feltAlt} line={line} />
      </g>
      <path d={lane} fill='none' stroke={p.rail} strokeWidth='7' strokeLinejoin='round' />
      <path d={lane} fill='none' stroke={p.railTop} strokeWidth='3' strokeLinejoin='round' />
      <ellipse cx='112' cy='33' rx='7' ry='6' fill='#0b0806' />
      <line x1='112' y1='33' x2='112' y2='8' stroke={PAPER} strokeWidth='1.6' />
      <path d='M113,8 L127,12.5 L113,17 Z' fill={p.flag} />
      <circle cx={bx} cy={by} r={br} fill={p.ball} />
      <g clipPath={`url(#${uid}-ball)`} fill={p.ballMark}>
        {skin.shape === 'band' ? <rect x={bx - br} y={by - 2.4} width={br * 2} height='4.8' /> : null}
        {skin.shape === 'ringed' ? (
          <>
            <rect x={bx - 5} y={by - br} width='3.4' height={br * 2} />
            <rect x={bx + 1.6} y={by - br} width='3.4' height={br * 2} />
          </>
        ) : null}
        {skin.shape === 'dots'
          ? [
              [-3.5, -3.5],
              [3.5, -3.5],
              [0, 0.5],
              [-4.5, 4],
              [4.5, 4],
            ].map(([dx, dy]) => <circle key={`${dx}${dy}`} cx={bx + dx!} cy={by + dy!} r='1.6' />)
          : null}
        {skin.shape === 'star' ? (
          <path d={`M${bx},${by - 6} L${bx + 1.8},${by - 1.8} L${bx + 6},${by - 1.6} L${bx + 2.8},${by + 1.2} L${bx + 3.8},${by + 5.6} L${bx},${by + 3.2} L${bx - 3.8},${by + 5.6} L${bx - 2.8},${by + 1.2} L${bx - 6},${by - 1.6} L${bx - 1.8},${by - 1.8} Z`} />
        ) : null}
      </g>
    </svg>
  );
}

/* Bumper cars from above: the floor in its material inside the banded rail,
   two cars in the skin's bodywork meeting nose to nose. The cars keep the
   seats' colours (red and yellow): a skin never recolours a player. */
function BumperCar({ shape, x, y, turn, fill }: { shape: SkinSet<'bumper-cars'>['shape']; x: number; y: number; turn: number; fill: string }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${turn})`}>
      <rect x='-10' y='-12' width='20' height='24' rx='8' fill='#1f1a16' />
      {shape === 'teacup' ? (
        <>
          <circle r='8.6' fill={fill} />
          <circle r='5.4' fill={mixHex(fill, '#1f1a16', 0.35)} />
          <rect x='7.4' y='-2.6' width='4' height='5.2' rx='2' fill={fill} />
        </>
      ) : (
        <>
          <rect x='-8' y='-10' width='16' height='20' rx='6' fill={fill} />
          {shape === 'rocket' ? <path d='M-6.4,-2 L6.4,-2 L0,-11.6 Z' fill={fill} stroke='#1f1a16' strokeOpacity='.35' strokeWidth='.8' /> : null}
          {shape === 'coupe' ? <rect x='-7.6' y='7.6' width='15.2' height='2.6' fill={mixHex(fill, '#1f1a16', 0.3)} /> : null}
          {shape === 'dodgem' ? <rect x='-6.4' y='-9' width='12.8' height='6.4' rx='3' fill={fill} stroke='#1f1a16' strokeOpacity='.35' strokeWidth='.8' /> : null}
          <rect x='-1.2' y='-8.6' width='2.4' height='6' fill={PAPER} />
          <rect x='-5.4' y='3' width='10.8' height='3' rx='1.4' fill='#54483d' />
        </>
      )}
    </g>
  );
}

function BumperCarsPreview({ skin, uid }: { skin: SkinSet<'bumper-cars'>; uid: string }) {
  const p = skin.palette;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className='h-full w-full' aria-hidden='true' preserveAspectRatio='xMidYMid slice'>
      <defs>
        <clipPath id={`${uid}-floor`}>
          <rect x='16' y='12' width='128' height='76' rx='16' />
        </clipPath>
      </defs>
      <rect width={W} height={H} fill={p.deck} />
      <rect x='8' y='4' width='144' height='92' rx='24' fill={p.cap} />
      <rect x='11' y='7' width='138' height='86' rx='21' fill={p.rail} />
      <rect x='11' y='7' width='138' height='86' rx='21' fill='none' stroke={p.railAlt} strokeWidth='5' strokeDasharray='8 12' />
      <g clipPath={`url(#${uid}-floor)`}>
        <MaterialFill id={`${uid}-m`} material={skin.material} base={p.floor} alt={p.floorAlt} line={p.mark} />
      </g>
      <BumperCar shape={skin.shape} x={66} y={50} turn={90} fill='#b83627' />
      <BumperCar shape={skin.shape} x={94} y={50} turn={-90} fill='#f2a33c' />
      <path d='M80,38 L81.8,44 L88,45 L81.8,46.6 L80,53 L78.2,46.6 L72,45 L78.2,44 Z' fill='#f7e7c6' />
    </svg>
  );
}

/* ── derby ──────────────────────────────────────────────────────────── */

/* A toy horse facing right, its nose at (x, y), made the skin's way. */
function DerbyHorse({ x, y, make, silk }: { x: number; y: number; make: SkinSet<'derby'>['shape']; silk: string }) {
  const coat = '#8a4b2a';
  return (
    <g>
      {make === 'carousel' ? <rect x={x - 11.5} y={y - 16} width='2' height='30' fill='#c9a25a' /> : null}
      <rect x={x - 22} y={y - 2} width='18' height='9' rx='4.5' fill={coat} />
      <path d={`M${x - 7},${y + 1} L${x - 3},${y - 7} L${x + 1},${y - 6} L${x - 2},${y + 3} Z`} fill={coat} />
      <rect x={x - 19} y={y + 6} width='2.5' height='6' fill={coat} />
      <rect x={x - 10} y={y + 6} width='2.5' height='6' fill={coat} />
      <rect x={x - 16} y={y - 2} width='6' height='5' fill={silk} />
      {make === 'wheels' ? (
        <g fill='#c9a25a'>
          <rect x={x - 23} y={y + 12} width='22' height='2' fill='#3b2616' />
          <circle cx={x - 19} cy={y + 15} r='2' />
          <circle cx={x - 5} cy={y + 15} r='2' />
        </g>
      ) : make === 'rocker' ? (
        <path d={`M${x - 26},${y + 11} Q${x - 12},${y + 18} ${x + 2},${y + 11}`} fill='none' stroke='#3b2616' strokeWidth='2.5' />
      ) : null}
    </g>
  );
}

function DerbySkinPreview({ skin, uid }: { skin: SkinSet<'derby'>; uid: string }) {
  const p = skin.palette;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className='h-full w-full' aria-hidden='true' preserveAspectRatio='xMidYMid slice'>
      {/* The booth: two rails on the backboard, the target wall, the counter
          and the water gun. */}
      <rect width={W} height={H} fill={p.infield} />
      {[18, 44].map((y, i) => (
        <g key={y}>
          <MaterialFill id={`${uid}-m${i}`} material={skin.material} base={p.band} alt={mixHex(p.band, INK, 0.1)} line={p.bandLine} x={6} y={y} w={W - 12} h={14} />
          <rect x='6' y={y + 10} width={W - 12} height='1.4' fill={p.bandLine} />
        </g>
      ))}
      <rect x='136' y='12' width='3' height='52' fill={p.rail} />
      <DerbyHorse x={110} y={18} make={skin.shape} silk='#2f63b4' />
      <DerbyHorse x={82} y={44} make={skin.shape} silk='#c8402f' />
      <rect x='44' y='68' width='72' height='22' rx='3' fill={mixHex(p.infield, INK, 0.3)} stroke={p.rail} strokeWidth='1.2' />
      <circle cx='92' cy='79' r='8' fill='#f4ebdc' />
      <circle cx='92' cy='79' r='5.4' fill='#c8402f' />
      <circle cx='92' cy='79' r='2.5' fill='#f4ebdc' />
      <path d='M74,96 Q82,70 92,79' fill='none' stroke='#8fd3f4' strokeWidth='2' strokeLinecap='round' />
      <rect x='0' y='92' width={W} height={H - 92} fill={p.board} />
      <circle cx='74' cy='97' r='4' fill={p.ball} />
    </svg>
  );
}

export function SkinSetPreview({ skin }: { skin: SkinSet }) {
  const uid = useId().replace(/:/g, '');
  if (skin.game === 'snake') return <SnakePreview skin={skin as SkinSet<'snake'>} uid={uid} />;
  if (skin.game === '2048') return <Game2048Preview skin={skin as SkinSet<'2048'>} uid={uid} />;
  if (skin.game === '8-ball') return <PoolPreview skin={skin as SkinSet<'8-ball'>} uid={uid} />;
  if (skin.game === 'skee-ball') return <SkeeBallPreview skin={skin as SkinSet<'skee-ball'>} uid={uid} />;
  if (skin.game === 'high-striker') return <HighStrikerPreview skin={skin as SkinSet<'high-striker'>} uid={uid} />;
  if (skin.game === 'tin-duck') return <TinDuckPreview skin={skin as SkinSet<'tin-duck'>} uid={uid} />;
  if (skin.game === 'stack') return <StackPreview skin={skin as SkinSet<'stack'>} uid={uid} />;
  if (skin.game === 'ricochet') return <RicochetPreview skin={skin as SkinSet<'ricochet'>} uid={uid} />;
  if (skin.game === 'chess') return <ChessPreview skin={skin as SkinSet<'chess'>} uid={uid} />;
  if (skin.game === 'connect-four') return <ConnectFourPreview skin={skin as SkinSet<'connect-four'>} uid={uid} />;
  if (skin.game === 'word-grid') return <WordGridPreview skin={skin as SkinSet<'word-grid'>} uid={uid} />;
  if (skin.game === 'flappy-bird') return <FlappyPreview skin={skin as SkinSet<'flappy-bird'>} uid={uid} />;
  if (skin.game === 'ring-toss') return <RingTossPreview skin={skin as SkinSet<'ring-toss'>} uid={uid} />;
  if (skin.game === 'mini-golf') return <MiniGolfPreview skin={skin as SkinSet<'mini-golf'>} uid={uid} />;
  if (skin.game === 'bumper-cars') return <BumperCarsPreview skin={skin as SkinSet<'bumper-cars'>} uid={uid} />;
  if (skin.game === 'derby') return <DerbySkinPreview skin={skin as SkinSet<'derby'>} uid={uid} />;
  return <SwatchPreview skin={skin} />;
}

/* ── profile items ──────────────────────────────────────────────────── */

const FRAME_IDS = new Set<FrameId>(['ticket', 'bulbs', 'brass']);
const NAMECARD_IDS = new Set<NamecardId>(['awning', 'lights', 'planks', 'bezel', 'rail']);

/* A preview for an art kit frame or namecard, or a text title; null for
   anything else. */
export function readKitProfilePreview(slots: readonly string[], assetRef: Record<string, unknown> | null) {
  if (!assetRef) return null;
  if (slots.includes('frame') && FRAME_IDS.has(assetRef.frame as FrameId)) {
    return { kind: 'frame' as const, id: assetRef.frame as FrameId };
  }
  if (slots.includes('background') && NAMECARD_IDS.has(assetRef.namecard as NamecardId)) {
    return { kind: 'namecard' as const, id: assetRef.namecard as NamecardId };
  }
  return null;
}

function FramePreview({ id }: { id: FrameId }) {
  const clip = `${useId().replace(/:/g, '')}-clip`;
  return (
    <svg viewBox='-44 -6 184 108' className='h-full w-full' aria-hidden='true'>
      <rect x='-44' y='-6' width='184' height='108' fill='#eadfcb' />
      <defs>
        <clipPath id={clip}>
          <circle cx='48' cy='48' r='40' />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <StubAvatarArt ground='paper3' stock='amber' />
      </g>
      <FrameArt id={id} />
    </svg>
  );
}

export function KitProfilePreview({ preview }: { preview: NonNullable<ReturnType<typeof readKitProfilePreview>> }) {
  if (preview.kind === 'frame') {
    return <FramePreview id={preview.id} />;
  }
  return (
    <svg
      viewBox={`-12 -40 ${NAMECARD_WIDTH + 24} ${NAMECARD_HEIGHT + 80}`}
      className='h-full w-full'
      aria-hidden='true'
    >
      <rect x='-12' y='-40' width={NAMECARD_WIDTH + 24} height={NAMECARD_HEIGHT + 80} fill='#eadfcb' />
      <NamecardArt id={preview.id} />
    </svg>
  );
}

export function TitlePreview({ text }: { text: string }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className='h-full w-full' aria-hidden='true'>
      <rect width={W} height={H} fill='#eadfcb' />
      <rect x='16' y='34' width={W - 32} height='32' rx='8' fill='#f4ebdc' />
      <text x={W / 2} y='55' textAnchor='middle' fontFamily='var(--tixy-font-text)' fontWeight='800' fontSize='15' fill='#1f1a16'>
        {text}
      </text>
    </svg>
  );
}
