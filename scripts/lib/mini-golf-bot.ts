/**
 * Mini golf simulated players, for tuning, par and the verifier.
 *
 * A player looks at the hole the way a person does: it knows how far the
 * cup is by the shortest way round the rails (a distance field over the
 * felt), tries a fan of putts in its head (the real engine, so slopes,
 * banks, the windmill and the loop are all accounted for), prefers putts
 * that still come off when it mishits a little, then hits the one it chose
 * with its own error in direction, pace and, at the windmill, timing.
 */

import {
  MG_BALL_R,
  MG_CELL,
  MG_MAX_STROKES,
  MG_PICKUP_SCORE,
  MG_STEP_MS,
  mgCellAt,
  mgQuantizePutt,
  mgSimulatePutt,
  type MgHole,
  type MgPutt,
} from '../../src/server/arcade/mini-golf-engine';

export type Skill = {
  name: string;
  /** Direction error, degrees (one standard deviation). */
  aimDeg: number;
  /** Pace error, a share of the putt's power. */
  pace: number;
  /** Timing error at the windmill, ms. */
  timingMs: number;
  /** How hard it looks: angles and powers in its first pass. */
  angles: number;
  powers: number;
};

export const SKILLS: Skill[] = [
  { name: 'first go', aimDeg: 8, pace: 0.25, timingMs: 250, angles: 32, powers: 8 },
  { name: 'casual', aimDeg: 5, pace: 0.16, timingMs: 160, angles: 40, powers: 9 },
  { name: 'good', aimDeg: 3, pace: 0.1, timingMs: 90, angles: 48, powers: 10 },
  { name: 'sharp', aimDeg: 1.8, pace: 0.06, timingMs: 50, angles: 64, powers: 12 },
];

export function rngFrom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gauss(rng: () => number): number {
  const u = Math.max(1e-12, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ── Distance to the cup by the shortest way round, on a 5 cm grid ──

const RES = 0.05;

export type DistanceField = {
  w: number;
  h: number;
  d: Float64Array;
  at(x: number, y: number): number;
};

function distToSeg(px: number, py: number, s: { x1: number; y1: number; x2: number; y2: number }): number {
  const ex = s.x2 - s.x1;
  const ey = s.y2 - s.y1;
  const l2 = ex * ex + ey * ey;
  let u = l2 > 0 ? ((px - s.x1) * ex + (py - s.y1) * ey) / l2 : 0;
  u = Math.max(0, Math.min(1, u));
  return Math.hypot(px - (s.x1 + ex * u), py - (s.y1 + ey * u));
}

export function distanceField(hole: MgHole): DistanceField {
  const w = Math.ceil((hole.cols * MG_CELL) / RES);
  const h = Math.ceil((hole.rows * MG_CELL) / RES);
  const ok = new Uint8Array(w * h);
  for (let j = 0; j < h; j += 1) {
    for (let i = 0; i < w; i += 1) {
      const x = (i + 0.5) * RES;
      const y = (j + 0.5) * RES;
      if (!mgCellAt(hole, x, y)) continue;
      let clear = true;
      for (const s of hole.walls) {
        if (distToSeg(x, y, s) < MG_BALL_R * 0.9) {
          clear = false;
          break;
        }
      }
      if (clear) for (const p of hole.posts) if (Math.hypot(x - p.x, y - p.y) < p.r + MG_BALL_R * 0.9) clear = false;
      ok[j * w + i] = clear ? 1 : 0;
    }
  }
  // Windmill buildings and loop channels are walls already; walk round
  // them (a loop's channel is open, so the field passes through it).
  const d = new Float64Array(w * h).fill(Infinity);
  const ci = Math.min(w - 1, Math.max(0, Math.floor(hole.cup.x / RES)));
  const cj = Math.min(h - 1, Math.max(0, Math.floor(hole.cup.y / RES)));
  // Dijkstra on an 8-connected grid (small, so a simple bucket queue).
  const heap: Array<[number, number]> = [[0, cj * w + ci]];
  d[cj * w + ci] = 0;
  const push = (item: [number, number]) => {
    heap.push(item);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  const nbrs: Array<[number, number, number]> = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
  ];
  while (heap.length) {
    const [dist, idx] = pop();
    if (dist > d[idx]) continue;
    const i = idx % w;
    const j = (idx - i) / w;
    for (const [di, dj, c] of nbrs) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
      const nidx = nj * w + ni;
      if (!ok[nidx] && nidx !== cj * w + ci) continue;
      const nd = dist + c * RES;
      if (nd < d[nidx]) {
        d[nidx] = nd;
        push([nd, nidx]);
      }
    }
  }
  return {
    w,
    h,
    d,
    at(x, y) {
      const i = Math.min(w - 1, Math.max(0, Math.floor(x / RES)));
      const j = Math.min(h - 1, Math.max(0, Math.floor(y / RES)));
      let best = d[j * w + i];
      if (!Number.isFinite(best)) {
        // Hard against a rail: the nearest open cell.
        for (let r = 1; r < 4 && !Number.isFinite(best); r += 1) {
          for (let dj = -r; dj <= r; dj += 1) {
            for (let di = -r; di <= r; di += 1) {
              const ni = i + di;
              const nj = j + dj;
              if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
              const v = d[nj * w + ni] + Math.hypot(di, dj) * RES;
              if (v < best) best = v;
            }
          }
        }
      }
      return best;
    },
  };
}

/** Expected strokes left from a resting point, for a player of this skill:
 *  a smooth guess from distance, so the planner prefers leaving it close. */
function leaveCost(dist: number): number {
  if (!Number.isFinite(dist)) return 4;
  // About one more putt inside 0.5 m, two by 3 m, rising slowly past it.
  return 1 + Math.min(2.5, dist * 0.32 + (dist > 0.5 ? 0.25 : dist * 0.5));
}

type Candidate = { angle: number; power: number; t: number; cost: number };

function evaluate(
  hole: MgHole,
  field: DistanceField,
  from: { x: number; y: number },
  angle: number,
  power: number,
  t: number,
): number {
  const putt = mgQuantizePutt({ t, dx: Math.cos(angle), dy: Math.sin(angle), power });
  const r = mgSimulatePutt(hole, from, putt.dx, putt.dy, putt.power, putt.t);
  if (!r) return 9;
  if (r.holed) return 0;
  return leaveCost(field.at(r.x, r.y));
}

/** The putt this player chooses from here (before its own error). */
export function choosePutt(
  hole: MgHole,
  field: DistanceField,
  from: { x: number; y: number },
  readyAt: number,
  skill: Skill,
): { angle: number; power: number; t: number } {
  const times: number[] = [readyAt];
  if (hole.windmills.length) {
    const period = hole.windmills[0].periodMs / 4;
    for (let k = 1; k < 10; k += 1) times.push(readyAt + Math.round((period * k) / 10));
  }
  const first: Candidate[] = [];
  for (const t of times) {
    for (let a = 0; a < skill.angles; a += 1) {
      const angle = (a / skill.angles) * Math.PI * 2;
      for (let p = 1; p <= skill.powers; p += 1) {
        const power = Math.pow(p / skill.powers, 1.3);
        first.push({ angle, power, t, cost: evaluate(hole, field, from, angle, power, t) });
      }
    }
  }
  first.sort((a, b) => a.cost - b.cost);
  const da = (Math.PI * 2) / skill.angles;
  const sa = (skill.aimDeg * Math.PI) / 180;
  let best: Candidate | null = null;
  // Refine the best few, scoring each by how it holds up to the player's
  // own mishits.
  const seenKeys = new Set<string>();
  for (const c of first.slice(0, 4)) {
    for (let i = -1; i <= 1; i += 1) {
      for (let j = -1; j <= 1; j += 1) {
        const angle = c.angle + (i * da) / 3;
        const power = Math.min(1, Math.max(0.02, c.power * (1 + j * 0.06)));
        const key = `${angle.toFixed(4)}|${power.toFixed(3)}|${c.t}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        const samples: Array<[number, number, number]> = [
          [0, 0, 0],
          [sa, 0, 0],
          [-sa, 0, 0],
          [0, skill.pace, 0],
          [0, -skill.pace, 0],
        ];
        if (hole.windmills.length) samples.push([0, 0, skill.timingMs], [0, 0, -skill.timingMs]);
        let cost = 0;
        for (const [ea, ep, et] of samples) {
          cost += evaluate(
            hole,
            field,
            from,
            angle + ea,
            Math.min(1, Math.max(0.02, power * (1 + ep))),
            Math.max(c.t, readyAt) + et,
          );
        }
        cost /= samples.length;
        if (!best || cost < best.cost) best = { angle, power, t: c.t, cost };
      }
    }
  }
  return best ?? { angle: Math.PI / 2, power: 0.5, t: readyAt };
}

export type HolePlay = { score: number; strokes: number; holed: boolean; putts: MgPutt[] };

/** Play one hole start to finish with a skill's error. */
export function playHole(hole: MgHole, skill: Skill, rng: () => number, field = distanceField(hole)): HolePlay {
  let from = { x: hole.tee.x, y: hole.tee.y };
  let readyAt = 900 + Math.round(rng() * 600);
  const putts: MgPutt[] = [];
  for (let stroke = 1; stroke <= MG_MAX_STROKES; stroke += 1) {
    const choice = choosePutt(hole, field, from, readyAt, skill);
    const angle = choice.angle + gauss(rng) * ((skill.aimDeg * Math.PI) / 180);
    const power = Math.min(1, Math.max(0.02, choice.power * (1 + gauss(rng) * skill.pace)));
    const t = Math.max(readyAt, Math.round(choice.t + (hole.windmills.length ? gauss(rng) * skill.timingMs : 0)));
    const putt = mgQuantizePutt({ t, dx: Math.cos(angle), dy: Math.sin(angle), power });
    putts.push(putt);
    const r = mgSimulatePutt(hole, from, putt.dx, putt.dy, putt.power, putt.t)!;
    if (r.holed) return { score: stroke, strokes: stroke, holed: true, putts };
    from = { x: r.x, y: r.y };
    readyAt = putt.t + Math.ceil(r.durationMs) + 400 + Math.round(rng() * 900);
  }
  return { score: MG_PICKUP_SCORE, strokes: MG_MAX_STROKES, holed: false, putts };
}

export { MG_STEP_MS };
