/* ──────────────────────────────────────────────────────────────────────────
   PRIZE CLAW — the cabinet.

   A hand-built boardwalk claw machine: a lacquered walnut carcass on cast feet,
   painted enamel side panels with a gold pinstripe, a four-pane glass case in a
   brass extrusion frame, a brass gantry carrying a trolley and a three-finger
   claw, a green baize prize bed with stitched grip crosses, and a brass-lipped
   chute feeding a sprung prize door at the player's hand.

   Doctrine, shared with the other midway cabinets: material depth, not glow.
   ACES filmic + sRGB, PCF soft shadows, restrained environment reflections. The
   ONLY emissive surfaces are the incandescent practical bulbs.

   This module owns geometry, materials, textures and disposal — nothing else.
   It never fetches, never settles, never decides an outcome. It is driven frame
   by frame from the pure timeline in _prize-claw-drop.ts, over a result the
   server banked before the first frame rendered.

   Coordinate convention matches Skee-Ball: the camera sits at -z looking +z, so
   SCREEN-RIGHT IS WORLD -X. Aim input is negated once, at the input edge in the
   client, and never again.

   The prize bed is built from the bed data on the client only (populatePrizeBed
   runs inside an effect), so none of the trigonometry here can produce an
   SSR/CSR hydration mismatch.
   ────────────────────────────────────────────────────────────────────────── */

import * as THREE from 'three';

import {
  CLAW_BED_X,
  CLAW_BED_Z0,
  CLAW_BED_Z1,
  CLAW_CHUTE,
  CLAW_HOME,
  CLAW_R_GRIP,
  CLAW_TIER_RANK,
  CLAW_TIERS,
  CLAW_TIER_IDS,
  type ClawTierId,
  type PrizeBed,
  type PrizeSlot,
} from '@/features/arcade/lib/prize-claw-bed';
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
  makeFeltTexture,
  makeGlassMaterial,
  makePlankTextures,
  makeSignTexture,
  makeSoftDiscTexture,
  midwayCanvasFont,
  makeSpriteParticlePool,
  makeStripeTexture,
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

import type {
  ClawForm,
  ClawShelfPrize,
} from '@/features/arcade/lib/prize-claw-shelf';

import type { ClawFrame } from './_prize-claw-drop';
import {
  CLAW_FORM_TOP,
  buildPrizeForm,
  disposeClawFormGeometry,
} from './_prize-claw-forms';
import {
  CLAW_HEAD_SWAY,
  CLAW_PRIZE_SWING,
  kickSwing,
  makePileSpring,
  pileAtRest,
  makeSwing,
  resetPileSpring,
  resetSwing,
  shovePile,
  stepPileSpring,
  stepSwing,
  swingAtRest,
  type PileSpring,
  type Swing,
} from './_prize-claw-sway';
import type { PrizeClawTheme } from './_prize-claw-theme';

/* ── cabinet dimensions (world units) ─────────────────────────────────── */

const CASE_X = 1.3; // interior half-width
const CASE_Z0 = 0.05; // interior front
const CASE_Z1 = 2.7; // interior back
const CASE_TOP = 2.15;
const BASE_Y = -0.9; // top of the boardwalk deck
const RAIL_Y = 1.78; // the brass gantry
const HEAD_REST_Y = 1.62;

const CAM_FOV = 48;
const CAM_REST = new THREE.Vector3(0, 2.55, -3.35);
const CAM_PUSH = new THREE.Vector3(0, 2.15, -2.55);
const CAM_LOOK = new THREE.Vector3(0, 0.85, 1.35);

/** Finger joint angles, open → closed (radians). */
const FINGER_UPPER = [-0.55, 0.42] as const;
const FINGER_LOWER = [0.3, 0.62] as const;

/** A prize's size by tier: the dearest are a little bigger. */
export function clawPrizeScale(tier: ClawTierId): number {
  return 1.28 + CLAW_TIER_RANK[tier] * 0.05;
}

/** Where the fingers meet a prize: the model's top, at the tier's scale. */
export function clawPrizeTop(form: ClawForm, tier: ClawTierId): number {
  return CLAW_FORM_TOP[form] * clawPrizeScale(tier);
}

/** Head pivot: where the cable leaves the trolley. */
const PIVOT_Y = RAIL_Y - 0.1;

/* ── public handle ────────────────────────────────────────────────────── */

export type ClawPrizeMesh = {
  slot: PrizeSlot;
  form: ClawForm;
  /** The counter item's name, when the case is stocked from the counter. */
  label: string | null;
  /** Root group, positioned at the slot's centroid. */
  group: THREE.Group;
  /** Body group — toppled/lifted independently of the root. */
  body: THREE.Group;
  /** The stitched grip cross decal on the top face. */
  cross: THREE.Mesh;
  crossMat: THREE.MeshBasicMaterial;
  topY: number;
  /** Resting lean from its neighbours, and the spring that shoves it. */
  lean: { x: number; z: number };
  pile: PileSpring;
  /** Seconds since this prize was poured in; negative while it waits its turn. */
  pour: number;
  /** Phase beats already answered by the pile, so each fires once. */
  shoved: { close: boolean; lift: boolean; land: boolean };
};

export type ClawScene = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Where the camera looks; it drops a little when the canvas zooms in. */
  camLook: THREE.Vector3;
  /** Carries the X-rail; slides in z. */
  gantry: THREE.Group;
  /** Rides the X-rail; slides in x. */
  trolley: THREE.Group;
  /** Hangs from the cable; slides in y. */
  head: THREE.Group;
  cable: THREE.Mesh;
  /** Where the cable leaves the trolley; the head hangs and sways from here. */
  pivot: THREE.Group;
  /** The head's sway, and the carried prize's swing in the grip. */
  sway: Swing;
  prizeSwing: Swing;
  motion: {
    lastX: number;
    lastZ: number;
    velX: number;
    velZ: number;
    ready: boolean;
    carried: number;
    kicked: boolean;
  };
  plates: Record<ClawTierId, THREE.CanvasTexture>;
  fingers: Array<{ upper: THREE.Group; lower: THREE.Group }>;
  /** The sprung prize door on the front fascia. */
  door: THREE.Group;
  prizes: ClawPrizeMesh[];
  prizeRoot: THREE.Group;
  dust: SpriteParticle[];
  fibres: SpriteParticle[];
  bulbs: THREE.Mesh[];
  namePlate: {
    canvas: HTMLCanvasElement;
    texture: THREE.CanvasTexture;
    lastText: string;
  };
  /** True while any spring is still moving, so the loop keeps drawing. */
  restless: boolean;
  mats: {
    wood: THREE.MeshStandardMaterial;
    woodDark: THREE.MeshStandardMaterial;
    enamel: THREE.MeshStandardMaterial;
    brass: THREE.MeshStandardMaterial;
    brassDark: THREE.MeshStandardMaterial;
    rubber: THREE.MeshStandardMaterial;
    felt: THREE.MeshStandardMaterial;
    deck: THREE.MeshStandardMaterial;
    bulb: THREE.MeshStandardMaterial[];
    prize: Record<ClawTierId, THREE.MeshStandardMaterial>;
    prizeAccent: Record<ClawTierId, THREE.MeshStandardMaterial>;
  };
  backdropCanvas: HTMLCanvasElement;
  backdropTexture: THREE.CanvasTexture;
  /** The kit's light rig, deferred textures and current quality tier. */
  rig: MidwayLightRig;
  deferred: MidwayDeferredTextures;
  tier: MidwayTier;
  /** Free the renderer and its context listeners. */
  releaseRenderer: () => void;
  /** Cached so per-frame code never re-reads the theme object. */
  crossColor: THREE.Color;
  crossActive: THREE.Color;
};

/* ── grip cross decal ─────────────────────────────────────────────────── */

/** A stitched cross on a scrap of cloth — the visible sweet spot, no offset. */
function makeCrossTexture(color: string): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    const c = size / 2;
    // Dashed ring: the footprint edge, where the grip curve reaches zero.
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 3;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.arc(c, c, size * 0.4, 0, Math.PI * 2);
    ctx.stroke();
    // The cross itself, stitched.
    ctx.setLineDash([6, 4]);
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(c - size * 0.24, c);
    ctx.lineTo(c + size * 0.24, c);
    ctx.moveTo(c, c - size * 0.24);
    ctx.lineTo(c, c + size * 0.24);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(c, c, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** The nameplate on the front fascia: the cabinet's name, in the site's text face. */
function paintNamePlate(
  canvas: HTMLCanvasElement,
  name: string,
  theme: PrizeClawTheme,
): void {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = theme.signPlate;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = theme.brassHi;
  ctx.lineWidth = 5;
  ctx.strokeRect(6, 6, w - 12, h - 12);
  if (!name) return;
  ctx.fillStyle = theme.signInk;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = midwayCanvasFont('text', 800, Math.round(h * 0.5));
  ctx.fillText(name, w / 2, h * 0.53, w - 40);
}

/** The multiplier tag on each prize's coaster: ink plate, paper number. */
function paintPlate(canvas: HTMLCanvasElement, tier: ClawTierId, theme: PrizeClawTheme): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const mult = CLAW_TIERS[tier].multiplier;
  const label = `${Number.isInteger(mult) ? mult : mult.toFixed(1)}×`;
  ctx.fillStyle = theme.plate;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = theme.plateInk;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = midwayCanvasFont('num', 800, Math.round(canvas.height * 0.82));
  ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 4, canvas.width - 16);
}

function makePlates(theme: PrizeClawTheme): Record<ClawTierId, THREE.CanvasTexture> {
  const plates = {} as Record<ClawTierId, THREE.CanvasTexture>;
  for (const tier of CLAW_TIER_IDS) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    paintPlate(canvas, tier, theme);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    plates[tier] = tex;
  }
  return plates;
}

/** The faces load after the first paint; repaint the tags once they have. */
export function repaintPlates(claw: ClawScene, theme: PrizeClawTheme): void {
  for (const tier of CLAW_TIER_IDS) {
    const tex = claw.plates[tier];
    paintPlate(tex.image as HTMLCanvasElement, tier, theme);
    tex.needsUpdate = true;
  }
}

/* ── build ────────────────────────────────────────────────────────────── */

export type BuildOptions = {
  canvas: HTMLCanvasElement;
  theme: PrizeClawTheme;
  /** The client's quality controller: the start tier, and sampling pauses. */
  quality: MidwayQualityController;
  /** The context was lost: stop the loop. */
  onPause: () => void;
  /** The context came back: refresh the environment and render. */
  onRestore: () => void;
  /** The context is gone for good: dispose and show the still. */
  onContextLost: () => void;
};

/** Build the whole cabinet, minus the prizes. Returns null without WebGL. */
export function buildPrizeClawScene(opts: BuildOptions): ClawScene | null {
  const { canvas, theme } = opts;

  const handle = createMidwayRenderer({
    canvas,
    tier: opts.quality.tier(),
    exposure: 1.12,
    powerPreference: 'high-performance',
    onPause: opts.onPause,
    onRestore: opts.onRestore,
    onFallback: opts.onContextLost,
  });
  if (!handle) return null;
  const renderer = handle.renderer;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(theme.skyBottom);
  scene.fog = new THREE.Fog(new THREE.Color(theme.skyBottom).getHex(), 10, 26);

  const camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 80);
  camera.position.copy(CAM_REST);
  camera.lookAt(CAM_LOOK);

  /* ── the kit's light rig, plus the practical inside the case top ── */

  const rig = createMidwayLightRig(renderer, scene, {
    tier: opts.quality.tier(),
    target: [0, 0.7, 1.35],
    radius: 2.8,
    camera: [CAM_REST.x, CAM_REST.y, CAM_REST.z],
    sky: theme.skyTop,
    ground: theme.deckColor,
  });
  // This is what makes the brass read as brass and the glass read as glass.
  rig.addPractical([0, CASE_TOP - 0.18, 1.35], { intensity: 1.8, distance: 4.2 });

  // Grain, felt, planks, the marquee and the backdrop paint after the first frame.
  const deferred = createMidwayDeferredTextures('prize-claw', { quality: opts.quality });
  const blank = deferred.placeholder();

  /* ── materials ── */

  const wood = new THREE.MeshStandardMaterial({
    color: theme.woodMid,
    roughness: 0.5,
    map: blank,
    roughnessMap: blank,
  });
  const woodDark = new THREE.MeshStandardMaterial({
    color: theme.woodLo,
    roughness: 0.68,
  });
  const stripeTex = makeStripeTexture({
    stripeA: theme.enamelA,
    stripeB: theme.enamelB,
    pinstripe: theme.pinstripe,
    stripes: 6,
  });
  const enamel = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    map: stripeTex,
    roughness: 0.42,
  });
  const brass = new THREE.MeshStandardMaterial({
    color: theme.brass,
    roughness: 0.3,
    metalness: 0.82,
  });
  const brassDark = new THREE.MeshStandardMaterial({
    color: theme.brassLo,
    roughness: 0.44,
    metalness: 0.7,
  });
  const rubber = new THREE.MeshStandardMaterial({
    color: '#241a12',
    roughness: 0.92,
  });
  const felt = new THREE.MeshStandardMaterial({
    color: theme.felt,
    roughness: 0.96,
    map: blank,
    roughnessMap: blank,
  });
  const deck = new THREE.MeshStandardMaterial({
    color: theme.deckColor,
    roughness: 0.82,
    map: blank,
    roughnessMap: blank,
  });
  // The bed and the playfield over it share one felt paint.
  const feltMats: THREE.MeshStandardMaterial[] = [felt];
  deferred.add(
    () => ({
      wood: makeWoodTextures(2, 1),
      felt: makeFeltTexture(5),
      plank: makePlankTextures(8, 6, 5),
    }),
    (painted) => {
      for (const [mat, tex] of [
        [wood, painted.wood],
        [deck, painted.plank],
        ...feltMats.map((mat) => [mat, painted.felt] as const),
      ] as const) {
        mat.map = tex.map;
        mat.roughnessMap = tex.roughnessMap;
      }
    },
  );

  const prize = {} as Record<ClawTierId, THREE.MeshStandardMaterial>;
  const prizeAccent = {} as Record<ClawTierId, THREE.MeshStandardMaterial>;
  for (const tier of ['A', 'B', 'C', 'D', 'E'] as ClawTierId[]) {
    prize[tier] = new THREE.MeshStandardMaterial({
      color: theme.prize[tier],
      roughness: 0.82,
      metalness: 0,
      flatShading: true,
    });
    prizeAccent[tier] = new THREE.MeshStandardMaterial({
      color: theme.prizeAccent[tier],
      roughness: 0.82,
      metalness: 0,
      flatShading: true,
    });
  }

  const bulbMats = [theme.bulbWarm, theme.bulbAmber, theme.bulbRose].map(
    (hex) => {
      const mat = new THREE.MeshStandardMaterial();
      tintBulb(mat, hex);
      return mat;
    },
  );
  const socketMat = new THREE.MeshStandardMaterial({
    color: theme.brassLo,
    roughness: 0.5,
    metalness: 0.6,
  });
  const wireMat = makeMidwayMaterial('wire');

  /* ── boardwalk deck + night backdrop ── */

  const deckMesh = new THREE.Mesh(new THREE.PlaneGeometry(26, 22), deck);
  deckMesh.rotation.x = -Math.PI / 2;
  deckMesh.position.set(0, BASE_Y, 1.4);
  deckMesh.receiveShadow = true;
  scene.add(deckMesh);

  const backdropCanvas = document.createElement('canvas');
  backdropCanvas.width = 1024;
  backdropCanvas.height = 512;
  const backdropTexture = new THREE.CanvasTexture(backdropCanvas);
  backdropTexture.colorSpace = THREE.SRGBColorSpace;
  const backdropMat = new THREE.MeshBasicMaterial({
    map: deferred.placeholder(theme.skyBottom),
    fog: true,
  });
  deferred.add(
    () => paintMidwayBackdrop(backdropCanvas, theme.skyTop, theme.skyBottom),
    () => {
      backdropTexture.needsUpdate = true;
      backdropMat.map = backdropTexture;
    },
  );
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(30, 15), backdropMat);
  backdrop.position.set(0, 3.6, 12);
  backdrop.rotation.y = Math.PI;
  scene.add(backdrop);

  /* ── carcass ── */

  const cabinet = new THREE.Group();
  scene.add(cabinet);

  // Plinth: the walnut box the case stands on.
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(CASE_X * 2 + 0.2, 0.9, CASE_Z1 - CASE_Z0 + 0.2),
    wood,
  );
  plinth.position.set(0, BASE_Y + 0.45, (CASE_Z0 + CASE_Z1) / 2);
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  cabinet.add(plinth);

  // Painted enamel cheeks on the plinth sides.
  for (const side of [-1, 1]) {
    const cheek = new THREE.Mesh(
      new THREE.PlaneGeometry(CASE_Z1 - CASE_Z0 + 0.16, 0.78),
      enamel,
    );
    cheek.position.set(
      side * (CASE_X + 0.101),
      BASE_Y + 0.45,
      (CASE_Z0 + CASE_Z1) / 2,
    );
    cheek.rotation.y = side * (Math.PI / 2);
    cabinet.add(cheek);
  }

  // Cast feet.
  for (const sx of [-1, 1]) {
    for (const sz of [CASE_Z0 + 0.18, CASE_Z1 - 0.18]) {
      const foot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.12, 0.12, 12),
        brassDark,
      );
      foot.position.set(sx * (CASE_X - 0.06), BASE_Y + 0.06, sz);
      cabinet.add(foot);
    }
  }

  // Brass capping rail around the top of the plinth.
  const capping = new THREE.Mesh(
    new THREE.BoxGeometry(CASE_X * 2 + 0.26, 0.06, CASE_Z1 - CASE_Z0 + 0.26),
    brass,
  );
  capping.position.set(0, 0.02, (CASE_Z0 + CASE_Z1) / 2);
  cabinet.add(capping);

  // The felt floor of the case.
  const bed = new THREE.Mesh(
    new THREE.PlaneGeometry(CASE_X * 2, CASE_Z1 - CASE_Z0),
    felt,
  );
  bed.rotation.x = -Math.PI / 2;
  bed.position.set(0, 0.055, (CASE_Z0 + CASE_Z1) / 2);
  bed.receiveShadow = true;
  cabinet.add(bed);

  // The playable bed, a shade deeper than the case floor so the player can see
  // exactly where the claw is allowed to go.
  const playfieldMat = new THREE.MeshStandardMaterial({
    color: theme.feltShadow,
    roughness: 0.97,
    map: blank,
    roughnessMap: blank,
    transparent: true,
    opacity: 0.55,
  });
  feltMats.push(playfieldMat);
  const playfield = new THREE.Mesh(
    new THREE.PlaneGeometry(CLAW_BED_X * 2, CLAW_BED_Z1 - CLAW_BED_Z0),
    playfieldMat,
  );
  playfield.rotation.x = -Math.PI / 2;
  playfield.position.set(0, 0.056, (CLAW_BED_Z0 + CLAW_BED_Z1) / 2);
  cabinet.add(playfield);

  /* ── glass case in a brass extrusion frame ── */

  const frameBar = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
  ) => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), brass);
    bar.position.set(x, y, z);
    cabinet.add(bar);
  };
  const midZ = (CASE_Z0 + CASE_Z1) / 2;
  const depth = CASE_Z1 - CASE_Z0;
  // Corner posts.
  for (const sx of [-1, 1]) {
    for (const sz of [CASE_Z0, CASE_Z1]) {
      frameBar(0.06, CASE_TOP, 0.06, sx * CASE_X, CASE_TOP / 2, sz);
    }
  }
  // Top and bottom rails.
  for (const y of [0.05, CASE_TOP]) {
    frameBar(CASE_X * 2 + 0.06, 0.06, 0.06, 0, y, CASE_Z0);
    frameBar(CASE_X * 2 + 0.06, 0.06, 0.06, 0, y, CASE_Z1);
    for (const sx of [-1, 1]) {
      frameBar(0.06, 0.06, depth, sx * CASE_X, y, midZ);
    }
  }

  // Only the FRONT pane is expensive. Side and back panes are cheap tints —
  // four transmissive panes would cost far more than they show.
  const frontGlass = new THREE.Mesh(
    new THREE.PlaneGeometry(CASE_X * 2, CASE_TOP),
    makeGlassMaterial(true),
  );
  frontGlass.position.set(0, CASE_TOP / 2, CASE_Z0);
  frontGlass.rotation.y = Math.PI;
  frontGlass.renderOrder = 10;
  cabinet.add(frontGlass);

  const backGlass = new THREE.Mesh(
    new THREE.PlaneGeometry(CASE_X * 2, CASE_TOP),
    makeGlassMaterial(false),
  );
  backGlass.position.set(0, CASE_TOP / 2, CASE_Z1);
  cabinet.add(backGlass);

  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(
      new THREE.PlaneGeometry(depth, CASE_TOP),
      makeGlassMaterial(false),
    );
    side.position.set(sx * CASE_X, CASE_TOP / 2, midZ);
    side.rotation.y = sx * (Math.PI / 2);
    cabinet.add(side);
  }

  /* ── marquee ── */

  const crown = new THREE.Mesh(
    new THREE.BoxGeometry(CASE_X * 2 + 0.24, 0.4, 0.3),
    wood,
  );
  crown.position.set(0, CASE_TOP + 0.2, CASE_Z0 - 0.08);
  crown.castShadow = true;
  cabinet.add(crown);

  const marqueeMat = new THREE.MeshStandardMaterial({
    map: deferred.placeholder(theme.signPlate),
    roughness: 0.55,
  });
  deferred.add(
    () =>
      makeSignTexture({
        text: 'prize claw',
        sub: 'drop to win tickets',
        background: theme.signPlate,
        border: theme.brassHi,
        color: theme.signInk,
      }),
    (tex) => {
      marqueeMat.map = tex;
    },
  );
  const marquee = new THREE.Mesh(new THREE.PlaneGeometry(CASE_X * 2 - 0.1, 0.3), marqueeMat);
  marquee.position.set(0, CASE_TOP + 0.2, CASE_Z0 - 0.24);
  marquee.rotation.y = Math.PI;
  cabinet.add(marquee);

  const bulbs: THREE.Mesh[] = [];
  for (const run of [
    { y: CASE_TOP + 0.74, z: CASE_Z0 - 0.32, count: 9 },
    { y: CASE_TOP + 0.42, z: CASE_Z1 + 0.35, count: 7 },
  ]) {
    const string = buildBulbString({
      xStart: -CASE_X - 0.12,
      xEnd: CASE_X + 0.12,
      yTop: run.y,
      sag: 0.12,
      z: run.z,
      count: midwayBulbCount(run.count, opts.quality.tier()),
      bulbMats,
      socketMat,
      wireMat,
    });
    scene.add(string.group);
    bulbs.push(...string.bulbs);
  }

  /* ── front fascia: nameplate + prize door ── */

  const nameCanvas = document.createElement('canvas');
  nameCanvas.width = 512;
  nameCanvas.height = 128;
  paintNamePlate(nameCanvas, '', theme);
  const nameTexture = new THREE.CanvasTexture(nameCanvas);
  nameTexture.colorSpace = THREE.SRGBColorSpace;
  nameTexture.anisotropy = 4;
  const namePlateMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.92, 0.23),
    new THREE.MeshStandardMaterial({ map: nameTexture, roughness: 0.5 }),
  );
  namePlateMesh.position.set(0.42, BASE_Y + 0.55, CASE_Z0 - 0.101);
  namePlateMesh.rotation.y = Math.PI;
  cabinet.add(namePlateMesh);

  // Sprung prize door at the player's hand, hinged along its top edge.
  const door = new THREE.Group();
  door.position.set(CLAW_CHUTE.x, BASE_Y + 0.62, CASE_Z0 - 0.1);
  const doorFlap = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.3, 0.03), woodDark);
  doorFlap.position.set(0, -0.15, 0);
  door.add(doorFlap);
  const doorLip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.06), brass);
  doorLip.position.set(0, 0.02, 0);
  door.add(doorLip);
  cabinet.add(door);

  /* ── chute mouth in the felt, in front of the prize bed ── */

  const chuteRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.2, 0.028, 8, 24),
    brass,
  );
  chuteRing.rotation.x = Math.PI / 2;
  chuteRing.position.set(CLAW_CHUTE.x, 0.06, CLAW_CHUTE.z);
  cabinet.add(chuteRing);
  const chuteHole = new THREE.Mesh(
    new THREE.CircleGeometry(0.2, 24),
    new THREE.MeshStandardMaterial({ color: '#0b0603', roughness: 1 }),
  );
  chuteHole.rotation.x = -Math.PI / 2;
  chuteHole.position.set(CLAW_CHUTE.x, 0.058, CLAW_CHUTE.z);
  cabinet.add(chuteHole);

  /* ── gantry, trolley, cable, claw ── */

  const gantry = new THREE.Group();
  gantry.position.set(0, 0, CLAW_HOME.z);
  cabinet.add(gantry);

  const xRail = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, CASE_X * 2, 12),
    brass,
  );
  xRail.rotation.z = Math.PI / 2;
  xRail.position.set(0, RAIL_Y, 0);
  gantry.add(xRail);
  // Side shoes riding the two z rails.
  for (const sx of [-1, 1]) {
    const shoe = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.12, 0.16),
      brassDark,
    );
    shoe.position.set(sx * (CASE_X - 0.04), RAIL_Y, 0);
    gantry.add(shoe);
  }

  const trolley = new THREE.Group();
  trolley.position.set(CLAW_HOME.x, 0, 0);
  gantry.add(trolley);
  const trolleyBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.14, 0.18),
    brassDark,
  );
  trolleyBody.position.set(0, RAIL_Y - 0.02, 0);
  trolleyBody.castShadow = true;
  trolley.add(trolleyBody);

  // The cable and head hang from a pivot, so the whole claw can swing.
  const pivot = new THREE.Group();
  pivot.position.set(0, PIVOT_Y, 0);
  trolley.add(pivot);

  // Cable: a unit cylinder scaled in Y each frame, anchored at the pivot.
  const cable = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 1, 6),
    brassDark,
  );
  cable.position.set(0, -0.03, 0);
  pivot.add(cable);

  const head = new THREE.Group();
  head.position.set(0, HEAD_REST_Y - PIVOT_Y, 0);
  pivot.add(head);

  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.1, 0.14, 16),
    brass,
  );
  hub.castShadow = true;
  head.add(hub);
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.075, 0.07, 12),
    brassDark,
  );
  collar.position.y = 0.1;
  head.add(collar);

  const fingers: Array<{ upper: THREE.Group; lower: THREE.Group }> = [];
  for (let i = 0; i < 3; i += 1) {
    const yaw = (i / 3) * Math.PI * 2;
    const mount = new THREE.Group();
    mount.rotation.y = yaw;
    mount.position.y = -0.05;
    head.add(mount);

    const upper = new THREE.Group();
    upper.position.set(0, 0, 0.085);
    mount.add(upper);
    const upperSeg = new THREE.Mesh(
      new THREE.BoxGeometry(0.045, 0.16, 0.05),
      brass,
    );
    upperSeg.position.y = -0.08;
    upperSeg.castShadow = true;
    upper.add(upperSeg);

    const lower = new THREE.Group();
    lower.position.y = -0.16;
    upper.add(lower);
    const lowerSeg = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.2, 0.045),
      brass,
    );
    lowerSeg.position.y = -0.1;
    lowerSeg.castShadow = true;
    lower.add(lowerSeg);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), rubber);
    tip.position.y = -0.2;
    lower.add(tip);

    fingers.push({ upper, lower });
  }

  /* ── particles ── */

  const softDisc = makeSoftDiscTexture(128);
  const dust = makeSpriteParticlePool({
    scene,
    count: 24,
    texture: softDisc,
    colors: ['#d8c69c', '#b8a179'],
    size: 0.09,
  });
  const fibres = makeSpriteParticlePool({
    scene,
    count: 24,
    texture: softDisc,
    colors: [theme.felt, theme.cross],
    size: 0.05,
  });

  const prizeRoot = new THREE.Group();
  cabinet.add(prizeRoot);

  return {
    renderer,
    scene,
    camera,
    camLook: CAM_LOOK.clone(),
    gantry,
    trolley,
    head,
    cable,
    pivot,
    sway: makeSwing(),
    prizeSwing: makeSwing(),
    motion: { lastX: 0, lastZ: 0, velX: 0, velZ: 0, ready: false, carried: -1, kicked: false },
    plates: makePlates(theme),
    restless: false,
    fingers,
    door,
    prizes: [],
    prizeRoot,
    dust,
    fibres,
    bulbs,
    namePlate: {
      canvas: nameCanvas,
      texture: nameTexture,
      lastText: '',
    },
    mats: {
      wood,
      woodDark,
      enamel,
      brass,
      brassDark,
      rubber,
      felt,
      deck,
      bulb: bulbMats,
      prize,
      prizeAccent,
    },
    backdropCanvas,
    backdropTexture,
    rig,
    deferred,
    tier: opts.quality.tier(),
    releaseRenderer: handle.dispose,
    crossColor: new THREE.Color(theme.cross),
    crossActive: new THREE.Color(theme.crossActive),
  };
}

/* ── the case ─────────────────────────────────────────────────────────── */

/** Neighbours within this many world units lean on each other. Same as the engine's crowding radius. */
const LEAN_RADIUS = 0.34;

/**
 * Fill the case. Called from a client effect, never during render, so none of
 * the trigonometry here can cause a hydration mismatch. Safe to call again: the
 * previous bed's meshes are removed first. `pour` drops the prizes in one after
 * another; without it, and under reduced motion, they are simply there.
 */
export function populatePrizeBed(
  claw: ClawScene,
  bed: PrizeBed,
  theme: PrizeClawTheme,
  shelf: readonly ClawShelfPrize[],
  pour = false,
): void {
  clearPrizeBed(claw);
  resetSwing(claw.prizeSwing);
  claw.motion.kicked = false;

  const crossTex = makeCrossTexture(theme.cross);
  const geometry = new THREE.PlaneGeometry(CLAW_R_GRIP * 2, CLAW_R_GRIP * 2);
  const tagGeometry = new THREE.PlaneGeometry(0.22, 0.11);
  const slots = bed.prizes;
  for (const slot of slots) {
    const entry = shelf.find((candidate) => candidate.index === slot.index);
    const form: ClawForm = entry?.form ?? 'box';
    const scale = clawPrizeScale(slot.tier);
    const group = new THREE.Group();
    group.rotation.order = 'XZY';
    group.position.set(slot.x, 0.06, slot.z);
    group.rotation.set(0, slot.yaw, 0);

    const bodyGroup = buildPrizeForm(
      form,
      claw.mats.prize[slot.tier],
      claw.mats.prizeAccent[slot.tier],
      slot.variant,
    );
    bodyGroup.scale.setScalar(scale);
    group.add(bodyGroup);

    // The multiplier, on a tag leaning on the coaster and turned to the player.
    const tag = new THREE.Mesh(
      tagGeometry,
      new THREE.MeshBasicMaterial({ map: claw.plates[slot.tier] }),
    );
    tag.position.set(
      0.1 * scale * Math.sin(slot.yaw),
      0.035 * scale,
      -0.1 * scale * Math.cos(slot.yaw),
    );
    tag.rotation.set(0.75, Math.PI - slot.yaw, 0);
    tag.scale.setScalar(scale);
    group.add(tag);

    const topY = clawPrizeTop(form, slot.tier);
    const crossMat = new THREE.MeshBasicMaterial({
      map: crossTex,
      transparent: true,
      depthWrite: false,
      color: theme.cross,
    });
    const cross = new THREE.Mesh(geometry, crossMat);
    cross.rotation.x = -Math.PI / 2;
    cross.position.set(0, topY + 0.012, 0);
    cross.renderOrder = 4;
    group.add(cross);

    // Piled: a prize with a neighbour in reach leans toward it. The slot's own
    // x and z never change; this is how it sits, not where the engine says it is.
    let lx = 0;
    let lz = 0;
    for (const other of slots) {
      if (other === slot) continue;
      const dx = other.x - slot.x;
      const dz = other.z - slot.z;
      const d = Math.hypot(dx, dz);
      if (d >= LEAN_RADIUS || d < 1e-6) continue;
      const weight = 1 - d / LEAN_RADIUS;
      lx += (dx / d) * weight;
      lz += (dz / d) * weight;
    }
    const leanLen = Math.hypot(lx, lz);
    const leanMag = Math.min(0.2, leanLen * 0.16);
    const lean = {
      x: leanLen > 0 ? (lz / leanLen) * leanMag : 0,
      z: leanLen > 0 ? (-lx / leanLen) * leanMag : 0,
    };

    claw.prizeRoot.add(group);
    claw.prizes.push({
      slot,
      form,
      label: entry?.item?.name ?? null,
      group,
      body: bodyGroup,
      cross,
      crossMat,
      topY,
      lean,
      pile: makePileSpring(),
      pour: pour ? -0.09 * slot.index : 2,
      shoved: { close: false, lift: false, land: false },
    });
  }
  claw.restless = pour;
}

/** Drop the current bed's meshes and what belongs to them. */
export function clearPrizeBed(claw: ClawScene): void {
  for (const prize of claw.prizes) {
    claw.prizeRoot.remove(prize.group);
    // Body and accent materials and the model geometry are shared and owned by
    // the scene; only the per-prize cross and tag belong to the prize.
    prize.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && mesh.material instanceof THREE.MeshBasicMaterial) {
        mesh.material.dispose();
      }
    });
    prize.cross.geometry.dispose();
    prize.crossMat.map?.dispose();
  }
  claw.prizes = [];
}

/* ── per-frame drive ──────────────────────────────────────────────────── */

export type ClawApplyOptions = {
  frame: ClawFrame;
  /** Live claw position while aiming, in bed coordinates. */
  aim: { x: number; z: number };
  /** The prize the drop is resolving against, if any. */
  targetIndex: number | null;
  /** The prize currently highlighted under the claw while aiming. */
  hoverIndex: number | null;
  /** The server's outcome for the drop being played, if one is. */
  outcome: string | null;
  dt: number;
  reduced: boolean;
};

const _v = new THREE.Vector3();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();

/** Time for a poured prize to fall and settle, in seconds. */
const POUR_FALL = 0.42;
const POUR_SETTLE = 0.3;
const POUR_HEIGHT = 1.1;

function pourHeight(t: number): number {
  if (t <= 0) return POUR_HEIGHT;
  if (t < POUR_FALL) {
    const u = t / POUR_FALL;
    return POUR_HEIGHT * (1 - u * u);
  }
  const b = (t - POUR_FALL) / POUR_SETTLE;
  if (b >= 1) return 0;
  return 0.05 * (1 - b) * Math.abs(Math.sin(b * Math.PI * 1.5));
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Push one frame of the timeline into the cabinet. */
export function applyClawFrame(claw: ClawScene, opts: ClawApplyOptions): void {
  const { frame, aim, reduced, dt } = opts;
  const motion = claw.motion;

  // Trolley + gantry: aim position until the prize starts travelling, then a
  // straight run to the chute.
  const travel = frame.travelT;
  const x = aim.x + (CLAW_CHUTE.x - aim.x) * travel;
  const z = aim.z + (CLAW_CHUTE.z - aim.z) * travel;
  claw.gantry.position.z = z;
  claw.trolley.position.x = x;

  /* ── sway: the head hangs from the pivot and swings after a move ── */
  let ax = 0;
  let az = 0;
  if (!motion.ready || dt <= 0) {
    motion.lastX = x;
    motion.lastZ = z;
    motion.velX = 0;
    motion.velZ = 0;
    motion.ready = true;
  } else {
    const h = Math.max(dt, 1 / 240);
    const vx = (x - motion.lastX) / h;
    const vz = (z - motion.lastZ) / h;
    ax = clamp((vx - motion.velX) / h, -70, 70);
    az = clamp((vz - motion.velZ) / h, -70, 70);
    motion.lastX = x;
    motion.lastZ = z;
    motion.velX = vx;
    motion.velZ = vz;
  }

  // The claw settles before it closes on a prize, and swings again under load.
  let zeta = CLAW_HEAD_SWAY.zeta;
  if (frame.phase === 'descending') zeta = zeta + (1 - zeta) * Math.min(1, frame.t * 1.6);
  else if (frame.phase === 'closing' || frame.phase === 'gripping') zeta = 1;
  if (reduced) {
    resetSwing(claw.sway);
    resetSwing(claw.prizeSwing);
  } else {
    stepSwing(claw.sway, ax, az, dt, CLAW_HEAD_SWAY, zeta);
  }

  // Head height + cable length, both measured from the pivot.
  const cableLen = Math.max(0.02, PIVOT_Y - frame.headY);
  claw.head.position.y = frame.headY - PIVOT_Y;
  claw.cable.scale.y = cableLen;
  claw.cable.position.y = -cableLen / 2;
  // The tip travels about the same distance whatever the cable's length.
  const swayScale = 0.7 / (cableLen + 0.45);
  claw.pivot.rotation.set(claw.sway.rx * swayScale, 0, claw.sway.rz * swayScale);

  // Fingers: the tips trace an arc that closes UNDER the prize.
  const g = frame.gripT;
  for (const finger of claw.fingers) {
    finger.upper.rotation.x =
      FINGER_UPPER[0] + (FINGER_UPPER[1] - FINGER_UPPER[0]) * g;
    finger.lower.rotation.x =
      FINGER_LOWER[0] + (FINGER_LOWER[1] - FINGER_LOWER[0]) * g;
  }

  let restless = !reduced && !swingAtRest(claw.sway);

  const targetIndex = opts.targetIndex;
  const target =
    targetIndex == null
      ? null
      : (claw.prizes.find((p) => p.slot.index === targetIndex) ?? null);

  /* ── the pile: a closing claw shoves its neighbours, a lift lets them slump ── */
  if (target && !reduced) {
    const tx = target.slot.x;
    const tz = target.slot.z;
    const beat = (key: 'close' | 'lift' | 'land', push: number, inward: boolean) => {
      for (const other of claw.prizes) {
        if (other === target || other.shoved[key]) continue;
        other.shoved[key] = true;
        const dx = other.slot.x - tx;
        const dz = other.slot.z - tz;
        const d = Math.hypot(dx, dz);
        if (d > 0.55) continue;
        const near = 1 - d / 0.55;
        shovePile(other.pile, inward ? -dx : dx, inward ? -dz : dz, push * (0.35 + near));
      }
    };
    if (frame.phase === 'closing') beat('close', 0.45, false);
    if (frame.phase === 'lifting' && frame.carrying) beat('lift', 0.2, true);
    const landed = opts.outcome === 'slipped' || opts.outcome === 'brushed';
    if (landed && frame.phase === 'settled') beat('land', 0.3, false);
  }
  if (frame.phase === 'armed') {
    for (const prize of claw.prizes) {
      prize.shoved.close = prize.shoved.lift = prize.shoved.land = false;
    }
  }

  // Slip: the prize slides in the fingers, then goes. Timing is the server
  // script's slip point; the sag is the 240 ms before it.
  const sag = reduced ? 0 : frame.sag;

  for (const prize of claw.prizes) {
    const isTarget = prize.slot.index === targetIndex;
    const grp = prize.group;
    const body = prize.body;

    if (reduced) {
      resetPileSpring(prize.pile);
      prize.pour = 2;
    } else {
      stepPileSpring(prize.pile, dt);
      if (!pileAtRest(prize.pile)) restless = true;
    }

    // A poured prize falls in on its turn.
    let pourY = 0;
    if (prize.pour < POUR_FALL + POUR_SETTLE) {
      prize.pour += dt;
      pourY = pourHeight(prize.pour);
      restless = true;
    }
    grp.visible = prize.pour >= 0;

    if (isTarget && frame.carrying) {
      claw.head.getWorldPosition(_v);
      claw.prizeRoot.worldToLocal(_v);
      grp.position.set(_v.x, _v.y - 0.1 - prize.topY - 0.07 * sag, _v.z);
      grp.rotation.set(0, prize.slot.yaw, 0);
      grp.visible = true;

      // Hanging in the grip: a lift jolts it, and every move swings it.
      if (!reduced) {
        const weight = 0.8 + CLAW_TIER_RANK[prize.slot.tier] * 0.25;
        if (frame.phase === 'lifting' && !motion.kicked) {
          motion.kicked = true;
          kickSwing(
            claw.prizeSwing,
            Math.sin(prize.slot.yaw) * 1.2 * weight,
            Math.cos(prize.slot.yaw) * 1.5 * weight,
          );
        }
        stepSwing(claw.prizeSwing, ax * weight, az * weight, dt, CLAW_PRIZE_SWING);
        restless = true;
      }
      const sw = claw.prizeSwing;
      // The roll a slipping prize slides into; the fall picks it up at 0.35.
      const roll = sag * 0.35;
      _e.set(sw.rx + roll, 0, sw.rz);
      _p.set(0, prize.topY, 0).applyEuler(_e);
      body.rotation.set(sw.rx + roll, 0, sw.rz);
      body.position.set(-_p.x, prize.topY - _p.y, -_p.z);
    } else if (isTarget && frame.released) {
      // Down the chute and out of sight.
      const t = frame.chuteT;
      grp.position.set(
        CLAW_CHUTE.x,
        0.06 + (1 - t) * 1.3 - t * 0.5,
        CLAW_CHUTE.z,
      );
      grp.rotation.set(0, prize.slot.yaw, 0);
      body.rotation.x = t * 4.2;
      body.position.set(0, 0, 0);
      grp.visible = t < 0.96;
    } else {
      grp.position.set(
        prize.slot.x + prize.pile.x,
        0.06 + pourY - (prize.slot.exposure === 'buried' ? 0.015 : 0),
        prize.slot.z + prize.pile.z,
      );
      grp.rotation.set(
        prize.lean.x + prize.pile.tx,
        prize.slot.yaw,
        prize.lean.z + prize.pile.tz,
      );
      body.position.set(0, 0, 0);
      body.rotation.set(0, 0, 0);
      if (isTarget) {
        // A slipped prize falls from the claw; a brushed one is tipped over.
        body.position.y = reduced ? 0 : frame.prizeLift;
        body.rotation.set(frame.prizeRoll, frame.prizeYaw, 0);
        if (!reduced && opts.outcome === 'slipped' && frame.phase !== 'armed') {
          // It lands still swinging a little.
          stepSwing(claw.prizeSwing, 0, 0, dt, CLAW_PRIZE_SWING, 0.5);
          body.rotation.x += claw.prizeSwing.rx;
          body.rotation.z += claw.prizeSwing.rz;
          if (!swingAtRest(claw.prizeSwing)) restless = true;
        }
      }
    }

    // The cross under the claw lights warm; every other cross stays cloth.
    const lit = prize.slot.index === (targetIndex ?? opts.hoverIndex);
    prize.crossMat.color.copy(lit ? claw.crossActive : claw.crossColor);
    prize.crossMat.opacity = lit ? 1 : 0.72;
    prize.cross.visible = !frame.carrying || !lit;
  }
  if (!target) {
    resetSwing(claw.prizeSwing);
    motion.kicked = false;
  } else if (frame.phase === 'armed' || frame.phase === 'descending') {
    resetSwing(claw.prizeSwing);
    motion.kicked = false;
  }

  claw.restless = restless;

  // The prize door kicks open when something lands in the trough.
  const doorOpen = frame.chuteT > 0.75 ? 1 : 0;
  claw.door.rotation.x = -doorOpen * 0.5;

  if (!reduced) {
    stepSpriteParticles(claw.dust, dt, 0.9, 1.2);
    stepSpriteParticles(claw.fibres, dt, 1.4, 1.6);
  }

  // One deliberate camera move: a short dolly during the lift.
  claw.camera.position.lerpVectors(CAM_REST, CAM_PUSH, reduced ? 0 : frame.dolly);
  claw.camera.lookAt(claw.camLook);
}

/** A puff of felt fibre and dust at the fingertips. */
export function emitClawDust(
  claw: ClawScene,
  at: { x: number; y: number; z: number },
  amount: number,
): void {
  emitSpriteParticles(claw.dust, midwayParticleCount(Math.round(4 + amount * 5), claw.tier), {
    origin: [at.x, at.y + 0.03, at.z],
    spread: 0.14,
    speed: [0.12, 0.42],
    up: [0.1, 0.45],
    ttl: [0.35, 0.75],
    size: [0.6, 1.3],
    grow: 0.9,
    fade: 0.5,
  });
  emitSpriteParticles(claw.fibres, midwayParticleCount(Math.round(3 + amount * 4), claw.tier), {
    origin: [at.x, at.y + 0.05, at.z],
    spread: 0.12,
    speed: [0.2, 0.6],
    up: [0.25, 0.7],
    ttl: [0.3, 0.6],
    size: [0.5, 1.1],
    spin: 5,
    fade: 0.65,
  });
}

/** Print the cabinet's name on the fascia plate. `force` repaints once the faces load. */
export function setNamePlate(
  claw: ClawScene,
  name: string,
  theme: PrizeClawTheme,
  force = false,
): void {
  if (!force && name === claw.namePlate.lastText) return;
  claw.namePlate.lastText = name;
  paintNamePlate(claw.namePlate.canvas, name, theme);
  claw.namePlate.texture.needsUpdate = true;
}

/** Park the cabinet: claw home, fingers open, prizes seated, pools cleared. */
export function resetClawVisuals(claw: ClawScene): void {
  resetSpriteParticles(claw.dust);
  resetSpriteParticles(claw.fibres);
  claw.gantry.position.z = CLAW_HOME.z;
  claw.trolley.position.x = CLAW_HOME.x;
  claw.head.position.y = HEAD_REST_Y - PIVOT_Y;
  claw.pivot.rotation.set(0, 0, 0);
  resetSwing(claw.sway);
  resetSwing(claw.prizeSwing);
  claw.motion.ready = false;
  claw.motion.kicked = false;
  claw.door.rotation.x = 0;
  for (const prize of claw.prizes) {
    resetPileSpring(prize.pile);
    prize.shoved.close = prize.shoved.lift = prize.shoved.land = false;
    prize.group.position.set(prize.slot.x, 0.06, prize.slot.z);
    prize.group.rotation.set(prize.lean.x, prize.slot.yaw, prize.lean.z);
    prize.group.visible = prize.pour >= 0;
    prize.body.position.y = 0;
    prize.body.rotation.set(0, 0, 0);
    prize.cross.visible = true;
  }
}

export function resizePrizeClawScene(
  claw: ClawScene,
  width: number,
  height: number,
): void {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  claw.renderer.setSize(w, h, false);
  claw.camera.aspect = w / h;
  // A wide canvas has room beside the cabinet and none above it, so it zooms
  // in: the cabinet keeps filling about 70% of the canvas at every shape.
  const zoom = Math.min(1.14, Math.max(1, 1 + (w / h - 1.1) * 0.21));
  claw.camLook.copy(CAM_LOOK);
  claw.camLook.y -= (zoom - 1) * 1.1;
  claw.camera.fov = 2 * Math.atan(Math.tan((CAM_FOV * Math.PI) / 360) / zoom) * (180 / Math.PI);
  claw.camera.updateProjectionMatrix();
}

/** Deep disposal. Safe to call after a context loss. */
export function disposePrizeClawScene(claw: ClawScene | null): void {
  if (!claw) return;
  claw.deferred.dispose();
  try {
    clearPrizeBed(claw);
    claw.rig.dispose();
    disposeSceneDeep(claw.scene);
    claw.backdropTexture.dispose();
    claw.namePlate.texture.dispose();
    for (const tier of CLAW_TIER_IDS) claw.plates[tier].dispose();
    disposeClawFormGeometry();
    claw.releaseRenderer();
  } catch {
    // After a lost context the GPU-side disposals can no longer succeed; the
    // CPU-side graph is dropped either way.
  }
}

/** Move the cabinet to a new quality tier (the client's controller decides). */
export function applyClawTier(claw: ClawScene, tier: MidwayTier): void {
  claw.tier = tier;
  applyMidwayTier(claw.renderer, claw.rig, tier, { scene: claw.scene, camera: claw.camera });
}
