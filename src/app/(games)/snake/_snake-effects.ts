// ---------------------------------------------------------------------------
// Snake — Board Feedback Effects
// Purely cosmetic layer: eat bursts, floating score popups, a death flash,
// and a win burst. All state lives in fixed-size pools so the render path
// never allocates after warmup. Coordinates are board pixels (BASE_* space).
//
// This module never touches game rules — it only observes events the run
// loop already emits (food eaten, collision, win).
// ---------------------------------------------------------------------------

import { calloutLifeMs } from '@/features/arcade/components/gameplay/callout-motion';

const MAX_PARTICLES = 120;
const MAX_POPUPS = 6;

// A score popup is the tixy callout, drawn on the board: it lives as long as
// a callout does, and its motion is the callout's own curve.
const FLASH_MS = 320;

// ---------------------------------------------------------------------------
// Deterministic cosmetic RNG. Effects must NOT consume the shared
// Math.random stream — the guest-run seed is drawn from it, and cosmetic
// bursts must never shift gameplay-affecting randomness.
// ---------------------------------------------------------------------------
let fxRngState = 0x1b873593;
function fxRandom(): number {
  fxRngState |= 0;
  fxRngState = (fxRngState + 0x6d2b79f5) | 0;
  let t = Math.imul(fxRngState ^ (fxRngState >>> 15), 1 | fxRngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

type Particle = {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number; // px
  color: string;
};

type Popup = {
  active: boolean;
  x: number;
  y: number;
  text: string;
  timer: number;
  /** How long it lives, ms. */
  life: number;
};

export class SnakeFx {
  /** Set from prefers-reduced-motion; suppresses particles + flash. A popup
   *  still shows, in place, and fades. */
  reducedMotion = false;

  // Death flash — a short red wash over the board on collision.
  flashTimer = 0;
  flashColor = 'rgba(200, 40, 30, 0.35)';

  private readonly particles: Particle[] = [];
  private readonly popups: Popup[] = [];

  constructor() {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        active: false, x: 0, y: 0, vx: 0, vy: 0,
        life: 0, maxLife: 1, size: 3, color: '#ffffff',
      });
    }
    for (let i = 0; i < MAX_POPUPS; i++) {
      this.popups.push({
        active: false, x: 0, y: 0, text: '', timer: 0, life: 1,
      });
    }
  }

  reset() {
    this.flashTimer = 0;
    for (const p of this.particles) p.active = false;
    for (const p of this.popups) p.active = false;
  }

  // ---------------------------------------------------------------------------
  // Event hooks (called from the run loop)
  // ---------------------------------------------------------------------------

  /** Food eaten: radial burst in the food color + a floating score popup. */
  onEat(x: number, y: number, color: string, label: string) {
    this.spawnPopup(x, y, label);
    if (this.reducedMotion) return;
    const count = 12;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + fxRandom() * 0.5;
      const speed = 60 + fxRandom() * 110;
      this.spawnParticle(
        x,
        y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed - 40,
        320 + fxRandom() * 220,
        2 + fxRandom() * 3,
        color,
      );
    }
  }

  /** Collision: impact burst at the death point + a board-wide red flash. */
  onDeath(x: number, y: number, color: string) {
    if (this.reducedMotion) return;
    this.flashTimer = FLASH_MS;
    const count = 18;
    for (let i = 0; i < count; i++) {
      const angle = fxRandom() * Math.PI * 2;
      const speed = 80 + fxRandom() * 160;
      this.spawnParticle(
        x,
        y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        380 + fxRandom() * 260,
        2.5 + fxRandom() * 3.5,
        color,
      );
    }
  }

  /** Board cleared: celebratory burst centered on the head. */
  onWin(x: number, y: number, colors: readonly string[]) {
    if (this.reducedMotion) return;
    const count = 36;
    for (let i = 0; i < count; i++) {
      const angle = fxRandom() * Math.PI * 2;
      const speed = 100 + fxRandom() * 220;
      this.spawnParticle(
        x,
        y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed - 120,
        600 + fxRandom() * 500,
        2.5 + fxRandom() * 3.5,
        colors[i % colors.length],
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Frame update — advance timers; dead particles are recycled in place.
  // ---------------------------------------------------------------------------

  update(dtMs: number) {
    if (this.flashTimer > 0) {
      this.flashTimer -= dtMs;
      if (this.flashTimer < 0) this.flashTimer = 0;
    }
    const dt = dtMs / 1000;
    for (const p of this.particles) {
      if (!p.active) continue;
      p.life -= dtMs;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.vy += 340 * dt; // light gravity so bursts arc and settle
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (const p of this.popups) {
      if (!p.active) continue;
      p.timer -= dtMs;
      if (p.timer <= 0) {
        p.active = false;
        continue;
      }
    }
  }

  /** Death-flash alpha for the current frame (0 when idle). */
  get flashAlpha(): number {
    if (this.flashTimer <= 0) return 0;
    return this.flashTimer / FLASH_MS;
  }

  /** True while any effect is still animating (drives post-game frames). */
  get isActive(): boolean {
    if (this.flashTimer > 0) return true;
    for (const p of this.particles) if (p.active) return true;
    for (const p of this.popups) if (p.active) return true;
    return false;
  }

  forEachParticle(cb: (p: Particle, alpha: number) => void) {
    for (const p of this.particles) {
      if (!p.active) continue;
      cb(p, Math.min(1, (p.life / p.maxLife) * 1.6));
    }
  }

  /** `u` is 0 to 1 through the popup's life. */
  forEachPopup(cb: (p: Popup, u: number) => void) {
    for (const p of this.popups) {
      if (!p.active) continue;
      cb(p, 1 - p.timer / p.life);
    }
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

  private spawnPopup(x: number, y: number, text: string) {
    for (const p of this.popups) {
      if (p.active) continue;
      p.active = true;
      p.x = x;
      p.y = y;
      p.text = text;
      p.life = calloutLifeMs(this.reducedMotion);
      p.timer = p.life;
      return;
    }
  }
}
