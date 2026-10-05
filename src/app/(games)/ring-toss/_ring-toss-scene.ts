/**
 * The ring toss booth as a three.js scene.
 *
 * Everything the ring can touch is built from the engine's constants
 * (`ring-toss-engine.ts`): the bottles are lathed from BOTTLE_PROFILE, the
 * crate walls and the platform are its boxes, so what you see is what the
 * ring hits. The engine throws down +z; the scene draws it mirrored to -z so
 * the camera looks down three.js's -z with +x to the right (a reflection,
 * invisible on round things). Nothing here decides a score.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { MATERIAL_TILE, paintMaterialTile } from '@/features/arcade/lib/skins/skin-material-canvas';
import { mixHex } from '@/features/arcade/lib/skins/skin-set';

import {
  MIDWAY_PALETTE,
  emitSpriteParticles,
  makeSoftDiscTexture,
  makeSparkTexture,
  makeSpriteParticlePool,
  midwayCanvasFont,
  midwayParticleCount,
  resetSpriteParticles,
  stepSpriteParticles,
  type MidwayTier,
  type SpriteParticle,
} from '@/features/arcade/lib/midway-three';
import {
  BOTTLES,
  BOTTLE_PROFILE,
  BACKBOARD_H,
  BACKBOARD_HALF_X,
  BACKBOARD_T,
  BACKBOARD_Z,
  CRATE_BOXES,
  CRATE_HALF,
  CRATE_HALF_Z,
  CRATE_PITCH,
  CRATE_ROWS,
  CRATE_WALL_H,
  CRATE_Z,
  GOLD_VALUE,
  HAND_HALF,
  HAND_Y,
  HAND_Z,
  PLATFORM_HALF_X,
  RING_AIM_Y,
  PLATFORM_Z0,
  PLATFORM_Z1,
  RING_COUNT,
  RING_R,
  RING_TUBE,
  ROW_VALUES,
} from '@/server/arcade/ring-toss-engine';

import { DEFAULT_RING_TOSS_THEME, type RingShape, type RingTossTheme } from './_ring-toss-theme';

/** Engine z to scene z. */
const Z = (z: number) => -z;

/** The camera: your eye, behind and above the ring in your hand. */
const CAM_Y = 0.95;
const CAM_Z = -0.05;
export const CAMERA_POS: [number, number, number] = [0, CAM_Y, Z(CAM_Z)];
/** The top of the backboard (the sign), or of the arc, and the bottom of the ring in the hand. */
const BACK_WALL_Z = PLATFORM_Z1 + 0.55;
const TOP_ANGLE = Math.max(Math.atan2(BACKBOARD_H + 0.02 - CAM_Y, BACKBOARD_Z - CAM_Z), Math.atan2(0.5 - CAM_Y, (HAND_Z + CRATE_Z) / 2 - CAM_Z)) + 0.03;
const BOTTOM_ANGLE = Math.atan2(HAND_Y - 0.075 - CAM_Y, HAND_Z - 0.03 - CAM_Z);
const PITCH = (TOP_ANGLE + BOTTOM_ANGLE) / 2;
const V_NEEDED = TOP_ANGLE - BOTTOM_ANGLE;
const LOOK_AT = new THREE.Vector3(0, CAM_Y + Math.tan(PITCH) * (CRATE_Z - CAM_Z), Z(CRATE_Z));
const CRATE_DIST = Math.sqrt((CRATE_Z - CAM_Z) ** 2 + (CAM_Y - 0.12) ** 2);
export const RIG_TARGET: [number, number, number] = [0, 0.1, Z(CRATE_Z)];
export const RIG_RADIUS = 0.75;

const GLASS_GOLD = '#f2a33c';

export type RingPose = { x: number; y: number; z: number; qw: number; qx: number; qy: number; qz: number };

export type SignState = {
  score: number;
  ringsLeft: number;
  seconds: number;
  warn: boolean;
  /** A short word in place of the score for a moment ("ringer", "gold"). */
  flash: string | null;
};

export interface RingTossScene {
  camera: THREE.PerspectiveCamera;
  setSize(width: number, height: number): void;
  setReduced(reduced: boolean): void;
  /** Colours, the crate's material and the ring's shape. Moves nothing. */
  setTheme(theme: RingTossTheme): void;
  /** The ring in the hand: hand position -1..1, lift 0..1, lean -1..1. */
  setHand(h: number, lift: number, lean: number, visible: boolean, colorIndex: number): void;
  /** The flying ring. Null hides it. */
  setLive(pose: RingPose | null, colorIndex: number): void;
  /** Put ring `i` at rest at `pose` (null clears it). */
  setResting(i: number, pose: RingPose | null, colorIndex: number): void;
  /** Which bottle is gold (-1 for none). */
  setGold(index: number): void;
  /** Light a bottle for a ringer at wall time `now`. */
  flashBottle(index: number, now: number, gold: boolean): void;
  /** Sparks and a ring of light at a neck. */
  burst(index: number, gold: boolean): void;
  /** A little dust where a ring hit wood. */
  dust(x: number, y: number, z: number, force: number): void;
  paintSign(state: SignState): void;
  /** Engine coordinates to CSS px on the canvas. */
  project(x: number, y: number, z: number, out: { x: number; y: number }): void;
  /** Screen x (CSS px) to a hand position -1..1. */
  handFromScreenX(px: number): number;
  /** The hand's screen x (CSS px) for a hand position. */
  handScreenX(h: number): number;
  /** The x at neck height and engine depth z that sits under screen x (CSS px). */
  sightX(px: number, z: number): number;
  update(now: number, dtSec: number, shake: { x: number; y: number }): void;
  /** Compile what first shows mid-run. */
  warm(renderer: THREE.WebGLRenderer): void;
  resetRound(): void;
  dispose(): void;
}

function latheGeometry(segments: number): THREE.BufferGeometry {
  // Bottom to top for LatheGeometry; add the base's centre.
  const pts = [new THREE.Vector2(0, 0), ...BOTTLE_PROFILE.slice().reverse().map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y))];
  const geo = new THREE.LatheGeometry(pts, segments);
  // Vertex colours: a flat highlight stripe down the left of the glass, and a
  // dark mouth. Instance colours multiply over them.
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ang = Math.atan2(z, x);
    let k = 1;
    // A narrow stripe facing up-left of the camera.
    const d = Math.abs(ang - 2.25);
    if (d < 0.28 && y > 0.02 && y < 0.185) k = 1.9;
    else if (d < 0.5 && y > 0.02 && y < 0.185) k = 1.3;
    const rr = Math.sqrt(x * x + z * z);
    if (y > 0.1995 && rr < 0.0123) k = 0.18;
    colors[i * 3] = k;
    colors[i * 3 + 1] = k;
    colors[i * 3 + 2] = k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/* The ring's shapes. Each sits inside the engine's collider (centre radius
   RING_R, tube RING_TUBE) and is split into two draw groups: the body, and
   three bands of tape so the spin reads in the air. */
function ringGeometry(shape: RingShape, tier: MidwayTier): THREE.BufferGeometry {
  const low = tier === 'low';
  let geo: THREE.BufferGeometry;
  if (shape === 'band') {
    // A flat band, like a quoit: square in section, a little flatter than the tube.
    const t = RING_TUBE;
    const h = RING_TUBE * 0.7;
    const pts = [
      [RING_R - t, -h],
      [RING_R + t, -h],
      [RING_R + t, h],
      [RING_R - t, h],
      [RING_R - t, -h],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    geo = new THREE.LatheGeometry(pts, low ? 28 : 44);
  } else if (shape === 'rope') {
    // Three twisted strands: the tube's radius ripples along a helix.
    const tub = low ? 56 : 84;
    const rad = low ? 8 : 12;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= tub; i += 1) {
      const u = (i / tub) * Math.PI * 2;
      for (let j = 0; j <= rad; j += 1) {
        const v = (j / rad) * Math.PI * 2;
        const r = RING_TUBE * (0.84 + 0.16 * Math.cos(3 * v - 21 * u));
        pos.push((RING_R + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v), (RING_R + r * Math.cos(v)) * Math.sin(u));
      }
    }
    for (let i = 0; i < tub; i += 1) {
      for (let j = 0; j < rad; j += 1) {
        const a = i * (rad + 1) + j;
        const b = (i + 1) * (rad + 1) + j;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
  } else if (shape === 'beads') {
    const beads: THREE.BufferGeometry[] = [];
    const n = 16;
    for (let k = 0; k < n; k += 1) {
      const a = (k / n) * Math.PI * 2;
      const b = new THREE.SphereGeometry(RING_TUBE * 1.02, low ? 6 : 8, low ? 5 : 6);
      b.deleteAttribute('uv');
      b.translate(RING_R * Math.cos(a), 0, RING_R * Math.sin(a));
      beads.push(b);
    }
    geo = mergeGeometries(beads, false)!;
    for (const b of beads) b.dispose();
  } else {
    geo = new THREE.TorusGeometry(RING_R, RING_TUBE, low ? 8 : 10, low ? 28 : 40);
    // Torus lies in xy; the engine's ring lies in its body xz plane.
    geo.rotateX(Math.PI / 2);
  }
  // Split into body (group 0) and tape (group 1) by each triangle's angle.
  const flat = geo.index ? geo.toNonIndexed() : geo;
  if (flat !== geo) geo.dispose();
  const src = flat.getAttribute('position');
  const body: number[] = [];
  const tape: number[] = [];
  for (let tri = 0; tri < src.count; tri += 3) {
    let cx = 0;
    let cz = 0;
    for (let k = 0; k < 3; k += 1) {
      cx += src.getX(tri + k);
      cz += src.getZ(tri + k);
    }
    const band = ((Math.atan2(cz, cx) + Math.PI) * 3) / (Math.PI * 2);
    const out = band - Math.floor(band) < 0.16 ? tape : body;
    for (let k = 0; k < 3; k += 1) out.push(src.getX(tri + k), src.getY(tri + k), src.getZ(tri + k));
  }
  flat.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute([...body, ...tape], 3));
  out.computeVertexNormals();
  out.addGroup(0, body.length / 3, 0);
  out.addGroup(body.length / 3, tape.length / 3, 1);
  return out;
}

export function createRingTossScene(scene: THREE.Scene, tier: MidwayTier, initialTheme: RingTossTheme = DEFAULT_RING_TOSS_THEME): RingTossScene {
  let theme = initialTheme;
  const group = new THREE.Group();
  scene.add(group);
  let reduced = false;
  let width = 390;
  let height = 700;

  const camera = new THREE.PerspectiveCamera(40, width / height, 0.05, 30);
  camera.position.set(...CAMERA_POS);
  camera.lookAt(LOOK_AT);
  const baseCam = camera.position.clone();

  const lam = (color: string) => new THREE.MeshLambertMaterial({ color });
  const whiteMap = () => {
    const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  const mats = {
    wall: lam(theme.booth),
    wallSeam: lam(theme.boothSeam),
    awnA: lam(MIDWAY_PALETTE.red),
    awnB: lam(MIDWAY_PALETTE.paper),
    platform: lam(theme.platform),
    platformTop: lam(theme.platformTop),
    skirt: lam(MIDWAY_PALETTE.ink),
    stripe: lam(MIDWAY_PALETTE.ticket),
    // The crate's walls carry a 1 x 1 white map from the start, so a skin's
    // material is a texture swap and not a shader recompile.
    crate: new THREE.MeshLambertMaterial({ color: theme.crate, map: whiteMap() }),
    crateDark: lam(theme.crateDark),
    divider: lam('#6e4e2c'),
    post: lam(MIDWAY_PALETTE.wood),
    metal: lam('#3b332c'),
    counter: lam(theme.counter),
  };
  // Everything built through `add` is fixed: merged by material at the end,
  // so the booth is a handful of draws.
  const statics: THREE.Mesh[] = [];
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = group) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    statics.push(m);
    return m;
  };
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

  // ── The booth: back wall with plank seams, posts, a scalloped awning ──
  const BACK_Z = Z(BACK_WALL_Z);
  add(new THREE.PlaneGeometry(6, 4), mats.wall, 0, 0.9, BACK_Z);
  for (let i = -8; i <= 8; i += 1) add(box(0.012, 4, 0.004), mats.wallSeam, i * 0.16, 0.9, BACK_Z + 0.002);
  // A paper rail along the wall, at sign height.
  add(box(6, 0.02, 0.01), mats.stripe, 0, 0.48, BACK_Z + 0.005);
  {
    const STRIPES = 18;
    const AW_W = 2.4;
    const sw = AW_W / STRIPES;
    const y = 0.98;
    const z = Z(PLATFORM_Z0 + 0.05);
    const scallop = new THREE.CircleGeometry(sw / 2, 16, Math.PI, Math.PI);
    for (let i = 0; i < STRIPES; i += 1) {
      const x = -AW_W / 2 + sw * (i + 0.5);
      const mat = i % 2 === 0 ? mats.awnA : mats.awnB;
      const slab = add(box(sw, 0.012, 1.4), mat, x, y + 0.2, z - 0.62);
      slab.rotation.x = 0.28;
      add(box(sw, 0.09, 0.006), mat, x, y - 0.045, z);
      const sc = add(scallop, mat, x, y - 0.09, z + 0.001);
      (sc.material as THREE.Material).side = THREE.DoubleSide;
    }
    mats.awnA.side = THREE.DoubleSide;
    mats.awnB.side = THREE.DoubleSide;
    for (const side of [-1, 1]) add(box(0.05, 1.8, 0.05), mats.post, side * 0.62, 0.1, Z(PLATFORM_Z0 + 0.1));
  }

  // Boardwalk floor, far below the platform's top, and the booth's sides.
  const floor = add(new THREE.PlaneGeometry(6, 6), lam('#3a2b20'), 0, -0.72, Z(1.2));
  floor.rotation.x = -Math.PI / 2;
  for (let i = -12; i <= 12; i += 1) {
    const seam = add(box(0.008, 0.002, 6), mats.wallSeam, i * 0.13, -0.719, Z(1.2));
    seam.receiveShadow = false;
  }
  for (const side of [-1, 1]) add(box(0.04, 2.2, 3.2), mats.wall, side * 1.05, 0.3, Z(1.0));

  // Your counter, under the ring in your hand: not something a ring can hit.
  const COUNTER_TOP = HAND_Y - 0.11;
  const COUNTER_FRONT = HAND_Z + 0.19;
  const counterTop = add(box(1.6, 0.03, 0.6), mats.counter, 0, COUNTER_TOP - 0.015, Z(COUNTER_FRONT - 0.3));
  counterTop.receiveShadow = true;
  add(box(1.6, 0.012, 0.006), mats.stripe, 0, COUNTER_TOP - 0.006, Z(COUNTER_FRONT) - 0.001);

  // ── The platform (engine box id 200) ──
  const plat = CRATE_BOXES[5]!;
  const platW = plat.x1 - plat.x0;
  const platD = plat.z1 - plat.z0;
  const platH = plat.y1 - plat.y0;
  const platformMesh = add(box(platW, platH, platD), mats.platform, 0, (plat.y0 + plat.y1) / 2, Z((plat.z0 + plat.z1) / 2));
  platformMesh.receiveShadow = true;
  const platTop = add(box(platW + 0.004, 0.004, platD + 0.004), mats.platformTop, 0, -0.0015, Z((plat.z0 + plat.z1) / 2));
  platTop.receiveShadow = true;
  // Plank seams on the top, across the throw.
  for (let i = 1; i < 9; i += 1) {
    add(box(platW, 0.0012, 0.003), mats.crateDark, 0, 0.0004, Z(PLATFORM_Z0 + (i * (PLATFORM_Z1 - PLATFORM_Z0)) / 9));
  }
  // A ticket stripe along the front edge.
  add(box(platW + 0.012, 0.01, 0.005), mats.stripe, 0, -0.012, Z(PLATFORM_Z0) + 0.004);

  // ── The crate: walls (ids 100 to 103), dividers, slats ──
  for (let i = 0; i < 4; i += 1) {
    const b = CRATE_BOXES[i]!;
    const w = b.x1 - b.x0;
    const h = b.y1 - b.y0;
    const d = b.z1 - b.z0;
    const m = add(box(w, h, d), mats.crate, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, Z((b.z0 + b.z1) / 2));
    m.castShadow = true;
    m.receiveShadow = true;
    // A darker slat seam halfway up each wall.
    add(box(w + 0.001, 0.004, d + 0.001), mats.crateDark, (b.x0 + b.x1) / 2, h * 0.5, Z((b.z0 + b.z1) / 2));
  }
  // Dividers between the cells: low, under any ring's rest.
  const DIV_H = 0.05;
  for (let c = 1; c < 4; c += 1) {
    add(box(0.004, DIV_H, CRATE_HALF_Z * 2), mats.divider, -CRATE_HALF + c * CRATE_PITCH, DIV_H / 2, Z(CRATE_Z));
  }
  for (let r = 1; r < CRATE_ROWS; r += 1) {
    add(box(CRATE_HALF * 2, DIV_H, 0.004), mats.divider, 0, DIV_H / 2, Z(CRATE_Z - CRATE_HALF_Z + r * CRATE_PITCH));
  }
  // Crate floor.
  add(box(CRATE_HALF * 2, 0.004, CRATE_HALF_Z * 2), mats.crateDark, 0, 0.002, Z(CRATE_Z));

  // Row values painted on the platform beside the crate, both sides.
  const valueTex: THREE.CanvasTexture[] = [];
  const valuePaints: Array<() => void> = [];
  const paintValue = (text: string, color: () => string) => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 96;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    const paint = () => {
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, 128, 96);
      ctx.fillStyle = color();
      ctx.font = midwayCanvasFont('num', 800, 84);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 64, 52);
      t.needsUpdate = true;
    };
    paint();
    valuePaints.push(paint);
    valueTex.push(t);
    return t;
  };
  // Big Shoulders may land after the first paint: paint again when it does.
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    void document.fonts.ready.then(() => {
      for (const paint of valuePaints) paint();
    });
  }
  for (let r = 0; r < CRATE_ROWS; r += 1) {
    const tex = paintValue(String(ROW_VALUES[r]), () => theme.mark);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    for (const side of [-1, 1]) {
      const m = add(new THREE.PlaneGeometry(0.085, 0.064), mat, side * (CRATE_HALF + 0.07), 0.0012, Z(BOTTLES[r * 4]!.z));
      m.rotation.x = -Math.PI / 2;
    }
  }

  // ── Bottles: one instanced mesh, lathed from the engine's profile ──
  const segs = tier === 'low' ? 14 : 22;
  const bottleGeo = latheGeometry(segs);
  const bottleMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const bottles = new THREE.InstancedMesh(bottleGeo, bottleMat, BOTTLES.length);
  bottles.castShadow = true;
  bottles.receiveShadow = true;
  const tmpM = new THREE.Matrix4();
  const tmpC = new THREE.Color();
  BOTTLES.forEach((b, i) => {
    tmpM.makeTranslation(b.x, 0, Z(b.z));
    bottles.setMatrixAt(i, tmpM);
    bottles.setColorAt(i, tmpC.set(theme.glassRows[b.row]!));
  });
  bottles.instanceMatrix.needsUpdate = true;
  if (bottles.instanceColor) bottles.instanceColor.needsUpdate = true;
  // In front of the booth: drawn before the merged walls (see the merge below).
  bottles.renderOrder = 5;
  group.add(bottles);
  let gold = -1;
  const flashes = new Map<number, { at: number; gold: boolean }>();
  const baseColor = (i: number) => (i === gold ? GLASS_GOLD : theme.glassRows[BOTTLES[i]!.row]!);
  const paintBottle = (i: number, now: number) => {
    const f = flashes.get(i);
    tmpC.set(baseColor(i));
    if (f) {
      const age = (now - f.at) / 1000;
      const k = reduced ? (age < 0.12 ? 1 : 0) : Math.exp(-age * 3.2);
      if (k < 0.01) flashes.delete(i);
      else tmpC.lerp(new THREE.Color(f.gold ? '#fff2c2' : MIDWAY_PALETTE.paper), k * 0.85);
    }
    bottles.setColorAt(i, tmpC);
  };

  // The gold bottle's halo: a soft disc behind the neck, facing the camera.
  const discTex = makeSoftDiscTexture(64);
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(0.11, 0.11),
    new THREE.MeshBasicMaterial({ map: discTex, color: GLASS_GOLD, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  halo.visible = false;
  group.add(halo);
  // Its value floats over the neck: "100".
  const goldTex = paintValue(String(GOLD_VALUE), () => GLASS_GOLD);
  const goldTag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.07, 0.0525),
    new THREE.MeshBasicMaterial({ map: goldTex, transparent: true, depthWrite: false, depthTest: false }),
  );
  goldTag.renderOrder = 5;
  goldTag.visible = false;
  group.add(goldTag);

  // ── Rings ──
  let ringGeo = ringGeometry(theme.shape, tier);
  let ringShape: RingShape = theme.shape;
  const tapeOf = (c: string) => theme.ringMark ?? mixHex(c, MIDWAY_PALETTE.ink, 0.45);
  // One body and one tape material per ring colour, in throw order.
  const ringMats: [THREE.MeshLambertMaterial, THREE.MeshLambertMaterial][] = [0, 1, 2].map((i) => {
    const c = theme.rings[i % theme.rings.length]!;
    return [lam(c), lam(tapeOf(c))];
  });
  const ringMat = (colorIndex: number) => ringMats[colorIndex % ringMats.length]!;
  const allRings: THREE.Mesh[] = [];
  const makeRing = () => {
    const m = new THREE.Mesh(ringGeo, ringMats[0]);
    m.castShadow = true;
    m.visible = false;
    group.add(m);
    allRings.push(m);
    return m;
  };
  const live = makeRing();
  const hand = makeRing();
  const resting: THREE.Mesh[] = Array.from({ length: RING_COUNT }, makeRing);
  // Soft contact shadow under the live ring.
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: discTex, color: '#000000', transparent: true, opacity: 0.35, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.visible = false;
  group.add(blob);

  const q = new THREE.Quaternion();
  const placeRing = (mesh: THREE.Mesh, pose: RingPose) => {
    mesh.position.set(pose.x, pose.y, Z(pose.z));
    // Mirror z: (w, x, y, z) -> (w, -x, -y, z).
    q.set(-pose.qx, -pose.qy, pose.qz, pose.qw);
    mesh.quaternion.copy(q);
  };

  // ── Particles ──
  const sparkTex = makeSparkTexture(32);
  const sparks: SpriteParticle[] = makeSpriteParticlePool({
    scene: group as unknown as THREE.Scene,
    count: 36,
    texture: sparkTex,
    colors: [MIDWAY_PALETTE.ticket, MIDWAY_PALETTE.paper, '#fff2c2'],
    size: 0.02,
    blending: THREE.AdditiveBlending,
  });
  const dustPool: SpriteParticle[] = makeSpriteParticlePool({
    scene: group as unknown as THREE.Scene,
    count: 12,
    texture: discTex,
    colors: ['#b8a58a', '#9c8a70'],
    size: 0.03,
  });
  // A ring of light that grows out from a ringed neck.
  const pulse = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1, 40),
    new THREE.MeshBasicMaterial({ color: MIDWAY_PALETTE.ticket, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
  );
  pulse.rotation.x = -Math.PI / 2;
  pulse.visible = false;
  group.add(pulse);
  let pulseAt = -1e9;

  // ── The sign on the back wall: score, rings left, the clock ──
  const SIGN_W = BACKBOARD_HALF_X * 2;
  const SIGN_H = BACKBOARD_H * 0.42;
  const signCanvas = document.createElement('canvas');
  signCanvas.width = 760;
  signCanvas.height = 160;
  const signTex = new THREE.CanvasTexture(signCanvas);
  signTex.colorSpace = THREE.SRGBColorSpace;
  signTex.anisotropy = 4;
  // The backboard (engine box 104): ink, the sign on its upper part.
  const board = add(box(SIGN_W, BACKBOARD_H, BACKBOARD_T), mats.skirt, 0, BACKBOARD_H / 2, Z(BACKBOARD_Z + BACKBOARD_T / 2));
  board.receiveShadow = true;
  add(box(SIGN_W + 0.004, 0.01, BACKBOARD_T + 0.004), mats.stripe, 0, BACKBOARD_H, Z(BACKBOARD_Z + BACKBOARD_T / 2));
  add(new THREE.PlaneGeometry(SIGN_W, SIGN_H), new THREE.MeshBasicMaterial({ map: signTex }), 0, BACKBOARD_H - SIGN_H / 2 - 0.006, Z(BACKBOARD_Z) + 0.0015);
  let signKey = '';
  const paintSign = (s: SignState) => {
    const key = `${s.score}|${s.ringsLeft}|${s.seconds}|${s.warn}|${s.flash}`;
    if (key === signKey) return;
    signKey = key;
    const ctx = signCanvas.getContext('2d')!;
    const W = signCanvas.width;
    const H = signCanvas.height;
    ctx.fillStyle = MIDWAY_PALETTE.ink;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = MIDWAY_PALETTE.ticket;
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, W - 16, H - 16);
    ctx.textBaseline = 'alphabetic';
    // Score, or the word of the moment.
    ctx.textAlign = 'left';
    if (s.flash) {
      ctx.fillStyle = MIDWAY_PALETTE.ticket;
      ctx.font = midwayCanvasFont('text', 800, 64);
      ctx.fillText(s.flash, 34, 108);
    } else {
      ctx.fillStyle = '#cdbfa6';
      ctx.font = midwayCanvasFont('text', 700, 30);
      ctx.fillText('score', 36, 48);
      ctx.fillStyle = MIDWAY_PALETTE.ticket;
      ctx.font = midwayCanvasFont('num', 800, 82);
      ctx.fillText(String(s.score), 34, 128);
    }
    // Rings left as ten lamps, two rows of five.
    const lampX = W / 2 - 60;
    for (let i = 0; i < RING_COUNT; i += 1) {
      const cx = lampX + (i % 5) * 30;
      const cy = 62 + Math.floor(i / 5) * 34;
      ctx.beginPath();
      ctx.arc(cx, cy, 10, 0, Math.PI * 2);
      ctx.lineWidth = 5;
      ctx.strokeStyle = i < s.ringsLeft ? MIDWAY_PALETTE.ticket : '#4a3f35';
      ctx.stroke();
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = '#cdbfa6';
    ctx.font = midwayCanvasFont('text', 700, 30);
    ctx.fillText('time', W - 36, 48);
    ctx.fillStyle = s.warn ? '#e8543f' : MIDWAY_PALETTE.paper;
    ctx.font = midwayCanvasFont('num', 800, 82);
    const sec = Math.max(0, s.seconds);
    ctx.fillText(`0:${String(sec).padStart(2, '0')}`, W - 34, 128);
    signTex.needsUpdate = true;
  };
  paintSign({ score: 0, ringsLeft: RING_COUNT, seconds: 30, warn: false, flash: null });

  // ── Merge the fixed booth by material and shadow flags ──
  {
    const buckets = new Map<string, { mat: THREE.Material; cast: boolean; receive: boolean; geos: THREE.BufferGeometry[] }>();
    for (const m of statics) {
      m.updateMatrix();
      const mat = m.material as THREE.Material;
      const key = `${mat.uuid}|${m.castShadow}|${m.receiveShadow}`;
      let b = buckets.get(key);
      if (!b) {
        b = { mat, cast: m.castShadow, receive: m.receiveShadow, geos: [] };
        buckets.set(key, b);
      }
      const g = (m.geometry.index ? m.geometry : m.geometry).clone();
      g.applyMatrix4(m.matrix);
      b.geos.push(g);
      group.remove(m);
    }
    const used = new Set<THREE.BufferGeometry>();
    for (const m of statics) used.add(m.geometry);
    for (const b of buckets.values()) {
      const merged = mergeGeometries(b.geos, false);
      for (const g of b.geos) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, b.mat);
      mesh.castShadow = b.cast;
      mesh.receiveShadow = b.receive;
      // Opaque draws sort by material before depth, and a merged mesh's own
      // position is the origin, so set the order by hand: nearest first, so
      // the walls behind are mostly rejected by the depth test instead of
      // shaded and then covered. Fill is what a phone's GPU pays for.
      merged.computeBoundingSphere();
      const c = merged.boundingSphere!.center;
      mesh.renderOrder = 10 + Math.round(Math.hypot(c.x - CAMERA_POS[0], c.y - CAMERA_POS[1], c.z - CAMERA_POS[2]) * 10);
      group.add(mesh);
    }
    for (const g of used) g.dispose();
  }

  // ── Camera fit ──
  const fit = () => {
    camera.aspect = width / Math.max(1, height);
    // Tall: the crate and a margin fill the width. Wide: the ring in the
    // hand and the top of the arc fill the height.
    const halfW = Math.atan((CRATE_HALF + 0.075) / CRATE_DIST);
    const vByWidth = 2 * Math.atan(Math.tan(halfW) / Math.max(0.2, camera.aspect));
    const fov = Math.min((70 * Math.PI) / 180, Math.max(V_NEEDED, vByWidth));
    camera.fov = (fov * 180) / Math.PI;
    camera.updateProjectionMatrix();
  };
  fit();

  const projV = new THREE.Vector3();
  // The camera without shake, for aiming: a shake mid-drag must not move the aim.
  const aimCam = camera.clone();
  const baseCamera = () => {
    aimCam.position.copy(baseCam);
    aimCam.fov = camera.fov;
    aimCam.aspect = camera.aspect;
    aimCam.lookAt(LOOK_AT);
    aimCam.updateProjectionMatrix();
    aimCam.updateMatrixWorld();
    return aimCam;
  };
  const tmpV = new THREE.Vector3();
  let handLift = 0;

  return {
    camera,
    setSize(w, h) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      fit();
    },
    setReduced(r) {
      reduced = r;
    },
    setTheme(next) {
      theme = next;
      mats.wall.color.set(theme.booth);
      mats.wallSeam.color.set(theme.boothSeam);
      mats.platform.color.set(theme.platform);
      mats.platformTop.color.set(theme.platformTop);
      mats.crate.color.set(theme.material ? '#ffffff' : theme.crate);
      mats.crateDark.color.set(theme.crateDark);
      mats.counter.color.set(theme.counter);
      // The crate's material: a tile painted in its colours, or white for the house.
      const prevMap = mats.crate.map;
      if (theme.material) {
        const canvas = document.createElement('canvas');
        canvas.width = MATERIAL_TILE;
        canvas.height = MATERIAL_TILE;
        paintMaterialTile(canvas, theme.material, { base: theme.crate, alt: mixHex(theme.crate, MIDWAY_PALETTE.ink, 0.12), line: theme.crateDark }, 'h');
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(2, 0.5);
        mats.crate.map = tex;
      } else {
        mats.crate.map = whiteMap();
      }
      if (prevMap && prevMap !== mats.crate.map) prevMap.dispose();
      ringMats.forEach(([body, tape], i) => {
        const c = theme.rings[i % theme.rings.length]!;
        body.color.set(c);
        tape.color.set(tapeOf(c));
      });
      if (theme.shape !== ringShape) {
        const old = ringGeo;
        ringGeo = ringGeometry(theme.shape, tier);
        ringShape = theme.shape;
        for (const m of allRings) m.geometry = ringGeo;
        old.dispose();
      }
      for (const paint of valuePaints) paint();
      BOTTLES.forEach((_, i) => paintBottle(i, performance.now()));
      if (bottles.instanceColor) bottles.instanceColor.needsUpdate = true;
    },
    setHand(h, lift, lean, visible, colorIndex) {
      hand.visible = visible;
      if (!visible) return;
      hand.material = ringMat(colorIndex);
      handLift = lift;
      hand.position.set(h * HAND_HALF, HAND_Y + 0.012 * lift, Z(HAND_Z));
      const pop = 1 + 0.07 * Math.max(0, Math.min(1, lift));
      hand.scale.set(pop, pop, pop);
      // Leans a little toward the throw as the finger pulls.
      hand.rotation.set(-0.12 - 0.12 * lift, 0, -lean * 0.25);
    },
    setLive(pose, colorIndex) {
      if (!pose) {
        live.visible = false;
        blob.visible = false;
        return;
      }
      live.visible = true;
      live.material = ringMat(colorIndex);
      placeRing(live, pose);
      // The blob sits on the surface under the ring: the crate's bottle tops
      // are too busy to read, so it sits on the platform, faded by height.
      const insideCrate = Math.abs(pose.x) < CRATE_HALF && Math.abs(pose.z - CRATE_Z) < CRATE_HALF_Z;
      const floorY = insideCrate ? CRATE_WALL_H : 0.0015;
      const hgt = Math.max(0, pose.y - floorY);
      blob.visible = pose.y > -0.02 && Math.abs(pose.x) < PLATFORM_HALF_X && pose.z > PLATFORM_Z0 && pose.z < PLATFORM_Z1;
      const s = RING_R * 2.4 * (1 + hgt * 1.5);
      blob.scale.set(s, s, 1);
      blob.position.set(pose.x, floorY + 0.0015, Z(pose.z));
      (blob.material as THREE.MeshBasicMaterial).opacity = 0.32 / (1 + hgt * 5);
    },
    setResting(i, pose, colorIndex) {
      const m = resting[i];
      if (!m) return;
      if (!pose) {
        m.visible = false;
        return;
      }
      m.visible = true;
      m.material = ringMat(colorIndex);
      placeRing(m, pose);
    },
    setGold(index) {
      const prev = gold;
      gold = index;
      if (prev >= 0) paintBottle(prev, performance.now());
      if (index >= 0) {
        paintBottle(index, performance.now());
        const b = BOTTLES[index]!;
        halo.visible = true;
        halo.position.set(b.x, 0.17, Z(b.z) - 0.04);
        goldTag.visible = true;
        goldTag.position.set(b.x, 0.245, Z(b.z));
      } else {
        halo.visible = false;
        goldTag.visible = false;
      }
      if (bottles.instanceColor) bottles.instanceColor.needsUpdate = true;
    },
    flashBottle(index, now, isGold) {
      flashes.set(index, { at: now, gold: isGold });
    },
    burst(index, isGold) {
      const b = BOTTLES[index]!;
      pulseAt = performance.now();
      pulse.position.set(b.x, 0.19, Z(b.z));
      (pulse.material as THREE.MeshBasicMaterial).color.set(isGold ? '#fff2c2' : MIDWAY_PALETTE.ticket);
      if (reduced) return;
      emitSpriteParticles(sparks, midwayParticleCount(isGold ? 26 : 16, tier), {
        origin: [b.x, 0.2, Z(b.z)],
        spread: 0.01,
        speed: [0.25, 0.7],
        up: [0.6, 1.4],
        ttl: [0.35, 0.7],
        size: [0.012, 0.024],
        fade: 1,
      });
    },
    dust(x, y, z, force) {
      if (reduced || force < 0.25) return;
      emitSpriteParticles(dustPool, midwayParticleCount(Math.round(2 + force * 4), tier), {
        origin: [x, Math.max(0.002, y), Z(z)],
        spread: 0.01,
        speed: [0.05, 0.18],
        up: [0.04, 0.16],
        ttl: [0.3, 0.46],
        size: [0.012, 0.022],
        grow: 1.4,
        fade: 1,
      });
    },
    paintSign,
    project(x, y, z, out) {
      projV.set(x, y, Z(z)).project(camera);
      out.x = (projV.x * 0.5 + 0.5) * width;
      out.y = (-projV.y * 0.5 + 0.5) * height;
    },
    handFromScreenX(px) {
      // Where the ray under the finger, at the hand's height on screen,
      // crosses the hand's plane.
      const cam = baseCamera();
      projV.set(0, HAND_Y, Z(HAND_Z)).project(cam);
      const ndcX = (px / Math.max(1, width)) * 2 - 1;
      tmpV.set(ndcX, projV.y, 0.5).unproject(cam).sub(cam.position);
      const t = (Z(HAND_Z) - cam.position.z) / (tmpV.z || -1e-6);
      const x = cam.position.x + tmpV.x * t;
      return Math.max(-1, Math.min(1, x / HAND_HALF));
    },
    handScreenX(h) {
      projV.set(h * HAND_HALF, HAND_Y, Z(HAND_Z)).project(baseCamera());
      return (projV.x * 0.5 + 0.5) * width;
    },
    sightX(px, z) {
      // Screen x is linear in x along a line of fixed height and depth.
      const cam = baseCamera();
      projV.set(-0.3, RING_AIM_Y, Z(z)).project(cam);
      const xa = (projV.x * 0.5 + 0.5) * width;
      projV.set(0.3, RING_AIM_Y, Z(z)).project(cam);
      const xb = (projV.x * 0.5 + 0.5) * width;
      if (Math.abs(xb - xa) < 1e-6) return 0;
      return -0.3 + ((px - xa) / (xb - xa)) * 0.6;
    },
    update(now, dtSec, shake) {
      // Shake moves the camera a few pixels' worth; no tilt.
      const px = (2 * Math.tan((camera.fov * Math.PI) / 360) * baseCam.distanceTo(LOOK_AT)) / Math.max(1, height);
      camera.position.set(baseCam.x + shake.x * px, baseCam.y - shake.y * px, baseCam.z);
      camera.lookAt(LOOK_AT.x + shake.x * px, LOOK_AT.y - shake.y * px, LOOK_AT.z);
      for (const i of flashes.keys()) paintBottle(i, now);
      if (flashes.size > 0 || gold >= 0) {
        if (gold >= 0 && !flashes.has(gold)) paintBottle(gold, now);
        if (bottles.instanceColor) bottles.instanceColor.needsUpdate = true;
      }
      if (gold >= 0) {
        halo.lookAt(camera.position);
        goldTag.lookAt(camera.position);
        const k = reduced ? 1 : 1 + 0.06 * Math.sin(now / 260);
        halo.scale.set(k, k, 1);
      }
      const age = (now - pulseAt) / 1000;
      if (age < 0.5 && !reduced) {
        pulse.visible = true;
        const s = 0.03 + age * 0.22;
        pulse.scale.set(s, s, 1);
        (pulse.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - age / 0.5);
      } else {
        pulse.visible = false;
      }
      stepSpriteParticles(sparks, dtSec, 2.4, 1.5);
      stepSpriteParticles(dustPool, dtSec, 0.2, 3);
      for (const p of sparks) if (p.active) p.mesh.lookAt(camera.position);
      for (const p of dustPool) if (p.active) p.mesh.lookAt(camera.position);
      void handLift;
    },
    warm(renderer) {
      // Everything that first shows mid-round, particles included, so no
      // shader compiles while a ring is in the air.
      const was = [live.visible, blob.visible, pulse.visible, halo.visible, goldTag.visible];
      live.visible = blob.visible = pulse.visible = halo.visible = goldTag.visible = true;
      const spark = sparks[0]?.mesh;
      const puff = dustPool[0]?.mesh;
      if (spark) spark.visible = true;
      if (puff) puff.visible = true;
      renderer.compile(scene, camera);
      if (spark) spark.visible = false;
      if (puff) puff.visible = false;
      [live.visible, blob.visible, pulse.visible, halo.visible, goldTag.visible] = was;
    },
    resetRound() {
      for (const m of resting) m.visible = false;
      live.visible = false;
      blob.visible = false;
      flashes.clear();
      resetSpriteParticles(sparks);
      resetSpriteParticles(dustPool);
      BOTTLES.forEach((_, i) => paintBottle(i, 0));
      if (bottles.instanceColor) bottles.instanceColor.needsUpdate = true;
    },
    dispose() {
      for (const t of valueTex) t.dispose();
      signTex.dispose();
      discTex.dispose();
      sparkTex.dispose();
    },
  };
}
