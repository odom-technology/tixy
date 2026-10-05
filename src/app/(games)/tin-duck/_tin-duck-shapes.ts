/* The tin targets a skin set can swap in for the duck (SKINS.md): a rabbit, a
   fish and a star, each drawn as flat extruded parts in the duck's own
   format, so they take the same four colours and the same flip.

   The shapes fit inside the circle the duck's hit box is measured on: about
   0.6 round the point 0.3 up from the hinge, facing +x, standing on the same
   block. Nothing here changes the hit box (the server's GALLERY_DUCK_RADIUS),
   the flip, the ring plates or the schedule. */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/* The four colour parts, as the duck uses them: 0 the body, 1 the accent (bill,
   fin, ear lining), 2 a second tone, 3 the eye. */
type Part = 0 | 1 | 2 | 3;
type PartSpec = { shapes: THREE.Shape[]; part: Part; depth: number; z: number };

const ellipse = (x: number, y: number, rx: number, ry: number, rotation = 0) => {
  const shape = new THREE.Shape();
  shape.absellipse(x, y, rx, ry, 0, Math.PI * 2, false, rotation);
  return shape;
};

const polygon = (points: ReadonlyArray<readonly [number, number]>) => {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  return shape;
};

const star = (cx: number, cy: number, outer: number, inner: number) =>
  polygon(
    Array.from({ length: 10 }, (_, i) => {
      const r = i % 2 === 0 ? outer : inner;
      const a = Math.PI / 2 + (i * Math.PI) / 5;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as const;
    }),
  );

function assemble(parts: PartSpec[]): THREE.BufferGeometry {
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
  return geo;
}

/* The body sits at the duck's depth (-0.04 to 0.04), the accent just behind
   its face, the tone and the eye on the face. */
const BODY = { depth: 0.08, z: -0.04 };
const ACCENT = { depth: 0.06, z: -0.03 };
const FACE = { depth: 0.014, z: 0.04 };

function rabbit(): PartSpec[] {
  return [
    {
      // Haunch, chest, head and the two long ears: one silhouette.
      shapes: [
        ellipse(-0.1, 0.27, 0.36, 0.25),
        ellipse(0.27, 0.46, 0.17, 0.15),
        ellipse(0.2, 0.74, 0.05, 0.15, 0.1),
        ellipse(0.32, 0.72, 0.045, 0.14, -0.35),
      ],
      part: 0,
      ...BODY,
    },
    // Tail.
    { shapes: [ellipse(-0.45, 0.3, 0.085, 0.085)], part: 2, ...ACCENT },
    // The ear linings and the nose.
    { shapes: [ellipse(0.2, 0.74, 0.022, 0.1, 0.1), ellipse(0.43, 0.45, 0.028, 0.028)], part: 1, ...FACE },
    // The haunch.
    { shapes: [ellipse(-0.12, 0.2, 0.2, 0.15)], part: 2, ...FACE },
    { shapes: [ellipse(0.34, 0.5, 0.03, 0.03)], part: 3, ...FACE },
  ];
}

function fish(): PartSpec[] {
  return [
    {
      // The body and the forked tail.
      shapes: [
        ellipse(0.02, 0.34, 0.4, 0.26),
        polygon([
          [-0.3, 0.34],
          [-0.58, 0.58],
          [-0.47, 0.34],
          [-0.58, 0.1],
        ]),
      ],
      part: 0,
      ...BODY,
    },
    // The dorsal and the belly fins.
    {
      shapes: [
        polygon([
          [-0.12, 0.53],
          [0.14, 0.55],
          [-0.02, 0.76],
        ]),
        polygon([
          [-0.06, 0.15],
          [0.12, 0.15],
          [0.0, 0.02],
        ]),
      ],
      part: 1,
      ...ACCENT,
    },
    // The belly and the gill.
    { shapes: [ellipse(0.0, 0.26, 0.28, 0.08), ellipse(0.2, 0.36, 0.035, 0.17)], part: 2, ...FACE },
    { shapes: [ellipse(0.28, 0.42, 0.04, 0.04)], part: 3, ...FACE },
  ];
}

function starTarget(): PartSpec[] {
  return [
    { shapes: [star(0, 0.33, 0.42, 0.18)], part: 0, ...BODY },
    // A smaller star stamped on its face, and a boss in the middle.
    { shapes: [star(0, 0.33, 0.22, 0.095)], part: 2, ...FACE },
    { shapes: [ellipse(0, 0.33, 0.045, 0.045)], part: 3, ...FACE },
  ];
}

/** The target for a skin shape, painted by the caller (`part` and `color`
 *  attributes, as the duck's). Not for 'duck', which is the house shape. */
export function makeSkinTargetGeometry(shape: 'rabbit' | 'fish' | 'star'): THREE.BufferGeometry {
  if (shape === 'rabbit') return assemble(rabbit());
  if (shape === 'fish') return assemble(fish());
  return assemble(starTarget());
}
