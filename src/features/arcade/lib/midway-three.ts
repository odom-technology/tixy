/* ──────────────────────────────────────────────────────────────────────────
   Midway three.js kit: the shared base for every 3D boardwalk game. The API
   and the frame budget rules are in docs/design/tixy-rebrand/THREE.md.

   It owns the palette and material set, the renderer and its context loss
   handling, one light rig, the quality tiers (midway-quality.ts), deferred
   procedural textures, bulb strings, particles and disposal. Everything here
   is cosmetic: no game logic, no scoring, no randomness that matters.
   Procedural textures use a fixed-seed PRNG so every visit paints the same
   midway.

   Look: warm tungsten on a night boardwalk. ACES filmic and sRGB output, PCF
   shadows, restrained reflections. Material depth, not glow: the only
   emissive surfaces are the bulbs.

   Not in the kit yet:
   - Instanced bulbs. Each bulb is its own mesh; fine up to about 40.
   - renderer.compileAsync. A CPU profile of the first-frame task (skee-ball
     and prize claw, SwiftShader, 4x throttle) puts about 1.3 s in building
     shader programs and 0.3 to 1 s in renderer.setSize; deferred texture
     painting is small. So keep distinct materials few (each is a program),
     size the canvas once before the first render, and try compileAsync when
     a game misses 2 s.
   - Tin duck and swerve use three.js directly until their phase 4 to 6
     pull requests (derby is a flat canvas now). Gunrush is retiring and still calls setupMidwayRenderer,
     tuneMidwayKeyShadow and applyMidwayEnvironment directly; don't copy it.
   ────────────────────────────────────────────────────────────────────────── */

import * as THREE from 'three';

import { recordArcadePerformanceMetric } from './arcade-performance';
import {
  MIDWAY_TIERS,
  midwayPixelRatio,
  midwayReducedMotion,
  type MidwayQualityController,
  type MidwayTier,
} from './midway-quality';

export * from './midway-quality';

/* ── Palette ── */

/**
 * Every colour a cabinet, rail, sign or light may use. Game art (prizes,
 * rings, balls, pucks) can use any colour; the frame around it comes from
 * here. The first ten are the rev. 2 brand tokens (--tixy-* in globals.css).
 */
export const MIDWAY_PALETTE = {
  paper: '#f4ebdc',
  paper2: '#eadfcb',
  paper3: '#ded0b7',
  ink: '#1f1a16',
  ink2: '#54483d',
  rail: '#2b2119',
  screen: '#2a231d',
  ticket: '#f2a33c',
  red: '#b83627',
  felt: '#2e7566',
  // Lacquered walnut and aged brass, the boardwalk's two materials.
  woodHi: '#6e4a26',
  wood: '#5a3a1c',
  woodLo: '#3a2412',
  brassHi: '#f0d79a',
  brass: '#c79a4c',
  brassLo: '#78581f',
  // The night: sky gradient top to bottom, and the boardwalk deck.
  nightTop: '#2a231d',
  nightBottom: '#1f1a16',
  deck: '#2b2119',
  // Light colours, used by the rig only.
  keyLight: '#fff1d6',
  fillLight: '#fff6e0',
  rimLight: '#9fc8e8',
  ambientLight: '#fff0d8',
  practicalLight: '#ffd39a',
} as const;

export type MidwayColor = keyof typeof MIDWAY_PALETTE;

/** String-light bulbs, in the order a string alternates them. */
export const MIDWAY_BULB_COLORS = [
  MIDWAY_PALETTE.ticket,
  MIDWAY_PALETTE.red,
  MIDWAY_PALETTE.paper,
] as const;

/* ── Material set ── */

export type MidwayMaterialName =
  | 'paper'
  | 'ink'
  | 'rail'
  | 'ticket'
  | 'red'
  | 'felt'
  | 'wood'
  | 'woodDark'
  | 'brass'
  | 'brassDark'
  | 'wire';

export interface MidwayMaterialSpec {
  color: string;
  roughness: number;
  metalness: number;
}

/** The kit's materials, tuned once under the rig. */
export const MIDWAY_MATERIALS: Readonly<
  Record<MidwayMaterialName, Readonly<MidwayMaterialSpec>>
> = {
  paper: { color: MIDWAY_PALETTE.paper, roughness: 0.7, metalness: 0 },
  ink: { color: MIDWAY_PALETTE.ink, roughness: 0.55, metalness: 0 },
  rail: { color: MIDWAY_PALETTE.rail, roughness: 0.85, metalness: 0 },
  ticket: { color: MIDWAY_PALETTE.ticket, roughness: 0.42, metalness: 0.05 },
  red: { color: MIDWAY_PALETTE.red, roughness: 0.42, metalness: 0.05 },
  felt: { color: MIDWAY_PALETTE.felt, roughness: 0.96, metalness: 0 },
  wood: { color: MIDWAY_PALETTE.wood, roughness: 0.6, metalness: 0 },
  woodDark: { color: MIDWAY_PALETTE.woodLo, roughness: 0.68, metalness: 0 },
  brass: { color: MIDWAY_PALETTE.brass, roughness: 0.31, metalness: 0.82 },
  brassDark: { color: MIDWAY_PALETTE.brassLo, roughness: 0.44, metalness: 0.7 },
  wire: { color: MIDWAY_PALETTE.ink, roughness: 0.9, metalness: 0 },
};

/**
 * A fresh material from the set. Each scene makes its own, because
 * disposeSceneDeep disposes what it finds. `params` adds maps or overrides
 * the colour for cosmetics; keep the roughness and metalness.
 */
export function makeMidwayMaterial(
  name: MidwayMaterialName,
  params: THREE.MeshStandardMaterialParameters = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ ...MIDWAY_MATERIALS[name], ...params });
}

/**
 * For cosmetic themes. An equipped skin was designed against the game's old
 * defaults, and the store previews still fall back to them, so before a skin's
 * slot is read, that slot's fields are reset to the frozen legacy theme. The
 * palette only fills slots with nothing equipped.
 */
export function fillSlotFromLegacy<T extends object>(
  theme: T,
  legacy: Readonly<T>,
  fields: readonly (keyof T)[] | undefined,
): void {
  if (!fields) return;
  for (const field of fields) {
    const value = legacy[field];
    theme[field] = (
      Array.isArray(value)
        ? [...value]
        : value && typeof value === 'object'
          ? { ...value }
          : value
    ) as T[keyof T];
  }
}

/** One tinted bulb material per colour, for buildBulbString's `bulbMats`. */
export function makeMidwayBulbMaterials(
  colors: readonly string[] = MIDWAY_BULB_COLORS,
): THREE.MeshStandardMaterial[] {
  return colors.map((hex) => {
    const mat = new THREE.MeshStandardMaterial();
    tintBulb(mat, hex);
    return mat;
  });
}

/* ── Renderer and context loss ── */

export interface MidwayRendererOptions {
  canvas: HTMLCanvasElement;
  /** The start tier. Sets antialias (fixed for the context's life) and the pixel ratio. */
  tier: MidwayTier;
  /** Tone-mapping exposure. Leave at MIDWAY_EXPOSURE unless the cabinet reads dark. */
  exposure?: number;
  alpha?: boolean;
  powerPreference?: WebGLPowerPreference;
  /** CSS size for the first pixel ratio. Defaults to the canvas's client size. */
  width?: number;
  height?: number;
  /** The context was lost. Stop the frame loop and draw nothing. */
  onPause?: () => void;
  /**
   * The context came back within `restoreTimeoutMs`. three.js re-uploads
   * geometry and textures by itself; call rig.refreshEnvironment(), render,
   * and resume. Without this handler a lost context falls back at once.
   */
  onRestore?: () => void;
  /** The context is gone for good. Dispose the scene and show <MidwayStill>. */
  onFallback: () => void;
  restoreTimeoutMs?: number;
}

export interface MidwayRendererHandle {
  renderer: THREE.WebGLRenderer;
  /** Remove the context listeners and free the context. */
  dispose: () => void;
}

export const MIDWAY_EXPOSURE = 1.2;

/**
 * Create the WebGL renderer for a cabinet, or null when WebGL is missing or
 * context creation fails: then show <MidwayStill>. Handles
 * `webglcontextlost`: pause, then restore or fall back.
 */
export function createMidwayRenderer(
  opts: MidwayRendererOptions,
): MidwayRendererHandle | null {
  const { canvas, tier } = opts;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: MIDWAY_TIERS[tier].antialias,
      alpha: opts.alpha ?? false,
      powerPreference: opts.powerPreference ?? 'default',
    });
  } catch {
    return null;
  }
  const width = opts.width ?? (canvas.clientWidth || window.innerWidth);
  const height = opts.height ?? (canvas.clientHeight || window.innerHeight);
  renderer.setPixelRatio(midwayPixelRatio(tier, width, height));
  setupMidwayRenderer(renderer, opts.exposure ?? MIDWAY_EXPOSURE);
  renderer.shadowMap.enabled = MIDWAY_TIERS[tier].shadowMapSize > 0;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let fellBack = false;
  const fallBack = () => {
    if (fellBack) return;
    fellBack = true;
    opts.onFallback();
  };
  const onLost = (event: Event) => {
    event.preventDefault(); // lets the browser hand the context back
    opts.onPause?.();
    if (!opts.onRestore) {
      fallBack();
      return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(fallBack, opts.restoreTimeoutMs ?? 3000);
  };
  const onRestored = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!fellBack) opts.onRestore?.();
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  return {
    renderer,
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      renderer.dispose();
    },
  };
}

/* ── The light rig ── */

/** Tuned once. Directions are in the camera's frame: x right, y up, z toward the camera. */
const RIG = {
  hemisphere: 1.2,
  ambient: 0.45,
  key: 2.6,
  fill: 0.75,
  rim: 0.6,
  environment: 0.28,
  keyFrom: [-0.5, 1, 0.6],
  fillFrom: [0.65, 0.45, 0.9],
  rimFrom: [-0.25, 0.6, -1],
  practical: { intensity: 2, distance: 4.5, decay: 2 },
} as const;

export interface MidwayLightRigOptions {
  tier: MidwayTier;
  /** Centre of the cabinet or play area. */
  target: THREE.Vector3Tuple;
  /** Radius that encloses the cabinet. Sizes the key's shadow box. */
  radius: number;
  /** Where the camera rests. Key, fill and rim are placed relative to the view. */
  camera: THREE.Vector3Tuple;
  /** Hemisphere sky and ground. Default to the palette night; cosmetics may override. */
  sky?: THREE.ColorRepresentation;
  ground?: THREE.ColorRepresentation;
}

export interface MidwayLightRig {
  hemi: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  key: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
  rim: THREE.DirectionalLight;
  practicals: THREE.PointLight[];
  /** A tungsten lamp on the cabinet: a lamp in the case, a light over a sign. */
  addPractical: (
    position: THREE.Vector3Tuple,
    opts?: { intensity?: number; distance?: number; color?: THREE.ColorRepresentation },
  ) => THREE.PointLight;
  /** Shadows on or off and their resolution. applyMidwayTier calls it. */
  setTier: (tier: MidwayTier) => void;
  /** Rebuild the reflection map after a context restore. */
  refreshEnvironment: () => void;
  dispose: () => void;
}

/**
 * The night-boardwalk rig: hemisphere and ambient fill, a warm key with the
 * only shadow, a warm front fill, a cool rim from behind, and the reflection
 * environment. Games call this instead of building their own lights.
 */
export function createMidwayLightRig(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  opts: MidwayLightRigOptions,
): MidwayLightRig {
  const target = new THREE.Vector3(...opts.target);
  const forward = target.clone().sub(new THREE.Vector3(...opts.camera)).setY(0);
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
  forward.normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(forward, up).normalize();
  const radius = Math.max(0.5, opts.radius);
  const distance = radius * 2.5;
  const place = (light: THREE.DirectionalLight, from: readonly number[]) => {
    const dir = new THREE.Vector3()
      .addScaledVector(right, from[0]!)
      .addScaledVector(up, from[1]!)
      .addScaledVector(forward, -from[2]!)
      .normalize();
    light.position.copy(target).addScaledVector(dir, distance);
    light.target.position.copy(target);
    scene.add(light);
    scene.add(light.target);
  };

  const hemi = new THREE.HemisphereLight(
    opts.sky ?? MIDWAY_PALETTE.nightTop,
    opts.ground ?? MIDWAY_PALETTE.deck,
    RIG.hemisphere,
  );
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(MIDWAY_PALETTE.ambientLight, RIG.ambient);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(MIDWAY_PALETTE.keyLight, RIG.key);
  place(key, RIG.keyFrom);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  const box = key.shadow.camera;
  box.left = -radius;
  box.right = radius;
  box.top = radius;
  box.bottom = -radius;
  box.near = Math.max(0.1, distance - radius * 1.6);
  box.far = distance + radius * 1.6;
  box.updateProjectionMatrix();

  const fill = new THREE.DirectionalLight(MIDWAY_PALETTE.fillLight, RIG.fill);
  place(fill, RIG.fillFrom);
  const rim = new THREE.DirectionalLight(MIDWAY_PALETTE.rimLight, RIG.rim);
  place(rim, RIG.rimFrom);

  let disposeEnvironment = applyMidwayEnvironment(renderer, scene, RIG.environment);
  const practicals: THREE.PointLight[] = [];

  const setTier = (tier: MidwayTier) => {
    const size = MIDWAY_TIERS[tier].shadowMapSize;
    // castShadow changes the lights hash, so materials recompile once here.
    key.castShadow = size > 0;
    renderer.shadowMap.enabled = size > 0;
    if (size > 0 && key.shadow.mapSize.x !== size) {
      key.shadow.mapSize.set(size, size);
      key.shadow.map?.dispose();
      key.shadow.map = null;
    }
  };
  setTier(opts.tier);

  return {
    hemi,
    ambient,
    key,
    fill,
    rim,
    practicals,
    addPractical(position, lamp = {}) {
      const light = new THREE.PointLight(
        lamp.color ?? MIDWAY_PALETTE.practicalLight,
        lamp.intensity ?? RIG.practical.intensity,
        lamp.distance ?? RIG.practical.distance,
        RIG.practical.decay,
      );
      light.position.set(...position);
      scene.add(light);
      practicals.push(light);
      return light;
    },
    setTier,
    refreshEnvironment() {
      disposeEnvironment();
      disposeEnvironment = applyMidwayEnvironment(renderer, scene, RIG.environment);
    },
    dispose() {
      disposeEnvironment();
      key.shadow.map?.dispose();
      for (const light of [hemi, ambient, key, fill, rim, ...practicals]) {
        light.removeFromParent();
      }
      key.target.removeFromParent();
      fill.target.removeFromParent();
      rim.target.removeFromParent();
    },
  };
}

/**
 * Move a running scene to a new tier: the rig's shadows and the canvas pixel
 * ratio. Antialias stays as the context was created and bulb counts stay as
 * built. Turning shadows on or off recompiles every lit material (over a
 * second on a slow phone) and the pixel ratio reallocates the drawing buffer,
 * so call this only from a quality listener, which runs when no decision is
 * live. Pass the scene and camera to pay the recompile now rather than on the
 * next frame, which may already be inside a timed input.
 */
export function applyMidwayTier(
  renderer: THREE.WebGLRenderer,
  rig: MidwayLightRig | null,
  tier: MidwayTier,
  view?: { scene: THREE.Scene; camera: THREE.Camera },
): void {
  rig?.setTier(tier);
  const size = renderer.getSize(new THREE.Vector2());
  if (size.x > 0 && size.y > 0) {
    renderer.setPixelRatio(midwayPixelRatio(tier, size.x, size.y));
  }
  if (view) renderer.compile(view.scene, view.camera);
}

/* ── Deferred procedural textures ── */

export interface MidwayDeferredTextures {
  /**
   * A 1 x 1 texture to hold a material's map slot until the real one is
   * painted. Shaders compile with the map in place, so the swap later costs
   * an upload and no recompile. White leaves the material colour as it is.
   */
  placeholder: (color?: THREE.ColorRepresentation) => THREE.Texture;
  /** Queue a paint. `apply` puts the result on its materials. */
  add: <T>(paint: () => T, apply: (painted: T) => void) => void;
  /**
   * Call right after the first render. Paints one job per idle slot and
   * calls `onPainted` after each, so an idle scene can render again.
   */
  start: (onPainted?: () => void) => void;
  readonly pending: number;
  /** Drop the jobs that have not run. */
  dispose: () => void;
}

/**
 * Defers decorative procedural canvases (wood grain, planks, felt, backdrops,
 * signs) until after the first frame, so the cabinet appears in flat colour
 * first and gains its grain a few frames later. Never defer anything that
 * carries game information: numbers on balls, plaques a player reads, targets.
 * Records how long the painting took as a `game-ready` metric with
 * `stage: 'textures'`. With `quality`, the controller stops sampling until the
 * queue has drained and its uploads have had MIDWAY_SAMPLING_GRACE_MS, so
 * texture uploads can't cause a tier drop.
 */
export function createMidwayDeferredTextures(
  game: string,
  opts: { quality?: MidwayQualityController | null } = {},
): MidwayDeferredTextures {
  const jobs: Array<() => void> = [];
  const placeholders = new Map<string, THREE.Texture>();
  let started = false;
  let disposed = false;
  let handle: number | null = null;
  let painted = 0;
  let startedAt = 0;
  let notify: (() => void) | undefined;
  let sampling = opts.quality ?? null;
  sampling?.pauseSampling();
  const resumeSampling = () => {
    sampling?.resumeSampling();
    sampling = null;
  };

  const idle = (fn: () => void): number => {
    if (typeof window.requestIdleCallback === 'function') {
      return window.requestIdleCallback(fn, { timeout: 120 });
    }
    return window.setTimeout(fn, 16);
  };
  const cancel = (id: number) => {
    if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(id);
    else window.clearTimeout(id);
  };

  const pump = () => {
    handle = null;
    if (disposed) return;
    const job = jobs.shift();
    if (job) {
      // One bad paint must not stop the rest; the placeholder stays.
      try {
        job();
        painted += 1;
      } catch (error) {
        console.error(`[midway] ${game}: a deferred texture failed`, error);
      }
      notify?.();
    }
    if (jobs.length > 0) {
      handle = idle(pump);
      return;
    }
    if (painted > 0) {
      recordArcadePerformanceMetric(
        'game-ready',
        `${game} textures`,
        performance.now() - startedAt,
        { stage: 'textures', textures: painted },
        startedAt,
      );
    }
    resumeSampling();
  };

  return {
    placeholder(color = '#ffffff') {
      const c = new THREE.Color(color);
      const key = c.getHexString();
      let tex = placeholders.get(key);
      if (!tex) {
        const srgb = c.clone().convertLinearToSRGB();
        tex = new THREE.DataTexture(
          new Uint8Array([
            Math.round(srgb.r * 255),
            Math.round(srgb.g * 255),
            Math.round(srgb.b * 255),
            255,
          ]),
          1,
          1,
        );
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        placeholders.set(key, tex);
      }
      return tex;
    },
    add(paint, apply) {
      if (disposed) return;
      jobs.push(() => apply(paint()));
      if (started && handle === null) handle = idle(pump);
    },
    start(onPainted) {
      if (started || disposed) return;
      started = true;
      notify = onPainted;
      startedAt = performance.now();
      if (jobs.length > 0) handle = idle(pump);
      else resumeSampling();
    },
    get pending() {
      return jobs.length;
    },
    dispose() {
      disposed = true;
      jobs.length = 0;
      if (handle !== null) cancel(handle);
      handle = null;
      for (const tex of placeholders.values()) tex.dispose();
      placeholders.clear();
      resumeSampling();
    },
  };
}

/* ── Renderer / color pipeline ── */

/** ACES filmic, sRGB output and PCF shadows. createMidwayRenderer calls it; gunrush still calls it directly. */
export function setupMidwayRenderer(
  renderer: THREE.WebGLRenderer,
  exposure = 1.12,
): void {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
}

/** Legacy, gunrush only: the rig tunes its own key shadow per tier. */
export function tuneMidwayKeyShadow(light: THREE.DirectionalLight): void {
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.bias = -0.0004;
  light.shadow.normalBias = 0.02;
  light.shadow.radius = 4;
}

/**
 * Restrained environment reflections: a tiny warm "room" (one tungsten
 * ceiling panel + two dim amber cards) run through PMREM so brass and enamel
 * pick up believable speculars without ever reading as glow.
 * Returns a disposer.
 */
export function applyMidwayEnvironment(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  intensity = 0.3,
): () => void {
  const room = new THREE.Scene();
  room.background = new THREE.Color('#160c05');
  const card = (
    color: string,
    w: number,
    h: number,
    pos: [number, number, number],
    rot: [number, number, number],
  ) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
    );
    mesh.position.set(...pos);
    mesh.rotation.set(...rot);
    room.add(mesh);
  };
  // Warm tungsten panel overhead + two dim amber bounce cards.
  card('#ffe9c4', 8, 8, [0, 9, 0], [Math.PI / 2, 0, 0]);
  card('#6b4318', 10, 6, [-9, 3, 0], [0, Math.PI / 2, 0]);
  card('#4a2c10', 10, 6, [9, 3, 0], [0, -Math.PI / 2, 0]);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTarget = pmrem.fromScene(room, 0.04);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = intensity;
  pmrem.dispose();
  room.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) (mesh.material as THREE.Material).dispose();
  });

  return () => {
    scene.environment = null;
    envTarget.dispose();
  };
}

/* ── Fixed-seed PRNG so procedural textures are identical every visit ── */

function texRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── Procedural lacquered-wood grain ── */

export interface WoodTextures {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
}

/**
 * Near-white grain map (multiplies the theme color, so cosmetics still
 * recolor the wood) + a roughness map whose glossier streaks read as lacquer.
 */
export function makeWoodTextures(repeatX = 1, repeatY = 2): WoodTextures {
  const size = 256;
  const grain = document.createElement('canvas');
  grain.width = size;
  grain.height = size;
  const rough = document.createElement('canvas');
  rough.width = size;
  rough.height = size;
  const g = grain.getContext('2d');
  const r = rough.getContext('2d');
  if (g && r) {
    g.fillStyle = '#f3efe8';
    g.fillRect(0, 0, size, size);
    r.fillStyle = '#e2e2e2';
    r.fillRect(0, 0, size, size);
    const rng = texRng(0x5eeba11);
    // Long wavy grain streaks running down the plank (canvas Y).
    for (let i = 0; i < 46; i += 1) {
      const x0 = rng() * size;
      const amp = 1.5 + rng() * 4;
      const period = 40 + rng() * 90;
      const width = 0.6 + rng() * 1.8;
      const dark = 0.05 + rng() * 0.09;
      g.strokeStyle = `rgba(64, 34, 12, ${dark.toFixed(3)})`;
      g.lineWidth = width;
      r.strokeStyle = `rgba(120, 120, 120, ${(dark * 3.2).toFixed(3)})`;
      r.lineWidth = width + 0.6;
      const phase = rng() * Math.PI * 2;
      g.beginPath();
      r.beginPath();
      for (let y = 0; y <= size; y += 8) {
        const x = x0 + Math.sin(phase + y / period) * amp;
        if (y === 0) {
          g.moveTo(x, y);
          r.moveTo(x, y);
        } else {
          g.lineTo(x, y);
          r.lineTo(x, y);
        }
      }
      g.stroke();
      r.stroke();
    }
    // A few faint knots.
    for (let i = 0; i < 5; i += 1) {
      const kx = rng() * size;
      const ky = rng() * size;
      const kr = 3 + rng() * 6;
      g.strokeStyle = 'rgba(50, 26, 8, 0.10)';
      g.lineWidth = 1.4;
      g.beginPath();
      g.ellipse(kx, ky, kr, kr * (0.45 + rng() * 0.3), rng(), 0, Math.PI * 2);
      g.stroke();
    }
    // Soft sheen bands (lighter passes) for the lacquer.
    for (let i = 0; i < 8; i += 1) {
      const x = rng() * size;
      g.fillStyle = 'rgba(255, 252, 240, 0.05)';
      g.fillRect(x, 0, 6 + rng() * 18, size);
    }
  }
  const map = new THREE.CanvasTexture(grain);
  map.colorSpace = THREE.SRGBColorSpace;
  const roughnessMap = new THREE.CanvasTexture(rough);
  for (const tex of [map, roughnessMap]) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.anisotropy = 4;
  }
  return { map, roughnessMap };
}

/* ── Procedural boardwalk decking ── */

/**
 * Weathered boardwalk planks: a near-white plank map (it multiplies the theme
 * ground color, so cosmetics still recolor the deck) plus a roughness map
 * whose damp streaks catch the practicals. Planks run along texture V.
 */
export function makePlankTextures(
  planks = 7,
  repeatX = 5,
  repeatY = 4,
): WoodTextures {
  const size = 256;
  const albedo = document.createElement('canvas');
  albedo.width = size;
  albedo.height = size;
  const rough = document.createElement('canvas');
  rough.width = size;
  rough.height = size;
  const g = albedo.getContext('2d');
  const r = rough.getContext('2d');
  if (g && r) {
    g.fillStyle = '#efe9df';
    g.fillRect(0, 0, size, size);
    r.fillStyle = '#d8d8d8';
    r.fillRect(0, 0, size, size);
    const rng = texRng(0x9100d);
    const plankW = size / planks;
    for (let i = 0; i < planks; i += 1) {
      const x0 = i * plankW;
      // Each plank reads a touch lighter or darker than its neighbours.
      const tone = 0.86 + rng() * 0.22;
      g.fillStyle = `rgba(${Math.round(150 * tone)}, ${Math.round(
        128 * tone,
      )}, ${Math.round(104 * tone)}, 0.30)`;
      g.fillRect(x0, 0, plankW, size);
      // Lengthwise grain.
      for (let s = 0; s < 7; s += 1) {
        const gx = x0 + 2 + rng() * (plankW - 4);
        g.strokeStyle = `rgba(58, 38, 18, ${(0.05 + rng() * 0.08).toFixed(3)})`;
        g.lineWidth = 0.6 + rng() * 1.4;
        g.beginPath();
        g.moveTo(gx, 0);
        for (let y = 0; y <= size; y += 16) {
          g.lineTo(gx + Math.sin(y / (30 + rng() * 40)) * 1.6, y);
        }
        g.stroke();
      }
      // Dark seam between planks, plus a bright wet edge on one side.
      g.fillStyle = 'rgba(18, 10, 4, 0.55)';
      g.fillRect(x0, 0, 1.6, size);
      g.fillStyle = 'rgba(255, 246, 226, 0.10)';
      g.fillRect(x0 + 1.6, 0, 1.1, size);
      r.fillStyle = 'rgba(70, 70, 70, 0.55)';
      r.fillRect(x0, 0, 2.4, size);
      // Butt joints across the plank.
      const jointY = rng() * size;
      g.fillStyle = 'rgba(18, 10, 4, 0.45)';
      g.fillRect(x0, jointY, plankW, 1.4);
      // Two nail heads per joint.
      for (const nx of [x0 + plankW * 0.28, x0 + plankW * 0.72]) {
        g.fillStyle = 'rgba(40, 26, 12, 0.4)';
        g.beginPath();
        g.arc(nx, jointY + 5, 1.5, 0, Math.PI * 2);
        g.fill();
      }
    }
    // Damp patches: glossier streaks that pick up the string lights.
    for (let i = 0; i < 14; i += 1) {
      const px = rng() * size;
      const py = rng() * size;
      const pr = 10 + rng() * 34;
      const grad = r.createRadialGradient(px, py, 0, px, py, pr);
      grad.addColorStop(0, 'rgba(120, 120, 120, 0.5)');
      grad.addColorStop(1, 'rgba(120, 120, 120, 0)');
      r.fillStyle = grad;
      r.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    }
  }
  const map = new THREE.CanvasTexture(albedo);
  map.colorSpace = THREE.SRGBColorSpace;
  const roughnessMap = new THREE.CanvasTexture(rough);
  for (const tex of [map, roughnessMap]) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.anisotropy = 4;
  }
  return { map, roughnessMap };
}

/* ── Painted enamel stripes (carnival tower / cabinet faces) ── */

/**
 * Vertical painted stripes with a gold pinstripe between them — the classic
 * strongman-tower livery. Near-white so it multiplies the theme color.
 * Stripes run along texture U (repeat X = 1 keeps them registered).
 */
export interface StripeOptions {
  stripeA: string;
  stripeB: string;
  pinstripe: string;
  stripes?: number;
}

/** Repaint an existing stripe canvas in place — used on cosmetic changes. */
export function paintStripes(canvas: HTMLCanvasElement, opts: StripeOptions): void {
  const size = canvas.width;
  const stripes = opts.stripes ?? 6;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const band = size / stripes;
    for (let i = 0; i < stripes; i += 1) {
      ctx.fillStyle = i % 2 === 0 ? opts.stripeA : opts.stripeB;
      ctx.fillRect(i * band, 0, band, size);
      // Gold pinstripe just inside each stripe boundary.
      ctx.fillStyle = opts.pinstripe;
      ctx.fillRect(i * band + band - 2.5, 0, 2.5, size);
    }
    // Faint lacquer sheen down the face so flat paint still reads as lacquer.
    const sheen = ctx.createLinearGradient(0, 0, size, 0);
    sheen.addColorStop(0, 'rgba(255, 255, 255, 0.05)');
    sheen.addColorStop(0.35, 'rgba(255, 255, 255, 0.0)');
    sheen.addColorStop(1, 'rgba(0, 0, 0, 0.10)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, size, size);
  }
}

export function makeStripeTexture(
  opts: StripeOptions & { size?: number },
): THREE.CanvasTexture {
  const size = opts.size ?? 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  paintStripes(canvas, opts);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/* ── Painted midway signage (marquees, plaques, apron lettering) ── */

/**
 * The canvas font for kit lettering: Gabarito for words, Big Shoulders for
 * numbers, through the next/font variables on <html>.
 */
export function midwayCanvasFont(kind: 'text' | 'num', weight: number, px: number): string {
  const variable = kind === 'num' ? '--font-big-shoulders' : '--font-gabarito';
  let family = '';
  if (typeof document !== 'undefined') {
    family = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  }
  const fallback = kind === 'num' ? 'Big Shoulders, Gabarito' : 'Gabarito';
  return `${weight} ${Math.round(px)}px ${family ? `${family}, ` : ''}${fallback}, system-ui, sans-serif`;
}

export interface SignOptions {
  text: string;
  sub?: string;
  width?: number;
  height?: number;
  /** Plate, keyline and lettering. Default to ink, ticket and paper. */
  background?: string;
  border?: string;
  color?: string;
  fontScale?: number;
}

/**
 * A painted enamel sign: filled plate, double keyline border, and centred
 * lettering in Gabarito. Used for marquees and plaques so the cabinets carry
 * real signage. If the face has not loaded yet the sign repaints once it has.
 */
export function makeSignTexture(opts: SignOptions): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = opts.width ?? 512;
  canvas.height = opts.height ?? 128;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const font = paintSign(canvas, opts);
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (fonts && !fonts.check(font)) {
    void fonts
      .load(font)
      .then(() => {
        paintSign(canvas, opts);
        tex.needsUpdate = true;
      })
      .catch(() => undefined);
  }
  return tex;
}

/** Paint a sign onto its canvas. Returns the main font, for load checks. */
function paintSign(canvas: HTMLCanvasElement, opts: SignOptions): string {
  const w = canvas.width;
  const h = canvas.height;
  const size = h * (opts.sub ? 0.34 : 0.44) * (opts.fontScale ?? 1);
  const font = midwayCanvasFont('text', 800, size);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const bg = opts.background ?? MIDWAY_PALETTE.ink;
    const border = opts.border ?? MIDWAY_PALETTE.ticket;
    const color = opts.color ?? MIDWAY_PALETTE.paper;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, bg);
    grad.addColorStop(1, '#000000');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    // Double keyline.
    ctx.strokeStyle = border;
    ctx.lineWidth = Math.max(3, h * 0.05);
    ctx.strokeRect(h * 0.05, h * 0.05, w - h * 0.1, h - h * 0.1);
    ctx.lineWidth = Math.max(1, h * 0.015);
    ctx.strokeRect(h * 0.13, h * 0.13, w - h * 0.26, h - h * 0.26);
    // Lettering with a drop shadow, like painted signwriting, shrunk to fit
    // inside the inner keyline.
    const maxWidth = w - h * 0.4;
    const fit = (text: string, px: number) => {
      ctx.font = midwayCanvasFont('text', 800, px);
      const measured = ctx.measureText(text).width;
      if (measured > maxWidth) ctx.font = midwayCanvasFont('text', 800, (px * maxWidth) / measured);
    };
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const midY = opts.sub ? h * 0.4 : h * 0.5;
    fit(opts.text, size);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillText(opts.text, w / 2, midY + Math.max(2, h * 0.03));
    ctx.fillStyle = color;
    ctx.fillText(opts.text, w / 2, midY);
    if (opts.sub) {
      fit(opts.sub, h * 0.2 * (opts.fontScale ?? 1));
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillText(opts.sub, w / 2, h * 0.73 + 2);
      ctx.fillStyle = border;
      ctx.fillText(opts.sub, w / 2, h * 0.73);
    }
  }
  return font;
}

/* ── Night-midway backdrop with a deep silhouette skyline ── */

/**
 * Paints the sky gradient plus a two-layer carnival silhouette (far booths,
 * near tents + a ferris wheel) and a few dim stars. Deterministic; call again
 * with new colors on theme change — the silhouette repaints with it.
 */
export function paintMidwayBackdrop(
  canvas: HTMLCanvasElement,
  skyTop: string,
  skyBottom: string,
): void {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, skyTop);
  grad.addColorStop(1, skyBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Dim tungsten stars, upper half only.
  const rng = texRng(0xcafe17);
  ctx.fillStyle = 'rgba(255, 238, 200, 0.22)';
  for (let i = 0; i < 42; i += 1) {
    const sx = rng() * w;
    const sy = rng() * h * 0.42;
    const sr = rng() < 0.15 ? 1.4 : 0.8;
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();
  }

  const horizon = h * 0.66;

  // Far layer: low booth roofline, soft.
  ctx.fillStyle = 'rgba(5, 2, 1, 0.45)';
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(0, horizon + h * 0.05);
  let fx = 0;
  while (fx < w) {
    const bw = w * (0.05 + rng() * 0.06);
    const bh = h * (0.03 + rng() * 0.05);
    ctx.lineTo(fx, horizon + h * 0.05 - bh);
    ctx.lineTo(fx + bw, horizon + h * 0.05 - bh);
    fx += bw;
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();

  // Near layer: tents, poles + pennants, and a ferris wheel.
  ctx.fillStyle = 'rgba(4, 2, 1, 0.85)';
  ctx.strokeStyle = 'rgba(4, 2, 1, 0.85)';
  const tent = (cx: number, tw: number, th: number) => {
    ctx.beginPath();
    ctx.moveTo(cx - tw / 2, horizon + h * 0.12);
    ctx.lineTo(cx - tw * 0.42, horizon - th * 0.55);
    ctx.lineTo(cx, horizon - th);
    ctx.lineTo(cx + tw * 0.42, horizon - th * 0.55);
    ctx.lineTo(cx + tw / 2, horizon + h * 0.12);
    ctx.closePath();
    ctx.fill();
    // Flag pole.
    ctx.lineWidth = Math.max(1, w * 0.002);
    ctx.beginPath();
    ctx.moveTo(cx, horizon - th);
    ctx.lineTo(cx, horizon - th - h * 0.05);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, horizon - th - h * 0.05);
    ctx.lineTo(cx + w * 0.02, horizon - th - h * 0.035);
    ctx.lineTo(cx, horizon - th - h * 0.02);
    ctx.closePath();
    ctx.fill();
  };
  tent(w * 0.12, w * 0.2, h * 0.16);
  tent(w * 0.4, w * 0.26, h * 0.22);
  tent(w * 0.92, w * 0.2, h * 0.14);

  // Ferris wheel: rim, spokes, cars.
  const wx = w * 0.7;
  const wy = horizon - h * 0.17;
  const wr = h * 0.19;
  ctx.lineWidth = Math.max(1.2, w * 0.004);
  ctx.beginPath();
  ctx.arc(wx, wy, wr, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(wx, wy, wr * 0.16, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(wx, wy);
    ctx.lineTo(wx + Math.cos(a) * wr, wy + Math.sin(a) * wr);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(wx + Math.cos(a) * wr, wy + Math.sin(a) * wr, wr * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }
  // Wheel legs.
  ctx.beginPath();
  ctx.moveTo(wx - wr * 0.55, horizon + h * 0.12);
  ctx.lineTo(wx, wy);
  ctx.lineTo(wx + wr * 0.55, horizon + h * 0.12);
  ctx.stroke();

  // Ground band under everything.
  ctx.fillStyle = 'rgba(4, 2, 1, 0.9)';
  ctx.fillRect(0, horizon + h * 0.1, w, h - horizon);
}

/* ── String lights: sagging wire + incandescent practicals with sockets ── */

export interface BulbString {
  group: THREE.Group;
  bulbs: THREE.Mesh[];
}

/** Tint an incandescent practical: body color + matched warm filament glow. */
export function tintBulb(mat: THREE.MeshStandardMaterial, hex: string): void {
  mat.color.set(hex);
  mat.emissive.set(hex).multiplyScalar(0.55);
  mat.emissiveIntensity = 1;
  mat.roughness = 0.3;
}

/**
 * A sagging run of practicals between two x positions: dark wire tube, brass
 * sockets, and alternating bulb materials (provided by the caller so theme
 * recolor keeps working).
 */
export function buildBulbString(opts: {
  xStart: number;
  xEnd: number;
  yTop: number;
  sag: number;
  z: number;
  count: number;
  bulbMats: THREE.MeshStandardMaterial[];
  socketMat: THREE.MeshStandardMaterial;
  wireMat: THREE.MeshStandardMaterial;
}): BulbString {
  const group = new THREE.Group();
  const { xStart, xEnd, yTop, sag, z, count } = opts;
  const wireY = (u: number) => yTop - Math.sin(u * Math.PI) * sag;

  const wirePoints: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i += 1) {
    const u = i / 24;
    wirePoints.push(new THREE.Vector3(xStart + u * (xEnd - xStart), wireY(u), z));
  }
  const wireCurve = new THREE.CatmullRomCurve3(wirePoints);
  const wire = new THREE.Mesh(
    new THREE.TubeGeometry(wireCurve, 32, 0.014, 5),
    opts.wireMat,
  );
  group.add(wire);

  const bulbGeo = new THREE.SphereGeometry(0.105, 16, 12);
  const socketGeo = new THREE.CylinderGeometry(0.038, 0.05, 0.09, 8);
  const bulbs: THREE.Mesh[] = [];
  for (let i = 0; i < count; i += 1) {
    const u = i / (count - 1);
    const x = xStart + u * (xEnd - xStart);
    const y = wireY(u);
    const socket = new THREE.Mesh(socketGeo, opts.socketMat);
    socket.position.set(x, y - 0.05, z);
    group.add(socket);
    const bulb = new THREE.Mesh(bulbGeo, opts.bulbMats[i % opts.bulbMats.length]);
    bulb.position.set(x, y - 0.19, z);
    group.add(bulb);
    bulbs.push(bulb);
  }
  return { group, bulbs };
}

/**
 * Animate a run of bulbs. `chase` lights one bulb colour at a time around the
 * string; `flicker` is tungsten under load, scaled by `load` (0 to 1). Bulbs
 * share materials by colour, so both act per material. Under reduced motion
 * every bulb holds a steady glow.
 */
export function stepMidwayBulbs(
  bulbs: readonly THREE.Mesh[],
  timeSec: number,
  opts: { mode: 'chase' | 'flicker'; load?: number; stepsPerSecond?: number },
): void {
  const mats: THREE.MeshStandardMaterial[] = [];
  for (const bulb of bulbs) {
    const mat = bulb.material as THREE.MeshStandardMaterial;
    if (!mats.includes(mat)) mats.push(mat);
  }
  if (midwayReducedMotion()) {
    for (const mat of mats) mat.emissiveIntensity = 1;
    return;
  }
  if (opts.mode === 'chase') {
    const lit = Math.floor(timeSec * (opts.stepsPerSecond ?? 6)) % Math.max(1, mats.length);
    mats.forEach((mat, i) => {
      mat.emissiveIntensity = i === lit ? 1.35 : 0.7;
    });
    return;
  }
  const load = Math.min(1, Math.max(0, opts.load ?? 1));
  // Same order as the bulbs, so the last bulb of a colour sets its phase.
  bulbs.forEach((bulb, i) => {
    const mat = bulb.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity = 1 + load * 0.06 * Math.sin(timeSec * 7.3 + i * 1.7);
  });
}

/* ── Short-pile felt (prize beds, baize rails, booth linings) ── */

/**
 * Near-white fibre noise plus a roughness map with slightly matted patches,
 * so felt reads as short pile rather than flat paint. Near-white on purpose:
 * it multiplies the theme colour, so cosmetics keep recolouring the cloth.
 */
export function makeFeltTexture(repeat = 4): WoodTextures {
  const size = 256;
  const albedo = document.createElement('canvas');
  albedo.width = size;
  albedo.height = size;
  const rough = document.createElement('canvas');
  rough.width = size;
  rough.height = size;
  const g = albedo.getContext('2d');
  const r = rough.getContext('2d');
  if (g && r) {
    g.fillStyle = '#f4f1ea';
    g.fillRect(0, 0, size, size);
    r.fillStyle = '#f0f0f0';
    r.fillRect(0, 0, size, size);
    const rng = texRng(0xfe17ed);
    // Short fibres in every direction — the pile itself.
    for (let i = 0; i < 1400; i += 1) {
      const x = rng() * size;
      const y = rng() * size;
      const a = rng() * Math.PI * 2;
      const len = 1.5 + rng() * 3;
      const dark = 0.05 + rng() * 0.1;
      g.strokeStyle = `rgba(46, 34, 22, ${dark.toFixed(3)})`;
      g.lineWidth = 0.7;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      g.stroke();
    }
    // Matted patches where the pile has been crushed flat by prizes.
    for (let i = 0; i < 18; i += 1) {
      const px = rng() * size;
      const py = rng() * size;
      const pr = 8 + rng() * 26;
      const grad = r.createRadialGradient(px, py, 0, px, py, pr);
      grad.addColorStop(0, 'rgba(150, 150, 150, 0.45)');
      grad.addColorStop(1, 'rgba(150, 150, 150, 0)');
      r.fillStyle = grad;
      r.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    }
  }
  const map = new THREE.CanvasTexture(albedo);
  map.colorSpace = THREE.SRGBColorSpace;
  const roughnessMap = new THREE.CanvasTexture(rough);
  for (const tex of [map, roughnessMap]) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
    tex.anisotropy = 4;
  }
  return { map, roughnessMap };
}

/* ── Cabinet glazing ── */

/**
 * Cabinet glass. `front: true` gives the one expensive pane the player looks
 * through — real transmission, so brass and prizes refract behind it. Side and
 * back panes should use `front: false`, which is a cheap tinted standard
 * material: four transmissive panes would cost far more than they show.
 * `renderOrder = 10` on the transmissive pane keeps it drawing last.
 */
export function makeGlassMaterial(front: boolean): THREE.Material {
  if (!front) {
    return new THREE.MeshStandardMaterial({
      color: '#cfe4ef',
      transparent: true,
      opacity: 0.12,
      roughness: 0.12,
      metalness: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  }
  return new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    transmission: 0.92,
    roughness: 0.06,
    thickness: 0.02,
    ior: 1.5,
    metalness: 0,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

/* ── Soft radial disc (contact shadows, dust motes) ── */

export function makeSoftDiscTexture(size = 128): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    );
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A hot ember: bright core, quick falloff, and two faint cross rays. Used for
 * the strike sparks — small, warm and short-lived, never a bloom sheet.
 */
export function makeSparkTexture(size = 64): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const c = size / 2;
    const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.28, 'rgba(255,226,160,0.85)');
    grad.addColorStop(0.6, 'rgba(255,150,50,0.28)');
    grad.addColorStop(1, 'rgba(255,120,30,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(255, 232, 186, 0.30)';
    ctx.lineWidth = Math.max(1, size * 0.03);
    ctx.beginPath();
    ctx.moveTo(c - size * 0.4, c);
    ctx.lineTo(c + size * 0.4, c);
    ctx.moveTo(c, c - size * 0.4);
    ctx.lineTo(c, c + size * 0.4);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ── Pooled billboard particles (dust, sparks, enamel chips) ── */

export interface SpriteParticle {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  /** Seconds alive, and the lifetime it dies at. */
  life: number;
  ttl: number;
  /** Base scale, how much it grows over its life, and its peak opacity. */
  size: number;
  grow: number;
  fade: number;
  active: boolean;
}

/**
 * Build a fixed-size pool. Geometry and (optionally) the texture are shared
 * across the pool; only the per-particle material differs, because each one
 * fades on its own clock. Nothing is allocated again after this call.
 */
export function makeSpriteParticlePool(opts: {
  scene: THREE.Scene;
  count: number;
  texture?: THREE.Texture | null;
  colors: string[];
  size?: number;
  blending?: THREE.Blending;
}): SpriteParticle[] {
  const geo = new THREE.PlaneGeometry(opts.size ?? 0.2, opts.size ?? 0.2);
  const pool: SpriteParticle[] = [];
  for (let i = 0; i < opts.count; i += 1) {
    const mat = new THREE.MeshBasicMaterial({
      map: opts.texture ?? null,
      color: opts.colors[i % opts.colors.length],
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: opts.blending ?? THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    opts.scene.add(mesh);
    pool.push({
      mesh,
      mat,
      vx: 0,
      vy: 0,
      vz: 0,
      spin: 0,
      life: 0,
      ttl: 1,
      size: 1,
      grow: 0,
      fade: 1,
      active: false,
    });
  }
  return pool;
}

/** Wake up to `count` idle particles. Silently emits fewer if the pool is busy. */
export function emitSpriteParticles(
  pool: SpriteParticle[],
  count: number,
  cfg: {
    origin: [number, number, number];
    spread?: number;
    /** Horizontal speed range and vertical speed range. */
    speed: [number, number];
    up: [number, number];
    ttl: [number, number];
    size: [number, number];
    grow?: number;
    fade?: number;
    spin?: number;
    /** Bias the horizontal burst toward one axis-aligned fan (radians). */
    coneAt?: number;
    coneWidth?: number;
    /** Atmosphere rather than a response to input. Skipped under reduced motion. */
    ambient?: boolean;
  },
): void {
  if (cfg.ambient && midwayReducedMotion()) return;
  let emitted = 0;
  for (const p of pool) {
    if (emitted >= count) break;
    if (p.active) continue;
    emitted += 1;
    const a =
      cfg.coneAt === undefined
        ? Math.random() * Math.PI * 2
        : cfg.coneAt + (Math.random() - 0.5) * (cfg.coneWidth ?? Math.PI / 2);
    const speed = cfg.speed[0] + Math.random() * (cfg.speed[1] - cfg.speed[0]);
    const spread = cfg.spread ?? 0;
    p.vx = Math.cos(a) * speed;
    p.vz = Math.sin(a) * speed * 0.55;
    p.vy = cfg.up[0] + Math.random() * (cfg.up[1] - cfg.up[0]);
    p.spin = (Math.random() - 0.5) * (cfg.spin ?? 0);
    p.life = 0;
    p.ttl = cfg.ttl[0] + Math.random() * (cfg.ttl[1] - cfg.ttl[0]);
    p.size = cfg.size[0] + Math.random() * (cfg.size[1] - cfg.size[0]);
    p.grow = cfg.grow ?? 0;
    p.fade = cfg.fade ?? 1;
    p.active = true;
    p.mesh.position.set(
      cfg.origin[0] + (Math.random() - 0.5) * spread,
      cfg.origin[1] + (Math.random() - 0.5) * spread * 0.5,
      cfg.origin[2] + (Math.random() - 0.5) * spread,
    );
    p.mesh.rotation.set(0, 0, Math.random() * Math.PI);
    p.mesh.scale.set(p.size, p.size, 1);
    p.mat.opacity = p.fade;
    p.mesh.visible = true;
  }
}

/** Integrate one frame of a pool. Allocation-free; safe to call every frame. */
export function stepSpriteParticles(
  pool: SpriteParticle[],
  dt: number,
  gravity: number,
  drag = 0,
): void {
  const damp = drag > 0 ? Math.exp(-drag * dt) : 1;
  for (const p of pool) {
    if (!p.active) continue;
    p.life += dt;
    if (p.life >= p.ttl) {
      p.active = false;
      p.mesh.visible = false;
      p.mat.opacity = 0;
      continue;
    }
    p.vy -= gravity * dt;
    if (drag > 0) {
      p.vx *= damp;
      p.vy *= damp;
      p.vz *= damp;
    }
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;
    p.mesh.rotation.z += p.spin * dt;
    const k = p.life / p.ttl;
    p.mat.opacity = p.fade * (1 - k * k);
    const grow = p.size * (1 + k * p.grow);
    p.mesh.scale.set(grow, grow, 1);
  }
}

/** Park every particle (run reset, context loss, reduced motion). */
export function resetSpriteParticles(pool: SpriteParticle[]): void {
  for (const p of pool) {
    p.active = false;
    p.mesh.visible = false;
    p.mat.opacity = 0;
  }
}

/* ── Frame-rate independent easing ── */

/** Exponential damp toward a target: correct at any frame rate. */
export function expDamp(
  current: number,
  target: number,
  rate: number,
  dt: number,
): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/* ── Deep disposal: geometries, materials AND their textures ── */

export function disposeSceneDeep(scene: THREE.Scene): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry && !geometries.has(mesh.geometry)) {
      geometries.add(mesh.geometry);
      mesh.geometry.dispose();
    }
    const mats = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const mat of mats) {
      if (materials.has(mat)) continue;
      materials.add(mat);
      const record = mat as unknown as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        const value = record[key];
        if (value instanceof THREE.Texture && !textures.has(value)) {
          textures.add(value);
          value.dispose();
        }
      }
      mat.dispose();
    }
  });
  scene.clear();
}
