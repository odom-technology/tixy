/* ──────────────────────────────────────────────────────────────────────────
   COIN PUSHER — the cabinet.

   An ink cabinet with two tiers behind glass sides: paper shelves that slide
   on a crank, dark steel playfields, a brass lip over the tray, a chute on a
   rail across the top, and the coins: amber, stamped with the stub.

   The machine is authored in engine units (a coin is 1 in radius) inside
   one group scaled to the kit's world size, so every number here reads
   against engine.ts. Engine x runs across, z toward the player, y up. The
   camera sits in front (+z) looking back, so screen right is +x.

   This module draws. It never steps the machine and never decides a
   payout: the client hands it each frame's coin positions.
   ────────────────────────────────────────────────────────────────────────── */

import * as THREE from 'three';

import {
  CP_A_FRONT,
  CP_AIM_MAX,
  CP_B_FRONT,
  CP_BAR1,
  CP_DROP_VZ,
  CP_DROP_Y,
  CP_DROP_Z,
  CP_E1,
  CP_E2,
  CP_G,
  CP_STROKE,
  CP_T,
  CP_W,
  CP_Y_A,
  CP_Y_B,
  CP_Y_P1,
  CP_Y_P2,
} from '@/features/arcade/lib/coin-pusher/engine';
import {
  buildBulbString,
  createMidwayDeferredTextures,
  createMidwayLightRig,
  createMidwayRenderer,
  disposeSceneDeep,
  makeMidwayBulbMaterials,
  makeMidwayMaterial,
  midwayBulbCount,
  midwayCanvasFont,
  MIDWAY_PALETTE,
  stepMidwayBulbs,
  type BulbString,
  type MidwayDeferredTextures,
  type MidwayLightRig,
  type MidwayQualityController,
} from '@/features/arcade/lib/midway-three';

/** Engine units to world units. The cabinet is about 2.3 wide in the world. */
export const CP_SCALE = 0.12;
/** Coins the instanced mesh can draw at once, field and tray together. */
export const CP_DRAW_MAX = 420;

const HALF = CP_W / 2;
const WALL = 0.5;
const GLASS_TOP = CP_Y_A + 3.2;
/** Where a coin from the chute first touches down: thrown forward at
    CP_DROP_VZ and falling from CP_DROP_Y to shelf A's top. */
const LAND_Z = CP_DROP_Z + CP_DROP_VZ * Math.sqrt((2 * (CP_DROP_Y - CP_Y_A)) / CP_G);

export type CoinDraw = {
  x: number;
  y: number;
  z: number;
  /** Tilt about x (forward lean, toward the player) and about z, radians. */
  rx: number;
  rz: number;
  yaw: number;
};

export type PusherScene = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  rig: MidwayLightRig;
  deferred: MidwayDeferredTextures;
  resize: (width: number, height: number) => void;
  /** Shelf offsets in engine units, the carriage's x and dip, then coins. */
  draw: (frame: {
    shelfA: number;
    shelfB: number;
    carriageX: number;
    carriageDip: number;
    /** The pointer is over the machine: the drop line is brighter. */
    showLine: boolean;
    /** 0 to 1: the front lip lights as coins go over it, then fades. */
    lipFlash: number;
    coins: readonly CoinDraw[];
    count: number;
    shakeX: number;
    shakeY: number;
    timeSec: number;
    chase: boolean;
  }) => void;
  render: () => void;
  /** Engine x under a pointer (on the shelf's landing line), or null. */
  aimAt: (clientX: number, clientY: number) => number | null;
  /** A point in engine units, in CSS pixels from the canvas's top left. */
  screenAt: (x: number, y: number, z: number) => { x: number; y: number };
  dispose: () => void;
};

export type BuildOptions = {
  canvas: HTMLCanvasElement;
  quality: MidwayQualityController;
  width: number;
  height: number;
  onPause: () => void;
  onRestore: () => void;
  onFallback: () => void;
};

/* ── the coin face ─────────────────────────────────────────────────────── */

/** The stub (the mark's outline): a rounded ticket with a notch on each short end. */
function stubPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number) {
  const r = h * 0.18;
  const notch = h * 0.22;
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;
  ctx.beginPath();
  ctx.moveTo(x0 + r, y0);
  ctx.lineTo(x0 + w - r, y0);
  ctx.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  ctx.lineTo(x0 + w, cy - notch);
  ctx.arc(x0 + w, cy, notch, -Math.PI / 2, Math.PI / 2, true);
  ctx.lineTo(x0 + w, y0 + h - r);
  ctx.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
  ctx.lineTo(x0 + r, y0 + h);
  ctx.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
  ctx.lineTo(x0, cy + notch);
  ctx.arc(x0, cy, notch, Math.PI / 2, -Math.PI / 2, true);
  ctx.lineTo(x0, y0 + r);
  ctx.quadraticCurveTo(x0, y0, x0 + r, y0);
  ctx.closePath();
}

/** The coin's face: a flat amber disc, a raised rim, the stub and a 5. The
    value is game information, so this paints before the first frame. */
function makeCoinFace(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  if (!ctx) return tex;
  const c = size / 2;
  ctx.fillStyle = '#f2a33c';
  ctx.fillRect(0, 0, size, size);
  // The rim: one hard ring, darker.
  ctx.strokeStyle = '#c47a1e';
  ctx.lineWidth = size * 0.07;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.43, 0, Math.PI * 2);
  ctx.stroke();
  // The stub, stamped.
  ctx.fillStyle = '#d98a26';
  stubPath(ctx, c, c, size * 0.56, size * 0.34);
  ctx.fill();
  ctx.fillStyle = '#7a4810';
  ctx.font = midwayCanvasFont('num', 800, Math.round(size * 0.3));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('5', c, c + size * 0.015);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/* ── build ─────────────────────────────────────────────────────────────── */

export function buildPusherScene(opts: BuildOptions): PusherScene | null {
  const handle = createMidwayRenderer({
    canvas: opts.canvas,
    tier: opts.quality.tier(),
    width: opts.width,
    height: opts.height,
    powerPreference: 'high-performance',
    onPause: opts.onPause,
    onRestore: opts.onRestore,
    onFallback: opts.onFallback,
  });
  if (!handle) return null;
  const renderer = handle.renderer;
  renderer.setSize(opts.width, opts.height, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(MIDWAY_PALETTE.nightBottom);

  const camera = new THREE.PerspectiveCamera(36, opts.width / Math.max(1, opts.height), 0.1, 60);

  const machine = new THREE.Group();
  machine.scale.setScalar(CP_SCALE);
  scene.add(machine);

  const centre = new THREE.Vector3(0, 3 * CP_SCALE, 15 * CP_SCALE);
  const rig = createMidwayLightRig(renderer, scene, {
    tier: opts.quality.tier(),
    target: [centre.x, centre.y, centre.z],
    radius: 2.4,
    camera: [0, 3.2, 6.4],
  });
  // One lamp under the marquee, over the lip: the coins at the edge catch it.
  rig.addPractical([0, 2.2, 3.1], { intensity: 1.6, distance: 4.5 });

  const deferred = createMidwayDeferredTextures('coin-pusher', { quality: opts.quality });

  /* ── materials: few, because each is a shader program ── */

  const ink = makeMidwayMaterial('ink');
  const rail = makeMidwayMaterial('rail');
  const paper = makeMidwayMaterial('paper', { roughness: 0.55 });
  const steel = new THREE.MeshStandardMaterial({ color: '#3a322b', roughness: 0.32, metalness: 0.55 });
  const brass = makeMidwayMaterial('brass');
  const glass = new THREE.MeshStandardMaterial({
    color: '#b9c4c8',
    roughness: 0.08,
    metalness: 0,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
  });
  const coinFace = new THREE.MeshStandardMaterial({ map: makeCoinFace(), roughness: 0.34, metalness: 0.5 });
  const coinEdge = new THREE.MeshStandardMaterial({ color: '#c98422', roughness: 0.36, metalness: 0.55 });
  const lineMat = new THREE.MeshBasicMaterial({ color: MIDWAY_PALETTE.paper, transparent: true, opacity: 0.35, depthWrite: false });
  // The front lip is where coins pay: paper at rest, ticket amber as coins
  // go over it.
  const lipMat = makeMidwayMaterial('paper', { roughness: 0.55 });
  const lipRest = new THREE.Color(MIDWAY_PALETTE.paper);
  const lipLit = new THREE.Color(MIDWAY_PALETTE.ticket);

  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, shadow = true) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    machine.add(mesh);
    return mesh;
  };

  /* ── the static cabinet ── */

  const backZ = CP_BAR1 - 6;
  // Floor of tier 2 (P2), from deep under tier 1 to the lip.
  box(CP_W, 1, CP_E2 - backZ, steel, 0, CP_Y_P2 - 0.5, (CP_E2 + backZ) / 2);
  // Tier 1's body: P1's plate over shelf B's slot, its front face the
  // barricade for shelf B's coins.
  const t1Bottom = CP_Y_B + 0.45;
  box(CP_W, CP_Y_P1 - t1Bottom, CP_E1 - backZ, steel, 0, (CP_Y_P1 + t1Bottom) / 2, (CP_E1 + backZ) / 2);
  // The back wall over shelf A: the barricade, a step lighter than the
  // cabinet so the chute reads against it.
  box(CP_W + WALL * 2, CP_DROP_Y + 3.4 - CP_Y_A, 1, rail, 0, (CP_DROP_Y + 3.4 + CP_Y_A) / 2, CP_BAR1 - 0.5);
  // The lip: a brass edge on tier 1 and over the tray.
  box(CP_W, 0.22, 0.5, paper, 0, CP_Y_P1 - 0.11, CP_E1 - 0.25, false);
  box(CP_W, 0.3, 0.6, lipMat, 0, CP_Y_P2 - 0.15, CP_E2 - 0.3, false);
  // Side walls up to the glass.
  for (const side of [-1, 1]) {
    box(WALL, CP_Y_A + 1.2, CP_E2 - backZ, ink, side * (HALF + WALL / 2), (CP_Y_A + 1.2) / 2 - 0.6, (CP_E2 + backZ) / 2);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(CP_E2 - CP_BAR1, GLASS_TOP - CP_Y_A - 0.6), glass);
    pane.rotation.y = side * Math.PI / 2 * -1;
    pane.position.set(side * (HALF + 0.05), (GLASS_TOP + CP_Y_A + 0.6) / 2, (CP_E2 + CP_BAR1) / 2);
    machine.add(pane);
    // A brass rail along the top of each side.
    box(0.35, 0.35, CP_E2 - CP_BAR1 + 1, brass, side * (HALF + WALL / 2), CP_Y_A + 0.75, (CP_E2 + CP_BAR1) / 2, false);
  }
  // The tray: an ink slot under the lip, and the cabinet's front below it.
  box(CP_W + WALL * 2, 6, 1.2, ink, 0, CP_Y_P2 - 3.6, CP_E2 + 2.2);
  box(CP_W, 0.6, 2.4, rail, 0, CP_Y_P2 - 3.2, CP_E2 + 1.2, false);
  // The chute's rail across the top, and its posts.
  box(CP_W + 1, 0.4, 0.4, paper, 0, CP_DROP_Y + 1.35, CP_DROP_Z - 0.9, false);
  box(CP_W + WALL * 2, 1.4, 0.6, ink, 0, CP_DROP_Y + 2.1, CP_DROP_Z - 1.6, false);

  /* ── the shelves ── */

  const shelfDepthA = CP_A_FRONT - backZ;
  const shelfA = box(CP_W - 0.1, CP_Y_A - CP_Y_P1, shelfDepthA, paper, 0, (CP_Y_A + CP_Y_P1) / 2, 0);
  const shelfDepthB = CP_B_FRONT - backZ;
  const shelfB = box(CP_W - 0.1, CP_Y_B - CP_Y_P2, shelfDepthB, paper, 0, (CP_Y_B + CP_Y_P2) / 2, 0);
  // A red rule along each shelf's leading edge: the part that pushes.
  const edgeA = box(CP_W - 0.1, 0.18, 0.18, makeMidwayMaterial('red'), 0, CP_Y_A + 0.01, 0, false);
  const edgeB = box(CP_W - 0.1, 0.18, 0.18, edgeA.material as THREE.Material, 0, CP_Y_B + 0.01, 0, false);
  const placeShelves = (a: number, b: number) => {
    shelfA.position.z = backZ + shelfDepthA / 2 + a;
    edgeA.position.z = CP_A_FRONT + a - 0.09;
    shelfB.position.z = backZ + shelfDepthB / 2 + b;
    edgeB.position.z = CP_B_FRONT + b - 0.09;
  };
  placeShelves(0, CP_STROKE);

  /* ── the chute carriage and its drop line ── */

  const carriage = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.1, 1.6), paper);
  body.castShadow = true;
  carriage.add(body);
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.24, 0.5), edgeA.material as THREE.Material);
  mouth.position.set(0, -0.56, 0.2);
  carriage.add(mouth);
  carriage.position.set(0, CP_DROP_Y + 0.6, CP_DROP_Z);
  machine.add(carriage);
  const line = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1, 0.08), lineMat);
  machine.add(line);
  // A ring where the coin will touch down, so a tap is aimed before it is made.
  const markerMat = new THREE.MeshBasicMaterial({ color: MIDWAY_PALETTE.paper, transparent: true, opacity: 0.7, depthWrite: false });
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.1, 32), markerMat);
  marker.rotation.x = -Math.PI / 2;
  machine.add(marker);

  /* ── coins: one instanced mesh, face and edge ── */

  const coinGeo = new THREE.CylinderGeometry(1, 1, CP_T, 36, 1);
  const coins = new THREE.InstancedMesh(coinGeo, [coinEdge, coinFace, coinFace], CP_DRAW_MAX);
  coins.castShadow = true;
  coins.receiveShadow = true;
  coins.count = 0;
  coins.frustumCulled = false;
  coins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  machine.add(coins);

  /* ── bulbs along the marquee: they chase on a spill ── */

  const bulbMats = makeMidwayBulbMaterials();
  const bulbs: BulbString = buildBulbString({
    xStart: -(HALF + 0.2) * CP_SCALE,
    xEnd: (HALF + 0.2) * CP_SCALE,
    yTop: (CP_DROP_Y + 3.3) * CP_SCALE,
    sag: 0.02,
    z: (CP_DROP_Z - 1.2) * CP_SCALE,
    count: midwayBulbCount(10, opts.quality.tier()),
    bulbMats,
    socketMat: makeMidwayMaterial('brassDark'),
    wireMat: makeMidwayMaterial('wire'),
  });
  scene.add(bulbs.group);

  /* ── camera fit ── */

  // Frame the lip, both tiers and the chute: the play area fills the canvas.
  const keyPoints = [
    // Below the lip: room to see coins drop into the tray, and the count.
    new THREE.Vector3(-HALF, CP_Y_P2 - 2.6, CP_E2 + 1.2),
    new THREE.Vector3(HALF, CP_Y_P2 - 2.6, CP_E2 + 1.2),
    new THREE.Vector3(-HALF, CP_Y_A, CP_BAR1),
    new THREE.Vector3(HALF, CP_Y_A, CP_BAR1),
    new THREE.Vector3(-HALF, CP_DROP_Y + 2.6, CP_DROP_Z - 1.2),
    new THREE.Vector3(HALF, CP_DROP_Y + 2.6, CP_DROP_Z - 1.2),
  ].map((p) => p.multiplyScalar(CP_SCALE));
  const look = new THREE.Vector3(0, 3.6 * CP_SCALE, 15.5 * CP_SCALE);
  const dir = new THREE.Vector3(0, 0.78, 1).normalize();
  const fit = (aspect: number) => {
    camera.aspect = aspect;
    // Portrait screens see the machine from higher up, so it fits tall.
    const lift = aspect < 0.85 ? 0.95 : 0.74;
    dir.set(0, lift, 1).normalize();
    camera.fov = aspect < 0.85 ? 40 : 34;
    let lo = 1;
    let hi = 30;
    const v = new THREE.Vector3();
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      camera.position.copy(look).addScaledVector(dir, mid);
      camera.lookAt(look);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      let inside = true;
      for (const p of keyPoints) {
        v.copy(p).project(camera);
        if (Math.abs(v.x) > 0.96 || Math.abs(v.y) > 0.95) {
          inside = false;
          break;
        }
      }
      if (inside) hi = mid;
      else lo = mid;
    }
    camera.position.copy(look).addScaledVector(dir, hi);
    camera.lookAt(look);
    camera.updateProjectionMatrix();
  };
  fit(opts.width / Math.max(1, opts.height));
  const cameraHome = camera.position.clone();

  /* ── per frame ── */

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);

  const draw: PusherScene['draw'] = (f) => {
    placeShelves(f.shelfA, f.shelfB);
    carriage.position.x = f.carriageX;
    carriage.position.y = CP_DROP_Y + 0.6 - f.carriageDip;
    // The drop line and its ring are always there; brighter under a pointer.
    lineMat.opacity = f.showLine ? 0.5 : 0.28;
    markerMat.opacity = f.showLine ? 0.85 : 0.55;
    // The coin lands on shelf A while its face is out past the landing
    // point, and on the playfield under it when the shelf has pulled back.
    const floor = CP_A_FRONT + f.shelfA > LAND_Z + 0.4 ? CP_Y_A : CP_Y_P1;
    const top = CP_DROP_Y - 0.1;
    const bottom = floor + 0.2;
    line.scale.y = top - bottom;
    line.position.set(f.carriageX, (top + bottom) / 2, CP_DROP_Z + 0.2);
    // Over the coins already there, so it isn't buried under them.
    marker.position.set(f.carriageX, floor + CP_T * 2 + 0.06, LAND_Z);
    lipMat.color.copy(lipRest).lerp(lipLit, Math.max(0, Math.min(1, f.lipFlash)));
    const n = Math.min(f.count, CP_DRAW_MAX);
    for (let i = 0; i < n; i++) {
      const c = f.coins[i];
      e.set(c.rx, c.yaw, c.rz);
      q.setFromEuler(e);
      pos.set(c.x, c.y + CP_T / 2, c.z);
      m4.compose(pos, q, one);
      coins.setMatrixAt(i, m4);
    }
    coins.count = n;
    coins.instanceMatrix.needsUpdate = true;
    camera.position.set(cameraHome.x + f.shakeX, cameraHome.y + f.shakeY, cameraHome.z);
    stepMidwayBulbs(bulbs.bulbs, f.timeSec, f.chase ? { mode: 'chase', stepsPerSecond: 12 } : { mode: 'flicker', load: 0.2 });
  };

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  const hit = new THREE.Vector3();
  const aimAt = (clientX: number, clientY: number) => {
    const rect = opts.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    // Aim across the front of the field: a vertical plane through the lip
    // reads as "the column above my finger" from any camera height.
    plane.set(new THREE.Vector3(0, 0, 1), -(CP_E1 * CP_SCALE));
    if (!raycaster.ray.intersectPlane(plane, hit)) return null;
    const x = hit.x / CP_SCALE;
    return Math.max(-CP_AIM_MAX, Math.min(CP_AIM_MAX, x));
  };

  const projected = new THREE.Vector3();
  const screenAt = (x: number, y: number, z: number) => {
    projected.set(x * CP_SCALE, y * CP_SCALE, z * CP_SCALE).project(camera);
    const rect = opts.canvas.getBoundingClientRect();
    return { x: ((projected.x + 1) / 2) * rect.width, y: ((1 - projected.y) / 2) * rect.height };
  };

  const resize = (width: number, height: number) => {
    renderer.setSize(width, height, false);
    fit(width / Math.max(1, height));
    cameraHome.copy(camera.position);
  };

  return {
    renderer,
    scene,
    camera,
    rig,
    deferred,
    resize,
    draw,
    render: () => renderer.render(scene, camera),
    aimAt,
    screenAt,
    dispose: () => {
      deferred.dispose();
      rig.dispose();
      disposeSceneDeep(scene);
      handle.dispose();
    },
  };
}
