'use client';

/**
 * Derby Royale — the living diorama.
 *
 * One persistent three.js scene that carries every phase of the round loop:
 *   betting  → warm paddock parade under the marquee lights
 *   locked   → the gate rises from the infield machinery, horses load in
 *   racing   → deterministic playback of the server race script with a
 *              broadcast-style camera director (cuts, not lerps)
 *   results  → winner's circle: podium spotlight, confetti, marquee strobe
 *
 * The scene is render-only. Race positions come exclusively from the signed
 * server script via sampleScriptChannel — nothing here can change an outcome.
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import {
  createAdaptiveGameQuality,
  createGameFrameLoop,
  gameCanvasDpr,
} from '@/features/arcade/lib/game-frame-loop';
import {
  DERBY_HORSES,
  DERBY_HORSE_COUNT,
  sampleScriptChannel,
  type DerbyPhase,
  type RaceScript,
} from '@/server/arcade/derby/derby-shared';

export type DerbySceneTick = {
  raceMs: number;
  /** per-horse track progress 0..1 */
  u: number[];
  /** horse indices best-first among unfinished+finished (render order) */
  order: number[];
  leader: number;
  finished: boolean;
};

type DerbySceneProps = {
  phase: DerbyPhase;
  script: RaceScript | null;
  /** Date.now()-epoch ms (already server-offset corrected) when the race started/starts */
  raceStartAtMs: number | null;
  winnerIdx: number | null;
  /** horses the local player has tickets on (gets a rosette above the horse) */
  myHorseIdxs: number[];
  onTick?: (tick: DerbySceneTick) => void;
  /** fires once per race as the winner hits the wire; dataUrl only on photo finishes */
  onWinnerCross?: (photoDataUrl: string | null, photoFinish: boolean) => void;
};

/* ── palette (poster-derived boardwalk enamel) ─────────────────────────── */
const P = {
  walnut: 0x2b1c12,
  walnutDeep: 0x1d1209,
  oak: 0x9a713f,
  oakLight: 0xb98a52,
  cream: 0xf2e3c6,
  red: 0xc6483c,
  teal: 0x2e7f74,
  gold: 0xd99a2b,
  brass: 0xb8834a,
  bulbOn: 0xffd98a,
  bulbOff: 0x4a3623,
} as const;

/* ── track geometry: stadium oval, arc-length parametrized ─────────────── */
const STRAIGHT = 26; // half-length of each straight
const TURN_R = 15; // centerline radius of each turn (inner rail)
const LANE_W = 1.35;
const LANE_COUNT = DERBY_HORSE_COUNT;
const TRACK_W = LANE_COUNT * LANE_W;
const SEG_S = STRAIGHT * 2;
const SEG_C = Math.PI * TURN_R;
const PERIM = 2 * SEG_S + 2 * SEG_C;

/** inner-rail point + travel tangent at progress u (0 = start/finish line). */
function pathPoint(u: number, out: { x: number; z: number; tx: number; tz: number }) {
  let d = ((u % 1) + 1) % 1 * PERIM;
  // home straight (+x travel) at z = +TURN_R, from x=-STRAIGHT
  if (d < SEG_S) {
    out.x = -STRAIGHT + d;
    out.z = TURN_R;
    out.tx = 1;
    out.tz = 0;
    return;
  }
  d -= SEG_S;
  if (d < SEG_C) {
    const a = Math.PI / 2 - d / TURN_R; // from +90° toward -90°
    out.x = STRAIGHT + Math.cos(a) * TURN_R;
    out.z = Math.sin(a) * TURN_R;
    out.tx = Math.sin(a);
    out.tz = -Math.cos(a);
    return;
  }
  d -= SEG_C;
  if (d < SEG_S) {
    out.x = STRAIGHT - d;
    out.z = -TURN_R;
    out.tx = -1;
    out.tz = 0;
    return;
  }
  d -= SEG_S;
  const a = -Math.PI / 2 - d / TURN_R;
  out.x = -STRAIGHT + Math.cos(a) * TURN_R;
  out.z = Math.sin(a) * TURN_R;
  out.tx = Math.sin(a);
  out.tz = -Math.cos(a);
}

/** world position for a horse: lane center + cosmetic drift, y=0. */
function lanePos(u: number, lane: number, drift: number, out: THREE.Vector3, heading?: { x: number; z: number }) {
  const p = { x: 0, z: 0, tx: 0, tz: 0 };
  pathPoint(u, p);
  // outward normal = rotate tangent +90° in xz for this winding
  const nx = -p.tz;
  const nz = p.tx;
  const off = (lane + 0.5 + drift * 0.32) * LANE_W;
  out.set(p.x + nx * off, 0, p.z + nz * off);
  if (heading) {
    heading.x = p.tx;
    heading.z = p.tz;
  }
}

/* ── toy horse factory ─────────────────────────────────────────────────── */

type ToyHorse = {
  group: THREE.Group;
  rocker: THREE.Group; // gallop rocking pivot
  legsFront: THREE.Group;
  legsHind: THREE.Group;
  rosette: THREE.Mesh;
  gallopPhase: number;
};

const sharedGeo = {
  body: new THREE.CapsuleGeometry(0.42, 0.85, 6, 12),
  neck: new THREE.CylinderGeometry(0.16, 0.24, 0.72, 10),
  head: new THREE.CapsuleGeometry(0.17, 0.34, 5, 10),
  ear: new THREE.ConeGeometry(0.06, 0.16, 6),
  leg: new THREE.CylinderGeometry(0.07, 0.055, 0.68, 8),
  hoof: new THREE.CylinderGeometry(0.075, 0.08, 0.09, 8),
  mane: new THREE.BoxGeometry(0.08, 0.5, 0.34),
  tail: new THREE.ConeGeometry(0.09, 0.5, 8),
  saddle: new THREE.BoxGeometry(0.5, 0.1, 0.42),
  jockeyTorso: new THREE.CapsuleGeometry(0.16, 0.24, 5, 10),
  jockeyHead: new THREE.SphereGeometry(0.13, 10, 8),
  cap: new THREE.SphereGeometry(0.14, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
  brim: new THREE.CylinderGeometry(0.15, 0.15, 0.03, 10, 1, false, 0, Math.PI),
  wheel: new THREE.CylinderGeometry(0.09, 0.09, 0.05, 10),
  base: new THREE.BoxGeometry(1.5, 0.08, 0.5),
  shadow: new THREE.CircleGeometry(0.85, 20),
  rosette: new THREE.CircleGeometry(0.16, 12),
};

function enamel(color: number | string, roughness = 0.35): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.08 });
}

function buildToyHorse(idx: number): ToyHorse {
  const spec = DERBY_HORSES[idx];
  const coat = enamel(spec.coat);
  const silk = enamel(spec.silks[0], 0.3);
  const silkAccent = enamel(spec.silks[1], 0.3);
  const brassMat = new THREE.MeshStandardMaterial({ color: P.brass, roughness: 0.35, metalness: 0.75 });
  const darkWood = enamel(P.walnut, 0.6);

  const group = new THREE.Group();
  const rocker = new THREE.Group();
  group.add(rocker);

  const body = new THREE.Mesh(sharedGeo.body, coat);
  body.rotation.z = Math.PI / 2;
  body.position.y = 0.95;
  rocker.add(body);

  const neck = new THREE.Mesh(sharedGeo.neck, coat);
  neck.position.set(0.62, 1.28, 0);
  neck.rotation.z = -0.55;
  rocker.add(neck);

  const head = new THREE.Mesh(sharedGeo.head, coat);
  head.position.set(0.94, 1.52, 0);
  head.rotation.z = Math.PI / 2 - 0.9;
  rocker.add(head);

  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(sharedGeo.ear, darkWood);
    ear.position.set(0.88, 1.74, 0.08 * s);
    ear.rotation.z = -0.2;
    rocker.add(ear);
  }

  const mane = new THREE.Mesh(sharedGeo.mane, silkAccent);
  mane.position.set(0.52, 1.42, 0);
  mane.rotation.z = -0.5;
  rocker.add(mane);

  const tail = new THREE.Mesh(sharedGeo.tail, silkAccent);
  tail.position.set(-0.78, 1.05, 0);
  tail.rotation.z = Math.PI / 2 + 0.5;
  rocker.add(tail);

  // legs: rigid pairs on hip pivots — rocking-horse gallop
  const legsFront = new THREE.Group();
  legsFront.position.set(0.42, 0.78, 0);
  const legsHind = new THREE.Group();
  legsHind.position.set(-0.42, 0.78, 0);
  for (const s of [-1, 1]) {
    for (const [grp, lean] of [[legsFront, 0.35], [legsHind, -0.4]] as const) {
      const leg = new THREE.Mesh(sharedGeo.leg, coat);
      leg.position.set(0, -0.3, 0.2 * s);
      leg.rotation.z = lean;
      const hoof = new THREE.Mesh(sharedGeo.hoof, darkWood);
      hoof.position.y = -0.36;
      leg.add(hoof);
      grp.add(leg);
    }
  }
  rocker.add(legsFront, legsHind);

  // jockey crouched over the neck
  const torso = new THREE.Mesh(sharedGeo.jockeyTorso, silk);
  torso.position.set(0.18, 1.62, 0);
  torso.rotation.z = 0.8;
  rocker.add(torso);
  const jHead = new THREE.Mesh(sharedGeo.jockeyHead, enamel(0xe8c39a, 0.5));
  jHead.position.set(0.4, 1.78, 0);
  rocker.add(jHead);
  const cap = new THREE.Mesh(sharedGeo.cap, silkAccent);
  cap.position.set(0.4, 1.82, 0);
  rocker.add(cap);
  const brim = new THREE.Mesh(sharedGeo.brim, silkAccent);
  brim.position.set(0.46, 1.83, 0);
  brim.rotation.set(0, Math.PI / 2, 0.15);
  rocker.add(brim);
  const saddle = new THREE.Mesh(sharedGeo.saddle, silkAccent);
  saddle.position.set(0.05, 1.28, 0);
  rocker.add(saddle);

  // the toy tell: brass wheels + a painted base plank
  const base = new THREE.Mesh(sharedGeo.base, darkWood);
  base.position.y = 0.14;
  rocker.add(base);
  for (const sx of [-0.55, 0.55]) {
    for (const sz of [-0.18, 0.18]) {
      const wheel = new THREE.Mesh(sharedGeo.wheel, brassMat);
      wheel.position.set(sx, 0.09, sz);
      wheel.rotation.x = Math.PI / 2;
      rocker.add(wheel);
    }
  }

  // blob shadow (cheaper + more toy-like than shadow maps)
  const shadow = new THREE.Mesh(
    sharedGeo.shadow,
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  group.add(shadow);

  // "my ticket" rosette
  const rosette = new THREE.Mesh(
    sharedGeo.rosette,
    new THREE.MeshBasicMaterial({ color: P.gold, transparent: true, opacity: 0.95, side: THREE.DoubleSide }),
  );
  rosette.position.y = 2.35;
  rosette.visible = false;
  group.add(rosette);

  return { group, rocker, legsFront, legsHind, rosette, gallopPhase: Math.random() * Math.PI * 2 };
}

/* ── track surface painted as a canvas texture (hand-drawn boardwalk) ──── */

const WORLD_W = 110;
const WORLD_H = 70;

function paintTrackTexture(): THREE.CanvasTexture {
  const cw = 2048;
  const ch = Math.round((cw * WORLD_H) / WORLD_W);
  const cv = document.createElement('canvas');
  cv.width = cw;
  cv.height = ch;
  const g = cv.getContext('2d')!;
  const sx = cw / WORLD_W;
  const sy = ch / WORLD_H;
  const X = (wx: number) => (wx + WORLD_W / 2) * sx;
  const Y = (wz: number) => (wz + WORLD_H / 2) * sy;

  // walnut floor with subtle plank grain
  g.fillStyle = '#221509';
  g.fillRect(0, 0, cw, ch);
  g.globalAlpha = 0.14;
  for (let i = 0; i < 60; i++) {
    g.fillStyle = i % 2 ? '#2b1c12' : '#1a0f07';
    g.fillRect(0, (i * ch) / 60, cw, ch / 120);
  }
  g.globalAlpha = 1;

  const ovalPath = (railOffset: number) => {
    const r = TURN_R + railOffset;
    g.beginPath();
    g.moveTo(X(-STRAIGHT), Y(r));
    g.lineTo(X(STRAIGHT), Y(r));
    g.arc(X(STRAIGHT), Y(0), r * sy, Math.PI / 2, -Math.PI / 2, true);
    g.lineTo(X(-STRAIGHT), Y(-r));
    g.arc(X(-STRAIGHT), Y(0), r * sy, -Math.PI / 2, Math.PI / 2, true);
    g.closePath();
  };

  // NOTE: canvas arc radius uses sy — the world is anisotropic (sx≠sy) only by
  // rounding; WORLD_W/H were chosen so sx≈sy and the ovals stay circular.

  // track band (oak) between inner rail (offset 0) and outer rail (offset TRACK_W)
  ovalPath(TRACK_W + 0.6);
  g.fillStyle = '#8a6236';
  g.fill();
  ovalPath(-0.6);
  g.fillStyle = '#2e1d10';
  g.fill();

  // lane dividers
  g.strokeStyle = 'rgba(38, 24, 12, 0.55)';
  g.lineWidth = Math.max(2, 0.09 * sx);
  for (let lane = 1; lane < LANE_COUNT; lane++) {
    ovalPath(lane * LANE_W);
    g.stroke();
  }
  // rails trim
  g.lineWidth = 0.28 * sx;
  g.strokeStyle = '#f2e3c6';
  ovalPath(0);
  g.stroke();
  ovalPath(TRACK_W);
  g.stroke();
  g.lineWidth = 0.1 * sx;
  g.strokeStyle = '#c6483c';
  ovalPath(-0.35);
  g.stroke();
  ovalPath(TRACK_W + 0.35);
  g.stroke();

  // checkered start/finish strip across the home straight at x = -STRAIGHT
  const stripX = X(-STRAIGHT);
  const stripW = 1.6 * sx;
  const cells = 8;
  const cellH = (TRACK_W * sy) / cells;
  for (let col = 0; col < 2; col++) {
    for (let row = 0; row < cells; row++) {
      g.fillStyle = (row + col) % 2 ? '#241812' : '#f2e3c6';
      g.fillRect(stripX + col * (stripW / 2), Y(TURN_R) + row * cellH, stripW / 2, cellH);
    }
  }

  // infield deco: double pinstripe + lettering
  g.strokeStyle = 'rgba(217, 154, 43, 0.5)';
  g.lineWidth = 0.12 * sx;
  ovalPath(-1.4);
  g.stroke();
  g.strokeStyle = 'rgba(46, 127, 116, 0.45)';
  ovalPath(-2.0);
  g.stroke();
  // infield lettering, once for each straight so it reads from both sides
  g.fillStyle = 'rgba(242, 227, 198, 0.16)';
  g.font = `700 ${5.5 * sy}px Georgia, serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('DERBY ROYALE', X(0), Y(7));
  g.save();
  g.translate(X(0), Y(-7));
  g.rotate(Math.PI);
  g.fillText('DERBY ROYALE', 0, 0);
  g.restore();

  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeTextBoard(text: string, w: number, h: number, opts?: { sub?: string; bg?: string; fg?: string }): THREE.Mesh {
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = Math.round((1024 * h) / w);
  const g = cv.getContext('2d')!;
  g.fillStyle = opts?.bg ?? '#241812';
  g.fillRect(0, 0, cv.width, cv.height);
  g.strokeStyle = '#d99a2b';
  g.lineWidth = cv.height * 0.06;
  g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, cv.width - g.lineWidth, cv.height - g.lineWidth);
  g.fillStyle = opts?.fg ?? '#f2e3c6';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${cv.height * (opts?.sub ? 0.34 : 0.44)}px Georgia, serif`;
  g.fillText(text, cv.width / 2, cv.height * (opts?.sub ? 0.36 : 0.5));
  if (opts?.sub) {
    g.font = `600 ${cv.height * 0.2}px Georgia, serif`;
    g.fillStyle = '#d99a2b';
    g.fillText(opts.sub, cv.width / 2, cv.height * 0.72);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: false }),
  );
  return mesh;
}

/* ── camera director ───────────────────────────────────────────────────── */

type ShotId = 'parade' | 'gates' | 'break' | 'chase' | 'backTrack' | 'drone' | 'home' | 'finish' | 'podium';

/**
 * Broadcast shot plan: the side-on pan is the workhorse (real TV coverage is
 * dominated by one inside-rail tracking camera); cuts land on race beats and
 * NEVER in the final stretch — the head-on holds through the wire, and the
 * cut to 'finish' fires only when the winner crosses.
 */
function shotForLeader(u: number): ShotId {
  if (u < 0.05) return 'break';
  if (u < 0.2) return 'chase';
  if (u < 0.58) return 'backTrack';
  if (u < 0.68) return 'drone';
  return 'home';
}

const SHOT_FOV: Record<ShotId, number> = {
  parade: 44,
  gates: 38,
  break: 50,
  chase: 46,
  backTrack: 42,
  drone: 55,
  home: 26,
  finish: 46,
  podium: 40,
};

/* ── component ─────────────────────────────────────────────────────────── */

export default function DerbyScene({
  phase,
  script,
  raceStartAtMs,
  winnerIdx,
  myHorseIdxs,
  onTick,
  onWinnerCross,
}: DerbySceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const propsRef = useRef({ phase, script, raceStartAtMs, winnerIdx, myHorseIdxs, onTick, onWinnerCross });
  propsRef.current = { phase, script, raceStartAtMs, winnerIdx, myHorseIdxs, onTick, onWinnerCross };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(gameCanvasDpr(window.innerWidth, window.innerHeight));
    renderer.shadowMap.enabled = false;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.16;

    let reducedMotion = false;
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const updateMotion = () => {
      reducedMotion = !!mq?.matches;
    };
    updateMotion();
    mq?.addEventListener('change', updateMotion);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(P.walnutDeep);
    scene.fog = new THREE.Fog(P.walnutDeep, 55, 130);

    const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 300);
    camera.position.set(0, 26, 52);
    camera.lookAt(0, 0, 0);

    /* lights: warm carnival night */
    scene.add(new THREE.AmbientLight(0x8a6a48, 0.8));
    const key = new THREE.DirectionalLight(0xffe1b0, 1.75);
    key.position.set(-30, 45, 25);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x6a8a8a, 0.5);
    fill.position.set(35, 30, -30);
    scene.add(fill);
    const podiumSpot = new THREE.SpotLight(0xffe6b8, 0, 60, 0.35, 0.45, 1.2);
    podiumSpot.position.set(-STRAIGHT + 4, 22, 8);
    scene.add(podiumSpot, podiumSpot.target);

    /* ground + painted track */
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_W, WORLD_H),
      new THREE.MeshStandardMaterial({ map: paintTrackTexture(), roughness: 0.85, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // far apron so the fog has something to eat
    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: P.walnutDeep, roughness: 1 }),
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.05;
    scene.add(apron);

    /* rails: instanced posts + tube rails along both edges */
    const postGeo = new THREE.CylinderGeometry(0.09, 0.11, 1.05, 8);
    const postMat = enamel(P.cream, 0.5);
    const POSTS = 72;
    for (const off of [-0.6, TRACK_W + 0.6]) {
      const posts = new THREE.InstancedMesh(postGeo, postMat, POSTS);
      const m4 = new THREE.Matrix4();
      const pp = { x: 0, z: 0, tx: 0, tz: 0 };
      for (let i = 0; i < POSTS; i++) {
        pathPoint(i / POSTS, pp);
        const nx = -pp.tz;
        const nz = pp.tx;
        m4.setPosition(pp.x + nx * off, 0.5, pp.z + nz * off);
        posts.setMatrixAt(i, m4);
      }
      posts.instanceMatrix.needsUpdate = true;
      scene.add(posts);

      const railPts: THREE.Vector3[] = [];
      for (let i = 0; i <= 96; i++) {
        pathPoint(i / 96, pp);
        railPts.push(new THREE.Vector3(pp.x + -pp.tz * off, 1.02, pp.z + pp.tx * off));
      }
      const rail = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railPts, true), 128, 0.06, 6, true),
        enamel(P.cream, 0.45),
      );
      scene.add(rail);
    }

    /* grandstand: tiered walnut benches + enamel crowd on the far side */
    const standGroup = new THREE.Group();
    const benchGeo = new THREE.BoxGeometry(60, 1.1, 2.4);
    for (let tier = 0; tier < 4; tier++) {
      const bench = new THREE.Mesh(benchGeo, enamel(tier % 2 ? P.walnut : 0x352418, 0.7));
      bench.position.set(0, 0.55 + tier * 1.25, -TURN_R - TRACK_W - 5.5 - tier * 2.4);
      standGroup.add(bench);
    }
    scene.add(standGroup);

    const CROWD = 420;
    const crowdGeo = new THREE.SphereGeometry(0.32, 8, 6);
    const crowdMat = new THREE.MeshStandardMaterial({ roughness: 0.5 });
    const crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, CROWD);
    const crowdBase: { x: number; y: number; z: number; phase: number; amp: number }[] = [];
    {
      const colors = [P.cream, P.red, P.teal, P.gold, P.brass, 0xa05c3b];
      const c = new THREE.Color();
      const m4 = new THREE.Matrix4();
      for (let i = 0; i < CROWD; i++) {
        const tier = Math.floor(Math.random() * 4);
        const seat = {
          x: -29 + Math.random() * 58,
          y: 1.35 + tier * 1.25,
          z: -TURN_R - TRACK_W - 5.5 - tier * 2.4 + (Math.random() - 0.5) * 1.4,
          phase: Math.random() * Math.PI * 2,
          amp: 0.1 + Math.random() * 0.25,
        };
        crowdBase.push(seat);
        m4.setPosition(seat.x, seat.y, seat.z);
        crowd.setMatrixAt(i, m4);
        crowd.setColorAt(i, c.setHex(colors[Math.floor(Math.random() * colors.length)]));
      }
      crowd.instanceMatrix.needsUpdate = true;
      if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
    }
    scene.add(crowd);

    /* marquee arch over the finish line */
    const finishAnchor = { x: 0, z: 0, tx: 0, tz: 0 };
    pathPoint(0, finishAnchor);
    const marquee = new THREE.Group();
    marquee.position.set(finishAnchor.x, 0, finishAnchor.z + TRACK_W / 2 + 0.5);
    marquee.rotation.y = Math.PI / 2; // arch spans across the home straight (x = const plane)
    // Cantilever: one pillar on the OUTER side only, sign arm over the track —
    // no infield structure means no camera angle can be blocked by it.
    // (local +x maps to world −z after the π/2 yaw, so s = −1 is the outer side)
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.3, 8.5, 1.3), enamel(P.walnut, 0.6));
    pillar.position.set(-(TRACK_W / 2 + 1.6), 4.25, 0);
    marquee.add(pillar);
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.4, 0.35), enamel(P.brass, 0.45));
    brace.position.set(-(TRACK_W / 2 - 1.4), 7.6, 0);
    brace.rotation.z = -0.7;
    marquee.add(brace);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(TRACK_W + 5, 2.2, 1.1), enamel(P.walnut, 0.6));
    lintel.position.y = 9.4;
    marquee.add(lintel);
    const sign = makeTextBoard('DERBY ROYALE', TRACK_W + 3.4, 1.7);
    sign.position.set(0, 9.4, 0.58);
    marquee.add(sign);
    const signBack = makeTextBoard('FINISH', TRACK_W + 3.4, 1.7, { fg: '#c6483c' });
    signBack.position.set(0, 9.4, -0.58);
    signBack.rotation.y = Math.PI;
    marquee.add(signBack);

    // chase bulbs around the lintel
    const BULBS = 34;
    const bulbGeo = new THREE.SphereGeometry(0.14, 8, 6);
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, BULBS);
    {
      const m4 = new THREE.Matrix4();
      for (let i = 0; i < BULBS; i++) {
        const t = i / (BULBS - 1);
        const bx = (t - 0.5) * (TRACK_W + 4.6);
        const by = 10.7 + Math.sin(t * Math.PI) * 1.5;
        m4.setPosition(bx, by, 0.3);
        bulbs.setMatrixAt(i, m4);
      }
      bulbs.instanceMatrix.needsUpdate = true;
    }
    marquee.add(bulbs);
    scene.add(marquee);

    // finish wire
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, TRACK_W + 2, 6), enamel(P.red, 0.4));
    wire.rotation.z = Math.PI / 2;
    wire.rotation.y = Math.PI / 2;
    wire.position.set(finishAnchor.x, 3.1, finishAnchor.z + TRACK_W / 2 + 0.5);
    scene.add(wire);

    /* starting gate: mechanical, rises from the floor for the load-in */
    const gate = new THREE.Group();
    const gateAnchor = { x: 0, z: 0, tx: 0, tz: 0 };
    pathPoint(0.012, gateAnchor);
    gate.position.set(gateAnchor.x, -6, gateAnchor.z + TRACK_W / 2);
    // open cage: top beam + end legs + per-lane dividers, low front doors so
    // the horses and silks stay visible while loaded
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.55, TRACK_W + 1), enamel(P.teal, 0.5));
    beam.position.y = 3.05;
    gate.add(beam);
    const legGeo = new THREE.BoxGeometry(0.35, 3.1, 0.35);
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, enamel(P.teal, 0.5));
      leg.position.set(0, 1.55, s * (TRACK_W / 2 + 0.4));
      gate.add(leg);
    }
    const dividerGeo = new THREE.BoxGeometry(2.2, 1.9, 0.07);
    for (let i = 0; i <= LANE_COUNT; i++) {
      const divider = new THREE.Mesh(dividerGeo, enamel(P.brass, 0.5));
      divider.position.set(-0.4, 1.35, -TRACK_W / 2 + i * LANE_W);
      gate.add(divider);
    }
    const stallDoors: THREE.Mesh[] = [];
    const doorGeo = new THREE.BoxGeometry(0.09, 1.45, LANE_W * 0.92);
    for (let i = 0; i < LANE_COUNT; i++) {
      const door = new THREE.Mesh(doorGeo, enamel(i % 2 ? P.cream : P.gold, 0.4));
      door.position.set(0.72, 0.95, -TRACK_W / 2 + (i + 0.5) * LANE_W);
      gate.add(door);
      stallDoors.push(door);
    }
    const gateSign = makeTextBoard('POST TIME', 6, 1.1, { bg: '#2e7f74' });
    gateSign.position.set(0, 4, 0);
    gateSign.rotation.y = Math.PI / 2;
    gate.add(gateSign);
    scene.add(gate);

    /* winner podium in the infield near the wire */
    const podium = new THREE.Group();
    podium.position.set(finishAnchor.x + 3, 0, finishAnchor.z - 7);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3, 0.9, 24), enamel(P.walnut, 0.55));
    drum.position.y = 0.45;
    podium.add(drum);
    const drumTrim = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.09, 8, 32), enamel(P.gold, 0.3));
    drumTrim.rotation.x = Math.PI / 2;
    drumTrim.position.y = 0.92;
    podium.add(drumTrim);
    const winnerBoard = makeTextBoard('WINNER', 7.5, 1.6);
    winnerBoard.position.set(0, 6.3, -3.6);
    podium.add(winnerBoard);
    podium.visible = false;
    scene.add(podium);

    /* horses */
    const horses: ToyHorse[] = [];
    for (let i = 0; i < DERBY_HORSE_COUNT; i++) {
      const h = buildToyHorse(i);
      scene.add(h.group);
      horses.push(h);
    }

    /* dust puffs (instanced, scale-animated) */
    const DUST = 56;
    const dustGeo = new THREE.SphereGeometry(0.16, 6, 5);
    const dustMat = new THREE.MeshBasicMaterial({ color: 0x8a6a48, transparent: true, opacity: 0.32, depthWrite: false });
    const dust = new THREE.InstancedMesh(dustGeo, dustMat, DUST);
    const dustState = Array.from({ length: DUST }, () => ({ x: 0, y: -10, z: 0, vy: 0, life: 0 }));
    dust.frustumCulled = false;
    scene.add(dust);
    let dustCursor = 0;

    /* confetti */
    const CONF = 260;
    const confGeo = new THREE.PlaneGeometry(0.22, 0.34);
    const confMat = new THREE.MeshBasicMaterial({ vertexColors: false, side: THREE.DoubleSide });
    const confetti = new THREE.InstancedMesh(confGeo, confMat, CONF);
    const confState = Array.from({ length: CONF }, () => ({
      x: 0, y: -20, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, rz: 0, srx: 0, srz: 0, live: false,
    }));
    {
      const c = new THREE.Color();
      const palette = [P.red, P.teal, P.gold, P.cream];
      const hideM4 = new THREE.Matrix4().setPosition(0, -30, 0);
      for (let i = 0; i < CONF; i++) {
        confetti.setColorAt(i, c.setHex(palette[i % palette.length]));
        confetti.setMatrixAt(i, hideM4); // parked below ground until a celebration
      }
      confetti.instanceMatrix.needsUpdate = true;
      if (confetti.instanceColor) confetti.instanceColor.needsUpdate = true;
    }
    confetti.frustumCulled = false;
    scene.add(confetti);

    /* ── per-frame state ── */
    const tmpV = new THREE.Vector3();
    const tmpV2 = new THREE.Vector3();
    const tmpHead = { x: 0, z: 0 };
    const camPos = new THREE.Vector3(0, 26, 52);
    const camTarget = new THREE.Vector3(0, 0, 0);
    const camPosGoal = new THREE.Vector3();
    const camTargetGoal = new THREE.Vector3();
    let currentShot: ShotId = 'parade';
    let shotStartedAt = 0;
    let lastPhase: DerbyPhase | null = null;
    const paradeOffset = Math.random();
    let gateY = -6;
    let doorOpen = 0;
    let shakeUntil = 0;
    let winnerCrossed = false;
    let celebrationT = 0;
    const horseU = new Array(DERBY_HORSE_COUNT).fill(0);
    const horseDrift = new Array(DERBY_HORSE_COUNT).fill(0);
    let lastTickAt = 0;
    const adaptiveQuality = createAdaptiveGameQuality();

    const m4 = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3(1, 1, 1);
    const eul = new THREE.Euler();

    function cutTo(shot: ShotId, now: number) {
      if (shot === currentShot) return;
      currentShot = shot;
      shotStartedAt = now;
      camera.fov = SHOT_FOV[shot];
      camera.updateProjectionMatrix();
      // hard cut: snap position on the next placement (director sets goals; we
      // copy instantly on cut, then damp within the shot)
      camPos.copy(camPosGoal);
      camTarget.copy(camTargetGoal);
    }

    /** Broadcast framing anchor: just behind the leader, so the front of the
     * field fills the frame (TV convention) instead of the pack average. */
    function packAnchorU(): number {
      let lead = 0;
      for (let i = 0; i < DERBY_HORSE_COUNT; i++) if (horseU[i] > lead) lead = horseU[i];
      return Math.max(0, lead - 0.012);
    }

    function leaderIdx(): number {
      let li = 0;
      for (let i = 1; i < DERBY_HORSE_COUNT; i++) if (horseU[i] > horseU[li]) li = i;
      return li;
    }

    /** director: compute camera goals for the active shot */
    function directCamera(now: number, racing: boolean) {
      const pp = { x: 0, z: 0, tx: 0, tz: 0 };
      const li = leaderIdx();
      const cu = racing ? packAnchorU() : 0;
      switch (currentShot) {
        case 'parade': {
          // low tracking shot from the infield (structure-free — the marquee
          // and gate never cross this framing), drifting gently with the clump
          const clumpU = paradeOffset + now * 0.0000055 + 3.5 * 0.02;
          lanePos(clumpU, -5.5, 0, tmpV2);
          camPosGoal.set(tmpV2.x, 3.1 + Math.sin(now * 0.00012) * 0.7, tmpV2.z);
          lanePos(clumpU + 0.01, 4.5, 0, tmpV2);
          camTargetGoal.copy(tmpV2).setY(0.8);
          break;
        }
        case 'gates': {
          // front-quarter dolly gliding across the loaded stalls
          pathPoint(0.012, pp);
          const cz = pp.z + TRACK_W / 2;
          const sweep = Math.sin((now - shotStartedAt) * 0.00016);
          camPosGoal.set(pp.x + 10.5, 3.1, cz + sweep * (TRACK_W / 2 + 2));
          camTargetGoal.set(pp.x + 0.5, 1.5, cz + sweep * (TRACK_W / 2 - 2.5));
          break;
        }
        case 'break': {
          // crane: rise from the infield behind the gate, clear of the marquee
          pathPoint(0.012, pp);
          const t = Math.min(1, (now - shotStartedAt) / 3200);
          camPosGoal.set(pp.x - 5 - t * 7, 4 + t * 11, pp.z - 3 - t * 2);
          lanePos(horseU[li], 3.5, 0, tmpV2);
          camTargetGoal.copy(tmpV2).setY(1.4);
          break;
        }
        case 'chase': {
          lanePos(Math.min(1, horseU[li] + 0.035), -2.2, 0, tmpV2, tmpHead);
          camPosGoal.set(tmpV2.x, 4.2, tmpV2.z);
          lanePos(cu, 4, 0, tmpV2);
          camTargetGoal.copy(tmpV2).setY(1.3);
          break;
        }
        case 'backTrack': {
          // classic inside-rail side pan, tight on the leaders
          lanePos(cu, -4.5, 0, tmpV2);
          camPosGoal.set(tmpV2.x, 2.3, tmpV2.z);
          lanePos(cu + 0.004, 3.5, 0, tmpV2);
          camTargetGoal.copy(tmpV2).setY(1.3);
          break;
        }
        case 'drone': {
          lanePos(cu, 3.5, 0, tmpV2);
          const a = (now - shotStartedAt) * 0.00018 + 2.2;
          camPosGoal.set(tmpV2.x + Math.cos(a) * 13, 11, tmpV2.z + Math.sin(a) * 13);
          camTargetGoal.copy(tmpV2).setY(1);
          break;
        }
        case 'home': {
          pathPoint(0.004, pp);
          camPosGoal.set(pp.x + 10, 2.4, pp.z + TRACK_W / 2);
          lanePos(Math.max(0.86, horseU[li]), 3.5, 0, tmpV2);
          camTargetGoal.copy(tmpV2).setY(1.5);
          break;
        }
        case 'finish': {
          pathPoint(0.995, pp);
          camPosGoal.set(pp.x + 6, 5.5, pp.z + TRACK_W + 7);
          lanePos(horseU[li], 3.5, 0, tmpV2);
          camTargetGoal.copy(tmpV2).setY(1.4);
          break;
        }
        case 'podium': {
          const a = (now - shotStartedAt) * 0.0001 + 0.8;
          camPosGoal.set(
            podium.position.x + Math.cos(a) * 9,
            3.6 + Math.sin((now - shotStartedAt) * 0.0002) * 0.8,
            podium.position.z + Math.sin(a) * 9,
          );
          camTargetGoal.copy(podium.position).setY(1.9);
          break;
        }
      }
    }

    const aheadHead = { x: 0, z: 0 };
    /**
     * speed is world units/sec (race average ≈ 3.3). Real gallop cadence sits
     * near-constant at ~2.0–2.6 strides/sec — horses gain speed by lengthening
     * stride, not quickening it — so the cycle frequency is clamped and only
     * the motion amplitudes scale with speed.
     */
    function placeHorse(i: number, u: number, drift: number, speed: number, dt: number) {
      const h = horses[i];
      lanePos(u, i, drift, tmpV, tmpHead);
      h.group.position.set(tmpV.x, 0, tmpV.z);
      // Face the travel tangent: local +x (the head) onto (tx, tz).
      const yaw = Math.atan2(-tmpHead.z, tmpHead.x);
      h.group.rotation.y = yaw;
      const galloping = speed > 2;
      const energy = Math.min(1, speed / 3.4);
      // Bank into turns: yaw rate a short distance ahead → roll around the
      // forward (local x) axis. Capped well under the ~20° believability limit.
      lanePos(u + 0.004, i, drift, tmpV2, aheadHead);
      let dyaw = Math.atan2(-aheadHead.z, aheadHead.x) - yaw;
      if (dyaw > Math.PI) dyaw -= Math.PI * 2;
      if (dyaw < -Math.PI) dyaw += Math.PI * 2;
      const lean = reducedMotion ? 0 : Math.max(-0.2, Math.min(0.2, dyaw * 1.6 * energy));
      // stride clock: gallop 2.0–2.6 Hz, walk ~0.9 Hz
      const strideHz = galloping ? Math.min(2.6, Math.max(2, 2.1 + (speed - 3.3) * 0.15)) : 0.9;
      const prevPhase = h.gallopPhase;
      h.gallopPhase += dt * Math.PI * 2 * strideHz;
      // hoof-strike (phase wrap) kicks a dust puff at race speed
      if (
        !reducedMotion &&
        galloping &&
        Math.floor(h.gallopPhase / (Math.PI * 2)) > Math.floor(prevPhase / (Math.PI * 2))
      ) {
        spawnDust(i);
      }
      const s = Math.sin(h.gallopPhase);
      const rockAmp = galloping ? 0.09 : 0.03;
      const bobAmp = galloping ? 0.14 : 0.04;
      h.rocker.position.y = reducedMotion ? 0 : Math.abs(Math.sin(h.gallopPhase)) * bobAmp * energy;
      h.rocker.rotation.z = reducedMotion ? 0 : s * rockAmp * energy;
      h.rocker.rotation.x = lean;
      h.legsFront.rotation.z = reducedMotion ? 0 : s * (galloping ? 0.5 : 0.2);
      h.legsHind.rotation.z = reducedMotion ? 0 : -s * (galloping ? 0.55 : 0.22);
      h.rosette.visible = propsRef.current.myHorseIdxs.includes(i);
      if (h.rosette.visible) h.rosette.lookAt(camera.position);
    }

    function spawnDust(i: number) {
      const h = horses[i];
      const st = dustState[dustCursor];
      st.x = h.group.position.x - Math.sin(h.group.rotation.y + Math.PI / 2) * 1;
      st.y = 0.15;
      st.z = h.group.position.z - Math.cos(h.group.rotation.y + Math.PI / 2) * 1;
      st.vy = 0.18 + Math.random() * 0.22;
      st.life = 0.8;
      dustCursor = (dustCursor + 1) % DUST;
    }

    function burstConfetti() {
      const activeCount = Math.max(80, Math.round(CONF * adaptiveQuality.particleScale()));
      for (let i = 0; i < confState.length; i++) {
        const st = confState[i];
        if (i >= activeCount) {
          st.live = false;
          continue;
        }
        st.x = podium.position.x + (Math.random() - 0.5) * 7;
        st.y = 8 + Math.random() * 7;
        st.z = podium.position.z + (Math.random() - 0.5) * 7;
        st.vx = (Math.random() - 0.5) * 1.2;
        st.vy = -(0.8 + Math.random() * 1.2);
        st.vz = (Math.random() - 0.5) * 1.2;
        st.rx = Math.random() * Math.PI;
        st.rz = Math.random() * Math.PI;
        st.srx = (Math.random() - 0.5) * 5;
        st.srz = (Math.random() - 0.5) * 5;
        st.live = true;
      }
    }

    /* ── resize ── */
    const resize = () => {
      const el = canvas.parentElement;
      if (!el) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    /* ── main loop ── */
    const frame = (now: number, deltaMs: number) => {
      const dt = Math.min(0.05, deltaMs / 1000);
      const { phase, script, raceStartAtMs, winnerIdx, onTick, onWinnerCross } = propsRef.current;

      /* phase transitions */
      if (phase !== lastPhase) {
        if (phase === 'betting') {
          cutTo('parade', now);
          podium.visible = false;
          winnerCrossed = false;
          podiumSpot.intensity = 0;
          for (const h of horses) h.group.scale.setScalar(1);
        } else if (phase === 'locked') {
          cutTo('gates', now);
          winnerCrossed = false;
        } else if (phase === 'racing') {
          cutTo('break', now);
        } else if (phase === 'results') {
          celebrationT = now;
          if (!reducedMotion) burstConfetti();
          podium.visible = true;
          podiumSpot.intensity = 900;
          podiumSpot.target.position.copy(podium.position);
          cutTo('podium', now);
        }
        lastPhase = phase;
      }

      /* gate machinery: up during locked/race-start, sinks after the break */
      const raceMs = raceStartAtMs != null ? Date.now() - raceStartAtMs : -1;
      const gateUp = phase === 'locked' || (phase === 'racing' && raceMs < 2600);
      gateY += ((gateUp ? 0 : -6) - gateY) * Math.min(1, dt * (gateUp ? 3.2 : 1.4));
      gate.position.y = gateY;
      const doorsOpenTarget = phase === 'racing' && raceMs >= 0 ? 1 : 0;
      if (doorsOpenTarget === 1 && doorOpen < 0.02 && !reducedMotion) {
        shakeUntil = now + 320; // gate slam
      }
      doorOpen += (doorsOpenTarget - doorOpen) * Math.min(1, dt * 9);
      for (const d of stallDoors) d.rotation.y = doorOpen * 1.9;

      /* horses per phase */
      if (phase === 'racing' && script && raceMs >= 0) {
        const t = Math.min(raceMs, script.durationMs);
        for (let i = 0; i < DERBY_HORSE_COUNT; i++) {
          const u = Math.min(1, Math.max(0, sampleScriptChannel(script.progress[i], t)));
          const drift = sampleScriptChannel(script.lane[i], t);
          // speed estimate for gallop cadence (progress/s → cadence)
          const ahead = Math.min(1, sampleScriptChannel(script.progress[i], Math.min(script.durationMs, t + 250)));
          const speed = (ahead - u) * 4 * PERIM; // world units / s
          horseU[i] = u;
          horseDrift[i] = drift;
          placeHorse(i, u * (1 - 0.012) + 0.012, drift, Math.max(2.4, speed), dt);
        }
        // winner hits the wire
        if (!winnerCrossed && script.finishTimesMs[script.winnerIdx] <= raceMs) {
          winnerCrossed = true;
          const margin = script.finishTimesMs[script.finishOrder[1]] - script.finishTimesMs[script.winnerIdx];
          const isPhoto = margin < 400;
          cutTo('finish', now);
          let photoUrl: string | null = null;
          if (isPhoto) {
            try {
              directCamera(now, true);
              camPos.copy(camPosGoal);
              camTarget.copy(camTargetGoal);
              camera.position.copy(camPos);
              camera.lookAt(camTarget);
              renderer.render(scene, camera);
              photoUrl = renderer.domElement.toDataURL('image/jpeg', 0.7);
            } catch {
              photoUrl = null;
            }
          }
          onWinnerCross?.(photoUrl, isPhoto);
        }
        const shot = winnerCrossed ? 'finish' : shotForLeader(horseU[leaderIdx()]);
        cutTo(shot, now);
        if (onTick && now - lastTickAt > 250) {
          lastTickAt = now;
          const order = Array.from({ length: DERBY_HORSE_COUNT }, (_, i) => i).sort((a, b) => {
            const fa = script.finishTimesMs[a] <= t ? script.finishTimesMs[a] : Infinity;
            const fb = script.finishTimesMs[b] <= t ? script.finishTimesMs[b] : Infinity;
            if (fa !== fb) return fa - fb;
            return horseU[b] - horseU[a];
          });
          onTick({ raceMs: t, u: [...horseU], order, leader: leaderIdx(), finished: t >= script.durationMs });
        }
      } else if (phase === 'locked') {
        // horses walk into their stalls, then fidget
        const pp = 0.012;
        for (let i = 0; i < DERBY_HORSE_COUNT; i++) {
          const settled = Math.min(1, (now - shotStartedAt - i * 320) / 1600);
          const from = pp - 0.02 - i * 0.004;
          const u = from + (pp - from) * Math.max(0, settled);
          const fidget = settled >= 1 && !reducedMotion ? Math.sin(now * 0.004 + i * 2.1) * 0.02 : 0;
          horseU[i] = u;
          placeHorse(i, u, fidget, 1.0, dt);
        }
      } else if (phase === 'results') {
        // winner on the podium; the field trots off around the far turn
        const t = Math.min(1, (now - celebrationT) / 2400);
        for (let i = 0; i < DERBY_HORSE_COUNT; i++) {
          if (i === (winnerIdx ?? script?.winnerIdx ?? -1)) {
            // music-box turntable: glide onto the drum, then spin slowly
            const h = horses[i];
            lanePos(0.012, i, 0, tmpV);
            tmpV.lerp(tmpV2.set(podium.position.x, 0, podium.position.z), t * t);
            h.group.position.set(tmpV.x, t * t * 0.92, tmpV.z);
            const scale = 1 + t * 0.18;
            h.group.scale.setScalar(scale);
            h.group.rotation.y += dt * (0.25 + t * 0.4);
            h.rocker.position.y = Math.abs(Math.sin(now * 0.005)) * 0.1 * t;
            h.rocker.rotation.z = 0;
            h.legsFront.rotation.z = Math.sin(now * 0.005) * 0.25;
            h.legsHind.rotation.z = -Math.sin(now * 0.005) * 0.25;
          } else {
            horseU[i] = (horseU[i] + dt * 0.01) % 1;
            placeHorse(i, horseU[i], 0, 1.2, dt);
          }
        }
      } else {
        // betting: languid parade — a loose clump the camera can stay with
        for (let i = 0; i < DERBY_HORSE_COUNT; i++) {
          horseU[i] = (paradeOffset + now * 0.0000055 + i * 0.02 + Math.sin(now * 0.0002 + i * 1.7) * 0.004) % 1;
          placeHorse(i, horseU[i], Math.sin(now * 0.0006 + i) * 0.3, 1.1, dt);
        }
      }

      /* dust */
      {
        let idx = 0;
        for (const st of dustState) {
          if (st.life > 0) {
            st.life -= dt * 1.6;
            st.y += st.vy * dt;
          }
          const s = Math.max(0.0001, st.life) * (1.6 - st.life);
          m4.compose(tmpV.set(st.x, st.life > 0 ? st.y : -10, st.z), quat.identity(), scl.set(s, s, s));
          dust.setMatrixAt(idx++, m4);
        }
        dust.instanceMatrix.needsUpdate = true;
      }

      /* confetti */
      if (phase === 'results' && !reducedMotion) {
        let idx = 0;
        for (const st of confState) {
          if (st.live) {
            st.vy = Math.max(st.vy - dt * 0.4, -2.2);
            st.x += (st.vx + Math.sin(now * 0.003 + idx) * 0.5) * dt;
            st.y += st.vy * dt;
            st.z += st.vz * dt;
            st.rx += st.srx * dt;
            st.rz += st.srz * dt;
            if (st.y < 0.05) st.live = false;
          }
          eul.set(st.rx, 0, st.rz);
          m4.compose(tmpV.set(st.x, st.live ? st.y : -20, st.z), quat.setFromEuler(eul), scl.set(1, 1, 1));
          confetti.setMatrixAt(idx++, m4);
        }
        confetti.instanceMatrix.needsUpdate = true;
      }

      /* crowd energy */
      if (!reducedMotion) {
        const excitement =
          phase === 'racing' ? 0.35 + Math.max(0, (horseU[leaderIdx()] - 0.6) * 1.6) : phase === 'results' ? 0.9 : 0.12;
        const c = crowd;
        for (let i = 0; i < CROWD; i++) {
          const b = crowdBase[i];
          const y = b.y + Math.max(0, Math.sin(now * 0.006 + b.phase)) * b.amp * excitement;
          m4.setPosition(b.x, y, b.z);
          c.setMatrixAt(i, m4);
        }
        c.instanceMatrix.needsUpdate = true;
      }

      /* marquee chase bulbs */
      {
        const c = new THREE.Color();
        const speedy = phase === 'results' ? 0.012 : 0.004;
        const step = Math.floor(now * speedy);
        for (let i = 0; i < BULBS; i++) {
          const on = phase === 'results' ? step % 2 === i % 2 : (i + step) % 4 < 2;
          bulbs.setColorAt(i, c.setHex(on ? P.bulbOn : 0x4a3623));
        }
        if (bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true;
      }

      /* camera */
      directCamera(now, phase === 'racing');
      const damp = currentShot === 'parade' || currentShot === 'podium' ? 1.6 : 5.5;
      camPos.lerp(camPosGoal, Math.min(1, dt * damp));
      camTarget.lerp(camTargetGoal, Math.min(1, dt * (damp + 1.5)));
      camera.position.copy(camPos);
      if (now < shakeUntil) {
        const k = ((shakeUntil - now) / 320) * 0.12;
        camera.position.x += (Math.random() - 0.5) * k;
        camera.position.y += (Math.random() - 0.5) * k;
      }
      camera.lookAt(camTarget);

      renderer.render(scene, camera);
    };
    const frameLoop = createGameFrameLoop({
      simulate: () => true,
      render: (_alpha, info) => frame(info.nowMs, info.deltaMs),
      onFrame: (info) => adaptiveQuality.sample(info.deltaMs, info.nowMs),
    });
    frameLoop.start();

    const onContextLost = (e: Event) => {
      e.preventDefault();
      frameLoop.destroy();
    };
    canvas.addEventListener('webglcontextlost', onContextLost);

    return () => {
      frameLoop.destroy();
      ro.disconnect();
      mq?.removeEventListener('change', updateMotion);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
        else mat?.dispose();
      });
      renderer.dispose();
    };
     
  }, []);

  return (
    <div className="derby-scene-host">
      <canvas ref={canvasRef} className="derby-scene-canvas" />
    </div>
  );
}
