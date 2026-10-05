"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Shield, AlertTriangle, Skull } from "lucide-react";
import {
  GameShell,
  GameStat,
  type GameHowTo,
} from "@/features/arcade/components/shell/game-shell";
import {
  ArcadeMachine,
  MachineButton,
  MachineGlass,
  machineError,
  useMachineBet,
  useMachineKey,
} from "@/features/arcade/components/wagers/arcade-machine";
import { ArcadeWagerResultPlate } from "@/features/arcade/components/results/arcade-run-result";
import { useGameFeedback } from "@/features/arcade/lib/use-game-feedback";
import { ArcadeButton } from "@/features/arcade/components/ui/arcade-ui";
import { SoundManager } from "@/features/arcade/lib/sound-manager";
import { createGameFrameLoop } from "@/features/arcade/lib/game-frame-loop";
import { useArcadeRunResult } from "@/features/arcade/lib/run-result";
import { usePreventGameGestures } from "@/features/arcade/lib/game-mobile-utils";
import {
  isControlTarget,
  isDialogOpen,
} from "@/features/arcade/lib/use-first-input";

/* ===========================================================================
 *  Types + constants
 * ========================================================================= */

type Phase = "idle" | "playing" | "jumping" | "won" | "lost";

const WAYPOINTS = 8;
const CANVAS_W = 640;
const CANVAS_H = 340;
const CX = CANVAS_W / 2;
const CY = CANVAS_H / 2;
const STAR_COUNT = 200;
const DEBRIS_COUNT = 60;

type LaneConfig = {
  label: string;
  survival: number;
  fairMult: number;
  displayMult: number;
  color: string;
  icon: "shield" | "alert" | "skull";
};

const LANES: Record<number, LaneConfig> = {
  0: {
    label: "safe",
    survival: 0.95,
    fairMult: 1 / 0.95,
    displayMult: 1.02,
    color: "#3b82f6",
    icon: "shield",
  },
  1: {
    label: "risky",
    survival: 0.65,
    fairMult: 1 / 0.65,
    displayMult: 1.49,
    color: "#f59e0b",
    icon: "alert",
  },
  2: {
    label: "deadly",
    survival: 0.35,
    fairMult: 1 / 0.35,
    displayMult: 2.77,
    color: "#ef4444",
    icon: "skull",
  },
};

const LANE_ICON = { shield: Shield, alert: AlertTriangle, skull: Skull };

/* Shell-side enamel mapping for the three lanes (canvas colors stay
   internal to the playfield; the HUD speaks Midway). */
const LANE_TONE: Record<number, "info" | "tickets" | "danger"> = {
  0: "info",
  1: "tickets",
  2: "danger",
};

/* The cumulative payout is capped at 500× on the server
   (LIGHTSPEED_MAX_MULTIPLIER); eight deadly jumps reach it. */
const TOP_MULTIPLIER = 500;

const HOW_TO: GameHowTo = {
  lines: [
    "Pick a bet, launch, then pick a lane at each of 8 jumps or cash out.",
    "Safe survives 95% of jumps, risky 65% and deadly 35%; a hit takes the bet.",
    "One jump pays 1.02× safe, 1.49× risky or 2.77× deadly, and each jump after multiplies it again, up to 500×.",
  ],
};

/* ---- Destination planets (picked randomly on launch) ----
   Original names only — the cabinet's own star chart, no borrowed worlds.
   Surface detail keys off `terrain`, never the name, so renames stay safe. */
type PlanetTerrain =
  "desert" | "ice" | "city" | "lava" | "forest" | "cloud" | "ocean";

type Planet = {
  name: string;
  tagline: string;
  terrain: PlanetTerrain;
  color: string;
  color2: string; // secondary for gradient
  atmosphere: string; // glow ring color
};

const PLANETS: Planet[] = [
  {
    name: "Ferron",
    tagline: "Chrome dunes shimmer beneath a cold horizon",
    terrain: "desert",
    color: "#94a3b8",
    color2: "#1e293b",
    atmosphere: "#cbd5e1",
  },
  {
    name: "Saffra",
    tagline: "Spice-gold dunes under a low pale sun",
    terrain: "desert",
    color: "#f59e0b",
    color2: "#b45309",
    atmosphere: "#fde68a",
  },
  {
    name: "Glacira",
    tagline: "Glacier fields stretch to the frozen horizon",
    terrain: "ice",
    color: "#7dd3fc",
    color2: "#1e3a5f",
    atmosphere: "#bae6fd",
  },
  {
    name: "Stormwake",
    tagline: "Endless gales race over the dark ocean",
    terrain: "ice",
    color: "#60a5fa",
    color2: "#16324f",
    atmosphere: "#93c5fd",
  },
  {
    name: "Lumen",
    tagline: "Beacon towers glitter across the night side",
    terrain: "city",
    color: "#c084fc",
    color2: "#3b0764",
    atmosphere: "#e9d5ff",
  },
  {
    name: "Emberfall",
    tagline: "Rivers of fire glow beneath the ash",
    terrain: "lava",
    color: "#ef4444",
    color2: "#450a0a",
    atmosphere: "#fca5a5",
  },
  {
    name: "Verdance",
    tagline: "Canopy green rolls past every horizon",
    terrain: "forest",
    color: "#4ade80",
    color2: "#14532d",
    atmosphere: "#86efac",
  },
  {
    name: "Thornwood",
    tagline: "Iron pines tower through the cloud deck",
    terrain: "forest",
    color: "#a3e635",
    color2: "#365314",
    atmosphere: "#d9f99d",
  },
  {
    name: "Mirella",
    tagline: "Mist drifts through the lantern bogs",
    terrain: "forest",
    color: "#6ee7b7",
    color2: "#064e3b",
    atmosphere: "#a7f3d0",
  },
  {
    name: "Nereid",
    tagline: "Rolling green plains and shimmering lakes",
    terrain: "forest",
    color: "#34d399",
    color2: "#0d4f3c",
    atmosphere: "#6ee7b7",
  },
  {
    name: "Cloudrest",
    tagline: "Harbor platforms drift above the gas sea",
    terrain: "cloud",
    color: "#f9a8d4",
    color2: "#831843",
    atmosphere: "#fbcfe8",
  },
  {
    name: "Tideline",
    tagline: "Turquoise shoals lap at the atoll chain",
    terrain: "ocean",
    color: "#2dd4bf",
    color2: "#134e4a",
    atmosphere: "#99f6e4",
  },
];

/* ---- Easter egg flyby objects that appear during jumps ----
   Original silhouettes only: fairground space-race traffic, no borrowed ships. */
type FlybyKind =
  | "drone"
  | "courier"
  | "freighter"
  | "ring-station"
  | "asteroid"
  | "saucer"
  | "scout"
  | "buoy";

type Flyby = {
  kind: FlybyKind;
  x: number;
  y: number;
  z: number; // depth (1=far, 0=near)
  speed: number; // z movement per sec
  scale: number;
  side: -1 | 1; // left or right drift
};

const FLYBY_KINDS: FlybyKind[] = [
  "drone",
  "courier",
  "freighter",
  "ring-station",
  "asteroid",
  "saucer",
  "scout",
  "buoy",
];

function spawnFlyby(state: RenderState) {
  // ~40% chance per jump to see something
  if (Math.random() > 0.4) return;
  const kind = FLYBY_KINDS[Math.floor(Math.random() * FLYBY_KINDS.length)]!;
  state.flybys.push({
    kind,
    x: (Math.random() - 0.5) * 1.6,
    y: (Math.random() - 0.5) * 1.2,
    z: 0.85 + Math.random() * 0.15,
    speed: 0.15 + Math.random() * 0.25,
    scale:
      kind === "ring-station"
        ? 2.5
        : kind === "freighter"
          ? 2.0
          : kind === "asteroid"
            ? 1.5
            : 1.0,
    side: Math.random() > 0.5 ? 1 : -1,
  });
}

/* ---- Star type ---- */
type Star = {
  x: number; // -1..1 from center
  y: number;
  z: number; // depth 0..1 (1=far, 0=near)
  brightness: number;
};

type Debris = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  color: string;
};

/* ---- Midway cabinet theme, read from CSS tokens (theme-aware) ---- */
type MidwayTheme = {
  screenTop: string; // recessed screen well — top
  screenMid: string; // mid
  screenDeep: string; // base
  wellEdge: string; // deep inner rim
  bevelHi: string; // top-edge highlight
  ink: string; // cream ink
  inkFaint: string; // labels / meta
  cabinet: string; // wood frame face
  cabinetDeep: string; // wood frame deep
  ticket: string; // amber enamel
  ticketEdge: string;
  primary: string; // red enamel
  prize: string; // teal enamel
  info: string; // blue enamel
  star: string; // matte star tint
};

const MIDWAY_FALLBACK: MidwayTheme = {
  screenTop: "#17110a",
  screenMid: "#0f1512",
  screenDeep: "#0c0804",
  wellEdge: "#0c0804",
  bevelHi: "rgba(74,56,34,0.47)",
  ink: "#f6eddc",
  inkFaint: "#8a7c63",
  cabinet: "#2f251a",
  cabinetDeep: "#16100a",
  ticket: "#f2a33c",
  ticketEdge: "#9a621a",
  primary: "#c73538",
  prize: "#2fb8a6",
  info: "#6c8fe0",
  star: "#e2d5bc",
};

function readMidwayTheme(el: HTMLElement): MidwayTheme {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) =>
    cs.getPropertyValue(name).trim() || fallback;
  return {
    screenTop: v("--surface-well", MIDWAY_FALLBACK.screenTop),
    screenMid: v("--screen-well", MIDWAY_FALLBACK.screenMid),
    screenDeep: v("--bg", MIDWAY_FALLBACK.screenDeep),
    wellEdge: v("--border-ink", MIDWAY_FALLBACK.wellEdge),
    bevelHi: v("--bevel-hi", MIDWAY_FALLBACK.bevelHi),
    ink: v("--text-strong", MIDWAY_FALLBACK.ink),
    inkFaint: v("--text-faint", MIDWAY_FALLBACK.inkFaint),
    cabinet: v("--surface-raised", MIDWAY_FALLBACK.cabinet),
    cabinetDeep: v("--bg", MIDWAY_FALLBACK.cabinetDeep),
    ticket: v("--enamel-tickets", MIDWAY_FALLBACK.ticket),
    ticketEdge: v("--enamel-tickets-edge", MIDWAY_FALLBACK.ticketEdge),
    primary: v("--enamel-primary", MIDWAY_FALLBACK.primary),
    prize: v("--enamel-prize", MIDWAY_FALLBACK.prize),
    info: v("--enamel-info", MIDWAY_FALLBACK.info),
    star: v("--text-body", MIDWAY_FALLBACK.star),
  };
}

/* #rrggbb / rgb() → rgba() at the given alpha for canvas fills. */
function withAlpha(color: string, alpha: number): string {
  const c = color.trim();
  if (c.startsWith("#")) {
    let r = 0,
      g = 0,
      b = 0;
    if (c.length >= 7) {
      r = parseInt(c.slice(1, 3), 16);
      g = parseInt(c.slice(3, 5), 16);
      b = parseInt(c.slice(5, 7), 16);
    } else if (c.length >= 4) {
      r = parseInt(c[1]! + c[1]!, 16);
      g = parseInt(c[2]! + c[2]!, 16);
      b = parseInt(c[3]! + c[3]!, 16);
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const m = c.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const parts = m[1]!.split(",").map((p) => p.trim());
    return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
  }
  return c;
}

/* ---- Render state (mutable ref, not React state) ---- */
type RenderState = {
  stars: Star[];
  debris: Debris[];
  flybys: Flyby[];
  speed: number; // current star flow speed (1=cruise, 8=warp)
  targetSpeed: number;
  shake: number;
  flashColor: string | null;
  flashAlpha: number;
  warpT: number; // 0..1 warp streak intensity
  laneTintColor: string | null; // picked lane's color wash during a jump
  laneTintAlpha: number;
  lastT: number;
  phase: Phase;
  jumpResult: "alive" | "dead" | null;
  planet: Planet | null;
  planetRevealT: number; // 0..1 planet zoom-in for arrival
  theme: MidwayTheme;
  reducedMotion: boolean;
};

function initStars(): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    stars.push({
      x: (Math.random() - 0.5) * 2.4,
      y: (Math.random() - 0.5) * 2.4,
      z: Math.random(),
      brightness: 0.45 + Math.random() * 0.55,
    });
  }
  return stars;
}

function recycleStarFar(star: Star) {
  star.x = (Math.random() - 0.5) * 2.4;
  star.y = (Math.random() - 0.5) * 2.4;
  star.z = 0.9 + Math.random() * 0.1;
  star.brightness = 0.3 + Math.random() * 0.7;
}

function spawnDebris(state: RenderState) {
  const t = state.theme;
  // Hull-shrapnel sparks painted in the cabinet's enamel + wood palette.
  const colors = [
    t.primary,
    t.ticket,
    t.ink,
    t.ticketEdge,
    t.prize,
    t.inkFaint,
  ];
  for (let i = 0; i < DEBRIS_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 80 + Math.random() * 300;
    state.debris.push({
      x: CX + (Math.random() - 0.5) * 40,
      y: CY + (Math.random() - 0.5) * 40,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 1.5 + Math.random() * 4,
      life: 0.8 + Math.random() * 1.0,
      maxLife: 0.8 + Math.random() * 1.0,
      color: colors[Math.floor(Math.random() * colors.length)]!,
    });
  }
}

/* ===========================================================================
 *  Flyby + planet drawing helpers
 * ========================================================================= */

function drawFlyby(
  ctx: CanvasRenderingContext2D,
  kind: FlybyKind,
  x: number,
  y: number,
  s: number,
  alpha: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.globalAlpha = alpha;

  switch (kind) {
    case "drone": {
      // Quad survey drone — center pod with four rotor arms
      ctx.strokeStyle = "#64748b";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-9, -9);
      ctx.lineTo(9, 9);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-9, 9);
      ctx.lineTo(9, -9);
      ctx.stroke();
      ctx.fillStyle = "#475569";
      ctx.beginPath();
      ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
      ctx.fill();
      // Rotor discs
      ctx.fillStyle = "#94a3b8";
      for (const [rx, ry] of [
        [-9, -9],
        [9, -9],
        [-9, 9],
        [9, 9],
      ]) {
        ctx.beginPath();
        ctx.ellipse(rx!, ry!, 3.4, 1.4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // Lens
      ctx.beginPath();
      ctx.arc(0, 0, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = "#38bdf8";
      ctx.globalAlpha = alpha * 0.7;
      ctx.fill();
      break;
    }
    case "courier": {
      // Slim packet rocket — needle hull, single tail fin, small wings
      ctx.fillStyle = "#e2e8f0";
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.lineTo(-2.5, 6);
      ctx.lineTo(2.5, 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#cbd5e1";
      ctx.beginPath();
      ctx.moveTo(-2.5, 2);
      ctx.lineTo(-8, 8);
      ctx.lineTo(-2.5, 6);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(2.5, 2);
      ctx.lineTo(8, 8);
      ctx.lineTo(2.5, 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#94a3b8";
      ctx.fillRect(-0.8, 6, 1.6, 3); // tail fin
      // Engine glow
      ctx.beginPath();
      ctx.arc(0, 10, 2, 0, Math.PI * 2);
      ctx.fillStyle = "#f97316";
      ctx.globalAlpha = alpha * 0.8;
      ctx.fill();
      break;
    }
    case "freighter": {
      // Boxy cargo hauler — slab hull with container blocks and a cab
      ctx.fillStyle = "#94a3b8";
      ctx.fillRect(-12, -4, 24, 8); // hull
      ctx.fillStyle = "#64748b";
      ctx.fillRect(-10, -7, 6, 3); // containers
      ctx.fillRect(-2, -7, 6, 3);
      ctx.fillRect(6, -7, 4, 3);
      ctx.fillStyle = "#475569";
      ctx.fillRect(8, -2, 5, 5); // cab
      // Portholes
      ctx.fillStyle = "#38bdf8";
      ctx.globalAlpha = alpha * 0.6;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(-8 + i * 4, 0, 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "ring-station": {
      // Waypoint ring — torus with a hub and spokes
      ctx.strokeStyle = "#64748b";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "#475569";
      ctx.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 3, Math.sin(a) * 3);
        ctx.lineTo(Math.cos(a) * 9.5, Math.sin(a) * 9.5);
        ctx.stroke();
      }
      ctx.fillStyle = "#94a3b8";
      ctx.beginPath();
      ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
      ctx.fill();
      // Dock light
      ctx.beginPath();
      ctx.arc(0, -11, 1.4, 0, Math.PI * 2);
      ctx.fillStyle = "#22c55e";
      ctx.globalAlpha = alpha * 0.6;
      ctx.fill();
      break;
    }
    case "asteroid": {
      ctx.fillStyle = "#57534e";
      ctx.beginPath();
      ctx.moveTo(-6, -4);
      ctx.lineTo(-2, -8);
      ctx.lineTo(5, -6);
      ctx.lineTo(8, -1);
      ctx.lineTo(6, 5);
      ctx.lineTo(-1, 7);
      ctx.lineTo(-7, 3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#44403c";
      ctx.beginPath();
      ctx.arc(1, -1, 2, 0, Math.PI * 2);
      ctx.fill(); // crater
      break;
    }
    case "saucer": {
      // Classic carnival flying saucer — disc, dome, rim lights
      ctx.fillStyle = "#d4d4d8";
      ctx.beginPath();
      ctx.ellipse(0, 1, 11, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#94a3b8";
      ctx.beginPath();
      ctx.ellipse(0, -1.5, 4.5, 3.5, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      // Rim lights
      ctx.fillStyle = "#f59e0b";
      ctx.globalAlpha = alpha * 0.8;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.arc(i * 6, 2.5, 1, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "scout": {
      // Arrowhead scout — plain dart with a cockpit stripe
      ctx.fillStyle = "#2fb8a6";
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(-5, 6);
      ctx.lineTo(0, 3);
      ctx.lineTo(5, 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#99f6e4";
      ctx.fillRect(-0.8, -3, 1.6, 4); // cockpit stripe
      // Engine glow
      ctx.beginPath();
      ctx.arc(0, 6.5, 1.6, 0, Math.PI * 2);
      ctx.fillStyle = "#f97316";
      ctx.globalAlpha = alpha * 0.7;
      ctx.fill();
      break;
    }
    case "buoy": {
      // Navigation buoy — squat beacon body, antenna, blinking lamp
      ctx.fillStyle = "#334155";
      ctx.beginPath();
      ctx.moveTo(-4, 6);
      ctx.lineTo(-2.5, -3);
      ctx.lineTo(2.5, -3);
      ctx.lineTo(4, 6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#475569";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(0, -3);
      ctx.lineTo(0, -9);
      ctx.stroke();
      // Beacon lamp
      ctx.beginPath();
      ctx.arc(0, -9, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = "#ef4444";
      ctx.globalAlpha = alpha * 0.8;
      ctx.fill();
      // Stripe
      ctx.fillStyle = "#f59e0b";
      ctx.globalAlpha = alpha * 0.9;
      ctx.fillRect(-3.4, 1, 6.8, 1.6);
      break;
    }
  }

  ctx.restore();
}

/* Deterministic per-planet PRNG: drawPlanet runs every frame, so surface
   features must come from a stable sequence or they flicker as static. */
function planetRng(name: string) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function drawPlanet(
  ctx: CanvasRenderingContext2D,
  planet: Planet,
  revealT: number,
) {
  if (revealT <= 0) return;
  const rand = planetRng(planet.name);

  // Planet zooms in from tiny to large
  const t = Math.min(1, revealT);
  const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
  const radius = ease * 80;
  const alpha = Math.min(1, ease * 1.5);

  ctx.save();
  ctx.globalAlpha = alpha;

  // Atmosphere glow
  const glowGrad = ctx.createRadialGradient(
    CX,
    CY,
    radius,
    CX,
    CY,
    radius + 30 * ease,
  );
  glowGrad.addColorStop(0, `${planet.atmosphere}40`);
  glowGrad.addColorStop(1, "transparent");
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Planet body
  const bodyGrad = ctx.createRadialGradient(
    CX - radius * 0.3,
    CY - radius * 0.3,
    0,
    CX,
    CY,
    radius,
  );
  bodyGrad.addColorStop(0, planet.color);
  bodyGrad.addColorStop(1, planet.color2);
  ctx.beginPath();
  ctx.arc(CX, CY, radius, 0, Math.PI * 2);
  ctx.fillStyle = bodyGrad;
  ctx.fill();

  // Surface detail (planet-specific)
  ctx.save();
  ctx.beginPath();
  ctx.arc(CX, CY, radius, 0, Math.PI * 2);
  ctx.clip();

  if (planet.terrain === "desert") {
    // Desert bands
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = `${planet.color2}60`;
      ctx.fillRect(
        CX - radius,
        CY - radius + i * radius * 0.45,
        radius * 2,
        radius * 0.15,
      );
    }
  } else if (planet.terrain === "ice") {
    // Ice caps / storm bands
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.beginPath();
    ctx.ellipse(
      CX,
      CY - radius * 0.7,
      radius * 0.6,
      radius * 0.15,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(
      CX,
      CY + radius * 0.7,
      radius * 0.5,
      radius * 0.12,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  } else if (planet.terrain === "city") {
    // Beacon grid lights
    ctx.fillStyle = `${planet.atmosphere}20`;
    for (let i = 0; i < 20; i++) {
      const gx = CX - radius + rand() * radius * 2;
      const gy = CY - radius + rand() * radius * 2;
      ctx.fillRect(gx, gy, 2 + rand() * 4, 1);
    }
  } else if (planet.terrain === "lava") {
    // Fire rivers
    ctx.strokeStyle = "#f9731680";
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      const sx = CX - radius * 0.5 + rand() * radius;
      ctx.moveTo(sx, CY - radius * 0.4 + i * radius * 0.25);
      ctx.quadraticCurveTo(
        sx + 20,
        CY - radius * 0.2 + i * radius * 0.25,
        sx + 40,
        CY - radius * 0.4 + i * radius * 0.25 + 10,
      );
      ctx.stroke();
    }
  } else if (planet.terrain === "forest") {
    // Green patches / continents
    ctx.fillStyle = `${planet.color}30`;
    for (let i = 0; i < 6; i++) {
      const cx2 = CX - radius * 0.5 + rand() * radius;
      const cy2 = CY - radius * 0.5 + rand() * radius;
      ctx.beginPath();
      ctx.ellipse(
        cx2,
        cy2,
        8 + rand() * 15,
        5 + rand() * 10,
        rand() * Math.PI,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    // Water
    ctx.fillStyle = "#3b82f620";
    ctx.beginPath();
    ctx.ellipse(
      CX + radius * 0.2,
      CY,
      radius * 0.3,
      radius * 0.4,
      0.3,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  } else if (planet.terrain === "cloud") {
    // Cloud bands
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.05 + rand() * 0.08})`;
      ctx.fillRect(
        CX - radius,
        CY - radius * 0.6 + i * radius * 0.25,
        radius * 2,
        radius * 0.1,
      );
    }
  } else if (planet.terrain === "ocean") {
    // Tropical water + small atolls
    ctx.fillStyle = "#0ea5e920";
    ctx.beginPath();
    ctx.arc(CX, CY, radius * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `${planet.color}40`;
    for (let i = 0; i < 8; i++) {
      const ix = CX - radius * 0.4 + rand() * radius * 0.8;
      const iy = CY - radius * 0.4 + rand() * radius * 0.8;
      ctx.beginPath();
      ctx.ellipse(
        ix,
        iy,
        3 + rand() * 5,
        2 + rand() * 3,
        rand(),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }

  ctx.restore();

  // Terminator shadow (dark side)
  const shadowGrad = ctx.createLinearGradient(
    CX + radius * 0.3,
    0,
    CX + radius,
    0,
  );
  shadowGrad.addColorStop(0, "transparent");
  shadowGrad.addColorStop(1, "rgba(0,0,0,0.6)");
  ctx.beginPath();
  ctx.arc(CX, CY, radius, 0, Math.PI * 2);
  ctx.fillStyle = shadowGrad;
  ctx.fill();

  // Edge rim light
  ctx.beginPath();
  ctx.arc(CX, CY, radius, 0, Math.PI * 2);
  ctx.strokeStyle = `${planet.atmosphere}50`;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();
}

/* ===========================================================================
 *  Drawing functions
 * ========================================================================= */

function drawFrame(
  ctx: CanvasRenderingContext2D,
  state: RenderState,
  now: number,
) {
  const dt = Math.min(0.064, (now - state.lastT) / 1000);
  state.lastT = now;
  const theme = state.theme;
  const reduced = state.reducedMotion;

  // --- Update speed ---
  state.speed += (state.targetSpeed - state.speed) * (1 - Math.exp(-dt * 5));

  // --- Update shake (juice — never under reduced motion) ---
  state.shake = reduced ? 0 : Math.max(0, state.shake - dt * 25);

  // --- Update flash ---
  if (state.flashAlpha > 0) {
    state.flashAlpha = Math.max(0, state.flashAlpha - dt * 3.5);
  }

  // --- Update warp ---
  if (state.speed > 3) {
    state.warpT = Math.min(1, state.warpT + dt * 4);
  } else {
    state.warpT = Math.max(0, state.warpT - dt * 3);
  }

  ctx.save();

  // Apply shake
  if (state.shake > 0) {
    ctx.translate(
      (Math.random() - 0.5) * state.shake,
      (Math.random() - 0.5) * state.shake,
    );
  }

  // --- Recessed screen well — dark warm-wood lacquer, darker at the rim. ---
  const bgGrad = ctx.createRadialGradient(CX, CY, 0, CX, CY, CANVAS_W * 0.7);
  bgGrad.addColorStop(0, theme.screenMid);
  bgGrad.addColorStop(0.55, theme.screenTop);
  bgGrad.addColorStop(1, theme.screenDeep);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // --- Lane sheen during a jump — a matte amber→teal wash from the vanishing
  // point. Flat enamel tint, NO bloom. ---
  if (state.warpT > 0.05) {
    const tunnelGrad = ctx.createRadialGradient(CX, CY, 0, CX, CY, 250);
    tunnelGrad.addColorStop(0, withAlpha(theme.ticket, state.warpT * 0.1));
    tunnelGrad.addColorStop(0.5, withAlpha(theme.prize, state.warpT * 0.05));
    tunnelGrad.addColorStop(1, "transparent");
    ctx.fillStyle = tunnelGrad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  // --- Picked-lane tint — the tunnel takes the chosen lane's enamel color
  // for the jump, then fades. Calmer under reduced motion. ---
  if (state.laneTintColor && state.laneTintAlpha > 0.005) {
    state.laneTintAlpha = Math.max(0, state.laneTintAlpha - dt * 0.55);
    const tintGrad = ctx.createRadialGradient(CX, CY, 0, CX, CY, 300);
    tintGrad.addColorStop(
      0,
      withAlpha(state.laneTintColor, state.laneTintAlpha),
    );
    tintGrad.addColorStop(1, "transparent");
    ctx.fillStyle = tintGrad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  // --- Stars ---
  for (const star of state.stars) {
    star.z -= dt * state.speed * 0.35;
    if (star.z <= 0.01) {
      recycleStarFar(star);
      continue;
    }

    const sx = CX + (star.x / star.z) * 160;
    const sy = CY + (star.y / star.z) * 160;

    // Off-screen? Recycle
    if (sx < -20 || sx > CANVAS_W + 20 || sy < -20 || sy > CANVAS_H + 20) {
      recycleStarFar(star);
      continue;
    }

    const size = Math.max(0.7, (1 - star.z) * 3);
    const alpha = star.brightness * (1 - star.z * 0.45);

    if (state.warpT > 0.1 && !reduced) {
      // Warp LANE — a matte enamel streak. A wider amber undercoat
      // beneath a clean cream core. No additive bloom — paint, not light.
      const streakLen = state.warpT * (1 - star.z) * 30;
      const dx = sx - CX;
      const dy = sy - CY;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = dx / dist;
      const ny = dy / dist;

      // Amber lane undercoat
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - nx * streakLen, sy - ny * streakLen);
      ctx.strokeStyle = withAlpha(theme.ticket, alpha * 0.28 * state.warpT);
      ctx.lineWidth = size * 2.4;
      ctx.lineCap = "round";
      ctx.stroke();
      // Cream core
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - nx * streakLen, sy - ny * streakLen);
      ctx.strokeStyle = withAlpha(theme.ink, alpha * 0.92);
      ctx.lineWidth = size * 0.8;
      ctx.stroke();
    } else {
      // Cruise: matte star dot (reduced motion stays on dots — no streaks).
      ctx.beginPath();
      ctx.arc(sx, sy, size, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(theme.star, alpha);
      ctx.fill();
    }
  }

  // --- Flybys (easter egg ships/objects) ---
  for (let i = state.flybys.length - 1; i >= 0; i--) {
    const fb = state.flybys[i]!;
    fb.z -= dt * fb.speed * state.speed * 0.5;
    fb.x += dt * fb.side * 0.08;
    if (fb.z <= 0.02 || fb.z > 1.5) {
      state.flybys.splice(i, 1);
      continue;
    }
    const sx = CX + (fb.x / fb.z) * 160;
    const sy = CY + (fb.y / fb.z) * 160;
    if (sx < -60 || sx > CANVAS_W + 60 || sy < -60 || sy > CANVAS_H + 60) {
      state.flybys.splice(i, 1);
      continue;
    }
    const s = fb.scale * (1 - fb.z) * 2.5;
    const alpha = Math.min(1, (1 - fb.z) * 2) * 0.85;
    drawFlyby(ctx, fb.kind, sx, sy, Math.max(0.3, s), alpha);
  }

  // --- Debris ---
  for (let i = state.debris.length - 1; i >= 0; i--) {
    const d = state.debris[i]!;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.life -= dt;
    if (d.life <= 0) {
      state.debris.splice(i, 1);
      continue;
    }
    const a = d.life / d.maxLife;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.size * a, 0, Math.PI * 2);
    ctx.fillStyle = d.color;
    ctx.globalAlpha = a;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // --- Planet (arrival) ---
  if (state.planet && state.planetRevealT > 0) {
    state.planetRevealT = Math.min(1, state.planetRevealT + dt * 0.8);
    drawPlanet(ctx, state.planet, state.planetRevealT);
  }

  // --- Cockpit frame overlay ---
  drawCockpit(ctx, now, theme, reduced);

  // --- Screen scanlines (very subtle recessed-glass texture) ---
  ctx.fillStyle = "rgba(0,0,0,0.04)";
  for (let y = 0; y < CANVAS_H; y += 3) {
    ctx.fillRect(0, y, CANVAS_W, 1);
  }

  // --- Screen flash ---
  if (state.flashAlpha > 0 && state.flashColor) {
    ctx.globalAlpha = state.flashAlpha;
    ctx.fillStyle = state.flashColor;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function drawCockpit(
  ctx: CanvasRenderingContext2D,
  now: number,
  theme: MidwayTheme,
  reduced: boolean,
) {
  // Lacquered-wood bezel around the recessed screen — "looking through the
  // cabinet window". Warm wood face, amber-enamel instrument shelf.
  const frameW = 28;
  const frameColor = theme.cabinetDeep;
  const metalColor = theme.cabinet;

  // Top
  ctx.fillStyle = frameColor;
  ctx.fillRect(0, 0, CANVAS_W, frameW);
  // Bottom
  ctx.fillRect(0, CANVAS_H - frameW - 16, CANVAS_W, frameW + 16);
  // Left
  ctx.fillRect(0, 0, frameW, CANVAS_H);
  // Right
  ctx.fillRect(CANVAS_W - frameW, 0, frameW, CANVAS_H);

  // Diagonal cuts (trapezoidal cockpit window shape)
  ctx.fillStyle = frameColor;
  // Top-left
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(frameW + 30, frameW);
  ctx.lineTo(frameW, frameW);
  ctx.lineTo(0, frameW + 30);
  ctx.fill();
  // Top-right
  ctx.beginPath();
  ctx.moveTo(CANVAS_W, 0);
  ctx.lineTo(CANVAS_W - frameW - 30, frameW);
  ctx.lineTo(CANVAS_W - frameW, frameW);
  ctx.lineTo(CANVAS_W, frameW + 30);
  ctx.fill();
  // Bottom-left
  ctx.beginPath();
  ctx.moveTo(0, CANVAS_H);
  ctx.lineTo(frameW + 40, CANVAS_H - frameW - 16);
  ctx.lineTo(frameW, CANVAS_H - frameW - 16);
  ctx.lineTo(0, CANVAS_H - frameW - 40);
  ctx.fill();
  // Bottom-right
  ctx.beginPath();
  ctx.moveTo(CANVAS_W, CANVAS_H);
  ctx.lineTo(CANVAS_W - frameW - 40, CANVAS_H - frameW - 16);
  ctx.lineTo(CANVAS_W - frameW, CANVAS_H - frameW - 16);
  ctx.lineTo(CANVAS_W, CANVAS_H - frameW - 40);
  ctx.fill();

  // Bevel trim lines — a bright top edge (the wood bevel highlight) rimming
  // the window opening.
  ctx.strokeStyle = theme.bevelHi;
  ctx.lineWidth = 1.5;
  // Top edge
  ctx.beginPath();
  ctx.moveTo(frameW + 30, frameW);
  ctx.lineTo(CANVAS_W - frameW - 30, frameW);
  ctx.stroke();
  // Bottom edge
  ctx.beginPath();
  ctx.moveTo(frameW + 40, CANVAS_H - frameW - 16);
  ctx.lineTo(CANVAS_W - frameW - 40, CANVAS_H - frameW - 16);
  ctx.stroke();
  // Left edge
  ctx.beginPath();
  ctx.moveTo(frameW, frameW + 30);
  ctx.lineTo(frameW, CANVAS_H - frameW - 40);
  ctx.stroke();
  // Right edge
  ctx.beginPath();
  ctx.moveTo(CANVAS_W - frameW, frameW + 30);
  ctx.lineTo(CANVAS_W - frameW, CANVAS_H - frameW - 40);
  ctx.stroke();

  // Bottom instrument shelf — wood face with a hard bevel highlight.
  const panelY = CANVAS_H - frameW - 14;
  ctx.fillStyle = metalColor;
  ctx.fillRect(frameW, panelY, CANVAS_W - frameW * 2, frameW + 14);
  ctx.fillStyle = theme.bevelHi;
  ctx.fillRect(frameW, panelY, CANVAS_W - frameW * 2, 1);

  // Indicator bulbs — matte enamel domes (teal / amber / red), no glow. Under
  // reduced motion they hold steady instead of pulsing.
  const lightColors = [
    theme.prize,
    theme.info,
    theme.ticket,
    theme.prize,
    theme.primary,
  ];
  for (let i = 0; i < lightColors.length; i++) {
    const lx = frameW + 20 + i * 24;
    const ly = panelY + 8;
    const pulse = reduced ? 0.7 : 0.5 + 0.5 * Math.sin(now / 800 + i * 1.3);
    // Socket
    ctx.beginPath();
    ctx.arc(lx, ly, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(theme.cabinetDeep, 0.85);
    ctx.fill();
    // Bulb
    ctx.beginPath();
    ctx.arc(lx, ly, 2.3, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(lightColors[i]!, 0.45 + pulse * 0.55);
    ctx.fill();
  }

  // Panel seam line
  ctx.strokeStyle = withAlpha(theme.cabinetDeep, 0.8);
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(frameW + 6, panelY + 16);
  ctx.lineTo(CANVAS_W - frameW - 6, panelY + 16);
  ctx.stroke();

  // Speed bars (right of the shelf) — enamel info/amber chips.
  const barX = CANVAS_W - frameW - 100;
  for (let i = 0; i < 6; i++) {
    const pulse = reduced ? 0.6 : 0.3 + 0.7 * Math.sin(now / 300 + i * 0.5);
    ctx.fillStyle = withAlpha(i < 4 ? theme.info : theme.ticket, pulse * 0.6);
    ctx.fillRect(barX + i * 14, panelY + 4, 10, 6);
  }

  // Corner rivets — brass studs
  const rivetPositions = [
    [frameW + 8, frameW + 8],
    [CANVAS_W - frameW - 8, frameW + 8],
    [frameW + 8, CANVAS_H - frameW - 24],
    [CANVAS_W - frameW - 8, CANVAS_H - frameW - 24],
  ];
  for (const [rx, ry] of rivetPositions) {
    ctx.beginPath();
    ctx.arc(rx!, ry!, 2, 0, Math.PI * 2);
    ctx.fillStyle = theme.ticketEdge;
    ctx.fill();
    ctx.strokeStyle = withAlpha(theme.cabinetDeep, 0.9);
    ctx.lineWidth = 0.5;
    ctx.stroke();
    // tiny brass shine
    ctx.fillStyle = withAlpha(theme.ticket, 0.9);
    ctx.beginPath();
    ctx.arc(rx! - 0.5, ry! - 0.5, 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* ===========================================================================
 *  Component
 * ========================================================================= */

function formatMult(m: number): string {
  if (m === 0) return "0×";
  if (m >= 100) return `${m.toFixed(0)}×`;
  if (m >= 10) return `${m.toFixed(1)}×`;
  return `${m.toFixed(2)}×`;
}

export default function LightspeedClient() {
  const { trigger: triggerFeedback } = useGameFeedback();
  const {
    achievements,
    capture: captureRunResult,
    reset: resetRunResult,
  } = useArcadeRunResult();
  const [walletBalances, setWalletBalances] = useState({ credits: 0 });
  const [walletLoaded, setWalletLoaded] = useState(false);
  const balance = walletLoaded ? walletBalances.credits : null;

  const [phase, setPhase] = useState<Phase>("idle");
  const [isJumping, setIsJumping] = useState(false);
  const roundPlaying = phase === "playing" || phase === "jumping" || isJumping;
  const [wager, setWager] = useMachineBet(balance, 10, {
    locked: roundPlaying,
  });
  /* The stake the open run was bought with; the receipt prints it. */
  const [roundStake, setRoundStake] = useState(0);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [jumpsCompleted, setJumpsCompleted] = useState(0);
  const [currentMultiplier, setCurrentMultiplier] = useState(0);
  const [payout, setPayout] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [destination, setDestination] = useState<Planet | null>(null);
  // Lane committed on the in-flight jump — drives the pressed-key feedback.
  const [activeLane, setActiveLane] = useState<number | null>(null);
  // Screen-reader play-by-play (aria-live), mirrors the canvas action.
  const [status, setStatus] = useState("");

  const tokenRef = useRef<string | null>(null);
  const [revealedSeed, setRevealedSeed] = useState<number | null>(null);

  /* ---- Lifecycle: every delayed state change goes through `schedule` so
     unmount (or a fresh run) can cancel pending beats. ---- */
  const mountedRef = useRef(true);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const warpTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const schedule = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timersRef.current.delete(id);
      fn();
    }, ms);
    timersRef.current.add(id);
    return id;
  }, []);

  const cancelTimer = useCallback(
    (id: ReturnType<typeof setTimeout> | undefined) => {
      if (id === undefined) return;
      clearTimeout(id);
      timersRef.current.delete(id);
    },
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    const timers = timersRef.current;
    return () => {
      mountedRef.current = false;
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  /* State, not a ref: GameShell remounts the machine once the wallet
     loads, and the theme and frame loop must follow the new canvas. */
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const renderRef = useRef<RenderState>({
    stars: initStars(),
    debris: [],
    flybys: [],
    speed: 0.5,
    targetSpeed: 0.5,
    shake: 0,
    flashColor: null,
    flashAlpha: 0,
    warpT: 0,
    laneTintColor: null,
    laneTintAlpha: 0,
    lastT: performance.now(),
    phase: "idle",
    jumpResult: null,
    planet: null,
    planetRevealT: 0,
    theme: MIDWAY_FALLBACK,
    reducedMotion: false,
  });

  /* ---------- Midway theme + reduced-motion (theme-aware, no per-frame reads) ---------- */
  useEffect(() => {
    if (!canvas) return;
    const refreshTheme = () => {
      renderRef.current.theme = readMidwayTheme(canvas);
    };
    refreshTheme();
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const applyMotion = () => {
      renderRef.current.reducedMotion = mq.matches;
    };
    applyMotion();
    mq.addEventListener("change", applyMotion);
    const obs = new MutationObserver(refreshTheme);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-arcade-theme"],
    });
    return () => {
      mq.removeEventListener("change", applyMotion);
      obs.disconnect();
    };
  }, [canvas]);

  /* ---------- Canvas loop ---------- */
  useEffect(() => {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const frameLoop = createGameFrameLoop({
      // The server owns jump/cashout results. Preserve the canvas's existing
      // wall-clock integration and use the runtime for scheduling only.
      simulate: () => undefined,
      render: (_alpha, frameInfo) => {
        // 2× supersampled buffer (set on the canvas element) — keep all
        // drawing in CANVAS_W × CANVAS_H logical space via this transform.
        ctx.setTransform(2, 0, 0, 2, 0, 0);
        drawFrame(ctx, renderRef.current, frameInfo.nowMs);
      },
    });
    frameLoop.start();
    return () => frameLoop.destroy();
  }, [canvas]);

  // Sync phase to render state
  useEffect(() => {
    const rs = renderRef.current;
    rs.phase = phase;
    if (phase === "idle") {
      rs.targetSpeed = 0.5;
    } else if (phase === "playing") {
      rs.targetSpeed = 1.2;
    } else if (phase === "won") {
      rs.targetSpeed = 0.8;
    } else if (phase === "lost") {
      rs.targetSpeed = 0.2;
    }
  }, [phase]);

  /* ---------- Wallet ---------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/store/inventory", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { wallet?: { credits?: number } };
        if (cancelled) return;
        setWalletBalances({ credits: data.wallet?.credits ?? 0 });
        setWalletLoaded(true);
      } catch {
        /* silent */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshWallet = useCallback(async () => {
    try {
      const res = await fetch("/api/store/inventory", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { wallet?: { credits?: number } };
      if (!mountedRef.current) return;
      setWalletBalances({ credits: data.wallet?.credits ?? 0 });
      setWalletLoaded(true);
    } catch {
      /* silent */
    }
  }, []);

  /* ---------- Visual helpers ----------
     Flash colors are named semantically and resolved against the live Midway
     enamel tokens so all four sub-themes match. Flash/shake are juice and are
     softened/suppressed under reduced motion; the warp jump itself still runs
     (the lanes are core to reading a jump) but at a calmer ramp. */
  const triggerFlash = useCallback((tone: "win" | "lose" | "jackpot") => {
    const rs = renderRef.current;
    const t = rs.theme;
    rs.flashColor =
      tone === "lose" ? t.primary : tone === "jackpot" ? t.ticket : t.prize;
    rs.flashAlpha = rs.reducedMotion ? 0.2 : 0.4;
  }, []);

  const triggerShake = useCallback((amount: number) => {
    const rs = renderRef.current;
    if (rs.reducedMotion) return;
    rs.shake = amount;
  }, []);

  const triggerWarp = useCallback(() => {
    const rs = renderRef.current;
    rs.targetSpeed = rs.reducedMotion ? 3.2 : 10;
    if (!rs.reducedMotion) spawnFlyby(rs); // easter-egg flyby (juice only)
    // Cruise fallback is cancellable — a result beat (death / arrival) claims
    // the throttle first and clears this so the slowdown isn't undone.
    cancelTimer(warpTimerRef.current);
    warpTimerRef.current = schedule(() => {
      warpTimerRef.current = undefined;
      rs.targetSpeed = 1.2;
    }, 700);
  }, [schedule, cancelTimer]);

  const triggerExplosion = useCallback(() => {
    if (renderRef.current.reducedMotion) return;
    spawnDebris(renderRef.current);
  }, []);

  /* ---------- Launch ---------- */
  // Synchronous lock — Space and a focused Launch key can both fire in the
  // same tick, before the isJumping state update lands.
  const launchLockRef = useRef(false);

  const handleLaunch = useCallback(async () => {
    if (isJumping || launchLockRef.current) return;
    if (balance == null) return;
    setError(null);
    if (wager > balance) {
      setError(`You need ${wager} tickets for this bet.`);
      return;
    }

    launchLockRef.current = true;
    setIsJumping(true);
    SoundManager.play("arcadeBet");
    setWalletBalances((prev) => ({ ...prev, credits: prev.credits - wager }));

    try {
      const res = await fetch("/api/wagers/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameType: "arcade-lightspeed",
          wager,
          config: {},
        }),
      });
      const data = (await res.json()) as {
        sessionId: string;
        token: string;
        error?: string;
      };
      if (!res.ok) {
        const message = machineError(
          data.error,
          "The machine could not start the run.",
        );
        setError(message);
        setStatus(message);
        setIsJumping(false);
        void refreshWallet();
        return;
      }

      tokenRef.current = data.token;
      cancelTimer(warpTimerRef.current);
      resetRunResult();
      setRevealedSeed(null);
      setRoundId(null);
      setRoundStake(wager);
      setJumpsCompleted(0);
      setCurrentMultiplier(0);
      setPayout(0);
      setActiveLane(null);
      const dest = PLANETS[Math.floor(Math.random() * PLANETS.length)]!;
      setDestination(dest);
      setStatus(`Heading for ${dest.name}. Pick a lane for jump 1.`);
      setPhase("playing");
      setIsJumping(false);

      // Sync to render state
      const rs = renderRef.current;
      rs.debris = [];
      rs.planet = dest;
      rs.planetRevealT = 0;
      rs.flybys = [];
      rs.laneTintColor = null;
      rs.laneTintAlpha = 0;
      rs.targetSpeed = 1.2;
    } catch {
      setError("The machine lost its connection. Try again.");
      setStatus("The machine lost its connection. Try again.");
      setIsJumping(false);
      void refreshWallet();
    } finally {
      launchLockRef.current = false;
    }
  }, [isJumping, wager, balance, refreshWallet, resetRunResult, cancelTimer]);

  /* ---------- Jump ---------- */
  type JumpResponse = {
    alive: boolean;
    jumpIndex: number;
    lane: number;
    jumpsCompleted: number;
    currentMultiplier: number;
    allJumpsCompleted?: boolean;
    payout?: number;
    seed?: number;
    roundId?: string | null;
    error?: string;
  };

  const handleJump = useCallback(
    async (lane: number) => {
      if (isJumping || phase !== "playing" || !tokenRef.current) return;

      setIsJumping(true);
      setActiveLane(lane);
      setPhase("jumping");
      setError(null);
      triggerWarp();
      // Input feedback for the commit itself: lane-colored tunnel wash, a
      // throttle nudge, and the warp whoosh (all calmer under reduced motion).
      const laneCfg = LANES[lane];
      if (laneCfg) {
        const rs = renderRef.current;
        rs.laneTintColor = laneCfg.color;
        rs.laneTintAlpha = rs.reducedMotion ? 0.14 : 0.26;
      }
      triggerShake(3);
      SoundManager.play("arcadeSpin");

      try {
        const res = await fetch("/api/wagers/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: tokenRef.current,
            action: "jump",
            data: { lane },
          }),
        });
        const data = (await res.json()) as JumpResponse;
        if (!res.ok) {
          const message = machineError(
            data.error,
            "The jump did not go through. Try again.",
          );
          setError(message);
          setStatus(message);
          setPhase("playing");
          setIsJumping(false);
          setActiveLane(null);
          return;
        }

        if (!data.alive) {
          captureRunResult(data);
          // DEATH — big visual feedback
          cancelTimer(warpTimerRef.current); // the crash owns the throttle now
          triggerFlash("lose");
          triggerShake(20);
          triggerExplosion();
          SoundManager.play("arcadeExplode");
          triggerFeedback("loss");
          renderRef.current.targetSpeed = 0.1;
          setJumpsCompleted(data.jumpsCompleted);
          setCurrentMultiplier(0);
          setStatus(
            `Hull breach at waypoint ${Math.min(data.jumpsCompleted + 1, WAYPOINTS)}. The run is lost.`,
          );

          schedule(() => {
            setPayout(0);
            setRevealedSeed(data.seed ?? null);
            setRoundId(data.roundId ?? null);
            setPhase("lost");
            setIsJumping(false);
            setActiveLane(null);
            void refreshWallet();
          }, 1200);
          return;
        }

        // SURVIVED
        triggerFlash("win");
        triggerShake(6);
        SoundManager.play("arcadeReveal");
        setJumpsCompleted(data.jumpsCompleted);
        setCurrentMultiplier(data.currentMultiplier);

        if (data.allJumpsCompleted) {
          captureRunResult(data);
          cancelTimer(warpTimerRef.current); // the arrival owns the throttle now
          triggerFlash("jackpot");
          triggerFeedback("jackpot");
          setStatus(
            `Arrived at ${renderRef.current.planet?.name ?? "the planet"} at ${formatMult(data.currentMultiplier)}.`,
          );
          // Start planet reveal on canvas
          const rs = renderRef.current;
          if (rs.planet) {
            rs.planetRevealT = 0.01; // kick off the reveal animation
            rs.targetSpeed = 0.3; // slow down to see the planet
          }
          schedule(() => {
            setPayout(data.payout ?? 0);
            setRevealedSeed(data.seed ?? null);
            setRoundId(data.roundId ?? null);
            setPhase("won");
            setIsJumping(false);
            setActiveLane(null);
            void refreshWallet();
          }, 1500); // longer delay so planet has time to zoom in
        } else {
          setStatus(
            `Waypoint ${data.jumpsCompleted} of ${WAYPOINTS} cleared at ${formatMult(data.currentMultiplier)}. Pick the next lane.`,
          );
          schedule(() => {
            setPhase("playing");
            setIsJumping(false);
            setActiveLane(null);
          }, 600);
        }
      } catch {
        setError("The machine lost its connection. Try the jump again.");
        setStatus("The machine lost its connection. Try the jump again.");
        setPhase("playing");
        setIsJumping(false);
        setActiveLane(null);
      }
    },
    [
      isJumping,
      phase,
      triggerFlash,
      triggerShake,
      triggerWarp,
      triggerExplosion,
      schedule,
      cancelTimer,
      refreshWallet,
      captureRunResult,
      triggerFeedback,
    ],
  );

  /* ---------- Cash out ---------- */
  const handleCashout = useCallback(async () => {
    if (isJumping || !tokenRef.current || jumpsCompleted === 0) return;
    setIsJumping(true);

    try {
      const res = await fetch("/api/wagers/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenRef.current, action: "cashout" }),
      });
      const data = (await res.json()) as {
        payout: number;
        multiplier: number;
        seed: number;
        roundId?: string | null;
        error?: string;
      };
      if (!res.ok) {
        const message = machineError(
          data.error,
          "The cash out did not go through. Try again.",
        );
        setError(message);
        setStatus(message);
        setIsJumping(false);
        return;
      }
      captureRunResult(data);

      triggerFlash(data.multiplier >= 5 ? "jackpot" : "win");
      triggerFeedback(data.multiplier >= 5 ? "jackpot" : "cashout");

      setPayout(data.payout);
      setRevealedSeed(data.seed);
      setRoundId(data.roundId ?? null);
      setStatus(
        `Cashed out at ${formatMult(data.multiplier)} for ${data.payout.toLocaleString()} tickets.`,
      );
      setPhase("won");
      setIsJumping(false);
      void refreshWallet();
    } catch {
      setError("The machine lost its connection. Try the cash out again.");
      setStatus("The machine lost its connection. Try the cash out again.");
      setIsJumping(false);
    }
  }, [
    isJumping,
    jumpsCompleted,
    triggerFlash,
    refreshWallet,
    captureRunResult,
    triggerFeedback,
  ]);

  /* ---------- Keyboard: Space launches, never cashes out; 1 2 3 jump,
     C cashes out ---------- */
  useMachineKey(
    useMemo(
      () =>
        phase === "jumping" || phase === "playing"
          ? null
          : () => void handleLaunch(),
      [phase, handleLaunch],
    ),
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isControlTarget(e.target) || isDialogOpen()) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (phase !== "playing" || isJumping) return;
      if (e.key === "1") void handleJump(0);
      else if (e.key === "2") void handleJump(1);
      else if (e.key === "3") void handleJump(2);
      else if (e.key === "c" || e.key === "C") void handleCashout();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, isJumping, handleJump, handleCashout]);

  /* ---------- Mobile: tame pull-to-refresh / long-press / selection while a
     run is live (shared game helper; releases outside gameplay). ---------- */
  usePreventGameGestures(phase === "playing" || phase === "jumping");

  /* ---------- Render ---------- */
  const isResolved = phase === "won" || phase === "lost";
  const inRun = phase === "playing" || phase === "jumping";
  const arrived = jumpsCompleted >= WAYPOINTS;
  const affordable = balance != null && wager <= balance;

  const glass = (
    <MachineGlass
      name="lightspeed"
      rules={[
        "Eight jumps to a far planet. Pick a lane at each jump; a hit takes the bet.",
      ]}
      paytable={[
        ...[0, 1, 2].map((lane) => {
          const cfg = LANES[lane]!;
          return {
            label: `${cfg.label} ${(cfg.survival * 100).toFixed(0)}%`,
            value: formatMult(cfg.displayMult),
            lit: phase === "jumping" && activeLane === lane,
          };
        }),
        { label: "top", value: `${TOP_MULTIPLIER}×` },
      ]}
    />
  );

  const screen = (
    <div className="arc-machine-fit lightspeed-screen">
      {/* HUD strip: flight instruments across the top of the window */}
      <div className="lightspeed-hud">
        <div
          className="flex items-center gap-1.5"
          aria-label={`waypoint ${Math.min(jumpsCompleted + 1, WAYPOINTS)} of ${WAYPOINTS}`}
        >
          {Array.from({ length: WAYPOINTS }).map((_, i) => (
            <span
              key={i}
              className={`h-2.5 w-2.5 rounded-full border-2 ${
                i < jumpsCompleted
                  ? "border-ink bg-prize"
                  : i === jumpsCompleted && inRun
                    ? "border-ink bg-info"
                    : "border-soft bg-well"
              }`}
            />
          ))}
        </div>
        {destination && (
          <span className="min-w-0 truncate text-sm font-semibold">
            {destination.name}
          </span>
        )}
        <span className="arcade-num text-lg font-semibold">
          {formatMult(currentMultiplier)}
        </span>
      </div>

      {/* The cockpit window: the canvas keeps its own playfield rendering */}
      <canvas
        ref={setCanvas}
        width={CANVAS_W * 2}
        height={CANVAS_H * 2}
        className="lightspeed-window"
        role="img"
        aria-label={
          destination
            ? `cockpit view, starfield streaming past on the way to ${destination.name}`
            : "cockpit view, an idle starfield waiting for launch"
        }
      />

      <p role="status" aria-live="polite" className="arc-machine-status">
        {status || "Eight jumps to a far planet."}
      </p>

      <div
        className="lightspeed-lanes grid grid-cols-3 gap-1.5"
        role="group"
        aria-label="jump lanes"
      >
        {[0, 1, 2].map((lane) => {
          const cfg = LANES[lane]!;
          const Icon = LANE_ICON[cfg.icon];
          return (
            <ArcadeButton
              key={lane}
              tone={LANE_TONE[lane]!}
              size="md"
              disabled={phase !== "playing" || isJumping}
              pressed={phase === "jumping" && activeLane === lane}
              onClick={() => void handleJump(lane)}
              aria-label={`jump ${cfg.label}, ${(cfg.survival * 100).toFixed(0)} percent survival, ${formatMult(cfg.displayMult)}`}
              className="flex-col gap-0.5 !py-2"
            >
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
                <Icon size={14} aria-hidden />
                {cfg.label}
              </span>
              <span className="arcade-num text-[11px] opacity-80">
                {(cfg.survival * 100).toFixed(0)}% ·{" "}
                {formatMult(cfg.displayMult)}
              </span>
            </ArcadeButton>
          );
        })}
      </div>
    </div>
  );

  const action = inRun ? (
    <MachineButton
      onClick={() => void handleCashout()}
      disabled={jumpsCompleted === 0}
      aria-disabled={phase === "jumping" || isJumping || undefined}
      aria-label={
        jumpsCompleted === 0
          ? "cash out, jump once first"
          : `cash out at ${formatMult(currentMultiplier)}`
      }
    >
      cash out
    </MachineButton>
  ) : (
    <MachineButton
      onClick={() => void handleLaunch()}
      disabled={!affordable}
      aria-disabled={isJumping || undefined}
      aria-label={`launch, ${wager} tickets`}
    >
      launch
    </MachineButton>
  );

  const waypointHit = Math.min(jumpsCompleted + 1, WAYPOINTS);
  const receipt = isResolved ? (
    <ArcadeWagerResultPlate
      result={{
        payout: phase === "won" ? payout : 0,
        stake: roundStake,
        multiplier: phase === "won" ? currentMultiplier : 0,
        jackpot: arrived,
      }}
      kicker="lightspeed"
      headline={
        phase === "won" ? formatMult(currentMultiplier) : "hull breach"
      }
      detail={
        phase === "won"
          ? arrived
            ? `arrived at ${destination?.name ?? "the planet"}, ${WAYPOINTS} jumps`
            : `${jumpsCompleted} of ${WAYPOINTS} jumps, cashed out`
          : `hit at waypoint ${waypointHit} of ${WAYPOINTS}`
      }
      fairness={{ seedHash: null, revealedSeed }}
      achievements={achievements}
      roundId={roundId ?? undefined}
      sound={false}
    />
  ) : null;

  return (
    <GameShell
      game="lightspeed"
      stat={<GameStat value={`${TOP_MULTIPLIER}×`} label="top" />}
      howTo={HOW_TO}
      tickets={balance ?? undefined}
    >
      <ArcadeMachine
        name="lightspeed"
        glass={glass}
        action={action}
        bet={{
          value: wager,
          onChange: setWager,
          balance,
          disabled: roundPlaying,
        }}
        receipt={receipt}
        receiptKey={roundId}
        notice={error}
      >
        {screen}
      </ArcadeMachine>

      <style jsx global>{`
        /* phones: room for the window and the lane keys */
        .arc-shell[data-game="lightspeed"]
          .arc-machine-frame:not([data-wide]) {
          --machine-screen-min: 22rem;
        }
        .lightspeed-hud {
          display: flex;
          flex: none;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem;
          width: min(100%, 40rem);
          color: var(--tixy-on-ink-2);
        }
        .lightspeed-window {
          display: block;
          flex: none;
          /* the widest 640 by 340 window that fits under the HUD, the
             status line and the lane keys */
          width: min(100%, 40rem, (100cqh - 11rem) * 640 / 340);
          aspect-ratio: 640 / 340;
          border-radius: 0.5rem;
        }
        .lightspeed-lanes {
          flex: none;
          width: min(100%, 40rem);
        }
      `}</style>
    </GameShell>
  );
}
