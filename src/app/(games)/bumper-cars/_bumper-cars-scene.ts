/* The bumper car pavilion: a steel floor inside a padded rail, a plank deck,
   string lights on three sides, and eight cars. The camera looks down at
   52°, turned so the rink's long side runs up a phone and across a desktop.
   Everything that moves is driven from the round's poses each frame. */

import * as THREE from 'three';
import {
  buildBulbString,
  emitSpriteParticles,
  makeMidwayBulbMaterials,
  makeMidwayMaterial,
  makePlankTextures,
  makeSignTexture,
  makeSoftDiscTexture,
  makeSparkTexture,
  makeSpriteParticlePool,
  midwayBulbCount,
  midwayParticleCount,
  MIDWAY_PALETTE,
  resetSpriteParticles,
  stepMidwayBulbs,
  stepSpriteParticles,
  type MidwayTier,
  type SpriteParticle,
} from '@/features/arcade/lib/midway-three';
import { squashAt as feelSquashAt } from '@/features/arcade/lib/game-feel';
import { CAR_COLORS, MAX_CARS, RINK_CORNER, RINK_HX, RINK_HZ } from '@/features/arcade/lib/bumper-cars/constants';
import type { BumperView, Pose } from '@/features/arcade/lib/bumper-cars/runtime';
import { buildBumperCar, makeCarMaterials, makeCarParts, type BumperCarModel } from './_bumper-cars-car';
import { DEFAULT_BUMPER_THEME, type BumperTheme } from './_bumper-cars-theme';
import { MATERIAL_TILE, paintMaterialTile } from '@/features/arcade/lib/skins/skin-material-canvas';


export const RIG_TARGET: [number, number, number] = [0, 0.4, 0];
export const RIG_RADIUS = 11;
export const RIG_CAMERA: [number, number, number] = [0, 16, 12];

const RAIL_W = 0.42;
const RAIL_H = 0.62;
const TILT = (60 * Math.PI) / 180;
const FOV = 38;

type CarFx = {
  squashAt: number;
  squashForce: number;
  squashAngle: number;
  roll: number;
  rollV: number;
  pitch: number;
  pitchV: number;
};

export type BumperScene = {
  camera: THREE.PerspectiveCamera;
  cars: BumperCarModel[];
  setSize: (w: number, h: number) => void;
  /** Draw the round at this frame. */
  update: (view: BumperView, nowMs: number, dtMs: number, reduced: boolean) => void;
  /** Squash both cars and throw sparks at the contact. */
  bump: (a: number, b: number, x: number, z: number, nx: number, nz: number, force: number, nowMs: number, big: boolean) => void;
  wall: (car: number, x: number, z: number, force: number, nowMs: number) => void;
  /** Screen position, CSS px, of a world point. */
  project: (x: number, y: number, z: number, out: { x: number; y: number; behind: boolean }) => void;
  /** Screen-space direction of world +x and +z, for the joystick. */
  screenAxes: () => { right: [number, number]; up: [number, number] };
  setPowered: (on: boolean) => void;
  setSeatColors: (colors: readonly string[]) => void;
  /** A skin set: the floor, the rail, the deck and the cars' bodywork. */
  setTheme: (theme: BumperTheme) => void;
  setMine: (seat: number) => void;
  shake: (px: number) => void;
  warm: (renderer: THREE.WebGLRenderer, scene: THREE.Scene) => void;
  paintDeferred: () => Array<{ paint: () => unknown; apply: (v: unknown) => void }>;
  dispose: () => void;
};

function rinkShape(hx: number, hz: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-hx + r, -hz);
  s.lineTo(hx - r, -hz);
  s.quadraticCurveTo(hx, -hz, hx, -hz + r);
  s.lineTo(hx, hz - r);
  s.quadraticCurveTo(hx, hz, hx - r, hz);
  s.lineTo(-hx + r, hz);
  s.quadraticCurveTo(-hx, hz, -hx, hz - r);
  s.lineTo(-hx, -hz + r);
  s.quadraticCurveTo(-hx, -hz, -hx + r, -hz);
  return s;
}

function rinkPath(hx: number, hz: number, r: number): THREE.Path {
  const p = new THREE.Path();
  const s = rinkShape(hx, hz, r);
  p.curves = s.curves;
  p.currentPoint.copy(s.currentPoint);
  return p;
}

/** The steel floor's plates: 1.2 m squares, a seam and a rivet at each corner. */
function paintFloor(): HTMLCanvasElement {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  // Two plates per tile, hard-edged, a tone apart.
  ctx.fillStyle = '#f1efec';
  ctx.fillRect(0, 0, size / 2, size / 2);
  ctx.fillRect(size / 2, size / 2, size / 2, size / 2);
  ctx.strokeStyle = '#bdb6ad';
  ctx.lineWidth = 4;
  for (const v of [0, size / 2, size]) {
    ctx.beginPath();
    ctx.moveTo(v, 0);
    ctx.lineTo(v, size);
    ctx.moveTo(0, v);
    ctx.lineTo(size, v);
    ctx.stroke();
  }
  ctx.fillStyle = '#cfc8be';
  for (const x of [14, size / 2 - 14, size / 2 + 14, size - 14]) {
    for (const y of [14, size / 2 - 14, size / 2 + 14, size - 14]) {
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return c;
}

/** Red and paper bands round the rail's padding, a band every 1.1 m. */
function paintRail(rail: string = MIDWAY_PALETTE.red, band: string = MIDWAY_PALETTE.paper): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 8;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  ctx.fillStyle = rail;
  ctx.fillRect(0, 0, 64, 8);
  ctx.fillStyle = band;
  ctx.fillRect(40, 0, 24, 8);
  return c;
}

export function createBumperScene(scene: THREE.Scene, tier: MidwayTier): BumperScene {
  const low = tier === 'low';
  const shadows = tier !== 'low';
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 120);
  const disposables: Array<{ dispose: () => void }> = [];

  // ── Deck and floor ──
  const deckMat = makeMidwayMaterial('wood');
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), deckMat);
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = -0.02;
  deck.receiveShadow = shadows;
  scene.add(deck);

  const floorGeo = new THREE.ShapeGeometry(rinkShape(RINK_HX + 0.05, RINK_HZ + 0.05, RINK_CORNER), low ? 6 : 12);
  floorGeo.rotateX(-Math.PI / 2);
  // UVs in metres: a 2.4 m tile, two plates across.
  {
    const pos = floorGeo.attributes.position!;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i += 1) {
      uv[i * 2] = pos.getX(i) / 2.4;
      uv[i * 2 + 1] = pos.getZ(i) / 2.4;
    }
    floorGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  const floorTex = new THREE.CanvasTexture(document.createElement('canvas'));
  const floorMat = makeMidwayMaterial('ink', { color: '#4a443d', roughness: 0.42, metalness: 0.35, map: floorTex });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.receiveShadow = shadows;
  scene.add(floor);

  // ── The rail: rubber padding in bands, a wooden cap ──
  const padShape = rinkShape(RINK_HX + RAIL_W, RINK_HZ + RAIL_W, RINK_CORNER + RAIL_W);
  padShape.holes.push(rinkPath(RINK_HX, RINK_HZ, RINK_CORNER));
  const padGeo = new THREE.ExtrudeGeometry(padShape, { depth: RAIL_H, bevelEnabled: false, curveSegments: low ? 8 : 16 });
  padGeo.rotateX(-Math.PI / 2);
  // Bands run round the rail: u follows the angle round the rink.
  {
    const pos = padGeo.attributes.position!;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      uv[i * 2] = (Math.atan2(z / RINK_HZ, x / RINK_HX) / (Math.PI * 2)) * 22;
      uv[i * 2 + 1] = pos.getY(i);
    }
    padGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  const railTex = new THREE.CanvasTexture(document.createElement('canvas'));
  const padMat = makeMidwayMaterial('red', { roughness: 0.8, map: railTex });
  const pad = new THREE.Mesh(padGeo, padMat);
  pad.castShadow = shadows;
  pad.receiveShadow = shadows;
  scene.add(pad);
  const capShape = rinkShape(RINK_HX + RAIL_W + 0.28, RINK_HZ + RAIL_W + 0.28, RINK_CORNER + RAIL_W + 0.28);
  capShape.holes.push(rinkPath(RINK_HX + RAIL_W - 0.06, RINK_HZ + RAIL_W - 0.06, RINK_CORNER + RAIL_W - 0.06));
  const capGeo = new THREE.ExtrudeGeometry(capShape, { depth: 0.12, bevelEnabled: false, curveSegments: low ? 8 : 16 });
  capGeo.rotateX(-Math.PI / 2);
  capGeo.translate(0, RAIL_H, 0);
  const capMat = makeMidwayMaterial('wood');
  const cap = new THREE.Mesh(capGeo, capMat);
  cap.castShadow = shadows;
  scene.add(cap);

  // ── Posts, string lights, the sign ──
  const postMat = makeMidwayMaterial('woodDark');
  const postGeo = new THREE.CylinderGeometry(0.11, 0.13, 3.6, 8);
  const postSpots: Array<[number, number]> = [
    [-(RINK_HX + 1.2), -(RINK_HZ + 1.2)],
    [RINK_HX + 1.2, -(RINK_HZ + 1.2)],
    [-(RINK_HX + 1.2), RINK_HZ + 1.2],
    [RINK_HX + 1.2, RINK_HZ + 1.2],
  ];
  for (const [x, z] of postSpots) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(x, 1.8, z);
    post.castShadow = shadows;
    scene.add(post);
  }
  const bulbMats = makeMidwayBulbMaterials();
  const socketMat = makeMidwayMaterial('brassDark');
  const wireMat = makeMidwayMaterial('wire');
  const allBulbs: THREE.Mesh[] = [];
  const strings: Array<{ group: THREE.Group; side: 'far' | 'near' | 'left' | 'right' }> = [];
  const addString = (len: number, rotY: number, offX: number, offZ: number, n: number, side: 'far' | 'near' | 'left' | 'right') => {
    const s = buildBulbString({
      xStart: -len / 2,
      xEnd: len / 2,
      yTop: 3.4,
      sag: 0.45,
      z: 0,
      count: midwayBulbCount(n, tier),
      bulbMats,
      socketMat,
      wireMat,
    });
    s.group.rotation.y = rotY;
    s.group.position.set(offX, 0, offZ);
    scene.add(s.group);
    allBulbs.push(...s.bulbs);
    strings.push({ group: s.group, side });
  };
  // Lights on all four sides; the side nearest the camera is hidden so it
  // never hangs across the floor.
  addString((RINK_HX + 1.2) * 2, 0, 0, -(RINK_HZ + 1.2), 8, 'far');
  addString((RINK_HX + 1.2) * 2, 0, 0, RINK_HZ + 1.2, 8, 'near');
  addString((RINK_HZ + 1.2) * 2, Math.PI / 2, -(RINK_HX + 1.2), 0, 11, 'left');
  addString((RINK_HZ + 1.2) * 2, Math.PI / 2, RINK_HX + 1.2, 0, 11, 'right');

  const signTex = new THREE.CanvasTexture(document.createElement('canvas'));
  const signMat = new THREE.MeshBasicMaterial({ map: signTex, color: '#ffffff' });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.3), signMat);
  sign.position.set(0, 4.3, -(RINK_HZ + 1.25));
  scene.add(sign);
  const signBack = new THREE.Mesh(new THREE.BoxGeometry(5.4, 1.5, 0.1), makeMidwayMaterial('ink'));
  signBack.position.set(0, 4.3, -(RINK_HZ + 1.33));
  scene.add(signBack);

  // ── Cars ──
  let theme: BumperTheme = { ...DEFAULT_BUMPER_THEME };
  let painted = false;
  let parts = makeCarParts(low, theme.shape);
  const carMats = makeCarMaterials();
  const blobTex = makeSoftDiscTexture(64);
  const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, color: '#000000', transparent: true, opacity: 0.45, depthWrite: false });
  const blobGeo = new THREE.PlaneGeometry(2.5, 2.7);
  const mineMat = new THREE.MeshBasicMaterial({ color: MIDWAY_PALETTE.ticket, transparent: true, opacity: 0.95, depthWrite: false });
  const mineGeo = new THREE.RingGeometry(1.18, 1.32, low ? 24 : 40);
  const cars: BumperCarModel[] = [];
  const blobs: THREE.Mesh[] = [];
  const fx: CarFx[] = [];
  for (let i = 0; i < MAX_CARS; i += 1) {
    const car = buildBumperCar(parts, carMats, CAR_COLORS[i]!, shadows);
    scene.add(car.root);
    cars.push(car);
    const blob = new THREE.Mesh(blobGeo, blobMat);
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.01;
    blob.visible = !shadows;
    scene.add(blob);
    blobs.push(blob);
    fx.push({ squashAt: -1e9, squashForce: 0, squashAngle: 0, roll: 0, rollV: 0, pitch: 0, pitchV: 0 });
  }
  const mine = new THREE.Mesh(mineGeo, mineMat);
  mine.rotation.x = -Math.PI / 2;
  mine.position.y = 0.02;
  scene.add(mine);
  let mySeat = 0;

  // ── Sparks ──
  const sparkTex = makeSparkTexture(64);
  const sparks: SpriteParticle[] = makeSpriteParticlePool({
    scene,
    count: 64,
    texture: sparkTex,
    colors: ['#fff1d6', MIDWAY_PALETTE.ticket, '#ffd39a'],
    size: 0.22,
    blending: THREE.AdditiveBlending,
  });

  // ── Camera ──
  let viewW = 390;
  let viewH = 640;
  let landscape = false;
  let camDist = 20;
  const camTarget = new THREE.Vector3(0, 0, 0);
  let shakePx = 0;
  let shakeAt = -1e9;

  const placeCamera = (tx: number, tz: number, sx: number, sy: number) => {
    // Portrait: the camera sits off +z. Landscape: off +x, so the long side runs across.
    const back = Math.cos(TILT) * camDist;
    const up = Math.sin(TILT) * camDist;
    if (landscape) camera.position.set(tx + back, up, tz);
    else camera.position.set(tx, up, tz + back);
    camera.lookAt(tx, 0, tz);
    if (sx !== 0 || sy !== 0) {
      // Shake in screen pixels, moved along the camera's own axes.
      const unit = (2 * Math.tan((FOV * Math.PI) / 360) * camDist) / viewH;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const upv = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      camera.position.addScaledVector(right, sx * unit).addScaledVector(upv, sy * unit);
    }
  };

  const fit = () => {
    camera.aspect = viewW / viewH;
    landscape = camera.aspect > 1.12;
    camera.updateProjectionMatrix();
    for (const st of strings) st.group.visible = st.side !== (landscape ? 'right' : 'near');
    // The sign hangs on the side across from the camera.
    if (landscape) {
      sign.position.set(-(RINK_HX + 1.25), 4.3, 0);
      sign.rotation.y = Math.PI / 2;
      signBack.position.set(-(RINK_HX + 1.33), 4.3, 0);
      signBack.rotation.y = Math.PI / 2;
    } else {
      sign.position.set(0, 4.3, -(RINK_HZ + 1.25));
      sign.rotation.y = 0;
      signBack.position.set(0, 4.3, -(RINK_HZ + 1.33));
      signBack.rotation.y = 0;
    }
    // The smallest distance that keeps the rail and the cars in view.
    const corners: THREE.Vector3[] = [];
    const ex = RINK_HX + RAIL_W + 0.3;
    const ez = RINK_HZ + RAIL_W + 0.3;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0, 1.5]) corners.push(new THREE.Vector3(sx * ex, y, sz * ez));
    let lo = 8;
    let hi = 60;
    for (let k = 0; k < 24; k += 1) {
      camDist = (lo + hi) / 2;
      placeCamera(0, 0, 0, 0);
      camera.updateMatrixWorld();
      let fits = true;
      for (const c of corners) {
        const p = c.clone().project(camera);
        if (Math.abs(p.x) > 0.97 || Math.abs(p.y) > 0.95) {
          fits = false;
          break;
        }
      }
      if (fits) hi = camDist;
      else lo = camDist;
    }
    camDist = hi;
  };

  const setSize = (w: number, h: number) => {
    viewW = Math.max(1, w);
    viewH = Math.max(1, h);
    fit();
    placeCamera(camTarget.x, camTarget.z, 0, 0);
  };

  const pose: Pose = { x: 0, z: 0, fx: 0, fz: 1, speed: 0, w: 0, ax: 0, az: 0 };
  let powered = false;
  let powerLevel = 0;
  const lampOn = new THREE.Color(MIDWAY_PALETTE.practicalLight);

  const update = (view: BumperView, nowMs: number, dtMs: number, reduced: boolean) => {
    const dt = Math.min(0.1, dtMs / 1000);
    const seats = view.seats();
    for (let i = 0; i < MAX_CARS; i += 1) {
      const car = cars[i]!;
      const seat = seats[i];
      const present = seat && seat.kind !== 'empty';
      car.root.visible = Boolean(present);
      blobs[i]!.visible = Boolean(present) && !shadows;
      if (!present) continue;
      view.pose(i, pose);
      car.root.position.set(pose.x, 0, pose.z);
      car.root.rotation.y = Math.atan2(pose.fx, pose.fz);
      blobs[i]!.position.set(pose.x, 0.01, pose.z);
      blobs[i]!.rotation.z = car.root.rotation.y;

      // Lean: roll against the turn, pitch with the throttle, on a spring.
      const f = fx[i]!;
      const along = pose.ax * pose.fx + pose.az * pose.fz;
      const across = pose.ax * -pose.fz + pose.az * pose.fx;
      const rollTarget = reduced ? 0 : Math.max(-0.09, Math.min(0.09, across * 0.012));
      const pitchTarget = reduced ? 0 : Math.max(-0.07, Math.min(0.07, -along * 0.01));
      f.rollV += ((rollTarget - f.roll) * 120 - f.rollV * 14) * dt;
      f.roll += f.rollV * dt;
      f.pitchV += ((pitchTarget - f.pitch) * 120 - f.pitchV * 14) * dt;
      f.pitch += f.pitchV * dt;
      car.body.rotation.set(f.pitch, 0, f.roll);

      // Squash along the hit's direction, in the car's own frame.
      const sq = feelSquashAt(nowMs - f.squashAt, { force: f.squashForce, reduced });
      const local = f.squashAngle - car.root.rotation.y;
      car.squashPivot.rotation.y = local;
      car.squashBack.rotation.y = -local;
      // Squashed along the hit (scaleY's dip), wider across it, a touch taller.
      car.squashScale.scale.set(sq.scaleY, 1 + (sq.scaleX - 1) * 0.5, sq.scaleX);
    }
    const me = cars[mySeat];
    mine.visible = Boolean(me?.root.visible);
    if (me) mine.position.set(me.root.position.x, 0.02, me.root.position.z);

    // The camera leans a little toward your car.
    const tx = me && !reduced ? me.root.position.x * 0.14 : 0;
    const tz = me && !reduced ? me.root.position.z * 0.1 : 0;
    camTarget.x += (tx - camTarget.x) * Math.min(1, dt * 3);
    camTarget.z += (tz - camTarget.z) * Math.min(1, dt * 3);
    let sx = 0;
    let sy = 0;
    const since = nowMs - shakeAt;
    if (!reduced && since < 180 && shakePx > 0) {
      const k = 1 - since / 180;
      const jolt = Math.floor(since / 30);
      sx = (jolt % 2 === 0 ? 1 : -1) * shakePx * k;
      sy = (jolt % 3 === 0 ? 1 : -1) * shakePx * k * 0.6;
    }
    placeCamera(camTarget.x, camTarget.z, sx, sy);

    // Power: the lamps on the cars light when the floor is live.
    powerLevel += ((powered ? 1 : 0.15) - powerLevel) * Math.min(1, dt * 6);
    carMats.lamp.emissive.copy(lampOn).multiplyScalar(powerLevel);
    stepMidwayBulbs(allBulbs, nowMs / 1000, { mode: powered ? 'chase' : 'flicker', stepsPerSecond: 5, load: 0.4 });
    stepSpriteParticles(sparks, dt, 9, 1.5);
    if (reduced) resetSpriteParticles(sparks);
  };

  const tmp = new THREE.Vector3();
  const bump = (a: number, b: number, x: number, z: number, nx: number, nz: number, force: number, nowMs: number, big: boolean) => {
    const angle = Math.atan2(nx, nz);
    for (const seat of [a, b]) {
      const f = fx[seat];
      if (!f) continue;
      f.squashAt = nowMs;
      f.squashForce = Math.min(1, 0.35 + force * 0.65);
      f.squashAngle = angle;
    }
    const count = midwayParticleCount(big ? 22 : 10, tier);
    emitSpriteParticles(sparks, count, {
      origin: [x, 0.35, z],
      spread: 0.2,
      speed: [1.5, big ? 5.5 : 3.5],
      up: [1, big ? 4 : 2.5],
      ttl: [0.18, big ? 0.5 : 0.32],
      size: [0.6, 1.2],
    });
    if (big) {
      // The pole's shoe crackles on the grid.
      for (const seat of [a, b]) {
        const car = cars[seat];
        if (!car) continue;
        car.poleTip.getWorldPosition(tmp);
        emitSpriteParticles(sparks, midwayParticleCount(8, tier), {
          origin: [tmp.x, tmp.y, tmp.z],
          spread: 0.1,
          speed: [0.8, 2.6],
          up: [-0.5, 1.5],
          ttl: [0.12, 0.3],
          size: [0.5, 1],
        });
      }
    }
  };

  const wall = (car: number, x: number, z: number, force: number, nowMs: number) => {
    const f = fx[car];
    if (f) {
      f.squashAt = nowMs;
      f.squashForce = Math.min(0.7, force * 0.6);
      f.squashAngle = Math.atan2(x - (cars[car]?.root.position.x ?? 0), z - (cars[car]?.root.position.z ?? 0));
    }
  };

  const proj = new THREE.Vector3();
  const project = (x: number, y: number, z: number, out: { x: number; y: number; behind: boolean }) => {
    proj.set(x, y, z).project(camera);
    out.x = ((proj.x + 1) / 2) * viewW;
    out.y = ((1 - proj.y) / 2) * viewH;
    out.behind = proj.z > 1;
  };

  const screenAxes = () => {
    const o = { x: 0, y: 0, behind: false };
    const px = { x: 0, y: 0, behind: false };
    const pz = { x: 0, y: 0, behind: false };
    project(camTarget.x, 0, camTarget.z, o);
    project(camTarget.x + 1, 0, camTarget.z, px);
    project(camTarget.x, 0, camTarget.z - 1, pz);
    const norm = (v: [number, number]): [number, number] => {
      const l = Math.hypot(v[0], v[1]) || 1;
      return [v[0] / l, v[1] / l];
    };
    // `up` is the screen direction of world -z (away from a portrait camera).
    return { right: norm([px.x - o.x, px.y - o.y]), up: norm([pz.x - o.x, pz.y - o.y]) };
  };

  const setSeatColors = (colors: readonly string[]) => {
    colors.forEach((c, i) => cars[i]?.setColor(c));
  };

  const warm = (renderer: THREE.WebGLRenderer, s: THREE.Scene) => {
    // Compile the spark material while idle so the first bump doesn't stall.
    for (const p of sparks) p.mesh.visible = true;
    renderer.compile(s, camera);
    for (const p of sparks) p.mesh.visible = p.active;
  };

  /** The floor's tile: the house steel plates, or the skin's material. */
  const floorCanvas = (): HTMLCanvasElement => {
    if (!theme.material) {
      floorMat.color.set(theme.floor);
      return paintFloor();
    }
    const c = document.createElement('canvas');
    c.width = MATERIAL_TILE;
    c.height = MATERIAL_TILE;
    paintMaterialTile(c, theme.material, { base: theme.floor, alt: theme.floorAlt, line: theme.mark });
    floorMat.color.set('#ffffff');
    return c;
  };

  const setTexture = (mat: THREE.MeshStandardMaterial, canvas: HTMLCanvasElement, nearest: boolean) => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    if (nearest) tex.magFilter = THREE.NearestFilter;
    mat.map?.dispose();
    mat.map = tex;
    mat.needsUpdate = true;
  };

  const setTheme = (next: BumperTheme) => {
    const shapeChanged = next.shape !== theme.shape;
    theme = { ...next };
    capMat.color.set(theme.cap);
    deckMat.color.set(theme.deck);
    if (!theme.material) floorMat.color.set(theme.floor);
    // Before the deferred paint, the jobs read the theme when they run.
    if (painted) {
      setTexture(floorMat, floorCanvas(), false);
      padMat.color.set('#ffffff');
      setTexture(padMat, paintRail(theme.rail, theme.railAlt), true);
    }
    if (shapeChanged) {
      const old = parts;
      parts = makeCarParts(low, theme.shape);
      for (const car of cars) {
        for (const key of Object.keys(parts) as Array<keyof typeof parts>) car.meshes[key].geometry = parts[key];
      }
      for (const g of Object.values(old)) g.dispose();
    }
  };

  const paintDeferred = () => [
    {
      paint: () => floorCanvas(),
      apply: (canvas: unknown) => {
        const tex = new THREE.CanvasTexture(canvas as HTMLCanvasElement);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        floorMat.map?.dispose();
        floorMat.map = tex;
        floorMat.needsUpdate = true;
        painted = true;
      },
    },
    {
      paint: () => paintRail(theme.rail, theme.railAlt),
      apply: (canvas: unknown) => {
        const tex = new THREE.CanvasTexture(canvas as HTMLCanvasElement);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.magFilter = THREE.NearestFilter;
        padMat.color.set('#ffffff');
        padMat.map?.dispose();
        padMat.map = tex;
        padMat.needsUpdate = true;
      },
    },
    {
      paint: () => makePlankTextures(9, 10, 10),
      apply: (t: unknown) => {
        const planks = t as { map: THREE.Texture; roughnessMap?: THREE.Texture };
        deckMat.map = planks.map;
        if (planks.roughnessMap) deckMat.roughnessMap = planks.roughnessMap;
        deckMat.needsUpdate = true;
      },
    },
    {
      paint: () => makeSignTexture({ text: 'bumper cars', width: 1024, height: 256 }),
      apply: (t: unknown) => {
        signMat.map?.dispose();
        signMat.map = t as THREE.Texture;
        signMat.needsUpdate = true;
      },
    },
  ];

  disposables.push(sparkTex, blobTex);

  return {
    camera,
    cars,
    setSize,
    update,
    bump,
    wall,
    project,
    screenAxes,
    setPowered: (on) => {
      powered = on;
    },
    setSeatColors,
    setTheme,
    setMine: (seat) => {
      mySeat = seat;
    },
    shake: (px) => {
      shakePx = px;
      shakeAt = performance.now();
    },
    warm,
    paintDeferred,
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
