/* Skee-ball cabinet geometry, built from the shared engine's constants so
   what is drawn is what the ball hits: the lane and its hump, the gap, the
   ball box with its ring walls, holes and pockets, the ball return. Plus
   the return path a finished ball travels, as points with a speed rule
   (no keyframe easing, so the ball never stops between points). */

import * as THREE from 'three';

import {
  SKEE_BALL_R,
  SKEE_BOARD_COS,
  SKEE_BOARD_HALF,
  SKEE_BOARD_HOLES,
  SKEE_BOARD_SIN,
  SKEE_BACK_WALL_H,
  SKEE_FIELD_W_BACK,
  SKEE_FIELD_Y0,
  SKEE_FIELD_Z0,
  SKEE_GAP_FLOOR_Y,
  SKEE_GRAVITY,
  SKEE_HOLE20_W,
  SKEE_HOLE30_W,
  SKEE_HOLE40_W,
  SKEE_LANE_HALF,
  SKEE_POCKET_R,
  SKEE_POCKET_W,
  SKEE_POCKET_X,
  SKEE_R20,
  SKEE_R30,
  SKEE_R40,
  SKEE_R50,
  SKEE_RING_WALL_H,
  SKEE_S_LIP,
  SKEE_SIDE_WALL_H,
  SKEE_SLOT10_W,
  SKEE_W_CENTER,
  SKEE_Y_LIP,
  SKEE_Z_LIP,
  skeeFieldToWorld,
  skeeLanePoint,
} from '@/server/arcade/skee-ball-replay';

/** Where the ball rests at the hand: the sim's start, on the lane. */
export const BALL_START: [number, number, number] = [0, SKEE_BALL_R, 0];
/** Front of the cabinet (behind the hand) and its back (behind the box). */
export const CAB_FRONT_Z = -0.85;
export const CAB_BACK_Z = SKEE_FIELD_Z0 + SKEE_FIELD_W_BACK * SKEE_BOARD_COS + 0.25;
/** Inside face of the cabinet walls, and their thickness. */
export const CAB_WALL_X = SKEE_BOARD_HALF + 0.12;
export const CAB_WALL_T = 0.38;
/** The return trough on the near side (world -x, screen-right). */
export const TROUGH_X = -(SKEE_LANE_HALF + CAB_WALL_X) / 2 - 0.02;
const TROUGH_HEAD_Z = SKEE_FIELD_Z0 - 0.2;
const TROUGH_END_Z = -0.45;
export const troughFloorY = (z: number) => {
  const k = Math.min(1, Math.max(0, (z - TROUGH_END_Z) / (TROUGH_HEAD_Z - TROUGH_END_Z)));
  return -0.46 + k * 0.2;
};
/** The spout under the front of the box, where a scored ball comes out. */
export const SPOUT: [number, number, number] = [TROUGH_X, SKEE_GAP_FLOOR_Y + 0.16, SKEE_FIELD_Z0 - 0.06];
/** The display over the back of the box. */
export const BACK_TOP = skeeFieldToWorld(0, SKEE_FIELD_W_BACK);
export const DISPLAY_POS: [number, number, number] = [0, BACK_TOP.y + SKEE_BACK_WALL_H * SKEE_BOARD_COS + 0.5, BACK_TOP.z + 0.05];
/** The lamp over the box. */
export const LAMP_POS: [number, number, number] = [0, BACK_TOP.y + 1.0, SKEE_FIELD_Z0 + 1.25];

export type SkeeCabinetMats = {
  lane: THREE.Material;
  cabinet: THREE.Material;
  rail: THREE.Material;
  trim: THREE.Material;
  brass: THREE.Material;
  field: THREE.Material;
  hole: THREE.Material;
  chute: THREE.Material;
  ring20: THREE.Material;
  ring30: THREE.Material;
  ring40: THREE.Material;
  ring50: THREE.Material;
  pocket: THREE.Material;
};

/** Board-plane placement helpers (field coords x, w; lift along the normal). */
const N_Y = SKEE_BOARD_COS;
const N_Z = -SKEE_BOARD_SIN;
const BOARD_TILT = Math.atan2(SKEE_BOARD_SIN, SKEE_BOARD_COS);
export function placeOnBoard(scene: THREE.Object3D, mesh: THREE.Object3D, x: number, w: number, lift: number) {
  const p = skeeFieldToWorld(x, w);
  mesh.position.set(p.x, p.y + N_Y * lift, p.z + N_Z * lift);
  mesh.rotation.x = -(Math.PI / 2 + BOARD_TILT);
  scene.add(mesh);
}
/** Cylinders whose axis runs along the board normal. */
function placeAlongNormal(scene: THREE.Object3D, mesh: THREE.Object3D, x: number, w: number, lift: number) {
  const p = skeeFieldToWorld(x, w);
  mesh.position.set(p.x, p.y + N_Y * lift, p.z + N_Z * lift);
  mesh.rotation.x = -BOARD_TILT;
  scene.add(mesh);
}

/** The lane's top surface as (z, y) points, from the cabinet front to the lip. */
function laneProfile(): Array<[number, number]> {
  const pts: Array<[number, number]> = [[CAB_FRONT_Z, 0]];
  for (let i = 0; i <= 24; i += 1) {
    const p = skeeLanePoint((SKEE_S_LIP * i) / 24);
    pts.push([p.z, p.y]);
  }
  return pts;
}

function extrudeProfile(
  top: Array<[number, number]>,
  bottomY: number,
  xOuter: number,
  thickness: number,
  material: THREE.Material,
) {
  const shape = new THREE.Shape();
  shape.moveTo(top[0][0], bottomY);
  for (const [z, y] of top) shape.lineTo(z, y);
  shape.lineTo(top[top.length - 1][0], bottomY);
  shape.closePath();
  const mesh = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 1 }),
    material,
  );
  // Shape x is +z; extrusion depth runs to -x from xOuter.
  mesh.rotation.y = -Math.PI / 2;
  mesh.position.x = xOuter;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * UVs in world units, one repeat per `tile`, so a tiling material (a skin's
 * lane) lies on the extrusion without stretching: along the lane on its top
 * face, across it on the flanks. Only the picture changes; no vertex moves.
 */
function tileUVs(geometry: THREE.BufferGeometry, tile: number) {
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const nor = geometry.attributes.normal as THREE.BufferAttribute;
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));
    if (ny >= nx && ny >= nz) uv.setXY(i, z / tile, x / tile);
    else if (nx >= nz) uv.setXY(i, z / tile, y / tile);
    else uv.setXY(i, x / tile, y / tile);
  }
  uv.needsUpdate = true;
}

/**
 * Build the cabinet into `scene`. Returns the spout flap (it swings as a
 * ball comes out) for the render loop.
 */
export function buildSkeeCabinet(scene: THREE.Scene, mats: SkeeCabinetMats): { spoutFlap: THREE.Group } {
  const lane = laneProfile();

  // Lane bed and hump, one extrusion, rails along both sides.
  const laneBed = extrudeProfile(lane, -0.55, SKEE_LANE_HALF, SKEE_LANE_HALF * 2, mats.lane);
  tileUVs(laneBed.geometry, SKEE_LANE_HALF * 2);
  scene.add(laneBed);
  for (const side of [-1, 1]) {
    const pts = lane.map(([z, y]) => new THREE.Vector3(side * (SKEE_LANE_HALF + 0.03), y + 0.06, z));
    const rail = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.035, 6),
      mats.brass,
    );
    rail.castShadow = true;
    scene.add(rail);
  }
  // Far side: a wooden deck between the rail and the cabinet wall.
  const farTop = lane.map(([z, y]) => [z, y + 0.08] as [number, number]);
  scene.add(extrudeProfile(farTop, -0.55, CAB_WALL_X, CAB_WALL_X - SKEE_LANE_HALF - 0.06, mats.cabinet));

  // Near side: the return trough, sunk below the lane, falling toward the hand.
  const troughFloor: Array<[number, number]> = [];
  for (let i = 0; i <= 8; i += 1) {
    const z = TROUGH_END_Z + ((TROUGH_HEAD_Z - TROUGH_END_Z) * i) / 8;
    troughFloor.push([z, troughFloorY(z)]);
  }
  const troughW = CAB_WALL_X - SKEE_LANE_HALF - 0.06;
  scene.add(extrudeProfile(troughFloor, -0.7, -(SKEE_LANE_HALF + 0.06), troughW, mats.chute));
  // The trough's inner lip, following the lane.
  scene.add(extrudeProfile(farTop, -0.6, -(SKEE_LANE_HALF + 0.02), 0.05, mats.cabinet));

  // Cabinet side walls: low at the hand, rising over the box.
  const wallTop: Array<[number, number]> = [
    [CAB_FRONT_Z, 0.32],
    [SKEE_Z_LIP - 1.4, 0.38],
    [SKEE_Z_LIP, SKEE_Y_LIP + 0.55],
    [CAB_BACK_Z, BACK_TOP.y + SKEE_SIDE_WALL_H + 0.25],
  ];
  // Thick walls, as on a real alley: the cabinet reads as one solid body.
  for (const side of [-1, 1]) {
    const xOuter = side > 0 ? CAB_WALL_X + CAB_WALL_T : -CAB_WALL_X;
    scene.add(extrudeProfile(wallTop, -0.75, xOuter, CAB_WALL_T, mats.cabinet));
    const cap = new THREE.Mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(
          wallTop.map(([z, y]) => new THREE.Vector3(side * (CAB_WALL_X + 0.03), y + 0.02, z)),
          false,
          'catmullrom',
          0.1,
        ),
        40,
        0.04,
        6,
      ),
      mats.brass,
    );
    scene.add(cap);
  }

  // The gap: a dark well between the lip and the box, floor below the lip.
  const gapDepth = SKEE_FIELD_Z0 - SKEE_Z_LIP + 0.3;
  const gap = new THREE.Mesh(new THREE.BoxGeometry(CAB_WALL_X * 2, 0.1, gapDepth), mats.hole);
  gap.position.set(0, SKEE_GAP_FLOOR_Y - 0.05, (SKEE_Z_LIP + SKEE_FIELD_Z0) / 2);
  gap.receiveShadow = true;
  scene.add(gap);
  // The lip's face, down to the gap floor.
  const lipFace = new THREE.Mesh(new THREE.BoxGeometry(SKEE_LANE_HALF * 2 + 0.12, SKEE_Y_LIP - SKEE_GAP_FLOOR_Y, 0.06), mats.trim);
  lipFace.position.set(0, (SKEE_Y_LIP + SKEE_GAP_FLOOR_Y) / 2, SKEE_Z_LIP + 0.03);
  scene.add(lipFace);

  // ── The ball box ──
  const boardLen = SKEE_FIELD_W_BACK;
  const base = new THREE.Mesh(new THREE.PlaneGeometry(SKEE_BOARD_HALF * 2, boardLen), mats.field);
  base.receiveShadow = true;
  placeOnBoard(scene, base, 0, boardLen / 2, 0);
  // The front edge of the box, down to the gap floor.
  const front = new THREE.Mesh(new THREE.BoxGeometry(SKEE_BOARD_HALF * 2, SKEE_FIELD_Y0 - SKEE_GAP_FLOOR_Y, 0.05), mats.field);
  front.position.set(0, (SKEE_FIELD_Y0 + SKEE_GAP_FLOOR_Y) / 2, SKEE_FIELD_Z0 + 0.02);
  scene.add(front);

  // Bands: 20, 30, 40 as enamel annuli; the 10 region is the board itself.
  const bands: Array<[number, number, THREE.Material]> = [
    [SKEE_R30, SKEE_R20, mats.ring20],
    [SKEE_R40, SKEE_R30, mats.ring30],
    [SKEE_R50, SKEE_R40, mats.ring40],
  ];
  for (const [inner, outer, mat] of bands) {
    placeOnBoard(scene, new THREE.Mesh(new THREE.RingGeometry(inner, outer, 64), mat), 0, SKEE_W_CENTER, 0.003);
  }
  // Holes: the 50 cup, each band's hole at its bottom, the 10 slot, the 100s.
  const holeDisc = (x: number, w: number, r: number) =>
    placeOnBoard(scene, new THREE.Mesh(new THREE.CircleGeometry(r, 32), mats.hole), x, w, 0.006);
  holeDisc(0, SKEE_W_CENTER, SKEE_R50 - 0.012);
  const bandHole = (w: number, inner: number, outer: number) => holeDisc(0, w, (outer - inner) / 2 - 0.02);
  bandHole(SKEE_HOLE40_W, SKEE_R50, SKEE_R40);
  bandHole(SKEE_HOLE30_W, SKEE_R40, SKEE_R30);
  bandHole(SKEE_HOLE20_W, SKEE_R30, SKEE_R20);
  const slot = new THREE.Mesh(new THREE.PlaneGeometry(SKEE_BOARD_HALF * 2, SKEE_SLOT10_W), mats.hole);
  placeOnBoard(scene, slot, 0, SKEE_SLOT10_W / 2, 0.006);
  for (const px of [-SKEE_POCKET_X, SKEE_POCKET_X]) {
    holeDisc(px, SKEE_POCKET_W, SKEE_POCKET_R);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(SKEE_POCKET_R + 0.012, 0.016, 8, 40), mats.pocket);
    placeOnBoard(scene, rim, px, SKEE_POCKET_W, 0.008);
  }

  // Ring walls: open cylinders as tall as the sim's walls, a brass bead on top.
  for (const r of [SKEE_R50, SKEE_R40, SKEE_R30, SKEE_R20]) {
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, SKEE_RING_WALL_H, 72, 1, true),
      r === SKEE_R50 ? mats.brass : mats.trim,
    );
    wall.castShadow = true;
    placeAlongNormal(scene, wall, 0, SKEE_W_CENTER, SKEE_RING_WALL_H / 2);
    const bead = new THREE.Mesh(new THREE.TorusGeometry(r, 0.018, 6, 72), mats.brass);
    placeOnBoard(scene, bead, 0, SKEE_W_CENTER, SKEE_RING_WALL_H);
  }

  // Box sides and back wall.
  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.05, SKEE_SIDE_WALL_H, boardLen), mats.cabinet);
    placeAlongNormal(scene, panel, side * (SKEE_BOARD_HALF + 0.025), boardLen / 2, SKEE_SIDE_WALL_H / 2);
    panel.rotation.x = -BOARD_TILT;
  }
  const back = new THREE.Mesh(new THREE.BoxGeometry(SKEE_BOARD_HALF * 2 + 0.1, SKEE_BACK_WALL_H, 0.08), mats.trim);
  back.castShadow = true;
  placeAlongNormal(scene, back, 0, boardLen + 0.04, SKEE_BACK_WALL_H / 2);
  back.rotation.x = 0;
  back.position.set(BACK_TOP.x, BACK_TOP.y + SKEE_BACK_WALL_H / 2, BACK_TOP.z + 0.04);

  // The cabinet head behind the display.
  const hood = new THREE.Mesh(new THREE.BoxGeometry((CAB_WALL_X + CAB_WALL_T) * 2, 1.0, 0.4), mats.cabinet);
  hood.position.set(0, DISPLAY_POS[1] + 0.05, DISPLAY_POS[2] + 0.3);
  hood.castShadow = true;
  scene.add(hood);

  // ── Ball return: spout under the box front, then the trough, then the cradle ──
  const spoutFlap = new THREE.Group();
  spoutFlap.position.set(SPOUT[0], SPOUT[1] + 0.14, SPOUT[2] - 0.02);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.02), mats.brass);
  leaf.position.set(0, -0.13, 0);
  spoutFlap.add(leaf);
  scene.add(spoutFlap);
  const spoutMouth = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.3), mats.hole);
  spoutMouth.position.set(SPOUT[0], SPOUT[1], SPOUT[2]);
  spoutMouth.rotation.y = Math.PI;
  scene.add(spoutMouth);

  // The kick-up from the trough's end to the lane at the hand.
  const kick = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.34), mats.brass);
  kick.position.set((TROUGH_X - 0.55) / 2, (troughFloorY(TROUGH_END_Z) + 0.02) / 2, TROUGH_END_Z + 0.1);
  kick.rotation.z = 0.62;
  kick.receiveShadow = true;
  scene.add(kick);
  // The cradle: a brass ring the ball sits in.
  const cradle = new THREE.Mesh(new THREE.TorusGeometry(SKEE_BALL_R * 1.15, 0.025, 8, 28), mats.brass);
  cradle.rotation.x = Math.PI / 2;
  cradle.position.set(BALL_START[0], 0.02, BALL_START[2]);
  scene.add(cradle);

  return { spoutFlap };
}

// ── The return path ──

/** `drop`: the segment ending here is a fall (into a hole): full gravity,
 *  no minimum speed. */
export type ReturnPoint = {
  p: [number, number, number];
  visible?: boolean;
  drop?: boolean;
  cue?: 'cup' | 'chute' | 'settle' | 'cradle';
};

/**
 * The centre of the hole a scored ball drops into, so it sinks into the
 * drawn hole rather than wherever the sim caught it (up to 0.15 off
 * centre). The 10 drops into the slot under it. A ball scored by the
 * board's time-out sinks where it is.
 */
export function holeCentre(ring: number | null, x: number, w: number): { x: number; w: number } {
  let at: { x: number; w: number } | null = null;
  if (ring === 10) at = { x, w: Math.min(w, SKEE_SLOT10_W / 2) };
  else if (ring === 100) at = { x: x >= 0 ? SKEE_POCKET_X : -SKEE_POCKET_X, w: SKEE_POCKET_W };
  else {
    const hole = SKEE_BOARD_HOLES.find((h) => h.ring === ring && h.x === 0);
    if (hole) at = { x: hole.x, w: hole.w };
  }
  if (!at) return { x, w };
  const dx = at.x - x;
  const dw = at.w - w;
  return dx * dx + dw * dw <= 0.25 * 0.25 ? at : { x, w };
}

/** Points a finished ball travels, ending in the cradle. */
export function returnPoints(
  from: [number, number, number],
  kind: 'ring' | 'short' | 'over' | 'gutter',
  ring: number | null,
  holeAt: { x: number; w: number } | null,
): ReturnPoint[] {
  const tail: ReturnPoint[] = [
    { p: [TROUGH_X, troughFloorY(TROUGH_HEAD_Z) + SKEE_BALL_R, TROUGH_HEAD_Z], cue: 'chute' },
    { p: [TROUGH_X, troughFloorY((TROUGH_HEAD_Z + TROUGH_END_Z) / 2) + SKEE_BALL_R, (TROUGH_HEAD_Z + TROUGH_END_Z) / 2] },
    { p: [TROUGH_X, troughFloorY(TROUGH_END_Z) + SKEE_BALL_R, TROUGH_END_Z] },
    { p: [-0.62, SKEE_BALL_R + 0.03, TROUGH_END_Z + 0.2] },
    { p: [-0.22, SKEE_BALL_R, -0.12] },
    { p: BALL_START, cue: 'cradle' },
  ];
  if (kind === 'short' && from[1] > SKEE_GAP_FLOOR_Y + SKEE_BALL_R + 0.05 && from[2] < SKEE_Z_LIP) {
    // Stalled on the hump: it rolls straight back down the lane to the hand.
    return [
      { p: from },
      { p: [from[0] * 0.4, SKEE_BALL_R, Math.min(from[2], 2.2)] },
      { p: [0, SKEE_BALL_R, 0.6] },
      { p: BALL_START, cue: 'cradle' },
    ];
  }
  if (kind === 'ring' && holeAt) {
    // Over the hole's centre, then down it: the board hides the ball as it
    // sinks, so it reads as dropping in. Then out of sight inside the box
    // and out of the spout.
    const top = skeeFieldToWorld(holeAt.x, holeAt.w, SKEE_BALL_R * 0.6);
    const sunk = skeeFieldToWorld(holeAt.x, holeAt.w, -0.12);
    const gone = skeeFieldToWorld(holeAt.x, holeAt.w, -0.28);
    return [
      { p: from },
      { p: [top.x, top.y, top.z], drop: true, cue: 'cup' },
      { p: [sunk.x, sunk.y, sunk.z], drop: true },
      { p: [gone.x, gone.y, gone.z], visible: false, drop: true },
      { p: [SPOUT[0], SPOUT[1] + 0.25, SPOUT[2] + 0.3], visible: false },
      { p: [SPOUT[0], SPOUT[1], SPOUT[2] - 0.02] },
      { p: [SPOUT[0], SKEE_GAP_FLOOR_Y + SKEE_BALL_R, SPOUT[2] - 0.14], cue: 'settle' },
      ...tail,
    ];
  }
  if (kind === 'over') {
    return [
      { p: from },
      { p: [from[0], from[1] + 0.1, from[2] + 0.3], visible: false },
      { p: [SPOUT[0], SPOUT[1] + 0.25, SPOUT[2] + 0.3], visible: false },
      { p: [SPOUT[0], SPOUT[1], SPOUT[2] - 0.02] },
      { p: [SPOUT[0], SKEE_GAP_FLOOR_Y + SKEE_BALL_R, SPOUT[2] - 0.14], cue: 'settle' },
      ...tail,
    ];
  }
  // In the gap: it rolls along the gap floor to the near side, into the trough.
  void ring;
  return [
    { p: from },
    { p: [Math.max(TROUGH_X, from[0] - 0.3), SKEE_GAP_FLOOR_Y + SKEE_BALL_R, Math.min(from[2], SKEE_FIELD_Z0 - 0.12)], cue: 'settle' },
    ...tail,
  ];
}

/**
 * A ball rolling along points: speed from gravity along each segment's
 * slope (a rolling ball feels 5/7 of it) less resistance, never below a
 * floor, easing to rest only over the last stretch into the cradle. It
 * starts at the speed the sim left it with, and the floor rises from there
 * at FLOOR_RAMP, so its speed is continuous: it never stops, starts or
 * jumps at a point, including the hand-off from the sim.
 */
export type ReturnRun = {
  points: ReturnPoint[];
  lengths: number[];
  total: number;
  s: number;
  v: number;
  floor: number;
  cueIndex: number;
};

/** The return's cruising floor in the open, and inside the box. */
const RETURN_FLOOR = 3.8;
const RETURN_FLOOR_HIDDEN = 5;
/** How fast the floor rises from the sim's speed to the cruise (units/s^2). */
const FLOOR_RAMP = 9;

export function startReturnRun(points: ReturnPoint[], speed: number): ReturnRun {
  const lengths = [0];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1].p;
    const b = points[i].p;
    lengths.push(lengths[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  const v = Math.min(6.5, Math.max(0.3, speed));
  return { points, lengths, total: lengths[lengths.length - 1], s: 0, v, floor: Math.min(v, RETURN_FLOOR), cueIndex: 0 };
}

/** Advance the run by dt seconds. Returns the cues passed, and whether it ended. */
export function stepReturnRun(run: ReturnRun, dt: number): { cues: ReturnPoint['cue'][]; done: boolean } {
  const cues: ReturnPoint['cue'][] = [];
  let i = 1;
  while (i < run.lengths.length - 1 && run.lengths[i] <= run.s) i += 1;
  const a = run.points[i - 1].p;
  const b = run.points[i].p;
  const segLen = Math.max(1e-6, run.lengths[i] - run.lengths[i - 1]);
  const slope = (b[1] - a[1]) / segLen;
  const hidden = run.points[i - 1].visible === false || run.points[i].visible === false;
  const drop = run.points[i].drop === true;
  // A drop falls; inside the box it travels at a steady clip; elsewhere it
  // rolls.
  const accel = drop ? -SKEE_GRAVITY * slope : hidden ? 0 : -(5 / 7) * SKEE_GRAVITY * slope - 0.6;
  // A return tilted toward the hand keeps a ball moving at a brisk roll; the
  // floor climbs to that pace rather than jumping to it.
  run.floor = Math.min(hidden ? RETURN_FLOOR_HIDDEN : RETURN_FLOOR, run.floor + FLOOR_RAMP * dt);
  run.v = Math.min(6.5, Math.max(drop ? 0.3 : run.floor, run.v + accel * dt));
  // After a drop the floor climbs again from the speed the ball has.
  if (drop) run.floor = Math.min(run.floor, run.v);
  const remaining = run.total - run.s;
  // Come to rest in the cradle: v^2 = 2 a d, braking at 8 units/s^2.
  run.v = Math.min(run.v, Math.sqrt(2 * 8 * Math.max(0, remaining)) + 0.05);
  run.s = Math.min(run.total, run.s + run.v * dt);
  while (run.cueIndex < run.points.length && run.lengths[run.cueIndex] <= run.s + 1e-9) {
    cues.push(run.points[run.cueIndex].cue);
    run.cueIndex += 1;
  }
  return { cues, done: run.s >= run.total - 1e-4 };
}

/** Position on the run, and whether the ball shows there. */
export function sampleReturnRun(run: ReturnRun): { p: [number, number, number]; visible: boolean } {
  let i = 1;
  while (i < run.lengths.length - 1 && run.lengths[i] < run.s) i += 1;
  const a = run.points[i - 1];
  const b = run.points[i];
  const k = Math.min(1, Math.max(0, (run.s - run.lengths[i - 1]) / Math.max(1e-6, run.lengths[i] - run.lengths[i - 1])));
  return {
    p: [a.p[0] + (b.p[0] - a.p[0]) * k, a.p[1] + (b.p[1] - a.p[1]) * k, a.p[2] + (b.p[2] - a.p[2]) * k],
    visible: a.visible !== false && b.visible !== false,
  };
}
