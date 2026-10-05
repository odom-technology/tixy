/* Stacker's cabinet, drawn. The grid of lamps, the tower in ticket amber,
   the moving row in red, the prize marks at rows 11 and 15, and the
   overhang that falls off and breaks. Pure canvas: it reads the engine's
   view, the run's clock and an effects list.

   Scoring is per lamp, but the moving row is drawn gliding, at the
   display's refresh rate: `stackerGlideLeft` puts it on lamp k at the
   middle of step k, so the lamp nearest the drawn row is always the lamp a
   stop lights, and it slows into each wall and back out. A short smear
   trails it. A stop settles the row into its sockets in 70 ms with a squash
   on the spring curve; a perfect stop flashes it and throws a ring; lost
   lamps fall from where they were drawn, under gravity, spin, dim and break.
   Under reduced motion the row steps lamp to lamp and nothing squashes. */

import {
  STACKER_COLUMNS,
  STACKER_MAJOR_ROW,
  STACKER_MINOR_ROW,
  STACKER_ROWS,
  stackerGlideLeft,
  type StackerLayout,
  type StackerView,
} from '@/server/arcade/stack-cabinet-engine';

import { settleEase, squashAt } from '@/features/arcade/lib/game-feel';
import { mixHex } from '@/features/arcade/lib/skins/skin-set';
import { drawSkinMaterial, drawSkinPiece, type StackSkinLook } from './_stack-skin-draw';

export const STACKER_COLORS = {
  screen: '#2A231D',
  unlit: '#3A3029',
  amber: '#F2A33C',
  red: '#B83627',
  /** A lamp at full heat: the red row's core and every flash. */
  hot: '#F7E7C6',
  lit: '#F7E7C6',
} as const;

/** Room the prize stubs need to the right of the grid, CSS px. */
const STUB_ROOM = 64;

export type StackerGeometry = {
  width: number;
  height: number;
  /** Lamp pitch (lamp plus gap), CSS px. */
  pitch: number;
  /** Lamp size, CSS px. */
  lamp: number;
  gridX: number;
  gridY: number;
  gridW: number;
  gridH: number;
  /** Where falling lamps land and break: the cabinet floor. */
  floorY: number;
  /** The prize stubs' left edge. */
  stubX: number;
  /** The callout band above the grid. */
  hudTop: number;
  hudH: number;
};

export function stackerGeometry(width: number, height: number): StackerGeometry {
  const hudH = Math.round(Math.max(28, Math.min(48, height * 0.07)));
  const markRoom = 14;
  const padY = Math.max(10, height * 0.025);
  const byHeight = (height - hudH - padY * 2) / STACKER_ROWS;
  const byWidth = (width - 2 * markRoom - 8 - STUB_ROOM - 16) / STACKER_COLUMNS;
  const pitch = Math.max(8, Math.floor(Math.min(byHeight, byWidth)));
  const lamp = Math.max(6, Math.round(pitch * 0.86));
  const gridW = pitch * STACKER_COLUMNS;
  const gridH = pitch * STACKER_ROWS;
  // Centre the grid, its marks and the stubs together.
  const compositionW = markRoom + gridW + markRoom + 8 + STUB_ROOM;
  const gridX = Math.round((width - compositionW) / 2 + markRoom);
  const gridY = Math.round(hudH + (height - hudH - gridH) / 2);
  return {
    width,
    height,
    pitch,
    lamp,
    gridX,
    gridY,
    gridW,
    gridH,
    floorY: gridY + gridH,
    stubX: gridX + gridW + markRoom + 8,
    hudTop: Math.max(0, gridY - hudH - 4),
    hudH,
  };
}

/** Screen x of a column's lamp, and y of a row's (row 0 is the bottom). */
export const lampX = (g: StackerGeometry, col: number) => g.gridX + col * g.pitch + (g.pitch - g.lamp) / 2;
export const lampY = (g: StackerGeometry, row: number) =>
  g.gridY + (STACKER_ROWS - 1 - row) * g.pitch + (g.pitch - g.lamp) / 2;
export const rowCentreY = (g: StackerGeometry, row: number) => lampY(g, row) + g.lamp / 2;

// ── Effects (render only; never read by the engine) ─────────────────────

/** A lamp that fell off the row. Times are on the effects clock. */
export type FallingLamp = {
  /** Fractional: it falls from where the gliding row was drawn. */
  col: number;
  row: number;
  color: string;
  t0: number;
  /** Sideways drift, lamps per second, away from the tower. */
  drift: number;
  /** Radians per second. */
  spin: number;
  landed: boolean;
};

export type Shard = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  t0: number;
};

/** A row that just stopped: it pulses (every stop) or flashes (perfect).
 *  `fromDx` is how far, in lamps, the drawn row was from its sockets at the
 *  stop; it settles in over SETTLE_MS. */
export type RowPulse = { row: number; left: number; width: number; t0: number; perfect: boolean; fromDx: number };

/** A light that runs up the tower: the row 11 and row 15 moments. */
export type TowerChase = { t0: number; rows: number; laps: number; color: string };

export const PULSE_MS = 140;
export const FLASH_MS = 220;
export const RING_MS = 380;
export const SHARD_MS = 560;
/** A stopped row slides the last fraction of a lamp into its sockets. */
export const SETTLE_MS = 70;
/** The gliding row's smear: copies this many ms behind it. */
const SMEAR_MS = [14, 28];
/** Per row of the chase, and how long a row stays lit as it passes. */
export const CHASE_ROW_MS = 34;
const CHASE_HOLD_MS = 120;
/** Gravity in pitches per ms², so a lamp falls 15 rows in about 0.5 s. */
const GRAVITY = 0.00012;

export function chaseDurationMs(chase: TowerChase) {
  return chase.laps * chase.rows * CHASE_ROW_MS + CHASE_HOLD_MS;
}

/** Where a falling lamp is `ms` after it let go, and whether it has landed. */
export function fallingLampAt(g: StackerGeometry, lamp: FallingLamp, ms: number) {
  const startY = lampY(g, lamp.row);
  const y = startY + 0.5 * GRAVITY * g.pitch * ms * ms;
  const floor = g.floorY - g.lamp;
  return {
    x: lampX(g, lamp.col) + (lamp.drift * g.pitch * ms) / 1000,
    y: Math.min(y, floor),
    angle: (lamp.spin * ms) / 1000,
    landed: y >= floor,
  };
}

/** Pieces a lamp breaks into when it lands. Render-only randomness. */
export function shatterLamp(
  g: StackerGeometry,
  x: number,
  y: number,
  color: string,
  t0: number,
  hot: string = STACKER_COLORS.hot,
): Shard[] {
  const shards: Shard[] = [];
  const count = 7;
  for (let i = 0; i < count; i += 1) {
    const angle = Math.PI + (Math.PI * (i + 0.5)) / count + (Math.random() - 0.5) * 0.5;
    const speed = g.pitch * (0.004 + Math.random() * 0.004);
    shards.push({
      x: x + g.lamp / 2,
      y: y + g.lamp * 0.7,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed * 1.5,
      size: Math.max(2, g.lamp * (0.14 + Math.random() * 0.16)),
      color: i % 3 === 0 ? hot : color,
      t0,
    });
  }
  return shards;
}

// ── Lamp sprites ────────────────────────────────────────────────────────
// A lit lamp is a rounded square with a hot core and a halo. Drawn once per
// colour and size into an offscreen canvas, then blitted: shadowBlur per
// lamp per frame costs too much on a throttled phone.

type Sprite = { canvas: HTMLCanvasElement; pad: number };
const spriteCache = new Map<string, Sprite>();

function lampSprite(color: string, lamp: number, dpr: number): Sprite | null {
  if (typeof document === 'undefined') return null;
  const key = `${color}:${lamp}:${dpr}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  const pad = Math.ceil(lamp * 0.5);
  const size = lamp + pad * 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(size * dpr);
  canvas.height = Math.ceil(size * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  const r = Math.max(1.5, lamp * 0.14);
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = lamp * 0.55;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(pad, pad, lamp, lamp, r);
  ctx.fill();
  ctx.restore();
  // The hot core: a soft lighter centre, like a bulb behind a lens.
  const core = ctx.createRadialGradient(pad + lamp / 2, pad + lamp * 0.42, 0, pad + lamp / 2, pad + lamp / 2, lamp * 0.62);
  core.addColorStop(0, 'rgb(255 248 230 / 0.55)');
  core.addColorStop(1, 'rgb(255 248 230 / 0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.roundRect(pad, pad, lamp, lamp, r);
  ctx.fill();
  if (spriteCache.size > 24) spriteCache.clear();
  const sprite = { canvas, pad };
  spriteCache.set(key, sprite);
  return sprite;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function drawLit(
  ctx: CanvasRenderingContext2D,
  g: StackerGeometry,
  dpr: number,
  color: string,
  col: number,
  row: number,
  alpha = 1,
  dy = 0,
  skin: StackSkinLook | null = null,
) {
  const sprite = skin ? null : lampSprite(color, g.lamp, dpr);
  const x = lampX(g, col);
  const y = lampY(g, row) + dy;
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  if (skin) {
    // A skin set's lamp: its shape, flat, with no halo.
    drawSkinPiece(ctx, skin, x, y, g.lamp, g.lamp, color);
  } else if (sprite) {
    const size = g.lamp + sprite.pad * 2;
    ctx.drawImage(sprite.canvas, x - sprite.pad, y - sprite.pad, size, size);
  } else {
    ctx.fillStyle = color;
    roundRect(ctx, x, y, g.lamp, g.lamp, g.lamp * 0.14);
  }
  ctx.restore();
}

// ── The frame ───────────────────────────────────────────────────────────

export type StackerDrawState = {
  layout: StackerLayout | null;
  view: StackerView | null;
  /** Run clock for this frame (with the display lead), ms since the run began. */
  runMs: number;
  /** Effects clock, ms; stands still through a hit-stop. */
  now: number;
  falling: readonly FallingLamp[];
  shards: readonly Shard[];
  pulse: RowPulse | null;
  chase: TowerChase | null;
  minorBanked: boolean;
  majorBanked: boolean;
  /** The run ended on a miss: the tower dims. */
  missed: boolean;
  reducedMotion: boolean;
  dpr: number;
  /** An equipped skin set (SKINS.md). Null draws the house cabinet. */
  skin?: StackSkinLook | null;
};

export function drawStacker(ctx: CanvasRenderingContext2D, g: StackerGeometry, s: StackerDrawState) {
  const { view } = s;
  const skin = s.skin ?? null;
  const radius = Math.max(1.5, g.lamp * 0.14);
  // A skin set recolours the cabinet and keeps every lamp where it is.
  const palette = skin
    ? { amber: skin.block, red: skin.blockAlt, hot: skin.hot, prize: skin.prize, mark: mixHex(skin.ground, skin.prize, 0.6) }
    : {
        amber: STACKER_COLORS.amber,
        red: STACKER_COLORS.red,
        hot: STACKER_COLORS.hot,
        prize: STACKER_COLORS.amber,
        mark: 'rgb(247 231 198 / 0.7)',
      };
  if (skin) {
    drawSkinMaterial(ctx, skin, g.width, g.height, g.pitch, g.gridX, g.gridY, {
      x: g.gridX - 3,
      y: g.gridY - 3,
      w: g.gridW + 6,
      h: g.gridH + 6,
    });
  } else {
    ctx.fillStyle = STACKER_COLORS.screen;
    ctx.fillRect(0, 0, g.width, g.height);
  }

  // Unlit lamps first, every one.
  ctx.fillStyle = skin ? skin.unlit : STACKER_COLORS.unlit;
  for (let row = 0; row < STACKER_ROWS; row += 1) {
    for (let col = 0; col < STACKER_COLUMNS; col += 1) {
      if (skin) drawSkinPiece(ctx, skin, lampX(g, col), lampY(g, row), g.lamp, g.lamp, skin.unlit, false);
      else roundRect(ctx, lampX(g, col), lampY(g, row), g.lamp, g.lamp, radius);
    }
  }

  // The prize rows: a mark either side of the grid, amber once banked.
  const markW = Math.max(6, g.pitch * 0.32);
  ctx.lineWidth = 2;
  ctx.lineCap = 'butt';
  for (const [row, banked] of [
    [STACKER_MINOR_ROW - 1, s.minorBanked],
    [STACKER_MAJOR_ROW - 1, s.majorBanked],
  ] as const) {
    const y = Math.round(rowCentreY(g, row)) + 0.5;
    ctx.strokeStyle = banked ? palette.prize : palette.mark;
    ctx.beginPath();
    ctx.moveTo(g.gridX - 5 - markW, y);
    ctx.lineTo(g.gridX - 5, y);
    ctx.moveTo(g.gridX + g.gridW + 5, y);
    ctx.lineTo(g.gridX + g.gridW + 5 + markW, y);
    ctx.stroke();
  }

  // The tower, in amber. The row that just stopped settles into its
  // sockets, squashes on landing and glows.
  const tower = view?.state.tower ?? [];
  const pulseMs = s.pulse ? s.now - s.pulse.t0 : Infinity;
  const pulseK = s.pulse && !s.reducedMotion ? pulseMs / (s.pulse.perfect ? FLASH_MS : PULSE_MS) : 1;
  const towerAlpha = s.missed ? 0.55 : 1;
  tower.forEach((span, row) => {
    const landing = !s.reducedMotion && s.pulse !== null && s.pulse.row === row && pulseMs >= 0;
    const pulsing = landing && pulseK < 1;
    // The slide into the sockets, on the settle curve.
    const dx = landing ? s.pulse!.fromDx * (1 - settleEase(Math.min(1, pulseMs / SETTLE_MS))) : 0;
    const squash = landing ? squashAt(pulseMs, { force: s.pulse!.perfect ? 0.5 : 0.35, reduced: false }) : null;
    const squashed = squash !== null && (squash.scaleX !== 1 || squash.scaleY !== 1);
    if (squashed) {
      const cx = lampX(g, span.left + dx) + (span.width * g.pitch - (g.pitch - g.lamp)) / 2;
      const by = lampY(g, row) + g.lamp;
      ctx.save();
      ctx.translate(cx, by);
      ctx.scale(squash!.scaleX, squash!.scaleY);
      ctx.translate(-cx, -by);
    }
    for (let c = span.left; c < span.left + span.width; c += 1) {
      drawLit(ctx, g, s.dpr, palette.amber, c + dx, row, towerAlpha, 0, skin);
      if (pulsing) {
        // Every stop heats the row; a perfect one goes white-hot.
        const heat = (s.pulse!.perfect ? 0.95 : 0.5) * (1 - pulseK);
        drawLit(ctx, g, s.dpr, palette.hot, c + dx, row, heat, 0, skin);
      }
    }
    if (squashed) ctx.restore();
  });

  // The chase: a band of light runs up the tower (row 11, row 15).
  if (s.chase && !s.reducedMotion) {
    const ms = s.now - s.chase.t0;
    const total = chaseDurationMs(s.chase);
    if (ms >= 0 && ms < total) {
      const lapMs = s.chase.rows * CHASE_ROW_MS;
      tower.forEach((span, row) => {
        if (row >= s.chase!.rows) return;
        for (let lap = 0; lap < s.chase!.laps; lap += 1) {
          const at = lap * lapMs + row * CHASE_ROW_MS;
          const since = ms - at;
          if (since < 0 || since > CHASE_HOLD_MS) continue;
          const glow = 1 - since / CHASE_HOLD_MS;
          for (let c = span.left; c < span.left + span.width; c += 1) {
            drawLit(ctx, g, s.dpr, s.chase!.color, c, row, glow, 0, skin);
          }
        }
      });
    }
  }

  // The moving row, in red, gliding, with a short smear behind it.
  if (view?.moving && view.phase !== 'done' && s.layout) {
    const { moving } = view;
    let left = moving.left;
    if (view.phase === 'move' && !s.reducedMotion) {
      const elapsed = Math.max(0, s.runMs - view.rowStartMs);
      left = stackerGlideLeft(s.layout, view.row, moving.width, elapsed);
      for (let k = SMEAR_MS.length - 1; k >= 0; k -= 1) {
        const back = stackerGlideLeft(s.layout, view.row, moving.width, Math.max(0, elapsed - SMEAR_MS[k]));
        if (Math.abs(back - left) < 0.02) continue;
        for (let c = 0; c < moving.width; c += 1) {
          drawLit(ctx, g, s.dpr, palette.red, back + c, view.row, 0.32 / (k + 1), 0, skin);
        }
      }
    }
    for (let c = 0; c < moving.width; c += 1) {
      drawLit(ctx, g, s.dpr, palette.red, left + c, view.row, view.phase === 'move' ? 1 : 0.8, 0, skin);
    }
  }

  // A perfect stop throws a ring off the row.
  if (s.pulse?.perfect && !s.reducedMotion) {
    const k = (s.now - s.pulse.t0) / RING_MS;
    if (k >= 0 && k < 1) {
      const ease = 1 - Math.pow(1 - k, 3);
      const x = lampX(g, s.pulse.left) - (g.pitch - g.lamp) / 2;
      const y = lampY(g, s.pulse.row) - (g.pitch - g.lamp) / 2;
      const w = s.pulse.width * g.pitch;
      const grow = g.pitch * 0.9 * ease;
      ctx.save();
      ctx.globalAlpha = 0.9 * (1 - k);
      ctx.strokeStyle = palette.hot;
      ctx.lineWidth = Math.max(1.5, g.pitch * 0.08);
      ctx.beginPath();
      ctx.roundRect(x - grow, y - grow * 0.6, w + grow * 2, g.pitch + grow * 1.2, radius * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // The cabinet floor the overhang lands on.
  ctx.fillStyle = 'rgb(247 231 198 / 0.14)';
  ctx.fillRect(g.gridX - 4, g.floorY + 2, g.gridW + 8, 2);

  // Lamps falling off, then their pieces. A lamp dims as it falls, the way
  // a cut-off filament cools.
  for (const lamp of s.falling) {
    if (lamp.landed) continue;
    const fallMs = Math.max(0, s.now - lamp.t0);
    const at = fallingLampAt(g, lamp, fallMs);
    ctx.save();
    ctx.globalAlpha = 1 - 0.45 * Math.min(1, fallMs / 450);
    ctx.translate(at.x + g.lamp / 2, at.y + g.lamp / 2);
    ctx.rotate(at.angle);
    const sprite = skin ? null : lampSprite(lamp.color, g.lamp, s.dpr);
    if (skin) {
      drawSkinPiece(ctx, skin, -g.lamp / 2, -g.lamp / 2, g.lamp, g.lamp, lamp.color);
    } else if (sprite) {
      const size = g.lamp + sprite.pad * 2;
      ctx.drawImage(sprite.canvas, -g.lamp / 2 - sprite.pad, -g.lamp / 2 - sprite.pad, size, size);
    } else {
      ctx.fillStyle = lamp.color;
      roundRect(ctx, -g.lamp / 2, -g.lamp / 2, g.lamp, g.lamp, radius);
    }
    ctx.restore();
  }
  for (const shard of s.shards) {
    const ms = s.now - shard.t0;
    if (ms < 0 || ms > SHARD_MS) continue;
    const x = shard.x + shard.vx * ms;
    const y = Math.min(g.floorY, shard.y + shard.vy * ms + GRAVITY * g.pitch * ms * ms);
    ctx.save();
    ctx.globalAlpha = 1 - ms / SHARD_MS;
    ctx.fillStyle = shard.color;
    ctx.translate(x, y);
    ctx.rotate(ms * 0.02 + shard.size);
    ctx.fillRect(-shard.size / 2, -shard.size / 2, shard.size, shard.size);
    ctx.restore();
  }
}
