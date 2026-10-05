/* ──────────────────────────────────────────────────────────────────────────
   Lucky Cage — the cabinet.

   An original hand-built boardwalk lottery machine: a lacquered walnut carcass
   on cast feet, an aged-brass drum cage turned by a real crank, twenty painted
   wooden balls with readable numbers, a hinged release gate feeding a brass
   chute, and a five-cradle return rail across the front. Hand-painted enamel
   signwriting on the apron, warm incandescent practicals overhead, night
   boardwalk behind.

   Doctrine (shared with the other midway cabinets): material depth, not glow.
   ACES filmic + sRGB, PCF soft shadows, restrained environment reflections.
   The ONLY emissive surfaces are the practical bulbs.

   This module owns geometry, materials, textures and disposal — and nothing
   else. It never fetches, never settles, never decides an outcome. It is
   driven frame by frame from the pure timeline in _lucky-cage-draw.ts and the
   cosmetic solver in _lucky-cage-tumble.ts.

   Ball meshes live in WORLD space rather than parented to the spinning drum, so
   handing one over to the chute is a change of maths, not a re-parenting: while
   a ball is loose its world position is the drum transform applied to its
   solver position; the instant the timeline claims it, the same mesh is driven
   along its chute curve instead.
   ────────────────────────────────────────────────────────────────────────── */

import * as THREE from 'three';

import {
  applyMidwayTier,
  buildBulbString,
  createMidwayDeferredTextures,
  createMidwayLightRig,
  createMidwayRenderer,
  disposeSceneDeep,
  emitSpriteParticles,
  makeMidwayMaterial,
  midwayBulbCount,
  midwayParticleCount,
  stepMidwayBulbs,
  makePlankTextures,
  makeSignTexture,
  makeSoftDiscTexture,
  makeSparkTexture,
  makeSpriteParticlePool,
  makeWoodTextures,
  paintMidwayBackdrop,
  resetSpriteParticles,
  stepSpriteParticles,
  tintBulb,
  type MidwayDeferredTextures,
  type MidwayLightRig,
  type MidwayQualityController,
  type MidwayTier,
  type SpriteParticle,
} from '@/features/arcade/lib/midway-three';

import { chuteSegments, type CageFrame } from './_lucky-cage-draw';
import { findTumbleBall, type TumbleState } from './_lucky-cage-tumble';
import { rackBandColor, type LuckyCageTheme } from './_lucky-cage-theme';

/* ── cabinet dimensions (metres) ────────────────────────────────────── */

export const BALL_COUNT = 20;
export const BALL_RADIUS = 0.055;
export const DRUM_INTERIOR_RADIUS = 0.48;
export const DRUM_INTERIOR_HALF_LENGTH = 0.31;

const CAB_W = 2.5;
const CAB_H = 1.05;
const CAB_D = 1.0;
const CAB_TOP = CAB_H;

const CAGE_CENTRE = new THREE.Vector3(0, 1.95, -0.02);
const CAGE_RADIUS = 0.5;
const CAGE_HALF_LEN = 0.33;

const GATE_MOUTH = new THREE.Vector3(0, 1.4, 0.3);
const RAIL_Y = 1.185;
const RAIL_Z = 0.44;
export const CRADLE_BALL_Y = RAIL_Y + BALL_RADIUS;
const CRADLE_SPACING = 0.3;
const CRADLE_X0 = -CRADLE_SPACING * 2;

const CAM_FOV = 40;
const CAM_REST = new THREE.Vector3(0, 1.8, 3.62);
const CAM_PUSH = new THREE.Vector3(0, 1.68, 2.74);
const LOOK_REST = new THREE.Vector3(0, 1.46, 0);
const LOOK_PUSH = new THREE.Vector3(0, 1.44, 0.2);

/* ── public handle ──────────────────────────────────────────────────── */

export type CageScene = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** The spinning drum (bars/hoops only — balls are world-space). */
  cageGroup: THREE.Group;
  /** The hinged release flap under the drum. */
  gateFlap: THREE.Group;
  /** The crank arm on the right-hand yoke. */
  crankGroup: THREE.Group;
  /** Ball meshes by face number 1..20. */
  balls: Map<number, THREE.Mesh>;
  /** The five cradle centres, left to right. */
  cradles: THREE.Vector3[];
  /** Per-cradle chute curve, index 0..4. */
  chutes: THREE.CatmullRomCurve3[];
  bulbs: THREE.Mesh[];
  sparks: SpriteParticle[];
  dust: SpriteParticle[];
  /** Theme-driven materials kept around for cosmetic recolour. */
  mats: {
    wood: THREE.MeshStandardMaterial;
    trim: THREE.MeshStandardMaterial;
    brass: THREE.MeshStandardMaterial;
    brassDark: THREE.MeshStandardMaterial;
    gate: THREE.MeshStandardMaterial;
    felt: THREE.MeshStandardMaterial;
    deck: THREE.MeshStandardMaterial;
    bulb: THREE.MeshStandardMaterial[];
  };
  backdropCanvas: HTMLCanvasElement;
  backdropTexture: THREE.CanvasTexture;
  /** The sky the backdrop is painted with; applyCageTheme updates it. */
  backdropSky: { top: string; bottom: string };
  /** The kit's light rig, deferred textures and current quality tier. */
  rig: MidwayLightRig;
  deferred: MidwayDeferredTextures;
  tier: MidwayTier;
  /** Free the renderer and its context listeners. */
  releaseRenderer: () => void;
  /** Aspect-driven camera dolly applied on top of the push. */
  framingPull: number;
  /** How much of the draw's camera push a canvas this shape can take. */
  pushScale: number;
};

/* ── ball face texture ──────────────────────────────────────────────── */

/**
 * A painted wooden lottery ball: cream body, a rack-coloured band around the
 * equator, and the number stencilled three times around it so it stays
 * readable while the ball tumbles.
 */
function makeBallTexture(
  n: number,
  body: string,
  ink: string,
  band: string,
): THREE.CanvasTexture {
  const w = 384;
  const h = 192;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = body;
    ctx.fillRect(0, 0, w, h);

    // Painted band around the equator, with a thin darker keyline each side.
    const bandTop = h * 0.3;
    const bandH = h * 0.4;
    ctx.fillStyle = band;
    ctx.fillRect(0, bandTop, w, bandH);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.fillRect(0, bandTop, w, 2);
    ctx.fillRect(0, bandTop + bandH - 2, w, 2);

    // Cream number roundel + stencilled numeral, three times around.
    for (let i = 0; i < 3; i += 1) {
      const cx = w * (0.1667 + i * 0.3333);
      const cy = h * 0.5;
      const r = h * 0.235;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = body;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.stroke();

      ctx.fillStyle = ink;
      ctx.font = `bold ${Math.round(h * 0.3)}px ui-monospace, "SFMono-Regular", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(n), cx, cy + 1);
    }

    // Age: a couple of faint scuffs so the paint is not showroom-new.
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 6; i += 1) {
      const y = ((i * 37) % h) + 4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y + (i % 2 === 0 ? 5 : -5));
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Small painted cradle plaque: "1".."5" in chute order. */
function makeCradlePlaque(index: number, theme: LuckyCageTheme): THREE.CanvasTexture {
  return makeSignTexture({
    text: String(index + 1),
    width: 96,
    height: 64,
    background: theme.enamel,
    border: theme.brassHi,
    color: theme.enamelInk,
    fontScale: 1.35,
  });
}

/* ── build ──────────────────────────────────────────────────────────── */

export type BuildOptions = {
  canvas: HTMLCanvasElement;
  theme: LuckyCageTheme;
  /** The client's quality controller: the start tier, and sampling pauses. */
  quality: MidwayQualityController;
  /** The context was lost: stop the loop. */
  onPause: () => void;
  /** The context came back: refresh the environment and render. */
  onRestore: () => void;
  /** The context is gone for good: dispose and show the still. */
  onContextLost: () => void;
};

/** Build the whole cabinet. Returns null if WebGL is unavailable. */
export function buildLuckyCageScene(opts: BuildOptions): CageScene | null {
  const { canvas, theme } = opts;

  const handle = createMidwayRenderer({
    canvas,
    tier: opts.quality.tier(),
    onPause: opts.onPause,
    onRestore: opts.onRestore,
    onFallback: opts.onContextLost,
  });
  if (!handle) return null;
  const renderer = handle.renderer;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(theme.skyBottom);
  scene.fog = new THREE.Fog(new THREE.Color(theme.skyBottom).getHex(), 9, 24);

  const camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 80);
  camera.position.copy(CAM_REST);
  camera.lookAt(LOOK_REST);

  /* ── the kit's light rig ── */

  const rig = createMidwayLightRig(renderer, scene, {
    tier: opts.quality.tier(),
    target: [0, 1.4, 0],
    radius: 2.8,
    camera: [CAM_REST.x, CAM_REST.y, CAM_REST.z],
    sky: theme.skyTop,
    ground: theme.deckColor,
  });
  // Two tungsten practicals hanging just over the drum: these are what make
  // the brass read as brass.
  rig.addPractical([-0.85, 2.85, 0.65], { intensity: 2.4, distance: 5.2 });
  rig.addPractical([0.9, 2.8, 0.55], { intensity: 1.9, distance: 5 });

  // Grain, planks, the apron sign and the backdrop paint after the first frame.
  // Ball numbers and cradle plaques carry the result, so they paint up front.
  const deferred = createMidwayDeferredTextures('lucky-cage', { quality: opts.quality });
  const blank = deferred.placeholder();

  /* ── materials ── */

  const woodMat = new THREE.MeshStandardMaterial({
    color: theme.woodMid,
    roughness: 0.55,
    map: blank,
    roughnessMap: blank,
  });
  const woodDarkMat = new THREE.MeshStandardMaterial({
    color: theme.woodLo,
    roughness: 0.7,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: theme.trim,
    roughness: 0.72,
  });
  const brassMat = new THREE.MeshStandardMaterial({
    color: theme.brass,
    roughness: 0.31,
    metalness: 0.82,
  });
  const brassDarkMat = new THREE.MeshStandardMaterial({
    color: theme.brassLo,
    roughness: 0.44,
    metalness: 0.7,
  });
  const gateMat = new THREE.MeshStandardMaterial({
    color: theme.gate,
    roughness: 0.36,
    metalness: 0.74,
  });
  const feltMat = new THREE.MeshStandardMaterial({
    color: theme.felt,
    roughness: 0.94,
  });
  // The trough and the gate collar are open tubes, so both faces are drawn.
  const chuteMat = new THREE.MeshStandardMaterial({
    color: theme.chute,
    roughness: 0.66,
    side: THREE.DoubleSide,
  });
  const collarMat = new THREE.MeshStandardMaterial({
    color: theme.brass,
    roughness: 0.31,
    metalness: 0.82,
    side: THREE.DoubleSide,
  });

  /* ── boardwalk deck ── */

  const deckMat = new THREE.MeshStandardMaterial({
    color: theme.deckColor,
    roughness: 0.86,
    map: blank,
    roughnessMap: blank,
  });
  deferred.add(
    () => ({ wood: makeWoodTextures(2, 1), plank: makePlankTextures(8, 6, 5) }),
    ({ wood, plank }) => {
      woodMat.map = wood.map;
      woodMat.roughnessMap = wood.roughnessMap;
      deckMat.map = plank.map;
      deckMat.roughnessMap = plank.roughnessMap;
    },
  );
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(30, 22), deckMat);
  deck.rotation.x = -Math.PI / 2;
  deck.position.set(0, 0, -2);
  deck.receiveShadow = true;
  scene.add(deck);

  /* ── night boardwalk backdrop ── */

  const backdropCanvas = document.createElement('canvas');
  backdropCanvas.width = 1024;
  backdropCanvas.height = 512;
  const backdropSky = { top: theme.skyTop, bottom: theme.skyBottom };
  const backdropTexture = new THREE.CanvasTexture(backdropCanvas);
  backdropTexture.colorSpace = THREE.SRGBColorSpace;
  const backdropMat = new THREE.MeshBasicMaterial({
    map: deferred.placeholder(theme.skyBottom),
    depthWrite: false,
  });
  deferred.add(
    () => paintMidwayBackdrop(backdropCanvas, backdropSky.top, backdropSky.bottom),
    () => {
      backdropTexture.needsUpdate = true;
      backdropMat.map = backdropTexture;
    },
  );
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(30, 15), backdropMat);
  backdrop.position.set(0, 5.4, -10);
  scene.add(backdrop);

  /* ── cabinet carcass ── */

  const cabinet = new THREE.Group();
  scene.add(cabinet);

  const body = new THREE.Mesh(new THREE.BoxGeometry(CAB_W, CAB_H, CAB_D), woodMat);
  body.position.set(0, CAB_H / 2, 0);
  body.castShadow = true;
  body.receiveShadow = true;
  cabinet.add(body);

  // Chamfered top cap + a painted trim reveal under it.
  const cap = new THREE.Mesh(
    new THREE.BoxGeometry(CAB_W + 0.08, 0.06, CAB_D + 0.08),
    woodDarkMat,
  );
  cap.position.set(0, CAB_TOP + 0.03, 0);
  cap.castShadow = true;
  cap.receiveShadow = true;
  cabinet.add(cap);

  const reveal = new THREE.Mesh(
    new THREE.BoxGeometry(CAB_W + 0.02, 0.035, CAB_D + 0.02),
    trimMat,
  );
  reveal.position.set(0, CAB_TOP - 0.03, 0);
  cabinet.add(reveal);

  // Green baize playing surface inset into the top.
  const baize = new THREE.Mesh(
    new THREE.BoxGeometry(CAB_W - 0.22, 0.014, CAB_D - 0.22),
    feltMat,
  );
  baize.position.set(0, CAB_TOP + 0.068, -0.02);
  baize.receiveShadow = true;
  cabinet.add(baize);

  // Cast feet.
  const footGeo = new THREE.CylinderGeometry(0.07, 0.09, 0.1, 10);
  for (const fx of [-CAB_W / 2 + 0.16, CAB_W / 2 - 0.16]) {
    for (const fz of [-CAB_D / 2 + 0.16, CAB_D / 2 - 0.16]) {
      const foot = new THREE.Mesh(footGeo, brassDarkMat);
      foot.position.set(fx, 0.05, fz);
      foot.castShadow = true;
      cabinet.add(foot);
    }
  }

  // Contact shadow so the cabinet is planted on the deck.
  const discTex = makeSoftDiscTexture(160);
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(CAB_W * 1.5, CAB_D * 2.1),
    new THREE.MeshBasicMaterial({
      map: discTex,
      color: 0x000000,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.set(0, 0.012, 0.02);
  scene.add(contact);

  /* ── hand-painted apron signwriting ── */

  const signMat = new THREE.MeshStandardMaterial({
    map: deferred.placeholder(theme.enamel),
    roughness: 0.52,
  });
  deferred.add(
    () =>
      makeSignTexture({
        text: 'lucky cage',
        sub: '20 balls, 5 drawn',
        width: 768,
        height: 192,
        background: theme.enamel,
        border: theme.brassHi,
        color: theme.enamelInk,
      }),
    (tex) => {
      signMat.map = tex;
    },
  );
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.86, 0.465), signMat);
  sign.position.set(0, 0.6, CAB_D / 2 + 0.006);
  cabinet.add(sign);

  // Brass sign frame.
  const frameGeo = new THREE.BoxGeometry(1.94, 0.022, 0.02);
  for (const fy of [0.6 + 0.245, 0.6 - 0.245]) {
    const bar = new THREE.Mesh(frameGeo, brassMat);
    bar.position.set(0, fy, CAB_D / 2 + 0.012);
    cabinet.add(bar);
  }
  const frameSideGeo = new THREE.BoxGeometry(0.022, 0.51, 0.02);
  for (const fx of [-0.96, 0.96]) {
    const bar = new THREE.Mesh(frameSideGeo, brassMat);
    bar.position.set(fx, 0.6, CAB_D / 2 + 0.012);
    cabinet.add(bar);
  }

  /* ── yokes + axle ── */

  const yokeGeo = new THREE.BoxGeometry(0.085, 0.92, 0.085);
  for (const yx of [-0.66, 0.66]) {
    const yoke = new THREE.Mesh(yokeGeo, brassMat);
    yoke.position.set(yx, CAB_TOP + 0.46, CAGE_CENTRE.z);
    yoke.castShadow = true;
    cabinet.add(yoke);
    // Cast base plate.
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.13, 0.05, 12),
      brassDarkMat,
    );
    plate.position.set(yx, CAB_TOP + 0.09, CAGE_CENTRE.z);
    cabinet.add(plate);
  }

  const axle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.028, 0.028, 1.62, 12),
    brassDarkMat,
  );
  axle.rotation.z = Math.PI / 2;
  axle.position.copy(CAGE_CENTRE);
  scene.add(axle);

  /* ── the drum ── */

  const cageGroup = new THREE.Group();
  cageGroup.position.copy(CAGE_CENTRE);
  scene.add(cageGroup);

  // End rings.
  const ringGeo = new THREE.TorusGeometry(CAGE_RADIUS, 0.022, 8, 44);
  for (const rx of [-CAGE_HALF_LEN, CAGE_HALF_LEN]) {
    const ring = new THREE.Mesh(ringGeo, brassMat);
    ring.rotation.y = Math.PI / 2;
    ring.position.x = rx;
    ring.castShadow = true;
    cageGroup.add(ring);
  }
  // Intermediate hoops, thinner.
  const hoopGeo = new THREE.TorusGeometry(CAGE_RADIUS, 0.012, 6, 36);
  for (const rx of [-CAGE_HALF_LEN / 2, 0, CAGE_HALF_LEN / 2]) {
    const hoop = new THREE.Mesh(hoopGeo, brassMat);
    hoop.rotation.y = Math.PI / 2;
    hoop.position.x = rx;
    cageGroup.add(hoop);
  }
  // Longitudinal bars.
  const barGeo = new THREE.CylinderGeometry(0.0125, 0.0125, CAGE_HALF_LEN * 2, 6);
  const BAR_COUNT = 18;
  for (let i = 0; i < BAR_COUNT; i += 1) {
    const a = (i / BAR_COUNT) * Math.PI * 2;
    const bar = new THREE.Mesh(barGeo, brassMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, Math.cos(a) * CAGE_RADIUS, Math.sin(a) * CAGE_RADIUS);
    cageGroup.add(bar);
  }
  // Hub discs so the drum reads closed at the ends.
  const hubGeo = new THREE.CylinderGeometry(0.085, 0.085, 0.03, 14);
  for (const rx of [-CAGE_HALF_LEN - 0.02, CAGE_HALF_LEN + 0.02]) {
    const hub = new THREE.Mesh(hubGeo, brassDarkMat);
    hub.rotation.z = Math.PI / 2;
    hub.position.x = rx;
    cageGroup.add(hub);
    // Six spokes per hub.
    for (let s = 0; s < 6; s += 1) {
      const a = (s / 6) * Math.PI * 2;
      const spoke = new THREE.Mesh(
        new THREE.CylinderGeometry(0.008, 0.008, CAGE_RADIUS, 5),
        brassMat,
      );
      spoke.position.set(
        rx,
        (Math.cos(a) * CAGE_RADIUS) / 2,
        (Math.sin(a) * CAGE_RADIUS) / 2,
      );
      spoke.rotation.x = a;
      cageGroup.add(spoke);
    }
  }

  /* ── crank ── */

  const crankGroup = new THREE.Group();
  crankGroup.position.set(0.86, CAGE_CENTRE.y, CAGE_CENTRE.z);
  scene.add(crankGroup);
  const crankArm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.34, 0.04), brassMat);
  crankArm.position.set(0, 0.15, 0);
  crankArm.castShadow = true;
  crankGroup.add(crankArm);
  const crankElbow = new THREE.Mesh(
    new THREE.CylinderGeometry(0.026, 0.026, 0.16, 10),
    brassMat,
  );
  crankElbow.rotation.z = Math.PI / 2;
  crankElbow.position.set(0.08, 0.3, 0);
  crankGroup.add(crankElbow);
  const crankKnob = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.055, 0.13, 12),
    woodMat,
  );
  crankKnob.rotation.z = Math.PI / 2;
  crankKnob.position.set(0.19, 0.3, 0);
  crankKnob.castShadow = true;
  crankGroup.add(crankKnob);

  /* ── release gate + chute + return rail ── */

  // Brass collar the balls fall through.
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.115, 0.09, 14, 1, true),
    collarMat,
  );
  collar.position.set(GATE_MOUTH.x, GATE_MOUTH.y + 0.06, GATE_MOUTH.z);
  scene.add(collar);

  const gateFlap = new THREE.Group();
  gateFlap.position.set(GATE_MOUTH.x, GATE_MOUTH.y + 0.01, GATE_MOUTH.z - 0.1);
  scene.add(gateFlap);
  const flap = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.014, 0.2), gateMat);
  flap.position.set(0, 0, 0.1);
  flap.castShadow = true;
  gateFlap.add(flap);
  const hinge = new THREE.Mesh(
    new THREE.CylinderGeometry(0.014, 0.014, 0.3, 8),
    brassDarkMat,
  );
  hinge.rotation.z = Math.PI / 2;
  gateFlap.add(hinge);

  // Chute: a short brass trough from the gate down to the distributor rail.
  const chuteCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(GATE_MOUTH.x, GATE_MOUTH.y - 0.02, GATE_MOUTH.z),
    new THREE.Vector3(0, GATE_MOUTH.y - 0.09, GATE_MOUTH.z + 0.09),
    new THREE.Vector3(0, RAIL_Y + 0.075, RAIL_Z + 0.055),
  ]);
  const chuteTube = new THREE.Mesh(
    new THREE.TubeGeometry(chuteCurve, 20, 0.085, 10, false),
    chuteMat,
  );
  chuteTube.receiveShadow = true;
  scene.add(chuteTube);
  const chuteLip = new THREE.Mesh(
    new THREE.TorusGeometry(0.088, 0.011, 6, 20),
    brassMat,
  );
  chuteLip.rotation.x = Math.PI / 2;
  chuteLip.position.set(0, RAIL_Y + 0.075, RAIL_Z + 0.055);
  scene.add(chuteLip);

  // Distributor rail: two brass runners across the front of the cabinet.
  const railGeo = new THREE.CylinderGeometry(0.014, 0.014, 1.72, 8);
  for (const rz of [RAIL_Z - 0.055, RAIL_Z + 0.055]) {
    const runner = new THREE.Mesh(railGeo, brassMat);
    runner.rotation.z = Math.PI / 2;
    runner.position.set(0, RAIL_Y + 0.02, rz);
    runner.castShadow = true;
    scene.add(runner);
  }
  // Walnut rail plinth under the runners.
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(1.82, 0.07, 0.2),
    woodDarkMat,
  );
  plinth.position.set(0, RAIL_Y - 0.045, RAIL_Z);
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  scene.add(plinth);

  // Five cradles + numbered plaques.
  const cradles: THREE.Vector3[] = [];
  const chutes: THREE.CatmullRomCurve3[] = [];
  const cradleGeo = new THREE.TorusGeometry(0.062, 0.0105, 6, 22);
  for (let i = 0; i < 5; i += 1) {
    const cx = CRADLE_X0 + i * CRADLE_SPACING;
    const centre = new THREE.Vector3(cx, CRADLE_BALL_Y, RAIL_Z);
    cradles.push(centre);

    const cradle = new THREE.Mesh(cradleGeo, brassMat);
    cradle.rotation.x = Math.PI / 2;
    cradle.position.set(cx, RAIL_Y + 0.012, RAIL_Z);
    cradle.castShadow = true;
    scene.add(cradle);

    // Painted now, never deferred: the player reads which cradle is which.
    const plaque = new THREE.Mesh(
      new THREE.PlaneGeometry(0.1, 0.067),
      new THREE.MeshStandardMaterial({ map: makeCradlePlaque(i, theme), roughness: 0.55 }),
    );
    plaque.position.set(cx, RAIL_Y - 0.045, RAIL_Z + 0.101);
    scene.add(plaque);

    // The run each ball takes: out of the mouth, along the trough, into the
    // cradle. Pure presentation — which ball takes which run is already decided.
    chutes.push(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(GATE_MOUTH.x, GATE_MOUTH.y, GATE_MOUTH.z),
        new THREE.Vector3(0, GATE_MOUTH.y - 0.11, GATE_MOUTH.z + 0.08),
        new THREE.Vector3(cx * 0.45, RAIL_Y + 0.12, RAIL_Z + 0.05),
        new THREE.Vector3(cx * 0.92, RAIL_Y + 0.075, RAIL_Z + 0.015),
        new THREE.Vector3(cx, CRADLE_BALL_Y, RAIL_Z),
      ]),
    );
  }

  /* ── the twenty balls ── */

  const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 22, 16);
  const balls = new Map<number, THREE.Mesh>();
  for (let n = 1; n <= BALL_COUNT; n += 1) {
    // Painted now, never deferred: the numbers are the result.
    const tex = makeBallTexture(n, theme.ballBody, theme.ballInk, rackBandColor(theme, n));
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.44,
      metalness: 0.02,
    });
    const mesh = new THREE.Mesh(ballGeo, mat);
    mesh.castShadow = true;
    mesh.position.copy(CAGE_CENTRE);
    scene.add(mesh);
    balls.set(n, mesh);
  }

  /* ── overhead practicals + pennants ── */

  const bulbMats = [theme.bulbWarm, theme.bulbAmber, theme.bulbRose].map((hex) => {
    const m = new THREE.MeshStandardMaterial();
    tintBulb(m, hex);
    return m;
  });
  const socketMat = new THREE.MeshStandardMaterial({
    color: theme.brassLo,
    roughness: 0.4,
    metalness: 0.7,
  });
  const wireMat = makeMidwayMaterial('wire');
  const string = buildBulbString({
    xStart: -3.1,
    xEnd: 3.1,
    yTop: 3.32,
    sag: 0.34,
    z: 0.55,
    count: midwayBulbCount(13, opts.quality.tier()),
    bulbMats,
    socketMat,
    wireMat,
  });
  scene.add(string.group);

  // Cream/oxblood pennants on a second wire, further back.
  const pennantWire = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 5.4, 5),
    wireMat,
  );
  pennantWire.rotation.z = Math.PI / 2;
  pennantWire.position.set(0, 3.02, -0.5);
  scene.add(pennantWire);
  const pennantMats = [theme.pennantA, theme.pennantB].map(
    (hex) =>
      new THREE.MeshStandardMaterial({
        color: hex,
        roughness: 0.86,
        side: THREE.DoubleSide,
      }),
  );
  for (let i = 0; i < 15; i += 1) {
    const px = -2.6 + (i / 14) * 5.2;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [-0.09, 0, 0, 0.09, 0, 0, 0, -0.19, 0.02],
        3,
      ),
    );
    geo.computeVertexNormals();
    const pennant = new THREE.Mesh(geo, pennantMats[i % 2]!);
    pennant.position.set(px, 3.0, -0.5);
    pennant.rotation.y = (i % 2 === 0 ? 1 : -1) * 0.18;
    scene.add(pennant);
  }

  /* ── particle pools ── */

  const sparkTex = makeSparkTexture(64);
  const sparks = makeSpriteParticlePool({
    scene,
    count: 26,
    texture: sparkTex,
    colors: [theme.brassHi, theme.bulbWarm, theme.enamelInk],
    size: 0.055,
    blending: THREE.AdditiveBlending,
  });
  const dust = makeSpriteParticlePool({
    scene,
    count: 22,
    texture: discTex,
    colors: ['#c9b48c', '#9b8460', '#e3cfa4'],
    size: 0.09,
  });

  return {
    renderer,
    scene,
    camera,
    cageGroup,
    gateFlap,
    crankGroup,
    balls,
    cradles,
    chutes,
    bulbs: string.bulbs,
    sparks,
    dust,
    mats: {
      wood: woodMat,
      trim: trimMat,
      brass: brassMat,
      brassDark: brassDarkMat,
      gate: gateMat,
      felt: feltMat,
      deck: deckMat,
      bulb: bulbMats,
    },
    backdropCanvas,
    backdropTexture,
    backdropSky,
    rig,
    deferred,
    tier: opts.quality.tier(),
    releaseRenderer: handle.dispose,
    framingPull: 0,
    pushScale: 1,
  };
}

/* ── per-frame drive ────────────────────────────────────────────────── */

const _v = new THREE.Vector3();
const _look = new THREE.Vector3();
const _curvePoint = new THREE.Vector3();

/** Rotate a cage-local point into world space for the current drum angle. */
function cageLocalToWorld(
  angle: number,
  x: number,
  y: number,
  z: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  out.set(
    CAGE_CENTRE.x + x,
    CAGE_CENTRE.y + (y * c - z * s),
    CAGE_CENTRE.z + (y * s + z * c),
  );
  return out;
}

export type FrameInputs = {
  frame: CageFrame;
  tumble: TumbleState;
  /** The five committed balls in chute order, or null while idle. */
  draw: readonly number[] | null;
  /** Real seconds since the previous frame (already clamped by the caller). */
  dt: number;
  /** Idle bob so a resting cabinet is not a still image. */
  idleTime: number;
};

/**
 * Push one frame of state onto the scene graph. Purely a projection of the
 * timeline + solver onto meshes — the caller owns sound, haptics and state.
 */
export function applyCageFrame(cage: CageScene, input: FrameInputs): void {
  const { frame, tumble, draw, dt } = input;

  cage.cageGroup.rotation.x = frame.angle;
  cage.crankGroup.rotation.x = frame.crank;
  // The flap swings down and forward off its hinge.
  cage.gateFlap.rotation.x = frame.gateOpen * 1.15;

  // Camera: rest -> push, plus the aspect-driven pull for narrow viewports.
  const push = frame.cameraPush * cage.pushScale;
  _v.lerpVectors(CAM_REST, CAM_PUSH, push);
  _v.z += cage.framingPull;
  _v.y += cage.framingPull * 0.12;
  // A very small idle bob keeps the cabinet feeling lit rather than frozen.
  _v.y += Math.sin(input.idleTime * 0.6) * 0.006;
  cage.camera.position.copy(_v);
  _look.lerpVectors(LOOK_REST, LOOK_PUSH, push);
  cage.camera.lookAt(_look);

  // Loose balls follow the solver, in drum-local space rotated into the world.
  for (const ball of tumble.balls) {
    if (ball.released) continue;
    const mesh = cage.balls.get(ball.n);
    if (!mesh) continue;
    cageLocalToWorld(frame.angle, ball.x, ball.y, ball.z, _v);
    mesh.position.copy(_v);
    mesh.rotation.set(ball.rx, ball.ry, ball.rz);
    mesh.visible = true;
  }

  // Committed balls follow the timeline.
  if (draw) {
    for (let i = 0; i < draw.length && i < cage.chutes.length; i += 1) {
      const n = draw[i]!;
      const mesh = cage.balls.get(n);
      const solverBall = findTumbleBall(tumble, n);
      const p = frame.progress[i] ?? -1;
      if (!mesh) continue;

      if (p < 0) {
        if (solverBall) solverBall.released = false;
        continue;
      }

      // From here the timeline owns this ball; the solver skips it.
      if (solverBall) solverBall.released = true;

      const seg = chuteSegments(p);
      const curve = cage.chutes[i]!;

      if (seg.run <= 0) {
        // Pluck: lift out of the pile toward the gate mouth. Starting from the
        // ball's last solver position keeps the hand-off seamless.
        if (solverBall) {
          cageLocalToWorld(frame.angle, solverBall.x, solverBall.y, solverBall.z, _v);
        } else {
          _v.copy(CAGE_CENTRE);
        }
        curve.getPoint(0, _curvePoint);
        mesh.position.lerpVectors(_v, _curvePoint, seg.pluck);
        // The selected ball turns on the spot so its number is legible before
        // it ever reaches the chute — this is the readability beat.
        mesh.rotation.y += dt * 5.5;
        mesh.rotation.x += dt * 1.4;
      } else if (seg.seat <= 0) {
        curve.getPoint(seg.run, _curvePoint);
        mesh.position.copy(_curvePoint);
        mesh.rotation.x -= dt * 9;
        mesh.rotation.y += dt * 2.2;
      } else {
        const target = cage.cradles[i]!;
        curve.getPoint(1, _curvePoint);
        mesh.position.lerpVectors(_curvePoint, target, seg.seat);
        // A small bounce as it drops into the wire cradle.
        mesh.position.y += Math.sin(seg.seat * Math.PI) * 0.03;
        mesh.rotation.x -= dt * 9 * (1 - seg.seat);
        if (p >= 1) mesh.position.copy(target);
      }

      mesh.visible = true;
    }
  }

  // Particles.
  stepSpriteParticles(cage.sparks, dt, 3.2, 1.1);
  stepSpriteParticles(cage.dust, dt, 0.5, 0.9);

  // Practicals flicker a touch while the drum is turning: tungsten under
  // load. The kit holds them steady under reduced motion.
  if (cage.bulbs.length > 0) {
    stepMidwayBulbs(cage.bulbs, input.idleTime, {
      mode: 'flicker',
      load: Math.min(1, frame.spin / 9),
    });
  }
}

/** Kick a small warm burst where a ball just seated. */
export function emitSeatBurst(cage: CageScene, index: number): void {
  const c = cage.cradles[index];
  if (!c) return;
  emitSpriteParticles(cage.sparks, midwayParticleCount(5, cage.tier), {
    origin: [c.x, c.y + 0.03, c.z],
    spread: 0.05,
    speed: [0.18, 0.5],
    up: [0.25, 0.7],
    ttl: [0.24, 0.44],
    size: [0.5, 1.05],
    grow: 0.4,
    fade: 0.75,
  });
}

/** Dust knocked off the drum as it spins up. */
export function emitCageDust(cage: CageScene): void {
  emitSpriteParticles(cage.dust, midwayParticleCount(3, cage.tier), {
    ambient: true,
    origin: [CAGE_CENTRE.x, CAGE_CENTRE.y - CAGE_RADIUS * 0.6, CAGE_CENTRE.z + 0.2],
    spread: 0.5,
    speed: [0.1, 0.32],
    up: [-0.15, 0.16],
    ttl: [0.7, 1.5],
    size: [0.5, 1.3],
    grow: 0.9,
    fade: 0.16,
  });
}

/** Park everything: used on reset, reduced-motion swap, and context loss. */
export function resetCageVisuals(cage: CageScene): void {
  resetSpriteParticles(cage.sparks);
  resetSpriteParticles(cage.dust);
  cage.cageGroup.rotation.x = 0;
  cage.crankGroup.rotation.x = 0;
  cage.gateFlap.rotation.x = 0;
  cage.camera.position.copy(CAM_REST);
  cage.camera.position.z += cage.framingPull;
  cage.camera.lookAt(LOOK_REST);
}

/* ── resize + dispose ───────────────────────────────────────────────── */

export function resizeCageScene(cage: CageScene, w: number, h: number): void {
  const width = Math.max(1, Math.floor(w));
  const height = Math.max(1, Math.floor(h));
  cage.renderer.setSize(width, height, false);
  const aspect = width / height;
  cage.camera.aspect = aspect;
  // Portrait / narrow viewports pull the camera back so the full cabinet —
  // cage, chute AND all five cradles — stays in frame at 360x640.
  cage.framingPull = aspect < 1.35 ? (1.35 - aspect) * 2.35 : 0;
  // The push-in was framed for a wide, short stage. A squarer one would lose
  // the top of the drum, so it pushes less there.
  cage.pushScale = Math.min(1, Math.max(0.3, (aspect - 1.2) / 1.1));
  cage.camera.updateProjectionMatrix();
}

/**
 * Release everything. Safe to call after a lost context, where individual
 * GPU-side disposals can throw — the CPU-side graph still needs dropping so
 * geometries and canvases can be collected.
 */
export function disposeCageScene(cage: CageScene | null): void {
  if (!cage) return;
  cage.deferred.dispose();
  try {
    cage.rig.dispose();
  } catch {
    /* the context may already be gone */
  }
  try {
    // disposeSceneDeep walks every material's texture slots, so the backdrop,
    // ball faces, plaques, wood/plank maps and particle sheets all go with it.
    disposeSceneDeep(cage.scene);
  } catch {
    /* ditto */
  }
  cage.balls.clear();
  cage.cradles.length = 0;
  cage.chutes.length = 0;
  cage.bulbs.length = 0;
  cage.sparks.length = 0;
  cage.dust.length = 0;
  try {
    cage.releaseRenderer();
  } catch {
    /* ditto */
  }
}

/** Move the cabinet to a new quality tier (the client's controller decides). */
export function applyCageTier(cage: CageScene, tier: MidwayTier): void {
  cage.tier = tier;
  applyMidwayTier(cage.renderer, cage.rig, tier, { scene: cage.scene, camera: cage.camera });
}

/** Repaint the cabinet for a new equipped loadout without rebuilding it. */
export function applyCageTheme(cage: CageScene, theme: LuckyCageTheme): void {
  cage.mats.wood.color.set(theme.woodMid);
  cage.mats.trim.color.set(theme.trim);
  cage.mats.brass.color.set(theme.brass);
  cage.mats.brassDark.color.set(theme.brassLo);
  cage.mats.gate.color.set(theme.gate);
  cage.mats.felt.color.set(theme.felt);
  cage.mats.deck.color.set(theme.deckColor);
  const bulbColors = [theme.bulbWarm, theme.bulbAmber, theme.bulbRose];
  for (let i = 0; i < cage.mats.bulb.length; i += 1) {
    tintBulb(cage.mats.bulb[i]!, bulbColors[i % bulbColors.length]!);
  }
  cage.rig.hemi.color.set(theme.skyTop);
  cage.rig.hemi.groundColor.set(theme.deckColor);
  cage.scene.background = new THREE.Color(theme.skyBottom);
  cage.backdropSky.top = theme.skyTop;
  cage.backdropSky.bottom = theme.skyBottom;
  paintMidwayBackdrop(cage.backdropCanvas, theme.skyTop, theme.skyBottom);
  cage.backdropTexture.needsUpdate = true;
}
