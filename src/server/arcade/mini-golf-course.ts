/**
 * Mini golf: the day's course. Nine holes built from boardwalk pieces, the
 * same nine for everyone, from the UTC date. Pure: no Date.now(), no
 * Math.random(), no I/O. The client builds the scene from it and the score
 * route replays putts on it.
 *
 * A hole is drawn as a grid of 1 m cells in a template below (rows listed
 * from the far end, the cup's, to the tee). The pieces:
 *
 *   #  felt          T  the tee        C  the cup
 *   ^ v < >  a ramp up one level, rising toward that side
 *   W  the windmill (a building across the lane, a tunnel through it, sails
 *      that close the tunnel mouth on a timer)
 *   L  a loop (ride it with enough pace, or it drops you back)
 *   o  a post        m  a mound      ?  the template's seeded slot
 *   7 9 1 3  a bank: a rail across the cell's diagonal that cuts off the
 *      corner the digit sits on, as on a number pad (7 north-west, 3
 *      south-east), so a ball turns the corner off it
 *
 * Rails run round every open edge. Outer corners are cut at 45 degrees, so
 * a bank off a corner plays the way it looks. The day's seed picks the
 * nine templates, mirrors some, fills each slot, sets the windmill's
 * timing and nudges the cup and the tee inside their cells. Every
 * combination is played in simulation by scripts/verify-mini-golf-replay.ts:
 * every hole is finishable inside the stroke limit and its par is what a
 * good player averages.
 */

import {
  MG_BALL_R,
  MG_CELL,
  MG_CUP_R,
  MG_HOLES,
  type MgCell,
  type MgDir,
  type MgHole,
  type MgLoop,
  type MgMound,
  type MgPost,
  type MgSeg,
  type MgWindmill,
} from './mini-golf-engine';

// ---------------------------------------------------------------------------
// Seeded randomness (mulberry32, byte-identical to the repo's seededRandom)
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The course seed for a UTC date key ('YYYY-MM-DD'). */
export function mgDateSeed(dateKey: string): number {
  let h = 0x811c9dc5;
  const key = `mini-golf:${dateKey}`;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

/** The UTC date key for a time. */
export function mgDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export type MgSlot = 'none' | 'post' | 'mound' | 'posts';

export interface MgTemplate {
  id: string;
  name: string;
  par: number;
  /** Rows from the far end (north) to the tee (south). */
  rows: readonly string[];
  /** What a '?' may become. */
  slot?: readonly MgSlot[];
  /** A bowl round the cup: always, never, or a seeded coin. */
  bowl?: boolean | 'maybe';
  /** Windmill sails: one full turn, ms. */
  millPeriodMs?: number;
  /** Cup nudge inside its cell, metres (each axis, plus or minus). */
  cupJitter?: number;
  /** Mounds at given cells (col, row from the top) with offsets. */
  mounds?: ReadonlyArray<{ col: number; row: number; dx?: number; dy?: number; r: number; a: number }>;
  /** Set where the hole's look leans: 'easy' holes open the round. */
  tier: 'easy' | 'mid' | 'feature';
}

/**
 * The pieces box. Pars are what a good simulated player averages (see the
 * verifier); the stroke limit is 6 on every hole.
 */
export const MG_TEMPLATES: readonly MgTemplate[] = [
  // ── Easy: they open the round ──
  {
    id: 'pier',
    name: 'the pier',
    par: 2,
    tier: 'easy',
    rows: ['C', '#', '#', '?', '#', 'T'],
    slot: ['none', 'mound'],
    bowl: 'maybe',
    cupJitter: 0.2,
  },
  {
    id: 'dogleg',
    name: 'the dogleg',
    par: 2,
    tier: 'easy',
    rows: ['..C', '..#', '###', '#..', '#..', 'T..'],
    bowl: 'maybe',
    cupJitter: 0.15,
  },
  {
    id: 'ramp',
    name: 'the ramp',
    par: 2,
    tier: 'easy',
    rows: ['C', '#', '^', '#', '?', 'T'],
    slot: ['none', 'mound'],
    bowl: 'maybe',
    cupJitter: 0.2,
  },
  {
    id: 'hump',
    name: 'the hump',
    par: 2,
    tier: 'easy',
    rows: ['C', '#', 'v', '^', '#', 'T'],
    bowl: 'maybe',
    cupJitter: 0.18,
  },
  {
    id: 'corner',
    name: 'the corner',
    par: 2,
    tier: 'easy',
    rows: ['C##', '..#', '..#', '..?', '..T'],
    slot: ['none', 'mound'],
    bowl: 'maybe',
    cupJitter: 0.12,
  },
  // ── The middle of the box ──
  {
    id: 'hairpin',
    name: 'the hairpin',
    par: 3,
    tier: 'mid',
    rows: ['###', '#.#', '#.#', '#.#', 'T.C'],
    cupJitter: 0.12,
  },
  {
    id: 'posts',
    name: 'the posts',
    par: 3,
    tier: 'mid',
    rows: ['#C#', '#?#', 'o#o', '#o#', '###', '.T.'],
    slot: ['post', 'posts', 'none'],
    bowl: 'maybe',
    cupJitter: 0.2,
  },
  {
    id: 'island',
    name: 'the island',
    par: 2,
    tier: 'mid',
    rows: ['.C.', '###', '#.#', '#.#', '###', '.T.'],
    bowl: 'maybe',
    cupJitter: 0.15,
  },
  {
    id: 'zigzag',
    name: 'the zigzag',
    par: 3,
    tier: 'mid',
    rows: ['C#.', '.#.', '.##', '..#', '.##', '.T.'],
    cupJitter: 0.12,
  },
  {
    id: 'terrace',
    name: 'the terrace',
    par: 2,
    tier: 'mid',
    rows: ['##C', '#..', '^..', '#..', 'T..'],
    bowl: 'maybe',
    cupJitter: 0.12,
  },
  {
    id: 'dunes',
    name: 'the dunes',
    par: 2,
    tier: 'mid',
    rows: ['#C', '##', '##', '##', '##', 'T#'],
    mounds: [
      { col: 0, row: 2, dx: 0.5, dy: 0.2, r: 0.75, a: 0.1 },
      { col: 1, row: 4, dx: -0.2, dy: 0, r: 0.6, a: 0.07 },
    ],
    cupJitter: 0.15,
  },
  {
    id: 'bank',
    name: 'the bank',
    par: 2,
    tier: 'mid',
    rows: ['C#9', '..#', '..#', '..?', '..T'],
    slot: ['none', 'mound'],
    bowl: 'maybe',
    cupJitter: 0.12,
  },
  {
    id: 'bowl',
    name: 'the bowl',
    par: 2,
    tier: 'mid',
    rows: ['.C.', '###', '###', '.#.', '.T.'],
    mounds: [
      { col: 1, row: 1, dx: 0, dy: 0.5, r: 1.05, a: -0.07 },
      { col: 0, row: 2, dx: 0, dy: 0, r: 0.5, a: 0.06 },
      { col: 2, row: 2, dx: 0, dy: 0, r: 0.5, a: 0.06 },
    ],
    cupJitter: 0.1,
  },
  // ── Features: one windmill and one loop every day ──
  {
    id: 'windmill',
    name: 'the windmill',
    par: 3,
    tier: 'feature',
    rows: ['C', '#', 'W', '#', '#', 'T'],
    millPeriodMs: 5200,
    bowl: 'maybe',
    cupJitter: 0.15,
  },
  {
    id: 'mill-turn',
    name: 'the mill race',
    par: 2,
    tier: 'feature',
    rows: ['C#9', '..#', '..W', '..#', '..T'],
    millPeriodMs: 4400,
    cupJitter: 0.12,
  },
  {
    id: 'loop',
    name: 'the loop',
    par: 3,
    tier: 'feature',
    rows: ['...C', '...^', 'T#L3'],
    bowl: true,
    cupJitter: 0.12,
  },
  {
    id: 'loop-ramp',
    name: 'the high loop',
    par: 2,
    tier: 'feature',
    rows: ['7L>C', '#...', '#...', 'T...'],
    bowl: true,
    cupJitter: 0.1,
  },
];

// ---------------------------------------------------------------------------
// Building a hole from a template
// ---------------------------------------------------------------------------

export const MG_CHAMFER = 0.28;
const CHAMFER = MG_CHAMFER;
/** Windmill: building depth and tunnel half width. */
const MILL_DEPTH = 0.46;
const MILL_HALF_GAP = 0.17;
const MILL_CLOSED = 0.36;
/** Loop: radius, channel half width, and how far it carries the ball. */
const LOOP_R = 0.22;
const LOOP_HALF_W = 0.15;
const LOOP_ADVANCE = 0.12;
const POST_R = 0.1;

export interface MgBuildOptions {
  mirror: boolean;
  slot: MgSlot;
  bowl: boolean;
  millPhase: number;
  cupDx: number;
  cupDy: number;
  teeDx: number;
}

type Grid = { cols: number; rows: number; ch: (c: number, r: number) => string };

function mirrorDir(d: MgDir, mirror: boolean): MgDir {
  if (!mirror) return d;
  return d === 'e' ? 'w' : d === 'w' ? 'e' : d;
}

/** Build one hole. Rows in the template are north first; cell row 0 is the
 *  south (tee) end. */
export function mgBuildHole(t: MgTemplate, o: MgBuildOptions): MgHole {
  const rowsN = t.rows.length;
  const cols = Math.max(...t.rows.map((r) => r.length));
  const grid: Grid = {
    cols,
    rows: rowsN,
    ch: (c, r) => {
      if (c < 0 || r < 0 || c >= cols || r >= rowsN) return '.';
      const line = t.rows[rowsN - 1 - r];
      const cc = o.mirror ? cols - 1 - c : c;
      return line[cc] ?? '.';
    },
  };
  const open = (c: number, r: number) => grid.ch(c, r) !== '.';

  const cellAt = new Int16Array(cols * rowsN).fill(-1);
  const cells: MgCell[] = [];
  for (let r = 0; r < rowsN; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (!open(c, r)) continue;
      const ch = grid.ch(c, r);
      const ramp: MgDir | null =
        ch === '^' ? 'n' : ch === 'v' ? 's' : ch === '>' ? mirrorDir('e', o.mirror) : ch === '<' ? mirrorDir('w', o.mirror) : null;
      cellAt[r * cols + c] = cells.length;
      const bankOf: Record<string, MgCell['bank']> = o.mirror
        ? { '7': 'ne', '9': 'nw', '1': 'se', '3': 'sw' }
        : { '7': 'nw', '9': 'ne', '1': 'sw', '3': 'se' };
      const bank = bankOf[ch];
      cells.push(bank ? { col: c, row: r, level: 0, ramp, bank } : { col: c, row: r, level: 0, ramp });
    }
  }

  // Levels: flood from the tee so every shared edge meets at one height.
  // A ramp's low edge is its level; its high edge is level + 1.
  const edgeLevel = (cell: MgCell, side: MgDir): number => {
    if (!cell.ramp) return cell.level;
    if (cell.ramp === side) return cell.level + 1;
    const opposite: Record<MgDir, MgDir> = { n: 's', s: 'n', e: 'w', w: 'e' };
    if (opposite[cell.ramp] === side) return cell.level;
    return Number.NaN; // a ramp's side: never shared
  };
  const opposite: Record<MgDir, MgDir> = { n: 's', s: 'n', e: 'w', w: 'e' };
  const step: Record<MgDir, [number, number]> = { n: [0, 1], s: [0, -1], e: [1, 0], w: [-1, 0] };
  let teeCell: MgCell | null = null;
  let cupCell: MgCell | null = null;
  for (const cell of cells) {
    const ch = grid.ch(cell.col, cell.row);
    if (ch === 'T') teeCell = cell;
    if (ch === 'C') cupCell = cell;
  }
  if (!teeCell || !cupCell) throw new Error(`template ${t.id} needs a tee and a cup`);
  const seen = new Set<MgCell>([teeCell]);
  const queue: MgCell[] = [teeCell];
  const dist = new Map<MgCell, number>([[teeCell, 0]]);
  while (queue.length) {
    const cell = queue.shift()!;
    for (const side of ['n', 's', 'e', 'w'] as MgDir[]) {
      const [dc, dr] = step[side];
      const ni = cellAt[(cell.row + dr) * cols + (cell.col + dc)];
      if (cell.col + dc < 0 || cell.col + dc >= cols || cell.row + dr < 0 || cell.row + dr >= rowsN || ni < 0) continue;
      const next = cells[ni];
      if (seen.has(next)) continue;
      const here = edgeLevel(cell, side);
      if (Number.isNaN(here)) continue;
      // next's level so that its edge on our side matches `here`.
      const back = opposite[side];
      if (!next.ramp) next.level = here;
      else if (next.ramp === back) next.level = here - 1;
      else next.level = here;
      seen.add(next);
      dist.set(next, (dist.get(cell) ?? 0) + 1);
      queue.push(next);
    }
  }

  // Rails: every edge whose neighbour is off the course, with outer
  // corners cut.
  const walls: MgSeg[] = [];
  const raw: MgSeg[] = [];
  for (const cell of cells) {
    const x0 = cell.col * MG_CELL;
    const y0 = cell.row * MG_CELL;
    const x1 = x0 + MG_CELL;
    const y1 = y0 + MG_CELL;
    const n = !open(cell.col, cell.row + 1);
    const s = !open(cell.col, cell.row - 1);
    const e = !open(cell.col + 1, cell.row);
    const w = !open(cell.col - 1, cell.row);
    // A corner is cut when both its edges are rails, and the diagonal cell
    // is off the course too.
    const cutNW = n && w;
    const cutNE = n && e;
    const cutSW = s && w;
    const cutSE = s && e;
    // A bank cuts its corner across the whole cell.
    const size = (corner: MgCell['bank']) => (cell.bank === corner ? MG_CELL : CHAMFER);
    const cNW = cutNW ? size('nw') : 0;
    const cNE = cutNE ? size('ne') : 0;
    const cSW = cutSW ? size('sw') : 0;
    const cSE = cutSE ? size('se') : 0;
    const push = (seg: MgSeg) => {
      if (Math.abs(seg.x2 - seg.x1) + Math.abs(seg.y2 - seg.y1) > 1e-9) raw.push(seg);
    };
    if (n) push({ x1: x0 + cNW, y1, x2: x1 - cNE, y2: y1, kind: 'rail' });
    if (s) push({ x1: x0 + cSW, y1: y0, x2: x1 - cSE, y2: y0, kind: 'rail' });
    if (w) push({ x1: x0, y1: y0 + cSW, x2: x0, y2: y1 - cNW, kind: 'rail' });
    if (e) push({ x1, y1: y0 + cSE, x2: x1, y2: y1 - cNE, kind: 'rail' });
    if (cutNW) push({ x1: x0, y1: y1 - cNW, x2: x0 + cNW, y2: y1, kind: 'rail' });
    if (cutNE) push({ x1: x1 - cNE, y1, x2: x1, y2: y1 - cNE, kind: 'rail' });
    if (cutSW) push({ x1: x0, y1: y0 + cSW, x2: x0 + cSW, y2: y0, kind: 'rail' });
    if (cutSE) push({ x1: x1 - cSE, y1: y0, x2: x1, y2: y0 + cSE, kind: 'rail' });
  }
  walls.push(...mergeCollinear(raw));

  const posts: MgPost[] = [];
  const mounds: MgMound[] = [];
  const windmills: MgWindmill[] = [];
  const loops: MgLoop[] = [];
  for (const cell of cells) {
    const ch = grid.ch(cell.col, cell.row);
    const cx = (cell.col + 0.5) * MG_CELL;
    const cy = (cell.row + 0.5) * MG_CELL;
    const x0 = cell.col * MG_CELL;
    const x1 = x0 + MG_CELL;
    if (ch === 'o') posts.push({ x: cx, y: cy, r: POST_R });
    if (ch === 'm') mounds.push({ x: cx, y: cy, r: 0.42, a: 0.07 });
    if (ch === '?') {
      if (o.slot === 'post') posts.push({ x: cx, y: cy, r: POST_R });
      else if (o.slot === 'mound') mounds.push({ x: cx, y: cy, r: 0.45, a: 0.075 });
      else if (o.slot === 'posts') {
        posts.push({ x: cx - 0.24, y: cy, r: POST_R * 0.8 });
        posts.push({ x: cx + 0.24, y: cy, r: POST_R * 0.8 });
      }
    }
    if (ch === 'W') {
      const gateY = cy - MILL_DEPTH / 2;
      const backY = cy + MILL_DEPTH / 2;
      const g = MILL_HALF_GAP;
      walls.push(
        { x1: x0, y1: gateY, x2: cx - g, y2: gateY, kind: 'mill' },
        { x1: cx + g, y1: gateY, x2: x1, y2: gateY, kind: 'mill' },
        { x1: x0, y1: backY, x2: cx - g, y2: backY, kind: 'mill' },
        { x1: cx + g, y1: backY, x2: x1, y2: backY, kind: 'mill' },
        { x1: cx - g, y1: gateY, x2: cx - g, y2: backY, kind: 'mill' },
        { x1: cx + g, y1: gateY, x2: cx + g, y2: backY, kind: 'mill' },
      );
      windmills.push({
        x: cx,
        gateY,
        backY,
        halfGap: g,
        halfWidth: MG_CELL / 2,
        periodMs: t.millPeriodMs ?? 5000,
        phase: o.millPhase,
        closed: MILL_CLOSED,
      });
    }
    if (ch === 'L') {
      // The loop runs from the neighbour nearer the tee to the one beyond.
      let ux = 0;
      let uy = 1;
      let best = Infinity;
      for (const side of ['n', 's', 'e', 'w'] as MgDir[]) {
        const [dc, dr] = step[side];
        const ni = open(cell.col + dc, cell.row + dr) ? cellAt[(cell.row + dr) * cols + (cell.col + dc)] : -1;
        if (ni < 0) continue;
        const d = dist.get(cells[ni]) ?? Infinity;
        if (d < best) {
          best = d;
          ux = -dc;
          uy = -dr;
        }
      }
      // l is the lateral axis.
      const lx = uy;
      const ly = -ux;
      const at = (u: number, l: number) => ({ x: cx + ux * u + lx * l, y: cy + uy * u + ly * l });
      const entryU = -LOOP_R * 0.25;
      const chanLo = entryU - LOOP_R - 0.04;
      const chanHi = entryU + LOOP_ADVANCE + LOOP_R + 0.04;
      const hw = LOOP_HALF_W;
      const seg = (a: { x: number; y: number }, b: { x: number; y: number }): MgSeg => ({
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        kind: 'tube',
      });
      for (const side of [-1, 1]) {
        walls.push(
          seg(at(-0.48, side * 0.5), at(chanLo, side * hw)),
          seg(at(chanLo, side * hw), at(chanHi, side * hw)),
          seg(at(chanHi, side * hw), at(0.48, side * 0.5)),
        );
      }
      const entry = at(entryU, 0);
      loops.push({
        x: entry.x,
        y: entry.y,
        ux,
        uy,
        advance: LOOP_ADVANCE,
        halfW: hw - MG_BALL_R * 0.4,
        radius: LOOP_R,
      });
    }
  }
  for (const m of t.mounds ?? []) {
    const col = o.mirror ? cols - 1 - m.col : m.col;
    const row = rowsN - 1 - m.row;
    const dx = (m.dx ?? 0) * (o.mirror ? -1 : 1);
    mounds.push({ x: (col + 0.5) * MG_CELL + dx, y: (row + 0.5) * MG_CELL + (m.dy ?? 0), r: m.r, a: m.a });
  }

  const cup = {
    x: (cupCell.col + 0.5) * MG_CELL + o.cupDx,
    y: (cupCell.row + 0.5) * MG_CELL + o.cupDy,
  };
  if (o.bowl) mounds.push({ x: cup.x, y: cup.y, r: 0.42, a: -0.035 });
  const tee = { x: (teeCell.col + 0.5) * MG_CELL + o.teeDx, y: (teeCell.row + 0.5) * MG_CELL - 0.1 };

  return {
    name: t.name,
    par: t.par,
    cols,
    rows: rowsN,
    cellAt,
    cells,
    tee,
    cup,
    walls,
    posts,
    mounds,
    windmills,
    loops,
  };
}

/** Join rail segments that continue one another on the same line. */
function mergeCollinear(segs: MgSeg[]): MgSeg[] {
  const out: MgSeg[] = [];
  const used = new Array(segs.length).fill(false);
  const key = (x: number, y: number) => `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
  for (let i = 0; i < segs.length; i += 1) {
    if (used[i]) continue;
    used[i] = true;
    const s = { ...segs[i] };
    let grew = true;
    while (grew) {
      grew = false;
      for (let j = 0; j < segs.length; j += 1) {
        if (used[j]) continue;
        const o = segs[j];
        const horiz = s.y1 === s.y2 && o.y1 === o.y2 && s.y1 === o.y1;
        const vert = s.x1 === s.x2 && o.x1 === o.x2 && s.x1 === o.x1;
        if (!horiz && !vert) continue;
        if (key(o.x1, o.y1) === key(s.x2, s.y2)) {
          s.x2 = o.x2;
          s.y2 = o.y2;
        } else if (key(o.x2, o.y2) === key(s.x1, s.y1)) {
          s.x1 = o.x1;
          s.y1 = o.y1;
        } else continue;
        used[j] = true;
        grew = true;
      }
    }
    out.push(s);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The day's course
// ---------------------------------------------------------------------------

export interface MgCourseHole {
  templateId: string;
  options: MgBuildOptions;
  hole: MgHole;
}

export interface MgCourse {
  dateKey: string;
  seed: number;
  holes: MgCourseHole[];
  par: number;
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Options for one hole from the seed. */
export function mgRollOptions(t: MgTemplate, rng: () => number): MgBuildOptions {
  const jitter = t.cupJitter ?? 0.12;
  const mirror = rng() < 0.5;
  const slots = t.slot ?? ['none'];
  const slot = slots[Math.floor(rng() * slots.length)] ?? 'none';
  const bowl = t.bowl === 'maybe' ? rng() < 0.5 : Boolean(t.bowl);
  const millPhase = rng();
  const cupDx = (rng() * 2 - 1) * jitter;
  const cupDy = (rng() * 2 - 1) * jitter;
  const teeDx = (rng() * 2 - 1) * 0.15;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return { mirror, slot, bowl, millPhase: r3(millPhase), cupDx: r3(cupDx), cupDy: r3(cupDy), teeDx: r3(teeDx) };
}

/**
 * The course for a UTC date: two easy holes to open, then five from the
 * middle of the box with one windmill and one loop among them, in a seeded
 * order, and the last two from what's left. No template twice.
 */
export function mgCourseFor(dateKey: string): MgCourse {
  const seed = mgDateSeed(dateKey);
  const rng = mulberry32(seed);
  const byTier = (tier: MgTemplate['tier']) => MG_TEMPLATES.filter((t) => t.tier === tier);
  const easy = shuffle(byTier('easy'), rng);
  const mid = shuffle(byTier('mid'), rng);
  const mills = shuffle(MG_TEMPLATES.filter((t) => t.id.startsWith('mill') || t.id === 'windmill'), rng);
  const loops = shuffle(MG_TEMPLATES.filter((t) => t.id.startsWith('loop')), rng);

  const opening = easy.slice(0, 2);
  const middle = shuffle([mills[0], loops[0], ...mid.slice(0, 3)], rng);
  const rest = shuffle([...easy.slice(2), ...mid.slice(3)], rng).slice(0, MG_HOLES - opening.length - middle.length);
  const picked = [...opening, ...middle, ...rest];

  const holes = picked.map((t) => {
    const options = mgRollOptions(t, rng);
    return { templateId: t.id, options, hole: mgBuildHole(t, options) };
  });
  return { dateKey, seed, holes, par: holes.reduce((sum, h) => sum + h.hole.par, 0) };
}

/** Every template by id. */
export function mgTemplate(id: string): MgTemplate | null {
  return MG_TEMPLATES.find((t) => t.id === id) ?? null;
}

/** Keep the cup clear of rails for the checks. */
export const MG_CUP_CLEAR = MG_CUP_R + 0.12;
