/* ──────────────────────────────────────────────────────────────────────────
   PRIZE CLAW — the prizes in the case.

   Seven simple models, flat-shaded from a few boxes, cylinders and low-poly
   spheres, in the tixy palette. Each stands for a kind of thing on the prize
   counter: a medal for an avatar, a frame for a board, a stack of blocks, a
   ball, a critter, a banner, a wrapped box for the rest. No textures and no
   images: the colour is the tier's, the shape is the item's.

   Geometry is built once and shared; a bed only makes groups of meshes that
   point at it, so refilling the case allocates no GPU buffers.
   ────────────────────────────────────────────────────────────────────────── */

import * as THREE from 'three';

import type { ClawForm } from '@/features/arcade/lib/prize-claw-shelf';

/** Where the fingers meet each model, before the tier's scale. */
export const CLAW_FORM_TOP: Record<ClawForm, number> = {
  medal: 0.27,
  frame: 0.27,
  blocks: 0.3,
  ball: 0.22,
  critter: 0.27,
  banner: 0.34,
  box: 0.2,
};

type Geo = THREE.BufferGeometry;

const cache = new Map<string, Geo>();

function geo(key: string, make: () => Geo): Geo {
  let g = cache.get(key);
  if (!g) {
    g = make();
    cache.set(key, g);
  }
  return g;
}

/** Shared geometry lives for the page; this lets a scene teardown release it. */
export function disposeClawFormGeometry(): void {
  for (const g of cache.values()) g.dispose();
  cache.clear();
}

const box = (w: number, h: number, d: number) =>
  geo(`box:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (rt: number, rb: number, h: number, seg = 10) =>
  geo(`cyl:${rt}:${rb}:${h}:${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1));
const ico = (r: number, detail = 1) =>
  geo(`ico:${r}:${detail}`, () => new THREE.IcosahedronGeometry(r, detail));
const cone = (r: number, h: number, seg = 6) =>
  geo(`cone:${r}:${h}:${seg}`, () => new THREE.ConeGeometry(r, h, seg));
const ring = (r: number, t: number) =>
  geo(`ring:${r}:${t}`, () => new THREE.TorusGeometry(r, t, 5, 12));

/**
 * One model, at rest, base on y = 0. `variant` turns and nudges the parts so a
 * row of one kind is not a row of clones.
 */
export function buildPrizeForm(
  form: ClawForm,
  body: THREE.Material,
  accent: THREE.Material,
  variant: number,
): THREE.Group {
  const group = new THREE.Group();
  const part = (g: Geo, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };
  const turn = ((variant % 4) - 1.5) * 0.12;

  // A coaster under every prize, so each one reads as a thing on a stand.
  part(cyl(0.1, 0.11, 0.02, 12), accent, 0, 0.01, 0).receiveShadow = true;

  switch (form) {
    case 'medal': {
      const disc = part(cyl(0.105, 0.105, 0.035, 10), body, 0, 0.17, 0);
      disc.rotation.x = Math.PI / 2;
      const face = part(cyl(0.065, 0.065, 0.04, 10), accent, 0, 0.17, -0.004);
      face.rotation.x = Math.PI / 2;
      part(box(0.05, 0.1, 0.03), accent, 0, 0.08, 0.01);
      part(cone(0.035, 0.07, 4), accent, 0, 0.29, 0).rotation.y = Math.PI / 4;
      break;
    }
    case 'frame': {
      const f = part(box(0.2, 0.2, 0.03), body, 0, 0.14, 0);
      f.rotation.x = -0.22;
      const inner = part(box(0.12, 0.12, 0.034), accent, 0, 0.14, -0.004);
      inner.rotation.x = -0.22;
      part(box(0.04, 0.12, 0.03), body, 0, 0.09, 0.08).rotation.x = 0.5;
      break;
    }
    case 'blocks': {
      part(box(0.17, 0.09, 0.17), body, 0, 0.065, 0).rotation.y = turn;
      part(box(0.14, 0.09, 0.14), accent, 0.01, 0.155, 0).rotation.y = -turn * 1.4;
      part(box(0.11, 0.08, 0.11), body, -0.01, 0.24, 0).rotation.y = turn * 2;
      break;
    }
    case 'ball': {
      part(ico(0.1, 1), body, 0, 0.125, 0);
      const band = part(ring(0.1, 0.014), accent, 0, 0.125, 0);
      band.rotation.x = Math.PI / 2 + turn;
      part(ico(0.03, 0), accent, 0, 0.23, 0);
      break;
    }
    case 'critter': {
      const torso = part(ico(0.095, 1), body, 0, 0.12, 0);
      torso.scale.set(1, 0.95, 0.9);
      part(ico(0.065, 1), body, 0, 0.245, -0.02);
      part(cone(0.03, 0.07, 4), accent, -0.045, 0.32, -0.02);
      part(cone(0.03, 0.07, 4), accent, 0.045, 0.32, -0.02);
      part(cone(0.026, 0.06, 4), accent, 0, 0.235, -0.085).rotation.x = -Math.PI / 2;
      break;
    }
    case 'banner': {
      part(cyl(0.012, 0.012, 0.3, 6), body, 0, 0.17, 0);
      part(box(0.17, 0.11, 0.012), accent, 0.09, 0.27, 0).rotation.y = turn * 0.6;
      part(cone(0.07, 0.07, 6), body, 0, 0.05, 0);
      part(ico(0.02, 0), body, 0, 0.33, 0);
      break;
    }
    default: {
      part(box(0.17, 0.14, 0.17), body, 0, 0.09, 0).rotation.y = turn;
      const ribbonA = part(box(0.036, 0.145, 0.176), accent, 0, 0.09, 0);
      ribbonA.rotation.y = turn;
      const ribbonB = part(box(0.176, 0.145, 0.036), accent, 0, 0.09, 0);
      ribbonB.rotation.y = turn;
      part(box(0.06, 0.03, 0.03), accent, -0.03, 0.18, 0).rotation.z = 0.6;
      part(box(0.06, 0.03, 0.03), accent, 0.03, 0.18, 0).rotation.z = -0.6;
      break;
    }
  }

  return group;
}
