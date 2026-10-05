/* Driving. On a touch screen the stage is a floating stick: put a finger
   down anywhere, drag the way you want to go, and the car turns to that
   heading and drives, harder the further you drag. A mouse drags the same
   way. The keyboard is a dodgem's wheel and pedal: left and right steer, up
   drives, down reverses.

   The stick's direction is read on screen and turned into the floor's
   direction through the camera, so up on the screen is always away from you,
   whichever way the rink is turned. */

import { INPUT_STEPS } from '@/features/arcade/lib/bumper-cars/constants';

export type DriveAxes = { right: [number, number]; up: [number, number] };

export type DriveInput = {
  /** Steer and throttle for the car with nose (fx, fz), -16..16 each. */
  read: (fx: number, fz: number) => { steer: number; throttle: number };
  /** The stick, for drawing: null when no finger is down. */
  stick: () => { ox: number; oy: number; dx: number; dy: number } | null;
  active: () => boolean;
  reset: () => void;
  dispose: () => void;
};

const STICK_RADIUS = 56;
const DEAD_ZONE = 8;
const KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);

export function createDriveInput(
  target: HTMLElement,
  axes: () => DriveAxes,
  enabled: () => boolean,
  onFirstMove?: () => void,
): DriveInput {
  let pointerId: number | null = null;
  let ox = 0;
  let oy = 0;
  let dx = 0;
  let dy = 0;
  const keys = new Set<string>();

  const local = (e: PointerEvent) => {
    const rect = target.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const down = (e: PointerEvent) => {
    if (!enabled() || pointerId !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointerId = e.pointerId;
    const p = local(e);
    ox = p.x;
    oy = p.y;
    dx = 0;
    dy = 0;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety */
    }
    onFirstMove?.();
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    const p = local(e);
    dx = p.x - ox;
    dy = p.y - oy;
    // The stick's base follows a finger that runs past its edge.
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS * 1.4) {
      const pull = len - STICK_RADIUS * 1.4;
      ox += (dx / len) * pull;
      oy += (dy / len) * pull;
      dx = p.x - ox;
      dy = p.y - oy;
    }
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    dx = 0;
    dy = 0;
  };
  const keyDown = (e: KeyboardEvent) => {
    if (!enabled() || !KEYS.has(e.code)) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.closest('button, a, input, textarea, select, [role="dialog"]') ?? null)) return;
    e.preventDefault();
    if (!keys.has(e.code)) onFirstMove?.();
    keys.add(e.code);
  };
  const keyUp = (e: KeyboardEvent) => {
    keys.delete(e.code);
  };
  const blur = () => {
    keys.clear();
    pointerId = null;
    dx = 0;
    dy = 0;
  };

  target.addEventListener('pointerdown', down);
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  window.addEventListener('blur', blur);

  const read = (fx: number, fz: number) => {
    if (keys.size > 0) {
      const left = keys.has('ArrowLeft') || keys.has('KeyA');
      const right = keys.has('ArrowRight') || keys.has('KeyD');
      const fwd = keys.has('ArrowUp') || keys.has('KeyW');
      const back = keys.has('ArrowDown') || keys.has('KeyS');
      const steer = (right ? 1 : 0) - (left ? 1 : 0);
      const throttle = (fwd ? 1 : 0) - (back ? 1 : 0);
      // Reversing, the wheel works the other way round, as in a car.
      return {
        steer: Math.round(steer * (throttle < 0 ? -1 : 1) * INPUT_STEPS),
        throttle: Math.round(throttle * INPUT_STEPS),
      };
    }
    const len = Math.hypot(dx, dy);
    if (pointerId === null || len < DEAD_ZONE) return { steer: 0, throttle: 0 };
    // Screen direction to floor direction: solve d = a·right + b·up.
    const { right, up: upv } = axes();
    const det = right[0] * upv[1] - right[1] * upv[0];
    if (Math.abs(det) < 1e-6) return { steer: 0, throttle: 0 };
    const a = (dx * upv[1] - dy * upv[0]) / det;
    const b = (right[0] * dy - right[1] * dx) / det;
    // World: +x is `right`, -z is `up`.
    const wx = a;
    const wz = -b;
    const wl = Math.hypot(wx, wz) || 1;
    const gx = wx / wl;
    const gz = wz / wl;
    const cross = fx * gz - fz * gx;
    const dot = fx * gx + fz * gz;
    const angle = Math.atan2(cross, dot);
    const steer = Math.max(-1, Math.min(1, angle / 0.55));
    const reach = Math.min(1, (len - DEAD_ZONE) / (STICK_RADIUS - DEAD_ZONE));
    // Pointing behind: turn hard on a light foot, so it comes round, not off.
    const throttle = reach * (Math.abs(angle) > 2 ? 0.35 : Math.abs(angle) > 1.2 ? 0.75 : 1);
    return { steer: Math.round(steer * INPUT_STEPS), throttle: Math.round(throttle * INPUT_STEPS) };
  };

  return {
    read,
    stick: () => (pointerId === null ? null : { ox, oy, dx, dy }),
    active: () => pointerId !== null || keys.size > 0,
    reset: blur,
    dispose: () => {
      target.removeEventListener('pointerdown', down);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', blur);
    },
  };
}

export const DRIVE_STICK_RADIUS = STICK_RADIUS;
