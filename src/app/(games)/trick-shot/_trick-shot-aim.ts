'use client';

/* Aim and power for trick shot: 8-ball's hands, unchanged, plus the fine
   turn. The same smoothing, dead zone, pull-back projection and touch
   zones as 8-ball's match page (`8-ball/[id]/page.tsx`), with its tuning
   constants imported from 8-ball, so the cue answers the same way in both. */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Ball, Vec2 } from '@/features/arcade/lib/pool-physics';
import { TRICK_SHOT_ANGLE_STEP } from '@/features/arcade/lib/trick-shot/shot';
import {
  AIM_SMOOTH_ALPHA,
  MAX_PULL_DIST,
  MIN_FIRE_POWER,
  POWER_DRAG_EXPONENT,
} from '../8-ball/[id]/_pool-ui-constants';

export type AimPhase = 'idle' | 'aiming' | 'powering';

export type AimState = {
  phase: AimPhase;
  angle: number;
  power: number;
  dragStart: Vec2 | null;
};

/** 8-ball's touch zone: a press this close to the cue ball pulls back. */
const TOUCH_PULL_ZONE = 125;

function lerpAngle(from: number, to: number, alpha: number): number {
  let diff = to - from;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return from + diff * alpha;
}

export function useTrickShotAim({
  cuePos,
  balls,
  enabled,
  initialAngle,
  onFire,
  onPress,
}: {
  cuePos: Vec2 | null;
  balls: Ball[];
  enabled: boolean;
  /** Where the cue points before the first touch: at the first ball. */
  initialAngle: number;
  onFire: (angle: number, power: number) => void;
  onPress: () => void;
}) {
  const [aim, setAim] = useState<AimState>({ phase: 'aiming', angle: initialAngle, power: 0, dragStart: null });
  const touchModeRef = useRef<'aim' | 'pull' | null>(null);
  const aimRef = useRef(aim);
  aimRef.current = aim;

  // A new table points the cue at its first ball again.
  useEffect(() => {
    setAim({ phase: 'aiming', angle: initialAngle, power: 0, dragStart: null });
  }, [initialAngle]);

  const onDown = useCallback(
    (pos: Vec2, pointerType?: string) => {
      if (!enabled || !cuePos) return;
      onPress();
      if (pointerType === 'touch') {
        const toCue = Math.hypot(pos.x - cuePos.x, pos.y - cuePos.y);
        const toBall = balls.reduce(
          (best, b) => (b.id === 0 || b.pocketed ? best : Math.min(best, Math.hypot(pos.x - b.pos.x, pos.y - b.pos.y))),
          Infinity,
        );
        const near = toCue <= TOUCH_PULL_ZONE && toCue < toBall;
        if (!near) {
          touchModeRef.current = 'aim';
          setAim((prev) => ({
            ...prev,
            phase: 'aiming',
            angle: Math.atan2(pos.y - cuePos.y, pos.x - cuePos.x),
            power: 0,
            dragStart: null,
          }));
          return;
        }
        touchModeRef.current = 'pull';
        setAim((prev) => ({ phase: 'powering', angle: prev.angle, power: 0, dragStart: pos }));
        return;
      }
      setAim((prev) => ({
        phase: 'powering',
        angle: prev.phase === 'aiming' ? prev.angle : Math.atan2(pos.y - cuePos.y, pos.x - cuePos.x),
        power: 0,
        dragStart: pos,
      }));
    },
    [enabled, cuePos, balls, onPress],
  );

  const onMove = useCallback(
    (pos: Vec2) => {
      if (!enabled || !cuePos) return;
      const current = aimRef.current;
      if (current.phase === 'powering' && current.dragStart) {
        // The angle is locked; only the pull back along the aim counts.
        const backX = -Math.cos(current.angle);
        const backY = -Math.sin(current.angle);
        const pull = Math.max(0, (pos.x - current.dragStart.x) * backX + (pos.y - current.dragStart.y) * backY);
        const power = Math.pow(Math.min(1, pull / MAX_PULL_DIST), POWER_DRAG_EXPONENT);
        setAim((prev) => ({ ...prev, power }));
        return;
      }
      if (touchModeRef.current === 'pull') return;
      const dx = pos.x - cuePos.x;
      const dy = pos.y - cuePos.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 25) {
        setAim((prev) => (prev.phase === 'aiming' ? prev : { ...prev, phase: 'aiming', power: 0 }));
        return;
      }
      const raw = Math.atan2(dy, dx);
      const t = Math.min(1, (dist - 25) / 95);
      const alpha = AIM_SMOOTH_ALPHA * (0.25 + 0.75 * t);
      setAim((prev) => {
        const angle = prev.phase === 'aiming' ? lerpAngle(prev.angle, raw, alpha) : raw;
        if (prev.phase === 'aiming' && Math.abs(angle - prev.angle) < 0.0005) return prev;
        return { ...prev, phase: 'aiming', angle, power: 0 };
      });
    },
    [enabled, cuePos],
  );

  const cancel = useCallback(() => {
    touchModeRef.current = null;
    setAim((prev) => (prev.phase === 'powering' ? { ...prev, phase: 'aiming', power: 0, dragStart: null } : prev));
  }, []);

  const release = useCallback(() => {
    touchModeRef.current = null;
    const current = aimRef.current;
    if (!enabled || current.phase !== 'powering') return;
    if (current.power < MIN_FIRE_POWER) {
      setAim((prev) => ({ ...prev, phase: 'aiming', power: 0, dragStart: null }));
      return;
    }
    setAim((prev) => ({ ...prev, phase: 'idle', power: 0, dragStart: null }));
    onFire(current.angle, current.power);
  }, [enabled, onFire]);

  /** The fine turn: whole grid steps of 0.01 degrees. */
  const nudge = useCallback((steps: number) => {
    setAim((prev) => ({
      ...prev,
      phase: prev.phase === 'idle' ? 'aiming' : prev.phase,
      angle: prev.angle + steps * TRICK_SHOT_ANGLE_STEP,
    }));
  }, []);

  /** The power bar: keeps the aim, sets only the power. */
  const powerBar = {
    start: () => setAim((prev) => (prev.phase === 'idle' ? prev : { ...prev, phase: 'powering', power: 0, dragStart: null })),
    set: (power: number) => setAim((prev) => (prev.phase === 'powering' ? { ...prev, power } : prev)),
    end: release,
    cancel,
  };

  const resetTo = useCallback((angle: number) => {
    touchModeRef.current = null;
    setAim({ phase: 'aiming', angle, power: 0, dragStart: null });
  }, []);

  // Right-click or Escape takes a pull back without shooting.
  useEffect(() => {
    if (aim.phase !== 'powering') return;
    const onContext = (event: MouseEvent) => {
      event.preventDefault();
      cancel();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    window.addEventListener('contextmenu', onContext);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('contextmenu', onContext);
      window.removeEventListener('keydown', onKey);
    };
  }, [aim.phase, cancel]);

  return { aim, onDown, onMove, release, cancel, nudge, powerBar, resetTo };
}
