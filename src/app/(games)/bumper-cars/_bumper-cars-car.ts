/* One bumper car, built from swerve's car: its chassis box becomes the tub,
   its cabin the seat back, its bonnet stripe and headlamps stay on the cowl,
   and its wheels go under a rubber ring. Flat colours on the kit's materials;
   the body colour is the seat's. The nose points along +z. */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeMidwayMaterial, MIDWAY_PALETTE } from '@/features/arcade/lib/midway-three';
import type { CarShape } from './_bumper-cars-theme';

export type BumperCarModel = {
  root: THREE.Group;
  /** Leans with the car's acceleration. */
  body: THREE.Group;
  /** Squash pivot: turned to the hit's direction, scaled, turned back. */
  squashPivot: THREE.Group;
  squashScale: THREE.Group;
  squashBack: THREE.Group;
  /** The pole's contact shoe, where the grid sparks. */
  poleTip: THREE.Object3D;
  bodyMat: THREE.MeshStandardMaterial;
  /** One mesh per part, so a new shape swaps geometry without a rebuild. */
  meshes: Record<keyof CarParts, THREE.Mesh>;
  setColor: (hex: string) => void;
};

function roundedRect(w: number, d: number, r: number): THREE.Shape {
  const x = -w / 2;
  const y = -d / 2;
  const s = new THREE.Shape();
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function roundedRectPath(w: number, d: number, r: number): THREE.Path {
  const x = -w / 2;
  const y = -d / 2;
  const p = new THREE.Path();
  p.moveTo(x + r, y);
  p.lineTo(x + w - r, y);
  p.quadraticCurveTo(x + w, y, x + w, y + r);
  p.lineTo(x + w, y + d - r);
  p.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  p.lineTo(x + r, y + d);
  p.quadraticCurveTo(x, y + d, x, y + d - r);
  p.lineTo(x, y + r);
  p.quadraticCurveTo(x, y, x + r, y);
  return p;
}

/** Lay an extruded outline flat: the shape's plane becomes the floor. */
function flat(geo: THREE.BufferGeometry, y: number): THREE.BufferGeometry {
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  return geo;
}

// Swerve's parts, for the record: chassis box -> tub, cabin -> seat back,
// bonnet stripe and headlamps -> on the cowl, wheels -> under the ring.

/** Geometry shared by all eight cars, merged to one per material so a car
 *  is seven draw calls. */
export type CarParts = {
  body: THREE.BufferGeometry;
  rubber: THREE.BufferGeometry;
  dark: THREE.BufferGeometry;
  face: THREE.BufferGeometry;
  brass: THREE.BufferGeometry;
  stripe: THREE.BufferGeometry;
  lamps: THREE.BufferGeometry;
};

function placed(geo: THREE.BufferGeometry, fn: (m: THREE.Object3D) => void): THREE.BufferGeometry {
  const o = new THREE.Object3D();
  fn(o);
  o.updateMatrix();
  const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(o.matrix);
  geo.dispose();
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const kept = parts.map((g) => {
    // Position, normal and uv only, so every part merges.
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    return g;
  });
  const merged = mergeGeometries(kept, false);
  for (const g of kept) g.dispose();
  return merged ?? new THREE.BufferGeometry();
}

/** A pointed outline, for the rocket's nose: wide at the back, a point at the front. */
function noseShape(): THREE.Shape {
  const s = new THREE.Shape();
  // Shape y runs to world -z once laid flat, so the point is at -y.
  s.moveTo(-0.66, 0.2);
  s.lineTo(0.66, 0.2);
  s.quadraticCurveTo(0.6, -0.42, 0, -0.62);
  s.quadraticCurveTo(-0.6, -0.42, -0.66, 0.2);
  return s;
}

/** The bodywork for a shape, inside the same ring. Each returns the body
 *  (the seat's colour), and where the stripe and lamps sit. */
function bodywork(shape: CarShape, curve: number): {
  body: THREE.BufferGeometry[];
  stripe: THREE.BufferGeometry[];
  lamps: Array<[number, number, number]>;
} {
  const tub = () =>
    flat(
      new THREE.ExtrudeGeometry(roundedRect(1.48, 1.8, 0.5), { depth: 0.36, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2, curveSegments: curve }),
      0.22,
    );
  const stripeAt = (y: number, z: number, len: number) => placed(new THREE.BoxGeometry(0.22, 0.03, len), (o) => o.position.set(0, y, z));
  if (shape === 'rocket') {
    const nose = flat(new THREE.ExtrudeGeometry(noseShape(), { depth: 0.3, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 2, curveSegments: curve }), 0.6);
    nose.translate(0, 0, 0.42);
    // A tail fin behind the seat, standing up.
    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0);
    finShape.lineTo(0.62, 0);
    finShape.lineTo(0.08, 0.62);
    finShape.lineTo(0, 0.62);
    finShape.lineTo(0, 0);
    const fin = new THREE.ExtrudeGeometry(finShape, { depth: 0.07, bevelEnabled: false });
    fin.rotateY(Math.PI / 2);
    fin.translate(-0.035, 0.6, -0.42);
    return { body: [tub(), nose, fin], stripe: [stripeAt(0.96, 0.62, 0.62)], lamps: [[-0.3, 0.78, 0.86], [0.3, 0.78, 0.86]] };
  }
  if (shape === 'coupe') {
    const hood = flat(
      new THREE.ExtrudeGeometry(roundedRect(1.38, 0.92, 0.36), { depth: 0.16, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2, curveSegments: curve }),
      0.6,
    );
    hood.translate(0, 0, 0.4);
    const wing = placed(new THREE.BoxGeometry(1.36, 0.06, 0.26), (o) => o.position.set(0, 1.1, -0.98));
    const posts = [-0.5, 0.5].map((x) => placed(new THREE.BoxGeometry(0.07, 0.42, 0.1), (o) => o.position.set(x, 0.86, -0.98)));
    return { body: [tub(), hood, wing, ...posts], stripe: [stripeAt(0.83, 0.4, 0.86), placed(new THREE.BoxGeometry(0.22, 0.03, 0.26), (o) => o.position.set(0, 1.145, -0.98))], lamps: [[-0.42, 0.72, 0.88], [0.42, 0.72, 0.88]] };
  }
  if (shape === 'teacup') {
    // A round cup, flared, on a saucer: the teacup ride's car.
    const cup = placed(new THREE.CylinderGeometry(0.8, 0.62, 0.62, curve * 4), (o) => o.position.set(0, 0.55, 0));
    const floor = placed(new THREE.CylinderGeometry(0.64, 0.64, 0.06, curve * 4), (o) => o.position.set(0, 0.27, 0));
    const lip = placed(new THREE.TorusGeometry(0.8, 0.05, 6, curve * 4), (o) => {
      o.rotation.x = Math.PI / 2;
      o.position.set(0, 0.86, 0);
    });
    const saucer = placed(new THREE.CylinderGeometry(0.86, 0.9, 0.08, curve * 4), (o) => o.position.set(0, 0.2, 0));
    const handle = placed(new THREE.TorusGeometry(0.2, 0.05, 6, 12, Math.PI), (o) => {
      o.rotation.z = -Math.PI / 2;
      o.position.set(0.8, 0.58, 0);
    });
    const band = placed(new THREE.TorusGeometry(0.73, 0.03, 4, curve * 4), (o) => {
      o.rotation.x = Math.PI / 2;
      o.position.set(0, 0.66, 0);
    });
    return { body: [cup, floor, lip, saucer, handle], stripe: [band], lamps: [[-0.3, 0.6, 0.72], [0.3, 0.6, 0.72]] };
  }
  const cowl = flat(
    new THREE.ExtrudeGeometry(roundedRect(1.3, 0.72, 0.32), { depth: 0.26, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 2, curveSegments: curve }),
    0.6,
  );
  cowl.translate(0, 0, 0.5);
  return { body: [tub(), cowl], stripe: [stripeAt(0.92, 0.52, 0.74)], lamps: [[-0.38, 0.76, 0.9], [0.38, 0.76, 0.9]] };
}

export function makeCarParts(lowDetail: boolean, shape: CarShape = 'dodgem'): CarParts {
  const curve = lowDetail ? 4 : 8;
  const ringShape = roundedRect(1.76, 2.06, 0.66);
  ringShape.holes.push(roundedRectPath(1.42, 1.72, 0.5));
  const ring = flat(
    new THREE.ExtrudeGeometry(ringShape, { depth: 0.26, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2, curveSegments: curve }),
    0.12,
  );
  const work = bodywork(shape, curve);
  // The seat back stands up: its outline faces the nose.
  const seat = new THREE.ExtrudeGeometry(roundedRect(1.08, 0.5, 0.18), {
    depth: 0.16,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.03,
    bevelSegments: 1,
    curveSegments: curve,
  });
  seat.translate(0, 0.87, -0.62);
  const wheel = placed(new THREE.TorusGeometry(0.17, 0.035, 6, lowDetail ? 12 : 20), (o) => {
    o.rotation.x = -Math.PI / 2 + 0.55;
    o.position.set(0, 1.0, 0.12);
  });
  const torso = placed(new THREE.CapsuleGeometry(0.2, 0.22, 3, lowDetail ? 6 : 10), (o) => o.position.set(0, 0.98, -0.3));
  const pole = placed(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 6), (o) => o.position.set(0, 1.7, -0.86));
  const head = placed(new THREE.SphereGeometry(0.17, lowDetail ? 10 : 16, lowDetail ? 8 : 12), (o) => o.position.set(0, 1.42, -0.28));
  const spring = placed(new THREE.CylinderGeometry(0.06, 0.06, 0.34, 8), (o) => o.position.set(0, 0.8, -0.86));
  const shoe = placed(new THREE.BoxGeometry(0.18, 0.05, 0.1), (o) => o.position.set(0, 2.47, -0.86));
  const lamps = work.lamps.map(([lx, ly, lz]) =>
    placed(new THREE.CylinderGeometry(0.09, 0.09, 0.05, lowDetail ? 10 : 16), (o) => {
      o.rotation.x = Math.PI / 2;
      o.position.set(lx, ly, lz);
    }),
  );
  return {
    body: merge(work.body),
    rubber: merge([ring, wheel]),
    dark: merge([seat, torso, pole]),
    face: merge([head]),
    brass: merge([spring, shoe]),
    stripe: merge(work.stripe),
    lamps: merge(lamps),
  };
}

export type CarMaterials = {
  rubber: THREE.MeshStandardMaterial;
  stripe: THREE.MeshStandardMaterial;
  lamp: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  face: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
};

export function makeCarMaterials(): CarMaterials {
  return {
    rubber: makeMidwayMaterial('ink', { roughness: 0.92 }),
    stripe: makeMidwayMaterial('paper'),
    lamp: makeMidwayMaterial('paper', { emissive: new THREE.Color(MIDWAY_PALETTE.practicalLight), emissiveIntensity: 0.35 }),
    dark: makeMidwayMaterial('ink', { color: MIDWAY_PALETTE.ink2 }),
    face: makeMidwayMaterial('paper', { color: MIDWAY_PALETTE.paper3 }),
    brass: makeMidwayMaterial('brass'),
  };
}

export function buildBumperCar(parts: CarParts, mats: CarMaterials, color: string, shadows: boolean): BumperCarModel {
  const root = new THREE.Group();
  const squashPivot = new THREE.Group();
  const squashScale = new THREE.Group();
  const squashBack = new THREE.Group();
  const body = new THREE.Group();
  root.add(squashPivot);
  squashPivot.add(squashScale);
  squashScale.add(squashBack);
  squashBack.add(body);

  const bodyMat = makeMidwayMaterial('red', { color });
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadows && cast;
    m.receiveShadow = false;
    body.add(m);
    return m;
  };
  const meshes: Record<keyof CarParts, THREE.Mesh> = {
    body: mesh(parts.body, bodyMat),
    rubber: mesh(parts.rubber, mats.rubber),
    dark: mesh(parts.dark, mats.dark),
    face: mesh(parts.face, mats.face, false),
    brass: mesh(parts.brass, mats.brass, false),
    stripe: mesh(parts.stripe, mats.stripe, false),
    lamps: mesh(parts.lamps, mats.lamp, false),
  };
  const poleTip = new THREE.Object3D();
  poleTip.position.set(0, 2.5, -0.86);
  body.add(poleTip);

  return {
    root,
    body,
    squashPivot,
    squashScale,
    squashBack,
    poleTip,
    bodyMat,
    meshes,
    setColor: (hex) => bodyMat.color.set(hex),
  };
}
