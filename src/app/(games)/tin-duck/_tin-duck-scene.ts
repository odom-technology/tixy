/**
 * The tin duck gallery as a three.js scene.
 *
 * Everything here is drawn from the round clock `t` (ms): chains, targets,
 * flips and rings are closed-form functions of time, so a frame at any refresh
 * rate samples the same curve. Nothing is stepped and nothing is interpolated.
 * Input and sound live in the client; this file only draws and reports where a
 * cork lands (`onImpact`), so a sound can ride the frame the impact is seen.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import {
  MIDWAY_PALETTE,
  emitSpriteParticles,
  expDamp,
  makeSoftDiscTexture,
  makeSpriteParticlePool,
  midwayCanvasFont,
  midwayParticleCount,
  resetSpriteParticles,
  stepSpriteParticles,
  type MidwayTier,
  type SpriteParticle,
} from '@/features/arcade/lib/midway-three';
import {
  GALLERY_BACKBOARD_Z,
  GALLERY_BONUS,
  GALLERY_CAMERA,
  GALLERY_DUCK_DOWN_MS,
  GALLERY_MAG_SIZE,
  GALLERY_PANEL_X,
  GALLERY_ROWS,
  GALLERY_TARGET_LIFT,
  deriveGallerySchedule,
  galleryBonusX,
  galleryItemKind,
  galleryItemLap,
  galleryItemX,
  type GalleryHitKind,
  type GallerySchedule,
} from '@/server/arcade/tin-duck-gallery';

import { MATERIAL_TILE, paintMaterialTile } from '@/features/arcade/lib/skins/skin-material-canvas';

import { makeSkinTargetGeometry } from './_tin-duck-shapes';
import { DEFAULT_TIN_DUCK_THEME, type TinDuckTheme } from './_tin-duck-theme';

/** Where the camera looks, and the rig's framing box. */
export const LOOK_AT = new THREE.Vector3(0, 2.6, -10);
export const RIG_TARGET: [number, number, number] = [0, 2.9, -5.5];
export const RIG_RADIUS = 9;
export const RIG_CAMERA: [number, number, number] = [GALLERY_CAMERA.x, GALLERY_CAMERA.y, GALLERY_CAMERA.z];

/** The gun's pivot (the breech), and the plane its barrel aims through. */
const GUN_PIVOT = new THREE.Vector3(0, 1.42, -0.2);
const GUN_BARREL = 1.45;
const AIM_PLANE_Z = -6.5;
const CORK_SPEED = 95; // world units per second

const DUCK_SCALE = 0.85;
const HINGE_LIFT = 0.16;
const ROW_SHELF_DEPTH = 0.95;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const BLOCK_H = 0.22;

/** Duck down angle (rad) at `s` seconds after a hit: an underdamped spring to a flat lie, with a bounce. */
const FLIP_TARGET = 1.42;
const FLIP_ZETA = 0.42;
const FLIP_OMEGA = 30;
function flipDown(s: number): number {
  if (s <= 0) return 0;
  const wd = FLIP_OMEGA * Math.sqrt(1 - FLIP_ZETA * FLIP_ZETA);
  const e = Math.exp(-FLIP_ZETA * FLIP_OMEGA * s);
  return FLIP_TARGET * (1 - e * (Math.cos(wd * s) + ((FLIP_ZETA * FLIP_OMEGA) / wd) * Math.sin(wd * s)));
}
/** The swing back up: from `from` rad to upright, with a small lean past vertical. */
const UP_ZETA = 0.55;
const UP_OMEGA = 22;
function flipUp(from: number, s: number): number {
  if (s <= 0) return from;
  const wd = UP_OMEGA * Math.sqrt(1 - UP_ZETA * UP_ZETA);
  const e = Math.exp(-UP_ZETA * UP_OMEGA * s);
  return from * e * (Math.cos(wd * s) + ((UP_ZETA * UP_OMEGA) / wd) * Math.sin(wd * s));
}
/** Plate wobble: starts at zero, kicks back, rings down. */
function plateAngle(s: number): number {
  if (s <= 0) return 0;
  return 0.5 * Math.exp(-2.6 * s) * Math.sin(24 * s);
}

/** The gun's kick (back along the barrel, muzzle up) in `s` seconds after a shot. */
function kickCurve(s: number): number {
  if (s <= 0) return 0;
  // A fast rise (18 ms) and a lightly damped return.
  const rise = clamp01(s / 0.018);
  return rise * Math.exp(-14 * s) * Math.cos(9 * s) * (s < 0.018 ? rise : 1);
}

export type ImpactEvent =
  | { type: 'hit'; kind: GalleryHitKind; row: number; index: number; x: number; y: number; z: number }
  | { type: 'pock'; x: number; y: number; z: number; flat?: boolean };

export interface HudState {
  score: number;
  /** Seconds as shown. */
  seconds: number;
  warn: boolean;
}

type Part = 0 | 1 | 2 | 3;

/** The counter the gun rests on: its own colour in a skin set, else the rail's. */
const counterColor = (theme: TinDuckTheme) => theme.skin?.counter ?? theme.rail;

function duckGeometry(): { geo: THREE.BufferGeometry } {
  const parts: { shapes: THREE.Shape[]; part: Part; depth: number; z: number }[] = [];
  const body = new THREE.Shape();
  body.absellipse(-0.02, 0.3, 0.46, 0.3, 0, Math.PI * 2, false, 0);
  const tail = new THREE.Shape();
  tail.moveTo(-0.3, 0.3);
  tail.lineTo(-0.62, 0.62);
  tail.lineTo(-0.46, 0.34);
  tail.lineTo(-0.2, 0.2);
  const neck = new THREE.Shape();
  neck.moveTo(0.14, 0.36);
  neck.lineTo(0.46, 0.34);
  neck.lineTo(0.5, 0.74);
  neck.lineTo(0.26, 0.74);
  const head = new THREE.Shape();
  head.absellipse(0.42, 0.78, 0.2, 0.19, 0, Math.PI * 2, false, 0);
  parts.push({ shapes: [body, tail, neck, head], part: 0, depth: 0.08, z: -0.04 });
  const bill = new THREE.Shape();
  bill.moveTo(0.54, 0.86);
  bill.quadraticCurveTo(0.84, 0.84, 0.86, 0.76);
  bill.quadraticCurveTo(0.7, 0.68, 0.54, 0.7);
  parts.push({ shapes: [bill], part: 1, depth: 0.06, z: -0.03 });
  const wing = new THREE.Shape();
  wing.moveTo(-0.34, 0.4);
  wing.quadraticCurveTo(-0.04, 0.5, 0.2, 0.34);
  wing.quadraticCurveTo(0.0, 0.1, -0.3, 0.2);
  wing.quadraticCurveTo(-0.4, 0.28, -0.34, 0.4);
  parts.push({ shapes: [wing], part: 2, depth: 0.014, z: 0.04 });
  const eye = new THREE.Shape();
  eye.absellipse(0.5, 0.82, 0.04, 0.04, 0, Math.PI * 2, false, 0);
  parts.push({ shapes: [eye], part: 3, depth: 0.014, z: 0.04 });
  const geos: THREE.BufferGeometry[] = [];
  for (const p of parts) {
    const g = new THREE.ExtrudeGeometry(p.shapes, {
      depth: p.depth,
      bevelEnabled: p.part === 0,
      bevelThickness: 0.012,
      bevelSize: 0.012,
      bevelSegments: 1,
      curveSegments: 16,
    });
    g.translate(0, 0, p.z);
    const n = g.attributes.position!.count;
    g.setAttribute('part', new THREE.BufferAttribute(new Uint8Array(n).fill(p.part), 1));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geos.push(g);
  }
  const geo = mergeGeometries(geos, false)!;
  for (const g of geos) g.dispose();
  return { geo };
}

function paintDuck(geo: THREE.BufferGeometry, colors: [string, string, string, string]): void {
  const part = geo.getAttribute('part') as THREE.BufferAttribute;
  const color = geo.getAttribute('color') as THREE.BufferAttribute;
  const c = colors.map((hex) => new THREE.Color(hex));
  for (let i = 0; i < part.count; i += 1) {
    const col = c[part.getX(i)]!;
    color.setXYZ(i, col.r, col.g, col.b);
  }
  color.needsUpdate = true;
}

const PLATE_RINGS: [number, 'edge' | 'paper' | 'red' | 'ticket'][] = [
  [0.56, 'edge'],
  [0.52, 'paper'],
  [0.4, 'red'],
  [0.3, 'paper'],
  [0.2, 'ticket'],
];

/** The colour of each plate ring. A skin set gives the centre its own ring. */
function plateColors(theme: TinDuckTheme) {
  return {
    edge: theme.duckEdge,
    paper: theme.duckBody,
    red: theme.curtainA,
    ticket: theme.skin?.bull ?? theme.valance,
  };
}

function plateGeometry(theme: TinDuckTheme): THREE.BufferGeometry {
  const colors = plateColors(theme);
  const geos: THREE.BufferGeometry[] = [];
  PLATE_RINGS.forEach(([r, key], i) => {
    const g = new THREE.CylinderGeometry(r, r, 0.05, 40, 1);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, i * 0.006);
    const col = new THREE.Color(colors[key]);
    const n = g.attributes.position!.count;
    const arr = new Float32Array(n * 3);
    for (let k = 0; k < n; k += 1) {
      arr[k * 3] = col.r;
      arr[k * 3 + 1] = col.g;
      arr[k * 3 + 2] = col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    geos.push(g);
  });
  const geo = mergeGeometries(geos, false)!;
  for (const g of geos) g.dispose();
  return geo;
}

/** Repaint the plate's rings in place. Each ring has the same vertex count. */
function paintPlateColors(geo: THREE.BufferGeometry, theme: TinDuckTheme): void {
  const colors = plateColors(theme);
  const color = geo.getAttribute('color') as THREE.BufferAttribute;
  const per = color.count / PLATE_RINGS.length;
  const c = new THREE.Color();
  PLATE_RINGS.forEach(([, key], ring) => {
    c.set(colors[key]);
    for (let k = 0; k < per; k += 1) color.setXYZ(ring * per + k, c.r, c.g, c.b);
  });
  color.needsUpdate = true;
}

/** A target's geometry for a skin shape: the house duck, or a rabbit, fish or star. */
function targetGeometry(shape: string): THREE.BufferGeometry {
  if (shape === 'rabbit' || shape === 'fish' || shape === 'star') return makeSkinTargetGeometry(shape);
  return duckGeometry().geo;
}

function chainTexture(color: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 32);
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  // Links alternate: one face on, one on edge.
  for (let i = 0; i < 4; i += 1) {
    const x = i * 32;
    if (i % 2 === 0) {
      ctx.beginPath();
      ctx.ellipse(x + 16, 16, 13, 8, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fillRect(x + 4, 13, 24, 6);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 2;
  return tex;
}

interface ItemRig {
  mesh: THREE.Mesh;
  row: number;
  index: number;
  root: THREE.Group;
  pivot: THREE.Group;
  mat: THREE.MeshLambertMaterial;
  kind: 'duck' | 'plate' | 'bonus';
  /** The cork's landing time (round clock). Null: not hit this round. */
  downAt: number | null;
  upAt: number;
  ringAt: number | null;
  /** The lap a plate was hit on: it is spent (dimmed) until the chain wraps it. */
  hitLap: number | null;
  baseEmissive: THREE.Color;
}

interface Pending {
  at: number;
  event: ImpactEvent;
  hit?: { kind: GalleryHitKind; row: number; index: number; hitAt: number };
}

export interface GalleryScene {
  camera: THREE.PerspectiveCamera;
  group: THREE.Group;
  setSize(width: number, height: number): void;
  /** Colours now; a skin set's backboard picture paints through `defer` (the
   *  game's deferred textures) so it never lands in a frame. */
  setTheme(theme: TinDuckTheme, defer?: (paint: () => THREE.CanvasTexture, apply: (tex: THREE.CanvasTexture) => void) => void): void;
  /** Start a round: the gallery sets itself, flat to upright, ahead of t = 0. */
  startRound(schedule: GallerySchedule, setupStartMs: number): void;
  /** Park the gallery for the first frame. */
  idle(): void;
  setAim(sx: number, sy: number): void;
  /** A shot left the gun at `t`. Returns the cork's flight time in ms. */
  fire(t: number, target: { x: number; y: number; z: number }, impact: Pending['event'], hit?: Pending['hit']): number;
  /** The gun is dry: a click, no kick. */
  dry(t: number): void;
  /** Draw state for the round clock `t` (ms), `dtMs` since the last frame. */
  update(t: number, dtMs: number, hud: HudState, ammo: { shown: number; reloadFrac: number }, shakePx: { x: number; y: number }, onImpact: (e: ImpactEvent) => void): void;
  /** Screen position (canvas px) of a world point. */
  project(x: number, y: number, z: number, out: { x: number; y: number }): void;
  /** Targets on screen now, for the QA bot. */
  probe(t: number): { x: number; y: number; kind: string; row: number; r: number; wx: number; wy: number; wz: number }[];
  /** Slopes of the ray through a canvas point, from the fixed camera. */
  slopes(px: number, py: number, out: { x: number; y: number }): void;
  /** A surface point for a miss: where the cork pocks. */
  surfaceFor(sx: number, sy: number): { x: number; y: number; z: number; flat: boolean };
  /** Where the muzzle is now, for the cork's start. */
  muzzle(out: THREE.Vector3): THREE.Vector3;
  warm(renderer: THREE.WebGLRenderer): void;
  setReduced(reduced: boolean): void;
  dispose(): void;
}

export function createGalleryScene(
  scene: THREE.Scene,
  initialTheme: TinDuckTheme,
  tier: MidwayTier,
): GalleryScene {
  let theme = initialTheme;
  const group = new THREE.Group();
  scene.add(group);
  let reduced = false;
  let width = 390;
  let height = 700;

  const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 80);
  camera.position.set(GALLERY_CAMERA.x, GALLERY_CAMERA.y, GALLERY_CAMERA.z);
  camera.lookAt(LOOK_AT);
  camera.updateMatrixWorld();
  // The same pose without the shake, for rays.
  const rayCamera = new THREE.PerspectiveCamera(50, width / height, 0.1, 80);
  rayCamera.position.copy(camera.position);
  rayCamera.lookAt(LOOK_AT);
  rayCamera.updateMatrixWorld();
  const baseCamPos = camera.position.clone();
  const lookAt = LOOK_AT.clone();

  // Lambert: the look is flat, and it costs about half a standard material
  // per pixel on a phone-class GPU. The rig still lights it.
  const std = (color: string, _rough = 0.78, _metal = 0.0) => new THREE.MeshLambertMaterial({ color });
  const mats: Record<string, THREE.MeshLambertMaterial> = {
    backboard: std(theme.backboard, 0.95),
    backLine: std(theme.backboardLine, 0.95),
    shelf: std(theme.rail, 0.8),
    shelfTop: std(theme.railHi, 0.8),
    panel: std('#3a2d24', 0.9),
    stripeA: std(theme.curtainA, 0.85),
    stripeB: std(theme.curtainB, 0.85),
    stripeShade: std(theme.curtainShade, 0.85),
    valance: std(theme.valance, 0.8),
    counter: std(counterColor(theme), 0.75),
    counterTop: std(counterColor(theme), 0.7),
    counterSeam: std('#2b1c10', 1),
    ink: std(MIDWAY_PALETTE.ink, 0.7, 0.2),
    metal: std('#3b332c', 0.45, 0.55),
    brass: std(MIDWAY_PALETTE.brass, 0.4, 0.6),
    stock: std(MIDWAY_PALETTE.wood, 0.55),
    cork: std('#c79a5c', 0.9),
    corkEnd: std('#8a6a3c', 0.9),
    pockRim: std('#5e4d3d', 1),
    pockHole: std('#0f0b09', 1),
    block: std(MIDWAY_PALETTE.ink, 0.6, 0.35),
  };
  mats.stripeA!.side = THREE.DoubleSide;
  mats.stripeB!.side = THREE.DoubleSide;
  mats.stripeShade!.side = THREE.DoubleSide;
  mats.valance!.side = THREE.DoubleSide;

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = group) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

  // ── The booth ──
  // The backboard has its own material, with a 1 x 1 white map from the start,
  // so a skin set's material is a texture swap and not a shader recompile.
  const whiteTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  whiteTex.colorSpace = THREE.SRGBColorSpace;
  whiteTex.needsUpdate = true;
  const backFaceMat = new THREE.MeshLambertMaterial({ color: theme.backboard, map: whiteTex });
  const back = add(new THREE.PlaneGeometry(30, 15), backFaceMat, 0, 3.4, GALLERY_BACKBOARD_Z);
  back.receiveShadow = true;
  const backLines: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i += 1) {
    backLines.push(add(box(30, 0.05, 0.02), mats.backLine!, 0, 0.5 + i * 1.3, GALLERY_BACKBOARD_Z + 0.01));
  }

  // Row shelves, chains and end panels.
  const chainTex: THREE.CanvasTexture[] = [];
  const chainPitch = 0.5;
  GALLERY_ROWS.forEach((row, r) => {
    const shelf = add(box(11.6, 0.34, ROW_SHELF_DEPTH), mats.shelf!, 0, row.y - 0.17, row.z);
    shelf.receiveShadow = true;
    add(box(11.6, 0.03, ROW_SHELF_DEPTH + 0.02), mats.shelfTop!, 0, row.y + 0.005, row.z);
    const stripe = add(box(11.6, 0.07, 0.02), r % 2 === 0 ? mats.stripeA! : mats.valance!, 0, row.y - 0.1, row.z + ROW_SHELF_DEPTH / 2 + 0.012);
    stripe.castShadow = false;
    const tex = chainTexture('#d8c9a8');
    tex.repeat.set(11.6 / chainPitch, 1);
    chainTex.push(tex);
    const chain = new THREE.Mesh(
      new THREE.PlaneGeometry(11.6, 0.1),
      new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.2 }),
    );
    chain.position.set(0, row.y + 0.09, row.z + 0.2);
    group.add(chain);
    for (const side of [-1, 1]) {
      add(box(2.4, 1.5, 0.5), mats.panel!, side * (GALLERY_PANEL_X + 1.2), row.y + 0.5, row.z + 0.48);
      add(box(0.06, 1.5, 0.52), mats.valance!, side * GALLERY_PANEL_X, row.y + 0.5, row.z + 0.48);
    }
  });
  // Bonus rail.
  {
    const tex = chainTexture('#f2a33c');
    tex.repeat.set(11.6 / chainPitch, 1);
    chainTex.push(tex);
    const chain = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 0.1),
      new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.2 }),
    );
    chain.position.set(0, GALLERY_BONUS.y + 0.09, GALLERY_BONUS.z + 0.2);
    group.add(chain);
    add(box(11.6, 0.14, 0.4), mats.shelf!, 0, GALLERY_BONUS.y - 0.07, GALLERY_BONUS.z);
    for (const side of [-1, 1]) add(box(2.6, 1.5, 0.5), mats.panel!, side * (GALLERY_PANEL_X + 1.3), GALLERY_BONUS.y + 0.5, GALLERY_BONUS.z + 0.48);
  }

  // Side walls: the booth continues past the panels.
  for (const side of [-1, 1]) {
    add(box(0.3, 9, 11.4), mats.backboard!, side * 7.4, 3.6, -5.9);
  }

  // ── Awning ──
  const awn = new THREE.Group();
  group.add(awn);
  const STRIPES = 22;
  const AW_W = 16;
  const sw = AW_W / STRIPES;
  const frontY = 6.0;
  const frontZ = -2.6;
  const backY = 7.3;
  const backZ = -6.4;
  const slopeLen = Math.hypot(backY - frontY, backZ - frontZ);
  const slopeAng = Math.atan2(backY - frontY, frontZ - backZ);
  const scallop = new THREE.CircleGeometry(sw / 2, 20, Math.PI, Math.PI);
  for (let i = 0; i < STRIPES; i += 1) {
    const x = -AW_W / 2 + sw * (i + 0.5);
    const mat = i % 2 === 0 ? mats.stripeA! : mats.stripeB!;
    const slab = add(box(sw, 0.06, slopeLen), mat, x, (frontY + backY) / 2, (frontZ + backZ) / 2, awn);
    slab.rotation.x = slopeAng;
    add(box(sw, 0.5, 0.05), mat, x, frontY - 0.25, frontZ, awn);
    const sc = add(scallop, mat, x, frontY - 0.5, frontZ + 0.001, awn);
    sc.scale.set(1, 1, 1);
  }
  add(box(AW_W, 0.1, 0.1), mats.valance!, 0, frontY + 0.02, frontZ + 0.04, awn);
  // Posts.
  for (const side of [-1, 1]) add(box(0.22, 5.2, 0.22), mats.stock!, side * 6.2, 2.5, frontZ + 0.1);

  // Score and clock sign, hung under the valance.
  const SIGN_W = 2.5;
  const SIGN_H = 0.64;
  const signCanvas = document.createElement('canvas');
  signCanvas.width = 580;
  signCanvas.height = 148;
  const signTex = new THREE.CanvasTexture(signCanvas);
  signTex.colorSpace = THREE.SRGBColorSpace;
  signTex.anisotropy = 4;
  add(new THREE.PlaneGeometry(SIGN_W, SIGN_H), new THREE.MeshBasicMaterial({ map: signTex }), 0, frontY - 1.45, frontZ + 0.03);
  for (const sx of [-1, 1]) add(box(0.025, 0.55, 0.02), mats.metal!, sx * (SIGN_W / 2 - 0.2), frontY - 0.95, frontZ + 0.03);
  let signKey = '';
  const paintSign = (hud: HudState) => {
    const key = `${hud.score}|${hud.seconds}|${hud.warn}`;
    if (key === signKey) return;
    signKey = key;
    const ctx = signCanvas.getContext('2d')!;
    ctx.fillStyle = '#1f1a16';
    ctx.fillRect(0, 0, 580, 148);
    ctx.strokeStyle = '#f2a33c';
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, 564, 132);
    ctx.fillStyle = '#cdbfa6';
    ctx.font = midwayCanvasFont('text', 700, 32);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillText('score', 38, 52);
    ctx.textAlign = 'right';
    ctx.fillText('time', 542, 52);
    ctx.font = midwayCanvasFont('num', 800, 78);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f2a33c';
    ctx.fillText(String(hud.score), 36, 122);
    ctx.textAlign = 'right';
    ctx.fillStyle = hud.warn ? '#e8543f' : '#f4ebdc';
    const s = Math.max(0, hud.seconds);
    ctx.fillText(`0:${String(s).padStart(2, '0')}`, 544, 122);
    signTex.needsUpdate = true;
  };

  // ── Counter, corks, gun ──
  const counter = add(box(14, 0.8, 4.2), mats.counter!, 0, 0.62, -1.2);
  counter.receiveShadow = true;
  const counterTop = add(box(14, 0.06, 4.25), mats.counterTop!, 0, 1.04, -1.2);
  counterTop.receiveShadow = true;
  add(box(14, 0.12, 0.02), mats.valance!, 0, 0.78, 0.87);

  // Six corks stand in a tray on the counter: the magazine you can see.
  add(box(1.9, 0.07, 0.3), mats.ink!, 0, 1.095, 0.3);
  {
    // Plank seams along the counter: depth you can read at a glance.
    const seams: THREE.BufferGeometry[] = [];
    for (let i = -6; i <= 6; i += 1) {
      const g = box(0.03, 0.01, 4.2);
      g.translate(i * 1.1, 1.075, -1.2);
      seams.push(g);
    }
    add(mergeGeometries(seams, false)!, mats.counterSeam!, 0, 0, 0);
    for (const g of seams) g.dispose();
  }
  const corks: THREE.Mesh[] = [];
  const corkGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.2, 14);
  const corkLie = corkGeo.clone();
  corkLie.rotateX(Math.PI / 2);
  for (let i = 0; i < GALLERY_MAG_SIZE; i += 1) {
    const c = new THREE.Mesh(corkGeo, mats.cork!);
    c.position.set((i - (GALLERY_MAG_SIZE - 1) / 2) * 0.3, 1.23, 0.3);
    c.castShadow = true;
    group.add(c);
    corks.push(c);
  }

  const gun = new THREE.Group();
  gun.position.copy(GUN_PIVOT);
  group.add(gun);
  const gunBody = new THREE.Group();
  gun.add(gunBody);
  const barrel = add(new THREE.CylinderGeometry(0.065, 0.075, GUN_BARREL, 16), mats.metal!, 0, 0, -GUN_BARREL / 2, gunBody);
  barrel.rotation.x = Math.PI / 2;
  barrel.castShadow = true;
  const receiver = add(box(0.19, 0.2, 0.6), mats.metal!, 0, -0.02, 0.1, gunBody);
  receiver.castShadow = true;
  const stock = add(box(0.17, 0.3, 0.9), mats.stock!, 0, -0.1, 0.75, gunBody);
  stock.rotation.x = -0.12;
  stock.castShadow = true;
  const slide = add(box(0.15, 0.13, 0.5), mats.stock!, 0, -0.13, -0.55, gunBody);
  slide.castShadow = true;
  const slideBase = slide.position.z;
  add(box(0.22, 0.05, 0.05), mats.brass!, 0, 0.0, -0.18, gunBody);
  const muzzleRing = add(new THREE.CylinderGeometry(0.085, 0.085, 0.07, 16), mats.brass!, 0, 0, -GUN_BARREL + 0.02, gunBody);
  muzzleRing.rotation.x = Math.PI / 2;
  const bead = add(box(0.03, 0.05, 0.03), mats.valance!, 0, 0.09, -GUN_BARREL + 0.05, gunBody);
  void bead;
  const muzzleCork = add(corkLie, mats.cork!, 0, 0, -GUN_BARREL - 0.05, gunBody);
  const muzzleMarker = new THREE.Object3D();
  muzzleMarker.position.set(0, 0, -GUN_BARREL - 0.12);
  gunBody.add(muzzleMarker);

  // The cork in flight.
  const flightCork = new THREE.Mesh(corkLie, mats.cork!);
  flightCork.visible = false;
  flightCork.scale.setScalar(0.75);
  group.add(flightCork);

  // Muzzle flash.
  const discTex = makeSoftDiscTexture(64);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: discTex, color: theme.muzzle, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  flash.visible = false;
  group.add(flash);

  // Glow behind the bonus duck.
  const bonusHalo = new THREE.Mesh(
    new THREE.PlaneGeometry(GALLERY_BONUS.radius * 4.2, GALLERY_BONUS.radius * 4.2),
    new THREE.MeshBasicMaterial({ map: discTex, color: theme.valance, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  bonusHalo.visible = false;
  group.add(bonusHalo);

  // ── Targets ──
  const rowBodies = (r: number): [string, string, string, string] => {
    if (theme.rowTint) {
      const bodies = [theme.duckBody, '#f2a33c', '#b83627'];
      const bills = [theme.duckBeak, '#b83627', theme.duckBody];
      const wings = [theme.duckBelly, theme.duckBodyLo, '#f2a33c'];
      return [bodies[r]!, bills[r]!, wings[r]!, theme.duckEye];
    }
    return [theme.duckBody, theme.duckBeak, theme.duckBelly, theme.duckEye];
  };
  const goldColors = (): [string, string, string, string] => [theme.goldBody, theme.curtainA, theme.goldBodyHi, theme.duckEye];
  // One geometry per row and one for the gold bonus target, each painted its
  // own colours. A skin set swaps the shape under the same rigs.
  let shapeKey = theme.skin?.shape ?? 'duck';
  const makeTargetGeos = (shape: string) => {
    const base = targetGeometry(shape);
    const rows: THREE.BufferGeometry[] = [];
    for (let r = 0; r < GALLERY_ROWS.length; r += 1) {
      const g = r === 0 ? base : base.clone();
      paintDuck(g, rowBodies(r));
      rows.push(g);
    }
    const gold = base.clone();
    paintDuck(gold, goldColors());
    return { rows, gold };
  };
  const initialGeos = makeTargetGeos(shapeKey);
  let duckGeos = initialGeos.rows;
  let goldGeo = initialGeos.gold;
  // The plate's rings are repainted for a skin set, and back for the house look.
  const plateGeo = plateGeometry(theme);
  let plateSkinned = Boolean(theme.skin);
  const blockGeo = box(0.5, BLOCK_H, 0.34);

  const items: ItemRig[] = [];
  const makeItem = (row: number, index: number, kind: ItemRig['kind'], geo: THREE.BufferGeometry, scale: number): ItemRig => {
    const root = new THREE.Group();
    const pivot = new THREE.Group();
    pivot.position.y = HINGE_LIFT;
    root.add(pivot);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#000000' });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    if (kind === 'plate') {
      mesh.position.y = 0.3;
    } else {
      mesh.scale.setScalar(scale);
    }
    pivot.add(mesh);
    const block = new THREE.Mesh(blockGeo, mats.block!);
    block.position.y = 0.0;
    root.add(block);
    group.add(root);
    return {
      mesh,
      row,
      index,
      root,
      pivot,
      mat,
      kind,
      downAt: null,
      upAt: 0,
      ringAt: null,
      hitLap: null,
      baseEmissive: new THREE.Color('#000000'),
    };
  };
  const rowItems: ItemRig[][] = [];
  GALLERY_ROWS.forEach((row, r) => {
    const list: ItemRig[] = [];
    for (let i = 0; i < row.count; i += 1) {
      // Plates are decided by the schedule; both shapes are built so the
      // schedule can change without rebuilding. Only one shows.
      list.push(makeItem(r, i, 'duck', duckGeos[r]!, DUCK_SCALE));
    }
    rowItems.push(list);
    items.push(...list);
  });
  // A second set of plate rigs per row (one visible per row).
  const plateRigs: ItemRig[] = GALLERY_ROWS.map((_, r) => makeItem(r, 0, 'plate', plateGeo, 1));
  items.push(...plateRigs);
  const bonus = makeItem(GALLERY_ROWS.length, 0, 'bonus', goldGeo, DUCK_SCALE * (GALLERY_BONUS.radius / 0.5));
  items.push(bonus);
  bonus.root.visible = false;

  // A skin set's backboard material: one tile, repeating, painted after the
  // first frame. Until then (and for the house look) it is the flat colour.
  let backKey = '';
  let backTex: THREE.CanvasTexture | null = null;
  const applyBackboard = (
    defer?: (paint: () => THREE.CanvasTexture, apply: (tex: THREE.CanvasTexture) => void) => void,
  ) => {
    const skin = theme.skin;
    for (const line of backLines) line.visible = !skin;
    const key = skin ? [skin.material, theme.backboard, skin.boothAlt, skin.boothLine].join('|') : '';
    if (key === backKey) {
      backFaceMat.color.set(backTex ? '#ffffff' : theme.backboard);
      return;
    }
    if (skin && !defer) return;
    backKey = key;
    backTex?.dispose();
    backTex = null;
    backFaceMat.map = whiteTex;
    backFaceMat.color.set(theme.backboard);
    if (!skin || !defer) return;
    const painted = theme;
    defer(
      () => {
        const canvas = document.createElement('canvas');
        canvas.width = MATERIAL_TILE;
        canvas.height = MATERIAL_TILE;
        paintMaterialTile(
          canvas,
          skin.material,
          { base: painted.backboard, alt: skin.boothAlt, line: skin.boothLine },
          skin.material === 'planks' ? 'h' : 'v',
        );
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(30 / 2.4, 15 / 2.4);
        tex.anisotropy = 2;
        return tex;
      },
      (tex) => {
        if (backKey !== key) {
          tex.dispose();
          return;
        }
        backTex = tex;
        backFaceMat.map = tex;
        backFaceMat.color.set('#ffffff');
      },
    );
  };
  applyBackboard();

  let schedule: GallerySchedule = deriveGallerySchedule(7);
  let idleMode = true;

  // ── Pocks ──
  const POCKS = 28;
  const pockRimGeo = new THREE.CircleGeometry(0.115, 20);
  const pockHoleGeo = new THREE.CircleGeometry(0.07, 14);
  const pocks: { g: THREE.Group; at: number }[] = [];
  for (let i = 0; i < POCKS; i += 1) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(pockRimGeo, mats.pockRim!));
    const hole = new THREE.Mesh(pockHoleGeo, mats.pockHole!);
    hole.position.z = 0.003;
    g.add(hole);
    g.visible = false;
    group.add(g);
    pocks.push({ g, at: -1e9 });
  }
  let pockNext = 0;

  // ── Particles ──
  const chips: SpriteParticle[] = makeSpriteParticlePool({
    scene,
    count: 36,
    colors: [theme.spark, theme.valance, theme.duckBodyLo],
    size: 0.09,
  });
  const puffs: SpriteParticle[] = makeSpriteParticlePool({
    scene,
    count: 14,
    texture: discTex,
    colors: ['#e9dfcb'],
    size: 0.4,
  });
  const dust: SpriteParticle[] = makeSpriteParticlePool({
    scene,
    count: 14,
    texture: discTex,
    colors: ['#cdbfa6'],
    size: 0.3,
  });
  const lastFrame = { t: 0 };
  void lastFrame;

  // ── Gun state (damped), and shot events ──
  let aimSx = 0;
  let aimSy = 0.02;
  let yaw = 0;
  let pitch = 0;
  let kickAt = -1e9;
  let cockAt = -1e9;
  let flightStart = -1;
  let flightEnd = -1;
  const flightFrom = new THREE.Vector3();
  const flightTo = new THREE.Vector3();
  let flashAt = -1e9;
  const pending: Pending[] = [];
  let setupBaseT = 0;
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  const FLIGHT_LATE = 0;
  void FLIGHT_LATE;

  const aimPoint = (out: THREE.Vector3) =>
    out.set(
      GALLERY_CAMERA.x + aimSx * (GALLERY_CAMERA.z - AIM_PLANE_Z),
      GALLERY_CAMERA.y + aimSy * (GALLERY_CAMERA.z - AIM_PLANE_Z),
      AIM_PLANE_Z,
    );

  const applyAimTargets = () => {
    aimPoint(tmp);
    const dx = tmp.x - GUN_PIVOT.x;
    const dy = tmp.y - GUN_PIVOT.y;
    const dz = tmp.z - GUN_PIVOT.z;
    return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
  };
  {
    const a = applyAimTargets();
    yaw = a.yaw;
    pitch = a.pitch;
  }

  // Item sets: which rig draws the plate on each row.
  const placeItems = (t: number) => {
    GALLERY_ROWS.forEach((row, r) => {
      const plateIndex = schedule.plates[r]!;
      const plateRig = plateRigs[r]!;
      for (let i = 0; i < row.count; i += 1) {
        const rig = rowItems[r]![i]!;
        const kind = galleryItemKind(schedule, r, i);
        const x = galleryItemX(schedule, r, i, t);
        const hidden = Math.abs(x) > GALLERY_PANEL_X + 1.45;
        const target = kind === 'plate' ? plateRig : rig;
        const other = kind === 'plate' ? rig : null;
        if (other) other.root.visible = false;
        if (kind === 'plate') {
          plateRig.index = plateIndex;
        }
        target.root.visible = !hidden;
        target.index = i;
        if (hidden) continue;
        target.root.position.set(x, row.y + 0.11, row.z);
        // Ducks face their way of travel.
        if (target.kind === 'duck') target.root.scale.x = row.dir;
        applyAngle(target, t);
      }
    });
    const bx = galleryBonusX(schedule, t);
    if (bx === null) {
      bonus.root.visible = false;
      bonusHalo.visible = false;
    } else {
      bonus.root.visible = true;
      bonus.root.position.set(bx, GALLERY_BONUS.y + 0.11, GALLERY_BONUS.z);
      bonus.root.scale.x = schedule.bonus.dir;
      bonusHalo.visible = bonus.downAt === null;
      bonusHalo.position.set(bx, GALLERY_BONUS.y + 0.5, GALLERY_BONUS.z - 0.2);
      bonusHalo.material.opacity = 0.35 + 0.12 * Math.sin(t * 0.012);
      applyAngle(bonus, t);
    }
  };

  function applyAngle(rig: ItemRig, t: number) {
    // A plate that has been hit is spent until its chain carries it round again.
    if (rig.kind === 'plate' && rig.hitLap !== null) {
      if (galleryItemLap(schedule, rig.row, rig.index, Math.max(0, t)) !== rig.hitLap) {
        rig.hitLap = null;
        rig.downAt = null;
      }
    }
    rig.mat.color.setScalar(rig.kind === 'plate' && rig.hitLap !== null ? 0.42 : 1);
    let a = 0;
    let glow = 0;
    if (rig.downAt !== null) {
      const sDown = (t - rig.downAt) / 1000;
      if (rig.kind === 'plate') {
        a = reduced ? 0 : plateAngle(sDown);
        glow = Math.exp(-4 * Math.max(0, sDown)) * (sDown >= 0 ? 1 : 0);
      } else if (t < rig.upAt) {
        a = reduced ? FLIP_TARGET : flipDown(sDown);
        glow = Math.exp(-9 * Math.max(0, sDown)) * (sDown >= 0 ? 1 : 0);
      } else {
        const from = reduced ? FLIP_TARGET : flipDown((rig.upAt - rig.downAt) / 1000);
        a = reduced ? 0 : flipUp(from, (t - rig.upAt) / 1000);
      }
    }
    rig.pivot.rotation.x = -a;
    const e = rig.mat.emissive;
    if (glow > 0.001) {
      const hot = rig.kind === 'plate' ? '#ffd9a0' : '#ffffff';
      e.set(hot).multiplyScalar(0.55 * glow);
    } else {
      e.setRGB(0, 0, 0);
    }
  }

  // Idle: targets upright, still.
  const idleT = 2500;

  const sizeCamera = () => {
    const aspect = width / Math.max(1, height);
    // Portrait: fit the central 6 units of the middle row across the width and
    // see awning to counter. Landscape: the play area (rows and sign) fills the
    // height, the camera tips up a little, and the counter shrinks to its
    // gun. In between, a blend.
    const k = clamp01((aspect - 0.62) / 0.5);
    const dMid = GALLERY_CAMERA.z - GALLERY_ROWS[1]!.z;
    const halfW = 3.0;
    const vByWidth = 2 * Math.atan(halfW / dMid / aspect);
    const vMin = ((54 - 14 * k) * Math.PI) / 180;
    const fov = Math.min((68 * Math.PI) / 180, Math.max(vByWidth, vMin));
    camera.fov = (fov * 180) / Math.PI;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    lookAt.set(0, LOOK_AT.y + 0.6 * k, LOOK_AT.z);
    camera.position.copy(baseCamPos);
    camera.lookAt(lookAt);
    camera.updateMatrixWorld();
    rayCamera.fov = camera.fov;
    rayCamera.aspect = aspect;
    rayCamera.updateProjectionMatrix();
    rayCamera.position.copy(baseCamPos);
    rayCamera.lookAt(lookAt);
    rayCamera.updateMatrixWorld();
  };

  const kickPose = (t: number) => {
    const s = (t - kickAt) / 1000;
    const k = reduced ? 0 : kickCurve(s);
    gunBody.position.z = 0.22 * k;
    gunBody.rotation.x = 0.1 * k;
    // Pump: slide back and forward in the cadence window, after the kick.
    const c = (t - cockAt) / 1000;
    if (c >= 0 && c < 0.16 && !reduced) {
      const u = c / 0.16;
      slide.position.z = slideBase + 0.3 * Math.sin(Math.PI * u);
    } else {
      slide.position.z = slideBase;
    }
    muzzleCork.visible = (t - kickAt) / 1000 > 0.2 || t < kickAt;
  };

  const cameraBasis = { right: new THREE.Vector3(), up: new THREE.Vector3() };

  const api: GalleryScene = {
    camera,
    group,
    setSize(w, h) {
      width = w;
      height = h;
      sizeCamera();
    },
    setTheme(next, defer) {
      theme = next;
      mats.backboard!.color.set(theme.backboard);
      mats.backLine!.color.set(theme.backboardLine);
      mats.shelf!.color.set(theme.rail);
      mats.shelfTop!.color.set(theme.railHi);
      mats.counter!.color.set(counterColor(theme));
      mats.counterTop!.color.set(counterColor(theme));
      mats.stripeA!.color.set(theme.curtainA);
      mats.stripeB!.color.set(theme.curtainB);
      mats.stripeShade!.color.set(theme.curtainShade);
      mats.valance!.color.set(theme.valance);
      (flash.material as THREE.MeshBasicMaterial).color.set(theme.muzzle);
      (bonusHalo.material as THREE.MeshBasicMaterial).color.set(theme.valance);
      // The target's shape: swapped under the same rigs, so the hit box, the
      // flip and the schedule are untouched.
      const shape = theme.skin?.shape ?? 'duck';
      if (shape !== shapeKey) {
        shapeKey = shape;
        const old = [...duckGeos, goldGeo];
        const made = makeTargetGeos(shape);
        duckGeos = made.rows;
        goldGeo = made.gold;
        for (const rig of items) {
          rig.mesh.geometry = rig.kind === 'bonus' ? goldGeo : rig.kind === 'duck' ? duckGeos[rig.row]! : rig.mesh.geometry;
        }
        for (const g of old) g.dispose();
      } else {
        duckGeos.forEach((g, r) => paintDuck(g, rowBodies(r)));
        paintDuck(goldGeo, goldColors());
      }
      if (theme.skin || plateSkinned) {
        paintPlateColors(plateGeo, theme.skin ? theme : DEFAULT_TIN_DUCK_THEME);
        plateSkinned = Boolean(theme.skin);
      }
      applyBackboard(defer);
    },
    startRound(next, setupStart) {
      schedule = next;
      idleMode = false;
      setupBaseT = setupStart;
      pending.length = 0;
      for (const rig of items) {
        rig.ringAt = null;
        rig.hitLap = null;
        // The gallery sets itself: every target lies flat, then swings up,
        // row by row from the front.
        rig.downAt = -1e6;
        rig.upAt = setupStart + 80 + rig.row * 90 + (rig.index % 5) * 22;
      }
      bonus.downAt = null;
      for (const p of pocks) {
        p.g.visible = false;
        p.at = -1e9;
      }
      pockNext = 0;
      resetSpriteParticles(chips);
      resetSpriteParticles(puffs);
      resetSpriteParticles(dust);
      flightStart = -1;
      flightCork.visible = false;
      kickAt = -1e9;
      cockAt = -1e9;
      signKey = '';
    },
    idle() {
      idleMode = true;
      schedule = deriveGallerySchedule(7);
      for (const rig of items) {
        rig.downAt = null;
        rig.ringAt = null;
        rig.hitLap = null;
      }
      pending.length = 0;
      for (const p of pocks) p.g.visible = false;
      flightCork.visible = false;
    },
    setAim(sx, sy) {
      aimSx = sx;
      aimSy = sy;
    },
    fire(t, target, impact, hit) {
      kickAt = t;
      cockAt = t + 70;
      flashAt = t;
      // The muzzle at fire time, from the current gun pose.
      gunBody.updateWorldMatrix(true, true);
      muzzleMarker.getWorldPosition(flightFrom);
      flightTo.set(target.x, target.y, target.z);
      const dist = flightFrom.distanceTo(flightTo);
      const ms = Math.max(30, (dist / CORK_SPEED) * 1000);
      flightStart = t;
      flightEnd = t + ms;
      const at = t + ms;
      pending.push({ at, event: impact, hit });
      if (hit) {
        // The server's hit time is the fire time; the visual starts when the cork lands.
        const rig = hit.kind === 'bonus' ? bonus : hit.row < GALLERY_ROWS.length && galleryItemKind(schedule, hit.row, hit.index) === 'plate' ? plateRigs[hit.row]! : rowItems[hit.row]![hit.index]!;
        rig.downAt = at;
        rig.upAt =
          hit.kind === 'bonus'
            ? Infinity
            : hit.kind === 'plate' || hit.kind === 'bullseye'
              ? Infinity
              : t + GALLERY_DUCK_DOWN_MS - 130;
        if (hit.kind === 'plate' || hit.kind === 'bullseye') rig.hitLap = galleryItemLap(schedule, hit.row, hit.index, t);
      }
      // Muzzle smoke, one puff, rising slowly.
      if (!reduced) {
        emitSpriteParticles(puffs, midwayParticleCount(2, tier), {
          origin: [flightFrom.x, flightFrom.y, flightFrom.z],
          spread: 0.05,
          speed: [0.1, 0.5],
          up: [0.2, 0.7],
          ttl: [0.35, 0.6],
          size: [0.22, 0.3],
          grow: 1.6,
          fade: 0.55,
        });
      }
      return ms;
    },
    dry(t) {
      cockAt = t;
    },
    update(t, dtMs, hud, ammo, shakePx, onImpact) {
      const dt = Math.min(0.05, dtMs / 1000);
      // Impacts that have landed.
      for (let i = pending.length - 1; i >= 0; i -= 1) {
        const p = pending[i]!;
        if (t < p.at) continue;
        pending.splice(i, 1);
        if (p.event.type === 'pock') {
          const pk = pocks[pockNext % POCKS]!;
          pockNext += 1;
          pk.at = p.at;
          pk.g.visible = true;
          if (p.event.flat) {
            pk.g.position.set(p.event.x, p.event.y + 0.012, p.event.z);
            pk.g.rotation.set(-Math.PI / 2, 0, 0);
          } else {
            pk.g.position.set(p.event.x, p.event.y, p.event.z + 0.012);
            pk.g.rotation.set(0, 0, 0);
          }
          emitSpriteParticles(dust, midwayParticleCount(3, tier), {
            origin: [p.event.x, p.event.y, p.event.z + 0.05],
            spread: 0.05,
            speed: [0.1, 0.6],
            up: [0.0, 0.5],
            ttl: [0.3, 0.5],
            size: [0.14, 0.2],
            grow: 1.2,
            fade: 0.45,
          });
        } else {
          const e = p.event;
          if (!reduced) {
            emitSpriteParticles(chips, midwayParticleCount(e.kind === 'bonus' || e.kind === 'bullseye' ? 14 : 8, tier), {
              origin: [e.x, e.y, e.z + 0.2],
              spread: 0.3,
              speed: [0.8, 2.6],
              up: [0.8, 2.6],
              ttl: [0.35, 0.7],
              size: [0.5, 1.1],
              fade: 1,
              spin: 14,
            });
          }
        }
        onImpact(p.event);
      }

      // Items.
      if (idleMode) placeItems(idleT);
      else placeItems(Math.max(t, setupBaseT));

      // Chains scroll with their rows.
      const tc = idleMode ? idleT : Math.max(t, setupBaseT);
      GALLERY_ROWS.forEach((row, r) => {
        chainTex[r]!.offset.x = -(row.dir * row.speed * tc) / 1000 / chainPitch;
      });
      chainTex[GALLERY_ROWS.length]!.offset.x = (schedule.bonus.dir * GALLERY_BONUS.speed * tc) / 1000 / chainPitch;

      // Gun follows the aim, damped on the frame's real time.
      const target = applyAimTargets();
      yaw = expDamp(yaw, target.yaw, 34, dt);
      pitch = expDamp(pitch, target.pitch, 34, dt);
      gun.rotation.set(pitch, yaw, 0, 'YXZ');
      kickPose(tc);

      // Cork flight and flash.
      if (flightStart >= 0 && t >= flightStart && t <= flightEnd) {
        const k = (t - flightStart) / Math.max(1, flightEnd - flightStart);
        flightCork.visible = true;
        flightCork.position.lerpVectors(flightFrom, flightTo, k);
        tmp2.copy(flightTo).sub(flightFrom).normalize();
        flightCork.lookAt(tmp2.add(flightCork.position));
        flightCork.scale.setScalar(0.75 * (1 - 0.35 * k));
      } else {
        flightCork.visible = false;
      }
      const fs = (t - flashAt) / 1000;
      if (fs >= 0 && fs < 0.07 && !reduced) {
        flash.visible = true;
        muzzleMarker.getWorldPosition(tmp);
        flash.position.copy(tmp);
        flash.quaternion.copy(camera.quaternion);
        const k = 1 - fs / 0.07;
        flash.scale.setScalar(0.25 + 0.55 * (1 - k * k));
        (flash.material as THREE.MeshBasicMaterial).opacity = 0.9 * k;
      } else {
        flash.visible = false;
      }

      // Pocks pop in.
      for (const pk of pocks) {
        if (!pk.g.visible) continue;
        const s = (t - pk.at) / 1000;
        const k = reduced ? 1 : s >= 0.1 ? 1 : 1 + 0.35 * Math.sin((clamp01(s / 0.1)) * Math.PI);
        pk.g.scale.setScalar(Math.min(1.35, k));
      }

      // Corks on the counter.
      for (let i = 0; i < GALLERY_MAG_SIZE; i += 1) {
        const cork = corks[i]!;
        let visible = i < ammo.shown;
        let scale = 1;
        let lift = 0;
        if (ammo.shown === 0 && ammo.reloadFrac > 0) {
          const k = ammo.reloadFrac * (GALLERY_MAG_SIZE + 0.5);
          visible = k > i + 0.2;
          const s = clamp01((k - (i + 0.2)) / 0.6);
          if (visible && !reduced) {
            lift = 0.16 * Math.sin(s * Math.PI);
            scale = 0.7 + 0.3 * s;
          }
        }
        cork.visible = visible;
        cork.position.y = 1.23 + lift;
        cork.scale.setScalar(scale);
      }

      stepSpriteParticles(chips, dt, 7.5, 0.8);
      stepSpriteParticles(puffs, dt, -0.2, 2.2);
      stepSpriteParticles(dust, dt, 0.2, 3);

      paintSign(hud);

      // Shake: a pixel offset of the camera, never of the rays.
      camera.position.copy(baseCamPos);
      if (shakePx.x !== 0 || shakePx.y !== 0) {
        const worldPerPx = (2 * 10 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, height);
        camera.matrixWorld.extractBasis(cameraBasis.right, cameraBasis.up, tmp);
        camera.position.addScaledVector(cameraBasis.right, -shakePx.x * worldPerPx);
        camera.position.addScaledVector(cameraBasis.up, shakePx.y * worldPerPx);
      }
      camera.updateMatrixWorld();
    },
    project(x, y, z, out) {
      tmp.set(x, y, z).project(rayCamera);
      out.x = ((tmp.x + 1) / 2) * width;
      out.y = ((1 - tmp.y) / 2) * height;
    },
    probe(t) {
      const list: ReturnType<GalleryScene['probe']> = [];
      const p = { x: 0, y: 0 };
      const q = { x: 0, y: 0 };
      const addOne = (kind: string, row: number, wx: number, wy: number, wz: number, radius: number) => {
        api.project(wx, wy, wz, p);
        api.project(wx + radius, wy, wz, q);
        list.push({ x: p.x, y: p.y, kind, row, r: Math.abs(q.x - p.x), wx, wy, wz });
      };
      GALLERY_ROWS.forEach((row, r) => {
        for (let i = 0; i < row.count; i += 1) {
          const x = galleryItemX(schedule, r, i, t);
          if (Math.abs(x) > 4.2) continue;
          const kind = galleryItemKind(schedule, r, i);
          const rig = kind === 'plate' ? plateRigs[r]! : rowItems[r]![i]!;
          if (kind === 'plate' ? rig.hitLap !== null : rig.downAt !== null && t - rig.downAt < GALLERY_DUCK_DOWN_MS + 100 && rig.downAt > -1e5) continue;
          addOne(kind, r, x, row.y + GALLERY_TARGET_LIFT, row.z, kind === 'plate' ? 0.56 : 0.5);
        }
      });
      const bx = galleryBonusX(schedule, t);
      if (bx !== null && bonus.downAt === null) addOne('bonus', GALLERY_ROWS.length, bx, GALLERY_BONUS.y + GALLERY_TARGET_LIFT, GALLERY_BONUS.z, GALLERY_BONUS.radius);
      return list;
    },
    slopes(px, py, out) {
      tmp.set((px / width) * 2 - 1, -((py / height) * 2 - 1), 0.5).unproject(rayCamera);
      tmp.sub(rayCamera.position);
      out.x = tmp.x / -tmp.z;
      out.y = tmp.y / -tmp.z;
    },
    surfaceFor(sx, sy) {
      const cam = GALLERY_CAMERA;
      // Shelf fronts and tops, nearest row first; else the backboard.
      for (let r = 0; r < GALLERY_ROWS.length; r += 1) {
        const row = GALLERY_ROWS[r]!;
        const zf = row.z + ROW_SHELF_DEPTH / 2;
        const reach = cam.z - zf;
        const y = cam.y + sy * reach;
        const x = cam.x + sx * reach;
        if (y <= row.y && y >= row.y - 0.34 && Math.abs(x) < 5.6) return { x, y, z: zf, flat: false };
        // Shelf top.
        if (sy < 0) {
          const reachTop = (cam.y - row.y) / -sy;
          const zt = cam.z - reachTop;
          if (zt <= zf && zt >= row.z - ROW_SHELF_DEPTH / 2) return { x: cam.x + sx * reachTop, y: row.y + 0.02, z: zt, flat: true };
        }
      }
      const reach = cam.z - GALLERY_BACKBOARD_Z;
      return { x: cam.x + sx * reach, y: cam.y + sy * reach, z: GALLERY_BACKBOARD_Z, flat: false };
    },
    muzzle(out) {
      gunBody.updateWorldMatrix(true, true);
      return muzzleMarker.getWorldPosition(out);
    },
    warm(renderer) {
      // Compile everything that first shows mid-run while the page is idle.
      const hidden: THREE.Object3D[] = [];
      scene.traverse((o) => {
        if (!o.visible) {
          hidden.push(o);
          o.visible = true;
        }
      });
      renderer.compile(scene, camera);
      for (const o of hidden) o.visible = false;
    },
    setReduced(value) {
      reduced = value;
    },
    dispose() {
      discTex.dispose();
      chainTex.forEach((t) => t.dispose());
      signTex.dispose();
      backTex?.dispose();
      whiteTex.dispose();
    },
  };
  // Everything that never moves stops recomputing its matrix every frame.
  {
    const dynamic = new Set<THREE.Object3D>([
      group, gun, gunBody, slide, muzzleMarker, muzzleCork, flightCork, flash, bonusHalo,
      ...items.flatMap((rig) => [rig.root, rig.pivot]),
      ...pocks.map((p) => p.g),
      ...corks,
    ]);
    group.traverse((o) => {
      // One shadow setting for every lit mesh, so they share their programs.
      if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material instanceof THREE.MeshLambertMaterial) {
        o.receiveShadow = true;
      }
      if (dynamic.has(o)) return;
      o.updateMatrix();
      o.matrixAutoUpdate = false;
    });
  }
  sizeCamera();
  api.idle();
  placeItems(idleT);
  for (const rig of items) applyAngle(rig, idleT);
  void rowBodies;
  return api;
}
