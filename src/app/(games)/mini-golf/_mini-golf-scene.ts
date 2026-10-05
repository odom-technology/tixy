/* Mini golf: the scene for one hole, built from the engine's own geometry,
   so the rails drawn are the rails the ball hits and the felt's shape is
   the surface it rolls on.

   World axes: three.x is the engine's x (across), three.y is height, and
   three.z is minus the engine's y, so the camera stands south of the tee
   (at +z) and looks north up the hole. */

import * as THREE from 'three';

import {
  MG_BALL_R,
  MG_CELL,
  MG_CUP_R,
  mgCellAt,
  mgSurface,
  type MgHole,
  type MgLoop,
  type MgWindmill,
} from '@/server/arcade/mini-golf-engine';
import { MG_CHAMFER } from '@/server/arcade/mini-golf-course';
import { MIDWAY_PALETTE, makeMidwayMaterial } from '@/features/arcade/lib/midway-three';

/** The deck the course stands on, below level 0's felt. */
export const DECK_Y = -0.16;
/** The deck plane's side, metres; its planks repeat every DECK_TILE. */
export const DECK_SIZE = 40;
export const DECK_TILE = 1.6;
/** Rails stand this far above the felt beside them. */
const RAIL_H = 0.09;
const RAIL_T = 2 * MG_BALL_R;

export type MgLook = {
  felt: string;
  feltHi: string;
  rail: string;
  railTop: string;
  deck: string;
  ball: string;
  ballMark: string;
  flag: string;
  mill: string;
  millTrim: string;
  post: string;
  sky: string;
};

export const HOUSE_LOOK: MgLook = {
  felt: '#2f7d57',
  feltHi: '#3a8c63',
  rail: MIDWAY_PALETTE.wood,
  railTop: '#e8dcc4',
  deck: '#4a3524',
  ball: '#f7f1e6',
  ballMark: MIDWAY_PALETTE.red,
  flag: MIDWAY_PALETTE.red,
  mill: MIDWAY_PALETTE.red,
  millTrim: MIDWAY_PALETTE.paper,
  post: MIDWAY_PALETTE.ink,
  sky: MIDWAY_PALETTE.nightBottom,
};

export type MgMaterials = {
  felt: THREE.MeshStandardMaterial;
  rail: THREE.MeshStandardMaterial;
  railTop: THREE.MeshStandardMaterial;
  deck: THREE.MeshBasicMaterial;
  cup: THREE.MeshBasicMaterial;
  cupRim: THREE.MeshStandardMaterial;
  ball: THREE.MeshStandardMaterial;
  flag: THREE.MeshStandardMaterial;
  pole: THREE.MeshStandardMaterial;
  mill: THREE.MeshStandardMaterial;
  millWall: THREE.MeshStandardMaterial;
  millTrim: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  post: THREE.MeshStandardMaterial;
  tee: THREE.MeshStandardMaterial;
  loopTrack: THREE.MeshStandardMaterial;
  shadow: THREE.MeshBasicMaterial;
  aim: THREE.MeshBasicMaterial;
  ring: THREE.MeshBasicMaterial;
  ringTrack: THREE.MeshBasicMaterial;
};

export function makeMgMaterials(look: MgLook, shadowTex: THREE.Texture, blank: THREE.Texture): MgMaterials {
  return {
    // Felt carries a placeholder map from the start, so a skin's material
    // picture is a texture swap, not a shader recompile.
    felt: new THREE.MeshStandardMaterial({ color: look.felt, roughness: 0.94, metalness: 0, map: blank }),
    rail: new THREE.MeshStandardMaterial({ color: look.rail, roughness: 0.62, metalness: 0, map: blank }),
    railTop: new THREE.MeshStandardMaterial({ color: look.railTop, roughness: 0.55, metalness: 0 }),
    deck: new THREE.MeshBasicMaterial({ color: look.deck, map: blank }),
    cup: new THREE.MeshBasicMaterial({ color: '#0b0806', side: THREE.DoubleSide }),
    cupRim: new THREE.MeshStandardMaterial({ color: '#f1e8d6', roughness: 0.4, metalness: 0.1 }),
    ball: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.32, metalness: 0, map: blank }),
    flag: new THREE.MeshStandardMaterial({ color: look.flag, roughness: 0.6, side: THREE.DoubleSide }),
    pole: new THREE.MeshStandardMaterial({ color: MIDWAY_PALETTE.paper, roughness: 0.45 }),
    mill: new THREE.MeshStandardMaterial({ color: look.mill, roughness: 0.5 }),
    millWall: new THREE.MeshStandardMaterial({ color: MIDWAY_PALETTE.paper2, roughness: 0.7, side: THREE.DoubleSide }),
    millTrim: new THREE.MeshStandardMaterial({ color: look.millTrim, roughness: 0.6, side: THREE.DoubleSide }),
    roof: new THREE.MeshStandardMaterial({ color: MIDWAY_PALETTE.ink, roughness: 0.6 }),
    brass: makeMidwayMaterial('brass'),
    post: new THREE.MeshStandardMaterial({ color: look.post, roughness: 0.5 }),
    tee: new THREE.MeshStandardMaterial({ color: MIDWAY_PALETTE.paper2, roughness: 0.8 }),
    loopTrack: new THREE.MeshStandardMaterial({ color: look.mill, roughness: 0.5, side: THREE.DoubleSide }),
    shadow: new THREE.MeshBasicMaterial({
      color: '#000000',
      map: shadowTex,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    }),
    aim: new THREE.MeshBasicMaterial({ color: MIDWAY_PALETTE.paper, transparent: true, depthWrite: false, toneMapped: false }),
    ring: new THREE.MeshBasicMaterial({
      color: MIDWAY_PALETTE.ticket,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
    ringTrack: new THREE.MeshBasicMaterial({
      color: MIDWAY_PALETTE.ink,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  };
}

const SURF = { h: 0, gx: 0, gy: 0 };

/** Engine (x, y) at height h to a world point. */
export function toWorld(x: number, y: number, h: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(x, h, -y);
}

/** The felt's height at a point. */
export function feltHeight(hole: MgHole, x: number, y: number): number {
  mgSurface(hole, x, y, SURF);
  return SURF.h;
}

type Cut = { cx: number; cy: number; sx: number; sy: number; size: number };

/** A cell's cut corners, by the course builder's rule: both edges at the
 *  corner are rails. sx and sy point from the corner into the cell. */
function cellCuts(hole: MgHole, col: number, row: number): Cut[] {
  const open = (c: number, r: number) => Boolean(mgCellAt(hole, (c + 0.5) * MG_CELL, (r + 0.5) * MG_CELL));
  const n = !open(col, row + 1);
  const s = !open(col, row - 1);
  const e = !open(col + 1, row);
  const w = !open(col - 1, row);
  const x0 = col * MG_CELL;
  const y0 = row * MG_CELL;
  const bank = mgCellAt(hole, (col + 0.5) * MG_CELL, (row + 0.5) * MG_CELL)?.bank;
  const size = (corner: string) => (bank === corner ? MG_CELL : MG_CHAMFER);
  const cuts: Cut[] = [];
  if (n && w) cuts.push({ cx: x0, cy: y0 + MG_CELL, sx: 1, sy: -1, size: size('nw') });
  if (n && e) cuts.push({ cx: x0 + MG_CELL, cy: y0 + MG_CELL, sx: -1, sy: -1, size: size('ne') });
  if (s && w) cuts.push({ cx: x0, cy: y0, sx: 1, sy: 1, size: size('sw') });
  if (s && e) cuts.push({ cx: x0 + MG_CELL, cy: y0, sx: -1, sy: 1, size: size('se') });
  return cuts;
}

/** Move a point that lies outside a cut corner onto the cut. */
function clipToCuts(cuts: Cut[], p: { x: number; y: number }): void {
  for (const c of cuts) {
    const dx = (p.x - c.cx) * c.sx;
    const dy = (p.y - c.cy) * c.sy;
    const inside = dx + dy - c.size;
    if (inside < 0) {
      p.x += (c.sx * -inside) / 2;
      p.y += (c.sy * -inside) / 2;
    }
  }
}

const CLIP = { x: 0, y: 0 };

/** Push one vertex with its normal from the surface's gradient. */
function pushSurfaceVertex(hole: MgHole, x: number, y: number, pos: number[], nor: number[], uv: number[], cuts?: Cut[]) {
  if (cuts && cuts.length) {
    CLIP.x = x;
    CLIP.y = y;
    clipToCuts(cuts, CLIP);
    x = CLIP.x;
    y = CLIP.y;
  }
  mgSurface(hole, x, y, SURF);
  pos.push(x, SURF.h, -y);
  // n = (-dh/dx, 1, -dh/dz), and z = -y so dh/dz = -gy.
  const nx = -SURF.gx;
  const nz = SURF.gy;
  const l = Math.sqrt(nx * nx + 1 + nz * nz);
  nor.push(nx / l, 1 / l, nz / l);
  uv.push(x, y);
}

/** The felt: a fine grid per cell, and a ring round the cup with a hole. */
function buildFelt(hole: MgHole): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const cupCol = Math.floor(hole.cup.x / MG_CELL);
  const cupRow = Math.floor(hole.cup.y / MG_CELL);
  for (const cell of hole.cells) {
    const x0 = cell.col * MG_CELL;
    const y0 = cell.row * MG_CELL;
    const cuts = cellCuts(hole, cell.col, cell.row);
    if (cell.col === cupCol && cell.row === cupRow) {
      // Polar around the cup: rings from the rim out to the cell's square.
      const segs = 40;
      const rings = 7;
      const base = pos.length / 3;
      for (let i = 0; i <= segs; i += 1) {
        const a = (i / segs) * Math.PI * 2;
        const dx = Math.cos(a);
        const dy = Math.sin(a);
        // Ray from the cup to the cell's edge.
        const tx = dx > 0 ? (x0 + MG_CELL - hole.cup.x) / dx : dx < 0 ? (x0 - hole.cup.x) / dx : Infinity;
        const ty = dy > 0 ? (y0 + MG_CELL - hole.cup.y) / dy : dy < 0 ? (y0 - hole.cup.y) / dy : Infinity;
        const edge = Math.min(tx, ty);
        for (let j = 0; j <= rings; j += 1) {
          const k = j / rings;
          // Denser near the rim, where the bowl curves most.
          const r = MG_CUP_R + (edge - MG_CUP_R) * k * k;
          pushSurfaceVertex(hole, hole.cup.x + dx * r, hole.cup.y + dy * r, pos, nor, uv, cuts);
        }
      }
      for (let i = 0; i < segs; i += 1) {
        for (let j = 0; j < rings; j += 1) {
          const a = base + i * (rings + 1) + j;
          const b = base + (i + 1) * (rings + 1) + j;
          idx.push(a, a + 1, b, b, a + 1, b + 1);
        }
      }
      continue;
    }
    const bumpy = hole.mounds.some(
      (m) => m.x + m.r > x0 && m.x - m.r < x0 + MG_CELL && m.y + m.r > y0 && m.y - m.r < y0 + MG_CELL,
    );
    const n = bumpy ? 18 : cuts.length ? 4 : 2;
    const base = pos.length / 3;
    for (let j = 0; j <= n; j += 1) {
      for (let i = 0; i <= n; i += 1) {
        pushSurfaceVertex(hole, x0 + (i / n) * MG_CELL, y0 + (j / n) * MG_CELL, pos, nor, uv, cuts);
      }
    }
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const a = base + j * (n + 1) + i;
        const b = a + n + 1;
        // Counter-clockwise seen from above (+y): x right, z toward -y.
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

/** The highest felt beside a point on a rail (either side on the course). */
function railBase(hole: MgHole, x: number, y: number, nx: number, ny: number): number {
  let h = -Infinity;
  for (const side of [1, -1]) {
    const px = x + nx * side * 0.07;
    const py = y + ny * side * 0.07;
    if (mgCellAt(hole, px, py)) h = Math.max(h, feltHeight(hole, px, py));
  }
  return Number.isFinite(h) ? h : feltHeight(hole, x, y);
}

/** Every rail as a box strip whose top follows the felt beside it. */
function buildRails(hole: MgHole): { body: THREE.BufferGeometry; top: THREE.BufferGeometry } {
  const bp: number[] = [];
  const bn: number[] = [];
  const buv: number[] = [];
  const tp: number[] = [];
  const tn: number[] = [];
  const quad = (
    out: number[],
    norm: number[],
    uvs: number[] | null,
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
  ) => {
    // a b c d counter-clockwise from outside.
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    for (const v of [a, b, c, a, c, d]) {
      out.push(v.x, v.y, v.z);
      norm.push(n.x, n.y, n.z);
    }
    if (uvs) {
      const len = a.distanceTo(b);
      const hgt = a.distanceTo(d);
      uvs.push(0, 0, len, 0, len, hgt, 0, 0, len, hgt, 0, hgt);
    }
  };
  for (const s of hole.walls) {
    if (s.kind === 'mill') continue;
    const ex = s.x2 - s.x1;
    const ey = s.y2 - s.y1;
    const len = Math.sqrt(ex * ex + ey * ey);
    if (len < 1e-6) continue;
    const ux = ex / len;
    const uy = ey / len;
    const nx = -uy;
    const ny = ux;
    const half = (s.kind === 'tube' ? 0.035 : RAIL_T / 2);
    const lift = s.kind === 'tube' ? 0.05 : RAIL_H;
    // Extend a little past each end so corners close.
    const ext = s.kind === 'tube' ? 0 : half;
    const steps = Math.max(1, Math.ceil(len / 0.25));
    for (let i = 0; i < steps; i += 1) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      const ax = s.x1 - ux * (i === 0 ? ext : 0) + ex * t0;
      const ay = s.y1 - uy * (i === 0 ? ext : 0) + ey * t0;
      const bx = s.x1 + ux * (i === steps - 1 ? ext : 0) + ex * t1;
      const by = s.y1 + uy * (i === steps - 1 ? ext : 0) + ey * t1;
      const ha = railBase(hole, s.x1 + ex * t0, s.y1 + ey * t0, nx, ny) + lift;
      const hb = railBase(hole, s.x1 + ex * t1, s.y1 + ey * t1, nx, ny) + lift;
      const w = (x: number, y: number, h: number) => toWorld(x, y, h);
      const aL = w(ax + nx * half, ay + ny * half, DECK_Y);
      const bL = w(bx + nx * half, by + ny * half, DECK_Y);
      const aLt = w(ax + nx * half, ay + ny * half, ha);
      const bLt = w(bx + nx * half, by + ny * half, hb);
      const aR = w(ax - nx * half, ay - ny * half, DECK_Y);
      const bR = w(bx - nx * half, by - ny * half, DECK_Y);
      const aRt = w(ax - nx * half, ay - ny * half, ha);
      const bRt = w(bx - nx * half, by - ny * half, hb);
      // The two faces, each wound to face outward.
      quad(bp, bn, buv, aR, bR, bRt, aRt);
      quad(bp, bn, buv, bL, aL, aLt, bLt);
      // The cap.
      quad(tp, tn, null, aRt, bRt, bLt, aLt);
      if (i === 0) quad(bp, bn, buv, aL, aR, aRt, aLt);
      if (i === steps - 1) quad(bp, bn, buv, bR, bL, bLt, bRt);
    }
  }
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
  body.setAttribute('normal', new THREE.Float32BufferAttribute(bn, 3));
  body.setAttribute('uv', new THREE.Float32BufferAttribute(buv, 2));
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
  top.setAttribute('normal', new THREE.Float32BufferAttribute(tn, 3));
  return { body, top };
}

export type MillRig = { mill: MgWindmill; sails: THREE.Group };
export type LoopRig = { loop: MgLoop; base: number };

export type HoleScene = {
  group: THREE.Group;
  mills: MillRig[];
  loops: LoopRig[];
  flag: THREE.Group;
  /** The felt's height at the cup's rim. */
  cupH: number;
  /** World-space box of the course, for the camera. */
  bounds: THREE.Box3;
};

/** The windmill: a red mill house with a tunnel through it, a pitched ink
 *  roof, a paper gable and four sails on a brass hub. */
function buildMill(hole: MgHole, mill: MgWindmill, mats: MgMaterials): { group: THREE.Group; sails: THREE.Group } {
  const g = new THREE.Group();
  const base = feltHeight(hole, mill.x, (mill.gateY + mill.backY) / 2);
  const depth = mill.backY - mill.gateY;
  const wallH = 0.34;
  const tunnelH = 0.15;
  // Inside the rails, which stand half their thickness into the cell.
  const x0 = mill.x - mill.halfWidth + RAIL_T / 2;
  const x1 = mill.x + mill.halfWidth - RAIL_T / 2;
  const midY = (mill.gateY + mill.backY) / 2;
  const box = (w: number, h: number, d: number, mat: THREE.Material, cx: number, cy: number, by: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.copy(toWorld(cx, cy, by + h / 2));
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const sideW = mill.x - mill.halfGap - x0;
  box(sideW, wallH, depth, mats.millWall, x0 + sideW / 2, midY, base);
  box(sideW, wallH, depth, mats.millWall, x1 - sideW / 2, midY, base);
  box(mill.halfGap * 2, wallH - tunnelH, depth, mats.millWall, mill.x, midY, base + tunnelH);
  // Paper trim round the tunnel mouth, and a paper band under the eaves.
  const trimT = 0.028;
  box(mill.halfGap * 2 + trimT * 2, trimT, 0.012, mats.mill, mill.x, mill.gateY - 0.006, base + tunnelH);
  box(trimT, tunnelH, 0.012, mats.mill, mill.x - mill.halfGap - trimT / 2, mill.gateY - 0.006, base);
  box(trimT, tunnelH, 0.012, mats.mill, mill.x + mill.halfGap + trimT / 2, mill.gateY - 0.006, base);
  box(x1 - x0 + 0.012, 0.03, depth + 0.012, mats.mill, mill.x, midY, base + wallH - 0.03);
  // A pitched roof running north-south: a triangle extruded through the house.
  const roofW = (x1 - x0) / 2 + 0.05;
  const roofH = 0.22;
  const tri = new THREE.Shape();
  tri.moveTo(-roofW, 0);
  tri.lineTo(roofW, 0);
  tri.lineTo(0, roofH);
  tri.closePath();
  const roof = new THREE.Mesh(
    new THREE.ExtrudeGeometry(tri, { depth: depth + 0.08, bevelEnabled: false }),
    mats.mill,
  );
  // Extruded along +z; the front (south) face sits at the gate.
  roof.position.copy(toWorld(mill.x, mill.backY + 0.04, base + wallH));
  roof.castShadow = true;
  g.add(roof);
  // A paper gable on the front face, under the roof's edge.
  const gableShape = new THREE.Shape();
  gableShape.moveTo(-roofW + 0.07, 0);
  gableShape.lineTo(roofW - 0.07, 0);
  gableShape.lineTo(0, roofH - 0.05);
  gableShape.closePath();
  const gable = new THREE.Mesh(new THREE.ShapeGeometry(gableShape), mats.millWall);
  gable.position.copy(toWorld(mill.x, mill.gateY - 0.042, base + wallH));
  g.add(gable);
  // The sails turn about the north-south axis in front of the gable.
  const hubH = base + wallH + 0.15;
  const sails = new THREE.Group();
  sails.position.copy(toWorld(mill.x, mill.gateY - 0.09, hubH));
  // Leant back so the sails face the camera above the tee; they still
  // sweep down across the tunnel mouth.
  sails.rotation.x = -0.55;
  const bladeLen = hubH - base - 0.04;
  for (let k = 0; k < 4; k += 1) {
    const arm = new THREE.Group();
    arm.rotation.z = (k * Math.PI) / 2;
    // Pointing down at rotation 0: its tip crosses the tunnel mouth.
    const spar = new THREE.Mesh(new THREE.BoxGeometry(0.022, bladeLen, 0.02), mats.roof);
    spar.position.set(0, -bladeLen / 2, 0);
    arm.add(spar);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.12, bladeLen * 0.74), mats.millTrim);
    cloth.position.set(0.068, -bladeLen * 0.56, 0.004);
    arm.add(cloth);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.016, bladeLen * 0.74, 0.016), mats.mill);
    edge.position.set(0.134, -bladeLen * 0.56, 0.004);
    arm.add(edge);
    arm.traverse((o) => {
      o.castShadow = true;
    });
    sails.add(arm);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 16), mats.brass);
  hub.rotation.x = Math.PI / 2;
  sails.add(hub);
  g.add(sails);
  return { group: g, sails };
}

/** A loop's track point at angle phi, at distance `rad` from the circle's
 *  centre and `lateral` off its axis. */
function loopAt(loop: MgLoop, base: number, phi: number, rad: number, lateral: number, out: THREE.Vector3): THREE.Vector3 {
  const k = Math.min(1, Math.max(0, phi / (Math.PI * 2)));
  const u = rad * Math.sin(phi) + loop.advance * k;
  // Lateral axis: (uy, -ux).
  const x = loop.x + loop.ux * u + loop.uy * lateral;
  const y = loop.y + loop.uy * u - loop.ux * lateral;
  const h = base + MG_BALL_R + loop.radius - rad * Math.cos(phi);
  return toWorld(x, y, h, out);
}

/** Where the ball is in a loop: arc length s to a world point. */
export function loopPoint(loop: MgLoop, base: number, s: number, out: THREE.Vector3): THREE.Vector3 {
  return loopAt(loop, base, s / loop.radius, loop.radius, 0, out);
}

/** The loop: a red track the ball rides inside, brass edges, two posts. */
function buildLoop(loop: MgLoop, base: number, mats: MgMaterials): THREE.Group {
  const g = new THREE.Group();
  const rad = loop.radius + MG_BALL_R;
  const half = 0.075;
  const n = 72;
  const pos: number[] = [];
  const idx: number[] = [];
  const a = new THREE.Vector3();
  for (let i = 0; i <= n; i += 1) {
    const phi = (i / n) * Math.PI * 2;
    for (const lat of [-half, half]) {
      loopAt(loop, base, phi, rad, lat, a);
      pos.push(a.x, a.y, a.z);
    }
  }
  for (let i = 0; i < n; i += 1) {
    const p = i * 2;
    idx.push(p, p + 1, p + 2, p + 2, p + 1, p + 3);
  }
  const ribbon = new THREE.BufferGeometry();
  ribbon.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  ribbon.setIndex(idx);
  ribbon.computeVertexNormals();
  const track = new THREE.Mesh(ribbon, mats.loopTrack);
  track.castShadow = true;
  g.add(track);
  for (const lat of [-half, half]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i += 1) pts.push(loopAt(loop, base, (i / n) * Math.PI * 2, rad + 0.006, lat, new THREE.Vector3()));
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.012, 6, false), mats.brass);
    tube.castShadow = true;
    g.add(tube);
  }
  // Two posts hold the top.
  for (const lat of [-1, 1]) {
    const top = loopAt(loop, base, Math.PI, rad, lat * (half + 0.02), new THREE.Vector3());
    const h = top.y - base;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, h, 8), mats.brass);
    post.position.set(top.x, base + h / 2, top.z);
    g.add(post);
  }
  return g;
}

function buildFlag(mats: MgMaterials): THREE.Group {
  const g = new THREE.Group();
  const poleH = 0.74;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, poleH, 8), mats.pole);
  pole.position.y = poleH / 2;
  pole.castShadow = true;
  g.add(pole);
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0.26, -0.08);
  shape.lineTo(0, -0.16);
  shape.closePath();
  const pennant = new THREE.Mesh(new THREE.ShapeGeometry(shape), mats.flag);
  pennant.position.set(0.009, poleH - 0.01, 0);
  pennant.castShadow = true;
  pennant.name = 'pennant';
  g.add(pennant);
  return g;
}

/** Build everything for one hole into a group. */
export function buildHoleScene(hole: MgHole, mats: MgMaterials): HoleScene {
  const group = new THREE.Group();
  const felt = new THREE.Mesh(buildFelt(hole), mats.felt);
  felt.receiveShadow = true;
  group.add(felt);

  const rails = buildRails(hole);
  const body = new THREE.Mesh(rails.body, mats.rail);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  const top = new THREE.Mesh(rails.top, mats.railTop);
  top.receiveShadow = true;
  group.add(top);

  // The deck: one flat colour, unlit, under the whole view.
  const w = hole.cols * MG_CELL;
  const h = hole.rows * MG_CELL;
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(DECK_SIZE, DECK_SIZE), mats.deck);
  deck.rotation.x = -Math.PI / 2;
  deck.position.set(w / 2, DECK_Y - 0.001, -h / 2);
  group.add(deck);

  // The cup: a dark throat and a paper liner rim.
  const cupH = feltHeight(hole, hole.cup.x + MG_CUP_R, hole.cup.y);
  const throat = new THREE.Mesh(new THREE.CylinderGeometry(MG_CUP_R, MG_CUP_R, 0.16, 32, 1, true), mats.cup);
  throat.position.copy(toWorld(hole.cup.x, hole.cup.y, cupH - 0.08));
  group.add(throat);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(MG_CUP_R, 32), mats.cup);
  floor.rotation.x = -Math.PI / 2;
  floor.position.copy(toWorld(hole.cup.x, hole.cup.y, cupH - 0.16));
  group.add(floor);
  const rim = new THREE.Mesh(new THREE.RingGeometry(MG_CUP_R - 0.004, MG_CUP_R + 0.008, 40), mats.cupRim);
  rim.rotation.x = -Math.PI / 2;
  rim.position.copy(toWorld(hole.cup.x, hole.cup.y, cupH + 0.003));
  group.add(rim);

  const flag = buildFlag(mats);
  flag.position.copy(toWorld(hole.cup.x, hole.cup.y, cupH - 0.1));
  group.add(flag);

  // The tee mat.
  const teeMat = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.2), mats.tee);
  teeMat.rotation.x = -Math.PI / 2;
  teeMat.position.copy(toWorld(hole.tee.x, hole.tee.y, feltHeight(hole, hole.tee.x, hole.tee.y) + 0.002));
  teeMat.receiveShadow = true;
  group.add(teeMat);

  for (const p of hole.posts) {
    const base = feltHeight(hole, p.x, p.y);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r, 0.14, 24), mats.post);
    post.position.copy(toWorld(p.x, p.y, base + 0.07));
    post.castShadow = true;
    group.add(post);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 0.92, p.r, 0.022, 24), mats.brass);
    cap.position.copy(toWorld(p.x, p.y, base + 0.151));
    group.add(cap);
  }

  const mills: MillRig[] = [];
  for (const mill of hole.windmills) {
    const built = buildMill(hole, mill, mats);
    group.add(built.group);
    mills.push({ mill, sails: built.sails });
  }
  const loops: LoopRig[] = [];
  for (const loop of hole.loops) {
    const base = feltHeight(hole, loop.x, loop.y);
    group.add(buildLoop(loop, base, mats));
    loops.push({ loop, base });
  }

  const bounds = new THREE.Box3(
    new THREE.Vector3(0, DECK_Y, -h),
    new THREE.Vector3(w, Math.max(0.3, ...hole.cells.map((c) => (c.level + 1) * 0.22)), 0),
  );
  return { group, mills, loops, flag, cupH, bounds };
}

/** The boardwalk under the course: flat planks with hard seams, staggered
 *  ends. Decoration: painted after the first frame. */
export function makeDeckTexture(look: MgLook): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = look.deck;
    ctx.fillRect(0, 0, size, size);
    const planks = 5;
    const pw = size / planks;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
    for (let i = 0; i < planks; i += 1) {
      ctx.fillRect(i * pw, 0, 3, size);
      const end = ((i * 97) % 5) / 5;
      ctx.fillRect(i * pw, end * size, pw, 3);
    }
    ctx.fillStyle = 'rgba(255, 240, 220, 0.05)';
    for (let i = 0; i < planks; i += 2) ctx.fillRect(i * pw + 3, 0, pw - 3, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(DECK_SIZE / DECK_TILE, DECK_SIZE / DECK_TILE);
  tex.anisotropy = 4;
  return tex;
}

/** Dispose one hole's group (its geometries; materials are shared). */
export function disposeHoleScene(scene: HoleScene): void {
  scene.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
  });
  scene.group.removeFromParent();
}
