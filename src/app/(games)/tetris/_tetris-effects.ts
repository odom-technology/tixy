// ---------------------------------------------------------------------------
// Tetris — Board Feedback Effects
// Purely cosmetic layer: lock flash, hard-drop impact rings, line-clear
// particle bursts, and a board shake. All state lives in fixed-size pools so
// the 60fps render path never allocates after warmup. Everything is expressed
// in board-cell coordinates; the renderer maps cells to pixels.
//
// This module never touches game rules — it only observes events the engine
// already emits (piece lock, hard drop, line clear, game over).
// ---------------------------------------------------------------------------

import { COLS, HIDDEN_ROWS, TOTAL_ROWS, type PieceType } from './_tetris-config';

// ---------------------------------------------------------------------------
// Deterministic cosmetic RNG. Effects must NOT consume the shared
// Math.random stream — the 7-bag randomizer draws from it, and particle
// bursts firing between bag refills would otherwise shift the piece sequence
// mid-run. Cosmetic randomness gets its own stream.
// ---------------------------------------------------------------------------
let fxRngState = 0x2f6e2b1;
function fxRandom(): number {
  fxRngState |= 0;
  fxRngState = (fxRngState + 0x6d2b79f5) | 0;
  let t = Math.imul(fxRngState ^ (fxRngState >>> 15), 1 | fxRngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// A locked piece's cells in absolute board coordinates (hidden rows included).
export type LockedCell = { x: number; y: number; type: PieceType };

const MAX_PARTICLES = 160;
const MAX_IMPACTS = 4;

const LOCK_FLASH_MS = 140;
const IMPACT_MS = 260;
const PARTICLE_GRAVITY = 26; // cells / s^2 — gentle arcade fall

type Particle = {
  active: boolean;
  x: number; // board-cell space
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number; // fraction of a cell
  color: string;
};

type Impact = {
  active: boolean;
  row: number; // visible board row (absolute, hidden rows included)
  colCenter: number; // fractional column of the impact center
  halfWidth: number; // in cells
  timer: number;
  color: string;
  size: number; // 0..100 theme intensity
};

export class TetrisFx {
  /** Set from prefers-reduced-motion; suppresses shake + particles. */
  reducedMotion = false;

  // Lock flash — a brief bright wash over the just-locked piece cells.
  lockFlashCells: LockedCell[] = [];
  lockFlashTimer = 0;
  lockFlashColor = '#ffffff';
  lockFlashIntensity = 0;

  // Board shake (Tetris / T-Spin clears only).
  shakeTimer = 0;
  shakeDuration = 0;
  shakeMagnitude = 0; // in pixels at render scale 1 cell

  private readonly particles: Particle[] = [];
  private readonly impacts: Impact[] = [];

  constructor() {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        active: false, x: 0, y: 0, vx: 0, vy: 0,
        life: 0, maxLife: 1, size: 0.2, color: '#ffffff',
      });
    }
    for (let i = 0; i < MAX_IMPACTS; i++) {
      this.impacts.push({
        active: false, row: 0, colCenter: 0, halfWidth: 1,
        timer: 0, color: '#ffffff', size: 50,
      });
    }
  }

  reset() {
    this.lockFlashCells.length = 0;
    this.lockFlashTimer = 0;
    this.shakeTimer = 0;
    this.shakeDuration = 0;
    for (const p of this.particles) p.active = false;
    for (const im of this.impacts) im.active = false;
  }

  // ---------------------------------------------------------------------------
  // Event hooks (called from engine callbacks in the client)
  // ---------------------------------------------------------------------------

  /** Brief bright wash over the cells a piece just locked into. */
  onPieceLock(cells: LockedCell[], color: string, intensity: number) {
    if (cells.length === 0) return;
    this.lockFlashCells.length = 0;
    for (const c of cells) this.lockFlashCells.push(c);
    this.lockFlashTimer = LOCK_FLASH_MS;
    this.lockFlashColor = color;
    this.lockFlashIntensity = intensity;
  }

  /** Impact ring + dust where a hard drop landed. */
  onHardDrop(cells: LockedCell[], color: string, size: number) {
    if (cells.length === 0) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of cells) {
      if (c.x < minX) minX = c.x;
      if (c.x > maxX) maxX = c.x;
      if (c.y > maxY) maxY = c.y;
    }
    const slot = this.nextImpact();
    slot.active = true;
    slot.row = maxY;
    slot.colCenter = (minX + maxX + 1) / 2;
    slot.halfWidth = Math.max(1, (maxX - minX + 1) / 2);
    slot.timer = IMPACT_MS;
    slot.color = color;
    slot.size = size;

    if (!this.reducedMotion) {
      // Dust kicked out of the landing row — a handful per piece, not per cell.
      const count = Math.min(10, cells.length * 3);
      for (let i = 0; i < count; i++) {
        const c = cells[i % cells.length];
        this.spawnParticle(
          c.x + 0.5,
          maxY + 0.9,
          (fxRandom() - 0.5) * 7,
          -(1.5 + fxRandom() * 3.5),
          240 + fxRandom() * 160,
          0.1 + fxRandom() * 0.12,
          color,
        );
      }
    }
  }

  /** Particle burst along cleared rows; `colors` maps row → cell colors. */
  onLineClear(rows: number[], rowColors: (row: number) => string[]) {
    if (this.reducedMotion) return;
    for (const row of rows) {
      if (row < HIDDEN_ROWS) continue;
      const colors = rowColors(row);
      for (let col = 0; col < COLS; col++) {
        this.spawnParticle(
          col + 0.5,
          row + 0.5,
          (fxRandom() - 0.5) * 5,
          -(3 + fxRandom() * 5),
          320 + fxRandom() * 240,
          0.14 + fxRandom() * 0.14,
          colors[col] ?? '#ffffff',
        );
      }
    }
  }

  /** Short, sharp board shake for difficult clears (Tetris / T-Spin). */
  onDifficultClear() {
    if (this.reducedMotion) return;
    this.shakeTimer = 220;
    this.shakeDuration = 220;
    this.shakeMagnitude = 0.16; // fraction of a cell
  }

  // ---------------------------------------------------------------------------
  // Frame update — advance timers; dead particles are recycled in place.
  // ---------------------------------------------------------------------------

  update(dtMs: number) {
    if (this.lockFlashTimer > 0) {
      this.lockFlashTimer -= dtMs;
      if (this.lockFlashTimer <= 0) {
        this.lockFlashTimer = 0;
        this.lockFlashCells.length = 0;
      }
    }
    if (this.shakeTimer > 0) {
      this.shakeTimer -= dtMs;
      if (this.shakeTimer < 0) this.shakeTimer = 0;
    }
    for (const im of this.impacts) {
      if (!im.active) continue;
      im.timer -= dtMs;
      if (im.timer <= 0) im.active = false;
    }
    if (this.reducedMotion) return;
    const dt = dtMs / 1000;
    for (const p of this.particles) {
      if (!p.active) continue;
      p.life -= dtMs;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.vy += PARTICLE_GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.y >= TOTAL_ROWS) {
        // Land on the floor with a tiny bounce instead of falling through.
        p.y = TOTAL_ROWS - 0.05;
        p.vy *= -0.35;
        p.vx *= 0.6;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Render-time iteration (allocation-free readers for the renderer)
  // ---------------------------------------------------------------------------

  /** Current shake offset in cell units (0 when idle / reduced motion). */
  shakeOffset(nowMs: number): { x: number; y: number } {
    if (this.shakeTimer <= 0 || this.shakeDuration <= 0) return { x: 0, y: 0 };
    const t = this.shakeTimer / this.shakeDuration;
    const amp = this.shakeMagnitude * t * t;
    return {
      x: Math.sin(nowMs * 0.11) * amp,
      y: Math.cos(nowMs * 0.147) * amp * 0.6,
    };
  }

  forEachParticle(cb: (p: Particle, alpha: number) => void) {
    if (this.reducedMotion) return;
    for (const p of this.particles) {
      if (!p.active) continue;
      const alpha = Math.min(1, (p.life / p.maxLife) * 1.6);
      cb(p, alpha);
    }
  }

  forEachImpact(cb: (im: Impact, progress: number) => void) {
    for (const im of this.impacts) {
      if (!im.active) continue;
      cb(im, 1 - im.timer / IMPACT_MS);
    }
  }

  /** Lock flash alpha 0..1 for the current frame. */
  get lockFlashAlpha(): number {
    if (this.lockFlashTimer <= 0) return 0;
    return (this.lockFlashTimer / LOCK_FLASH_MS) * (this.lockFlashIntensity / 100);
  }

  private spawnParticle(
    x: number,
    y: number,
    vx: number,
    vy: number,
    lifeMs: number,
    size: number,
    color: string,
  ) {
    for (const p of this.particles) {
      if (p.active) continue;
      p.active = true;
      p.x = x;
      p.y = y;
      p.vx = vx;
      p.vy = vy;
      p.life = lifeMs;
      p.maxLife = lifeMs;
      p.size = size;
      p.color = color;
      return;
    }
    // Pool exhausted — drop the particle rather than allocate.
  }

  private nextImpact(): Impact {
    for (const im of this.impacts) {
      if (!im.active) return im;
    }
    // All slots busy — recycle the oldest (first) slot.
    return this.impacts[0];
  }
}
