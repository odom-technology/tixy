/* The pictures and shapes a high striker skin set makes (SKINS.md): the
   tower face's material as a repeating tile, and the puck as a flat shape.
   Flat fills and hard edges only. The puck's shape stays inside the house
   puck's footprint (about 0.46 wide and 0.43 tall, between the guide rails)
   and is drawn at the same centre, so a swing climbs to the same line. It
   never moves the puck, the line or a zone. */

import * as THREE from 'three';

import { paintMaterialTile } from '@/features/arcade/lib/skins/skin-material-canvas';

import type { HighStrikerSkin } from './_high-striker-theme';

/** The face's tile: the skin's material, repeating up the tower. */
export function paintTowerFace(canvas: HTMLCanvasElement, skin: HighStrikerSkin): void {
  paintMaterialTile(canvas, skin.material, skin.face, 'v');
}

const BODY_DEPTH = 0.2;
const BEVEL = 0.018;
/* Local z of the puck's back face: the shape sits in front of the guide rails
   the way the house disc does. */
const BODY_Z = 0.1;

function starShape(outer: number, inner: number, lift = 0): THREE.Shape {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r + lift;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

function heartShape(k = 1, dy = 0): THREE.Shape {
  const shape = new THREE.Shape();
  const p = (x: number, y: number) => [x * k, y * k + dy] as const;
  shape.moveTo(...p(0, -0.21));
  shape.bezierCurveTo(...p(-0.14, -0.11), ...p(-0.23, -0.02), ...p(-0.23, 0.08));
  shape.bezierCurveTo(...p(-0.23, 0.16), ...p(-0.17, 0.21), ...p(-0.11, 0.21));
  shape.bezierCurveTo(...p(-0.06, 0.21), ...p(-0.02, 0.18), ...p(0, 0.14));
  shape.bezierCurveTo(...p(0.02, 0.18), ...p(0.06, 0.21), ...p(0.11, 0.21));
  shape.bezierCurveTo(...p(0.17, 0.21), ...p(0.23, 0.16), ...p(0.23, 0.08));
  shape.bezierCurveTo(...p(0.23, -0.02), ...p(0.14, -0.11), ...p(0, -0.21));
  return shape;
}

/* A ticket stub: a rectangle with a half-round bite out of each side. */
function stubShape(): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(-0.25, -0.14);
  shape.lineTo(0.25, -0.14);
  shape.lineTo(0.25, -0.05);
  shape.absarc(0.25, 0, 0.05, -Math.PI / 2, Math.PI / 2, true);
  shape.lineTo(0.25, 0.14);
  shape.lineTo(-0.25, 0.14);
  shape.lineTo(-0.25, 0.05);
  shape.absarc(-0.25, 0, 0.05, Math.PI / 2, -Math.PI / 2, true);
  shape.closePath();
  return shape;
}

const extrude = (shapes: THREE.Shape | THREE.Shape[], depth: number, bevel: number, z: number) => {
  const geo = new THREE.ExtrudeGeometry(shapes, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 10,
  });
  geo.translate(0, 0, z);
  return geo;
};

/** The puck's body for a skin shape, or null for the house disc. */
export function makePuckGeometry(shape: HighStrikerSkin['shape']): THREE.BufferGeometry | null {
  if (shape === 'star') return extrude(starShape(0.235, 0.1, -0.022), BODY_DEPTH, BEVEL, BODY_Z);
  if (shape === 'heart') return extrude(heartShape(), BODY_DEPTH, BEVEL, BODY_Z);
  if (shape === 'stub') return extrude(stubShape(), BODY_DEPTH, BEVEL, BODY_Z);
  return null;
}

/** The mark on the puck's face: a smaller star or heart, or the stub's
 *  perforation. Null for the house disc. */
export function makePuckMarkGeometry(shape: HighStrikerSkin['shape']): THREE.BufferGeometry | null {
  const z = BODY_Z + BODY_DEPTH + BEVEL;
  if (shape === 'star') return extrude(starShape(0.115, 0.05, -0.012), 0.02, 0, z);
  if (shape === 'heart') return extrude(heartShape(0.5, -0.005), 0.02, 0, z);
  if (shape === 'stub') {
    const dashes: THREE.Shape[] = [];
    for (let i = 0; i < 4; i += 1) {
      const y = -0.1 + i * 0.065;
      const dash = new THREE.Shape();
      dash.moveTo(0.1, y);
      dash.lineTo(0.125, y);
      dash.lineTo(0.125, y + 0.04);
      dash.lineTo(0.1, y + 0.04);
      dash.closePath();
      dashes.push(dash);
    }
    return extrude(dashes, 0.02, 0, z);
  }
  return null;
}
