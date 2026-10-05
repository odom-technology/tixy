/* ──────────────────────────────────────────────────────────────────────────
   COIN PUSHER — the machine as the browser runs it.

   Holds an engine state and steps it to the machine clock, a fixed step at a
   time, so it lands on exactly the steps the server will compute. Drawing
   interpolates between the last two steps at the display's own refresh rate,
   and the shelves are drawn at the same fractional step, so coins riding a
   shelf stay glued to it.

   Everything here is presentation of a deterministic machine: the tilt of a
   coin at the lip, the tumble over an edge, the wobble after a landing and
   the drop into the tray are drawn from the engine's state and events and
   never feed back into it.
   ────────────────────────────────────────────────────────────────────────── */

import {
  CP_E1,
  CP_E2,
  CP_G,
  CP_STEP_MS,
  CP_EPOCH_MS,
  CP_Y_P2,
  cpAdvance,
  cpCoinWorld,
  cpShelfOffsets,
  cpPour,
  type CpEvent,
  type CpMachine,
} from '@/features/arcade/lib/coin-pusher/engine';

import type { CoinDraw } from './_coin-pusher-scene';

/** A coin at one step. `z` is relative to its shelf on a shelf (s 0 and 2),
    so interpolation happens in the shelf's own frame and survives jumps. */
type Snap = { x: number; y: number; z: number; s: number; l: number };

const shelfOff = (s: number, off: { a: number; b: number }) => (s === 0 ? off.a : s === 2 ? off.b : 0);

/** Golden-angle yaw per coin, so the stamped stubs don't line up. */
const yawOf = (id: number) => (id * 2.399963) % (Math.PI * 2);
/** A small fixed lean for a coin lying on others, by id. */
const leanOf = (id: number, k: number) => ((((id * 7919 + k * 104729) % 13) - 6) / 6) * 0.16;

/** How long a coin takes to drop out of sight into the tray, in seconds. */
const TRAY_FALL = 0.32;
/** The longest a frame may step the machine before it catches up over later frames. */
const MAX_STEPS_PER_FRAME = 24;

export type TrayFall = { id: number; atMs: number; x: number; vz: number };

export class PusherRuntime {
  m: CpMachine;
  /** serverNow − Date.now(), estimated from responses. */
  offsetMs = 0;
  /** A hit-stop holds the display this far behind the machine, easing back. */
  lagMs = 0;
  reducedMotion = false;

  /** performance.now() + wallBase is Date.now(), read once so the clock is monotonic. */
  private wallBase = Date.now() - performance.now();
  private prev = new Map<number, Snap>();
  private curr = new Map<number, Snap>();
  private landed = new Map<number, number>();
  private tipped = new Map<number, number>();
  private trays: TrayFall[] = [];
  private draws: CoinDraw[] = [];
  private events: CpEvent[] = [];

  constructor(machine: CpMachine, offsetMs = 0) {
    this.m = machine;
    this.offsetMs = offsetMs;
    this.snapshotAll();
    this.prev = new Map(this.curr);
  }

  /** Replace the machine (a load or a resync) without a stale interpolation. */
  load(machine: CpMachine, offsetMs = this.offsetMs) {
    this.m = machine;
    this.offsetMs = offsetMs;
    this.landed.clear();
    this.tipped.clear();
    this.snapshotAll();
    this.prev = new Map(this.curr);
  }

  /** The machine step the display is at, fractional. */
  displayStep(frameMs: number): number {
    return (frameMs + this.wallBase + this.offsetMs - this.lagMs - CP_EPOCH_MS) / CP_STEP_MS;
  }

  /** The machine clock now, in ms, for stamping a request. */
  machineNowMs(frameMs = performance.now()): number {
    return frameMs + this.wallBase + this.offsetMs;
  }

  /** The step a press right now should claim: the next one the machine computes. */
  nextStep(): number {
    return this.m.step + 1;
  }

  /** Queue a pour on the local machine from the next step. */
  pour(x: number, coins: number, at = this.nextStep()): number {
    cpPour(this.m, at, x, coins);
    return at;
  }

  /** Step the machine up to the display clock. Returns the events since last frame. */
  advance(frameMs: number, elapsedMs: number): CpEvent[] {
    if (this.lagMs > 0) this.lagMs = Math.max(0, this.lagMs - elapsedMs * 0.25);
    const target = Math.floor(this.displayStep(frameMs));
    this.events.length = 0;
    if (target <= this.m.step) return this.events;
    // A settled machine with nothing queued jumps to just before now; the
    // snapshots are shelf-relative, so the jump draws seamlessly.
    if (this.m.settled && this.m.pending.length === 0 && this.m.step < target - 1) {
      this.m.step = target - 1;
    }
    // Then one step at a time, so the interpolation pair is adjacent steps.
    let budget = MAX_STEPS_PER_FRAME;
    while (this.m.step < target && budget > 0) {
      const swap = this.prev;
      this.prev = this.curr;
      this.curr = swap;
      cpAdvance(this.m, this.m.step + 1, this.events);
      this.snapshotAll();
      budget -= 1;
    }
    for (const e of this.events) {
      if (e.k === 'land') this.landed.set(e.id, e.step);
      else if (e.k === 'tip') this.tipped.set(e.id, e.step);
      else if (e.k === 'tray') {
        this.trays.push({ id: e.id, atMs: frameMs, x: e.x, vz: Math.max(1.5, e.vz) });
        this.landed.delete(e.id);
        this.tipped.delete(e.id);
      }
    }
    return this.events;
  }

  private snapshotAll() {
    const next = this.curr;
    next.clear();
    const at = this.m.step;
    for (const c of this.m.coins) {
      const w = cpCoinWorld(c, at);
      next.set(c.id, { x: c.x, y: w.y, z: c.z, s: c.s, l: c.l });
    }
  }

  /** The shelves at the display's fractional step (one step behind the sim, to
      match the interpolation between the last two steps). */
  shelves(frameMs: number): { a: number; b: number } {
    const shown = Math.min(this.displayStep(frameMs), this.m.step + 1) - 1;
    return cpShelfOffsets(Math.max(this.m.step - 1, shown));
  }

  /** Fill the coin draw list for this frame. */
  coinsToDraw(frameMs: number): { coins: CoinDraw[]; count: number } {
    const shown = Math.min(this.displayStep(frameMs), this.m.step + 1) - 1;
    const alpha = Math.max(0, Math.min(1, shown - (this.m.step - 1)));
    const reduced = this.reducedMotion;
    let n = 0;
    const out = this.draws;
    const put = (d: CoinDraw) => {
      if (n < out.length) {
        const o = out[n];
        o.x = d.x;
        o.y = d.y;
        o.z = d.z;
        o.rx = d.rx;
        o.rz = d.rz;
        o.yaw = d.yaw;
      } else out.push({ ...d });
      n += 1;
    };
    const tmp: CoinDraw = { x: 0, y: 0, z: 0, rx: 0, rz: 0, yaw: 0 };
    const stepNow = this.m.step - 1 + alpha;
    const offNow = cpShelfOffsets(stepNow);
    const offPrev = cpShelfOffsets(this.m.step - 1);
    const offCurr = cpShelfOffsets(this.m.step);
    for (const [id, c] of this.curr) {
      const p = this.prev.get(id) ?? c;
      tmp.x = p.x + (c.x - p.x) * alpha;
      tmp.y = p.y + (c.y - p.y) * alpha;
      if (p.s === c.s) {
        // Same frame: interpolate there, then place it on the shelf as drawn.
        tmp.z = p.z + (c.z - p.z) * alpha + shelfOff(c.s, offNow);
      } else {
        const pz = p.z + shelfOff(p.s, offPrev);
        const cz = c.z + shelfOff(c.s, offCurr);
        tmp.z = pz + (cz - pz) * alpha;
      }
      tmp.yaw = yawOf(id);
      tmp.rx = 0;
      tmp.rz = 0;
      if (c.s === 4) {
        const tip = this.tipped.get(id);
        if (tip !== undefined && !reduced) {
          // Over an edge: it turns forward as it goes.
          tmp.rx = Math.min(1.5, (stepNow - tip) * 0.16);
        } else if (!reduced) {
          tmp.rx = 0.18;
          tmp.rz = leanOf(id, 3) * 2;
        }
      } else {
        if (c.l === 1) {
          tmp.rx = leanOf(id, 1);
          tmp.rz = leanOf(id, 2);
        }
        // At a lip: lean toward the drop as it overhangs, and tremble while
        // it is being pushed.
        const edge = c.s === 1 ? CP_E1 : c.s === 3 ? CP_E2 : 0;
        if (edge > 0 && c.l === 0) {
          const over = tmp.z - (edge - 0.55);
          if (over > 0) {
            const k = Math.min(1, over / 0.55);
            tmp.rx += k * k * 0.16;
            const moving = Math.abs(c.z - p.z) > 1e-4;
            if (moving && !reduced) tmp.rx += Math.sin(frameMs * 0.06 + id) * 0.025 * k;
          }
        }
        const landedAt = this.landed.get(id);
        if (landedAt !== undefined && !reduced) {
          const t = (stepNow - landedAt) / 60;
          if (t >= 0 && t < 0.35) {
            const w = Math.exp(-t / 0.08) * Math.sin(t * 46);
            tmp.rx += w * 0.12;
            tmp.rz += w * 0.08;
          } else if (t >= 0.35) this.landed.delete(id);
        }
      }
      put(tmp);
    }
    // Coins on their way into the tray.
    let keep = 0;
    for (const f of this.trays) {
      const t = (frameMs - f.atMs) / 1000;
      if (t > TRAY_FALL) continue;
      this.trays[keep++] = f;
      tmp.x = f.x;
      tmp.z = CP_E2 + 0.4 + f.vz * t;
      tmp.y = CP_Y_P2 - 0.5 * CP_G * t * t;
      tmp.yaw = yawOf(f.id);
      tmp.rx = reduced ? 0.8 : Math.min(1.6, 0.4 + t * 6);
      tmp.rz = 0;
      put(tmp);
    }
    this.trays.length = keep;
    return { coins: out, count: n };
  }
}
